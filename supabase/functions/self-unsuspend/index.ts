/**
 * SELF-UNSUSPEND — OTP Phone Verification & Admin Security Breach Approval Flow
 *
 * Actions:
 *  - status         : Returns suspension reason, masked phone, breach flag, and pending approval status.
 *  - request_otp    : Sends a 6-digit SMS OTP to the suspended user's registered phone (1/60s rate limit).
 *  - verify_otp     : Verifies the 6-digit OTP.
 *                     * Always notifies Admin via SMS explaining why the user was suspended.
 *                     * If soft restriction (velocity / IP change / 1st-time lock): auto-unsuspends immediately.
 *                     * If security breach (2+ strikes, AML, cloned account, negative wallet, or >2 self-unlocks/30d):
 *                       keeps suspended, queues `pending_admin_approval` (triggers live Admin Web Popup),
 *                       and sends Admin SMS + Web Push + Dashboard Notification.
 *  - admin_decision : Admin approves or rejects a `pending_admin_approval` request (1-click from popup).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { getSmsConfig, dispatchUnifiedSms, normalizePhone } from "../_shared/sms.ts";

declare const Deno: any;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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

async function assessSuspension(db: any, userId: string, profile: any) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [violRes, amlRes, cloneRes, walletRes, recentSelfRes, logsRes] = await Promise.all([
    db.from("security_violations").select("reason, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(3),
    db.from("aml_alerts").select("alert_type, risk_score, is_resolved").eq("agent_id", userId).eq("is_resolved", false).limit(3),
    db.from("duplicate_account_flags").select("matching_criteria, action_taken").or(`primary_user_id.eq.${userId},duplicate_user_ids.cs.{${userId}}`).limit(3),
    db.from("wallets").select("balance").eq("agent_id", userId).maybeSingle(),
    db.from("account_unsuspend_requests").select("id").eq("user_id", userId).eq("status", "auto_unsuspended").gte("created_at", thirtyDaysAgo),
    db.from("system_logs").select("event, message, ts").eq("agent_id", userId).order("ts", { ascending: false }).limit(5),
  ]);

  const violations = violRes.data || [];
  const openAml = amlRes.data || [];
  const cloneFlags = cloneRes.data || [];
  const walletBalance = Number(walletRes.data?.balance ?? 0);
  const selfUnsuspends30d = (recentSelfRes.data || []).length;
  const strikeCount = Number(profile?.security_violation_count || 0);

  let isSecurityBreach = false;
  let reason = "Account restricted by automated velocity or security monitoring.";

  if (openAml.length > 0) {
    isSecurityBreach = true;
    reason = `Security breach — AML alert (${openAml[0].alert_type}, risk ${openAml[0].risk_score}/100)`;
  } else if (cloneFlags.length > 0) {
    isSecurityBreach = true;
    reason = `Security breach — Multi-account / clone flag (${cloneFlags[0].matching_criteria || "duplicate identity"})`;
  } else if (strikeCount >= 2 || violations.length >= 2) {
    isSecurityBreach = true;
    reason = `Security breach — Repeat security violation (Strike ${Math.max(strikeCount, violations.length)}: ${violations[0]?.reason || "policy violation"})`;
  } else if (walletBalance < -0.5) {
    isSecurityBreach = true;
    reason = `Security breach — Negative wallet balance (GH₵${walletBalance.toFixed(2)})`;
  } else if (selfUnsuspends30d >= 2) {
    isSecurityBreach = true;
    reason = `Security review required — Exceeded self-unsuspend limit (${selfUnsuspends30d}x in 30 days)`;
  } else if (violations.length === 1) {
    const r = String(violations[0].reason || "").toLowerCase();
    if (r.includes("exploit") || r.includes("tamper") || r.includes("price") || r.includes("fraud") || r.includes("bypass")) {
      isSecurityBreach = true;
      reason = `Security breach — ${violations[0].reason}`;
    } else {
      reason = violations[0].reason || "Temporary automated security hold";
    }
  } else if (logsRes.data && logsRes.data.length > 0) {
    const matchLog = logsRes.data.find((l: any) =>
      String(l.message || "").toLowerCase().includes("suspend") ||
      String(l.message || "").toLowerCase().includes("velocity") ||
      String(l.event || "").toLowerCase().includes("security")
    );
    if (matchLog?.message) reason = String(matchLog.message).slice(0, 180);
    else reason = "Rapid order velocity limit (>5 orders/min) or IP/session change";
  } else {
    reason = "Rapid order velocity limit (>5 orders/min) or automated security check";
  }

  return { isSecurityBreach, reason, selfUnsuspends30d, strikeCount };
}

async function notifyAllAdmins(
  db: any,
  supabaseUrl: string,
  serviceKey: string,
  opts: { smsText: string; pushTitle: string; pushBody: string; link?: string }
) {
  const { data: admins } = await db
    .from("profiles")
    .select("user_id, phone")
    .eq("role", "admin")
    .limit(10);

  const adminRows = admins || [];

  // 1. Admin SMS
  try {
    const smsCfg = await getSmsConfig(db);
    if (smsCfg?.apiKey) {
      for (const adm of adminRows) {
        if (!adm.phone) continue;
        const phone = normalizePhone(adm.phone);
        if (!phone) continue;
        await dispatchUnifiedSms(smsCfg.gateway, smsCfg.apiKey, smsCfg.senderId, phone, opts.smsText.slice(0, 300), "custom");
      }
    }
  } catch (e) {
    console.error("[self-unsuspend] Admin SMS failed:", e);
  }

  // 2. Dashboard Notification
  try {
    await db.rpc("notify_admins", {
      p_title: opts.pushTitle,
      p_message: opts.pushBody,
      p_link: opts.link || "/admin/security",
    });
  } catch (e) {
    console.error("[self-unsuspend] notify_admins failed:", e);
  }

  // 3. Web Push Notification to each admin
  for (const adm of adminRows) {
    if (!adm.user_id) continue;
    fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        user_id: adm.user_id,
        title: opts.pushTitle,
        body: opts.pushBody,
        url: opts.link || "/admin/security",
      }),
    }).catch(() => {});
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Server misconfigured" }, 500);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const body = await Promise.resolve(req.json()).catch(() => ({}));
    const action = String(body?.action || "status").toLowerCase();

    // ── ADMIN DECISION (APPROVE / REJECT FROM LIVE POPUP) ────────────────────
    if (action === "admin_decision") {
      const adminAuth = await verifyAdmin(req, db, { checkMfa: false });
      if (!adminAuth.success) return json({ error: adminAuth.error || "Unauthorized" }, adminAuth.status || 401);

      const requestId = String(body?.request_id || "").trim();
      const decision = String(body?.decision || "").toLowerCase();
      const adminNote = String(body?.admin_note || "").trim() || null;

      if (!requestId || !["approve", "reject"].includes(decision)) {
        return json({ error: "request_id and decision ('approve' | 'reject') are required" }, 400);
      }

      const { data: reqRow } = await db
        .from("account_unsuspend_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();

      if (!reqRow) return json({ error: "Unsuspend request not found" }, 404);

      if (decision === "approve") {
        await db
          .from("profiles")
          .update({
            is_suspended: false,
            terminal_locked: false,
            suspended_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", reqRow.user_id);

        await db
          .from("account_unsuspend_requests")
          .update({
            status: "approved",
            admin_note: adminNote,
            reviewed_by: adminAuth.user?.id || null,
            reviewed_at: new Date().toISOString(),
          })
          .eq("id", requestId);

        // Notify user via SMS
        try {
          const smsCfg = await getSmsConfig(db);
          const normPhone = normalizePhone(reqRow.phone);
          if (smsCfg?.apiKey && normPhone) {
            await dispatchUnifiedSms(
              smsCfg.gateway,
              smsCfg.apiKey,
              smsCfg.senderId,
              normPhone,
              "SwiftData: Your account suspension review has been approved by Admin. You can now log in and use your account normally.",
              "custom"
            );
          }
        } catch { /* non-critical */ }

        return json({ success: true, status: "approved", user_id: reqRow.user_id });
      } else {
        await db
          .from("account_unsuspend_requests")
          .update({
            status: "rejected",
            admin_note: adminNote || "Kept suspended after admin security review",
            reviewed_by: adminAuth.user?.id || null,
            reviewed_at: new Date().toISOString(),
          })
          .eq("id", requestId);

        try {
          const smsCfg = await getSmsConfig(db);
          const normPhone = normalizePhone(reqRow.phone);
          if (smsCfg?.apiKey && normPhone) {
            await dispatchUnifiedSms(
              smsCfg.gateway,
              smsCfg.apiKey,
              smsCfg.senderId,
              normPhone,
              "SwiftData: Your unsuspend request was declined after security review. Please contact support for assistance.",
              "custom"
            );
          }
        } catch { /* non-critical */ }

        return json({ success: true, status: "rejected", user_id: reqRow.user_id });
      }
    }

    // ── USER-AUTHENTICATED ACTIONS (status / request_otp / verify_otp) ───────
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return json({ error: "Unauthorized" }, 401);

    const { data: userData, error: userErr } = await db.auth.getUser(bearer);
    if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);
    const userId = userData.user.id;

    const { data: profile } = await db
      .from("profiles")
      .select("user_id, full_name, email, phone, is_suspended, terminal_locked, suspended_until, security_violation_count")
      .eq("user_id", userId)
      .maybeSingle();

    if (!profile) return json({ error: "Profile not found" }, 404);

    if (!profile.is_suspended && !profile.terminal_locked) {
      return json({ success: true, already_active: true, message: "Your account is already active." });
    }

    const assessment = await assessSuspension(db, userId, profile);
    const userPhone = normalizePhone(profile.phone || "");

    // ── ACTION: STATUS ───────────────────────────────────────────────────────
    if (action === "status") {
      const { data: pendingReq } = await db
        .from("account_unsuspend_requests")
        .select("id, status, created_at, suspension_reason")
        .eq("user_id", userId)
        .eq("status", "pending_admin_approval")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return json({
        success: true,
        is_suspended: Boolean(profile.is_suspended),
        terminal_locked: Boolean(profile.terminal_locked),
        suspended_until: profile.suspended_until,
        has_phone: Boolean(userPhone),
        masked_phone: userPhone ? maskPhone(userPhone) : null,
        suspension_reason: assessment.reason,
        is_security_breach: assessment.isSecurityBreach,
        pending_request: pendingReq || null,
      });
    }

    // ── ACTION: REQUEST OTP ──────────────────────────────────────────────────
    if (action === "request_otp") {
      if (!userPhone) {
        return json({ error: "No phone number is registered on your account. Please contact support." }, 400);
      }

      // Rate limit: 1 OTP per 60 seconds
      const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
      const { data: recentOtp } = await db
        .from("account_unsuspend_requests")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "otp_sent")
        .gte("created_at", oneMinAgo)
        .limit(1);

      if (recentOtp && recentOtp.length > 0) {
        return json({ error: "OTP already sent. Please wait 60 seconds before requesting another code." }, 429);
      }

      const otp = generateSixDigitOtp();
      const otpHash = await sha256Hex(`${userId}:${otp}`);
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

      const { data: created, error: insErr } = await db
        .from("account_unsuspend_requests")
        .insert({
          user_id: userId,
          user_name: profile.full_name || "SwiftData User",
          user_email: profile.email || userData.user.email || "",
          phone: userPhone,
          suspension_reason: assessment.reason,
          is_security_breach: assessment.isSecurityBreach,
          otp_hash: otpHash,
          otp_expires_at: expiresAt,
          status: "otp_sent",
        })
        .select("id")
        .single();

      if (insErr) throw insErr;

      const smsCfg = await getSmsConfig(db);
      if (!smsCfg?.apiKey) {
        return json({ error: "SMS service is temporarily unavailable. Please contact support." }, 503);
      }

      await dispatchUnifiedSms(
        smsCfg.gateway,
        smsCfg.apiKey,
        smsCfg.senderId,
        userPhone,
        `SwiftData Verification Code: ${otp}. Enter this code within 10 minutes to verify your phone and restore your account.`,
        "otp"
      );

      return json({
        success: true,
        request_id: created.id,
        masked_phone: maskPhone(userPhone),
        is_security_breach: assessment.isSecurityBreach,
        message: `A 6-digit verification code has been sent to ${maskPhone(userPhone)}.`,
      });
    }

    // ── ACTION: VERIFY OTP ───────────────────────────────────────────────────
    if (action === "verify_otp") {
      const code = String(body?.otp || "").replace(/\D+/g, "").trim();
      if (code.length !== 6) {
        return json({ error: "Please enter the 6-digit verification code." }, 400);
      }

      const { data: reqRow } = await db
        .from("account_unsuspend_requests")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "otp_sent")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!reqRow) {
        return json({ error: "No active verification code found. Please request a new OTP." }, 400);
      }

      if (reqRow.otp_expires_at && new Date(reqRow.otp_expires_at).getTime() < Date.now()) {
        await db.from("account_unsuspend_requests").update({ status: "expired" }).eq("id", reqRow.id);
        return json({ error: "Verification code expired. Please request a new OTP." }, 400);
      }

      if (Number(reqRow.otp_attempts || 0) >= 5) {
        await db.from("account_unsuspend_requests").update({ status: "expired" }).eq("id", reqRow.id);
        return json({ error: "Too many incorrect attempts. Please request a new OTP." }, 429);
      }

      const expectedHash = await sha256Hex(`${userId}:${code}`);
      if (expectedHash !== reqRow.otp_hash) {
        await db
          .from("account_unsuspend_requests")
          .update({ otp_attempts: Number(reqRow.otp_attempts || 0) + 1 })
          .eq("id", reqRow.id);
        return json({ error: "Incorrect verification code. Please try again." }, 400);
      }

      const verifiedAt = new Date().toISOString();
      const userName = profile.full_name || profile.email || "User";

      if (assessment.isSecurityBreach) {
        // SECURITY BREACH -> Hold for Admin Approval + Instant SMS + Web Push + Live Admin Popup
        await db
          .from("account_unsuspend_requests")
          .update({
            status: "pending_admin_approval",
            otp_verified_at: verifiedAt,
            suspension_reason: assessment.reason,
            is_security_breach: true,
          })
          .eq("id", reqRow.id);

        await notifyAllAdmins(db, SUPABASE_URL, SERVICE_KEY, {
          smsText: `[SECURITY APPROVAL] ${userName} (${userPhone}) verified OTP to unsuspend. Reason: ${assessment.reason}. Open Admin Dashboard to Approve or Reject.`,
          pushTitle: `🚨 Unsuspend Approval Needed: ${userName}`,
          pushBody: `Phone verified via OTP. Suspended due to: ${assessment.reason}`,
          link: "/admin/security",
        });

        await db.from("system_logs").insert({
          level: "warning",
          source: "self-unsuspend",
          event: "unsuspend.pending_admin_approval",
          agent_id: userId,
          message: `${userName} verified OTP but requires admin approval (security breach: ${assessment.reason})`,
          data: { request_id: reqRow.id, reason: assessment.reason },
        });

        return json({
          success: true,
          unsuspended: false,
          pending_admin_approval: true,
          message: "Phone verified! Because your account was flagged for a security review, an instant approval alert has been sent to Admin.",
        });
      } else {
        // SOFT RESTRICTION -> Auto-Unsuspend Immediately + Notify Admin via SMS why they were suspended
        await db
          .from("profiles")
          .update({
            is_suspended: false,
            terminal_locked: false,
            suspended_until: null,
            updated_at: verifiedAt,
          })
          .eq("user_id", userId);

        await db
          .from("account_unsuspend_requests")
          .update({
            status: "auto_unsuspended",
            otp_verified_at: verifiedAt,
            reviewed_at: verifiedAt,
          })
          .eq("id", reqRow.id);

        await notifyAllAdmins(db, SUPABASE_URL, SERVICE_KEY, {
          smsText: `[SwiftData] ${userName} (${userPhone}) self-unsuspended via OTP. Original reason: ${assessment.reason}.`,
          pushTitle: `✅ User Self-Unsuspended: ${userName}`,
          pushBody: `Verified phone via OTP. Original reason: ${assessment.reason}`,
          link: "/admin/security",
        });

        await db.from("system_logs").insert({
          level: "info",
          source: "self-unsuspend",
          event: "unsuspend.auto_released_otp",
          agent_id: userId,
          message: `${userName} self-unsuspended via SMS OTP. Original reason: ${assessment.reason}`,
          data: { request_id: reqRow.id, reason: assessment.reason },
        });

        return json({
          success: true,
          unsuspended: true,
          pending_admin_approval: false,
          message: "Phone verified! Your account has been restored.",
        });
      }
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error("[self-unsuspend] Error:", err);
    return json({ error: err?.message || "Internal server error" }, 500);
  }
});
