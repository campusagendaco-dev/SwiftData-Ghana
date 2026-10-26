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

/**
 * Checks whether an order is an SME data bundle on MTN, TELECEL, or AT/AIRTELTIGO
 * that must NEVER be routed or failed over to Korba.
 */
function isSmeDataBundle(order: any): boolean {
  const orderType = String(order?.order_type || "data").toLowerCase();
  const isDataOrder = orderType === "data" || !orderType || orderType === "sme";
  if (!isDataOrder) return false;

  const uppercaseNet = String(order?.network || "").toUpperCase().trim();
  const orderCategory = String(order?.metadata?.category || order?.metadata?.package_category || "").toLowerCase().trim();
  const pkgUpper = String(order?.package_size || "").toUpperCase().trim();

  if (uppercaseNet.startsWith("KORBA") || orderCategory === "korba" || order?.metadata?.provider_type === "korba") {
    return false;
  }

  const isKorbaPackagePattern =
    pkgUpper.startsWith("GHS") ||
    pkgUpper.includes("RACT_DATA") ||
    pkgUpper.includes("KOKROKOO") ||
    pkgUpper.includes("MIDNIGHT") ||
    pkgUpper.includes("SOCIAL") ||
    pkgUpper.includes("VIDEO") ||
    pkgUpper.includes("IDD");
  if (isKorbaPackagePattern) return false;

  const isSmeNetwork =
    uppercaseNet.includes("MTN") ||
    uppercaseNet.includes("TELECEL") ||
    uppercaseNet.includes("VODA") ||
    uppercaseNet === "AT" ||
    uppercaseNet.startsWith("AT ") ||
    uppercaseNet.endsWith(" AT") ||
    uppercaseNet.includes("AIRTEL") ||
    uppercaseNet.includes("TIGO");

  const isStandardSmeSize = /^\d+(\.\d+)?\s*(GB|MB)$/i.test(pkgUpper);

  return (
    orderCategory === "affordable" ||
    orderCategory === "sme" ||
    orderCategory.includes("sme") ||
    isSmeNetwork ||
    isStandardSmeSize
  );
}

/**
 * Resolves provider API keys and Paystack/Korba credentials by prioritizing Deno.env.get(...)
 * before falling back to DB provider.api_key or v_system_settings_with_secrets.
 */
function resolveProviderApiKey(provider: any, dbSecrets: Record<string, string> = {}): string {
  const handlerType = String(provider?.handler_type || "standard").toLowerCase();
  const envApiKey =
    handlerType === "skdataplug" ? Deno.env.get("SKDATAPLUG_API_KEY") :
    handlerType === "datahub" ? Deno.env.get("DATAHUB_API_KEY") :
    handlerType === "datamart" ? Deno.env.get("DATAMART_API_KEY") :
    handlerType === "spendless" ? Deno.env.get("SPENDLESS_API_KEY") :
    handlerType === "bundlezone" ? Deno.env.get("BUNDLEZONE_API_KEY") :
    handlerType === "qhowmenzconsult" ? Deno.env.get("QHOWMENZ_API_KEY") :
    handlerType === "korba" ? (Deno.env.get("KORBA_SECRET_KEY") || Deno.env.get("KORBA_API_KEY")) :
    Deno.env.get("DATA_PROVIDER_API_KEY");

  const dbFallback =
    provider?.api_key ||
    (handlerType === "korba" ? (dbSecrets["korba_secret_key"] || dbSecrets["korba_api_key"]) : "") ||
    "";

  return String(envApiKey || dbFallback || "").trim();
}

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

