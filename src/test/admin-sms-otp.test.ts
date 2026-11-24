import { describe, expect, it, vi } from "vitest";
import {
  MAX_SMS_CODES_PER_DAY,
  SMS_SESSION_HOURS,
  needsAuthenticatorApp,
  requestSmsCode,
  setSmsApproval,
  smsLoginAllowed,
  smsStatus,
  verifySmsCode,
} from "../../supabase/functions/_shared/admin_sms_otp";
import { SENSITIVE_ACCESS_ACTIONS, SENSITIVE_PAYOUT_ACTIONS, SENSITIVE_USER_ACTIONS } from "@/lib/adminSensitive";
import { fakeDb } from "./helpers/fakeDb";

const NOW = new Date("2026-11-24T12:00:00Z");
const deps = () => ({ now: NOW, secret: "s3cret", sendSms: vi.fn(async () => true), alertOtherAdmins: vi.fn(async () => {}), makeCode: () => "731905" });
const admin = (over: Record<string, unknown> = {}) => ({ user_id: "a1", role: "admin", otp_login_approved: true, otp_phone: "233241112222", ...over });
const seed = (role = admin()) => fakeDb({ user_roles: [role, { user_id: "a2", role: "admin", otp_login_approved: false, otp_phone: null }], profiles: [{ user_id: "a1", full_name: "Ama", phone: "0559998888" }], admin_otp_sessions: [] });

describe("who may use the SMS login", () => {
  it("only admins another admin switched on, with a pinned phone", () => {
    expect(smsLoginAllowed(admin())).toBe(true);
    expect(smsLoginAllowed(admin({ otp_login_approved: null }))).toBe(false);
    expect(smsLoginAllowed(admin({ otp_login_approved: false }))).toBe(false);
    expect(smsLoginAllowed(admin({ otp_phone: null }))).toBe(false);
    expect(smsLoginAllowed(admin({ role: "moderator" }))).toBe(false);
  });
});

describe("what still needs the authenticator app", () => {
  it("every money, send and admin-access action", () => {
    for (const a of SENSITIVE_PAYOUT_ACTIONS) expect(needsAuthenticatorApp("system-payout-v1", a)).toBe(true);
    for (const a of SENSITIVE_USER_ACTIONS) expect(needsAuthenticatorApp("admin-user-actions", a)).toBe(true);
    for (const a of SENSITIVE_ACCESS_ACTIONS) {
      expect(needsAuthenticatorApp("system-payout-v1", a)).toBe(true);
      expect(needsAuthenticatorApp("admin-user-actions", a)).toBe(true);
    }
  });

  it("not everyday reads", () => {
    expect(needsAuthenticatorApp("system-payout-v1", "get_admins")).toBe(false);
    expect(needsAuthenticatorApp("admin-user-actions", "get_user_audit_logs")).toBe(false);
  });
});

describe("SMS codes", () => {
  it("go only to the pinned phone, never the profile phone the person can edit", async () => {
    const db = seed();
    const d = deps();
    expect((await requestSmsCode(db, { userId: "a1", sessionId: "s1" }, d)).status).toBe(200);
    expect(d.sendSms).toHaveBeenCalledWith("0241112222", expect.stringContaining("731905"));
  });

  it("are refused for admins who aren't switched on", async () => {
    const d = deps();
    expect((await requestSmsCode(seed(admin({ otp_login_approved: false })), { userId: "a1", sessionId: "s1" }, d)).status).toBe(403);
    expect(d.sendSms).not.toHaveBeenCalled();
  });

  it("are never stored in a readable form", async () => {
    const db = seed();
    await requestSmsCode(db, { userId: "a1", sessionId: "s1" }, deps());
    expect(JSON.stringify(db.tables.admin_otp_sessions)).not.toContain("731905");
  });

  it(`are limited to ${MAX_SMS_CODES_PER_DAY} a day`, async () => {
    const db = seed();
    for (let i = 0; i < MAX_SMS_CODES_PER_DAY; i++) db.tables.admin_otp_sessions.push({ id: `x${i}`, user_id: "a1", session_id: `old${i}`, created_at: new Date(NOW.getTime() - (i + 2) * 600_000).toISOString() });
    const d = deps();
    expect((await requestSmsCode(db, { userId: "a1", sessionId: "s1" }, d)).status).toBe(429);
    expect(d.sendSms).not.toHaveBeenCalled();
  });

  it(`give a ${SMS_SESSION_HOURS}-hour session tied to this login, and alert the other admins`, async () => {
    const db = seed();
    const d = deps();
    await requestSmsCode(db, { userId: "a1", sessionId: "s1" }, d);
    expect((await verifySmsCode(db, { userId: "a1", sessionId: "s1", code: "731905" }, d)).status).toBe(200);
    const s = db.tables.admin_otp_sessions[0];
    expect(new Date(s.expires_at).getTime() - NOW.getTime()).toBe(SMS_SESSION_HOURS * 3_600_000);
    expect(d.alertOtherAdmins).toHaveBeenCalledWith("a1", expect.stringContaining("SMS code"));
    expect((await smsStatus(db, { userId: "a1", sessionId: "s1" }, d)).body).toMatchObject({ has_valid_session: true, eligible: true });
    expect((await smsStatus(db, { userId: "a1", sessionId: "other-login" }, d)).body).toMatchObject({ has_valid_session: false });
  });

  it("refuse a wrong code and stop after 5 tries", async () => {
    const db = seed();
    const d = deps();
    await requestSmsCode(db, { userId: "a1", sessionId: "s1" }, d);
    for (let i = 0; i < 5; i++) expect((await verifySmsCode(db, { userId: "a1", sessionId: "s1", code: "000000" }, d)).status).toBe(400);
    expect((await verifySmsCode(db, { userId: "a1", sessionId: "s1", code: "731905" }, d)).status).toBe(429);
    expect(db.tables.admin_otp_sessions[0].verified_at ?? null).toBeNull();
  });
});

describe("switching the SMS login on or off", () => {
  it("needs another admin signed in with the authenticator app, and pins the phone", async () => {
    const db = seed();
    const res = await setSmsApproval(db, { adminId: "a1", adminSecondFactor: "authenticator", targetUserId: "a2", approved: true, phone: "0201234567" }, deps());
    expect(res.status).toBe(200);
    expect(db.tables.user_roles[1]).toMatchObject({ otp_login_approved: true, otp_phone: "233201234567" });
  });

  it("can't be done for yourself, or from an SMS login", async () => {
    expect((await setSmsApproval(seed(), { adminId: "a2", adminSecondFactor: "authenticator", targetUserId: "a2", approved: true, phone: "0201234567" }, deps())).status).toBe(403);
    expect((await setSmsApproval(seed(), { adminId: "a1", adminSecondFactor: "sms", targetUserId: "a2", approved: true, phone: "0201234567" }, deps())).status).toBe(403);
  });

  it("switching off ends the person's SMS sessions", async () => {
    const db = seed();
    db.tables.admin_otp_sessions.push({ id: "z", user_id: "a1", session_id: "s1", verified_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + 3_600_000).toISOString() });
    await setSmsApproval(db, { adminId: "a2", adminSecondFactor: "authenticator", targetUserId: "a1", approved: false, phone: null }, deps());
    expect(db.tables.user_roles[0].otp_login_approved).toBe(false);
    expect(new Date(db.tables.admin_otp_sessions[0].expires_at).getTime()).toBeLessThanOrEqual(NOW.getTime());
  });
});
