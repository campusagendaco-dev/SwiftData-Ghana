// Admin actions that move money, send orders or spend message credit. Every call to these from
// an admin page must go through useConfirmedCall() so the admin confirms first (owner rule,
// 2026-11-24). src/test/admin-sensitive-coverage.test.ts enforces it.

export const SENSITIVE_FUNCTIONS = new Set([
  // money
  "verify-and-refund",
  "wallet-reconcile",
  // sends / re-sends orders
  "admin-retry-autorouter",
  "verify-payment",
  "check-order-status",
  "heal-processing-orders",
  "route-to-datamart",
  "cron-auto-retry",
  // message credit
  "admin-send-sms",
  "send-push-notification",
  "process-scheduled-sms",
  "admin-broadcast-whatsapp",
  "mnotify-voice",
  "cron-winback-push",
]);

export const SENSITIVE_RPCS = new Set([
  "refund_failed_order",
  "debit_wallet",
  "repay_agent_credit",
  "credit_order_profits",
  "dispatch_missed_you_push_broadcast",
]);

/** admin-user-actions actions that move money, fulfil, fail or re-send orders. */
export const SENSITIVE_USER_ACTIONS = new Set([
  "refund_order",
  "decide_wallet_adjustment",
  "force_fulfill_order",
  "heal_stuck_orders",
  "bulk_update_order_status",
]);

/** challenge-arena admin actions that move stake or prize money. */
export const SENSITIVE_ARENA_ACTIONS = new Set(["admin_close_staked_rooms", "admin_update_claim"]);

/** system-payout-v1 actions that move money or fulfil orders. */
export const SENSITIVE_PAYOUT_ACTIONS = new Set([
  "manual_topup",
  "manual_api_topup",
  "update_credit_limit",
  "confirm_withdrawal",
  "reject_withdrawal",
  "paystack_payout",
  "bulk_fulfill_api_orders",
]);

export type ConfirmKind = "money" | "refund" | "payout" | "send" | "message";

export type ConfirmOptions = {
  title: string;
  description?: string;
  kind: ConfirmKind;
  /** How many orders/recipients the action touches. */
  orders?: number;
  /** Total money involved, in GH₵. */
  amountGhs?: number;
  confirmLabel?: string;
};

/** Amounts above this need the admin to type the amount. */
export const TYPED_AMOUNT_THRESHOLD_GHS = 100;

export const formatGhs = (n: number): string => Number(n || 0).toFixed(2);

/** Refunds, payouts and anything over GH₵100 need the amount typed (when there is an amount). */
export function needsTypedAmount(opts: Pick<ConfirmOptions, "kind" | "amountGhs"> & Partial<ConfirmOptions>): boolean {
  if (opts.amountGhs == null || !Number.isFinite(opts.amountGhs) || opts.amountGhs <= 0) return false;
  return opts.kind === "refund" || opts.kind === "payout" || opts.amountGhs > TYPED_AMOUNT_THRESHOLD_GHS;
}

/** Sum of order amounts, for bulk confirmations. */
export const sumAmounts = (rows: { amount?: number | string | null }[]): number =>
  rows.reduce((s, r) => s + (Number(r?.amount) || 0), 0);
