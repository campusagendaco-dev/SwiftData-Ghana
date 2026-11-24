# Safe Backend AI Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI agents watch, explain and propose. Every action that changes accounts, routing or messaging waits for an admin who has entered their 2FA code. No agent can send, re-send or refund an order, or move money. The one exception is the payment-webhook backup (option A).

**Architecture:** Two shared modules decide everything:
- `_shared/agent_policy.ts` is a pure decision module: what each action may do.
- `_shared/agent_actions.ts` holds the queueing, the auto actions and fixed handlers for approved tasks.

Every agent sends AI-proposed actions through `routeAgentAction`. Approvals go through a new `ai-task-decide` function, which needs an admin who has entered their 2FA code and claims the task first so it can run only once. A source-scanning test stops agents from calling anything that sends orders or moves money.

**Tech Stack:** Supabase Edge Functions (Deno TS), Postgres/RLS/pg_cron, React + Vite, Vitest. Shared Deno modules are unit-tested from Vitest with fake clients, as in `src/test/admin-list.test.ts`. SQL is checked locally with the PGlite harness.

**Spec:** `docs/superpowers/specs/2026-11-24-safe-ai-agents-design.md`

## Global Constraints

- **Starting code:** the owner's draft commits 09f15580, 17e12369 and 498a75e5 on `feature/ai-ops-safe`. Keep the draft's spend cap ($5/day), run log (`ai_agent_runs`), system memory, task queue table and Korba priority-1 guard.
- **Modes:** only `observe_only` and `propose`. Default `observe_only`. Anything missing, unknown or unreadable is treated as `observe_only`. `autonomous` and `approval_required` are removed.
- **Unknown actions:** an action type not in the policy table is `forbidden`. Action types are compared lower-cased and trimmed.
- **Suspensions:** up to 20 accounts per task.
- **`notify_admin`:** an in-app alert always. At most 1 SMS per topic per hour, and 10 admin SMS per day across all agents.
- **Payment backup (sentinel-ai only):**
  - `pending` orders only, created between 5 minutes and 2 hours ago
  - at most 10 per run
  - each order up to GH₵100
  - up to GH₵500 per run
  - at most 2 tries per order, 15 minutes apart
  - skip an order if the same phone, network and package was fulfilled, completed or processing in the last 30 minutes
  - `verify-payment` is called with `{ reference }` only, never `force`
- **Forbidden in agent code:**
  - calls to `verify-payment`, `heal-processing-orders`, `check-order-status`, `process-retries`, `verify-and-refund`, `admin-retry-autorouter`, `route-to-datamart` or `cron-auto-retry`
  - the RPCs `credit_wallet`, `debit_wallet` and `refund_failed_order`
  - any write to `orders`
  - `checkMfa: false`
- **Models:** each agent keeps its current `active_model`. OpenAI is a fallback only when `OPENAI_API_KEY` exists. Never bulk-switch to `gpt-4o-mini`.
- **New tables:** RLS uses `public.is_admin()`. Admins can SELECT only. Writes go through the service role, except `ai_agent_registry`, where an admin may UPDATE `is_active`, `autonomy_mode` and `active_model`.
- **Schedules:** `ops-worker-ai` every 15 minutes. `threat-hunter` every 5, `aml-scanner` every 10, `account-cloner` every 20. All schedules are in a second SQL file that the owner runs after the deploy.
- **Owner-run go-live:** paste SQL in the SQL editor (never `db push`). The owner deploys functions.
- **Admin UI:** new UI uses theme tokens. Every approve and every mode raise goes through `useConfirmedCall().confirm`.
- **Low memory:** run tests with `npx vitest run --no-file-parallelism`, and tsc with `NODE_OPTIONS=--max-old-space-size=4096`.

## Review Focus

1. **The draft migration may already have been pasted.** The new SQL must still leave every agent in `observe_only`. It removes the 5-minute ops job and the admin policies that skip 2FA. This is a PGlite test in Task 8.
2. **Two admins approve the same task, or one double-clicks.** Exactly one run happens; the second gets "Task is already being decided or done". This is a test in Task 3.
3. **The AI returns odd action types or payloads:**
   - `" Heal_Stuck_Orders "` must be forbidden.
   - 25 user ids, non-string ids or a missing id must be refused at queue time and again at approval.

   These are tests in Tasks 1 and 3.
