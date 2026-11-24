import { describe, expect, it } from "vitest";
import {
  buildExplainPrompt,
  fallbackExplanation,
  findLedgerIssues,
  mergeExplanations,
  type ReconIssue,
} from "../../supabase/functions/_shared/reconcile_checks";

const at = (min: number) => new Date(Date.UTC(2026, 10, 24, 10, min)).toISOString();

describe("extra reconciliation checks", () => {
  it("finds an order refunded to the wallet more than once", () => {
    const issues = findLedgerIssues({
      orders: [],
      refunds: [
        { reference_id: "o1", amount: 12, agent_id: "a", created_at: at(1) },
        { reference_id: "o1", amount: 12, agent_id: "a", created_at: at(5) },
        { reference_id: "o2", amount: 5, agent_id: "b", created_at: at(6) },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ type: "refunded_twice", order_id: "o1", amount_ghs: 12 });
  });

  it("finds the same bundle delivered twice to one number within 2 minutes", () => {
    const base = { agent_id: "a", customer_phone: "0241112222", network: "MTN", package_size: "2GB", amount: 10, status: "fulfilled", payment_method: "wallet", paystack_verified_amount: null };
    const issues = findLedgerIssues({
      orders: [
        { ...base, id: "o1", created_at: at(0) },
        { ...base, id: "o2", created_at: at(1) },
        { ...base, id: "o3", created_at: at(9) },
      ],
      refunds: [],
    });
    expect(issues.map((i) => [i.type, i.order_id])).toEqual([["delivered_twice", "o2"]]);
    expect(issues[0].context).toMatchObject({ first_order_id: "o1" });
  });

  it("finds a Paystack order delivered without full verified payment", () => {
    const issues = findLedgerIssues({
      orders: [
        { id: "o1", agent_id: null, customer_phone: "024", network: "MTN", package_size: "1GB", amount: 10, status: "fulfilled", payment_method: "paystack", paystack_verified_amount: 4, created_at: at(0) },
        { id: "o2", agent_id: null, customer_phone: "025", network: "MTN", package_size: "1GB", amount: 10, status: "fulfilled", payment_method: "paystack", paystack_verified_amount: 10, created_at: at(0) },
      ],
      refunds: [],
    });
    expect(issues).toEqual([expect.objectContaining({ type: "delivered_not_fully_paid", order_id: "o1", amount_ghs: 6 })]);
  });
});

const issue = (over: Partial<ReconIssue> = {}): ReconIssue => ({
  key: "paid_without_order:ref1",
  type: "paid_without_order",
  order_id: "ref1",
  amount_ghs: 25,
  detail: "GH₵25.00 paid, no order found",
  ...over,
});

describe("explanations", () => {
  it("has a plain explanation and a safe next step for every issue type", () => {
    for (const type of ["paid_without_order", "paid_not_credited", "credited_without_payment", "credit_exceeds_payment", "refunded_twice", "delivered_twice", "delivered_not_fully_paid"]) {
      const e = fallbackExplanation(issue({ type, key: `${type}:x` }));
      expect(e.explanation.length).toBeGreaterThan(20);
      expect(e.next_step.length).toBeGreaterThan(10);
      expect(e.next_step).not.toMatch(/re-?send|retry|heal|verify-payment/i);
    }
  });

  it("uses the AI's words when they stick to the issue's own numbers", () => {
    const merged = mergeExplanations([issue()], {
      explanations: [{ key: "paid_without_order:ref1", explanation: "The customer paid GH₵25 but checkout never created the order, probably because the webhook was missed.", next_step: "Find the payment in Paystack and refund it through the refund service." }],
    });
    expect(merged[0]).toMatchObject({ explained_by: "ai", explanation: expect.stringContaining("webhook was missed") });
  });

  it("falls back when the AI invents a number", () => {
    const merged = mergeExplanations([issue()], {
      explanations: [{ key: "paid_without_order:ref1", explanation: "The customer paid GH₵250 twice.", next_step: "Refund through the refund service." }],
    });
    expect(merged[0].explained_by).toBe("rules");
  });

  it("falls back when the AI suggests re-sending an order", () => {
    const merged = mergeExplanations([issue()], {
      explanations: [{ key: "paid_without_order:ref1", explanation: "Checkout never created the order after the payment.", next_step: "Retry the order with verify-payment so it gets delivered." }],
    });
    expect(merged[0].explained_by).toBe("rules");
    expect(merged[0].next_step).not.toMatch(/retry|verify-payment/i);
  });

  it("ignores AI output for keys that aren't in the run, and handles garbage", () => {
    expect(mergeExplanations([issue()], { explanations: [{ key: "other", explanation: "x".repeat(40), next_step: "y".repeat(20) }] })[0].explained_by).toBe("rules");
    expect(mergeExplanations([issue()], null)[0].explained_by).toBe("rules");
    expect(mergeExplanations([issue()], "not json")[0].explained_by).toBe("rules");
  });

  it("sends the AI only the issues' facts, at most 40", () => {
    const many = Array.from({ length: 60 }, (_, i) => issue({ key: `k${i}`, order_id: `r${i}` }));
    const prompt = buildExplainPrompt(many);
    expect(JSON.parse(prompt.user).issues).toHaveLength(40);
    expect(prompt.system).toMatch(/never suggest re-sending/i);
  });
});
