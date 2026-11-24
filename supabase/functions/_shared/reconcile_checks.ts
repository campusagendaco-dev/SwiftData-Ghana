// Reconciliation checks and plain-language explanations for wallet-reconcile (read-only).
// The numbers always come from these deterministic checks; the AI only writes the words,
// and its words are thrown away (rules-only text used instead) if they mention a number
// the issue doesn't contain or suggest re-sending an order. Pure module, unit-tested.

export type ReconIssue = {
  /** Stable id of the problem within a run, e.g. "refunded_twice:<order id>". */
  key: string;
  type: string;
  order_id: string;
  amount_ghs: number;
  detail: string;
  context?: Record<string, unknown>;
};

export type ExplainedIssue = ReconIssue & {
  explanation: string;
  next_step: string;
  explained_by: "ai" | "rules";
};

type OrderRow = {
  id: string;
  agent_id: string | null;
  customer_phone: string | null;
  network: string | null;
  package_size: string | null;
  amount: number | string | null;
  status: string | null;
  payment_method: string | null;
  paystack_verified_amount: number | string | null;
  created_at: string;
};
type RefundRow = { reference_id: string | null; amount: number | string; agent_id: string | null; created_at: string };

const money = (n: number) => Number(n.toFixed(2));
const ghs = (n: number) => `GH₵${n.toFixed(2)}`;
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

/** Checks the nightly Paystack check doesn't cover: double refunds, double deliveries, delivered-but-underpaid. */
export function findLedgerIssues(input: { orders: OrderRow[]; refunds: RefundRow[] }): ReconIssue[] {
  const issues: ReconIssue[] = [];

  // 1. The same order refunded to a wallet more than once
  const byRef = new Map<string, RefundRow[]>();
  for (const r of input.refunds) {
    const ref = String(r.reference_id || "").trim();
    if (!ref || Number(r.amount) <= 0) continue;
    byRef.set(ref, [...(byRef.get(ref) || []), r]);
  }
  for (const [ref, rows] of byRef) {
    if (rows.length < 2) continue;
    const extra = money(rows.slice(1).reduce((s, r) => s + Number(r.amount || 0), 0));
    issues.push({
      key: `refunded_twice:${ref}`,
      type: "refunded_twice",
      order_id: ref,
      amount_ghs: extra,
      detail: `Order refunded ${rows.length} times; ${ghs(extra)} more than once`,
      context: { refunds: rows.length, agent_id: rows[0].agent_id, refund_times: rows.map((r) => r.created_at) },
    });
  }

  // 2 + 3. Delivered orders
  const delivered = input.orders
    .filter((o) => ["fulfilled", "completed"].includes(String(o.status || "").toLowerCase()) && Number(o.amount || 0) > 0)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lastBySig = new Map<string, OrderRow>();
  for (const o of delivered) {
    const amount = Number(o.amount || 0);
    if (String(o.payment_method || "").toLowerCase() === "paystack") {
      const verified = Number(o.paystack_verified_amount || 0);
      if (verified < amount - 0.05) {
        issues.push({
          key: `delivered_not_fully_paid:${o.id}`,
          type: "delivered_not_fully_paid",
          order_id: o.id,
          amount_ghs: money(amount - verified),
          detail: `Delivered ${ghs(amount)} order, Paystack verified ${ghs(verified)}`,
          context: { order_amount: amount, verified_amount: verified, network: o.network, package_size: o.package_size },
        });
      }
    }
    if (o.customer_phone && o.network && o.package_size) {
      const sig = `${o.agent_id || "guest"}|${o.customer_phone}|${o.network}|${o.package_size}`;
      const prev = lastBySig.get(sig);
      if (prev && new Date(o.created_at).getTime() - new Date(prev.created_at).getTime() <= DUPLICATE_WINDOW_MS) {
        issues.push({
          key: `delivered_twice:${o.id}`,
          type: "delivered_twice",
          order_id: o.id,
          amount_ghs: money(amount),
          detail: `${o.network} ${o.package_size} delivered twice to the same number within 2 minutes`,
          context: { first_order_id: prev.id, phone: o.customer_phone, agent_id: o.agent_id },
        });
      }
      lastBySig.set(sig, o);
    }
  }
  return issues;
}

