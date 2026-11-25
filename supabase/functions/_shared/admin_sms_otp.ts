// Admin SMS login, hardened (owner decision 2026-11-24, option B):
// - switched on per admin by ANOTHER admin signed in with the authenticator app; off by default
// - the code goes only to the phone pinned when it was switched on (not the editable profile phone)
// - codes are stored as an HMAC with a server secret; 5 min to use, 5 tries, 5 codes a day
// - a verified code gives a 4-hour session tied to that one login; other admins are alerted
// - an SMS login can view and do everyday work, but money, sends and admin-access actions
//   still need the authenticator app (needsAuthenticatorApp, admin_strong() in the database)

import { localGhPhone } from "./ama_actions.ts";

export const SMS_SESSION_HOURS = 4;
export const MAX_SMS_CODES_PER_DAY = 5;
const CODE_TTL_MS = 5 * 60_000;
const COOLDOWN_MS = 60_000;
export const COOLDOWN_SECONDS = Math.ceil(COOLDOWN_MS / 1000);
const MAX_ATTEMPTS = 5;
const SERVICE_ROLE_USER_ID = "00000000-0000-0000-0000-000000000000";

type Res = { status: number; body: Record<string, unknown> };
export type SmsDeps = {
  now: Date;
  secret: string;
  sendSms: (phone: string, text: string) => Promise<boolean>;
  alertOtherAdmins: (exceptUserId: string, text: string) => Promise<void>;
  makeCode?: () => string;
};

/** Actions an SMS login may never do: money, sends, messaging, admin access, security settings. */
const NEEDS_APP: Record<string, Set<string>> = {
  "system-payout-v1": new Set([
    "manual_topup", "manual_api_topup", "update_credit_limit", "confirm_withdrawal", "reject_withdrawal",
    "paystack_payout", "bulk_fulfill_api_orders", "grant_admin_role", "revoke_admin_role", "reset_user_mfa",
    "save_package_settings", "approve_all_pending_agents", "generate_api_key", "test_direct_korba", "test_korba_payload",
  ]),
  "admin-user-actions": new Set([
    "refund_order", "decide_wallet_adjustment", "force_fulfill_order", "heal_stuck_orders", "bulk_update_order_status",
    "grant_admin_role", "revoke_admin_role", "update_system_settings", "reset_transaction_pin", "revoke_sessions",
    "send_reset_link", "manage_blacklist", "purge_bot_spam",
  ]),
};

export function needsAuthenticatorApp(fn: string, action: unknown): boolean {
  return NEEDS_APP[fn]?.has(String(action ?? "")) ?? false;
}

type RoleRow = { user_id?: string; role?: string; otp_login_approved?: boolean | null; otp_phone?: string | null };

export function smsLoginAllowed(role: RoleRow | null | undefined): boolean {
  return Boolean(role && role.role === "admin" && role.otp_login_approved === true && /^233\d{9}$/.test(String(role.otp_phone || "")));
}

