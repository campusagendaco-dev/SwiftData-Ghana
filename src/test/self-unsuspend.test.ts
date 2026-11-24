import { describe, expect, it, vi } from "vitest";
import {
  adminDecide,
  classifyHold,
  MAX_CODES_PER_DAY,
  otpDigest,
  requestCode,
  unsuspendStatus,
  verifyCode,
} from "../../supabase/functions/_shared/unsuspend";
import { fakeDb } from "./helpers/fakeDb";

const NOW = new Date("2026-11-24T12:00:00Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
const SECRET = "test-secret";

const timedHold = () => ({ user_id: "u1", full_name: "Ama", phone: "0241112222", is_suspended: true, terminal_locked: false, suspended_until: inHours(10), security_violation_count: 1 });
const noSignals = { openAml: 0, cloneFlags: 0, walletBalance: 5, recentSelfReleases: 0 };

describe("which holds a code can lift", () => {
  it("lets a code lift the system's own timed hold early", () => {
    expect(classifyHold(timedHold(), noSignals, NOW).route).toBe("self_release");
  });

  it("sends admin suspensions and permanent holds to an admin", () => {
    expect(classifyHold({ ...timedHold(), suspended_until: null }, noSignals, NOW).route).toBe("admin_review");
    expect(classifyHold({ ...timedHold(), security_violation_count: 3 }, noSignals, NOW).route).toBe("admin_review");
    expect(classifyHold({ ...timedHold(), security_violation_count: 0 }, noSignals, NOW).route).toBe("admin_review");
  });

  it("sends a hold longer than the strike system's 24 hours to an admin", () => {
    expect(classifyHold({ ...timedHold(), suspended_until: inHours(72) }, noSignals, NOW).route).toBe("admin_review");
  });

  it("sends terminal locks and fraud signals to an admin", () => {
    expect(classifyHold({ ...timedHold(), terminal_locked: true }, noSignals, NOW).route).toBe("admin_review");
    expect(classifyHold(timedHold(), { ...noSignals, openAml: 1 }, NOW).route).toBe("admin_review");
    expect(classifyHold(timedHold(), { ...noSignals, cloneFlags: 1 }, NOW).route).toBe("admin_review");
    expect(classifyHold(timedHold(), { ...noSignals, walletBalance: -3 }, NOW).route).toBe("admin_review");
    expect(classifyHold(timedHold(), { ...noSignals, recentSelfReleases: 2 }, NOW).route).toBe("admin_review");
  });
});

describe("codes", () => {
  it("uses a server secret, so the stored value can't be reversed without it", async () => {
    const a = await otpDigest(SECRET, "req1", "123456");
    expect(a).not.toBe(await otpDigest("other", "req1", "123456"));
    expect(a).not.toBe(await otpDigest(SECRET, "req2", "123456"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

const deps = () => ({ now: NOW, secret: SECRET, sendSms: vi.fn(async () => true), notifyAdmins: vi.fn(async () => {}), makeCode: () => "424242" });
const seed = (profile = timedHold()) =>
  fakeDb({
    profiles: [profile],
    aml_alerts: [],
    duplicate_account_flags: [],
    wallets: [{ agent_id: "u1", balance: 5 }],
    account_unsuspend_requests: [],
    user_roles: [{ user_id: "admin-1", role: "admin" }],
  });

describe("self-unsuspend service", () => {
  it("lifts a timed hold after the right code, and texts the code only to the user", async () => {
    const db = seed();
    const d = deps();
    expect((await requestCode(db, "u1", d)).status).toBe(200);
    expect(d.sendSms).toHaveBeenCalledWith("0241112222", expect.stringContaining("424242"));
    const res = await verifyCode(db, "u1", "424242", d);
    expect(res.body).toMatchObject({ unsuspended: true });
    expect(db.tables.profiles[0]).toMatchObject({ is_suspended: false, suspended_until: null });
  });

  it("queues an admin suspension for review instead of lifting it, and tells admins once", async () => {
    const db = seed({ ...timedHold(), suspended_until: null });
    const d = deps();
    await requestCode(db, "u1", d);
    const res = await verifyCode(db, "u1", "424242", d);
    expect(res.body).toMatchObject({ unsuspended: false, pending_admin_approval: true });
    expect(db.tables.profiles[0].is_suspended).toBe(true);
    expect(d.notifyAdmins).toHaveBeenCalledTimes(1);
    expect(db.tables.account_unsuspend_requests[0].status).toBe("pending_admin_approval");
  });

  it("refuses a wrong code and stops after 5 tries", async () => {
    const db = seed();
    const d = deps();
    await requestCode(db, "u1", d);
    for (let i = 0; i < 5; i++) expect((await verifyCode(db, "u1", "000000", d)).status).toBe(400);
    expect((await verifyCode(db, "u1", "424242", d)).status).toBe(429);
    expect(db.tables.profiles[0].is_suspended).toBe(true);
  });

  it("never stores the code itself", async () => {
    const db = seed();
    await requestCode(db, "u1", deps());
    expect(JSON.stringify(db.tables.account_unsuspend_requests[0])).not.toContain("424242");
  });

  it(`sends at most ${MAX_CODES_PER_DAY} codes a day`, async () => {
    const db = seed();
    for (let i = 0; i < MAX_CODES_PER_DAY; i++) db.tables.account_unsuspend_requests.push({ id: `r${i}`, user_id: "u1", status: "expired", created_at: new Date(NOW.getTime() - (i + 2) * 120_000).toISOString() });
    const d = deps();
    expect((await requestCode(db, "u1", d)).status).toBe(429);
    expect(d.sendSms).not.toHaveBeenCalled();
  });

  it("reports what will happen before the user asks for a code", async () => {
    const res = await unsuspendStatus(seed({ ...timedHold(), suspended_until: null }), "u1", deps());
    expect(res.body).toMatchObject({ is_suspended: true, is_security_breach: true, masked_phone: "024****222" });
  });
});

describe("admin decision", () => {
  const pending = () => {
    const db = seed({ ...timedHold(), suspended_until: null });
    db.tables.account_unsuspend_requests.push({ id: "q1", user_id: "u1", phone: "0241112222", status: "pending_admin_approval", created_at: NOW.toISOString() });
    return db;
  };

  it("approving lifts the suspension, records who decided, and can't be done twice", async () => {
    const db = pending();
    const d = deps();
    expect((await adminDecide(db, { adminId: "admin-1", requestId: "q1", decision: "approve" }, d)).status).toBe(200);
    expect(db.tables.profiles[0].is_suspended).toBe(false);
    expect(db.tables.account_unsuspend_requests[0]).toMatchObject({ status: "approved", reviewed_by: "admin-1" });
    expect((await adminDecide(db, { adminId: "admin-1", requestId: "q1", decision: "reject" }, d)).status).toBe(409);
  });

  it("rejecting keeps the account suspended", async () => {
    const db = pending();
    await adminDecide(db, { adminId: "admin-1", requestId: "q1", decision: "reject" }, deps());
    expect(db.tables.profiles[0].is_suspended).toBe(true);
    expect(db.tables.account_unsuspend_requests[0].status).toBe("rejected");
  });

  it("refuses the service-role key", async () => {
    expect((await adminDecide(pending(), { adminId: "00000000-0000-0000-0000-000000000000", requestId: "q1", decision: "approve" }, deps())).status).toBe(403);
  });
});
