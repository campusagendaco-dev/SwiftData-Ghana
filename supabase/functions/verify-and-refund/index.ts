import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { StandardAdapter } from "../_shared/providers/standard.ts";
import { dispatchOrderWithFailover } from "../_shared/provider_router.ts";
import { isSentinelProviderOrderId } from "../_shared/providers.ts";
import { executeGuestBeneficiaryRefund, isGuestOrder } from "../_shared/guest-refund.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 0. Identify the caller — enforce per-order ownership or admin role
    const authHeader = req.headers.get("Authorization");
    const callerToken = authHeader?.replace(/^Bearer\s+/i, "").trim();
    if (!callerToken) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let isServiceRole = Boolean(supabaseServiceKey && callerToken === supabaseServiceKey.trim());
    if (!isServiceRole && callerToken.split(".").length === 3) {
      try {
        const payloadJson = JSON.parse(atob(callerToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (payloadJson?.role === "service_role") {
          const verifyRes = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/system_secrets?limit=1`, {
            headers: {
              apikey: callerToken,
              Authorization: `Bearer ${callerToken}`,
            },
          });
          if (verifyRes.ok) {
            isServiceRole = true;
          }
        }
      } catch {
        // ignore JWT parse errors
      }
    }
    let callerUserId: string | null = null;
    let isCallerAdmin = isServiceRole;

    if (!isServiceRole) {
      const { data: { user: callerUser }, error: callerErr } = await supabaseAdmin.auth.getUser(callerToken);
      if (callerErr || !callerUser) {
        return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerUserId = callerUser.id;
      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", callerUser.id)
        .eq("role", "admin")
        .limit(1);
      isCallerAdmin = Boolean(roles && roles.length > 0);
    }

    const url = new URL(req.url);
    let body: any = {};
    if (req.method !== "GET") {
      body = await Promise.resolve(req.json()).catch(() => ({}));
    }

    const rawOrderId = String(body.order_id || url.searchParams.get("order_id") || "").trim();
    const rawReference = String(body.reference || url.searchParams.get("reference") || "").trim();
    const rawOrderNumber = body.orderNumber ?? url.searchParams.get("orderNumber");
    const cleanOrderNumber = rawOrderNumber !== undefined && rawOrderNumber !== null ? String(rawOrderNumber).trim() : "";
    const mode = String(body.mode || url.searchParams.get("mode") || "refund").toLowerCase();

    const identifier = rawOrderId || rawReference || cleanOrderNumber;
    if (!identifier) {
      return new Response(JSON.stringify({
        success: false,
        error: "Either 'reference' or 'orderNumber' is required",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch exact order from Database on Server-Side
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    let orderQuery = supabaseAdmin.from("orders").select("*");
    if (isUuid) {
      orderQuery = orderQuery.or(`id.eq.${identifier},provider_order_id.eq.${identifier},metadata->>client_reference.eq.${identifier}`);
    } else {
      orderQuery = orderQuery.or(`provider_order_id.eq.${identifier},metadata->>client_reference.eq.${identifier}`);
    }

    const { data: order, error: fetchErr } = await orderQuery.limit(1).maybeSingle();

    if (fetchErr || !order) {
      return new Response(JSON.stringify({ success: false, error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1b. Ownership check: only the order's own agent, or an admin, may act on it.
    if (!isCallerAdmin && order.agent_id !== callerUserId) {
      return new Response(JSON.stringify({ success: false, error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isBrowserInvoke = Boolean(body && (body.order_id || body.mode));
    const errStatus = (code: number) => (isBrowserInvoke && code === 400 ? 200 : code);

    // 2. SERVER-SIDE CHECK 1: Already Fulfilled / Completed / Pending
    if (order.status === "fulfilled" || order.status === "completed") {
      return new Response(JSON.stringify({
        success: false,
        error: "Order is not eligible for refund",
        details: "Server Verification Failed: Order was already fulfilled by carrier/provider. Cannot refund."
      }), {
        status: errStatus(400),
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. SERVER-SIDE CHECK 2: Already Refunded
    if (order.status === "refunded" || order.auto_refunded) {
      return new Response(JSON.stringify({
        success: false,
        error: "Order is not eligible for refund",
        alreadyRefunded: true,
        message: "Order was already refunded to wallet balance."
      }), {
        status: errStatus(400),
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let upstreamRefundData: any = null;
    const isRerouteMode = mode === "refund_and_reroute" || mode === "reroute";
    const hasProviderRef = !isSentinelProviderOrderId(order.provider_order_id);

    let assignedProvider: any = null;
    if (order.provider_id) {
      const { data: provRow } = await supabaseAdmin
        .from("providers")
        .select("*")
        .eq("id", order.provider_id)
        .maybeSingle();
      assignedProvider = provRow;
    }

    const handlerType = String(assignedProvider?.handler_type || "").toLowerCase();
    const isDataHub = handlerType === "datahub" || String(assignedProvider?.name || "").toLowerCase().includes("datahub");

    // 4A. UNIVERSAL REROUTE FLOW (Works for SKPlug, DataHub, DataMart, Spendless, BundleZone, HySpeedData, or stuck #dispatching orders)
    if (isRerouteMode) {
      const standardAdapter = new StandardAdapter();

      if (assignedProvider) {
        // 1. Live safety check: never reroute if the current provider already delivered the data!
        const liveCheck = await standardAdapter.checkStatus(
          supabaseAdmin,
          assignedProvider,
          String(order.provider_order_id || order.id),
          order.id
        );
        const liveStatus = String(liveCheck.status || "").toLowerCase();
        if (liveCheck.ok && ["fulfilled", "completed", "delivered", "success", "successful"].includes(liveStatus)) {
          await supabaseAdmin
            .from("orders")
            .update({
              status: "fulfilled",
              failure_reason: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", order.id);
          await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id })).catch(() => {});

          return new Response(JSON.stringify({
            success: false,
            error: `${assignedProvider.name} confirmed this order was ALREADY DELIVERED. Marked as fulfilled instead of rerouting.`,
          }), {
            status: errStatus(400),
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // 2. If DataHub and order is still active on DataHub, attempt DataHub /order-refund first
        const isConfirmedFailedOrMissingOnProvider =
          !hasProviderRef ||
          ["failed", "fulfillment_failed", "refunded", "reversed", "rejected", "cancelled", "not_found"].includes(liveStatus);

        if (isDataHub && hasProviderRef && !isConfirmedFailedOrMissingOnProvider) {
          const dhMethod = req.method === "GET" ? "GET" : "POST";
          const dhRefund = await standardAdapter.refundDataHubOrder(supabaseAdmin, assignedProvider, {
            reference: order.id,
            orderNumber: cleanOrderNumber || order.provider_order_id,
            method: dhMethod,
          });
          if (dhRefund.ok) {
            upstreamRefundData = dhRefund.raw || null;
          } else {
            const dhReason = String(dhRefund.reason || "").toLowerCase();
            const isAlreadyRefundedOrGone =
              dhRefund.status === "not_found" ||
              dhReason.includes("not found") ||
              dhReason.includes("already refunded") ||
              dhReason.includes("refunded") ||
              dhReason.includes("failed") ||
              dhReason.includes("cancelled");
            if (!isAlreadyRefundedOrGone && !isCallerAdmin) {
              return new Response(JSON.stringify({
                success: false,
                error: dhRefund.reason || "Order could not be cancelled on DataHub for rerouting.",
              }), {
                status: errStatus(400),
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }
        } else if (!isCallerAdmin && !isConfirmedFailedOrMissingOnProvider) {
          return new Response(JSON.stringify({
            success: false,
            error: "Order is currently processing on the provider and cannot be self-rerouted yet.",
          }), {
            status: errStatus(400),
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // 3. Exclude the previous provider (e.g. SKPlug) and dispatch immediately to the next active provider
      const prevFailed = Array.isArray(order.metadata?.failed_provider_ids)
        ? order.metadata.failed_provider_ids
        : [];
      const nextFailedIds = assignedProvider?.id
        ? Array.from(new Set([...prevFailed, assignedProvider.id]))
        : prevFailed;

      const nextMeta: Record<string, any> = {
        ...(order.metadata || {}),
        api_paused: false,
        failed_provider_ids: nextFailedIds,
        last_failed_provider: assignedProvider?.name || order.metadata?.last_failed_provider || "previous_provider",
        last_failed_reason: assignedProvider
          ? `Rerouted away from ${assignedProvider.name} to alternative provider`
          : "Rerouted stuck dispatching order to active provider",
        rerouted_at: new Date().toISOString(),
        ...(upstreamRefundData ? { datahub_refunded_at: new Date().toISOString(), datahub_refund_data: upstreamRefundData } : {}),
      };

      await supabaseAdmin
        .from("orders")
        .update({
          provider_id: null,
          provider_order_id: null,
          status: "processing",
          failure_reason: null,
          metadata: nextMeta,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      const dispatch = await dispatchOrderWithFailover(supabaseAdmin, {
        ...order,
        provider_id: null,
        provider_order_id: null,
        status: "processing",
        failure_reason: null,
        metadata: nextMeta,
      });

      const dispatchAccepted =
        dispatch.ok ||
        (dispatch.status === "processing" && !isSentinelProviderOrderId(dispatch.provider_order_id));

      if (dispatchAccepted) {
        const targetStatus = dispatch.status === "fulfilled" ? "fulfilled" : "processing";
        await supabaseAdmin
          .from("orders")
          .update({
            status: targetStatus,
            provider_id: dispatch.provider_id || null,
            provider_order_id: dispatch.provider_order_id || null,
            failure_reason: null,
            metadata: nextMeta,
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);

        if (targetStatus === "fulfilled") {
          await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id })).catch(() => {});
        }

        let newProvName = "alternative provider";
        if (dispatch.provider_id) {
          const { data: np } = await supabaseAdmin.from("providers").select("name").eq("id", dispatch.provider_id).maybeSingle();
          if (np?.name) newProvName = np.name;
        }

        return new Response(JSON.stringify({
          success: true,
          rerouted: true,
          status: targetStatus,
          provider_id: dispatch.provider_id,
          provider_order_id: dispatch.provider_order_id,
          message: assignedProvider
            ? `Skipped ${assignedProvider.name} and re-routed order to ${newProvName} (${targetStatus}).`
            : `Re-routed order to ${newProvName} (${targetStatus}).`,
          datahub_refund: upstreamRefundData,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // If no alternative provider could accept the order, mark as fulfillment_failed so admin sees the exact reason
      const failReason = dispatch.reason || "No alternative active provider could accept this order.";
      await supabaseAdmin
        .from("orders")
        .update({
          status: "fulfillment_failed",
          provider_id: dispatch.provider_id || null,
          provider_order_id: dispatch.provider_order_id || "failed_api_call",
          failure_reason: failReason,
          metadata: nextMeta,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      return new Response(JSON.stringify({
        success: false,
        error: `Skipped ${assignedProvider?.name || "previous provider"}, but alternative provider dispatch failed: ${failReason}`,
      }), {
        status: errStatus(400),
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4B. SERVER-SIDE CHECK 3 (Wallet Refund Mode): If processing, verify provider status before refunding wallet
    if (order.status === "processing") {
      if (isDataHub && assignedProvider) {
        const standardAdapter = new StandardAdapter();
        const dhMethod = req.method === "GET" ? "GET" : "POST";
        const dhRefund = await standardAdapter.refundDataHubOrder(supabaseAdmin, assignedProvider, {
          reference: order.id,
          orderNumber: cleanOrderNumber || order.provider_order_id,
          method: dhMethod,
        });

        if (!dhRefund.ok) {
          // Check if DataHub actually completed the order in the meantime
          const liveCheck = await standardAdapter.checkStatus(
            supabaseAdmin,
            assignedProvider,
            String(order.provider_order_id || order.id),
            order.id
          );
          const liveStatus = String(liveCheck.status || "").toLowerCase();
          if (liveCheck.ok && ["fulfilled", "completed", "delivered", "success", "successful"].includes(liveStatus)) {
            await supabaseAdmin
              .from("orders")
              .update({
                status: "fulfilled",
                failure_reason: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", order.id);
            await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id })).catch(() => {});

            return new Response(JSON.stringify({
              success: false,
              error: "Order is not eligible for refund",
              details: "Provider confirmed order was DELIVERED. Order marked as fulfilled instead of refunding."
            }), {
              status: errStatus(400),
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const httpStatus = dhRefund.status === "not_found" ? 404 : dhRefund.status === "unauthorized" ? 401 : 400;
          return new Response(JSON.stringify({
            success: false,
            error: dhRefund.reason || "Order is not eligible for refund",
          }), {
            status: isBrowserInvoke ? 200 : httpStatus,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        upstreamRefundData = dhRefund.raw || null;

        // Mark provider_order_id as refunded before executing customer/agent wallet refund
        await supabaseAdmin
          .from("orders")
          .update({
            provider_order_id: "refunded",
            failure_reason: "Refunded via DataHub /order-refund",
            metadata: {
              ...(order.metadata || {}),
              datahub_refunded_at: new Date().toISOString(),
              datahub_refund_data: upstreamRefundData,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);
      } else if (assignedProvider) {
        // Non-DataHub provider (e.g. SKPlug, DataMart, Spendless, BundleZone, HySpeedData):
        // Check live status on the provider. If provider refunded/failed/rejected it (or never received it), allow wallet refund!
        const standardAdapter = new StandardAdapter();
        const liveCheck = await standardAdapter.checkStatus(
          supabaseAdmin,
          assignedProvider,
          String(order.provider_order_id || order.id),
          order.id
        );
        const liveStatus = String(liveCheck.status || "").toLowerCase();
        if (liveCheck.ok && ["fulfilled", "completed", "delivered", "success", "successful"].includes(liveStatus)) {
          await supabaseAdmin
            .from("orders")
            .update({
              status: "fulfilled",
              failure_reason: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", order.id);
          await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id })).catch(() => {});

          return new Response(JSON.stringify({
            success: false,
            error: "Order is not eligible for refund",
            details: "Provider confirmed order was DELIVERED. Order marked as fulfilled instead of refunding."
          }), {
            status: errStatus(400),
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const isFailedOrRefundedOnProvider =
          !hasProviderRef ||
          ["failed", "fulfillment_failed", "refunded", "reversed", "rejected", "cancelled", "not_found"].includes(liveStatus);

        if (!isFailedOrRefundedOnProvider && !isCallerAdmin) {
          return new Response(JSON.stringify({
            success: false,
            error: "Order is not eligible for refund",
            details: "Order has already been submitted and received by an API provider. Only manual or failed orders can be refunded."
          }), {
            status: errStatus(400),
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await supabaseAdmin
          .from("orders")
          .update({
            provider_order_id: "refunded",
            failure_reason: `Refunded after ${assignedProvider.name} status check (${liveStatus || "admin refund"})`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);
      } else {
        console.log(`[verify-and-refund] Order ${order.id} is processing without provider reference. Running server-side provider verification first...`);
        const { data: verifyRes } = await supabaseAdmin.functions.invoke("verify-payment", {
          body: { reference: order.id, order_id: order.id, force: true }
        });

        if (verifyRes?.status === "fulfilled" || verifyRes?.status === "completed") {
          return new Response(JSON.stringify({
            success: false,
            error: "Order is not eligible for refund",
            details: "Server Verification Failed: Provider confirmed order was DELIVERED. Order marked as fulfilled instead of refunding."
          }), {
            status: errStatus(400),
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // 5. SERVER-SIDE EXECUTION: Execute Wallet Refund OR Paystack/Guest Refund
    const pmLower = String(order.payment_method || "").toLowerCase().trim();
    const isWalletPayment = pmLower === "wallet" || pmLower === "balance";
    const hasRealAgent = Boolean(order.agent_id && order.agent_id !== "00000000-0000-0000-0000-000000000000");

    if (isWalletPayment) {
      const { data: refundSuccess, error: rpcErr } = await supabaseAdmin.rpc("refund_failed_order", {
        p_order_id: order.id
      });

      if (rpcErr || !refundSuccess) {
        return new Response(JSON.stringify({
          success: false,
          error: rpcErr?.message || "Order is not eligible for refund"
        }), {
          status: errStatus(400),
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (hasRealAgent && isCallerAdmin) {
      // Agent order paid via Paystack/MoMo: credit the agent's wallet and mark order refunded
      const { error: creditErr } = await supabaseAdmin.rpc("credit_wallet", {
        p_agent_id: order.agent_id,
        p_amount: Number(order.amount || 0),
      });
      if (creditErr) {
        return new Response(JSON.stringify({
          success: false,
          error: creditErr.message || "Could not credit agent wallet for refund"
        }), {
          status: errStatus(400),
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await supabaseAdmin
        .from("orders")
        .update({
          status: "refunded",
          auto_refunded: true,
          refunded_at: new Date().toISOString(),
          refund_amount: Number(order.amount || 0),
          refund_reason: "Refunded to agent wallet by administrator",
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);
    } else if (isGuestOrder(order)) {
      // Guest / Direct Paystack checkout order: execute Paystack MoMo refund
      await supabaseAdmin
        .from("orders")
        .update({
          status: "fulfillment_failed",
          provider_id: null,
          provider_order_id: "failed_api_call",
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      const guestRes = await executeGuestBeneficiaryRefund(
        supabaseAdmin,
        {
          ...order,
          status: "fulfillment_failed",
          provider_id: null,
          provider_order_id: "failed_api_call",
        },
        order.failure_reason || "Refunded by administrator"
      );

      if (!guestRes.success && !isCallerAdmin) {
        return new Response(JSON.stringify({
          success: false,
          error: guestRes.error || "Could not process Mobile Money gateway refund."
        }), {
          status: errStatus(400),
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!guestRes.success && isCallerAdmin) {
        // Admin forced refund even if Paystack API returned a warning: mark order refunded
        await supabaseAdmin
          .from("orders")
          .update({
            status: "refunded",
            auto_refunded: true,
            refunded_at: new Date().toISOString(),
            refund_amount: Number(order.amount || 0),
            refund_reason: `Refunded by administrator (${guestRes.error || "manual MoMo settlement"})`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);
      }
    } else {
      return new Response(JSON.stringify({
        success: false,
        error: "Order is not eligible for refund"
      }), {
        status: errStatus(400),
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch updated wallet balance for response payload
    let newBalance = 0;
    if (order.agent_id) {
      const { data: walletRow } = await supabaseAdmin
        .from("wallets")
        .select("balance")
        .eq("agent_id", order.agent_id)
        .maybeSingle();
      newBalance = Number(walletRow?.balance ?? 0);
    }

    // 6. TRIGGER SMS DISPATCH AFTER SUCCESSFUL SERVER REFUND
    try {
      await supabaseAdmin.functions.invoke("send-order-sms", {
        body: {
          action: "refund",
          phone: order.customer_phone,
          order_id: order.id,
          amount: order.amount,
          agent_id: order.agent_id,
          reason: order.failure_reason || "Refund credited to your wallet"
        }
      });
    } catch (smsErr) {
      console.error("[verify-and-refund] SMS dispatch warning:", smsErr);
    }

    const nowIso = new Date().toISOString();
    const orderNumVal = upstreamRefundData?.orderNumber
      ?? (/^\d+$/.test(String(order.provider_order_id || "")) ? Number(order.provider_order_id) : order.id);
    const refVal = String(order.metadata?.client_reference || order.id);
    const paidAmt = Number(order.amount || 0);

    return new Response(JSON.stringify({
      success: true,
      message: "Refund credited to your wallet",
      data: {
        orderNumber: orderNumVal,
        reference: refVal,
        status: "REFUNDED",
        network: String(order.network || "").toUpperCase(),
        recipient: String(order.customer_phone || ""),
        dataAmount: String(order.package_size || ""),
        amountPaid: paidAmt,
        orderDate: order.created_at,
        updatedAt: nowIso,
        completedAt: null,
        refundedAmount: paidAmt,
        newBalance,
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[verify-and-refund] Exception:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
