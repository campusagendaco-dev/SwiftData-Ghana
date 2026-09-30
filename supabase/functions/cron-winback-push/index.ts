import "../deno.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, dispatchUnifiedSms } from "../_shared/sms.ts";

declare const Deno: any;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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
    const { 
      title = "We Missed You! 👋",
      body: messageBody = "We missed you! Good news: all your data, airtime, and order payments can now go through smoothly. Place your order now at https://swiftdatagh.shop! 🚀",
      link = "/dashboard/buy-data",
      inactive_hours = 24,
      send_sms = true
    } = body;

    console.log(`[winback-push] Triggering automatic 'We Missed You' blast (Inactive: ${inactive_hours}h, SMS: ${send_sms})...`);

    // 1. Call RPC function dispatch_missed_you_push_broadcast for Web Push & In-App Alerts
    const { data: result, error } = await supabaseAdmin.rpc("dispatch_missed_you_push_broadcast", {
      p_title: title,
      p_body: messageBody,
      p_link: link,
      p_inactive_hours: Number(inactive_hours) || 24
    });

    if (error) {
      console.error("[winback-push] RPC error:", error);
      throw error;
    }

    let smsSentCount = 0;

    // 2. Dispatch SMS to inactive users if send_sms is true and SMS is configured
    if (send_sms) {
      try {
        const smsConfig = await getSmsConfig(supabaseAdmin);
        if (smsConfig.apiKey && smsConfig.senderId) {
          const { data: inactiveUsers } = await supabaseAdmin.rpc("get_inactive_winback_users", {
            p_inactive_hours: Number(inactive_hours) || 24,
            p_limit: 50
          });

          if (inactiveUsers && inactiveUsers.length > 0) {
            for (const u of inactiveUsers) {
              const targetPhone = normalizePhone(u.phone);
              if (!targetPhone) continue;

              const recipientName = u.full_name || "Customer";
              const smsText = `Hey ${recipientName}, we missed you! Good news: all your data, airtime & order payments can now go through smoothly. Order now at https://swiftdatagh.shop`;

              try {
                await dispatchUnifiedSms(
                  smsConfig.gateway,
                  smsConfig.apiKey,
                  smsConfig.senderId,
                  targetPhone,
                  smsText,
                  "winback"
                );
                smsSentCount++;
              } catch (smsErr: any) {
                console.warn(`[winback-push] SMS failed for ${targetPhone}:`, smsErr?.message);
              }
            }
          }
        }
      } catch (smsConfigErr: any) {
        console.warn("[winback-push] SMS config check warning:", smsConfigErr?.message);
      }
    }

    console.log("[winback-push] Blast summary:", { ...result, sms_sent: smsSentCount });

    return new Response(JSON.stringify({
      ...(result || {}),
      sms_sent: smsSentCount,
      message: `Dispatched "We Missed You" blast across Web Push, In-App alerts & ${smsSentCount} SMS.`
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[winback-push] Execution error:", err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
