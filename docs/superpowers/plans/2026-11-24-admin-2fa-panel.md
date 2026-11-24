# Admin 2FA Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the admin Security page, Administrators tab: show each admin's real 2FA status and last sign-in, remove admin rights through the confirmation box, and show a read-only "Database 2FA check" card.

**Architecture:** A shared helper fixes `get_admins` in both backend functions that carry a copy of it (`system-payout-v1`, which the page uses, and `admin-user-actions`). It reads each admin's auth user record, which gives factors and last sign-in. A new read-only SQL function, `admin_security_2fa_report()`, backs the card. The page changes are small components plus wiring in `AdminSecurity.tsx`.

**Tech Stack:** React + Vite + Vitest (jsdom, Testing Library); Supabase edge functions (Deno, with shared modules tested in Vitest); Postgres SQL checks run locally in PGlite.

**Spec:** `docs/superpowers/specs/2026-11-24-admin-2fa-panel-design.md`

## Global Constraints

- **The badge never says "NO 2FA" when the lookup failed.** It shows "unknown" instead.
- **Migrations are pasted into the Supabase SQL editor**, one file at a time. Never run `supabase db push`.
- **Nothing on the tab changes data except Revoke and Grant.** Revoke goes through the confirmation box.
- **You still can't revoke yourself**, and revokes are still written to `admin_action_log`. Both are already enforced server-side, so keep them.
- **New admin UI follows the existing zinc card style** of `AdminSecurity.tsx`.
- **Production function deploys and SQL are run by the owner.** Claude prepares them.

## Review Focus

1. **The auth lookup fails for one admin.** That row shows "unknown". The other rows and the list still load. (Task 2 test `marks only the failed admin unknown`.)
2. **An admin has only a half-finished (unverified) 2FA setup.** The row shows "none", not "verified". (Task 2 test `unverified factors count as none`.)
3. **The report function isn't applied yet.** The card says "Database check not installed yet" and the page keeps working. (Task 4 test `says not installed when the function is missing`.)
4. **An old frontend is still cached while the new function is live.** The response still includes `is_mfa_verified`. (Task 2 test `keeps is_mfa_verified for older pages`.)
5. **The admin presses Cancel in the confirmation box.** No revoke call is made. This is guarded by the coverage test (Task 5) and the existing `useConfirmedCall` behaviour in `src/test/admin-confirm.test.tsx`.

---

### Task 1: Commit the database 2FA fix already written

**Files:**
- Existing, untracked: `supabase/migrations/20261124120000_restore_admin_mfa_requirement.sql`, `supabase/tests/admin_mfa_checks.sql`
- Add: this plan and the spec

- [ ] **Step 1: Re-run the checks in PGlite**

  Run:
  ```
  PGLITE="file:///C:/Users/hp/AppData/Local/Temp/claude/35aa38d55cd86337/051e092e-9535-4768-96f1-ea6e5d2283bc/scratchpad/pglite/node_modules/@electric-sql/pglite/dist/index.js" node C:/Users/hp/AppData/Local/Temp/claude/35aa38d55cd86337/e86c6ee2-1fcc-422b-904a-75aaa7b3067a/scratchpad/mfa/run.mjs supabase/migrations/20261124120000_restore_admin_mfa_requirement.sql supabase/tests/admin_mfa_checks.sql
  ```
  Expected: `OK: [{"result":"admin 2FA checks passed"}]`. With `-` in place of the migration, it must print `CHECKS FAILED: FAIL (a)`.
- [ ] **Step 2: Commit**

  Commit the two SQL files plus the spec and plan as `fix(security): admin checks in the database require 2FA again`.

### Task 2: Shared admin list with real 2FA status

