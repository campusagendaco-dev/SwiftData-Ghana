import { serve } from "https://raw.githubusercontent.com/denoland/deno_std/0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { notifyApiClient } from "../_shared/webhooks.ts";
import { log } from "../_shared/logger.ts";

// DataHub Ghana webhook handler
// Receives order status callbacks from DataHub Ghana

// Maps DataHub statuses to internal system statuses
function mapDatahubStatus(status: string): "processing" | "fulfilled" | "fulfillment_failed" | null {
  switch (status.toUpperCase()) {
    case "SUCCESSFUL":
    case "SUCCESS":
    case "DELIVERED":
    case "COMPLETED":
      return "fulfilled";
    case "FAILED":
    case "CANCELLED":
    case "REFUNDED":
    case "REJECTED":
      return "fulfillment_failed";
    case "INITIATED":
    case "PENDING":
    case "PROCESSING":
      return "processing";
    default:
      return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "online" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Security: Verify webhook secret if configured in the vault
  const DATAHUB_WEBHOOK_SECRET = Deno.env.get("DATAHUB_WEBHOOK_SECRET") || Deno.env.get("PROVIDER_WEBHOOK_SECRET");
  if (DATAHUB_WEBHOOK_SECRET) {
    const query = new URL(req.url).searchParams;
    const providedSecret = req.headers.get("X-Webhook-Secret") || query.get("key") || query.get("secret");
    if (providedSecret !== DATAHUB_WEBHOOK_SECRET) {
      console.warn("[datahub-webhook] Unauthorized access attempt prevented.");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    // Log User-Agent for debugging (not used for auth — any bot can spoof it)
    const userAgent = req.headers.get("user-agent") || "";
    console.log("[datahub-webhook] Incoming User-Agent:", userAgent);

    const rawBody = await req.text();
    if (!rawBody) {
      return new Response(JSON.stringify({ error: "Empty body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(rawBody);
    const event = payload?.event;
    const data = payload?.data;

    console.log("[datahub-webhook] Received event:", event, JSON.stringify(data));

    // Accept any order-related status event; skip non-order events
    const isOrderEvent = !event || event.toLowerCase().includes("order") || event.toLowerCase().includes("status");
    if (!isOrderEvent || !data) {
      log(supabaseAdmin, { level: "info", source: "datahub-webhook", event: "webhook.skipped", message: `Non-order event skipped: ${event || "unknown"}`, data: { event, hasData: !!data } });
      return new Response(JSON.stringify({ received: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    log(supabaseAdmin, { level: "info", source: "datahub-webhook", event: "webhook.received", message: `Webhook received: ${event} — status: ${data.status}`, data: { event, reference: data.reference, orderNumber: data.orderNumber, status: data.status } });

    const rawRef = data.reference;
    const rawOrderNumber = String(data.orderNumber || "");

    const refStr = typeof rawRef === "string" ? rawRef.trim() : "";
    const orderNoStr = rawOrderNumber.trim();

    if (refStr && !/^[a-zA-Z0-9\-_]{1,64}$/.test(refStr)) {
      console.warn("[datahub-webhook] Blocked webhook request with invalid reference format:", refStr);
      return new Response(JSON.stringify({ error: "Invalid reference format" }), { 
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (orderNoStr && !/^[a-zA-Z0-9\-_]{1,64}$/.test(orderNoStr)) {
      console.warn("[datahub-webhook] Blocked webhook request with invalid orderNumber format:", orderNoStr);
      return new Response(JSON.stringify({ error: "Invalid orderNumber format" }), { 
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const datahubReference = refStr;
    const datahubOrderNumber = orderNoStr;
    const datahubStatus = data.status || "";
    const systemStatus = mapDatahubStatus(datahubStatus);

    if (!systemStatus) {
      console.log("[datahub-webhook] Unknown status, ignoring:", datahubStatus);
      return new Response(JSON.stringify({ received: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up order — we pass our own order ID as `reference` in the purchase request,
    // so DataHub echoes it back. Try direct ID match first, then provider_order_id fallback.
    const filters = [
      datahubReference ? `id.eq.${datahubReference}` : null,
      datahubReference ? `provider_order_id.eq.${datahubReference}` : null,
      datahubOrderNumber ? `provider_order_id.eq.${datahubOrderNumber}` : null,
    ].filter(Boolean).join(",");

    const { data: order, error: fetchError } = await supabaseAdmin
      .from("orders")
      .select("id, status, agent_id, profit, parent_profit")
      .or(filters)
      .maybeSingle();

    if (fetchError || !order) {
      console.warn("[datahub-webhook] Order not found for reference:", datahubReference, "orderNumber:", datahubOrderNumber);
      log(supabaseAdmin, { level: "warn", source: "datahub-webhook", event: "order.not_found", message: `Order not found (possibly test webhook) — ref: ${datahubReference}, orderNo: ${datahubOrderNumber}`, data: { datahubReference, datahubOrderNumber, datahubStatus } });
      return new Response(JSON.stringify({ received: true, warning: "Order not found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency: don't re-process if already in terminal state
    if (order.status === "fulfilled" && systemStatus === "fulfilled") {
      return new Response(JSON.stringify({ received: true, message: "Already fulfilled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (order.status === "fulfillment_failed" && systemStatus === "fulfillment_failed") {
      return new Response(JSON.stringify({ received: true, message: "Already failed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const patch: Record<string, any> = {
      status: systemStatus,
      updated_at: new Date().toISOString(),
    };

    if (systemStatus === "fulfillment_failed") {
      patch.failure_reason = `DataHub reported: ${datahubStatus}`;
    }

    const { error: updateError } = await supabaseAdmin.from("orders").update(patch).eq("id", order.id);

    if (updateError) {
      console.error("[datahub-webhook] Failed to update order", order.id, ":", updateError.message);
      log(supabaseAdmin, { level: "error", source: "datahub-webhook", event: "order.update_failed", message: `DB update failed for order ${order.id}: ${updateError.message}`, order_id: order.id, data: { datahubStatus, systemStatus, error: updateError.message } });
      return new Response(JSON.stringify({ error: "Failed to update order" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (systemStatus === "fulfilled") {
      if (order.profit > 0 || order.parent_profit > 0) {
        await supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id });
      }
      await notifyApiClient(supabaseAdmin, order.id, "fulfilled");
      log(supabaseAdmin, { level: "info", source: "datahub-webhook", event: "order.fulfilled", message: `Order fulfilled via DataHub webhook`, order_id: order.id, data: { datahubStatus, datahubReference, profit: order.profit, parent_profit: order.parent_profit } });
    } else if (systemStatus === "fulfillment_failed") {
      await notifyApiClient(supabaseAdmin, order.id, "fulfillment_failed");
      // Auto-refund has been disabled per admin requirements (manual refunds only)
      log(supabaseAdmin, { level: "warn", source: "datahub-webhook", event: "order.failed", message: `Order marked failed by DataHub: ${datahubStatus}. Manual refund required.`, order_id: order.id, data: { datahubStatus, datahubReference } });
    } else {
      log(supabaseAdmin, { level: "info", source: "datahub-webhook", event: "order.updated", message: `Order status → ${systemStatus}`, order_id: order.id, data: { datahubStatus, systemStatus } });
    }

    console.log("[datahub-webhook] Order", order.id, "updated to", systemStatus);

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[datahub-webhook] Error:", err.message);
    log(supabaseAdmin, { level: "error", source: "datahub-webhook", event: "error", message: `Unhandled error: ${err.message}`, data: { stack: err.stack?.slice(0, 500) } });
    return new Response(JSON.stringify({ error: "Internal Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