export async function codeDigest(secret: string, rowId: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${rowId}:${code}`));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameString(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function sixDigits() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(100000 + (a[0] % 900000));
}

const mask = (phone233: string) => {
  const local = localGhPhone(phone233) || phone233;
  return `${local.slice(0, 3)}****${local.slice(-3)}`;
};

async function adminRole(db: any, userId: string): Promise<RoleRow | null> {
  // An admin can be listed more than once; .maybeSingle() would fail and hide the SMS option.
  const { data } = await db.from("user_roles").select("user_id, role, otp_login_approved, otp_phone").eq("user_id", userId).eq("role", "admin");
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as RoleRow[];
  return rows.find(smsLoginAllowed) ?? rows[0] ?? null;
}

export async function smsStatus(db: any, input: { userId: string; sessionId: string }, deps: SmsDeps): Promise<Res> {
  const role = await adminRole(db, input.userId);
  if (!role) {
    return {
      status: 200,
      body: {
        success: true,
        eligible: false,
        has_phone: false,
        masked_phone: null,
        has_valid_session: false,
        cooldown_seconds: 0,
        daily_limit_reached: false,
        codes_remaining_today: MAX_SMS_CODES_PER_DAY,
        has_pending_code: false,
      },
    };
  }
  const eligible = smsLoginAllowed(role);
  let has_valid_session = false;
  let expires_at: string | null = null;
  let cooldown_seconds = 0;
  let daily_limit_reached = false;
  let codes_remaining_today = MAX_SMS_CODES_PER_DAY;
  let has_pending_code = false;
  if (eligible && input.sessionId) {
    const { data: s } = await db.from("admin_otp_sessions").select("id, expires_at").eq("user_id", input.userId).eq("session_id", input.sessionId)
      .not("verified_at", "is", null).gt("expires_at", deps.now.toISOString()).limit(1).maybeSingle();
    has_valid_session = Boolean(s);
    expires_at = s?.expires_at ?? null;
    if (!has_valid_session) {
      const dayAgo = new Date(deps.now.getTime() - 86_400_000).toISOString();
      const { data: today } = await db.from("admin_otp_sessions").select("id, session_id, created_at, verified_at, otp_expires_at").eq("user_id", input.userId).gte("created_at", dayAgo).limit(MAX_SMS_CODES_PER_DAY + 1);
      const recent = Array.isArray(today) ? today : [];
      codes_remaining_today = Math.max(0, MAX_SMS_CODES_PER_DAY - recent.length);
      daily_limit_reached = recent.length >= MAX_SMS_CODES_PER_DAY;
      let maxCooldownMs = 0;
      for (const r of recent) {
        const createdMs = r?.created_at ? new Date(r.created_at).getTime() : 0;
        if (createdMs > 0) {
          const remainingMs = COOLDOWN_MS - (deps.now.getTime() - createdMs);
          if (remainingMs > maxCooldownMs) maxCooldownMs = remainingMs;
        }
        if (
          r?.session_id === input.sessionId &&
          !r?.verified_at &&
          r?.otp_expires_at &&
          new Date(r.otp_expires_at).getTime() > deps.now.getTime()
        ) {
          has_pending_code = true;
        }
      }
      cooldown_seconds = maxCooldownMs > 0 ? Math.max(1, Math.ceil(maxCooldownMs / 1000)) : 0;
    }
  }
  return {
    status: 200,
    body: {
      success: true,
      eligible,
      has_phone: eligible,
      masked_phone: eligible ? mask(String(role.otp_phone)) : null,
      has_valid_session,
      expires_at,
      cooldown_seconds,
      daily_limit_reached,
      codes_remaining_today,
      has_pending_code,
    },
  };
}

export async function requestSmsCode(db: any, input: { userId: string; sessionId: string }, deps: SmsDeps): Promise<Res> {
  const role = await adminRole(db, input.userId);
  if (!smsLoginAllowed(role)) return { status: 403, body: { error: "SMS login isn't switched on for your account. Use your authenticator app." } };
  if (!input.sessionId) return { status: 400, body: { error: "Please sign in again." } };
  const dayAgo = new Date(deps.now.getTime() - 86_400_000).toISOString();
  const { data: today } = await db.from("admin_otp_sessions").select("id, created_at").eq("user_id", input.userId).gte("created_at", dayAgo).limit(MAX_SMS_CODES_PER_DAY + 1);
  const recent = today || [];
  if (recent.length >= MAX_SMS_CODES_PER_DAY) {
    return {
      status: 429,
      body: {
        error: `You've asked for ${MAX_SMS_CODES_PER_DAY} SMS codes today. Use your authenticator app.`,
        daily_limit_reached: true,
        codes_remaining_today: 0,
      },
    };
  }
  let maxCooldownMs = 0;
  for (const r of recent) {
    const createdMs = r?.created_at ? new Date(r.created_at).getTime() : 0;
    if (createdMs > 0) {
      const remainingMs = COOLDOWN_MS - (deps.now.getTime() - createdMs);
      if (remainingMs > maxCooldownMs) maxCooldownMs = remainingMs;
    }
  }
  if (maxCooldownMs > 0) {
    const retryAfter = Math.max(1, Math.ceil(maxCooldownMs / 1000));
    return {
      status: 429,
      body: {
        error: `A code was just sent. Please wait ${retryAfter}s before requesting another.`,
        retry_after_seconds: retryAfter,
      },
    };
  }
  const id = crypto.randomUUID();
  const code = (deps.makeCode ?? sixDigits)();
  const { error } = await db.from("admin_otp_sessions").insert({
    id,
    user_id: input.userId,
    session_id: input.sessionId,
    phone: role!.otp_phone,
    otp_hash: await codeDigest(deps.secret, id, code),
    otp_expires_at: new Date(deps.now.getTime() + CODE_TTL_MS).toISOString(),
    otp_attempts: 0,
    verified_at: null,
    expires_at: null,
    created_at: deps.now.toISOString(),
  });
  if (error) return { status: 500, body: { error: error.message } };
  const sent = await deps.sendSms(localGhPhone(role!.otp_phone) || String(role!.otp_phone), `SwiftData admin sign-in code: ${code}. It expires in 5 minutes. Never share it.`);
  if (!sent) return { status: 503, body: { error: "We couldn't send the SMS. Use your authenticator app." } };
  return {
    status: 200,
    body: {
      success: true,
      masked_phone: mask(String(role!.otp_phone)),
      message: `Code sent to ${mask(String(role!.otp_phone))}.`,
      cooldown_seconds: COOLDOWN_SECONDS,
      codes_remaining_today: Math.max(0, MAX_SMS_CODES_PER_DAY - (recent.length + 1)),
    },
  };
}

