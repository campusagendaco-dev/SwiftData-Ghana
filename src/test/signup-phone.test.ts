import { describe, expect, it, vi } from "vitest";
import {
  GLOBAL_CODES_PER_HOUR,
  claimToken,
  clientIp,
  sendSignupCode,
  verifySignupCode,
} from "../../supabase/functions/_shared/signup_phone";
import { fakeDb } from "./helpers/fakeDb";

const NOW = new Date("2026-11-24T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const deps = () => ({ now: NOW, secret: "s3cret", sendSms: vi.fn(async () => true), makeCode: () => "482913", makeToken: () => "tok-1" });
const headers = (h: Record<string, string>) => new Headers(h);

describe("network address", () => {
  it("uses the address the platform saw, not one the caller made up", () => {
    expect(clientIp(headers({ "cf-connecting-ip": "41.1.1.1", "x-forwarded-for": "9.9.9.9" }))).toBe("41.1.1.1");
    expect(clientIp(headers({ "x-forwarded-for": "9.9.9.9, 41.2.2.2" }))).toBe("41.2.2.2");
    expect(clientIp(headers({}))).toBe("unknown");
  });
});

describe("sending signup codes", () => {
  it("sends a code to a valid Ghana number and never stores the code itself", async () => {
    const db = fakeDb({ signup_phone_otps: [] });
    const d = deps();
    const res = await sendSignupCode(db, { phone: "+233 24 111 2222", ip: "41.1.1.1" }, d);
    expect(res.body).toMatchObject({ success: true, phone: "0241112222" });
    expect(d.sendSms).toHaveBeenCalledWith("0241112222", expect.stringContaining("482913"));
    expect(JSON.stringify(db.tables.signup_phone_otps)).not.toContain("482913");
  });

  it("refuses more than 5 codes a day for one number", async () => {
    const db = fakeDb({ signup_phone_otps: Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, phone: "0241112222", ip_address: `10.0.0.${i}`, created_at: ago((i + 2) * 3_600_000) })) });
    const d = deps();
    expect((await sendSignupCode(db, { phone: "0241112222", ip: "41.1.1.1" }, d)).body.success).toBe(false);
    expect(d.sendSms).not.toHaveBeenCalled();
  });

  it("refuses more than 10 codes an hour from one network", async () => {
    const db = fakeDb({ signup_phone_otps: Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, phone: `02000000${10 + i}`, ip_address: "41.1.1.1", created_at: ago((i + 2) * 60_000) })) });
    expect((await sendSignupCode(db, { phone: "0241112222", ip: "41.1.1.1" }, deps())).body.success).toBe(false);
  });

  it(`stops all signup codes after ${GLOBAL_CODES_PER_HOUR} in an hour, so a script can't drain SMS credit`, async () => {
    const db = fakeDb({ signup_phone_otps: Array.from({ length: GLOBAL_CODES_PER_HOUR }, (_, i) => ({ id: `r${i}`, phone: `0200${String(i).padStart(6, "0")}`, ip_address: `10.0.${i % 250}.${i % 7}`, created_at: ago(30 * 60_000) })) });
    const d = deps();
    expect((await sendSignupCode(db, { phone: "0241112222", ip: "41.9.9.9" }, d)).body.success).toBe(false);
    expect(d.sendSms).not.toHaveBeenCalled();
  });
});

describe("verifying and claiming", () => {
  const sent = async () => {
    const db = fakeDb({ signup_phone_otps: [], profiles: [{ user_id: "u1", phone: "0241112222", phone_verified: false }, { user_id: "u0", phone: "0241112222", phone_verified: true }], duplicate_account_flags: [] });
    await sendSignupCode(db, { phone: "0241112222", ip: "41.1.1.1" }, deps());
    return db;
  };

  it("a right code gives a token, which only marks the phone verified when the server claims it", async () => {
    const db = await sent();
    const v = await verifySignupCode(db, { phone: "0241112222", code: "482913", userId: null }, deps());
    expect(v.body).toMatchObject({ success: true, verification_token: "tok-1" });
    expect(db.tables.profiles[0].phone_verified).toBe(false);
    const c = await claimToken(db, { userId: "u1", token: "tok-1", phone: "0241112222" }, deps());
    expect(c.body).toMatchObject({ success: true });
    expect(db.tables.profiles[0]).toMatchObject({ phone: "0241112222", phone_verified: true });
  });

  it("a token works once, for the same number, within 30 minutes", async () => {
    const db = await sent();
    await verifySignupCode(db, { phone: "0241112222", code: "482913", userId: null }, deps());
    expect((await claimToken(db, { userId: "u1", token: "tok-1", phone: "0209999999" }, deps())).body.success).toBe(false);
    expect((await claimToken(db, { userId: "u1", token: "tok-1", phone: "0241112222" }, deps())).body.success).toBe(true);
    expect((await claimToken(db, { userId: "u2", token: "tok-1", phone: "0241112222" }, deps())).body.success).toBe(false);
    const late = { ...deps(), now: new Date(NOW.getTime() + 31 * 60_000) };
    const db2 = await sent();
    await verifySignupCode(db2, { phone: "0241112222", code: "482913", userId: null }, deps());
    expect((await claimToken(db2, { userId: "u1", token: "tok-1", phone: "0241112222" }, late)).body.success).toBe(false);
  });

  it("flags both accounts when the phone is already verified on another one", async () => {
    const db = await sent();
    await verifySignupCode(db, { phone: "0241112222", code: "482913", userId: null }, deps());
    await claimToken(db, { userId: "u1", token: "tok-1", phone: "0241112222" }, deps());
    expect(db.tables.profiles[0].phone_verified).toBe(true);
    expect(db.tables.duplicate_account_flags[0]).toMatchObject({ primary_user_id: "u0", duplicate_user_ids: ["u1"], action_taken: "flagged_review" });
  });

  it("a signed-in user verifying in the gate is marked verified straight away", async () => {
    const db = await sent();
    await verifySignupCode(db, { phone: "0241112222", code: "482913", userId: "u1" }, deps());
    expect(db.tables.profiles[0].phone_verified).toBe(true);
  });

  it("refuses a wrong code and stops after 5 tries", async () => {
    const db = await sent();
    for (let i = 0; i < 5; i++) expect((await verifySignupCode(db, { phone: "0241112222", code: "000000", userId: null }, deps())).body.success).toBe(false);
    expect((await verifySignupCode(db, { phone: "0241112222", code: "482913", userId: null }, deps())).body.success).toBe(false);
  });
});