4. **The registry row or the `autonomy_mode` column is missing,** because functions are deployed before the SQL. The agent must act as `observe_only`. This is a test in Task 4.
5. **All models fail.** The rules-only fallback must return no actions, so it can't trigger `broadcast_outage` or provider switches. This is a test in Task 4.

---

### Task 1: Action policy module

**Files:**
- Create: `supabase/functions/_shared/agent_policy.ts`
- Test: `src/test/agent-policy.test.ts`

**Interfaces:**
- Produces:
  - `type AgentMode = "observe_only" | "propose"`
  - `type ActionPolicy = "auto" | "approval" | "forbidden"`
  - `type AgentAction = { type: string; params?: Record<string, unknown>; title?: string; reason?: string; priority?: string }`
  - `normalizeMode(raw: unknown): AgentMode`
  - `normalizeActionType(raw: unknown): string`
  - `policyFor(type: string): ActionPolicy`
  - `checkActionLimits(action: AgentAction): { ok: true } | { ok: false; reason: string }`
  - `routeAgentAction(mode: AgentMode, action: AgentAction): { route: "drop" | "record" | "queue" | "run"; reason: string }`
  - `confirmKindFor(type: string): "account" | "ops" | "message"`
  - `MAX_ACCOUNTS_PER_TASK = 20`

**What each action type maps to:**

| Action types | Policy | Confirm kind |
|---|---|---|
| `record_finding`, `record_memory`, `record_strategy`, `flag_review`, `flag_aml_review`, `notify_admin` | auto | none |
| `suspend_agent`, `suspend_cluster`, `suspend_login_bot`, `suspend_referral_ring` | approval | `account` |
| `blacklist_ip`, `freeze_cashouts`, `lock_terminal` | approval | `account` |
| `switch_priority`, `rebalance_sme_provider`, `self_heal_provider`, `disable_network` | approval | `ops` |
| `quarantine_order`, `relink_order_provider` | approval | `ops` |
| `broadcast_outage` | approval | `message` |
| everything else, including `heal_stuck_orders` and `triage_ticket` | forbidden | none |

**Routing:**
- forbidden → `drop`
- auto → `run` in both modes
- approval → `queue` in `propose` mode, `record` in `observe_only` (the agent stores it as a "would propose" finding)
- approval that fails `checkActionLimits` → `drop`

**Limits:** these apply to the params of approval actions.
- `user_ids` / `member_ids` must be an array of 1–20 non-empty strings.
- `user_id`, `agent_id`, `provider_id`, `order_id` and `ip` must be non-empty strings when the type needs them:
  - `suspend_agent`, `lock_terminal` and `suspend_login_bot` need `user_id`
  - `freeze_cashouts` needs `agent_id`
  - the provider types need `provider_id`
  - the order types need `order_id`
  - `blacklist_ip` needs `ip`

- [ ] **Step 1: Write the failing tests** in `src/test/agent-policy.test.ts`:
  - `normalizeMode(undefined) === "observe_only"`, `normalizeMode("autonomous") === "observe_only"`, `normalizeMode(" PROPOSE ") === "propose"`
  - `policyFor(normalizeActionType(" Heal_Stuck_Orders ")) === "forbidden"`; `policyFor("made_up") === "forbidden"`; `policyFor("triage_ticket") === "forbidden"`
  - `routeAgentAction("observe_only", { type: "suspend_cluster", params: { user_ids: ["a"] } }).route === "record"`
  - `routeAgentAction("propose", { type: "suspend_cluster", params: { user_ids: ["a"] } }).route === "queue"`
  - `routeAgentAction("propose", { type: "suspend_cluster", params: { user_ids: Array.from({ length: 21 }, (_, i) => "u" + i) } }).route === "drop"`
  - `checkActionLimits({ type: "suspend_cluster", params: { user_ids: ["a", 5] } }).ok === false`
  - `routeAgentAction("observe_only", { type: "notify_admin" }).route === "run"`
  - `routeAgentAction("propose", { type: "heal_stuck_orders" }).route === "drop"`
  - `confirmKindFor("switch_priority") === "ops"`, `confirmKindFor("broadcast_outage") === "message"`, `confirmKindFor("blacklist_ip") === "account"`
