# Safe backend AI agents: design

Date: 2026-11-24. Branch: `feature/ai-ops-safe`. It starts from the owner's draft, saved as-is in commits 09f15580, 17e12369 and 498a75e5.

## Why

The owner wants AI agents working in the backend: watching orders, providers, fraud and support, and learning what normal looks like. They don't want agents to become a new way for money or orders to go wrong. Two owner rules apply:

- **Never re-send orders.** Nothing may trigger a re-send: no heal, no `check-order-status`, no forced `verify-payment`.
- **Explicit admin yes before a live change.** That covers refunds, payouts, sends, messages and live data changes, with counts and GH₵ amounts shown first.

The draft breaks both rules:
- `ops-worker-ai` runs every 5 minutes in `autonomous` mode and calls `verify-payment` and `heal-processing-orders` on orders the AI picks.
- `threat-hunter`, `aml-scanner` and `account-cloner` get cron jobs, and each suspends accounts in bulk by itself.
- `broadcast_outage` texts every agent. The no-AI fallback can trigger it too.
- `guardian-ai`, already on main, marks orders as failed and relinks their providers by itself.

## Starting point (owner's choice)

Agents **watch, explain and propose**. Anything that sends, refunds, credits, suspends, messages customers or agents, or changes routing waits in a queue. An admin approves it in the confirmation box after entering their 2FA code.

## Goals

1. **One policy for all agents.** One list decides what each action type may do:
   - `auto`: the agent may do it by itself
   - `approval`: it waits for an admin yes
   - `forbidden`: never done, and never offered as a button

   An action type not on the list is `forbidden`.
2. **Agents can never touch orders or money.** No agent calls `verify-payment`, `heal-processing-orders`, `check-order-status`, `process-retries`, any refund function, `credit_wallet`/`debit_wallet`, or updates `orders`. A test enforces this. The one exception is in "Owner decision" below.
3. **Approval is safe.** Approving a task goes through the admin confirmation box, which shows how many users, agents or providers it affects. The server then checks again:
   - the admin has entered their 2FA code
   - the task is still waiting
   - the action is still `approval`
   - the task is within its size limits

   Only then does the server run it, and it records who approved it.
4. **Safe defaults.** Every agent starts in `observe_only`. Raising an agent to `propose` goes through the confirmation box. The draft's `autonomous` mode is removed.
5. **The fallback proposes nothing.** When all models fail, the rules-only fallback writes a summary and nothing else.
6. **2FA on the data.** The new tables use `is_admin()`, so only an admin with 2FA can read them. Writes go only through the service role, except mode and model changes on the registry.

## Non-goals

- Ama (`oracle-ai`), `android-sms-bot` and `support-bot` stay as they are. Customers start those flows themselves.
- The auto-refund and order jobs that already exist outside the AI agents are out of scope.
- The reconciliation page redesign is paused, and nothing here builds a reconciliation agent yet.

## Anti-goals (a failure even if it works)

- Any path where an AI, or the no-AI fallback, causes an order to be sent or re-sent, money to move, or a customer or agent to get a message without an admin yes.
- An approval button that runs something different from what the admin was shown.

## Action policy

| Action types | Policy | Notes |
|---|---|---|
| record findings, memory, strategies, `fraud_risk_logs`, `aml_alerts`, `duplicate_account_flags`, `flag_review`, `flag_aml_review` | auto | Records only. No effect on users, orders or money. |
| `notify_admin` | auto | Admins only. In-app alert always. At most 1 SMS per topic per hour and 10 admin SMS per day across all agents. |
| `suspend_agent`, `suspend_cluster`, `suspend_login_bot`, `suspend_referral_ring` | approval | Up to 20 accounts per task. The box lists names and the count. |
| `blacklist_ip`, `freeze_cashouts`, `lock_terminal` | approval | |
| `switch_priority`, `rebalance_sme_provider`, `self_heal_provider`, `disable_network` | approval | Korba can never be set to priority 1 for SME data (kept from the draft). |
| `broadcast_outage` | approval | The box shows the recipient count. |
| `quarantine_order`, `relink_order_provider` (guardian-ai today) | approval | Becomes a proposal. It never sets an order to failed by itself. |
| `heal_stuck_orders`, any verify, heal, retry or re-send, refunds, wallet credit or debit | forbidden | An agent may report "N stuck orders, GH₵X" as a read-only finding that links to the existing order pages. There's no button. |
| anything else | forbidden | Logged and dropped. |

