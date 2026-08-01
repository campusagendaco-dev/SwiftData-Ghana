import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, sendSmsViaTxtConnect } from "../_shared/sms.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { apiKey: txtApiKey } = await getSmsConfig(supabaseAdmin);
    if (!txtApiKey) {
      return new Response(JSON.stringify({ error: "SMS not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call RPC get_dormant_wallet_recipients(p_min_balance, p_inactive_days, p_limit)
    const { data: recipients, error } = await supabaseAdmin.rpc("get_dormant_wallet_recipients", {
      p_min_balance: 10.00,
      p_inactive_days: 7,
      p_limit: 30
    });

    if (error || !recipients || recipients.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: "No dormant wallet recipients found." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    const userIdsSent: string[] = [];

    for (const r of recipients) {
      const targetPhone = normalizePhone(r.phone);
      if (!targetPhone) continue;

      const name = r.full_name || "Partner";
      const balance = Number(r.balance || 0).toFixed(2);
      const msg = `Hey ${name}, you have GHS ${balance} in your SwiftData wallet! Top up your data or send to customers today at https://swiftdatagh.shop`;

      try {
        await sendSmsViaTxtConnect(txtApiKey, "SwiftDataGh", targetPhone, msg);
        sent++;
        userIdsSent.push(r.user_id);
      } catch (err: any) {
        console.error(`[winback-sms] Failed to send to ${targetPhone}:`, err.message);
      }
    }

    // Update winback_sms_sent_at timestamp in profiles
    if (userIdsSent.length > 0) {
      await supabaseAdmin
        .from("profiles")
        .update({ winback_sms_sent_at: new Date().toISOString() })
        .in("user_id", userIdsSent);
    }

    return new Response(JSON.stringify({
      success: true,
      processed: recipients.length,
      sent: sent,
      recipients: userIdsSent
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[winback-sms] Exception:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
