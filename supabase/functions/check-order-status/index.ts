import "../deno.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";
import { getProviderAdapter } from "../_shared/providers/registry.ts";
import { dispatchOrderWithFailover } from "../_shared/provider_router.ts";
import { isNonRetryableTerminalError } from "../_shared/providers/utils.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { normalizePhone, getSmsConfig, dispatchUnifiedSms } from "../_shared/sms.ts";

declare const Deno: any;

// Helper to scrub any internal provider names, URLs, API credentials or technical stack traces
function sanitizeForUser(text?: string | null): string {
  if (!text) return "";
  let clean = String(text);
  
  // Scrub known provider names & aliases
  const scrubPatterns = [
    /datahub(gh)?(\.com)?/gi,
    /korba(365)?(\.com)?/gi,
    /spendless(\.top)?/gi,
    /datamart(gh)?(\.shop)?/gi,
    /skdataplug/gi,
    /bossu/gi,
    /xcel/gi,
    /qhowmenzconsult/gi,
    /newaggregator/gi,
    /superbdatafy/gi,
    /ihrvvniomtoofrjkmalb(\.supabase\.co)?/gi,
    /hyspeed(data)?/gi,
    /swiftreseller/gi
  ];
  for (const pattern of scrubPatterns) {
    clean = clean.replace(pattern, "Telecom Operator");
  }

  // Scrub URLs & endpoints
  clean = clean.replace(/https?:\/\/[^\s]+/gi, "");
  // Scrub long hashes/API tokens
  clean = clean.replace(/[a-f0-9]{24,}/gi, "");
  // Scrub technical error brackets
  clean = clean.replace(/\{.*?\}|\[.*?\]/gi, "");

  return clean.trim();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json().catch(() => ({}));

    // 1. Determine caller role (Admin / Cron / Service Role vs Regular User/Guest)
    let isAdmin = false;
    let authUser: any = null;

    const authHeader = req.headers.get("Authorization");
    const userToken = req.headers.get("x-user-access-token");
    const cronSecretHeader = req.headers.get("x-cron-secret")?.trim();
    const CRON_SECRET = (Deno.env.get("CRON_SECRET") || "").trim();
    const token = (userToken || authHeader?.replace(/^Bearer\s+/i, "") || "").trim();
    const isServiceRole = Boolean(SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY.trim());
    const isCronSecret = Boolean(CRON_SECRET && (token === CRON_SECRET || cronSecretHeader === CRON_SECRET));

    if (isServiceRole || isCronSecret) {
      isAdmin = true;
    } else {
      try {
        const adminCheck = await verifyAdmin(req, supabaseAdmin);
        if (adminCheck && adminCheck.success) {
          isAdmin = true;
          authUser = adminCheck.user;
        }
      } catch {
        isAdmin = false;
      }

      if (!isAdmin && token) {
        const { data: { user } } = await Promise.resolve(supabaseAdmin.auth.getUser(token)).catch(() => ({ data: { user: null } }));
        authUser = user;
      }
    }

    // 1.5. Bulk Order Status Verification Mode (Manual order_ids or Automated 3-min Cron auto_bulk)
    const rawOrderIds = body.order_ids || body.orderIds;
    const isAutoBulk = Boolean(body.auto_bulk === true || (isAdmin && !Array.isArray(rawOrderIds) && !body.order_id && !body.reference && !body.orderId));

    if ((Array.isArray(rawOrderIds) && rawOrderIds.length > 0) || isAutoBulk) {
      let orders: any[] = [];

      if (isAutoBulk) {
        if (!isAdmin && !authUser) {
          return new Response(JSON.stringify({ error: "Unauthorized access to automated bulk order status check" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const batchLimit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);
        const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const excludedTypes = "(wallet_topup,store_wallet_topup,agent_activation,sub_agent_activation,vendor_activation,free_data_claim)";

        let autoQuery = supabaseAdmin
          .from("orders")
          .select("*")
          .eq("status", "processing")
          .not("provider_id", "is", null)
          .not("order_type", "in", excludedTypes)
          .gte("created_at", twoDaysAgo)
          .order("updated_at", { ascending: true })
          .limit(batchLimit);

        if (!isAdmin && authUser) {
          autoQuery = autoQuery.or(`agent_id.eq.${authUser.id},customer_id.eq.${authUser.id}`);
        }

        const { data: autoOrders, error: autoErr } = await autoQuery;
        if (autoErr) {
          return new Response(JSON.stringify({ error: "Failed to query processing orders", details: autoErr.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        orders = autoOrders || [];

        if (orders.length === 0) {
          return new Response(JSON.stringify({
            success: true,
            auto_bulk: true,
            is_admin: isAdmin,
            summary: {
              total: 0,
              fulfilled: 0,
              failed: 0,
              processing: 0,
              unchanged: 0,
              errors: 0,
              updated: 0,
            },
            results: [],
            last_checked_at: new Date().toISOString(),
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        const orderIds = Array.from(new Set(rawOrderIds.map((id: any) => String(id || "").trim()).filter(Boolean))).slice(0, 100);

        if (orderIds.length === 0) {
          return new Response(JSON.stringify({ error: "No valid order IDs provided" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: fetchedOrders, error: ordersErr } = await supabaseAdmin
          .from("orders")
          .select("*")
          .in("id", orderIds);

        if (ordersErr || !fetchedOrders || fetchedOrders.length === 0) {
          return new Response(JSON.stringify({ error: "No matching orders found", details: ordersErr?.message }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        orders = fetchedOrders;
      }

      // Permission Check: Non-admins can only check their own orders
      let targetOrders = orders;
      if (!isAdmin) {
        if (!authUser) {
          return new Response(JSON.stringify({ error: "Unauthorized access to bulk order status" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        targetOrders = orders.filter((o: any) => (o.agent_id === authUser.id) || (o.customer_id === authUser.id));
        if (targetOrders.length === 0) {
          return new Response(JSON.stringify({ error: "Unauthorized access to requested orders" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Preload active providers (prioritizing environment secrets first per AGENTS.md)
      const { data: provList } = await supabaseAdmin.from("providers").select("*");
      const providerMap = new Map<string, any>((provList || []).map((p: any) => {
        const handlerType = String(p.handler_type || "standard").toLowerCase();
        const envKey =
          (handlerType === "hyspeeddata" || handlerType === "swiftreseller" || handlerType === "hyspeed") ? (Deno.env.get("HYSPEEDDATA_API_KEY") || Deno.env.get("SWIFTRESELLER_API_KEY")) :
          handlerType === "bundlezone" ? Deno.env.get("BUNDLEZONE_API_KEY") :
          handlerType === "datahub" ? Deno.env.get("DATAHUB_API_KEY") :
          handlerType === "datamart" ? Deno.env.get("DATAMART_API_KEY") :
          handlerType === "spendless" ? Deno.env.get("SPENDLESS_API_KEY") :
          handlerType === "skdataplug" ? Deno.env.get("SKDATAPLUG_API_KEY") :
          handlerType === "qhowmenzconsult" ? Deno.env.get("QHOWMENZ_API_KEY") :
          handlerType === "korba" ? (Deno.env.get("KORBA_SECRET_KEY") || Deno.env.get("KORBA_API_KEY")) :
          Deno.env.get("DATA_PROVIDER_API_KEY");
        return [String(p.id), { ...p, api_key: String(envKey || p.api_key || "").trim() }];
      }));

      let fulfilledCount = 0;
      let failedCount = 0;
      let processingCount = 0;
      let unchangedCount = 0;
      let errorCount = 0;
      const results: any[] = [];

      const BATCH_SIZE = 10;
      for (let i = 0; i < targetOrders.length; i += BATCH_SIZE) {
        const batch = targetOrders.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (order: any) => {
          let currentStatus = order.status;
          let currentFailureReason = order.failure_reason;
          let providerInfo: any = order.provider_id ? providerMap.get(String(order.provider_id)) : null;
          let liveProviderResult: any = null;
          let rawStatus = "";
          let wasUpdated = false;

          try {
            if (currentStatus === "fulfilled") {
              fulfilledCount++;
              unchangedCount++;
              rawStatus = "delivered";
            } else if (currentStatus === "refunded") {
              unchangedCount++;
              rawStatus = "refunded";
            } else if (!providerInfo) {
              if (currentStatus === "processing") processingCount++;
              else unchangedCount++;
              rawStatus = currentStatus;
            } else {
              const adapter = getProviderAdapter(providerInfo.handler_type);
              const activeOrderId = order.provider_order_id || order.id;

              console.log(`[check-order-status-bulk] Checking ${providerInfo.name} for order ${order.id} (tx: ${activeOrderId})...`);
              const pRes = await adapter.checkStatus(
                supabaseAdmin,
                providerInfo,
                activeOrderId,
                order.id
              );

              liveProviderResult = pRes;
              rawStatus = String(pRes?.status || "").toLowerCase().trim();

              const isDelivered = rawStatus === "delivered" || rawStatus === "successful" || rawStatus === "completed" || rawStatus === "fulfilled" || rawStatus === "000";
              const isPendingRefund = rawStatus === "failed_pending_refund" || rawStatus === "submission_unknown";
              const isRefunded = !isPendingRefund && (rawStatus === "refunded" || rawStatus === "reversed" || /refund/i.test(String(pRes?.reason || "")));
              // Only explicit conclusive provider failures count as isFailed.
              // Inconclusive checks (404, not_found, submission_unknown, failed_pending_refund, or pRes?.ok === false) must remain in 'processing' without triggering duplicate auto-failover!
              const isFailed = !isPendingRefund && (rawStatus === "failed" || rawStatus === "rejected" || rawStatus === "cancelled" || rawStatus === "declined" || isRefunded);

              const hasActiveProviderRef = Boolean(
                order.provider_order_id &&
                order.provider_order_id !== "failed_api_call" &&
                order.provider_order_id !== "timeout" &&
                order.provider_order_id !== "routed" &&
                order.provider_order_id !== "duplicate_cooldown" &&
                order.provider_order_id !== "refunded"
              );

              if (isDelivered) {
                currentStatus = "fulfilled";
                currentFailureReason = null;
                fulfilledCount++;
                wasUpdated = order.status !== "fulfilled";

                if (order.status !== "fulfilled") {
                  await supabaseAdmin.from("orders").update({
                    status: "fulfilled",
                    failure_reason: null,
                    provider_response: pRes.raw || pRes,
                    updated_at: new Date().toISOString()
                  }).eq("id", order.id);

                  await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id })).catch(() => {});
                  console.log(`[check-order-status-bulk] Order ${order.id} marked FULFILLED.`);
                }
              } else if (isFailed) {
                currentFailureReason = pRes.reason || (isRefunded ? "Provider refunded order" : "Carrier dispatch rejected");
                const isPaid = order.payment_method === "wallet" || Number(order.paystack_verified_amount || 0) > 0 || order.status === "processing" || order.status === "paid" || (order.status === "fulfillment_failed" && Boolean(order.provider_id));
                const isTelecomOrder = !["wallet_topup", "store_wallet_topup", "agent_activation", "sub_agent_activation", "vendor_activation", "free_data_claim"].includes(String(order.order_type || "data").toLowerCase());
                const isTerminal = isNonRetryableTerminalError(currentFailureReason);

                // Automatic Failover on Conclusive Provider Rejection/Refund:
                // Note: `isFailed` already excludes `failed_pending_refund`, `submission_unknown`, `not_found`, and transport errors.
                // When a provider (e.g. DataMart) conclusively rejects/fails an accepted order, immediately route it to the next available active provider (e.g. BundleZone).
                const canAutoFailover = isPaid && !order.auto_refunded && isTelecomOrder && (order.retry_count || 0) < 5 && !isTerminal;

                if (canAutoFailover) {
                  console.log(`[check-order-status-bulk] Order ${order.id} refunded/failed at ${providerInfo.name} (${rawStatus}). Initiating auto-failover to verified API provider...`);
                  
                  await Promise.resolve(supabaseAdmin.from("provider_errors").insert({
                    provider_id: providerInfo.id,
                    order_id: order.id,
                    error_message: currentFailureReason,
                  })).catch(() => {});

                  const prevFailed = Array.isArray(order.metadata?.failed_provider_ids) ? order.metadata.failed_provider_ids : [];
                  const updatedFailedIds = Array.from(new Set([...prevFailed, providerInfo.id]));

                  const failoverDispatch = await dispatchOrderWithFailover(supabaseAdmin, {
                    ...order,
                    provider_id: providerInfo.id,
                    provider_order_id: null,
                    status: "processing",
                    failure_reason: currentFailureReason,
                    metadata: {
                      ...(order.metadata || {}),
                      failed_provider_ids: updatedFailedIds,
                      previous_provider: providerInfo.name,
                      last_refund_reason: currentFailureReason,
                      last_refund_at: new Date().toISOString(),
                    }
                  });

                  if (failoverDispatch.ok) {
                    currentStatus = failoverDispatch.status;
                    currentFailureReason = null;
                    wasUpdated = true;
                    if (failoverDispatch.provider_id) {
                      providerInfo = providerMap.get(String(failoverDispatch.provider_id)) || providerInfo;
                    }
                    if (failoverDispatch.status === "fulfilled") fulfilledCount++;
                    else processingCount++;
                    await supabaseAdmin.from("orders").update({
                      status: failoverDispatch.status,
                      provider_id: failoverDispatch.provider_id,
                      provider_order_id: failoverDispatch.provider_order_id,
                      failure_reason: null,
                      last_retry_at: new Date().toISOString(),
                      retry_count: (order.retry_count || 0) + 1,
                      metadata: {
                        ...(order.metadata || {}),
                        failed_provider_ids: updatedFailedIds,
                        auto_routed_from: order.provider_id,
                        auto_routed_at: new Date().toISOString(),
                      },
                      updated_at: new Date().toISOString(),
                    }).eq("id", order.id);
                    if (failoverDispatch.status === "fulfilled") {
                      await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id })).catch(() => {});
                    }
                    console.log(`[check-order-status-bulk] Auto-failover SUCCESS for rejected/refunded order ${order.id} -> ${failoverDispatch.provider_id} (${failoverDispatch.status})`);
                  } else {
                    currentStatus = "fulfillment_failed";
                    failedCount++;
                    const normalizedFailureReason = String(currentFailureReason || "Order fulfillment failed").replace(/^Route not found/i, "Order not found on provider");
                    await supabaseAdmin.from("orders").update({
                      status: "fulfillment_failed",
                      provider_order_id: "failed_api_call",
                      failure_reason: `${normalizedFailureReason} (Auto-failover: ${failoverDispatch.reason || "no other provider available"})`,
                      provider_response: pRes.raw || pRes,
                      metadata: {
                        ...(order.metadata || {}),
                        failed_provider_ids: updatedFailedIds,
                      },
                      updated_at: new Date().toISOString()
                    }).eq("id", order.id);
                  }
                } else {
                  currentStatus = "fulfillment_failed";
                  failedCount++;
                  wasUpdated = order.status !== "fulfillment_failed";
                  if (order.status !== "fulfillment_failed") {
                    await supabaseAdmin.from("orders").update({
                      status: "fulfillment_failed",
                      provider_order_id: "failed_api_call",
                      failure_reason: currentFailureReason,
                      provider_response: pRes.raw || pRes,
                      updated_at: new Date().toISOString()
                    }).eq("id", order.id);
                    console.log(`[check-order-status-bulk] Order ${order.id} marked FAILED (${currentFailureReason}).`);
                  }
                }
              } else {
                processingCount++;
                if (pRes.raw || pRes.id) {
                  await supabaseAdmin.from("orders").update({
                    provider_response: pRes.raw || pRes,
                    updated_at: new Date().toISOString()
                  }).eq("id", order.id);
                }
              }
            }
          } catch (itemErr: any) {
            errorCount++;
            console.warn(`[check-order-status-bulk] Error checking order ${order.id}:`, itemErr?.message || itemErr);
          }

          results.push({
            id: order.id,
            network: order.network,
            package_size: order.package_size,
            customer_phone: order.customer_phone,
            previous_status: order.status,
            status: currentStatus,
            updated: wasUpdated,
            provider_name: isAdmin ? (providerInfo?.name || null) : undefined,
            raw_status: rawStatus || currentStatus,
            failure_reason: isAdmin ? currentFailureReason : sanitizeForUser(currentFailureReason)
          });
        }));
      }

      return new Response(JSON.stringify({
        success: true,
        is_admin: isAdmin,
        summary: {
          total: targetOrders.length,
          fulfilled: fulfilledCount,
          failed: failedCount,
          processing: processingCount,
          unchanged: unchangedCount,
          errors: errorCount,
          updated: results.filter(r => r.updated).length
        },
        results,
        last_checked_at: new Date().toISOString(),
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetReference = String(body.order_id || body.reference || body.orderId || "").trim();

    if (!targetReference) {
      return new Response(JSON.stringify({ error: "Missing order_id, order_ids, or reference parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch the target order
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetReference);
    let order: any = null;

    if (isUuid) {
      const { data } = await supabaseAdmin
        .from("orders")
        .select("*")
        .eq("id", targetReference)
        .maybeSingle();
      order = data;
    }

    if (!order) {
      const { data } = await supabaseAdmin
        .from("orders")
        .select("*")
        .eq("metadata->>client_reference", targetReference)
        .maybeSingle();
      order = data;
    }

    if (!order && isAdmin) {
      const { data } = await supabaseAdmin
        .from("orders")
        .select("*")
        .eq("provider_order_id", targetReference)
        .maybeSingle();
      order = data;
    }

    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. User Permission Check (If not admin, must own order or hold matching reference)
    if (!isAdmin && authUser) {
      const ownsOrder = (order.agent_id === authUser.id) || (order.customer_id === authUser.id);
      if (!ownsOrder && !isUuid) {
        return new Response(JSON.stringify({ error: "Unauthorized access to order" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let currentStatus = order.status;
    let currentFailureReason = order.failure_reason;
    let carrierStatusDesc = "Order registered";
    let providerInfo: any = null;
    let liveProviderResult: any = null;

    // 4. Handle Terminal States
    if (currentStatus === "fulfilled") {
      carrierStatusDesc = "Delivered successfully to recipient line";
    } else if (currentStatus === "refunded") {
      carrierStatusDesc = "Order refunded";
    } else if (currentStatus === "pending" || currentStatus === "not_paid" || currentStatus === "awaiting_payment") {
      carrierStatusDesc = "Awaiting payment confirmation";
    } else {
      // 5. Query Upstream Provider if order has entered a provider
      if (order.provider_id) {
        const { data: prov } = await supabaseAdmin
          .from("providers")
          .select("*")
          .eq("id", order.provider_id)
          .maybeSingle();
        if (prov) {
          const handlerType = String(prov.handler_type || "standard").toLowerCase();
          const envKey =
            (handlerType === "hyspeeddata" || handlerType === "swiftreseller" || handlerType === "hyspeed") ? (Deno.env.get("HYSPEEDDATA_API_KEY") || Deno.env.get("SWIFTRESELLER_API_KEY")) :
            handlerType === "bundlezone" ? Deno.env.get("BUNDLEZONE_API_KEY") :
            handlerType === "datahub" ? Deno.env.get("DATAHUB_API_KEY") :
            handlerType === "datamart" ? Deno.env.get("DATAMART_API_KEY") :
            handlerType === "spendless" ? Deno.env.get("SPENDLESS_API_KEY") :
            handlerType === "skdataplug" ? Deno.env.get("SKDATAPLUG_API_KEY") :
            handlerType === "qhowmenzconsult" ? Deno.env.get("QHOWMENZ_API_KEY") :
            handlerType === "korba" ? (Deno.env.get("KORBA_SECRET_KEY") || Deno.env.get("KORBA_API_KEY")) :
            Deno.env.get("DATA_PROVIDER_API_KEY");
          providerInfo = { ...prov, api_key: String(envKey || prov.api_key || "").trim() };
        }
      }

      if (providerInfo) {
        try {
          const adapter = getProviderAdapter(providerInfo.handler_type);
          const activeOrderId = order.provider_order_id || order.id;

          console.log(`[check-order-status] Polling provider ${providerInfo.name} (${providerInfo.handler_type}) for order ${order.id} (tx: ${activeOrderId})...`);
          
          const pRes = await adapter.checkStatus(
            supabaseAdmin,
            providerInfo,
            activeOrderId,
            order.id
          );

          liveProviderResult = pRes;
          const rawStatus = String(pRes?.status || "").toLowerCase().trim();

          const isDelivered = rawStatus === "delivered" || rawStatus === "successful" || rawStatus === "completed" || rawStatus === "fulfilled" || rawStatus === "000";
          const isPendingRefund = rawStatus === "failed_pending_refund" || rawStatus === "submission_unknown";
          const isRefunded = !isPendingRefund && (rawStatus === "refunded" || rawStatus === "reversed" || /refund/i.test(String(pRes?.reason || "")));
          // Only explicit conclusive provider failures count as isFailed.
          // Inconclusive checks (404, not_found, submission_unknown, failed_pending_refund, or pRes?.ok === false) must remain in 'processing' without triggering duplicate auto-failover!
          const isFailed = !isPendingRefund && (rawStatus === "failed" || rawStatus === "rejected" || rawStatus === "cancelled" || rawStatus === "declined" || isRefunded);

          const hasActiveProviderRef = Boolean(
            order.provider_order_id &&
            order.provider_order_id !== "failed_api_call" &&
            order.provider_order_id !== "timeout" &&
            order.provider_order_id !== "routed" &&
            order.provider_order_id !== "duplicate_cooldown" &&
            order.provider_order_id !== "refunded"
          );

          if (isDelivered) {
            currentStatus = "fulfilled";
            currentFailureReason = null;
            carrierStatusDesc = "Delivered successfully to recipient line";

            if (order.status !== "fulfilled") {
              await supabaseAdmin.from("orders").update({
                status: "fulfilled",
                failure_reason: null,
                provider_response: pRes.raw || pRes,
                updated_at: new Date().toISOString()
              }).eq("id", order.id);

              // Idempotently credit agent profits
              await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id })).catch(() => {});

              console.log(`[check-order-status] Order ${order.id} transitioned to FULFILLED via live provider check.`);
            }
          } else if (isFailed) {
            currentFailureReason = pRes.reason || (isRefunded ? "Provider refunded order" : "Carrier dispatch rejected");
            carrierStatusDesc = isRefunded ? "Provider refunded order" : "Carrier rejected dispatch";

            const isPaid = order.payment_method === "wallet" || Number(order.paystack_verified_amount || 0) > 0 || order.status === "processing" || order.status === "paid" || (order.status === "fulfillment_failed" && Boolean(order.provider_id));
            const isTelecomOrder = !["wallet_topup", "store_wallet_topup", "agent_activation", "sub_agent_activation", "vendor_activation", "free_data_claim"].includes(String(order.order_type || "data").toLowerCase());
            const isTerminal = isNonRetryableTerminalError(currentFailureReason);

            // Automatic Failover on Conclusive Provider Rejection/Refund:
            // Note: `isFailed` already excludes `failed_pending_refund`, `submission_unknown`, `not_found`, and transport errors.
            const canAutoFailover = isPaid && !order.auto_refunded && isTelecomOrder && (order.retry_count || 0) < 5 && !isTerminal;

            if (canAutoFailover) {
              console.log(`[check-order-status] Order ${order.id} refunded/failed at ${providerInfo.name} (${rawStatus}). Initiating auto-failover to verified API provider...`);
              
              await Promise.resolve(supabaseAdmin.from("provider_errors").insert({
                provider_id: providerInfo.id,
                order_id: order.id,
                error_message: currentFailureReason,
              })).catch(() => {});

              const prevFailed = Array.isArray(order.metadata?.failed_provider_ids) ? order.metadata.failed_provider_ids : [];
              const updatedFailedIds = Array.from(new Set([...prevFailed, providerInfo.id]));

              const failoverDispatch = await dispatchOrderWithFailover(supabaseAdmin, {
                ...order,
                provider_id: providerInfo.id,
                provider_order_id: null,
                status: "processing",
                failure_reason: currentFailureReason,
                metadata: {
                  ...(order.metadata || {}),
                  failed_provider_ids: updatedFailedIds,
                  previous_provider: providerInfo.name,
                  last_refund_reason: currentFailureReason,
                  last_refund_at: new Date().toISOString(),
                }
              });

              if (failoverDispatch.ok) {
                currentStatus = failoverDispatch.status;
                currentFailureReason = null;
                carrierStatusDesc = failoverDispatch.status === "fulfilled" ? "Delivered successfully via verified carrier" : "Routed to verified carrier — active in processing";
                await supabaseAdmin.from("orders").update({
                  status: failoverDispatch.status,
                  provider_id: failoverDispatch.provider_id,
                  provider_order_id: failoverDispatch.provider_order_id,
                  failure_reason: null,
                  last_retry_at: new Date().toISOString(),
                  retry_count: (order.retry_count || 0) + 1,
                  metadata: {
                    ...(order.metadata || {}),
                    failed_provider_ids: updatedFailedIds,
                    auto_routed_from: providerInfo.name,
                    auto_routed_at: new Date().toISOString(),
                  },
                  updated_at: new Date().toISOString(),
                }).eq("id", order.id);
                if (failoverDispatch.provider_id) {
                  const { data: newProv } = await supabaseAdmin.from("providers").select("*").eq("id", failoverDispatch.provider_id).maybeSingle();
                  if (newProv) providerInfo = newProv;
                }
                if (failoverDispatch.status === "fulfilled") {
                  await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id })).catch(() => {});
                }
                console.log(`[check-order-status] Auto-failover SUCCESS for rejected/refunded order ${order.id} -> ${failoverDispatch.provider_id} (${failoverDispatch.status})`);
              } else {
                currentStatus = "fulfillment_failed";
                const normalizedFailureReason = String(currentFailureReason || "Order fulfillment failed").replace(/^Route not found/i, "Order not found on provider");
                await supabaseAdmin.from("orders").update({
                  status: "fulfillment_failed",
                  provider_order_id: "failed_api_call",
                  failure_reason: `${normalizedFailureReason} (Auto-failover: ${failoverDispatch.reason || "no other provider available"})`,
                  provider_response: pRes.raw || pRes,
                  metadata: {
                    ...(order.metadata || {}),
                    failed_provider_ids: updatedFailedIds,
                  },
                  updated_at: new Date().toISOString()
                }).eq("id", order.id);
              }
            } else {
              currentStatus = "fulfillment_failed";
              if (order.status !== "fulfillment_failed") {
                await supabaseAdmin.from("orders").update({
                  status: "fulfillment_failed",
                  provider_order_id: "failed_api_call",
                  failure_reason: currentFailureReason,
                  provider_response: pRes.raw || pRes,
                  updated_at: new Date().toISOString()
                }).eq("id", order.id);
                console.log(`[check-order-status] Order ${order.id} transitioned to FULFILLMENT_FAILED via live provider check.`);
              }
            }
          } else {
            carrierStatusDesc = "Transmitting to carrier network — active in processing";
            // Persist latest live polling response into metadata/provider_response
            if (pRes.raw || pRes.id) {
              await supabaseAdmin.from("orders").update({
                provider_response: pRes.raw || pRes,
                updated_at: new Date().toISOString()
              }).eq("id", order.id);
            }
          }
        } catch (provErr: any) {
          console.warn(`[check-order-status] Error querying provider status:`, provErr?.message || provErr);
          carrierStatusDesc = "Awaiting live carrier update";
        }
      } else {
        carrierStatusDesc = "Queued for carrier dispatch";
      }
    }

    // 6. Send Live Status SMS to user with WhatsApp Channel & Support Number
    let smsSent = false;
    const shouldSendSms = body.send_sms !== false && !isAdmin;

    if (shouldSendSms || (isAdmin && body.send_sms === true)) {
      try {
        const rawTargetPhone = order.customer_phone || (authUser?.phone);
        const targetPhone = normalizePhone(rawTargetPhone);

        if (targetPhone) {
          const { data: settings } = await supabaseAdmin
            .from("system_settings")
            .select("customer_service_number, support_channel_link")
            .eq("id", 1)
            .maybeSingle();

          const supportNumber = (settings?.customer_service_number || "0598170947").trim();
          const channelLink = (settings?.support_channel_link || "https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40").trim();

          const netLabel = (order.network || "Bundle").toUpperCase();
          const sizeLabel = order.package_size || "";
          const phoneLabel = order.customer_phone || targetPhone;

          let statusText = "is PROCESSING with carrier";
          if (currentStatus === "fulfilled") {
            statusText = "is DELIVERED";
          } else if (currentStatus === "fulfillment_failed") {
            statusText = "could not be delivered";
          } else if (currentStatus === "refunded") {
            statusText = "has been REFUNDED";
          }

          // Strict GSM-7 clean message (< 160 characters, single SMS credit)
          const smsBody = `SwiftData Update: Your ${netLabel} ${sizeLabel} to ${phoneLabel} ${statusText}. Channel: ${channelLink} | Support: ${supportNumber}`;

          const smsConfig = await getSmsConfig(supabaseAdmin);
          const effectiveGateway = (smsConfig?.gateway || "txtconnect").toLowerCase().trim();
          const resolvedSenderId = effectiveGateway === "txtconnect" ? "SwiftDataGh" : (smsConfig?.senderId || "SwiftDataGh");

          if (smsConfig?.apiKey) {
            const smsRes = await dispatchUnifiedSms(
              effectiveGateway,
              smsConfig.apiKey,
              resolvedSenderId,
              targetPhone,
              smsBody,
              "order_status_check"
            );
            if (smsRes && smsRes.success !== false) {
              smsSent = true;
              console.log(`[check-order-status] Status SMS dispatched to ${targetPhone} for order ${order.id}`);
            }
          }
        }
      } catch (smsErr: any) {
        console.warn(`[check-order-status] SMS dispatch error for order ${order.id}:`, smsErr?.message || smsErr);
      }
    }

    // 7. User vs Admin Response Formatting
    // =========================================================================
    // CRITICAL SECURITY ENFORCEMENT: NEVER REVEAL THE PROVIDER TO USERS!
    // =========================================================================
    if (!isAdmin) {
      let userFriendlyMessage = "Order status verified with network.";
      if (currentStatus === "fulfilled") {
        userFriendlyMessage = "Success! Data bundle delivered successfully to your recipient number.";
      } else if (currentStatus === "processing") {
        userFriendlyMessage = "Your order is actively being transmitted across the carrier network. Delivery completes in seconds.";
      } else if (currentStatus === "fulfillment_failed") {
        userFriendlyMessage = sanitizeForUser(currentFailureReason) || "Delivery could not be completed by carrier.";
      } else if (currentStatus === "refunded") {
        userFriendlyMessage = "Your order was refunded. Funds have been returned safely.";
      }

      return new Response(JSON.stringify({
        success: true,
        is_admin: false,
        order: {
          id: order.id,
          status: currentStatus,
          network: order.network,
          package_size: order.package_size,
          customer_phone: order.customer_phone,
          amount: Number(order.amount || 0),
          order_type: order.order_type,
          created_at: order.created_at,
          updated_at: order.updated_at,
          carrier_status: carrierStatusDesc,
          failure_reason: sanitizeForUser(currentFailureReason),
        },
        message: userFriendlyMessage,
        sms_sent: smsSent,
        last_checked_at: new Date().toISOString(),
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin Response (Full Technical Disclosure)
    return new Response(JSON.stringify({
      success: true,
      is_admin: true,
      order: {
        id: order.id,
        status: currentStatus,
        network: order.network,
        package_size: order.package_size,
        customer_phone: order.customer_phone,
        amount: Number(order.amount || 0),
        profit: Number(order.profit || 0),
        order_type: order.order_type,
        created_at: order.created_at,
        updated_at: order.updated_at,
        carrier_status: carrierStatusDesc,
        failure_reason: currentFailureReason,
      },
      provider: providerInfo ? {
        id: providerInfo.id,
        name: providerInfo.name,
        handler_type: providerInfo.handler_type,
        provider_order_id: order.provider_order_id,
        raw_status: liveProviderResult?.status,
        raw_response: liveProviderResult?.raw || liveProviderResult?.reason || liveProviderResult || null,
      } : null,
      message: providerInfo 
        ? `Live status verified with ${providerInfo.name}: ${liveProviderResult?.status || currentStatus}`
        : "Order is not currently assigned to a provider.",
      sms_sent: smsSent,
      last_checked_at: new Date().toISOString(),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[check-order-status] Execution error:", err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