export async function verifySmsCode(db: any, input: { userId: string; sessionId: string; code: string }, deps: SmsDeps): Promise<Res> {
  const role = await adminRole(db, input.userId);
  if (!smsLoginAllowed(role)) return { status: 403, body: { error: "SMS login isn't switched on for your account." } };
  const code = String(input.code || "").replace(/\D/g, "");
  if (code.length !== 6) return { status: 400, body: { error: "Enter the 6-digit code." } };
  const { data: row } = await db.from("admin_otp_sessions").select("*").eq("user_id", input.userId).eq("session_id", input.sessionId)
    .is("verified_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!row) return { status: 400, body: { error: "No active code. Ask for a new one." } };
  if (new Date(row.otp_expires_at).getTime() < deps.now.getTime()) return { status: 400, body: { error: "That code expired. Ask for a new one." } };
  if (Number(row.otp_attempts || 0) >= MAX_ATTEMPTS) return { status: 429, body: { error: "Too many wrong tries. Ask for a new code." } };
  if (!sameString(await codeDigest(deps.secret, row.id, code), String(row.otp_hash || ""))) {
    await db.from("admin_otp_sessions").update({ otp_attempts: Number(row.otp_attempts || 0) + 1 }).eq("id", row.id);
    return { status: 400, body: { error: "That code isn't right." } };
  }
  const expires = new Date(deps.now.getTime() + SMS_SESSION_HOURS * 3_600_000).toISOString();
  await db.from("admin_otp_sessions").update({ verified_at: deps.now.toISOString(), expires_at: expires }).eq("id", row.id).is("verified_at", null);
  await deps.alertOtherAdmins(input.userId, `An admin signed in with an SMS code sent to ${mask(String(role!.otp_phone))} at ${deps.now.toISOString().slice(11, 16)} UTC. If this wasn't expected, switch off their SMS login on the Administrators tab.`);
  return { status: 200, body: { success: true, expires_at: expires } };
}

export async function setSmsApproval(
  db: any,
  input: { adminId: string; adminSecondFactor: "authenticator" | "sms"; targetUserId: string; approved: boolean; phone: string | null },
  deps: SmsDeps,
): Promise<Res> {
  if (!input.adminId || input.adminId === SERVICE_ROLE_USER_ID) return { status: 403, body: { error: "Only a signed-in admin can change this" } };
  if (input.adminSecondFactor !== "authenticator") return { status: 403, body: { error: "Changing SMS login needs your authenticator app." } };
  const self = input.adminId === input.targetUserId;
  const target = await adminRole(db, input.targetUserId);
  if (!target) return { status: 404, body: { error: "That person isn't an admin" } };
  let phone: string | null = null;
  if (self && input.approved) {
    // For yourself: only your own phone, verified by SMS code on the server (profiles.phone_verified
    // can't be set by users), so a stolen session can't pin an attacker's number unnoticed.
    const { data: me } = await db.from("profiles").select("phone, phone_verified").eq("user_id", input.adminId).maybeSingle();
    const own = localGhPhone(me?.phone);
    if (!own || me?.phone_verified !== true) {
      return { status: 403, body: { error: "Verify your own phone number first, then switch SMS login on." } };
    }
    if (input.phone && localGhPhone(input.phone) !== own) {
      return { status: 400, body: { error: "For yourself, SMS codes can only go to your own verified phone number." } };
    }
    phone = `233${own.slice(1)}`;
  } else if (input.approved) {
    const local = localGhPhone(input.phone);
    if (!local) return { status: 400, body: { error: "Enter the admin's Ghana phone number to pin for SMS codes." } };
    phone = `233${local.slice(1)}`;
  }
  const { error } = await db.from("user_roles").update({ otp_login_approved: input.approved, otp_phone: phone }).eq("user_id", input.targetUserId).eq("role", "admin");
  if (error) return { status: 500, body: { error: error.message } };
  if (!input.approved) {
    await db.from("admin_otp_sessions").update({ expires_at: deps.now.toISOString() }).eq("user_id", input.targetUserId).gt("expires_at", deps.now.toISOString());
  }
  await db.from("audit_logs").insert({
    admin_id: input.adminId,
    action: input.approved ? "admin_sms_login_on" : "admin_sms_login_off",
    details: { target_user_id: input.targetUserId, phone_masked: phone ? mask(phone) : null, self },
  });
  if (self && input.approved && phone) {
    await deps.alertOtherAdmins(input.adminId, `An admin switched on SMS login for themselves, with codes going to ${mask(phone)}. If this wasn't expected, switch it off on the Administrators tab.`);
  }
  return { status: 200, body: { success: true, approved: input.approved, masked_phone: phone ? mask(phone) : null } };
}