**Files:**
- Create: `supabase/functions/_shared/admin_list.ts`
- Modify: `supabase/functions/system-payout-v1/index.ts`, the `case "get_admins"` block (about lines 2649–2699)
- Modify: `supabase/functions/admin-user-actions/index.ts`, the `case "get_admins"` block (about lines 1705–1754)
- Test: `src/test/admin-list.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AdminMfaStatus = "verified" | "none" | "unknown";
  export type AdminRow = {
    user_id: string; role: string; allowed_ips: string[] | null;
    email: string; full_name: string; last_seen_at: string | null;
    last_sign_in_at: string | null; mfa_status: AdminMfaStatus; is_mfa_verified: boolean;
  };
  export function mfaStatusFromUser(user: { factors?: { status: string }[] } | null, failed: boolean): AdminMfaStatus;
  export async function listAdminsWith2fa(supabaseAdmin: any): Promise<AdminRow[]>;
  ```
- The helper has no Deno imports, so Vitest can import it.

- [ ] **Step 1: Write failing tests in `src/test/admin-list.test.ts`**

  Import from `../../supabase/functions/_shared/admin_list`. Use a fake `supabaseAdmin`:
  - `from("user_roles")` returns admins A, B and C.
  - `from("profiles")` returns their names.
  - `auth.admin.getUserById(id)` gives A a verified factor and `last_sign_in_at`, gives B only `{status:"unverified"}`, and gives C `{ error: new Error("x") }`.

  Tests:
  - `mfaStatusFromUser`:
    - `({factors:[{status:"verified"}]}, false)` → `"verified"`
    - `({}, false)` → `"none"`
    - `(null, true)` → `"unknown"`
  - `unverified factors count as none`: B → `mfa_status: "none"`.
  - `marks only the failed admin unknown`: C → `"unknown"` with `last_sign_in_at: null`. A is still `"verified"` and has its `last_sign_in_at`. All 3 rows are returned.
  - `keeps is_mfa_verified for older pages`: A `true`, B `false`, C `false`.
- [ ] **Step 2: Run `npx vitest run src/test/admin-list.test.ts`**

  Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement `listAdminsWith2fa` and `mfaStatusFromUser` in `_shared/admin_list.ts`**

  How it works:
  - Read admins from `user_roles` (`user_id, role, allowed_ips`, `role = 'admin'`).
  - Read profiles (`user_id, email, full_name, last_seen_at`) with `.in("user_id", ids)`.
  - Call `supabaseAdmin.auth.admin.getUserById(id)` for each admin with `Promise.all`.
  - A thrown error or a returned `error` → `failed = true`.
  - Use the auth user's `email` when the profile has none.
  - Throw only if the `user_roles` read fails.
- [ ] **Step 4: Swap both `get_admins` blocks to use the helper**

  Each block becomes `const admins = await listAdminsWith2fa(supabaseAdmin);` returning `{ admins }` with the same response shape and headers as now. Stop using the `user_mfa_status` view there.
- [ ] **Step 5: Run `npx vitest run src/test/admin-list.test.ts`**

  Expected: PASS (4 tests).
- [ ] **Step 6: Commit**

  `fix(admin): real 2FA status and last sign-in in the admin list`

### Task 3: Read-only database 2FA report

**Files:**
- Create: `supabase/migrations/20261124130000_admin_security_2fa_report.sql`
- Test: `supabase/tests/admin_security_report_checks.sql`, LOCAL ONLY (it creates a stub table and policies)

**Interfaces:**
- Produces: `public.admin_security_2fa_report() RETURNS jsonb`, shaped as:
  ```json
  { "is_admin_requires_2fa": bool, "has_role_requires_2fa": bool,
    "policies": [{ "table": "schema.table", "policy": "name", "command": "SELECT" }] }
  ```
- Function settings: `SECURITY DEFINER`, `STABLE`, `SET search_path = public`.
- Grants: `REVOKE ALL ... FROM PUBLIC, anon`, then `GRANT EXECUTE ... TO authenticated`.

