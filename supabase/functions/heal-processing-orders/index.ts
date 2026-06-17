import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getActiveProviders } from "../_shared/providers.ts";

declare const Deno: any;

// Heals orders stuck in 'processing' where the webhook was never received.
// For each stuck order:
//   1. Polls the provider's status API using our order reference.
//   2. Delivered  → mark fulfilled + credit profits.
//   3. Failed     → mark fulfillment_failed.
//   4. No record  → reset to 'paid' so process-retries re-submits.

function buildStatusUrl(baseUrl: string, handlerType: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  if (handlerType === "datahub") return `${clean}/order-status`;
  if (handlerType === "datamart") return `${clean}/api/order-status`;
  if (handlerType === "qhowmenzconsult") return `${clean}/orders`;
  if (handlerType === "skdataplug") return `${clean}/status`;
  return `${clean}/api/status`;
}

async function pollProviderStatus(provider: any, orderId: string, providerOrderId: string | null): Promise<{ ok: boolean; status?: string }> {
  const handlerType = provider.handler_type || "standard";
  const url = buildStatusUrl(provider.base_url, handlerType);
  const isGet = handlerType === "qhowmenzconsult" || handlerType === "skdataplug";
  const finalUrl = handlerType === "skdataplug"
    ? `${url}/${providerOrderId || orderId}/`
    : (handlerType === "qhowmenzconsult" ? `${url}/${providerOrderId || orderId}` : url);

  const body = JSON.stringify({
    reference: orderId,
    order_id: providerOrderId || orderId,
    transaction_id: providerOrderId || orderId,
    orderReference: orderId,
  });

  try {
    const res = await fetch(finalUrl, {
      method: isGet ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(handlerType === "qhowmenzconsult" ? {} : { "Authorization": `Bearer ${provider.api_key}` }),
        "X-API-Key": provider.api_key,
      },
      body: isGet ? undefined : body,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return { ok: false };
    const text = await res.text();
    const json = JSON.parse(text);

    const techStatus = String(json?.status ?? json?.success ?? "").toLowerCase();
    const dataStatus = String(json?.data?.status ?? json?.data?.orderStatus ?? "").toLowerCase();
    const effective = dataStatus || techStatus;

    const isSuccess = techStatus === "success" || techStatus === "true" || json?.success === true || json?.ok === true;
    if (!isSuccess) return { ok: false };

    return { ok: true, status: effective || techStatus };
  } catch {
    return { ok: false };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const targetIds: string[] | undefined = body.order_ids;

    let query = supabaseAdmin
      .from("orders")
      .select("id, network, package_size, customer_phone, amount, agent_id, profit, parent_profit, provider_order_id, order_type, created_at")
      .eq("status", "processing")
      .neq("network", "MTN Mash Up")
      .in("order_type", ["data", "airtime"])
      .lt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true })
      .limit(50);

    if (targetIds && targetIds.length > 0) {
      query = query.in("id", targetIds);
    }

    const { data: stuckOrders, error } = await query;
    if (error) throw error;

    const providers = await getActiveProviders(supabaseAdmin, "data");
    const results: any[] = [];

    for (const order of stuckOrders || []) {
      const result: any = { id: order.id, network: order.network, package_size: order.package_size, action: "none" };

      // Poll each active provider until one responds
      let statusResult: { ok: boolean; status?: string } = { ok: false };
      for (const provider of providers) {
        statusResult = await pollProviderStatus(provider, order.id, order.provider_order_id);
        if (statusResult.ok) break;
      }

      if (statusResult.ok) {
        const s = (statusResult.status || "").toLowerCase();
        const isDelivered = ["delivered", "success", "successful", "fulfilled", "completed", "sent"].includes(s);
        const isFailed = ["failed", "error", "refunded", "cancelled", "rejected"].includes(s);

        if (isDelivered) {
          await supabaseAdmin.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", order.id);
          await supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id });
          result.action = "fulfilled";
          result.reason = `Provider confirmed: ${statusResult.status}`;
        } else if (isFailed) {
          await supabaseAdmin.from("orders").update({
            status: "fulfillment_failed",
            failure_reason: `Provider confirmed failed: ${statusResult.status}`,
          }).eq("id", order.id);
          result.action = "failed";
          result.reason = `Provider confirmed: ${statusResult.status}`;
        } else {
          result.action = "still_processing";
          result.reason = `Provider status: ${statusResult.status}`;
        }
      } else {
        // Provider has no record — reset to paid for a fresh attempt
        await supabaseAdmin.from("orders").update({
          status: "paid",
          retry_count: 0,
          failure_reason: "Re-queued: provider had no record",
        }).eq("id", order.id);
        result.action = "requeued";
        result.reason = "Provider had no record — reset to paid for fresh fulfillment";
      }

      results.push(result);
      console.log(`[heal-processing] ${order.id}: ${result.action} — ${result.reason}`);
    }

    const summary = {
      total: results.length,
      fulfilled: results.filter(r => r.action === "fulfilled").length,
      failed: results.filter(r => r.action === "failed").length,
      requeued: results.filter(r => r.action === "requeued").length,
      still_processing: results.filter(r => r.action === "still_processing").length,
    };

    return new Response(JSON.stringify({ success: true, summary, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[heal-processing] Error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
