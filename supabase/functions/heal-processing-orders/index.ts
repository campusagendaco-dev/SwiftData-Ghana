import { serve } from "https://raw.githubusercontent.com/denoland/deno_std/0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getActiveProviders } from "../_shared/providers.ts";
import { verifyAdmin } from "../_shared/auth.ts";

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
  if (handlerType === "skdataplug") {
    let cleanBase = clean.replace(/\/order\/?$/, "").replace(/\/status\/?$/, "").replace(/\/balance\/?$/, "").replace(/\/bundles\/?$/, "");
    if (!cleanBase.endsWith("/api/v1")) {
      if (cleanBase.endsWith("/api")) cleanBase += "/v1";
      else cleanBase += "/api/v1";
    }
    return `${cleanBase}/status`;
  }
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
    const apiKey = (handlerType === "skdataplug" ? (Deno.env.get("SKDATAPLUG_API_KEY") || provider.api_key) : provider.api_key) || "";

    const res = await fetch(finalUrl, {
      method: isGet ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(handlerType === "qhowmenzconsult" ? {} : { "Authorization": `Bearer ${apiKey}` }),
        "X-API-Key": apiKey,
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

    const isSuccess = techStatus === "success" || techStatus === "true" || techStatus === "delivered" || techStatus === "processing" || techStatus === "pending" || techStatus === "failed" || json?.success === true || json?.ok === true || Boolean(json?.order_id);
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

  // SECURITY: Require service-role key or admin user token
  const authHeader = req.headers.get("Authorization");
  const userToken = req.headers.get("x-user-access-token");
  const token = userToken || authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
  if (!isServiceRole) {
    const authResult = await verifyAdmin(req, supabaseAdmin);
    if (!authResult.success) {
      return new Response(JSON.stringify({ error: authResult.error }), {
        status: authResult.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

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

    const results: any[] = [];
    const verifyPaymentUrl = `${SUPABASE_URL}/functions/v1/verify-payment`;

    for (const order of stuckOrders || []) {
      const result: any = { id: order.id, network: order.network, package_size: order.package_size, action: "none" };

      try {
        const verifyRes = await fetch(verifyPaymentUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ orderId: order.id, force: true }),
        });

        if (verifyRes.ok) {
          const resJson = await verifyRes.json();
          result.action = resJson.status || "processed";
          result.reason = resJson.message || `verify-payment status: ${resJson.status}`;
        } else {
          const errText = await verifyRes.text();
          result.action = "error";
          result.reason = `verify-payment returned ${verifyRes.status}: ${errText}`;
        }
      } catch (e: any) {
        result.action = "error";
        result.reason = e.message || "Failed to call verify-payment";
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