const FALLBACK: Record<string, { explanation: (i: ReconIssue) => string; next_step: string }> = {
  paid_without_order: {
    explanation: (i) => `Paystack received ${ghs(i.amount_ghs)} but no order exists for this payment. Usually checkout stopped after payment or the Paystack webhook was missed.`,
    next_step: "Find the payment in Paystack. If the customer didn't get their bundle, refund it through the refund service (an admin confirms).",
  },
  paid_not_credited: {
    explanation: (i) => `A wallet top-up of ${ghs(i.amount_ghs)} was paid on Paystack but the wallet was not credited yet.`,
    next_step: "Open the top-up on the Wallet Ledger page and check the agent's balance before crediting by hand with an approved adjustment.",
  },
  credited_without_payment: {
    explanation: (i) => `A wallet was credited ${ghs(i.amount_ghs)} for a Paystack top-up, but no successful Paystack payment was found for it in the window.`,
    next_step: "Look the reference up in Paystack. If there is no payment, request a wallet adjustment to reverse it (a second admin approves).",
  },
  credit_exceeds_payment: {
    explanation: (i) => `The wallet was credited more than Paystack actually received (${i.detail}).`,
    next_step: "Compare the ledger entry with the Paystack payment and request a wallet adjustment for the difference.",
  },
  refunded_twice: {
    explanation: (i) => `This order was refunded to the wallet more than once, so ${ghs(i.amount_ghs)} too much went back.`,
    next_step: "Check the order and the agent's ledger, then request a wallet adjustment to take back the extra refund (a second admin approves).",
  },
  delivered_twice: {
    explanation: () => "The same bundle went to the same number twice within 2 minutes. This is usually a double click or a duplicate send.",
    next_step: "Check with the provider whether both were delivered. If the customer paid once, refund or charge through the normal admin tools.",
  },
  delivered_not_fully_paid: {
    explanation: (i) => `This Paystack order was delivered, but Paystack verified ${ghs(i.amount_ghs)} less than the order amount.`,
    next_step: "Look the payment up in Paystack and check whether the customer paid in full before taking any action.",
  },
};

export function fallbackExplanation(issue: ReconIssue): { explanation: string; next_step: string } {
  const f = FALLBACK[issue.type];
  if (!f) return { explanation: issue.detail, next_step: "Review this item on the Orders and Wallet Ledger pages." };
  return { explanation: f.explanation(issue), next_step: f.next_step };
}

const UNSAFE = /re-?send|re-?try|retry|heal|verify-payment|force|re-?dispatch|re-?deliver|send (it|the order) again/i;
const numbersIn = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(",", ".")));

/** Uses the AI's text only when it is safe: known key, no new numbers, no re-send advice. */
export function mergeExplanations(issues: ReconIssue[], ai: unknown): ExplainedIssue[] {
  const list = ai && typeof ai === "object" && Array.isArray((ai as any).explanations) ? (ai as any).explanations : [];
  const byKey = new Map<string, any>();
  for (const e of list) if (e && typeof e.key === "string") byKey.set(e.key, e);
  return issues.map((issue) => {
    const fb = fallbackExplanation(issue);
    const e = byKey.get(issue.key);
    const explanation = typeof e?.explanation === "string" ? e.explanation.trim().slice(0, 400) : "";
    const next_step = typeof e?.next_step === "string" ? e.next_step.trim().slice(0, 300) : "";
    const known = new Set([...numbersIn(JSON.stringify(issue)), issue.amount_ghs, 0, 1, 2]);
    const invents = numbersIn(`${explanation} ${next_step}`).some((n) => !known.has(n));
    const ok = explanation.length >= 20 && next_step.length >= 10 && !invents && !UNSAFE.test(`${explanation} ${next_step}`);
    return ok ? { ...issue, explanation, next_step, explained_by: "ai" as const } : { ...issue, ...fb, explained_by: "rules" as const };
  });
}

export const MAX_EXPLAINED = 40;

export function buildExplainPrompt(issues: ReconIssue[]): { system: string; user: string } {
  const system = `You explain payment reconciliation problems for SwiftData, a Ghanaian mobile data reseller, to its owner in plain, short English.
For each issue write: "explanation" (1-2 sentences: what happened and the most likely cause) and "next_step" (one sentence: what an admin should check or do).
Rules:
- Use only the numbers, ids and facts in the issue. Never invent amounts, counts, dates or ids.
- Never suggest re-sending, retrying, healing or re-delivering an order, and never suggest forcing a payment check. Refunds and wallet corrections go through the refund service or an approved wallet adjustment.
- Respond with RAW JSON only: {"explanations":[{"key":"<issue key>","explanation":"...","next_step":"..."}]}`;
  const user = JSON.stringify({
    issues: issues.slice(0, MAX_EXPLAINED).map((i) => ({ key: i.key, type: i.type, order_id: i.order_id, amount_ghs: i.amount_ghs, detail: i.detail, context: i.context ?? {} })),
  });
  return { system, user };
}