- [ ] **Step 2: Run** `npx vitest run src/test/agent-policy.test.ts`. Expect FAIL: the module is not found.
- [ ] **Step 3: Implement** `agent_policy.ts` per the Interfaces block and table above. Pure code: no Deno or network imports.
- [ ] **Step 4: Run** the same command. Expect PASS.
- [ ] **Step 5: Commit** with message `feat(ai): action policy for backend agents`.

### Task 2: Shared action runner (queue, auto actions, approved handlers)

**Files:**
- Create: `supabase/functions/_shared/agent_actions.ts`
- Test: `src/test/agent-actions.test.ts`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `queueAgentAction(db, agentName: string, action: AgentAction): Promise<{ queued: boolean; reason?: string }>`. It inserts into `ai_worker_tasks` with `status: "awaiting_approval"` and `task_type`, `title`, `reasoning`, `payload: params`, `priority`. It skips the insert when a task with the same `task_type` and `title` is already `awaiting_approval`.
  - `runAutoAction(db, agentName: string, action: AgentAction): Promise<{ ok: boolean; details?: unknown }>`. It handles only auto types:
    - `notify_admin` always inserts an in-app admin alert into `sentinel_actions` (`action_type: "notify_admin"`). It sends an SMS through `dispatchUnifiedSms` only when no `notify_admin` SMS with the same topic was sent in the last hour, and fewer than 10 admin SMS were sent today. The topic is `params.topic` or the first 30 characters of the message. Every SMS is recorded in `sentinel_actions.metadata.sms_sent = true`.
    - The `flag_*` and `record_*` types insert into the tables those agents already use. `record_finding` takes `params.would_propose` (an `AgentAction`) for `record` routes and writes it to `ai_insights` with the title prefix "Would propose: ".
  - `executeApprovedAction(db, task: { task_type: string; payload: Record<string, unknown> }): Promise<{ ok: boolean; details?: unknown; error?: string }>`. It holds a fixed handler per approval type and re-runs `checkActionLimits` first. Each handler does the same writes the draft agents do for that type today:
    - the suspend types set `profiles.is_suspended = true`
    - `lock_terminal` sets `terminal_locked`
    - `blacklist_ip` inserts into `security_blacklist`
    - `freeze_cashouts` inserts the aml alert
    - the provider types update `providers`, with the Korba guard: refuse to set Korba to priority 1
    - `disable_network` updates `service_status`
    - `broadcast_outage` sends the outage SMS to agents, as `sentinel-ai` does
    - `quarantine_order` and `relink_order_provider` copy `guardian-ai`'s two order updates

  Approved order changes may live only in this file.

- [ ] **Step 1: Write failing tests** with a fake `db` that records calls. The fake is built like `fakeAdmin` in `admin-list.test.ts`, with insert, update, select, eq, in, gte and maybeSingle.
  - A second `queueAgentAction` with the same type and title while the first is awaiting → `{ queued: false }` and only one insert.
  - `runAutoAction(db, "x", { type: "suspend_cluster", params: { user_ids: ["a"] } })` → `{ ok: false }` with no writes, because it isn't an auto type.
  - `notify_admin`, given 10 SMS already recorded today → alert inserted, no SMS sent.
  - `notify_admin`, given the same topic sent 30 minutes ago → no SMS.
  - `executeApprovedAction(db, { task_type: "suspend_cluster", payload: { user_ids: ["a", "b"] } })` → one `profiles` update with `is_suspended: true` for exactly `["a", "b"]`.
  - `executeApprovedAction` with 21 ids → `{ ok: false }` and no writes.
  - `executeApprovedAction(db, { task_type: "heal_stuck_orders", payload: {} })` → `{ ok: false, error: "forbidden" }`.
  - `switch_priority` to priority 1 on a provider whose `handler_type` is `korba` → `{ ok: false }` and no update.

  Mock `dispatchUnifiedSms` with `vi.mock`.
