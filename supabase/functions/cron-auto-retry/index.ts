import { serve } from "https://raw.githubusercontent.com/denoland/deno_std/0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchOrderWithFailover } from "../_shared/provider_router.ts";
import { isOrderPausedFromApi } from "../_shared/providers.ts";
import { getProviderAdapter } from "../_shared/providers/registry.ts";
import { isNonRetryableTerminalError, isDuplicateOrderError } from "../_shared/providers/utils.ts";
import { log } from "../_shared/logger.ts";
import { sendPaymentSms, normalizePhone } from "../_shared/sms.ts";
import { verifyAdmin } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-access-token, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

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
function resolveProviderWithEnvSecrets(provider: any, dbSecrets: Record<string, string> = {}): any {
  if (!provider) return provider;
  const handlerType = String(provider.handler_type || "standard").toLowerCase();
  const envApiKey =
    handlerType === "skdataplug" ? Deno.env.get("SKDATAPLUG_API_KEY") :
    handlerType === "datahub" ? Deno.env.get("DATAHUB_API_KEY") :
    handlerType === "datamart" ? Deno.env.get("DATAMART_API_KEY") :
    handlerType === "spendless" ? Deno.env.get("SPENDLESS_API_KEY") :
    handlerType === "bundlezone" ? Deno.env.get("BUNDLEZONE_API_KEY") :
    handlerType === "qhowmenzconsult" ? Deno.env.get("QHOWMENZ_API_KEY") :
    handlerType === "korba" ? (Deno.env.get("KORBA_SECRET_KEY") || Deno.env.get("KORBA_API_KEY")) :
    Deno.env.get("DATA_PROVIDER_API_KEY");

  const dbFallbackKey =
    provider.api_key ||
    (handlerType === "korba" ? (dbSecrets["korba_secret_key"] || dbSecrets["korba_api_key"]) : "") ||
    "";

  return {
    ...provider,
    api_key: String(envApiKey || dbFallbackKey || "").trim(),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const CRON_SECRET = (Deno.env.get("CRON_SECRET") || "").trim();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing environment credentials" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // 1. Auth Guard: Require SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, or verified Admin session
  const authHeader = req.headers.get("Authorization");
  const userToken = req.headers.get("x-user-access-token");
  const cronSecretHeader = req.headers.get("x-cron-secret")?.trim();
  const token = (userToken || authHeader?.replace(/^Bearer\s+/i, "") || "").trim();

  const isServiceRole = Boolean(SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY.trim());
  const isCronSecret = Boolean(CRON_SECRET && (token === CRON_SECRET || cronSecretHeader === CRON_SECRET));

  if (!isServiceRole && !isCronSecret) {
    const authResult = await verifyAdmin(req, supabaseAdmin);
    if (!authResult.success) {
      return new Response(JSON.stringify({ error: authResult.error || "Unauthorized" }), {
        status: authResult.status || 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    console.log("[cron-auto-retry] Running hybrid self-healing background worker...");

    const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const excludedTypes = "(wallet_topup,store_wallet_topup,agent_activation,sub_agent_activation,vendor_activation,free_data_claim)";

    // 1. Find stuck paid orders (not yet processed)
    const { data: stuckPaidOrders } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("status", "paid")
      .not("order_type", "in", excludedTypes)
      .lte("created_at", oneMinuteAgo)
      .gte("created_at", twoDaysAgo)
      .limit(25);

    // 1b. Find pending or paid MTN Mash Up orders needing auto-routing
    const { data: stuckMashUpOrders } = await supabaseAdmin
      .from("orders")
      .select("*")
      .or("network.eq.MTN Mash Up,network.ilike.%MASH%,network.eq.MTN_COMBO,metadata->>category.eq.mashup")
      .in("status", ["pending", "paid"])
      .not("order_type", "in", excludedTypes)
      .gte("created_at", twoDaysAgo)
      .limit(25);

    // 2. Find stuck undispatched processing orders (no provider_id or no provider_order_id assigned, or marked timeout/failed_api_call/duplicate_cooldown)
    const { data: undispatchedOrders } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("status", "processing")
      .or("provider_id.is.null,provider_order_id.is.null,provider_order_id.eq.timeout,provider_order_id.eq.failed_api_call,provider_order_id.eq.duplicate_cooldown")
      .not("order_type", "in", excludedTypes)
      .lte("created_at", oneMinuteAgo)
      .gte("created_at", twoDaysAgo)
      .limit(25);

    // 3. Find failed or refunded orders whose failure_reason indicates No Provider, refund, or retryable provider failure
    const { data: noProviderOrders } = await supabaseAdmin
      .from("orders")
      .select("*")
      .in("status", ["fulfillment_failed", "failed", "refunded"])
      .not("order_type", "in", excludedTypes)
      .or("failure_reason.ilike.%No provider%,failure_reason.ilike.%No active provider%,failure_reason.ilike.%No active telecom provider%,failure_reason.ilike.%Auto-retry failed%,failure_reason.ilike.%timeout%,failure_reason.ilike.%504%,failure_reason.ilike.%502%,failure_reason.ilike.%Order processing failed%,failure_reason.ilike.%Bundle not available%,failure_reason.ilike.%rejected%,failure_reason.ilike.%refund%,failure_reason.ilike.%refunded%,status.eq.refunded,provider_order_id.eq.failed_api_call,provider_order_id.eq.refunded")
      .gte("created_at", twoDaysAgo)
      .order("created_at", { ascending: false })
      .limit(35);

    // 4. Find duplicate cooldown orders that are ready to be re-routed after 60 mins
    const { data: duplicateOrders } = await supabaseAdmin
      .from("orders")
      .select("*")
      .in("status", ["processing", "paid", "fulfillment_failed"])
      .or("provider_order_id.eq.duplicate_cooldown,failure_reason.ilike.%duplicate%,failure_reason.ilike.%identical%")
      .not("order_type", "in", excludedTypes)
      .gte("created_at", twoDaysAgo)
      .order("created_at", { ascending: false })
      .limit(35);

    // Deduplicate candidate orders by ID
    const orderMap = new Map<string, any>();
    (stuckPaidOrders || []).forEach(o => orderMap.set(o.id, o));
    (stuckMashUpOrders || []).forEach(o => orderMap.set(o.id, o));
    (undispatchedOrders || []).forEach(o => orderMap.set(o.id, o));
    (noProviderOrders || []).forEach(o => orderMap.set(o.id, o));
    (duplicateOrders || []).forEach(o => orderMap.set(o.id, o));

    // Fetch Korba provider IDs to strictly prevent SME bundles from ever routing or failing over to Korba
    const { data: korbaProviders } = await supabaseAdmin
      .from("providers")
      .select("id, name, handler_type")
      .or("handler_type.eq.korba,name.ilike.%korba%");
    const korbaProviderIds = new Set<string>((korbaProviders || []).map((p: any) => String(p.id)));

    // Fetch system settings secrets as fallback only after Deno.env.get(...)
    const { data: settingsRows } = await supabaseAdmin
      .from("v_system_settings_with_secrets")
      .select("key, value")
      .in("key", ["paystack_secret_key", "korba_secret_key", "korba_client_key", "korba_api_key"]);
    const dbSecrets: Record<string, string> = {};
    (settingsRows || []).forEach((r: any) => {
      if (r?.key && r?.value) dbSecrets[String(r.key)] = String(r.value);
    });

    // Fetch global manual fulfillment mode to avoid auto-routing held orders when global API pause is active
    const { data: globalSysSettings } = await supabaseAdmin
      .from("system_settings")
      .select("manual_fulfillment_mode")
      .eq("id", 1)
      .maybeSingle();
    const isGlobalApiPaused = globalSysSettings?.manual_fulfillment_mode === true;

    // 5. Proactively poll in-transit processing orders with active provider IDs (detect refunded or delivered orders)
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data: inTransitProcessingOrders } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("status", "processing")
      .not("provider_id", "is", null)
      .not("provider_order_id", "is", null)
      .not("provider_order_id", "in", "(failed_api_call,timeout,duplicate_cooldown,manual_fulfillment_mode,paused_by_admin)")
      .not("order_type", "in", excludedTypes)
      .lte("created_at", threeMinutesAgo)
      .gte("created_at", twoDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20);

    if (inTransitProcessingOrders && inTransitProcessingOrders.length > 0) {
      console.log(`[cron-auto-retry] Checking live provider status for ${inTransitProcessingOrders.length} in-transit processing orders...`);
      for (const pOrder of inTransitProcessingOrders) {
        try {
          const { data: prov } = await supabaseAdmin
            .from("providers")
            .select("*")
            .eq("id", pOrder.provider_id)
            .maybeSingle();

          if (!prov || !prov.is_active) continue;

          const isKorbaProv = String(prov.handler_type || "").toLowerCase() === "korba" || korbaProviderIds.has(String(prov.id));
          if (isKorbaProv && isSmeDataBundle(pOrder)) {
            console.warn(`[cron-auto-retry] Guard: SME bundle ${pOrder.id} (${pOrder.network} ${pOrder.package_size}) cannot be fulfilled by Korba. Re-routing to SME aggregator...`);
            const prevFailed = Array.isArray(pOrder.metadata?.failed_provider_ids) ? pOrder.metadata.failed_provider_ids : [];
            const updatedFailedIds = Array.from(new Set([...prevFailed, prov.id, ...Array.from(korbaProviderIds)]));
            pOrder.provider_id = null;
            pOrder.provider_order_id = null;
            pOrder.status = "fulfillment_failed";
            pOrder.failure_reason = "SME bundle excluded from Korba; re-routing to SME provider";
            pOrder.metadata = {
              ...(pOrder.metadata || {}),
              exclude_korba: true,
              failed_provider_ids: updatedFailedIds,
            };
            await supabaseAdmin.from("orders").update({
              status: "fulfillment_failed",
              provider_id: null,
              provider_order_id: null,
              failure_reason: pOrder.failure_reason,
              metadata: pOrder.metadata,
              updated_at: new Date().toISOString(),
            }).eq("id", pOrder.id);
            orderMap.set(pOrder.id, pOrder);
            continue;
          }

          const resolvedProv = resolveProviderWithEnvSecrets(prov, dbSecrets);
          const adapter = getProviderAdapter(resolvedProv.handler_type || "standard");
          const activeOrderId = pOrder.provider_order_id || pOrder.id;
          const statusRes = await adapter.checkStatus(supabaseAdmin, resolvedProv, activeOrderId, pOrder.id);
          const rawStatus = String(statusRes?.status || "").toLowerCase().trim();

          const isDelivered = rawStatus === "delivered" || rawStatus === "successful" || rawStatus === "completed" || rawStatus === "fulfilled" || rawStatus === "000";
          // ANTI-DOUBLE-DATA: only an EXPLICIT provider failure/refund may trigger failover.
          // For MTN Express / BundleZone: `submission_unknown` and `failed_pending_refund` (where `refunded: false`)
          // MUST remain in processing until `refunded: true` is confirmed.
          const isPendingRefund = rawStatus === "failed_pending_refund" || rawStatus === "submission_unknown";
          const isBundleZoneProv = String(resolvedProv.handler_type || "").toLowerCase() === "bundlezone";
          const isRefundedOrFailed = !isPendingRefund && (
            rawStatus === "refunded" ||
            rawStatus === "reversed" ||
            rawStatus === "fulfillment_failed" ||
            (!isBundleZoneProv && (rawStatus === "failed" || rawStatus === "rejected" || rawStatus === "cancelled" || rawStatus === "declined"))
          );
          if (!isDelivered && !isRefundedOrFailed) {
            console.log(`[cron-auto-retry] In-transit order ${pOrder.id} status inconclusive/pending settlement at ${prov.name} (${rawStatus || "unknown"}: ${statusRes?.reason || ""}). Leaving in processing - NOT re-routing.`);
          }

          if (isDelivered) {
            console.log(`[cron-auto-retry] In-transit order ${pOrder.id} confirmed FULFILLED by ${prov.name}`);
            await supabaseAdmin.from("orders").update({
              status: "fulfilled",
              failure_reason: null,
              provider_response: statusRes.raw || statusRes,
              updated_at: new Date().toISOString()
            }).eq("id", pOrder.id);
            await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: pOrder.id })).catch(() => {});
          } else if (isRefundedOrFailed) {
            const failReason = statusRes.reason || (rawStatus === "refunded" ? "Provider refunded order" : "Provider rejected order");
            console.warn(`[cron-auto-retry] In-transit order ${pOrder.id} REFUNDED/FAILED at ${prov.name} (${rawStatus}). Enqueuing for immediate failover to verified provider...`);

            await Promise.resolve(supabaseAdmin.from("provider_errors").insert({
              provider_id: prov.id,
              order_id: pOrder.id,
              error_message: failReason,
            })).catch(() => {});

            const prevFailed = Array.isArray(pOrder.metadata?.failed_provider_ids) ? pOrder.metadata.failed_provider_ids : [];
            const korbaExclusions = isSmeDataBundle(pOrder) ? Array.from(korbaProviderIds) : [];
            const updatedFailedIds = Array.from(new Set([...prevFailed, prov.id, ...korbaExclusions]));

            pOrder.provider_order_id = null;
            pOrder.status = "fulfillment_failed";
            pOrder.failure_reason = failReason;
            pOrder.metadata = {
              ...(pOrder.metadata || {}),
              ...(isSmeDataBundle(pOrder) ? { exclude_korba: true } : {}),
              failed_provider_ids: updatedFailedIds,
              previous_provider: prov.name,
              last_refund_reason: failReason,
              last_refund_at: new Date().toISOString(),
            };

            await supabaseAdmin.from("orders").update({
              status: "fulfillment_failed",
              provider_order_id: null,
              failure_reason: failReason,
              metadata: pOrder.metadata,
              updated_at: new Date().toISOString(),
            }).eq("id", pOrder.id);

            // Queue for immediate failover dispatch in this cycle
            orderMap.set(pOrder.id, pOrder);
          }
        } catch (err: any) {
          console.warn(`[cron-auto-retry] Error checking in-transit order ${pOrder.id}:`, err?.message || err);
        }
      }
    }

    const candidateOrders = Array.from(orderMap.values());

    const results = {
      attempted: candidateOrders.length,
      fulfilled: 0,
      processing: 0,
      failed: 0,
      smsSent: 0,
    };

    for (const order of candidateOrders) {
      if (isGlobalApiPaused) {
        console.log(`[cron-auto-retry] Global API dispatch pause (manual_fulfillment_mode) is active. Skipping order ${order.id}.`);
        continue;
      }

      if (isOrderPausedFromApi(order) || order.provider_order_id === "manual_fulfillment_mode") {
        console.log(`[cron-auto-retry] Order ${order.id} is paused by admin (${order.provider_order_id || "api_paused"}). Skipping auto-retry.`);
        continue;
      }

      const currentRetry = Number(order.retry_count || 0);
      if (currentRetry >= 3) {
        console.log(`[cron-auto-retry] Order ${order.id} has reached max retries (${currentRetry}/3). Skipping.`);
        continue;
      }

      const orderType = String(order.order_type || "data").toLowerCase();
      const isTelecomOrder = !["wallet_topup", "store_wallet_topup", "agent_activation", "sub_agent_activation", "vendor_activation", "free_data_claim"].includes(orderType);

      if (!isTelecomOrder) {
        console.log(`[cron-auto-retry] Order ${order.id} is non-telecom type (${orderType}). Skipping telecom dispatch.`);
        continue;
      }

      // Duplicate Order 60-Minute Cooldown Guard:
      // If order is delayed due to duplicate order detection, ensure 60 minutes have elapsed before auto-routing!
      const isDuplicateCooldown = 
        order.provider_order_id === "duplicate_cooldown" || 
        order.metadata?.duplicate_delayed === true ||
        isDuplicateOrderError(order.failure_reason);

      if (isDuplicateCooldown) {
        const delayedUntilTime = order.metadata?.delayed_until ? new Date(order.metadata.delayed_until).getTime() : 0;
        const lastActionTime = new Date(order.last_retry_at || order.updated_at || order.created_at).getTime();
        const sixtyMinTime = lastActionTime + 60 * 60 * 1000;
        const effectiveReadyTime = delayedUntilTime > 0 ? delayedUntilTime : sixtyMinTime;

        if (Date.now() < effectiveReadyTime) {
          const remainingMins = Math.ceil((effectiveReadyTime - Date.now()) / (60 * 1000));
          console.log(`[cron-auto-retry] Order ${order.id} is in duplicate cooldown (${remainingMins}m remaining). Skipping until 60min expires.`);
          continue;
        }
        console.log(`[cron-auto-retry] Order ${order.id} duplicate 60-minute cooldown has EXPIRED. Proceeding to auto-route!`);
      }

      // Anti-Loss & Non-Retryable Guard: Never reprocess orders with permanent recipient errors
      // (e.g. barred number, invalid recipient, payee limit reached). Note: Duplicate orders are handled by the 60m cooldown check above.
      if (!isDuplicateCooldown && isNonRetryableTerminalError(order.failure_reason)) {
        console.log(`[cron-auto-retry] Order ${order.id} has permanent non-retryable error (${order.failure_reason}). Skipping to prevent losses.`);
        continue;
      }

      const failReason = order.failure_reason || "";
      const isExplicitProviderRejection =
        (order.status === "fulfillment_failed" || order.status === "failed") &&
        Boolean(order.provider_id) &&
        /provider rejected|carrier dispatch rejected|provider refunded|order failed|delivery failed/i.test(failReason);
      const isRefunded = /refund/i.test(failReason) || order.status === "refunded" || isExplicitProviderRejection;

      // Anti-Duplicate Delivery Shield: If order already has an active upstream provider reference
      // (e.g. SKP..., API_..., DH_..., 6adb...) that is NOT timeout, failed_api_call, duplicate_cooldown, or refunded,
      // and the provider has NOT issued an explicit refund or rejection, DO NOT re-dispatch! Doing so causes double fulfillment and financial loss!
      const hasActiveProviderRef = Boolean(
        order.provider_order_id &&
        order.provider_order_id !== "failed_api_call" &&
        order.provider_order_id !== "timeout" &&
        order.provider_order_id !== "routed" &&
        order.provider_order_id !== "duplicate_cooldown" &&
        order.provider_order_id !== "paused_by_admin" &&
        order.provider_order_id !== "manual_fulfillment_mode" &&
        order.provider_order_id !== "refunded"
      );
      if (hasActiveProviderRef && !isRefunded) {
        console.log(`[cron-auto-retry] Order ${order.id} is already in transit or completed with provider (${order.provider_order_id}) and was not refunded/rejected. Skipping re-dispatch to avoid double fulfillment.`);
        continue;
      }

      // Security guard: Never auto-fulfill orders that lack verified payment proof
      const isWalletOrder = order.payment_method === "wallet";
      const isGatewayPaid = Number(order.paystack_verified_amount || 0) > 0;
      const isPaidStatus = order.status === "paid" || order.status === "processing" || isExplicitProviderRejection;
      if (!isWalletOrder && !isGatewayPaid && !isPaidStatus) {
        console.warn(`[cron-auto-retry] Security guard: Order ${order.id} lacks verified payment proof (method: ${order.payment_method}, verified_amount: ${order.paystack_verified_amount}). Skipping.`);
        continue;
      }

      // Atomically claim the order to prevent concurrent runners from double-purchasing
      const { data: claimed, error: claimErr } = await supabaseAdmin
        .from("orders")
        .update({
          status: "processing",
          retry_count: isDuplicateCooldown ? currentRetry : (currentRetry + 1),
          last_retry_at: new Date().toISOString()
        })
        .eq("id", order.id)
        .in("status", ["paid", "processing", "fulfillment_failed", "failed", "pending"])
        .select("id")
        .maybeSingle();

      if (claimErr || !claimed) {
        console.log(`[cron-auto-retry] Order ${order.id} was already claimed or updated by another worker. Skipping.`);
        continue;
      }

      console.log(`[cron-auto-retry] Auto-healing claimed order ${order.id} (${order.network} ${order.package_size}, attempt ${currentRetry + 1}/3)...`);
      
      const smeBundle = isSmeDataBundle(order);
      const prevFailed = Array.isArray(order.metadata?.failed_provider_ids) ? order.metadata.failed_provider_ids : [];
      const baseFailedIds = order.provider_id && (isRefunded || order.status === "fulfillment_failed")
        ? [...prevFailed, order.provider_id]
        : [...prevFailed];
      if (smeBundle) {
        korbaProviderIds.forEach((kid) => baseFailedIds.push(kid));
      }
      const updatedFailedIds = Array.from(new Set(baseFailedIds));
      const safeProviderId = smeBundle && order.provider_id && korbaProviderIds.has(String(order.provider_id))
        ? null
        : order.provider_id;

      let dispatch = await dispatchOrderWithFailover(supabaseAdmin, {
        ...order,
        provider_id: safeProviderId,
        provider_order_id: null,
        metadata: {
          ...(order.metadata || {}),
          ...(smeBundle ? { exclude_korba: true } : {}),
          failed_provider_ids: updatedFailedIds,
        }
      });

      if (smeBundle && dispatch.provider_id && korbaProviderIds.has(String(dispatch.provider_id))) {
        console.error(`[cron-auto-retry] Guard blocked SME bundle ${order.id} from routing to Korba (${dispatch.provider_id}).`);
        dispatch = {
          ok: false,
          status: "fulfillment_failed",
          reason: "SME data bundle cannot be routed to Korba.",
        };
      }

      if (dispatch.status === "fulfilled") {
        await supabaseAdmin.from("orders").update({
          status: "fulfilled",
          provider_id: dispatch.provider_id || null,
          provider_order_id: dispatch.provider_order_id || null,
          failure_reason: null,
          updated_at: new Date().toISOString()
        }).eq("id", order.id);

        await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id })).catch(() => {});
        results.fulfilled++;

        // 📲 Trigger SMS Notification upon successful retry
        const rawPhone = order.customer_phone || (order.metadata as any)?.payment_phone || (order.metadata as any)?.customer_phone;
        const recipientPhone = normalizePhone(rawPhone);
        const shortId = order.id ? String(order.id).slice(0, 8).toUpperCase() : "";
        const pkgText = order.network && order.package_size ? `${order.network} ${order.package_size}` : "Bundle";

        if (recipientPhone) {
          const smsMessage = `SwiftData Alert: Order #${shortId} for ${recipientPhone} (${pkgText}) has been retried & delivered successfully! Thank you for your patience.`;
          try {
            const smsRes = await sendPaymentSms(supabaseAdmin, recipientPhone, "custom", { message: smsMessage }, order.agent_id);
            if (smsRes) {
              results.smsSent++;
              console.log(`[cron-auto-retry] Successfully sent fulfillment SMS to ${recipientPhone} for order ${order.id}`);
            }
          } catch (smsErr) {
            console.error(`[cron-auto-retry] Failed to send SMS for order ${order.id}:`, smsErr);
          }
        }

      } else if (dispatch.status === "processing") {
        await supabaseAdmin.from("orders").update({
          status: "processing",
          provider_id: dispatch.provider_id || null,
          provider_order_id: dispatch.provider_order_id || null,
          updated_at: new Date().toISOString()
        }).eq("id", order.id);
        results.processing++;
      } else {
        const isTerminal = currentRetry + 1 >= 3;
        const failReason = isTerminal
          ? `Max retries reached: ${dispatch.reason || "Unable to fulfill across providers"}`
          : (dispatch.reason || "Auto-retry failed across available providers");

        await supabaseAdmin.from("orders").update({
          status: "processing",
          provider_order_id: "failed_api_call",
          failure_reason: failReason,
          updated_at: new Date().toISOString()
        }).eq("id", order.id);
        results.failed++;
      }
    }

    if (results.attempted > 0) {
      log(supabaseAdmin, {
        level: "info",
        source: "cron-auto-retry",
        event: "self_heal.completed",
        message: `Self-heal worker processed ${results.attempted} orders (Fulfilled: ${results.fulfilled}, Processing: ${results.processing}, Failed: ${results.failed}, SMS Sent: ${results.smsSent})`,
        data: results
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Background self-healing cycle executed successfully.",
      summary: results
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[cron-auto-retry] Worker error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// Deno.cron: Run self-healing worker every 1 minute natively in Deno runtime
if (typeof (Deno as any).cron === "function") {
  (Deno as any).cron("Self Healing Auto Retry Worker", "*/1 * * * *", async () => {
    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        await fetch(`${SUPABASE_URL}/functions/v1/cron-auto-retry`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json"
          }
        }).catch(() => {});
      }
    } catch (e) {
      console.error("[cron-auto-retry] Deno.cron trigger error:", e);
    }
  });
}
