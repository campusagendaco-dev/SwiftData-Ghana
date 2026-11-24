// Self-unsuspend, rebuilt safely (2026-11-24). A code sent to the user's phone can only lift
// the system's OWN timed hold early (strike 1 or 2, suspended_until set, at most 24 h, no
// fraud signals). Every other suspension (permanent, admin-made, AI-agent-approved, terminal
// lock) goes to an admin, who decides once with 2FA through the confirmation box.
// Codes are stored as an HMAC with a server secret and are never readable by users.

import { localGhPhone } from "./ama_actions.ts";

export const MAX_CODES_PER_DAY = 5;
export const CODE_COOLDOWN_MS = 60_000;
export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
const MAX_TIMED_HOLD_MS = 25 * 3_600_000; // the strike system holds for 12 h or 24 h
const SERVICE_ROLE_USER_ID = "00000000-0000-0000-0000-000000000000";

type Profile = {
  user_id: string;
  full_name?: string | null;
  phone?: string | null;
  is_suspended: boolean;
  terminal_locked?: boolean | null;
  suspended_until?: string | null;
  security_violation_count?: number | null;
};
type Signals = { openAml: number; cloneFlags: number; walletBalance: number; recentSelfReleases: number };
type Res = { status: number; body: Record<string, unknown> };
export type UnsuspendDeps = {
  now: Date;
  secret: string;
  sendSms: (phone: string, text: string) => Promise<boolean>;
  notifyAdmins: (text: string) => Promise<void>;
  makeCode?: () => string;
};

export function classifyHold(p: Profile, s: Signals, now: Date): { route: "self_release" | "admin_review"; reason: string } {
  const review = (reason: string) => ({ route: "admin_review" as const, reason });
  if (p.terminal_locked) return review("The account's terminal is locked. An admin needs to review it.");
  if (s.openAml > 0) return review("There's an open money-laundering alert on the account.");
  if (s.cloneFlags > 0) return review("The account is flagged as a possible duplicate account.");
  if (s.walletBalance < -0.5) return review("The wallet balance is negative.");
  if (s.recentSelfReleases >= 2) return review("The account was already released by code twice in the last 30 days.");
  const strikes = Number(p.security_violation_count || 0);
  const until = p.suspended_until ? new Date(p.suspended_until).getTime() : NaN;
  const timed = Number.isFinite(until) && until > now.getTime() && until - now.getTime() <= MAX_TIMED_HOLD_MS;
  if (!timed || strikes < 1 || strikes > 2) return review("The account was suspended by an administrator or for a serious reason. An admin needs to review it.");
  return { route: "self_release", reason: `Temporary automatic hold (strike ${strikes}) until ${new Date(until).toISOString().slice(0, 16).replace("T", " ")} UTC.` };
}