## How it's built (my calls)

- **`supabase/functions/_shared/agent_policy.ts`:** holds the policy table plus `routeAgentAction(...)`. That function returns `drop`, `queue` or `run` depending on the policy, the agent's mode and the size limits. Every agent sends its actions through it, and no agent runs an action any other way.
- **Agent modes:**
  - `observe_only`: findings and admin alerts only.
  - `propose`: also queues approval tasks.

  The migration adds a CHECK constraint and sets every existing agent to `observe_only`.
- **Approval function, `ai-task-decide`:** it needs an admin who has entered their 2FA code (`verifyAdmin`). It handles approve and reject, rechecks the task as in goal 3, and runs a fixed handler per action type. The AI's text is never treated as code or a query. It records `approved_by`, `executed_at`, the result and an audit log entry.
- **Admin UI:**
  - The draft's Sentinel AI page gets an approval queue: title, reasoning, what changes, and Approve or Reject.
  - Approve goes through `confirmed.confirm`, with kinds `access`, `message` or a new `ops` kind ("This changes how orders are routed").
  - Switching an agent's mode, or running it now, also goes through the box.
  - `ai-task-decide` is added to the admin safety test.
- **Agent safety test:** a new test that scans the AI agent functions for forbidden calls (the list in goal 2), with an allow-list of one place for the owner's decision below.
- **Models:** each agent keeps the model it has now. OpenAI is only a fallback, used when an `OPENAI_API_KEY` exists. The draft's switch of every agent to `gpt-4o-mini` is dropped.
- **Spend:** the draft's daily budget cap ($5) and run log stay.
- **Schedules:**
  - `ops-worker-ai` every 15 minutes, not 5. It's observe-only, so faster checks only add noise and cost.
  - The other three new schedules are kept, in `observe_only`.
- **Kept from the draft:** spend tracking, system memory, the run log, the task queue table, and the Korba priority-1 guard.
- **Go-live, run by the owner:** paste the rewritten migration into the SQL editor (never `db push`), then deploy the changed functions. A read-only SQL checks file comes with it.

## Owner decision: the payment-webhook backup in `sentinel-ai`

On main today, every `sentinel-ai` run calls `verify-payment` on `pending` orders that are between 5 minutes and 2 hours old. It's a backup for a missed Paystack webhook. It sends only orders Paystack confirms as paid that were never sent, so it's a first send, not a re-send. The AI doesn't choose the orders; it's a fixed query.

The draft adds these guards:
- at most 10 orders per run
- each order up to GH₵100
- up to GH₵500 per run
- at most 2 tries per order, 15 minutes apart
- skip an order if the same phone and package was delivered or is in progress in the last 30 minutes

Options:
- **A. Keep it, with the draft's guards, as the only allow-listed exception.** Recommended: without it, paid orders with a missed webhook wait for the customer or support.
- **B. Move it out of the AI agent into a plain scheduled job.** Same behaviour, separated from AI code.
- **C. Turn it off.**

**Decision (owner, 2026-11-24): A.** Keep it inside `sentinel-ai`, with the draft's guards, as the single allow-listed exception in the agent safety test. The guards are:
- at most 10 orders per run
- each order up to GH₵100
- up to GH₵500 per run
- at most 2 tries per order, 15 minutes apart
- skip an order if the same phone and package was delivered or is in progress in the last 30 minutes

It calls `verify-payment` without `force`, and only for `pending` orders. It never touches `processing` or failed orders.

The design was approved by the owner on 2026-11-24.

## Left to the builder

- exact table and column names for the policy log
- how the approval queue looks inside the page's existing layout (theme tokens)
- the wording of each confirmation box, following the existing ones
