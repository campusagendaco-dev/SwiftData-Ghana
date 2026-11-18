import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { checkAndTriggerDeliveryOnFire } from "../_shared/whatsapp.ts";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function timingSafeEqualStr(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const authHeader = req.headers.get("Authorization") || "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    const headerCronSecret = (req.headers.get("x-cron-secret") || "").trim();
    const cronSecret = (Deno.env.get("CRON_SECRET") || "").trim();
    const isCronOrService =
      timingSafeEqualStr(bearerToken, (SUPABASE_SERVICE_ROLE_KEY || "").trim()) ||
      (Boolean(cronSecret) &&
        (timingSafeEqualStr(bearerToken, cronSecret) || timingSafeEqualStr(headerCronSecret, cronSecret)));

    if (!isCronOrService) {
      const adminCheck = await verifyAdmin(req, supabaseAdmin);
      if (!adminCheck.success) {
        return new Response(JSON.stringify({ error: adminCheck.error || "Unauthorized" }), {
          status: adminCheck.status || 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 1. Check orders fulfilled in the last 60 minutes (Threshold: 50 orders)
    const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: fulfilledOrders, error: queryErr } = await supabaseAdmin
      .from("orders")
      .select("id, status, created_at, updated_at")
      .eq("status", "fulfilled")
      .gte("updated_at", windowStart)
      .limit(100);

    if (queryErr) {
      console.error("[Velocity Alert] DB error querying fulfilled orders:", queryErr);
      return new Response(JSON.stringify({ error: queryErr.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const count = fulfilledOrders?.length || 0;
    console.log(`[Velocity Alert] Found ${count} fulfilled orders in the last 60 minutes.`);

    if (count < 20) {
      return new Response(
        JSON.stringify({
          triggered: false,
          reason: `Only ${count} orders fulfilled in last 60 mins. Threshold is 20.`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // 2. Check cooldown: Has a fire alert been sent in the last 30 minutes?
    const cooldownStart = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data: recentAlerts } = await supabaseAdmin
      .from("system_logs")
      .select("id, ts")
      .eq("event", "broadcast.delivery_fire")
      .gte("ts", cooldownStart)
      .limit(1);

    if (recentAlerts && recentAlerts.length > 0) {
      console.log("[Velocity Alert] Cooldown active. Alert already sent in last 30 mins.");
      return new Response(
        JSON.stringify({
          triggered: false,
          reason: "Cooldown active. Alert already sent in last 30 minutes.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // 3. Trigger WhatsApp Channel Delivery Alert directly (NO user phone numbers are ever messaged)
    console.log(`⚡ VELOCITY TRIGGERED! ${count} orders fulfilled in window. Dispatching to WhatsApp Channel...`);

    const channelSent = await checkAndTriggerDeliveryOnFire(supabaseAdmin, {
      siteUrl: "https://swiftdatagh.shop",
      minOrders: 20,
    });

    // Also send push notification to all active web push devices
    supabaseAdmin.functions
      .invoke("send-push-notification", {
        body: {
          broadcast: true,
          title: "🔥 ORDERS DELIVERED! ⚡🚀",
          body: `High-speed delivery is 100% active right now! Order at swiftdatagh.shop!`,
          url: "https://swiftdatagh.shop",
        },
      })
      .catch((pErr: any) => console.warn("[Velocity Alert] Push notification error:", pErr));

    return new Response(
      JSON.stringify({
        triggered: true,
        fulfilledCount: count,
        channelSent,
        message: "Channel announcement dispatched. Zero individual numbers messaged."
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err: any) {
    console.error("[Velocity Alert] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
