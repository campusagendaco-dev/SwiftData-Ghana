/**
 * VERIFY SIGNUP PHONE (hardened 2026-11-24, rules in _shared/signup_phone.ts)
 *   send_otp    : code to a Ghana number (1/min and 5/day per number, 10/hour per network,
 *                 an overall hourly cap)
 *   verify_otp  : checks the code and returns a one-time token; a signed-in caller (the
 *                 login gate) is marked verified straight away
 *   claim_token : after signup, the signed-in user hands the token back and the server marks
 *                 profiles.phone_verified (same number, within 30 min, once)
 * A phone already verified on another account is allowed but both are flagged for review.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { dispatchUnifiedSms, getSmsConfig } from "../_shared/sms.ts";
import { claimToken, clientIp, sendSignupCode, verifySignupCode, type SignupPhoneDeps } from "../_shared/signup_phone.ts";

declare const Deno: any;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const SECRET = (Deno.env.get("SIGNUP_OTP_SECRET") || SERVICE_KEY).trim();
  if (!SUPABASE_URL || !SERVICE_KEY || !SECRET) return json({ success: false, error: "Server misconfigured" });
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const deps: SignupPhoneDeps = {
    now: new Date(),
    secret: SECRET,
    sendSms: async (phone, text) => {
      try {
        const cfg = await getSmsConfig(db);
        if (!cfg?.apiKey) return false;
        await dispatchUnifiedSms(cfg.gateway, cfg.apiKey, cfg.senderId, phone, text, "otp");
        return true;
      } catch (err) {
        console.error("[verify-signup-phone-otp] SMS failed:", err);
        return false;
      }
    },
  };

  // Signed-in caller (login gate or just after signup); anonymous callers get null.
  const signedInUserId = async (): Promise<string | null> => {
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer || bearer === SERVICE_KEY) return null;
    try {
      const { data } = await db.auth.getUser(bearer);
      return data?.user?.id ?? null;
    } catch {
      return null;
    }
  };

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "send_otp").toLowerCase();
    const res =
      action === "send_otp" ? await sendSignupCode(db, { phone: body?.phone, ip: clientIp(req.headers) }, deps)
      : action === "verify_otp" ? await verifySignupCode(db, { phone: body?.phone, code: body?.otp, userId: await signedInUserId() }, deps)
      : action === "claim_token"
        ? await (async () => {
            const userId = await signedInUserId();
            return userId ? claimToken(db, { userId, token: body?.token, phone: body?.phone }, deps) : { status: 200, body: { success: false, error: "Please sign in." } };
          })()
      : { status: 200, body: { success: false, error: `Unknown action: ${action}` } };
    return json(res.body, res.status);
  } catch (err: any) {
    console.error("[verify-signup-phone-otp] Error:", err);
    return json({ success: false, error: "Verification service error. Please try again." });
  }
});
