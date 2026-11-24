import { describe, expect, it } from "vitest";
import { buildPurchaseProposal, buildRedeemProposal, disputeOutcome, judgeRecommendation, localGhPhone } from "../../supabase/functions/_shared/ama_actions";

describe("phone numbers", () => {
  it("turns Ghana numbers into the 10-digit local form", () => {
    expect(localGhPhone("0241112222")).toBe("0241112222");
    expect(localGhPhone("+233 24 111 2222")).toBe("0241112222");
    expect(localGhPhone("241112222")).toBe("0241112222");
    expect(localGhPhone("02411")).toBeNull();
  });
});

describe("purchase proposals (nothing is bought until the user confirms)", () => {
  const pkg = { package_size: "2GB", public_price: 12, agent_price: 10, is_unavailable: false };

  it("shows exactly what will be bought and the price this user pays", () => {
    expect(buildPurchaseProposal({ network: "MTN", phone_number: "+233241112222", package_size: "2gb" }, pkg, { isAgent: false })).toEqual({
      ok: true,
      proposal: { kind: "purchase", network: "MTN", package_size: "2GB", phone: "0241112222", amount_ghs: 12 },
    });
    expect(buildPurchaseProposal({ network: "MTN", phone_number: "0241112222", package_size: "2GB" }, pkg, { isAgent: true })).toMatchObject({ proposal: { amount_ghs: 10 } });
  });

  it("refuses a bad number, an unknown bundle or one that is unavailable", () => {
    expect(buildPurchaseProposal({ network: "MTN", phone_number: "024", package_size: "2GB" }, pkg, { isAgent: false }).ok).toBe(false);
    expect(buildPurchaseProposal({ network: "MTN", phone_number: "0241112222", package_size: "2GB" }, null, { isAgent: false }).ok).toBe(false);
    expect(buildPurchaseProposal({ network: "MTN", phone_number: "0241112222", package_size: "2GB" }, { ...pkg, is_unavailable: true }, { isAgent: false }).ok).toBe(false);
  });
});

describe("redeem proposals", () => {
  it("offers all whole points in hundreds, from the database balance", () => {
    expect(buildRedeemProposal(1250)).toEqual({ ok: true, proposal: { kind: "redeem", points: 1200, amount_ghs: 12 } });
    expect(buildRedeemProposal(80).ok).toBe(false);
  });
});

describe("disputes (Ama never refunds; failed paid orders go to the support team)", () => {
  const order = (over: Record<string, unknown>) => ({ id: "abcdef12-0000", network: "MTN", package_size: "1GB", amount: 5, status: "fulfilled", payment_method: "wallet", paystack_verified_amount: 0, auto_refunded: false, ...over });

  it("reports a delivered order", () => {
    expect(disputeOutcome(order({}))).toMatchObject({ kind: "delivered" });
  });

  it("reports an order already refunded", () => {
    expect(disputeOutcome(order({ status: "refunded" }))).toMatchObject({ kind: "already_refunded" });
  });

  it("sends a failed, paid order to the support team instead of refunding", () => {
    const out = disputeOutcome(order({ status: "fulfillment_failed" }));
    expect(out.kind).toBe("needs_review");
    expect(out.ticket?.subject).toContain("abcdef12");
    expect(out.message).not.toMatch(/refunded .* to your wallet/i);
    expect(out.message).toMatch(/support team/i);
  });

  it("tells the user there's nothing to refund when payment never completed", () => {
    expect(disputeOutcome(order({ status: "failed", payment_method: "paystack", paystack_verified_amount: 0 }))).toMatchObject({ kind: "not_paid" });
  });

  it("reports an order still being processed without re-checking it", () => {
    expect(disputeOutcome(order({ status: "processing" }))).toMatchObject({ kind: "in_progress" });
  });
});

describe("judge mode records a recommendation only", () => {
  it("never says money was moved", () => {
    for (const j of ["REFUND", "REJECT", "MANUAL_REVIEW"]) {
      const msg = judgeRecommendation("o1", j, "provider timed out");
      expect(msg).toMatch(/recommend|review/i);
      expect(msg).not.toMatch(/credited|refunded to/i);
    }
  });
});
