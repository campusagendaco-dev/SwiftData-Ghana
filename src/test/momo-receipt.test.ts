import { describe, expect, it } from "vitest";
import {
  cleanTransactionId,
  evaluateReceipt,
  normalizeGhPhone,
  parseExtractedReceipt,
  type ExtractedReceipt,
} from "../../supabase/functions/_shared/momo_receipt";

const NOW = new Date("2026-11-24T12:00:00Z");
const receipt = (over: Partial<ExtractedReceipt> = {}): ExtractedReceipt => ({
  is_momo_receipt: true,
  provider: "MTN MoMo",
  transaction_id: "48291034567",
  amount: 50,
  currency: "GHS",
  sender_name: "Ama Mensah",
  sender_phone: "0241112222",
  recipient_name: "SwiftData Ghana",
  recipient_phone: "0553334444",
  timestamp: "2026-11-24T11:30:00Z",
  status: "successful",
  reference: null,
  tampering_signals: [],
  confidence: 0.9,
  visual_notes: "",
  ...over,
});
const ours = [{ phone: "233553334444", account_name: "SwiftData Ghana" }];
const base = { orderAmount: 50, expectedAmount: null, orderId: "o1", receivingAccounts: ours, priorChecks: [], now: NOW };
const codes = (r: ReturnType<typeof evaluateReceipt>) => r.flags.map((f) => f.code);

describe("phone numbers and transaction ids", () => {
  it("normalises Ghana numbers", () => {
    expect(normalizeGhPhone("0553334444")).toBe("233553334444");
    expect(normalizeGhPhone("+233 55 333 4444")).toBe("233553334444");
    expect(normalizeGhPhone("553334444")).toBe("233553334444");
    expect(normalizeGhPhone("12345")).toBeNull();
    expect(normalizeGhPhone(null)).toBeNull();
  });

  it("cleans transaction ids", () => {
    expect(cleanTransactionId(" TxID: 4829-1034567 ")).toBe("TXID48291034567");
    expect(cleanTransactionId("")).toBeNull();
  });
});

describe("receipt checks", () => {
  it("finds no red flags on a clean receipt paid to SwiftData for the order amount", () => {
    const r = evaluateReceipt({ ...base, extracted: receipt() });
    expect(r.verdict).toBe("no_red_flags");
    expect(r.flags).toEqual([]);
  });

  it("flags money sent to someone else", () => {
    const r = evaluateReceipt({ ...base, extracted: receipt({ recipient_phone: "0209998888", recipient_name: "Kojo" }) });
    expect(codes(r)).toContain("RECIPIENT_NOT_OURS");
    expect(r.risk_level).toBe("high");
  });

  it("can't pass a receipt when no SwiftData number is set up", () => {
    const r = evaluateReceipt({ ...base, receivingAccounts: [], extracted: receipt() });
    expect(codes(r)).toEqual(["NO_RECEIVING_ACCOUNTS"]);
    expect(r.verdict).toBe("flagged");
  });

  it("flags a receipt with no recipient number to compare", () => {
    expect(codes(evaluateReceipt({ ...base, extracted: receipt({ recipient_phone: null }) }))).toEqual(["RECIPIENT_UNCONFIRMED"]);
  });

  it("uses the order's amount, never a caller's expected amount", () => {
    const r = evaluateReceipt({ ...base, expectedAmount: 5, extracted: receipt({ amount: 5 }) });
    expect(codes(r)).toContain("AMOUNT_MISMATCH");
    expect(r.flags.find((f) => f.code === "AMOUNT_MISMATCH")?.message).toContain("GH₵50.00");
  });

  it("uses the expected amount only when there is no order", () => {
    const r = evaluateReceipt({ ...base, orderAmount: null, orderId: null, expectedAmount: 50, extracted: receipt() });
    expect(r.verdict).toBe("no_red_flags");
  });

  it("flags a transaction id that was already accepted, or used for another order", () => {
    const accepted = evaluateReceipt({ ...base, priorChecks: [{ transaction_id: "48291034567", order_id: null, decision: "accepted" }], extracted: receipt() });
    expect(codes(accepted)).toContain("DUPLICATE_TRANSACTION_ID");
    const otherOrder = evaluateReceipt({ ...base, priorChecks: [{ transaction_id: "48291034567", order_id: "o9", decision: null }], extracted: receipt() });
    expect(codes(otherOrder)).toContain("DUPLICATE_TRANSACTION_ID");
    const sameOrderRecheck = evaluateReceipt({ ...base, priorChecks: [{ transaction_id: "48291034567", order_id: "o1", decision: null }], extracted: receipt() });
    expect(sameOrderRecheck.verdict).toBe("no_red_flags");
  });

  it("flags an old receipt", () => {
    expect(codes(evaluateReceipt({ ...base, extracted: receipt({ timestamp: "2026-11-10T09:00:00Z" }) }))).toContain("OLD_RECEIPT");
  });

  it("flags not-a-receipt, unsuccessful, edited, unreadable and low-confidence receipts", () => {
    expect(codes(evaluateReceipt({ ...base, extracted: receipt({ is_momo_receipt: false }) }))).toContain("NOT_A_MOMO_RECEIPT");
    expect(codes(evaluateReceipt({ ...base, extracted: receipt({ status: "pending" }) }))).toContain("PAYMENT_NOT_SUCCESSFUL");
    expect(codes(evaluateReceipt({ ...base, extracted: receipt({ tampering_signals: ["amount font differs"] }) }))).toContain("TAMPERING_SIGNAL");
    expect(codes(evaluateReceipt({ ...base, extracted: receipt({ transaction_id: null }) }))).toContain("MISSING_TRANSACTION_ID");
    expect(codes(evaluateReceipt({ ...base, extracted: receipt({ amount: null }) }))).toContain("MISSING_AMOUNT");
    expect(codes(evaluateReceipt({ ...base, extracted: receipt({ confidence: 0.4 }) }))).toContain("LOW_CONFIDENCE");
  });
});

describe("reading the AI's answer", () => {
  it("fails closed on anything it can't read", () => {
    expect(parseExtractedReceipt("not json").is_momo_receipt).toBe(false);
    expect(parseExtractedReceipt('{"summary":"rules-only fallback","actions":[]}').is_momo_receipt).toBe(false);
  });

  it("reads amounts written with currency signs", () => {
    expect(parseExtractedReceipt('{"is_momo_receipt":true,"amount":"GH₵ 1,250.50","confidence":0.9}').amount).toBe(1250.5);
  });
});
