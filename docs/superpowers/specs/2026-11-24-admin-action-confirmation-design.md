# Admin action confirmation: design

**Status:** approved by the owner on 2026-11-24 ("go with your defaults").

## Why
The owner wants every admin action that moves money, refunds, sends or re-sends orders, or spends SMS or push credit to ask for confirmation first, showing what it will do. This follows an incident where 62 orders were re-sent unintentionally.

## Goals
- **One shared confirmation box** (`useConfirmAction`) for these actions. It shows the action, what will happen, the number of orders, and the total in GH₵, with Cancel and Confirm buttons.
- **Typed amount** for refunds, payouts, and anything over GH₵100: the admin must type the amount before Confirm is enabled.
- **Coverage:**
  - **Money:** manual wallet and API top-ups, credit limit changes, confirming or rejecting withdrawals, Paystack payout, `verify-and-refund`, `refund_failed_order`, `debit_wallet`, `repay_agent_credit`, `credit_order_profits`, `wallet-reconcile`.
  - **Sends:** `admin-retry-autorouter`, `verify-payment`, `check-order-status`, `heal-processing-orders`, `route-to-datamart`, `cron-auto-retry`, `bulk_fulfill_api_orders`.
  - **Messages:** `admin-send-sms`, `send-push-notification`, `process-scheduled-sms`, `dispatch_missed_you_push_broadcast`.
  - **Excluded:** single `send-order-sms` resends.
- **Remove the Orders page's automatic 3-minute status check.** It can re-send orders with no click, so it can't be confirmed. The manual button stays, behind confirmation.
- **A safety-net test** fails if an admin page or component calls any covered function directly instead of through the confirmed wrapper.

## Non-goals
- No server-side changes.
- No change to what each action does once confirmed.

## Approach
- **Chosen:** a provider mounted in `AdminLayout` exposes `useConfirmAction()`. A hook `useConfirmedCall()` returns `invoke(name, options, confirm)` and `rpc(name, args, confirm)`. These ask first, then call Supabase. When the admin cancels they return `{ cancelled: true }`, and call sites return early.
- **Rejected:** a separate confirmation written into each button. It's easy to miss on new buttons, and there's no test to catch that.
- **Rejected:** keeping `window.confirm`. It can't show amounts or require a typed amount.
