// Signup phone verification, hardened (2026-11-24).
// - The phone is marked verified only on the server: a verified code gives a token, and
//   claimToken (signed-in user, same number, within 30 min, once) sets profiles.phone_verified.
// - SMS limits: 1 a minute and 5 a day per number, 10 an hour per network, and an overall
//   cap per hour so a script can't drain SMS credit. The network address comes from the
//   platform (cf-connecting-ip / last x-forwarded-for entry), not from the caller.
// - A phone already verified on another account is allowed, but both are flagged for review.

import { localGhPhone } from "./ama_actions.ts";

export const GLOBAL_CODES_PER_HOUR = 300;
const PER_PHONE_PER_DAY = 5;
const PER_IP_PER_HOUR = 10;
const COOLDOWN_MS = 60_000;
const CODE_TTL_MS = 10 * 60_000;
const TOKEN_TTL_MS = 30 * 60_000;
const MAX_ATTEMPTS = 5;

type Res = { status: number; body: Record<string, unknown> };
export type SignupPhoneDeps = {
  now: Date;
  secret: string;
  sendSms: (phone: string, text: string) => Promise<boolean>;
  makeCode?: () => string;
  makeToken?: () => string;
};

const fail = (error: string): Res => ({ status: 200, body: { success: false, error } });
const mask = (p: string) => `${p.slice(0, 3)}****${p.slice(-3)}`;

/** The caller's network address as the platform saw it. A caller-supplied X-Forwarded-For
 *  is prepended by the client, so the LAST entry is the one the proxy added. */
