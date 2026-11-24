// Ama's money-touching actions as safe, pure rules (unit-tested).
// - Buying data and redeeming points are PROPOSALS: the chat shows a card with exactly what
//   will happen, and nothing runs until the user taps Confirm.
// - Disputes never refund: a failed, paid order becomes a support ticket for the team, who
//   refund through the refund service with an admin's confirmation.
// - Judge mode only records a recommendation.

export type PurchaseProposal = { kind: "purchase"; network: string; package_size: string; phone: string; amount_ghs: number };
export type RedeemProposal = { kind: "redeem"; points: number; amount_ghs: number };
export type AmaProposal = PurchaseProposal | RedeemProposal;

/** 10-digit local Ghana number (0XXXXXXXXX), or null. */
export function localGhPhone(raw: unknown): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (/^233\d{9}$/.test(d)) return `0${d.slice(3)}`;
  if (/^0\d{9}$/.test(d)) return d;
  if (/^\d{9}$/.test(d)) return `0${d}`;
  return null;
}

export function buildPurchaseProposal(
  input: { network?: unknown; phone_number?: unknown; package_size?: unknown },
  pkg: { package_size: string; public_price: number | string | null; agent_price: number | string | null; is_unavailable?: boolean | null } | null,
  user: { isAgent: boolean },
): { ok: true; proposal: PurchaseProposal } | { ok: false; reason: string } {
  const phone = localGhPhone(input.phone_number);
  if (!phone) return { ok: false, reason: "I need a valid 10-digit Ghana number for the bundle." };
  if (!pkg) return { ok: false, reason: `I couldn't find a ${String(input.package_size ?? "")} bundle for ${String(input.network ?? "")}.` };
  if (pkg.is_unavailable) return { ok: false, reason: `The ${pkg.package_size} bundle is unavailable right now.` };
  const price = Number(user.isAgent ? pkg.agent_price || pkg.public_price : pkg.public_price);
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: "I couldn't get a price for that bundle." };
  return {
    ok: true,
    proposal: { kind: "purchase", network: String(input.network), package_size: pkg.package_size, phone, amount_ghs: Number(price.toFixed(2)) },
  };
}

export function buildRedeemProposal(points: unknown): { ok: true; proposal: RedeemProposal } | { ok: false; reason: string } {
  const p = Math.floor(Number(points || 0) / 100) * 100;
  if (p < 100) return { ok: false, reason: "You need at least 100 points to redeem." };
  return { ok: true, proposal: { kind: "redeem", points: p, amount_ghs: p / 100 } };
}

type OrderLike = {
  id: string;
  network?: string | null;
  package_size?: string | null;
  amount?: number | string | null;
  status?: string | null;
  payment_method?: string | null;
  paystack_verified_amount?: number | string | null;
  auto_refunded?: boolean | null;
};

export type DisputeOutcome = {
  kind: "delivered" | "already_refunded" | "not_paid" | "needs_review" | "in_progress";
  message: string;
  ticket?: { subject: string; description: string };
};

export function disputeOutcome(order: OrderLike): DisputeOutcome {
  const short = String(order.id).slice(0, 8);
  const what = `${order.network ?? ""} ${order.package_size ?? ""}`.trim();
  const status = String(order.status || "").toLowerCase();
  const paid = String(order.payment_method || "").toLowerCase() === "wallet" || Number(order.paystack_verified_amount || 0) > 0;

  if (status === "fulfilled" || status === "completed") {
    return { kind: "delivered", message: `Order ${short} (${what}) shows as delivered by the provider. If the customer still didn't receive it, I can pass it to our support team to check with the provider.` };
  }
  if (status === "refunded" || order.auto_refunded) {
    return { kind: "already_refunded", message: `Order ${short} has already been refunded.` };
  }
  if (status === "failed" || status === "fulfillment_failed") {
    if (!paid) return { kind: "not_paid", message: `Order ${short} failed before payment was completed, so there's nothing to refund.` };
    return {
      kind: "needs_review",
      message: `Order ${short} (${what}) failed. I've passed it to our support team to review the refund, and they'll follow up shortly. Refunds are checked by a person before they're paid.`,
      ticket: {
        subject: `Refund review: order ${short} failed`,
        description: `Ama: the customer reports order ${order.id} (${what}, GH₵${Number(order.amount || 0).toFixed(2)}) failed. Status: ${order.status}. Payment: ${order.payment_method}. Please review and refund through the refund service if due.`,
      },
    };
  }
  return { kind: "in_progress", message: `Order ${short} is still ${order.status || "being processed"}. Please check back in a few minutes.` };
}

export function judgeRecommendation(orderId: string, judgment: string, reasoning: string): string {
  const j = String(judgment).toUpperCase();
  if (j === "REFUND") return `Recommendation recorded for order ${orderId}: REFUND (${reasoning}). An admin must review it and refund through the refund service.`;
  if (j === "REJECT") return `Recommendation recorded for order ${orderId}: no refund (${reasoning}). An admin can review it.`;
  return `Order ${orderId} needs manual review (${reasoning}).`;
}