- [ ] **Step 2: Run** `npx vitest run src/test/agent-actions.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** `agent_actions.ts` per the Interfaces block.
- [ ] **Step 4: Run** the same command. Expect PASS.
- [ ] **Step 5: Commit** with message `feat(ai): shared queue, capped admin alerts and fixed approval handlers`.

### Task 3: Approval function `ai-task-decide`

**Files:**
- Create: `supabase/functions/_shared/agent_task_decide.ts`
- Create: `supabase/functions/ai-task-decide/index.ts`
- Test: `src/test/agent-task-decide.test.ts`

**Interfaces:**
- Consumes: `executeApprovedAction` (Task 2) and `policyFor` (Task 1).
- Produces:
  - `decideTask(db, input: { taskId: string; approve: boolean; adminId: string }): Promise<{ status: number; body: Record<string, unknown> }>`
  - An edge function with body `{ task_id: string, approve: boolean }`. It calls `verifyAdmin(req, db)` with no options, which means 2FA is required, then `decideTask`.

**How `decideTask` works:**
1. Claim the task atomically: `update({ status: "deciding" }).eq("id", taskId).eq("status", "awaiting_approval").select().maybeSingle()`. With no row, return 409 `{ error: "Task is already being decided or done" }`.
2. On reject: set `status: "rejected"` and `approved_by`, then return 200.
3. On approve: check `policyFor(task.task_type) === "approval"`, run `executeApprovedAction`, and set `status` to `executed` or `failed`, plus `result`, `approved_by` and `executed_at`.
4. Write an audit row to `audit_logs` with action `ai_task_approved` or `ai_task_rejected`, the task id and the type.

- [ ] **Step 1: Write failing tests:**
  - Two concurrent `decideTask` calls on the same awaiting task → exactly one 200 and one 409, and `executeApprovedAction` runs once. The fake's conditional update succeeds once.
  - A task whose type is now forbidden → status `failed`, `error: "forbidden"`, no handler writes.
  - Reject → `rejected`, with no handler call.
  - An unknown `taskId` → 409.
- [ ] **Step 2: Run** `npx vitest run src/test/agent-task-decide.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** `agent_task_decide.ts`, plus `index.ts` (CORS, `verifyAdmin` with default options, JSON in and out, as in other admin functions).
- [ ] **Step 4: Run** the same command. Expect PASS.
- [ ] **Step 5: Commit** with message `feat(ai): ai-task-decide approves agent tasks once, with 2FA`.

### Task 4: `ai.ts` safe defaults

**Files:**
- Modify: `supabase/functions/_shared/ai.ts`: `getAgentConfig`, `generateHeuristicFallback`, and the model normalisation that rewrites models
- Test: `src/test/ai-defaults.test.ts`

**Interfaces:**
- Produces:
  - `getAgentConfig(db, name)` returns `{ is_active: boolean; active_model: string; autonomy_mode: AgentMode; daily_budget_usd: number }`. `autonomy_mode` goes through `normalizeMode`, so it's `observe_only` on a missing row, a missing column, a query error or an unknown value.
  - `generateHeuristicFallback` is exported and returns JSON text whose `actions` is always `[]`. It keeps its summary.

- [ ] **Step 1: Write failing tests:**
  - A fake db whose select errors with `column "autonomy_mode" does not exist` → `autonomy_mode === "observe_only"`.
  - A missing row → `observe_only`.
  - `JSON.parse(generateHeuristicFallback("sentinel_prime", "…", "… MTN failures 40% …").text).actions` equals `[]`.
  - `normalizeModelName("claude-haiku-4-5-20251001") === "claude-haiku-4-5-20251001"`, so current models are kept.

  Define `globalThis.Deno = { env: { get: () => undefined } }` before importing.
- [ ] **Step 2: Run** `npx vitest run src/test/ai-defaults.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** the three changes. Keep the cascade and the budget cap. OpenAI joins the cascade only when its key exists, as the draft already does.
- [ ] **Step 4: Run** the same command. Expect PASS.
- [ ] **Step 5: Commit** with message `fix(ai): unknown mode is observe-only, fallback proposes nothing, keep agents' models`.

### Task 5: Agent safety scan test + `ops-worker-ai`

**Files:**
- Create: `src/test/agent-safety-scan.test.ts`
- Modify: `supabase/functions/ops-worker-ai/index.ts`

**Interfaces:**
- Consumes: `routeAgentAction`, `queueAgentAction`, `runAutoAction` and `getAgentConfig` (Tasks 1, 2 and 4).
- Produces:
  - `AGENT_FILES` in the test. It starts as `["ops-worker-ai", "_shared/ai.ts"]`, and Tasks 6 and 7 add to it.
  - A scan that strips comments, then fails on any forbidden pattern from Global Constraints. Patterns may span lines: `from\(\s*["']orders["']\s*\)\s*\.(update|insert|delete|upsert)`.
  - `ALLOW`, the only allowed exception: in `sentinel-ai`, the lines between `// payment-backup:start` and `// payment-backup:end`. There, at most one `functions/v1/verify-payment` and one `orders` update are allowed. The `verify-payment` body must not contain `force`.

