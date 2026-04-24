import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, sendSmsViaTxtConnect } from "../_shared/sms.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Check if auto SMS is enabled
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("system_settings")
      .select("auto_pending_sms_enabled, auto_pending_sms_message, txtconnect_api_key, txtconnect_sender_id")
      .eq("id", 1)
      .maybeSingle();

    if (settingsError || !settings || !settings.auto_pending_sms_enabled) {
      return new Response(JSON.stringify({ message: "Auto SMS is disabled or not configured." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const txtApiKey = settings.txtconnect_api_key || Deno.env.get("TXTCONNECT_API_KEY");
    const txtSenderId = settings.txtconnect_sender_id || Deno.env.get("TXTCONNECT_SENDER_ID") || "SwiftDataGh";
    const smsMessage = settings.auto_pending_sms_message || "Your SwiftData transaction is pending. Please try again or contact support.";

    if (!txtApiKey) {
      return new Response(JSON.stringify({ error: "TxtConnect API Key missing." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Find pending orders from today, at least 10 minutes old, not yet reminded.
    // We skip very recent orders to avoid reminding customers who are still mid-payment.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const { data: pendingOrders, error: ordersError } = await supabaseAdmin
      .from("orders")
      .select("id, customer_phone")
      .eq("status", "pending")
      .eq("sms_reminder_sent", false)
      .gte("created_at", startOfDay.toISOString())
      .lte("created_at", tenMinutesAgo.toISOString());

    if (ordersError || !pendingOrders || pendingOrders.length === 0) {
      return new Response(JSON.stringify({ message: "No pending orders need reminders." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sentCount = 0;
    const orderIdsToUpdate: string[] = [];

    // 3. Send SMS using customer_phone only (customers are anonymous, not in profiles)
    for (const order of pendingOrders) {
      const targetPhone = normalizePhone(order.customer_phone);

      if (targetPhone) {
        try {
          await sendSmsViaTxtConnect(txtApiKey, txtSenderId, targetPhone, smsMessage);
          sentCount++;
        } catch (error) {
          console.error(`Failed to send reminder to ${targetPhone} for order ${order.id}:`, error);
        }
      }
      // Always mark as reminded so we don't retry invalid numbers every 30 min
      orderIdsToUpdate.push(order.id);
    }

    // 4. Mark orders as reminded
    if (orderIdsToUpdate.length > 0) {
      await supabaseAdmin
        .from("orders")
        .update({ sms_reminder_sent: true })
        .in("id", orderIdsToUpdate);
    }

    return new Response(JSON.stringify({ success: true, reminders_sent: sentCount, orders_processed: orderIdsToUpdate.length }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Cron SMS error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