- [ ] **Step 1: Write the checks**

  The checks run inside `BEGIN ... ROLLBACK`, and any failure raises `FAIL (x)`. Setup: create `public.stub_t` with RLS and two policies. One uses `EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')`; the other uses `public.is_admin()`. Insert one admin into `user_roles`.
  - (a) admin with aal1 claims → raises `not_authorized`.
  - (b) non-admin with aal2 → raises `not_authorized`.
  - (c) admin with aal2 → `policies` contains `public.stub_t` with the inline policy's name and not the `is_admin()` one.
  - (d) with `20261124120000` applied first, both `*_requires_2fa` are `true`. Without it, both are `false`.
- [ ] **Step 2: Run the checks in PGlite**

  Use the Task 1 harness: migration `20261124120000` followed by `20261124130000`, concatenated into one temp file.

  Expected before the new migration exists: FAIL, because the function doesn't exist.
- [ ] **Step 3: Write the migration**

  The function:
  - Raises `not_authorized` (ERRCODE `42501`) unless `public.is_admin()` AND `coalesce(auth.jwt()->>'aal','') = 'aal2'`.
  - Reports `*_requires_2fa` as `pg_get_functiondef(...) ILIKE '%aal%'`, for `public.is_admin()` and for `public.has_role(uuid, public.app_role)`.
  - Lists policies from `pg_policies` where the combined `qual || with_check` matches `%user_roles%` AND `%admin%`, and does NOT match `%is_admin()%` or `%has_role(%`. Order them by table, then policy.
- [ ] **Step 4: Run the checks, with and without the restore migration first**

  Expected: both pass, with each branch of (d) seen.
- [ ] **Step 5: Commit**

  `feat(security): read-only database 2FA report for admins`

### Task 4: "Database 2FA check" card

**Files:**
- Create: `src/components/admin/Database2faCheckCard.tsx`
- Test: `src/test/database-2fa-check-card.test.tsx`

**Interfaces:**
- Consumes: the RPC `admin_security_2fa_report` (Task 3).
- Produces: `export default function Database2faCheckCard({ adminsWithout2fa }: { adminsWithout2fa: number | null })`.
  - `null` means the list hasn't loaded or has unknown rows. Show "—".
- The call carries a `// read-only:` comment.

- [ ] **Step 1: Write failing tests that mock `@/integrations/supabase/client` `rpc`**

  - `shows a pass when both checks require 2FA and no policies`:
    - Shows "Admin check requires 2FA: Yes" and "Role check requires 2FA: Yes".
    - Shows "Policies with their own admin check: 0".
    - Shows "Admins without 2FA: 0".
  - `lists policies that check admin rights themselves`: a policy `public.stub_t / Admins read (SELECT)` is shown.
  - `shows No in red when a check does not require 2FA`: `is_admin_requires_2fa: false` → "No".
  - `says not installed when the function is missing`: an rpc error with code `PGRST202` → the text "Database check not installed yet".
  - `shows the error for other failures`: `{ message: "not_authorized" }` → the text contains "not_authorized".
- [ ] **Step 2: Run `npx vitest run src/test/database-2fa-check-card.test.tsx`**

  Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement the card**

  Load on mount, with a Refresh button. Use the zinc card style from `renderAdmins` in `AdminSecurity.tsx`. Use green/red text for Yes/No.
- [ ] **Step 4: Run the test**

  Expected: PASS (5 tests).
- [ ] **Step 5: Commit**

  `feat(admin): Database 2FA check card`

### Task 5: Wire the Administrators tab

**Files:**
- Create: `src/components/admin/AdminTwoFactorBadge.tsx`. Export it as `default function AdminTwoFactorBadge({ status }: { status: "verified" | "none" | "unknown" })`.
- Modify: `src/pages/AdminSecurity.tsx`:
  - the `AdminEntry` type near line 50
  - `handleRevokeAdmin` near line 667
  - `renderAdmins` near lines 1431–1510
- Modify: `src/lib/adminSensitive.ts`:
  - add `"access"` to `ConfirmKind`
  - add `export const SENSITIVE_ACCESS_ACTIONS = new Set(["revoke_admin_role"])`