**`ops-worker-ai` changes:**
- Remove the `heal_stuck_orders` executor, the `execute_task`/`reject_task` modes (replaced by `ai-task-decide`), the `autonomous` branches and `checkMfa: false`.
- Patrol and command modes send each action through `routeAgentAction`:
  - `run` → `runAutoAction`
  - `queue` → `queueAgentAction`
  - `record` → `runAutoAction(db, agent, { type: "record_finding", params: { would_propose: action } })`
  - `drop` → add `{ type, reason }` to a `dropped` array in the response
- Command mode treats the agent as `propose`, since an admin asked.
- Stuck orders appear only in the summary, as "N stuck orders, GH₵X". The prompt no longer lists `heal_stuck_orders` or `triage_ticket`.

- [ ] **Step 1: Write the scan test** with `AGENT_FILES = ["ops-worker-ai/index.ts", "_shared/ai.ts"]`. Add a self-check that the scanner flags a fixture string containing `fetch(\`${URL}/functions/v1/heal-processing-orders\``.
- [ ] **Step 2: Run** `npx vitest run src/test/agent-safety-scan.test.ts`. Expect FAIL, listing the `ops-worker-ai` `verify-payment`, `heal-processing-orders` and `checkMfa: false` lines.
- [ ] **Step 3: Rewire `ops-worker-ai`** as described above.
- [ ] **Step 4: Run** the scan test and `npx vitest run src/test/agent-policy.test.ts src/test/agent-actions.test.ts`. Expect PASS.
- [ ] **Step 5: Commit** with message `fix(ai): ops worker only watches and proposes; agent safety scan test`.

### Task 6: `sentinel-ai`, `sentinel-evolve`, `guardian-ai`

**Files:**
- Modify: `supabase/functions/sentinel-ai/index.ts`, `supabase/functions/sentinel-evolve/index.ts`, `supabase/functions/guardian-ai/index.ts`
- Modify test: `src/test/agent-safety-scan.test.ts` (add the three files to `AGENT_FILES`)

**Interfaces:**
- Consumes: Tasks 1, 2 and 4.

**Changes:**
- **`sentinel-ai`:**
  - Wrap the payment backup in `// payment-backup:start` / `// payment-backup:end`, keeping the draft's guards exactly (Global Constraints).
  - The AI's `switch_priority`, `broadcast_outage` and `lock_terminal` go through `routeAgentAction`.
  - The direct provider updates and agent SMS outside the backup are removed. The `ai_worker_tasks` insert becomes `queueAgentAction`.
- **`sentinel-evolve`:** `self_heal_provider`, `switch_priority` and `lock_terminal` go through the router. Recording strategies and memory stays (auto).
- **`guardian-ai`:**
  - Quarantine and provider relink become `queueAgentAction` (`quarantine_order { order_id, reason }`, `relink_order_provider { order_id, provider_id }`). There are no direct `orders` updates.
  - Remove its direct `profiles`, `service_status` and `security_blacklist` writes and its `sendSms`. Each becomes the matching approval action, or `notify_admin`.
  - Drop `checkMfa: false`.

- [ ] **Step 1: Add the three files** to `AGENT_FILES`, plus a test that the `sentinel-ai` backup block checks `status` `pending`, has `.limit(10)` and contains `100`, `500` and `30 * 60 * 1000`.
- [ ] **Step 2: Run** the scan test. Expect FAIL, listing the `guardian-ai` orders updates and the `sentinel-ai` unmarked `verify-payment`.
- [ ] **Step 3: Implement** the changes above.
- [ ] **Step 4: Run** the scan test. Expect PASS.
- [ ] **Step 5: Commit** with message `fix(ai): sentinel and guardian propose instead of acting; payment backup kept with guards`.

### Task 7: `threat-hunter`, `aml-scanner`, `account-cloner`, `auto-ticket-resolver`

