/**
 * ADMIN SMS LOGIN (hardened 2026-11-24, rules in _shared/admin_sms_otp.ts)
 *   status / request_otp / verify_otp : the signed-in admin, for this one login session
 *   set_approval                     : ANOTHER admin, signed in with the authenticator app,
 *                                      switches someone's SMS login on (pinning the phone) or off
 * An SMS login gives a 4-hour session for viewing and everyday work. Money, sends and
 * admin-access actions still need the authenticator app.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { dispatchUnifiedSms, getSmsConfig } from "../_shared/sms.ts";
import { requestSmsCode, setSmsApproval, smsStatus, verifySmsCode, type SmsDeps } from "../_shared/admin_sms_otp.ts";

declare const Deno: any;

const json = (body: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(extraHeaders || {}) },
  });

function jwtSessionId(token: string): string {
  try {
    const part = token.split(".")[1] || "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return String(claims?.session_id || "").trim();
  } catch {
    return "";
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const SECRET = (Deno.env.get("ADMIN_OTP_SECRET") || SERVICE_KEY).trim();
  if (!SUPABASE_URL || !SERVICE_KEY || !SECRET) return json({ error: "Server misconfigured" }, 500);
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const sendSms = async (phone: string, text: string) => {
    try {
      const cfg = await getSmsConfig(db);
      if (!cfg?.apiKey) return false;
      await dispatchUnifiedSms(cfg.gateway, cfg.apiKey, cfg.senderId, phone, text.slice(0, 300), "otp");
      return true;
    } catch (err) {
      console.error("[admin-otp-auth] SMS failed:", err);
      return false;
    }
  };

  const deps: SmsDeps = {
    now: new Date(),
    secret: SECRET,
    sendSms,
    alertOtherAdmins: async (exceptUserId: string, text: string) => {
      try {
        await db.rpc("notify_admins", { p_title: "Admin signed in with an SMS code", p_message: text, p_link: "/admin/security" });
      } catch { /* non-critical */ }
      const { data: roles } = await db.from("user_roles").select("user_id").eq("role", "admin").neq("user_id", exceptUserId).limit(10);
      const ids = (roles || []).map((r: any) => r.user_id);
      if (!ids.length) return;
      const { data: admins } = await db.from("profiles").select("phone").in("user_id", ids).not("phone", "is", null);
      for (const a of admins || []) if (a.phone) await sendSms(a.phone, `[SwiftData security] ${text}`);
    },
  };

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status").toLowerCase();

    if (action === "set_approval") {
      const auth = await verifyAdmin(req, db); // authenticator app required (default)
      if (!auth.success) return json({ error: auth.error || "Unauthorized" }, auth.status || 401);
      const res = await setSmsApproval(db, {
        adminId: String(auth.user?.id || ""),
        adminSecondFactor: auth.secondFactor === "authenticator" ? "authenticator" : "sms",
        targetUserId: String(body?.user_id || ""),
        approved: body?.approved === true,
        phone: body?.phone ? String(body.phone) : null,
      }, deps);
      return json(res.body, res.status);
    }

    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return json({ error: "Unauthorized" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(bearer);
    if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);
    const input = { userId: userData.user.id, sessionId: jwtSessionId(bearer) };
    if (!input.sessionId) return json({ error: "Please sign in again." }, 401);

    const res =
      action === "status" ? await smsStatus(db, input, deps)
      : action === "request_otp" ? await requestSmsCode(db, input, deps)
      : action === "verify_otp" ? await verifySmsCode(db, { ...input, code: String(body?.otp || "") }, deps)
      : { status: 400, body: { error: `Unknown action: ${action}` } };
    const retryAfter =
      res.status === 429 && typeof (res.body as any)?.retry_after_seconds === "number"
        ? { "Retry-After": String((res.body as any).retry_after_seconds) }
        : undefined;
    return json(res.body, res.status, retryAfter);
  } catch (err: any) {
    console.error("[admin-otp-auth] Error:", err);
    return json({ error: "Something went wrong. Please use your authenticator app." }, 500);
  }
});
