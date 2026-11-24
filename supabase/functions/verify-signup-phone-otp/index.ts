/**
 * VERIFY SIGNUP PHONE OTP — SMS Phone Number Verification During Account Creation
 *
 * Actions:
 *  - send_otp   : Validates 10-digit Ghana phone, enforces anti-abuse rate limits
 *                 (1/60s per phone, max 5/hr per phone or IP), sends 6-digit SMS OTP.
 *  - verify_otp : Verifies 6-digit OTP (SHA-256 hashed, 10-min expiry, max 5 attempts)
 *                 and returns a signed verification_token for the signup form.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getSmsConfig, dispatchUnifiedSms } from "../_shared/sms.ts";

declare const Deno: any;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function normalizeGhanaPhone(raw: string): string {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (digits.length === 12 && digits.startsWith("233")) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  return digits;
}

function maskPhone(phone: string): string {
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateSixDigitOtp(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ success: false, error: "Server misconfigured" }, 200);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const body = await Promise.resolve(req.json()).catch(() => ({}));
    const action = String(body?.action || "send_otp").toLowerCase();
    const phone = normalizeGhanaPhone(String(body?.phone || ""));

    if (!/^0\d{9}$/.test(phone)) {
      return json({
        success: false,
        error: "Please enter a valid 10-digit Ghana phone number (e.g. 0541234567).",
      }, 200);
    }

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    // ── ACTION: SEND OTP ─────────────────────────────────────────────────────
    if (action === "send_otp") {
      const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
      const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();

      const [recentPhoneRes, hourlyPhoneRes, hourlyIpRes] = await Promise.all([
        db.from("signup_phone_otps").select("id").eq("phone", phone).gte("created_at", oneMinAgo).limit(1),
        db.from("signup_phone_otps").select("id").eq("phone", phone).gte("created_at", oneHourAgo),
        clientIp !== "unknown"
          ? db.from("signup_phone_otps").select("id").eq("ip_address", clientIp).gte("created_at", oneHourAgo)
          : Promise.resolve({ data: [] }),
      ]);

      if ((recentPhoneRes.data || []).length > 0) {
        return json({ success: false, error: "Code already sent. Please wait 60 seconds before requesting another." }, 200);
      }
      if ((hourlyPhoneRes.data || []).length >= 5) {
        return json({ success: false, error: "Too many OTP requests for this number. Please try again in an hour." }, 200);
      }
      if ((hourlyIpRes.data || []).length >= 10) {
        return json({ success: false, error: "Too many OTP requests from this network. Please try again later." }, 200);
      }

      const otp = generateSixDigitOtp();
      const otpHash = await sha256Hex(`${phone}:${otp}`);
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

      const { error: insErr } = await db.from("signup_phone_otps").insert({
        phone,
        otp_hash: otpHash,
        otp_expires_at: expiresAt,
        ip_address: clientIp,
      });
      if (insErr) throw insErr;

      const smsCfg = await getSmsConfig(db);
      if (!smsCfg?.apiKey) {
        return json({ success: false, error: "SMS service is temporarily unavailable. Please try again shortly." }, 200);
      }

      await dispatchUnifiedSms(
        smsCfg.gateway,
        smsCfg.apiKey,
        smsCfg.senderId,
        phone,
        `SwiftData Verification Code: ${otp}. Enter this code within 10 minutes to verify your phone number.`,
        "otp"
      );

      return json({
        success: true,
        phone,
        masked_phone: maskPhone(phone),
        message: `6-digit verification code sent to ${maskPhone(phone)}.`,
      }, 200);
    }

    // ── ACTION: VERIFY OTP ───────────────────────────────────────────────────
    if (action === "verify_otp") {
      const code = String(body?.otp || "").replace(/\D+/g, "").trim();
      if (code.length !== 6) {
        return json({ success: false, error: "Please enter the 6-digit verification code." }, 200);
      }

      const { data: row } = await db
        .from("signup_phone_otps")
        .select("*")
        .eq("phone", phone)
        .is("verified_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!row) {
        return json({ success: false, error: "No active code found for this number. Please click Send OTP." }, 200);
      }

      if (new Date(row.otp_expires_at).getTime() < Date.now()) {
        return json({ success: false, error: "Verification code expired. Please request a new code." }, 200);
      }

      if (Number(row.otp_attempts || 0) >= 5) {
        return json({ success: false, error: "Too many incorrect attempts. Please request a new code." }, 200);
      }

      const expectedHash = await sha256Hex(`${phone}:${code}`);
      if (expectedHash !== row.otp_hash) {
        await db
          .from("signup_phone_otps")
          .update({ otp_attempts: Number(row.otp_attempts || 0) + 1 })
          .eq("id", row.id);
        return json({ success: false, error: "Incorrect 6-digit code. Please check your SMS and try again." }, 200);
      }

      const token = crypto.randomUUID();
      await db
        .from("signup_phone_otps")
        .update({
          verified_at: new Date().toISOString(),
          verification_token: token,
        })
        .eq("id", row.id);

      // If caller is already authenticated (e.g. Google OAuth user), save verified phone directly to profiles
      let profileUpdated = false;
      const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      if (bearer && bearer !== SERVICE_KEY) {
        try {
          const { data: authData } = await db.auth.getUser(bearer);
          if (authData?.user?.id) {
            const { error: profErr } = await db
              .from("profiles")
              .update({
                phone,
                phone_verified: true,
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", authData.user.id);
            if (!profErr) profileUpdated = true;
          }
        } catch {
          // non-critical for pre-signup callers using anon key
        }
      }

      return json({
        success: true,
        verified: true,
        phone,
        profile_updated: profileUpdated,
        verification_token: token,
        message: "Phone number verified!",
      }, 200);
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 200);
  } catch (err: any) {
    console.error("[verify-signup-phone-otp] Error:", err);
    return json({ success: false, error: err?.message || "Verification service error" }, 200);
  }
});
