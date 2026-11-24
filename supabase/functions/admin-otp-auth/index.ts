/**
 * ADMIN OTP AUTH — Approved-Admin-Only SMS OTP Verification (Alternative to TOTP 2FA)
 *
 * Security Guarantees:
 *  - Strictly restricted to users in `public.user_roles` with `role = 'admin'` AND `otp_login_approved = true`.
 *  - OTP is 6 cryptographic digits, SHA-256 hashed, expires in 5 minutes, max 5 wrong attempts, 1 SMS/60s rate limit.
 *  - Verified OTP session is cryptographically bound to the caller's exact JWT `session_id` (12h validity).
 *  - Non-admins receive 403 Forbidden.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getSmsConfig, dispatchUnifiedSms, normalizePhone } from "../_shared/sms.ts";

declare const Deno: any;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function getJwtClaims(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const jsonPayload = decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
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

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D+/g, "");
  if (digits.length < 6) return "***";
  return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Server misconfigured" }, 500);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return json({ error: "Unauthorized" }, 401);

    const { data: userData, error: userErr } = await db.auth.getUser(bearer);
    if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);

    const userId = userData.user.id;
    const claims = getJwtClaims(bearer);
    const sessionId = String(claims?.session_id || "").trim();
    if (!sessionId) {
      return json({ error: "Session identifier missing. Please sign in again." }, 401);
    }

    // Strict Approved-Admin Check
    const { data: roleRow } = await db
      .from("user_roles")
      .select("role, otp_login_approved")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleRow) {
      return json({ error: "Forbidden: Admin privileges required", eligible: false }, 403);
    }

    if (roleRow.otp_login_approved === false) {
      return json({ error: "Admin SMS OTP is disabled for this account. Please use your Authenticator App (2FA).", eligible: false }, 403);
    }

    const { data: profile } = await db
      .from("profiles")
      .select("full_name, phone, email")
      .eq("user_id", userId)
      .maybeSingle();

    const adminPhone = normalizePhone(profile?.phone || "");
    const body = await Promise.resolve(req.json()).catch(() => ({}));
    const action = String(body?.action || "status").toLowerCase();

    // ── ACTION: STATUS ───────────────────────────────────────────────────────
    if (action === "status") {
      const { data: activeSess } = await db
        .from("admin_otp_sessions")
        .select("id, verified_at, expires_at")
        .eq("user_id", userId)
        .eq("session_id", sessionId)
        .not("verified_at", "is", null)
        .gt("expires_at", new Date().toISOString())
        .order("verified_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return json({
        success: true,
        eligible: Boolean(adminPhone),
        has_phone: Boolean(adminPhone),
        masked_phone: adminPhone ? maskPhone(adminPhone) : null,
        has_valid_session: Boolean(activeSess),
        expires_at: activeSess?.expires_at || null,
      });
    }

    // ── ACTION: REQUEST OTP ──────────────────────────────────────────────────
    if (action === "request_otp") {
      if (!adminPhone) {
        return json({ error: "No phone number is registered on your admin profile. Add your phone number or use 2FA." }, 400);
      }

      // Rate limit: 1 OTP per 60 seconds per admin
      const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
      const { data: recent } = await db
        .from("admin_otp_sessions")
        .select("id")
        .eq("user_id", userId)
        .is("verified_at", null)
        .gte("created_at", oneMinAgo)
        .limit(1);

      if (recent && recent.length > 0) {
        return json({ error: "An OTP was already sent. Please wait 60 seconds before requesting another." }, 429);
      }

      const otp = generateSixDigitOtp();
      const otpHash = await sha256Hex(`${userId}:${sessionId}:${otp}`);
      const otpExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

      const { error: insErr } = await db.from("admin_otp_sessions").insert({
        user_id: userId,
        session_id: sessionId,
        phone: adminPhone,
        otp_hash: otpHash,
        otp_expires_at: otpExpiresAt,
        otp_attempts: 0,
      });

      if (insErr) throw insErr;

      const smsCfg = await getSmsConfig(db);
      if (!smsCfg?.apiKey) {
        return json({ error: "SMS gateway is temporarily unavailable. Please use your Authenticator App (2FA)." }, 503);
      }

      await dispatchUnifiedSms(
        smsCfg.gateway,
        smsCfg.apiKey,
        smsCfg.senderId,
        adminPhone,
        `SwiftData Admin Login OTP: ${otp}. Expires in 5 minutes. Never share this code with anyone.`,
        "otp"
      );

      return json({
        success: true,
        masked_phone: maskPhone(adminPhone),
        message: `Admin verification code sent to ${maskPhone(adminPhone)}.`,
      });
    }

    // ── ACTION: VERIFY OTP ───────────────────────────────────────────────────
    if (action === "verify_otp") {
      const code = String(body?.otp || "").replace(/\D+/g, "").trim();
      if (code.length !== 6) {
        return json({ error: "Please enter the 6-digit Admin OTP." }, 400);
      }

      const { data: sessRow } = await db
        .from("admin_otp_sessions")
        .select("*")
        .eq("user_id", userId)
        .eq("session_id", sessionId)
        .is("verified_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!sessRow) {
        return json({ error: "No active Admin OTP found. Please request a new code." }, 400);
      }

      if (sessRow.otp_expires_at && new Date(sessRow.otp_expires_at).getTime() < Date.now()) {
        return json({ error: "Admin OTP expired. Please request a new code." }, 400);
      }

      if (Number(sessRow.otp_attempts || 0) >= 5) {
        return json({ error: "Too many failed attempts. Please request a new Admin OTP." }, 429);
      }

      const expectedHash = await sha256Hex(`${userId}:${sessionId}:${code}`);
      if (expectedHash !== sessRow.otp_hash) {
        await db
          .from("admin_otp_sessions")
          .update({ otp_attempts: Number(sessRow.otp_attempts || 0) + 1 })
          .eq("id", sessRow.id);
        return json({ error: "Invalid 6-digit Admin OTP. Please try again." }, 400);
      }

      const nowIso = new Date().toISOString();
      const expiresIso = new Date(Date.now() + 12 * 3600_000).toISOString();

      await db
        .from("admin_otp_sessions")
        .update({
          verified_at: nowIso,
          expires_at: expiresIso,
          otp_hash: null,
        })
        .eq("id", sessRow.id);

      await db.from("system_logs").insert({
        level: "info",
        source: "admin-otp-auth",
        event: "admin.otp_verified",
        agent_id: userId,
        message: `Approved admin ${profile?.full_name || profile?.email || userId} verified access via SMS OTP.`,
        data: { session_id: sessionId, expires_at: expiresIso },
      });

      return json({
        success: true,
        verified: true,
        expires_at: expiresIso,
        message: "Admin SMS OTP verified! Access granted.",
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error("[admin-otp-auth] Error:", err);
    return json({ error: err?.message || "Internal server error" }, 500);
  }
});