export async function otpDigest(secret: string, requestId: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${requestId}:${code}`));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sixDigitCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

const maskPhone = (phone: string) => `${phone.slice(0, 3)}****${phone.slice(-3)}`;

async function loadProfile(db: any, userId: string): Promise<Profile | null> {
  const { data } = await db.from("profiles")
    .select("user_id, full_name, phone, is_suspended, terminal_locked, suspended_until, security_violation_count")
    .eq("user_id", userId).maybeSingle();
  return data ?? null;
}

async function loadSignals(db: any, userId: string, now: Date): Promise<Signals> {
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [aml, primary, dup, wallet, released] = await Promise.all([
    db.from("aml_alerts").select("id").eq("agent_id", userId).eq("is_resolved", false).limit(5),
    db.from("duplicate_account_flags").select("id").eq("primary_user_id", userId).limit(5),
    db.from("duplicate_account_flags").select("id").contains("duplicate_user_ids", [userId]).limit(5),
    db.from("wallets").select("balance").eq("agent_id", userId).maybeSingle(),
    db.from("account_unsuspend_requests").select("id").eq("user_id", userId).in("status", ["self_released", "auto_unsuspended"]).gte("created_at", monthAgo).limit(5),
  ]);
  return {
    openAml: (aml.data || []).length,
    cloneFlags: (primary.data || []).length + (dup.data || []).length,
    walletBalance: Number(wallet.data?.balance ?? 0),
    recentSelfReleases: (released.data || []).length,
  };
}

export async function unsuspendStatus(db: any, userId: string, deps: UnsuspendDeps): Promise<Res> {
  const p = await loadProfile(db, userId);
  if (!p) return { status: 404, body: { error: "Profile not found" } };
  if (!p.is_suspended && !p.terminal_locked) return { status: 200, body: { success: true, already_active: true, is_suspended: false } };
  const hold = classifyHold(p, await loadSignals(db, userId, deps.now), deps.now);
  const phone = localGhPhone(p.phone);
  const { data: pending } = await db.from("account_unsuspend_requests").select("id, status, created_at")
    .eq("user_id", userId).eq("status", "pending_admin_approval").limit(1).maybeSingle();
  return {
    status: 200,
    body: {
      success: true,
      is_suspended: Boolean(p.is_suspended),
      terminal_locked: Boolean(p.terminal_locked),
      suspended_until: p.suspended_until ?? null,
      has_phone: Boolean(phone),
      masked_phone: phone ? maskPhone(phone) : null,
      suspension_reason: hold.reason,
      route: hold.route,
      is_security_breach: hold.route === "admin_review",
      pending_request: pending ?? null,
    },
  };
}

export async function requestCode(db: any, userId: string, deps: UnsuspendDeps): Promise<Res> {
  const p = await loadProfile(db, userId);
  if (!p) return { status: 404, body: { error: "Profile not found" } };
  if (!p.is_suspended && !p.terminal_locked) return { status: 200, body: { success: true, already_active: true } };
  const phone = localGhPhone(p.phone);
  if (!phone) return { status: 400, body: { error: "No phone number is registered on your account. Please contact support." } };

  const dayAgo = new Date(deps.now.getTime() - 86_400_000).toISOString();
  const { data: today } = await db.from("account_unsuspend_requests").select("id, created_at").eq("user_id", userId).gte("created_at", dayAgo).limit(MAX_CODES_PER_DAY + 1);
  const recent = today || [];
  if (recent.length >= MAX_CODES_PER_DAY) return { status: 429, body: { error: `You've asked for ${MAX_CODES_PER_DAY} codes today. Try again tomorrow or contact support.` } };
  if (recent.some((r: any) => deps.now.getTime() - new Date(r.created_at).getTime() < CODE_COOLDOWN_MS)) {
    return { status: 429, body: { error: "A code was just sent. Please wait a minute before asking again." } };
  }

  const hold = classifyHold(p, await loadSignals(db, userId, deps.now), deps.now);
  const id = crypto.randomUUID();
  const code = (deps.makeCode ?? sixDigitCode)();
  const { error } = await db.from("account_unsuspend_requests").insert({
    id,
    user_id: userId,
    user_name: p.full_name || null,
    phone,
    suspension_reason: hold.reason,
    route: hold.route,
    status: "otp_sent",
    otp_digest: await otpDigest(deps.secret, id, code),
    otp_expires_at: new Date(deps.now.getTime() + CODE_TTL_MS).toISOString(),
    otp_attempts: 0,
    created_at: deps.now.toISOString(),
  });
  if (error) return { status: 500, body: { error: error.message } };
  const sent = await deps.sendSms(phone, `SwiftData code: ${code}. It expires in 10 minutes. Never share it with anyone.`);
  if (!sent) return { status: 503, body: { error: "We couldn't send the SMS right now. Please try again later." } };
  return { status: 200, body: { success: true, request_id: id, masked_phone: maskPhone(phone), is_security_breach: hold.route === "admin_review", message: `A 6-digit code was sent to ${maskPhone(phone)}.` } };
}

