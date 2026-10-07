import "../deno.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";
import { getProviderAdapter } from "../_shared/providers/registry.ts";
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
    /superbdatafy/gi
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
    const targetReference = String(body.order_id || body.reference || body.orderId || "").trim();

    if (!targetReference) {
      return new Response(JSON.stringify({ error: "Missing order_id or reference parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Determine caller role (Admin vs Regular User/Guest)
    let isAdmin = false;
    let authUser: any = null;

    try {
      const adminCheck = await verifyAdmin(req, supabaseAdmin);
      if (adminCheck && adminCheck.success) {
        isAdmin = true;
        authUser = adminCheck.user;
      }
    } catch {
      isAdmin = false;
    }

    if (!isAdmin) {
      const authHeader = req.headers.get("Authorization");
      const userToken = req.headers.get("x-user-access-token");
      const token = userToken || authHeader?.replace(/^Bearer\s+/i, "").trim();
      if (token) {
        const { data: { user } } = await supabaseAdmin.auth.getUser(token).catch(() => ({ data: { user: null } }));
        authUser = user;
      }
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
        providerInfo = prov;
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
          const isFailed = rawStatus === "failed" || rawStatus === "rejected" || rawStatus === "cancelled" || rawStatus === "refunded" || rawStatus === "reversed" || rawStatus === "declined" || pRes?.ok === false;

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
            currentStatus = "fulfillment_failed";
            currentFailureReason = pRes.reason || (rawStatus === "refunded" ? "Provider refunded order" : "Carrier dispatch rejected");
            carrierStatusDesc = rawStatus === "refunded" ? "Provider refunded order" : "Carrier rejected dispatch";

            if (order.status !== "fulfillment_failed") {
              await supabaseAdmin.from("orders").update({
                status: "fulfillment_failed",
                failure_reason: currentFailureReason,
                provider_response: pRes.raw || pRes,
                updated_at: new Date().toISOString()
              }).eq("id", order.id);

              console.log(`[check-order-status] Order ${order.id} transitioned to FULFILLMENT_FAILED via live provider check.`);
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
