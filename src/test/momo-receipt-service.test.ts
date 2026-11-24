import { describe, expect, it, vi } from "vitest";
import { checkReceipt, decideReceipt, MAX_CHECKS_PER_HOUR } from "../../supabase/functions/_shared/momo_receipt_service";
import { fakeDb } from "./helpers/fakeDb";

const NOW = new Date("2026-11-24T12:00:00Z");
const aiAnswer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    is_momo_receipt: true, provider: "MTN MoMo", transaction_id: "48291034567", amount: 50, currency: "GHS",
    recipient_phone: "0553334444", recipient_name: "SwiftData", status: "successful", timestamp: "2026-11-24T11:30:00Z",
    tampering_signals: [], confidence: 0.9, visual_notes: "", ...over,
  });
const reader = (text = aiAnswer()) => vi.fn(async () => ({ text, model: "gpt-4o-mini" }));
const image = { base64: "aGVsbG8=", mediaType: "image/png" };
const seed = () =>
  fakeDb({
    orders: [{ id: "o1", amount: 50, status: "pending", created_at: "2026-11-24T11:00:00Z" }],
    momo_receiving_accounts: [{ phone: "233553334444", account_name: "SwiftData", is_active: true }],
    momo_receipt_checks: [],
  });

describe("checkReceipt", () => {
  it("reads the receipt, checks it and saves the check", async () => {
    const db = seed();
    const res = await checkReceipt(db, { adminId: "admin-1", image, orderId: "o1", expectedAmount: null }, { readReceipt: reader(), now: NOW });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ verdict: "no_red_flags", risk_level: "low" });
    const saved = db.tables.momo_receipt_checks[0];
    expect(saved).toMatchObject({ checked_by: "admin-1", order_id: "o1", transaction_id: "48291034567", amount: 50, verdict: "no_red_flags", decision: null });
  });

  it("uses the order's amount from the database, not the caller's", async () => {
    const db = seed();
    const res = await checkReceipt(db, { adminId: "admin-1", image, orderId: "o1", expectedAmount: 5 }, { readReceipt: reader(aiAnswer({ amount: 5 })), now: NOW });
    expect((res.body.flags as any[]).map((f) => f.code)).toContain("AMOUNT_MISMATCH");
  });

  it("catches a transaction id already used for another order", async () => {
    const db = seed();
    db.tables.momo_receipt_checks.push({ id: "c0", transaction_id: "48291034567", order_id: "o9", decision: null, checked_by: "x", created_at: "2026-11-20T10:00:00Z" });
    const res = await checkReceipt(db, { adminId: "admin-1", image, orderId: "o1", expectedAmount: null }, { readReceipt: reader(), now: NOW });
    expect(res.body.verdict).toBe("flagged");
    expect((res.body.flags as any[]).map((f) => f.code)).toContain("DUPLICATE_TRANSACTION_ID");
  });

  it(`stops an admin after ${MAX_CHECKS_PER_HOUR} checks in an hour, before calling the AI`, async () => {
    const db = seed();
    for (let i = 0; i < MAX_CHECKS_PER_HOUR; i++) db.tables.momo_receipt_checks.push({ id: `c${i}`, checked_by: "admin-1", created_at: "2026-11-24T11:30:00Z" });
    const read = reader();
    const res = await checkReceipt(db, { adminId: "admin-1", image, orderId: null, expectedAmount: null }, { readReceipt: read, now: NOW });
    expect(res.status).toBe(429);
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses images that are too big or not a picture", async () => {
    const db = seed();
    const big = { base64: "A".repeat(7 * 1024 * 1024), mediaType: "image/png" };
    expect((await checkReceipt(db, { adminId: "a", image: big, orderId: null, expectedAmount: null }, { readReceipt: reader(), now: NOW })).status).toBe(400);
    expect((await checkReceipt(db, { adminId: "a", image: { base64: "aGVsbG8=", mediaType: "application/pdf" }, orderId: null, expectedAmount: null }, { readReceipt: reader(), now: NOW })).status).toBe(400);
  });

  it("answers 404 for an unknown order", async () => {
    const res = await checkReceipt(seed(), { adminId: "a", image, orderId: "nope", expectedAmount: null }, { readReceipt: reader(), now: NOW });
    expect(res.status).toBe(404);
  });

  it("refuses the service-role key", async () => {
    const res = await checkReceipt(seed(), { adminId: "00000000-0000-0000-0000-000000000000", image, orderId: null, expectedAmount: null }, { readReceipt: reader(), now: NOW });
    expect(res.status).toBe(403);
  });
});

describe("decideReceipt", () => {
  const withCheck = () => {
    const db = seed();
    db.tables.momo_receipt_checks.push({ id: "c1", transaction_id: "48291034567", verdict: "no_red_flags", decision: null, checked_by: "a" });
    return db;
  };

  it("records who accepted it and when; credits nothing", async () => {
    const db = withCheck();
    const res = await decideReceipt(db, { adminId: "admin-1", checkId: "c1", decision: "accepted" });
    expect(res.status).toBe(200);
    expect(db.tables.momo_receipt_checks[0]).toMatchObject({ decision: "accepted", decided_by: "admin-1" });
    expect(db.writes.every((w) => w.table === "momo_receipt_checks" || w.table === "audit_logs")).toBe(true);
  });

  it("can be decided only once", async () => {
    const db = withCheck();
    await decideReceipt(db, { adminId: "admin-1", checkId: "c1", decision: "rejected" });
    expect((await decideReceipt(db, { adminId: "admin-2", checkId: "c1", decision: "accepted" })).status).toBe(409);
  });

  it("refuses to accept a transaction id that was already accepted", async () => {
    const db = withCheck();
    const realFrom = db.from;
    (db as any).from = (t: string) => {
      const q = realFrom(t);
      if (t === "momo_receipt_checks") {
        const update = q.update;
        q.update = (v: any) => (v.decision === "accepted" ? { eq: () => ({ is: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { code: "23505", message: "duplicate key" } }) }) }) }) } : update(v));
      }
      return q;
    };
    const res = await decideReceipt(db, { adminId: "admin-1", checkId: "c1", decision: "accepted" });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toContain("already accepted");
  });

  it("only takes accepted or rejected", async () => {
    expect((await decideReceipt(withCheck(), { adminId: "a", checkId: "c1", decision: "credit" as any })).status).toBe(400);
  });
});