export async function verifyCode(db: any, userId: string, rawCode: string, deps: UnsuspendDeps): Promise<Res> {
  const code = String(rawCode || "").replace(/\D/g, "");
  if (code.length !== 6) return { status: 400, body: { error: "Please enter the 6-digit code." } };
  const { data: req } = await db.from("account_unsuspend_requests").select("*")
    .eq("user_id", userId).eq("status", "otp_sent").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!req) return { status: 400, body: { error: "No active code. Please ask for a new one." } };
  if (new Date(req.otp_expires_at).getTime() < deps.now.getTime()) {
    await db.from("account_unsuspend_requests").update({ status: "expired" }).eq("id", req.id);
    return { status: 400, body: { error: "That code has expired. Please ask for a new one." } };
  }
  if (Number(req.otp_attempts || 0) >= MAX_ATTEMPTS) {
    await db.from("account_unsuspend_requests").update({ status: "expired" }).eq("id", req.id);
    return { status: 429, body: { error: "Too many wrong tries. Please ask for a new code." } };
  }
  if (!sameString(await otpDigest(deps.secret, req.id, code), String(req.otp_digest || ""))) {
    await db.from("account_unsuspend_requests").update({ otp_attempts: Number(req.otp_attempts || 0) + 1 }).eq("id", req.id);
    return { status: 400, body: { error: "That code isn't right. Please try again." } };
  }

  const p = await loadProfile(db, userId);
  if (!p) return { status: 404, body: { error: "Profile not found" } };
  const hold = classifyHold(p, await loadSignals(db, userId, deps.now), deps.now); // re-checked now, not when the code was sent
  const verifiedAt = deps.now.toISOString();

  if (hold.route === "self_release") {
    const { data: released } = await db.from("profiles").update({ is_suspended: false, suspended_until: null, updated_at: verifiedAt })
      .eq("user_id", userId).eq("is_suspended", true).eq("terminal_locked", false).select("user_id");
    await db.from("account_unsuspend_requests").update({ status: "self_released", otp_verified_at: verifiedAt, suspension_reason: hold.reason }).eq("id", req.id);
    if (!(released || []).length) return { status: 409, body: { error: "Your account changed while you were verifying. Please refresh." } };
    return { status: 200, body: { success: true, unsuspended: true, pending_admin_approval: false, message: "Phone verified! Your account has been restored." } };
  }

  const { data: moved } = await db.from("account_unsuspend_requests")
    .update({ status: "pending_admin_approval", otp_verified_at: verifiedAt, route: "admin_review", suspension_reason: hold.reason })
    .eq("id", req.id).eq("status", "otp_sent").select("id");
  if ((moved || []).length) {
    await deps.notifyAdmins(`${p.full_name || "A user"} (${maskPhone(String(req.phone))}) verified their phone and asks to be unsuspended. Reason held: ${hold.reason} Review it on the admin dashboard.`);
  }
  return { status: 200, body: { success: true, unsuspended: false, pending_admin_approval: true, message: "Phone verified. An admin will review your account and you'll get an SMS with the decision." } };
}

export async function adminDecide(
  db: any,
  input: { adminId: string; requestId: string; decision: "approve" | "reject"; note?: string | null },
  deps: UnsuspendDeps,
): Promise<Res> {
  if (!input.adminId || input.adminId === SERVICE_ROLE_USER_ID) return { status: 403, body: { error: "Only a signed-in admin can decide" } };
  if (input.decision !== "approve" && input.decision !== "reject") return { status: 400, body: { error: "decision must be approve or reject" } };
  const reviewedAt = deps.now.toISOString();
  const { data: req } = await db.from("account_unsuspend_requests")
    .update({ status: input.decision === "approve" ? "approved" : "rejected", reviewed_by: input.adminId, reviewed_at: reviewedAt, admin_note: input.note ?? null })
    .eq("id", input.requestId).eq("status", "pending_admin_approval").select("id, user_id, phone").maybeSingle();
  if (!req) return { status: 409, body: { error: "This request was already decided or isn't waiting for review." } };

  if (input.decision === "approve") {
    await db.from("profiles").update({ is_suspended: false, suspended_until: null, updated_at: reviewedAt }).eq("user_id", req.user_id);
  }
  await db.from("audit_logs").insert({
    admin_id: input.adminId,
    action: input.decision === "approve" ? "unsuspend_request_approved" : "unsuspend_request_rejected",
    details: { request_id: req.id, user_id: req.user_id, note: input.note ?? null },
  });
  const phone = localGhPhone(req.phone);
  if (phone) {
    await deps.sendSms(phone, input.decision === "approve"
      ? "SwiftData: an admin reviewed your account and lifted the suspension. You can use your account again."
      : "SwiftData: an admin reviewed your account and it stays suspended. Please contact support if you need help.");
  }
  return { status: 200, body: { success: true, status: input.decision === "approve" ? "approved" : "rejected", user_id: req.user_id } };
}