**Files:**
- Modify: those four `index.ts` files
- Modify test: `src/test/agent-safety-scan.test.ts` (add them to `AGENT_FILES`, plus a pattern forbidding `is_suspended:\s*true` and `terminal_locked:\s*true` outside `_shared/agent_actions.ts`)

**Changes:**
- In `threat-hunter`, `aml-scanner` and `account-cloner`:
  - Every AI action goes through the router.
  - Direct suspensions, blacklist inserts and SMS are removed. The handlers in Task 2 now do those writes.
  - Flag and alert inserts become `runAutoAction` `flag_review`/`flag_aml_review`.
- `auto-ticket-resolver`:
  - Drop `checkMfa: false`.
  - Change the prompt line that tells customers they were "automatically refunded". It now says that only when the matching order's status is `refunded`.

- [ ] **Step 1: Extend** `AGENT_FILES` and the patterns.
- [ ] **Step 2: Run** the scan test. Expect FAIL, listing the suspension, `sendSms` and `checkMfa` lines.
- [ ] **Step 3: Implement** the changes above.
- [ ] **Step 4: Run** the scan test and the full suite with `npx vitest run --no-file-parallelism`. Expect all PASS.
- [ ] **Step 5: Commit** with message `fix(ai): fraud agents flag and propose; no autonomous suspensions or SMS`.

### Task 8: SQL: rewrite the draft migration, add a separate schedules file

**Files:**
- Modify (rewrite): `supabase/migrations/20261124160000_openai_autonomous_worker_fleet.sql`
- Create: `supabase/migrations/20261124170000_ai_agent_schedules.sql`
- Create: `supabase/tests/ai_agents_checks.sql` (read-only, safe on production: it only reads catalogs and rows, inside `BEGIN … ROLLBACK`)
- Local harness: scratchpad PGlite (`run.mjs`), with stubs for `ai_agent_registry`, `cron` (a `cron.job` table and `cron.schedule`/`cron.unschedule` functions), `auth.users` and `public.is_admin()`

**The `20261124160000` rewrite:** it must be idempotent, and safe whether or not the draft version was already pasted.
- `CREATE TABLE IF NOT EXISTS` for the three tables.
- Allow `deciding` in the `ai_worker_tasks` status CHECK. Drop the old constraint and re-add it.
- `DROP POLICY IF EXISTS` for every draft policy, then admin `SELECT` policies `USING (public.is_admin())`, plus the service-role policies.
- `ai_agent_registry`:
  - `ADD COLUMN IF NOT EXISTS autonomy_mode text NOT NULL DEFAULT 'observe_only'` and `daily_budget_usd numeric(10,4) NOT NULL DEFAULT 5.00`
  - `ALTER COLUMN autonomy_mode SET DEFAULT 'observe_only'`
  - `UPDATE … SET autonomy_mode = 'observe_only'` on all rows
  - `CHECK (autonomy_mode IN ('observe_only','propose'))`
- The `ops_worker` registry row with `autonomy_mode = 'observe_only'`. `active_model` is set only when it's NULL, and no other agent's model changes.
- `cron.unschedule` for `ops-worker-ai-patrol`, `threat-hunter-patrol`, `aml-scanner-patrol` and `account-cloner-patrol` if they exist. This file schedules nothing.
- No realtime publication for `ai_system_memory`. Keep it for `ai_worker_tasks` (the approval queue) and `ai_agent_runs`.

**`20261124170000_ai_agent_schedules.sql`:** the four `cron.schedule` calls at the Global Constraints intervals, with the draft's `net.http_post` body.

**`ai_agents_checks.sql`:** `RAISE` on any of:
- an agent not in `observe_only`/`propose`
- the column default not being `observe_only`
- an `ai_*` table policy for authenticated users that doesn't use `is_admin()`
- an `ops-worker-ai-patrol` schedule other than `*/15 * * * *`

- [ ] **Step 1: Write `ai_agents_checks.sql`.** Run it locally after the draft SQL (`git show 498a75e5:supabase/migrations/20261124160000_openai_autonomous_worker_fleet.sql`), followed by the schedules file. Expect FAIL on `autonomous` / the 5-minute schedule.
- [ ] **Step 2: Rewrite** the migration and write the schedules file.
- [ ] **Step 3: Run the harness three ways:**
  - new migration, then schedules, then checks
  - draft SQL, then new migration, then schedules, then checks
  - new migration applied twice, then schedules, then checks

  Expect `OK` each time.