async function pollProviderStatus(
  provider: any,
  orderId: string,
  providerOrderId: string | null,
  dbSecrets: Record<string, string> = {},
  order?: any
): Promise<{ ok: boolean; status?: string }> {
  const handlerType = String(provider.handler_type || "standard").toLowerCase();
  if (handlerType === "korba" && order && isSmeDataBundle(order)) {
    return { ok: false, status: "failed" };
  }
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
    const apiKey = resolveProviderApiKey(provider, dbSecrets);

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
  const CRON_SECRET = (Deno.env.get("CRON_SECRET") || "").trim();
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // SECURITY: Require service-role key, CRON_SECRET, or admin user token
  const authHeader = req.headers.get("Authorization");
  const userToken = req.headers.get("x-user-access-token");
  const cronSecretHeader = req.headers.get("x-cron-secret")?.trim();
  const token = (userToken || authHeader?.replace(/^Bearer\s+/i, "") || "").trim();

  if (!token && !cronSecretHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const isServiceRole = Boolean(SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY.trim());
  const isCronSecret = Boolean(CRON_SECRET && (token === CRON_SECRET || cronSecretHeader === CRON_SECRET));
  if (!isServiceRole && !isCronSecret) {
    const authResult = await verifyAdmin(req, supabaseAdmin);
    if (!authResult.success) {
      return new Response(JSON.stringify({ error: authResult.error }), {
        status: authResult.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const body = await Promise.resolve(req.json()).catch(() => ({}));
    const targetIds: string[] | undefined = body.order_ids;

    // Fetch Korba provider IDs to strictly prevent SME bundles from ever routing or failing over to Korba
    const { data: korbaProviders } = await supabaseAdmin
      .from("providers")
      .select("id, name, handler_type")
      .or("handler_type.eq.korba,name.ilike.%korba%");
    const korbaProviderIds = new Set<string>((korbaProviders || []).map((p: any) => String(p.id)));

    // Resolve system settings secrets as fallback after Deno.env.get(...)
    const { data: settingsRows } = await supabaseAdmin
      .from("v_system_settings_with_secrets")
      .select("key, value")
      .in("key", ["paystack_secret_key", "korba_secret_key", "korba_client_key", "korba_api_key"]);
    const dbSecrets: Record<string, string> = {};
    (settingsRows || []).forEach((r: any) => {
      if (r?.key && r?.value) dbSecrets[String(r.key)] = String(r.value);
    });
    const _paystackSecret = (Deno.env.get("PAYSTACK_SECRET_KEY") || dbSecrets["paystack_secret_key"] || "").trim();
    const _korbaSecret = (Deno.env.get("KORBA_SECRET_KEY") || Deno.env.get("KORBA_API_KEY") || dbSecrets["korba_secret_key"] || dbSecrets["korba_api_key"] || "").trim();

    let query = supabaseAdmin
      .from("orders")
      .select("id, network, package_size, customer_phone, amount, agent_id, profit, parent_profit, provider_id, provider_order_id, order_type, metadata, created_at")
      .eq("status", "processing")
      .in("order_type", ["data", "airtime"])
      .order("created_at", { ascending: true })
      .limit(50);

    if (targetIds && targetIds.length > 0) {
      query = query.in("id", targetIds);
    } else {
      query = query.lt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
    }

    const { data: stuckOrders, error } = await query;
    if (error) throw error;

    const results: any[] = [];
    const verifyPaymentUrl = `${SUPABASE_URL}/functions/v1/verify-payment`;

    for (const order of stuckOrders || []) {
      const result: any = { id: order.id, network: order.network, package_size: order.package_size, action: "none" };

      try {
        // SME Bundle Korba Exclusion: Ensure SME data bundles on MTN, TELECEL, or AT/AIRTELTIGO
        // never route or fail over to Korba during healing or subsequent retries.
        if (isSmeDataBundle(order) && korbaProviderIds.size > 0) {
          const prevFailed = Array.isArray(order.metadata?.failed_provider_ids) ? order.metadata.failed_provider_ids : [];
          const updatedFailedIds = Array.from(new Set([...prevFailed, ...Array.from(korbaProviderIds)]));
          const isAssignedToKorba = Boolean(order.provider_id && korbaProviderIds.has(String(order.provider_id)));

          if (isAssignedToKorba || !order.metadata?.exclude_korba || updatedFailedIds.length !== prevFailed.length) {
            const nextMetadata = {
              ...(order.metadata || {}),
              exclude_korba: true,
              failed_provider_ids: updatedFailedIds,
            };
            await Promise.resolve(
              supabaseAdmin
                .from("orders")
                .update({
                  ...(isAssignedToKorba ? { provider_id: null, provider_order_id: null } : {}),
                  metadata: nextMetadata,
                })
                .eq("id", order.id)
            ).catch(() => {});
          }
        }

        const hasAssignedProvider = Boolean(
          order.provider_order_id &&
          order.provider_order_id !== "failed_api_call" &&
          order.provider_order_id !== "timeout" &&
          order.provider_order_id !== "dispatching" &&
          order.provider_order_id !== "routed" &&
          order.provider_order_id !== "duplicate_cooldown" &&
          order.provider_order_id !== "refunded"
        );

        const verifyRes = await fetch(verifyPaymentUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ orderId: order.id, force: !hasAssignedProvider }),
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
