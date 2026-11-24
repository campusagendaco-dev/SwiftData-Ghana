/**
 * SELF-UNSUSPEND (rebuilt safely 2026-11-24, rules in _shared/unsuspend.ts)
 *   status / request_otp / verify_otp  - the signed-in suspended user
 *   admin_decision                     - an admin who entered their 2FA code
 * A code only lifts the system's own timed hold early (strike 1-2, at most 24 h, no fraud
 * signals). Everything else waits for an admin, who decides once through the confirmation
 * box. Codes are stored as an HMAC with a server secret; at most 5 codes a day.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { dispatchUnifiedSms, getSmsConfig } from "../_shared/sms.ts";
import { adminDecide, requestCode, unsuspendStatus, verifyCode, type UnsuspendDeps } from "../_shared/unsuspend.ts";

declare const Deno: any;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const SECRET = (Deno.env.get("UNSUSPEND_OTP_SECRET") || SERVICE_KEY).trim();
  if (!SUPABASE_URL || !SERVICE_KEY || !SECRET) return json({ error: "Server misconfigured" }, 500);
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const sendSms = async (phone: string, text: string) => {
    try {
      const cfg = await getSmsConfig(db);
      if (!cfg?.apiKey) return false;
      await dispatchUnifiedSms(cfg.gateway, cfg.apiKey, cfg.senderId, phone, text.slice(0, 300), "otp");
      return true;
    } catch (err) {
      console.error("[self-unsuspend] SMS failed:", err);
      return false;
    }
  };

  const deps: UnsuspendDeps = {
    now: new Date(),
    secret: SECRET,
    sendSms,
    // Once per request: an in-app alert plus one SMS to each admin (from user_roles).
    notifyAdmins: async (text: string) => {
      try {
        await db.rpc("notify_admins", { p_title: "Unsuspend request needs review", p_message: text, p_link: "/admin/security" });
      } catch { /* non-critical */ }
      const { data: roles } = await db.from("user_roles").select("user_id").eq("role", "admin").limit(10);
      const ids = (roles || []).map((r: any) => r.user_id);
      if (!ids.length) return;
      const { data: admins } = await db.from("profiles").select("phone").in("user_id", ids).not("phone", "is", null);
      for (const a of admins || []) if (a.phone) await sendSms(a.phone, `[SwiftData] ${text}`);
    },
  };

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status").toLowerCase();

    if (action === "admin_decision") {
      const auth = await verifyAdmin(req, db); // 2FA required (default)
      if (!auth.success) return json({ error: auth.error || "Unauthorized" }, auth.status || 401);
      const res = await adminDecide(db, {
        adminId: String(auth.user?.id || ""),
        requestId: String(body?.request_id || ""),
        decision: String(body?.decision || "").toLowerCase() as "approve" | "reject",
        note: body?.admin_note ? String(body.admin_note).slice(0, 300) : null,
      }, deps);
      return json(res.body, res.status);
    }

    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return json({ error: "Unauthorized" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(bearer);
    if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);
    const userId = userData.user.id;

    const res =
      action === "status" ? await unsuspendStatus(db, userId, deps)
      : action === "request_otp" ? await requestCode(db, userId, deps)
      : action === "verify_otp" ? await verifyCode(db, userId, String(body?.otp || ""), deps)
      : { status: 400, body: { error: `Unknown action: ${action}` } };
    return json(res.body, res.status);
  } catch (err: any) {
    console.error("[self-unsuspend] Error:", err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
