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

    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // 1. Find stuck paid/pending orders
    const { data: stuckOrders } = await supabaseAdmin
      .from("orders")
      .select("*")
      .in("status", ["paid", "pending"])
      .neq("network", "MTN Mash Up")
      .lte("created_at", twoMinutesAgo)
      .gte("created_at", twoDaysAgo)
      .limit(15);

    // 2. Find failed orders whose failure_reason indicates No Provider
    const { data: noProviderOrders } = await supabaseAdmin
      .from("orders")
      .select("*")
      .in("status", ["fulfillment_failed", "failed"])
      .or("failure_reason.ilike.%No provider%,failure_reason.ilike.%No active provider%,failure_reason.ilike.%No active telecom provider%,failure_reason.ilike.%Auto-retry failed%")
      .gte("created_at", twoDaysAgo)
      .order("created_at", { ascending: false })
      .limit(15);

    // Deduplicate candidate orders by ID
    const orderMap = new Map<string, any>();
    (stuckOrders || []).forEach(o => orderMap.set(o.id, o));
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
      console.log(`[cron-auto-retry] Auto-healing order ${order.id} (${order.network} ${order.package_size}, previous status: ${order.status})...`);
      
      const dispatch = await dispatchOrderWithFailover(supabaseAdmin, order);

      if (dispatch.status === "fulfilled") {
        await supabaseAdmin.from("orders").update({
          status: "fulfilled",
          provider_id: dispatch.provider_id || null,
          provider_order_id: dispatch.provider_order_id || null,
          failure_reason: null,
          updated_at: new Date().toISOString()
        }).eq("id", order.id);

        await supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id }).catch(() => {});
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
        await supabaseAdmin.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: dispatch.reason || "Auto-retry failed across available providers",
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
