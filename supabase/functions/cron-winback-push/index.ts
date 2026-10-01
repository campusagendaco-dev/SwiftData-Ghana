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
    return new Response(JSON.stringify({ error: "Server misconfigured: missing environment variables" }), {
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
      send_push = true,
      send_sms = true,
      sms_limit = 25,
      sms_cooldown_hours = 48
    } = body;

    console.log(`[winback-push] Triggering winback campaign (Inactive: ${inactive_hours}h, Push: ${send_push}, SMS: ${send_sms}, SMS Limit: ${sms_limit})...`);

    let pushResult: any = { targeted_users: 0, push_tokens_notified: 0 };

    // 1. Dispatch Web Push & In-App Alerts
    if (send_push) {
      try {
        const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc("dispatch_missed_you_push_broadcast", {
          p_title: title,
          p_body: messageBody,
          p_link: link,
          p_inactive_hours: Number(inactive_hours) || 24
        });

        if (rpcErr) {
          console.error("[winback-push] Web Push RPC warning:", rpcErr);
        } else {
          pushResult = rpcRes || pushResult;
        }
      } catch (pushErr: any) {
        console.error("[winback-push] Error executing push broadcast:", pushErr?.message);
      }
    }

    let smsSentCount = 0;
    const sentUserIds: string[] = [];

    // 2. Dispatch SMS to inactive users if send_sms is true
    if (send_sms) {
      try {
        const smsConfig = await getSmsConfig(supabaseAdmin);
        const effectiveGateway = (smsConfig?.gateway || "txtconnect").toLowerCase().trim();
        // Ensure verified approved Sender ID for TxtConnect is SwiftDataGh
        const resolvedSenderId = effectiveGateway === "txtconnect" 
          ? "SwiftDataGh" 
          : (smsConfig?.senderId || "SwiftDataGh");

        if (smsConfig.apiKey) {
          // Cap sms_limit at 50 max to strictly prevent unintended credit consumption
          const safeLimit = Math.min(Math.max(Number(sms_limit) || 25, 1), 50);

          const { data: inactiveSmsUsers, error: fetchErr } = await supabaseAdmin.rpc("get_inactive_winback_sms_users", {
            p_inactive_hours: Number(inactive_hours) || 24,
            p_limit: safeLimit,
            p_cooldown_hours: Number(sms_cooldown_hours) || 48
          });

          if (fetchErr) {
            console.error("[winback-push] Error fetching inactive SMS users:", fetchErr);
          } else if (inactiveSmsUsers && inactiveSmsUsers.length > 0) {
            console.log(`[winback-push] Found ${inactiveSmsUsers.length} inactive user(s) eligible for winback SMS.`);

            for (const u of inactiveSmsUsers) {
              const targetPhone = normalizePhone(u.phone);
              if (!targetPhone) continue;

              const rawName = (u.full_name || "").trim();
              const firstName = rawName ? rawName.split(" ")[0] : "Customer";
              const cleanFirstName = firstName.replace(/[^a-zA-Z]/g, "") || "Customer";

              // 136 characters -> fits inside 1 single SMS credit (160 limit)
              const smsText = `Hey ${cleanFirstName}, we missed you! Good news: all your data, airtime & order payments can now go through smoothly. Order now at https://swiftdatagh.shop`;

              try {
                const sendRes = await dispatchUnifiedSms(
                  smsConfig.gateway || "txtconnect",
                  smsConfig.apiKey,
                  resolvedSenderId,
                  targetPhone,
                  smsText,
                  "winback"
                );

                if (sendRes && (sendRes.success !== false)) {
                  smsSentCount++;
                  sentUserIds.push(u.user_id);
                }
              } catch (smsErr: any) {
                console.warn(`[winback-push] SMS failed for ${targetPhone}:`, smsErr?.message);
              }
            }

            // Update missed_you_sms_sent_at on profiles to ensure 48h cooldown
            if (sentUserIds.length > 0) {
              await supabaseAdmin.rpc("mark_missed_you_sms_sent", {
                p_user_ids: sentUserIds
              });
            }
          }
        } else {
          console.warn("[winback-push] SMS gateway API key not found in configuration.");
        }
      } catch (smsConfigErr: any) {
        console.warn("[winback-push] SMS config check warning:", smsConfigErr?.message);
      }
    }

    console.log("[winback-push] Campaign summary:", { ...pushResult, sms_sent: smsSentCount });

    return new Response(JSON.stringify({
      ...pushResult,
      sms_sent: smsSentCount,
      message: `Dispatched "We Missed You" blast across Web Push (${pushResult?.push_tokens_notified || 0} tokens) & ${smsSentCount} SMS.`
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
