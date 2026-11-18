import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { sendPaymentSms } from "../_shared/sms.ts";

// Cron: runs every 10 minutes (schedule in Supabase Dashboard → Edge Functions → Schedules)
// Detects error spikes and alerts all admins via notification + SMS

const SPIKE_THRESHOLD = 5;      // errors in window
const WINDOW_MINUTES = 10;      // detection window
const COOLDOWN_MINUTES = 30;    // min gap between alerts

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
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const authHeader = req.headers.get("Authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const headerCronSecret = (req.headers.get("x-cron-secret") || "").trim();
  const cronSecret = (Deno.env.get("CRON_SECRET") || "").trim();
  const isCronOrService =
    timingSafeEqualStr(bearerToken, (SUPABASE_SERVICE_ROLE_KEY || "").trim()) ||
    (Boolean(cronSecret) &&
      (timingSafeEqualStr(bearerToken, cronSecret) || timingSafeEqualStr(headerCronSecret, cronSecret)));

  if (!isCronOrService) {
    const adminCheck = await verifyAdmin(req, supabase);
    if (!adminCheck.success) {
      return new Response(JSON.stringify({ error: adminCheck.error || "Unauthorized" }), {
        status: adminCheck.status || 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const cooldownStart = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000).toISOString();

  // Count recent errors
  const { count: errorCount } = await supabase
    .from("system_logs")
    .select("id", { count: "exact", head: true })
    .eq("level", "error")
    .gte("ts", windowStart);

  if (!errorCount || errorCount < SPIKE_THRESHOLD) {
    console.log(`[cron-error-alert] No spike: ${errorCount ?? 0} errors in last ${WINDOW_MINUTES}m`);
    return new Response(JSON.stringify({ spike: false, errors: errorCount ?? 0 }), { status: 200 });
  }

  // Check cooldown — don't spam
  const { count: recentAlerts } = await supabase
    .from("system_logs")
    .select("id", { count: "exact", head: true })
    .eq("event", "alert.error_spike")
    .gte("ts", cooldownStart);

  if (recentAlerts && recentAlerts > 0) {
    console.log(`[cron-error-alert] Cooldown active — skipping`);
    return new Response(JSON.stringify({ spike: true, cooldown: true }), { status: 200 });
  }

  console.log(`[cron-error-alert] SPIKE DETECTED: ${errorCount} errors in ${WINDOW_MINUTES}m`);

  // Get top error sources
  const { data: recentErrors } = await supabase
    .from("system_logs")
    .select("source, event, message")
    .eq("level", "error")
    .gte("ts", windowStart)
    .order("ts", { ascending: false })
    .limit(5);

  // Log the spike alert
  await supabase.from("system_logs").insert({
    level: "error",
    source: "system",
    event: "alert.error_spike",
    message: `ALERT: ${errorCount} errors in the last ${WINDOW_MINUTES} minutes`,
    data: { error_count: errorCount, window_minutes: WINDOW_MINUTES, top_errors: recentErrors },
  });

  // Get all admin users
  const { data: admins } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");

  if (admins?.length) {
    // In-app notification for each admin
    const notifications = admins.map((a) => ({
      user_id: a.user_id,
      title: "🚨 Error Spike Detected",
      message: `${errorCount} system errors in the last ${WINDOW_MINUTES} minutes. Check System Logs.`,
      type: "error",
      link: "/admin/system-logs",
      data: { link: "/admin/system-logs", error_count: errorCount },
    }));
    await supabase.from("user_notifications").insert(notifications);

    // SMS: get admin phones from profiles
    const adminIds = admins.map((a) => a.user_id);
    const { data: adminProfiles } = await supabase
      .from("profiles")
      .select("user_id, phone, full_name")
      .in("user_id", adminIds)
      .not("phone", "is", null);

    for (const profile of adminProfiles || []) {
      if (!profile.phone) continue;
      try {
        await sendPaymentSms(supabase, profile.phone, "custom" as any, {
          message: `SwiftData ALERT: ${errorCount} system errors detected in ${WINDOW_MINUTES} mins. Login to check System Logs immediately.`,
        });
      } catch (e: any) {
        console.error(`[cron-error-alert] SMS failed for ${profile.phone}:`, e.message);
      }
    }
  }

  return new Response(
    JSON.stringify({ spike: true, errors: errorCount, admins_notified: admins?.length ?? 0 }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
