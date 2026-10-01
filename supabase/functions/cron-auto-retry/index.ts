import { serve } from "https://raw.githubusercontent.com/denoland/deno_std/0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchOrderWithFailover } from "../_shared/provider_router.ts";
import { log } from "../_shared/logger.ts";
import { sendPaymentSms, normalizePhone } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing environment credentials" }), { status: 500 });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

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
      .neq("network", "MTN Mash Up")
      .not("order_type", "in", excludedTypes)
      .lte("created_at", oneMinuteAgo)
      .gte("created_at", twoDaysAgo)
      .limit(25);

    // 2. Find stuck undispatched processing orders (no provider_id or no provider_order_id assigned, or marked timeout/failed_api_call)
    const { data: undispatchedOrders } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("status", "processing")
      .or("provider_id.is.null,provider_order_id.is.null,provider_order_id.eq.timeout,provider_order_id.eq.failed_api_call")
      .neq("network", "MTN Mash Up")
      .not("order_type", "in", excludedTypes)
      .lte("created_at", oneMinuteAgo)
      .gte("created_at", twoDaysAgo)
      .limit(25);

    // 3. Find failed orders whose failure_reason indicates No Provider or retryable error
    const { data: noProviderOrders } = await supabaseAdmin
      .from("orders")
      .select("*")
      .in("status", ["fulfillment_failed", "failed"])
      .not("order_type", "in", excludedTypes)
      .or("failure_reason.ilike.%No provider%,failure_reason.ilike.%No active provider%,failure_reason.ilike.%No active telecom provider%,failure_reason.ilike.%Auto-retry failed%,failure_reason.ilike.%timeout%,failure_reason.ilike.%504%,failure_reason.ilike.%502%")
      .gte("created_at", twoDaysAgo)
      .order("created_at", { ascending: false })
      .limit(25);

    // Deduplicate candidate orders by ID
    const orderMap = new Map<string, any>();
    (stuckPaidOrders || []).forEach(o => orderMap.set(o.id, o));
    (undispatchedOrders || []).forEach(o => orderMap.set(o.id, o));
    (noProviderOrders || []).forEach(o => orderMap.set(o.id, o));

    const candidateOrders = Array.from(orderMap.values());

    const results = {
      attempted: candidateOrders.length,
      fulfilled: 0,
      processing: 0,
      failed: 0,
      smsSent: 0,
    };

    for (const order of candidateOrders) {
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

      // Security guard: Never auto-fulfill orders that lack verified payment proof
      const isWalletOrder = order.payment_method === "wallet";
      const isGatewayPaid = Number(order.paystack_verified_amount || 0) > 0;
      const isPaidStatus = order.status === "paid" || order.status === "processing";
      if (!isWalletOrder && !isGatewayPaid && !isPaidStatus) {
        console.warn(`[cron-auto-retry] Security guard: Order ${order.id} lacks verified payment proof (method: ${order.payment_method}, verified_amount: ${order.paystack_verified_amount}). Skipping.`);
        continue;
      }

      // Atomically claim the order to prevent concurrent runners from double-purchasing
      const { data: claimed, error: claimErr } = await supabaseAdmin
        .from("orders")
        .update({
          status: "processing",
          retry_count: currentRetry + 1,
          last_retry_at: new Date().toISOString()
        })
        .eq("id", order.id)
        .in("status", ["paid", "processing", "fulfillment_failed", "failed"])
        .select("id")
        .maybeSingle();

      if (claimErr || !claimed) {
        console.log(`[cron-auto-retry] Order ${order.id} was already claimed or updated by another worker. Skipping.`);
        continue;
      }

      console.log(`[cron-auto-retry] Auto-healing claimed order ${order.id} (${order.network} ${order.package_size}, attempt ${currentRetry + 1}/3)...`);
      
      const dispatch = await dispatchOrderWithFailover(supabaseAdmin, order);

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
          ? `Max retries (3) reached: ${dispatch.reason || "Unable to fulfill across providers"}`
          : (dispatch.reason || "Auto-retry failed across available providers");

        await supabaseAdmin.from("orders").update({
          status: "fulfillment_failed",
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
