# Admin Action Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every admin action that moves money, sends orders, or spends message credit asks first, with amount and count shown.

**Architecture:** `ConfirmActionProvider` (mounted in `AdminLayout`) plus `useConfirmedCall()`, which wraps `supabase.functions.invoke` and `supabase.rpc`. A source-scanning test guards coverage.

**Tech Stack:** React 18, shadcn AlertDialog, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-admin-action-confirmation-design.md`

## Global Constraints
- Covered names (exact):
  - **Functions:** `verify-and-refund`, `admin-retry-autorouter`, `verify-payment`, `check-order-status`, `heal-processing-orders`, `route-to-datamart`, `cron-auto-retry`, `wallet-reconcile`, `admin-send-sms`, `send-push-notification`, `process-scheduled-sms`.
  - **RPCs:** `refund_failed_order`, `debit_wallet`, `repay_agent_credit`, `credit_order_profits`, `dispatch_missed_you_push_broadcast`.
  - **`system-payout-v1` actions:** `manual_topup`, `manual_api_topup`, `update_credit_limit`, `confirm_withdrawal`, `reject_withdrawal`, `paystack_payout`, `bulk_fulfill_api_orders`.
- Typed amount is required when `kind` is `refund` or `payout`, or the amount is over 100. The input must equal the amount formatted to 2 decimals.
- When the admin cancels, return `{ data: null, error: null, cancelled: true }`. Every call site returns early on `cancelled`, so no success toast or state change happens.
- Admin pages only. Customer-facing pages (`Dashboard*`, `OrderStatus`, `PurchaseSuccess`, `FreeDataClaimBanner`, `PaystackMomoCheckout`) are untouched.

## Review Focus
- A cancelled action must not show "success" or change local state.
- Bulk actions must show the selected count and the summed amount.
- The Orders page must have no `setInterval` that calls `check-order-status` or a bulk check.
- The confirmation box must work on top of other open dialogs and drawers, such as `UserDetailDrawer`.

---

### Task 1: Provider, hook and safety-net test
- Create `src/components/admin/ConfirmActionProvider.tsx`. It exports `ConfirmActionProvider`, `useConfirmAction()` returning `confirm(opts): Promise<boolean>`, and `useConfirmedCall()` returning `{ invoke, rpc }`.
  - Opts: `{ title: string; description?: string; kind: "money" | "refund" | "payout" | "send" | "message"; orders?: number; amountGhs?: number; confirmLabel?: string }`.
- Create `src/lib/adminSensitive.ts` with the covered-name sets and `needsTypedAmount(opts)`.
- Mount the provider around `<Outlet />` in `AdminLayout`, plus a fallback provider for components rendered outside it.
- Tests (`src/test/admin-confirm.test.tsx`):
  - Cancel resolves to false and doesn't call Supabase.
  - Confirm calls through.
  - Typed amount gates the button for refunds and for amounts over 100.
  - The count and GH₵ are shown.
- Safety test (`src/test/admin-sensitive-coverage.test.ts`): scan `src/pages/Admin*.tsx`, `src/components/UserDetailDrawer.tsx` and `src/components/AdminLayout.tsx` for direct `functions.invoke("<covered>")`, `rpc("<covered>")`, or `system-payout-v1` with a covered action within 8 lines. Fail and list `file:line`. It starts red; it goes green after Tasks 2–4.

### Task 2: Order pages (sends and refunds)
`AdminOrders`, `AdminAPIOrders`, `AdminAirtimeOrders`, `AdminAfaOrders`, `AdminBeneficiaryOrders`, `AdminMashUpOrders`, `AdminStandardOrders`, `AdminUtilityOrders`, `AdminRefundedOrders`, `UserDetailDrawer`, `AdminSystemHealth`, `AdminSystemLogs`, `AdminReconciliation`: convert covered calls. Remove the 3-minute automatic bulk check in `AdminOrders`.

### Task 3: Money pages
`AdminAgents`, `AdminSubAgents`, `AdminUsers`, `AdminAPIUsers`, `AdminCreditManagement`, `AdminWalletTopup`, `AdminWalletLedger`, `AdminWithdrawals`, `AdminOverview`, `AdminKorbaHub`, `AdminPackages`, `AdminKorbaPackages`, `AdminSecurity`, `AdminSettings`, `AdminLayout`: convert covered calls.

### Task 4: Finish
Safety test green, full suite green, tsc clean. Commit per task.
