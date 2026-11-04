import { serve } from "https://raw.githubusercontent.com/denoland/deno_std/0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// removed node:crypto
import { corsHeaders } from "../_shared/cors.ts";
import { notifyApiClient } from "../_shared/webhooks.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const DATAMART_WEBHOOK_SECRET = Deno.env.get("DATAMART_WEBHOOK_SECRET");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-datamart-signature");

    if (!signature) {
      console.error("[DataMart Webhook] Missing signature header");
      return new Response(JSON.stringify({ error: "Missing signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Resolve Secret (Env Var or DB)
    let secret = DATAMART_WEBHOOK_SECRET;
    if (!secret) {
      const { data: provider } = await supabaseAdmin
        .from("providers")
        .select("settings")
        .eq("handler_type", "datamart")
        .eq("is_active", true)
        .maybeSingle();
      
      secret = provider?.settings?.webhook_secret;
    }

    // Verify Signature: Require secret to be present and reject if missing
    if (!secret) {
      console.error("[DataMart Webhook] Webhook secret not configured in environment or database.");
      return new Response(JSON.stringify({ error: "Webhook secret not configured" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(rawBody));
    const expectedSignature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

    const sigA = signature.toLowerCase().trim();
    const sigB = expectedSignature.toLowerCase().trim();
    let diff = sigA.length ^ sigB.length;
    for (let i = 0; i < Math.min(sigA.length, sigB.length); i++) {
      diff |= sigA.charCodeAt(i) ^ sigB.charCodeAt(i);
    }

    if (diff !== 0) {
      console.error("[DataMart Webhook] Invalid signature");
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(rawBody);
    const { event, data } = payload;
    const reference = String(data?.orderReference || data?.reference || data?.orderId || "").trim();
    const status = String(data?.status || data?.orderStatus || "").toLowerCase().trim();
    const eventLower = String(event || "").toLowerCase().trim();

    if (!reference) {
      return new Response(JSON.stringify({ error: "No reference found" }), { status: 400 });
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference);
    let orderQuery = supabaseAdmin.from("orders").select("*");
    if (isUuid) {
      orderQuery = orderQuery.or(`id.eq.${reference},provider_order_id.eq.${reference},metadata->>client_reference.eq.${reference}`);
    } else {
      orderQuery = orderQuery.or(`provider_order_id.eq.${reference},metadata->>client_reference.eq.${reference}`);
    }
    const { data: order } = await orderQuery.limit(1).maybeSingle();

    const newBal = Number(data?.balanceAfter ?? data?.newBalance);
    if (Number.isFinite(newBal)) {
      await Promise.resolve(
        supabaseAdmin
          .from("providers")
          .update({ balance: newBal, last_synced_at: new Date().toISOString() })
          .eq("handler_type", "datamart")
      ).catch(() => {});
    }

    const isSuccess = ["completed", "success", "successful", "delivered", "fulfilled"].includes(status);
    const isCancelledOrRefunded =
      eventLower === "order.refunded" ||
      status === "cancelled" ||
      status === "refunded" ||
      data?.refunded === true;
    const isFailed = ["failed", "rejected"].includes(status);

    if (order) {
      if (isSuccess) {
        if (order.status !== "fulfilled") {
          await supabaseAdmin.from("orders").update({ 
            status: "fulfilled",
            failure_reason: null,
            updated_at: new Date().toISOString()
          }).eq("id", order.id);
          await supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id });
          await notifyApiClient(supabaseAdmin, order.id, "fulfilled");
        }
      } else if (isCancelledOrRefunded) {
        if (order.status !== "fulfilled" && order.status !== "refunded" && !order.auto_refunded) {
          await supabaseAdmin.from("orders").update({
            status: "fulfillment_failed",
            provider_order_id: "refunded",
            failure_reason: "Order cancelled and refunded on DataMart",
            metadata: {
              ...(order.metadata || {}),
              datamart_webhook_event: event || "order.refunded",
              datamart_cancelled_at: data?.cancelledAt || new Date().toISOString(),
              datamart_cancel_data: data,
            },
            updated_at: new Date().toISOString(),
          }).eq("id", order.id);

          const pmLower = String(order.payment_method || "").toLowerCase().trim();
          if (pmLower === "wallet" || pmLower === "balance") {
            await Promise.resolve(
              supabaseAdmin.rpc("refund_failed_order", { p_order_id: order.id })
            ).catch((e) => console.error("[DataMart Webhook] Wallet refund RPC error:", e));
          }
          await notifyApiClient(supabaseAdmin, order.id, "refunded");
        }
      } else if (isFailed) {
        if (order.status !== "fulfilled" && order.status !== "refunded") {
          await supabaseAdmin.from("orders").update({ 
            status: "fulfillment_failed",
            failure_reason: `Provider reported failure: ${status}`,
            updated_at: new Date().toISOString()
          }).eq("id", order.id);
          await notifyApiClient(supabaseAdmin, order.id, "fulfillment_failed");
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[DataMart Webhook] Internal Error:", err);
    return new Response(JSON.stringify({ error: "Internal Error" }), { status: 500 });
  }
});