export function clientIp(h: Headers): string {
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const xff = (h.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (xff.length) return xff[xff.length - 1];
  return h.get("x-real-ip")?.trim() || "unknown";
}

async function digest(secret: string, id: string, phone: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}:${phone}:${code}`));
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

export async function sendSignupCode(db: any, input: { phone: unknown; ip: string }, deps: SignupPhoneDeps): Promise<Res> {
  const phone = localGhPhone(input.phone);
  if (!phone) return fail("Please enter a valid 10-digit Ghana phone number (e.g. 0541234567).");
  const t = deps.now.getTime();
  const iso = (ms: number) => new Date(t - ms).toISOString();

  const [all, perPhone, perIp] = await Promise.all([
    db.from("signup_phone_otps").select("id").gte("created_at", iso(3_600_000)).limit(GLOBAL_CODES_PER_HOUR + 1),
    db.from("signup_phone_otps").select("id, created_at").eq("phone", phone).gte("created_at", iso(86_400_000)).limit(PER_PHONE_PER_DAY + 1),
    input.ip !== "unknown"
      ? db.from("signup_phone_otps").select("id").eq("ip_address", input.ip).gte("created_at", iso(3_600_000)).limit(PER_IP_PER_HOUR + 1)
      : Promise.resolve({ data: [] }),
  ]);
  if ((all.data || []).length >= GLOBAL_CODES_PER_HOUR) return fail("We're getting a lot of sign-ups right now. Please try again in a few minutes.");
  const phoneRows = perPhone.data || [];
  if (phoneRows.some((r: any) => t - new Date(r.created_at).getTime() < COOLDOWN_MS)) return fail("Code already sent. Please wait 60 seconds before asking again.");
  if (phoneRows.length >= PER_PHONE_PER_DAY) return fail("Too many codes for this number today. Please try again tomorrow.");
  if ((perIp.data || []).length >= PER_IP_PER_HOUR) return fail("Too many codes from this network. Please try again later.");

  const id = crypto.randomUUID();
  const code = (deps.makeCode ?? sixDigits)();
  const { error } = await db.from("signup_phone_otps").insert({
    id,
    phone,
    otp_hash: await digest(deps.secret, id, phone, code),
    otp_expires_at: new Date(t + CODE_TTL_MS).toISOString(),
    otp_attempts: 0,
    verified_at: null,
    ip_address: input.ip,
    created_at: deps.now.toISOString(),
  });
  if (error) return fail("Verification service error. Please try again.");
  const sent = await deps.sendSms(phone, `SwiftData code: ${code}. Enter it within 10 minutes to verify your phone. Never share it.`);
  if (!sent) return fail("SMS service is temporarily unavailable. Please try again shortly.");
  return { status: 200, body: { success: true, phone, masked_phone: mask(phone), message: `6-digit code sent to ${mask(phone)}.` } };
}

/** Marks the phone verified on this account; flags it if another account already verified it. */
export async function markPhoneVerified(db: any, userId: string, phone: string, now: Date): Promise<void> {
  await db.from("profiles").update({ phone, phone_verified: true, updated_at: now.toISOString() }).eq("user_id", userId);
  const { data: others } = await db.from("profiles").select("user_id").eq("phone", phone).eq("phone_verified", true).neq("user_id", userId).limit(5);
  for (const o of others || []) {
    const { data: already } = await db.from("duplicate_account_flags").select("id").eq("primary_user_id", o.user_id).contains("duplicate_user_ids", [userId]).limit(1).maybeSingle();
    if (already) continue;
    await db.from("duplicate_account_flags").insert({
      primary_user_id: o.user_id,
      duplicate_user_ids: [userId],
      matching_criteria: `Same verified phone ${mask(phone)}`,
      confidence_score: 0.6,
      action_taken: "flagged_review",
    });
  }
}

export async function verifySignupCode(db: any, input: { phone: unknown; code: unknown; userId: string | null }, deps: SignupPhoneDeps): Promise<Res> {
  const phone = localGhPhone(input.phone);
  if (!phone) return fail("Please enter a valid 10-digit Ghana phone number.");
  const code = String(input.code ?? "").replace(/\D/g, "");
  if (code.length !== 6) return fail("Please enter the 6-digit code.");
  const { data: row } = await db.from("signup_phone_otps").select("*").eq("phone", phone).is("verified_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!row) return fail("No active code for this number. Please tap Send OTP.");
  if (new Date(row.otp_expires_at).getTime() < deps.now.getTime()) return fail("That code expired. Please ask for a new one.");
  if (Number(row.otp_attempts || 0) >= MAX_ATTEMPTS) return fail("Too many wrong tries. Please ask for a new code.");
  if (!sameString(await digest(deps.secret, row.id, phone, code), String(row.otp_hash || ""))) {
    await db.from("signup_phone_otps").update({ otp_attempts: Number(row.otp_attempts || 0) + 1 }).eq("id", row.id);
    return fail("That code isn't right. Please check your SMS and try again.");
  }
  const token = (deps.makeToken ?? (() => crypto.randomUUID()))();
  const verifiedAt = deps.now.toISOString();
  await db.from("signup_phone_otps").update({
    verified_at: verifiedAt,
    verification_token: token,
    ...(input.userId ? { claimed_at: verifiedAt, claimed_by: input.userId } : {}),
  }).eq("id", row.id);
  if (input.userId) await markPhoneVerified(db, input.userId, phone, deps.now);
  return { status: 200, body: { success: true, verified: true, phone, verification_token: token, profile_updated: Boolean(input.userId), message: "Phone number verified!" } };
}

/** After signup: the signed-in user hands the token back so the server marks the phone verified. */
export async function claimToken(db: any, input: { userId: string; token: unknown; phone: unknown }, deps: SignupPhoneDeps): Promise<Res> {
  const phone = localGhPhone(input.phone);
  const token = String(input.token ?? "").trim();
  if (!input.userId || !phone || !token) return fail("Please verify your phone number again.");
  const { data: row } = await db.from("signup_phone_otps").select("id, verified_at").eq("verification_token", token).eq("phone", phone)
    .is("claimed_at", null).limit(1).maybeSingle();
  if (!row?.verified_at || deps.now.getTime() - new Date(row.verified_at).getTime() > TOKEN_TTL_MS) return fail("Please verify your phone number again.");
  const { data: claimed } = await db.from("signup_phone_otps").update({ claimed_at: deps.now.toISOString(), claimed_by: input.userId })
    .eq("id", row.id).is("claimed_at", null).select("id");
  if (!(claimed || []).length) return fail("Please verify your phone number again.");
  await markPhoneVerified(db, input.userId, phone, deps.now);
  return { status: 200, body: { success: true, phone } };
}