- Modify: `src/components/admin/ConfirmActionProvider.tsx`. In `KIND_NOTE`, add `access: "This changes who can use the admin pages."`
- Modify: `src/test/admin-sensitive-coverage.test.ts`
- Test: `src/test/admin-two-factor-badge.test.tsx`

**Interfaces:**
- Consumes: `AdminRow` fields from Task 2 (`mfa_status`, `last_sign_in_at`); `Database2faCheckCard` from Task 4; `useConfirmedCall().confirm` from `ConfirmActionProvider`.

- [ ] **Step 1: Write the failing badge tests**

  - `verified` → text "2FA OK"
  - `none` → "NO 2FA"
  - `unknown` → "2FA UNKNOWN", with no "NO 2FA" text
- [ ] **Step 2: Extend the coverage test**

  In `coveredCallAt`, also match the page-local wrapper `\binvoke\(\{\s*action:\s*["'`]([a-z_]+)["'`]`. Any action in `SENSITIVE_ACCESS_ACTIONS` returns `access:<action>`. Add `SENSITIVE_ACCESS_ACTIONS` to the `system-payout-v1` and `admin-user-actions` entries of `ACTION_SETS` (merged sets).
- [ ] **Step 3: Run the two failing tests**

  Run: `npx vitest run src/test/admin-two-factor-badge.test.tsx src/test/admin-sensitive-coverage.test.ts`

  Expected: the badge test FAILs because the module isn't found. The coverage test FAILs with `AdminSecurity.tsx:<line> access:revoke_admin_role`.
- [ ] **Step 4: Make both pass**

  - Implement the badge, moving the two existing badge styles out of `renderAdmins`. "unknown" uses zinc/grey and no pulse.
  - `handleRevokeAdmin`: replace `confirm(...)` with `if (!(await confirmed.confirm({ title: \`Remove admin access for ${name}?\`, description: "They will lose access to every admin page straight away.", kind: "access", confirmLabel: "Remove admin" }))) return;`.
  - Get `confirmed` from `useConfirmedCall()`.
  - Table changes:
    - The MFA column uses `<AdminTwoFactorBadge status={adm.mfa_status ?? (adm.is_mfa_verified ? "verified" : "none")} />`. The fallback is for a backend that hasn't been redeployed yet.
    - Add a "Last Sign-in" column using the page's `fmt()`.
  - Render `<Database2faCheckCard adminsWithout2fa={...} />` above the "System Administrators" card. The count is the number of `none` rows, or `null` while loading or if any row is `unknown`.
- [ ] **Step 5: Run the full suite one file at a time**

  Run: `npx vitest run --no-file-parallelism`

  Expected: all files pass. The suite was 274 tests before; this plan adds 12.
- [ ] **Step 6: Lint the touched files**

  Run: `npx eslint src/pages/AdminSecurity.tsx src/components/admin/AdminTwoFactorBadge.tsx src/components/admin/Database2faCheckCard.tsx src/lib/adminSensitive.ts`

  Expected: no errors.
- [ ] **Step 7: Commit**

  `feat(admin): real 2FA badges, last sign-in and confirmed revoke on the Administrators tab`

### Task 6: Go-live (owner runs each step; Claude prepares)

- [ ] **Step 1: Apply the restore migration**

  The owner pastes `20261124120000_restore_admin_mfa_requirement.sql` into the SQL editor, then runs `supabase/tests/admin_mfa_checks.sql`. Expected: `admin 2FA checks passed`.
- [ ] **Step 2: Apply the report migration**

  The owner pastes `20261124130000_admin_security_2fa_report.sql`.
- [ ] **Step 3: Deploy the two functions**

  The owner deploys `system-payout-v1` and `admin-user-actions`.
- [ ] **Step 4: Merge and check the live tab**

  Merge `feature/admin-2fa` to main. Vercel deploys it. On the Administrators tab, the badges, last sign-in and the card should all show real values.