- [ ] **Step 4: Mutation check.** Set the default to `'autonomous'` in a scratch copy and run it. Expect the checks to FAIL.
- [ ] **Step 5: Commit** with message `fix(ai): safe agent tables and modes; schedules in a separate post-deploy file`.

### Task 9: Admin UI: approval queue and mode controls through the confirmation box

**Files:**
- Create: `src/components/admin/AgentApprovalQueue.tsx`
- Modify:
  - `src/pages/AdminSentinelAI.tsx`: replace the inline task list and the `ops-worker-ai` `execute_task`/`reject_task` calls
  - `src/pages/AdminSecurity.tsx`: the agent fleet mode select and active toggle
  - `src/lib/adminSensitive.ts`: add `"ai-task-decide"` to `SENSITIVE_FUNCTIONS`; `ConfirmKind` adds `"account" | "ops"`
  - `src/components/admin/ConfirmActionProvider.tsx`: `KIND_NOTE` adds `account: "This suspends or restricts user accounts."` and `ops: "This changes how orders are routed to providers."`
- Test: `src/test/agent-approval-queue.test.tsx`

**Interfaces:**
- Consumes: the `ai-task-decide` body `{ task_id, approve }` (Task 3), and the `ai_worker_tasks` columns (Task 8).
- Produces: `AgentApprovalQueue({ tasks, onDecided })`. Each task shows:
  - title, agent, reasoning and created time
  - "What changes": the account count for `user_ids`/`member_ids`, the provider/order/IP, or the recipient note for `broadcast_outage`
  - Approve and Reject buttons

**Behaviour:**
- **Approve** calls `confirmed.confirm({ title: task.title, description: <what changes>, kind: <account|ops|message, from task_type>, confirmLabel: "Approve" })`, then invokes `ai-task-decide`.
  - The kind mapping is copied in `src/lib/agentConfirmKind.ts` with the same table as `confirmKindFor`, because the frontend can't import Deno files.
  - A 409 shows "Already decided by another admin" and refreshes the list.
- **Reject** has no box and a `// read-only:` comment. It changes nothing in the system.
- **Mode select** offers only "Watch only" (`observe_only`) and "Propose for approval" (`propose`). Raising to `propose` goes through `confirmed.confirm`, with kind `ops` and the title "Let <agent> propose actions?". Lowering needs no box.
- **Active toggle:** turning on goes through the box; turning off doesn't.

- [ ] **Step 1: Write failing tests:**
  - Approve with confirm resolving `false` → no invoke.
  - Approve with confirm `true` → invoke called with `{ task_id, approve: true }`.
  - A 409 → the text "Already decided by another admin".
  - A `suspend_cluster` task with 3 `user_ids` → "3 accounts" shown, and confirm called with `kind: "account"`.
  - The admin safety test (`admin-sensitive-coverage.test.ts`) still passes with `ai-task-decide` listed.
- [ ] **Step 2: Run** `npx vitest run src/test/agent-approval-queue.test.tsx src/test/admin-sensitive-coverage.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** the component and the page wiring. Remove the `autonomous` option and its default from `AdminSecurity.tsx`; the fallback becomes `"observe_only"`.
- [ ] **Step 4: Run** the full suite with `npx vitest run --no-file-parallelism`, then `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit -p tsconfig.app.json`, then `npx eslint` on the changed files. Expect all PASS, tsc clean and no new eslint errors.
- [ ] **Step 5: Commit** with message `feat(admin): agent approval queue and mode controls through the confirmation box`.

### Go-live (owner-run, after merge approval)

1. Deploy the functions:
   - `ai-task-decide`
   - `ops-worker-ai`, `sentinel-ai`, `sentinel-evolve`, `guardian-ai`
   - `threat-hunter`, `aml-scanner`, `account-cloner`, `auto-ticket-resolver`
2. Paste `20261124160000_openai_autonomous_worker_fleet.sql`, then run `supabase/tests/ai_agents_checks.sql`. No error means it passed.
3. Only after step 1 is done: paste `20261124170000_ai_agent_schedules.sql`.
4. Merge to main, so Vercel deploys the pages. Check the Sentinel AI page: every agent should show "Watch only" and the queue should be empty.
