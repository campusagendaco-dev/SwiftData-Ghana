# Mystery Box Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers earn a Mystery Box for every N completed data orders during a campaign. They open it in a popup, and the server picks and delivers a random data prize from a weighted, stock-limited pool.

**Architecture:**
- A Postgres function counts `fulfilled` orders live, so there's no counter to keep in sync.
- A service-role-only Postgres function opens a box in one transaction: it locks the campaign, checks eligibility, makes the weighted pick, lowers stock, and inserts both the open record and the zero-cost prize order.
- A new `open-mystery-box` edge function wraps that call and hands delivery to the existing `verify-payment` flow. `verify-payment` refuses any `mystery_box_prize` order that has no matching open record.
- Pure decision logic lives in dependency-free TS modules, so Vitest can cover it.

**Tech Stack:** React 18, TypeScript, Vite, Vitest + Testing Library, shadcn/ui, Tailwind, framer-motion, sonner, React Query, Supabase Postgres + Deno edge functions.

**Spec:** `docs/superpowers/specs/2026-11-23-mystery-box-design.md`

## Global Constraints

- **Git**
  - Work on branch `feature/mystery-box`, created from `main`.
  - Never stage `src/components/MfaSetupWidget.tsx`, `src/pages/VerifyMfa.tsx` or `src/test/verify-mfa-page.test.tsx`; they hold unrelated uncommitted changes.
  - End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Database**
  - Migration file: `supabase/migrations/20261123120000_mystery_box_campaigns.sql`. The owner applies it in the Supabase SQL editor. **Never run `supabase db push`.**
  - New order type string, exactly: `mystery_box_prize`. Prize orders use `amount = 0`, `profit = 0`, `payment_method = 'promo'`, `status = 'paid'`.
  - Qualifying order:
    - `agent_id = user`
    - `status IN ('fulfilled','completed')`
    - `order_type = 'data'`
    - `amount > 0` and `amount >= min_order_amount`
    - `starts_at <= created_at < ends_at`
  - Campaign defaults: `orders_per_box = 2`, `max_boxes_per_user = 3`, `min_order_amount = 0`.
  - Error codes returned to clients: `not_eligible`, `out_of_stock`, `campaign_closed`, `invalid_phone`, `ordering_disabled`.
  - New SQL functions use `SECURITY DEFINER SET search_path = public`, `REVOKE ALL … FROM PUBLIC, anon`, and admin checks via the existing `public.is_admin()`. Never use `auth.role() = 'authenticated'` in a write policy.
- **verify-payment** (correction to the original design)
  - `mystery_box_prize` must **not** be added to `isProviderOrder`'s exclusion list (verify-payment line 875). That would turn off double-send protection.
  - Don't add it to the non-telecom lists in `check-order-status`, `cron-auto-retry`, `admin-retry-autorouter` or `AdminOrders`.
- **UI**
  - Copy, exactly:
    - progress line `Progress: {x}/{target} qualifying orders · {y} more to unlock`
    - locked button `Place {y} order{s} to unlock`
    - open button `Open your box 🎁`
    - done text `You've opened all your boxes. Thanks!`
  - Default bullets:
    - `Every order on your account during the campaign counts toward your box.`
    - `Open your box when you qualify.`
    - `Discover the surprise prize waiting inside!`
  - Locked button navigates to `/dashboard/buy-data/mtn`.
  - New UI uses theme tokens (`bg-card`, `text-foreground`, `border-border`, `text-muted-foreground`). The only exception is the popup's purple/gold hero area. Never cover the Adinkra page background. Errors go through `sonner` toasts, never `alert()`.
  - The popup mounts on the Dashboard only, for signed-in non-admin users.
- **Production:** nothing touches production (migration, function deploys) until Task 6, and only with the owner's go-ahead.

## Review Focus

Each line has a pinned test in the owning task.

1. **Someone inserts their own `mystery_box_prize` order** (orders are open to inserts) and calls verify-payment. It must fail with no delivery (Task 1 guard unit test; Task 6 live check).
2. **Double-tap or two tabs press "Open"** at once. Only one box opens; the second gets `not_eligible` (Task 2 SQL check via the unique key and the lock).
3. **A prize sells out mid-campaign.** It is never picked again. When all prizes are out, the open fails with `out_of_stock` and no stock goes negative (Task 2 SQL check).
4. **A user earns a new box after dismissing the popup in the same session.** The popup shows again. With no new box, it stays dismissed (Task 4 test).
5. **`sessionStorage` throws** (private mode). The popup still decides and renders without crashing (Task 4 test).

---

### Task 1: Pure decision logic (server and client)

**Files:**
- Create: `supabase/functions/_shared/mystery_box.ts` (no imports)
- Create: `src/lib/mysteryBox.ts`
- Test: `src/test/mystery-box-logic.test.ts`

**Interfaces:**
- Produces (server):
  - `toLocalGhPhone(raw: string | null | undefined): string | null` — returns a 10-digit `0XXXXXXXXX` number with prefix `02`, `03` or `05`. Accepts `233…`, `+233…` and 9-digit input; anything else returns null.
  - `prizeOrderGuard(order: { id: string; agent_id: string | null; customer_phone: string | null }, open: { order_id: string; user_id: string; recipient_phone: string } | null): string | null` — returns a failure reason, or null when the order is OK.
- Produces (client):
  - `type MysteryProgress = { qualifying_orders: number; boxes_earned: number; boxes_opened: number; boxes_available: number; orders_to_next: number }`
  - `type BoxState = "locked" | "available" | "done"`
  - `boxState(p: MysteryProgress, maxBoxes: number): BoxState` — `available` if `boxes_available > 0`; `done` if `boxes_opened >= maxBoxes`; else `locked`.
  - `progressLine(p: MysteryProgress, ordersPerBox: number): string` — x = `qualifying_orders - boxes_earned*ordersPerBox` clamped to [0, ordersPerBox]; y = `orders_to_next`.
  - `lockedButtonLabel(y: number): string`
  - `dismissKey(campaignId: string): string` = `swift_mystery_box_dismissed_${campaignId}`
  - `shouldAutoShow(campaignId: string, boxesAvailable: number, storage: Pick<Storage,"getItem"> | null): boolean` — show if there's no stored value, or if `boxesAvailable` > the stored number. Return true if storage throws.
  - `rememberDismiss(campaignId: string, boxesAvailable: number, storage: Pick<Storage,"setItem"> | null): void` — swallows errors.

- [ ] **Step 1: Create the branch** — `git checkout -b feature/mystery-box`
- [ ] **Step 2: Write the failing tests**

```ts
// prizeOrderGuard
expect(prizeOrderGuard(order, null)).toBe("No mystery box record for this order");
expect(prizeOrderGuard({ ...order, agent_id: "other" }, open)).toBe("Mystery box owner mismatch");
expect(prizeOrderGuard({ ...order, customer_phone: "0249999999" }, open)).toBe("Mystery box recipient mismatch");
expect(prizeOrderGuard(order, open)).toBeNull(); // order {id:"o1",agent_id:"u1",customer_phone:"0241234567"}, open {order_id:"o1",user_id:"u1",recipient_phone:"0241234567"}

// toLocalGhPhone
expect(toLocalGhPhone("+233 24 123 4567")).toBe("0241234567");
expect(toLocalGhPhone("241234567")).toBe("0241234567");
expect(toLocalGhPhone("0741234567")).toBeNull();
expect(toLocalGhPhone("abc")).toBeNull();

// progress copy (ordersPerBox 2)
const p0 = { qualifying_orders: 0, boxes_earned: 0, boxes_opened: 0, boxes_available: 0, orders_to_next: 2 };
expect(progressLine(p0, 2)).toBe("Progress: 0/2 qualifying orders · 2 more to unlock");
expect(lockedButtonLabel(2)).toBe("Place 2 orders to unlock");
expect(lockedButtonLabel(1)).toBe("Place 1 order to unlock");
expect(progressLine({ ...p0, qualifying_orders: 3, boxes_earned: 1, orders_to_next: 1 }, 2)).toBe("Progress: 1/2 qualifying orders · 1 more to unlock");
expect(boxState({ ...p0, boxes_earned: 1, boxes_available: 1 }, 3)).toBe("available");
expect(boxState({ ...p0, boxes_earned: 3, boxes_opened: 3 }, 3)).toBe("done");

// dismissal (Review Focus 4 & 5)
const mem = new Map<string, string>(); const s = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
expect(shouldAutoShow("c1", 0, s)).toBe(true);
rememberDismiss("c1", 0, s);
expect(shouldAutoShow("c1", 0, s)).toBe(false);
expect(shouldAutoShow("c1", 1, s)).toBe(true);
const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
expect(shouldAutoShow("c1", 0, throwing)).toBe(true);
expect(() => rememberDismiss("c1", 0, throwing)).not.toThrow();
```

- [ ] **Step 3: Run and confirm they fail** — `npx vitest run src/test/mystery-box-logic.test.ts`. Expected: FAIL (modules not found).
- [ ] **Step 4: Implement both modules** to the signatures above.
- [ ] **Step 5: Run and confirm they pass** — same command. Expected: PASS.
- [ ] **Step 6: Commit** — `feat(mystery-box): pure progress, dismissal and prize-guard logic`, including the spec and this plan.

---

### Task 2: Database migration

**Files:**
- Create: `supabase/migrations/20261123120000_mystery_box_campaigns.sql`
- Create: `supabase/tests/mystery_box_checks.sql` (wrapped in `BEGIN; … ROLLBACK;`, run by hand in the SQL editor)

**Interfaces:**
- Produces tables `mystery_box_campaigns`, `mystery_box_prizes` and `mystery_box_opens`, with the columns listed in the spec.
  - `stock_total` and `stock_remaining`: NULL means unlimited.
  - Add `CHECK (stock_remaining IS NULL OR stock_remaining >= 0)`, `CHECK (weight > 0)`, `CHECK (orders_per_box >= 1)` and `CHECK (max_boxes_per_user >= 1)`.
  - `bullets jsonb NOT NULL DEFAULT` the three default bullets.
- Produces `public.mystery_box_progress(p_campaign_id uuid) RETURNS TABLE(qualifying_orders int, boxes_earned int, boxes_opened int, boxes_available int, orders_to_next int)`
  - Granted to `authenticated`. Uses `auth.uid()`.
  - `orders_to_next` = 0 when the user has hit `max_boxes_per_user` boxes earned; otherwise `orders_per_box - (qualifying_orders % orders_per_box)`.
- Produces `public.mystery_box_open(p_campaign_id uuid, p_user_id uuid, p_phone text) RETURNS TABLE(open_id uuid, order_id uuid, box_number int, prize_label text)`
  - Granted to `service_role` only.
  - Raises `RAISE EXCEPTION '<code>'` with the error codes from Global Constraints.
- RLS:
  - campaigns/prizes: `SELECT` for `authenticated` where `is_active`; `ALL` for `is_admin()`.
  - opens: `SELECT` where `user_id = auth.uid() OR is_admin()`. No insert/update/delete policy for clients.
- Index: `CREATE INDEX ON mystery_box_opens (order_id)`.

**Weighted pick** (the signature doesn't decide this):

```sql
-- (corrected after review: random() in the WHERE clause is re-drawn per row and skews odds with 3+ prizes)
SELECT sum(weight) INTO v_total FROM mystery_box_prizes WHERE <eligible>;
v_r := floor(random() * v_total);            -- one draw per pick
SELECT * INTO v_prize FROM (
  SELECT p.*, sum(weight) OVER (ORDER BY id) AS cum FROM mystery_box_prizes p WHERE <eligible>
) t WHERE cum > v_r ORDER BY cum LIMIT 1;
-- then: UPDATE … SET stock_remaining = stock_remaining - 1 WHERE id = v_prize.id AND stock_remaining > 0
-- (skip when NULL); if 0 rows updated, RAISE 'out_of_stock'.
```

- **Order of work in `mystery_box_open`:**
  1. `SELECT … FOR UPDATE` on the campaign.
  2. Check active and inside the window, else `campaign_closed`.
  3. Count qualifying orders (same predicate as progress) and boxes opened.
  4. `box_number = opened + 1`; check that `box_number <= LEAST(floor(count/orders_per_box), max_boxes_per_user)`, else `not_eligible`.
  5. Pick a prize and lower its stock.
  6. `gen_random_uuid()` for the order id.
  7. `INSERT INTO orders (id, agent_id, order_type, payment_method, network, package_size, customer_phone, amount, profit, status, metadata)`. Set `metadata` to `{mystery_box_open_id, campaign_id}` plus `category: 'mashup'` when `is_mashup`.
  8. `INSERT INTO mystery_box_opens`.
  9. Return.
- `p_phone` is already normalised by the edge function. Reject anything that isn't `^0[235]\d{8}$` with `invalid_phone`.

- [ ] **Step 1: Write the checks file first.** In one rolled-back transaction it:
  - creates a campaign (orders_per_box 2, max 2) and two prizes (weights 1 and 9; prize A stock 1)
  - inserts test orders for an existing test user's `agent_id`
  - `RAISE NOTICE`s PASS/FAIL for each assertion below:

  - (a) progress = 0 with two `paid` orders, and = 1 box earned after both are set to `fulfilled`
  - (b) an `amount = 0` order and a `free_data_claim` order don't count
  - (c) the first `mystery_box_open` succeeds and creates an `orders` row with `order_type='mystery_box_prize'`, `status='paid'`
  - (d) a second open with no new orders raises `not_eligible`
  - (e) after prize A's stock hits 0, 200 picks in a sub-loop (re-granting eligibility by inserting fulfilled orders and deleting opens) never return prize A
  - (f) with both prizes out of stock, the open raises `out_of_stock` and `stock_remaining` stays at 0
  - (g) with unlimited stock, 1:9 weights give roughly 10% / 90% (accept 4–18% for prize A)
  - (h) `mystery_box_open` called as role `authenticated` (`SET LOCAL ROLE authenticated`) raises permission denied
- [ ] **Step 2: Write the migration** to the interfaces above.
- [ ] **Step 3: Static check.** Make sure `supabase/migrations` has no other file using the timestamp `20261123120000`, and that the migration only uses `CREATE … IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION` and `DROP POLICY IF EXISTS` before `CREATE POLICY`, so re-running it is safe.
- [ ] **Step 4: Commit** — `feat(mystery-box): campaign, prize and open tables with progress/open RPCs`. The SQL runs live in Task 6.

---

### Task 3: Edge function + verify-payment changes

**Files:**
- Create: `supabase/functions/open-mystery-box/index.ts`
- Modify: `supabase/functions/verify-payment/index.ts` (near lines 1207, 1259, 1872)
- Modify: `src/pages/AdminOrders.tsx:2192` (label)

**Interfaces:**
- Consumes: `toLocalGhPhone` and `prizeOrderGuard` from `../_shared/mystery_box.ts`; the `mystery_box_open` RPC.
- Produces: `POST /functions/v1/open-mystery-box`
  - Body `{ campaign_id: string, phone: string }`, with the user's JWT in `Authorization`.
  - Always HTTP 200 with JSON:
    - `{ success: true, prize_label, order_id, box_number, status }`, or
    - `{ success: false, error: <code>, message: <friendly text> }`

- [ ] **Step 1: Edge function.** Model it on `supabase/functions/claim-free-data/index.ts`:
  - Handle CORS with `corsHeaders`.
  - Check `disable_ordering` from `v_system_settings_with_secrets` → `ordering_disabled`.
  - `supabase.auth.getUser(token)` → 401-style `{success:false,error:"unauthorized"}` when it fails.
  - `toLocalGhPhone` → `invalid_phone`.
  - `rpc("mystery_box_open", …)`; map the Postgres exception message to the code.
  - Then `fetch(verify-payment)` with `{ reference: order_id }`, exactly as at claim-free-data lines 179–211.
  - The open is already recorded at this point, so a delivery failure still returns `success: true` with `status: "processing"` and the order id. The admin retries through the existing tools.
- [ ] **Step 2: verify-payment guard.** Directly after the `free_data_claim` block (ends line 1257), add an `if (orderType.toLowerCase() === "mystery_box_prize")` block. It loads `mystery_box_opens` by `order_id = targetReference` (`maybeSingle`) and calls `prizeOrderGuard(existingOrder, openRow)`. On a reason, it uses the same `failOrder` pattern (sets `fulfillment_failed` + `failure_reason`) and returns.
- [ ] **Step 3: Payment bypass and order-type mapping.**
  - Line 1259: add `|| orderType.toLowerCase() === "mystery_box_prize"`.
  - Line 1872: map `mystery_box_prize` to `"data"` as well.
  - Leave line 875 unchanged (Global Constraints).
- [ ] **Step 4: Label.** AdminOrders line ~2192: add `order.order_type === "mystery_box_prize" ? "Mystery Box" :`.
- [ ] **Step 5: Verify.**
  - Run `npx vitest run src/test/mystery-box-logic.test.ts` (guard still passes) and `npx tsc --noEmit -p tsconfig.app.json`. Expected: no new errors.
  - Run `grep -n "mystery_box_prize" supabase/functions/verify-payment/index.ts`. Expected: exactly 3 hits (guard, line ~1259, line ~1872), and line 875 has none.
- [ ] **Step 6: Commit** — `feat(mystery-box): open-mystery-box function and verify-payment prize handling`.

---

### Task 4: Customer popup, hook and dashboard card

**Files:**
- Create: `src/hooks/useMysteryBox.ts`
- Create: `src/components/MysteryBoxModal.tsx`
- Create: `src/components/MysteryBoxCard.tsx`
- Modify: `src/pages/Dashboard.tsx` (imports ~line 39–48; mount right after `<CompleteProfileBanner />` at ~line 305)
- Test: `src/test/mystery-box-modal.test.tsx`

**Interfaces:**
- Consumes: everything client-side from Task 1; the `mystery_box_progress` RPC; the `open-mystery-box` function from Task 3.
- Produces:
  - `useMysteryBox(): { campaign: MysteryCampaign | null; progress: MysteryProgress | null; state: BoxState | null; isLoading: boolean; open(phone: string): Promise<OpenResult> }`
    - `MysteryCampaign = { id; title; image_url: string | null; orders_per_box; max_boxes_per_user; bullets: string[]; ends_at }`
    - `OpenResult = { success: true; prize_label: string; order_id: string } | { success: false; error: string; message: string }`
    - Query key `["mystery-box", userId]`. Gets the newest campaign where `is_active` and `now()` falls between `starts_at` and `ends_at` (`.order("starts_at",{ascending:false}).limit(1)`), then the progress RPC. `open` invalidates the key.
  - `MysteryBoxModal({ open, onOpenChange }: { open: boolean; onOpenChange(v: boolean): void })`: a shadcn `Dialog`, `sm:max-w-[400px]`, styled like the reference screenshot.
    - **Hero area:**
      - `campaign.image_url`, or a built-in purple-to-gold gift box made with CSS/SVG
      - LIVE pill (green dot)
      - close button
    - **Content by state:**
      - `available`: phone input prefilled from `useAuth().profile.phone` → "Open your box 🎁" → framer-motion shake (~0.8s) → prize card "You won {prize_label}! 🎉" with a burst animation. Show `message` in a sonner toast on failure.
      - `locked`: the button navigates to `/dashboard/buy-data/mtn` and closes the popup.
      - `done`: disabled button with the done text.
    - Under the bullets: "Box {opened+1} of {max}" when `max_boxes_per_user > 1` and the state isn't `done`.
  - `MysteryBoxCard()`: renders nothing without a campaign.
    - Otherwise a compact `bg-card border-border` row: gift icon, title, `progressLine`, and a button "View" or "Open now" (when `available`) that opens the modal.
    - It owns the modal state. It auto-opens once on mount when `shouldAutoShow(...)` returns true. Closing calls `rememberDismiss`.
    - In the `done` state it shows the done text instead of `progressLine`.
    - It hides itself for admins (`useAuth().isAdmin`).

- [ ] **Step 1: Write the failing component tests.** Mock `@/hooks/useMysteryBox` with `vi.mock`, `@/hooks/useAuth`, and `react-router-dom`'s `useNavigate`. Cases:
  - locked progress renders `"Progress: 0/2 qualifying orders · 2 more to unlock"` and button `"Place 2 orders to unlock"`; clicking calls navigate with `"/dashboard/buy-data/mtn"`
  - available: clicking `"Open your box 🎁"` calls `open("0241234567")`; after it resolves, `"You won 1GB MTN Data! 🎉"` shows (use fake timers to pass the shake)
  - a failed open shows the message through the mocked `sonner` `toast.error`
  - done renders `"You've opened all your boxes. Thanks!"`
  - card: with `sessionStorage` empty, the dialog auto-opens. After closing, re-render with the same `boxes_available` → no dialog. Re-render with `boxes_available` + 1 → dialog opens (Review Focus 4)
  - card: `vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error() })` → renders without crashing (Review Focus 5)
  - no campaign → card renders nothing
- [ ] **Step 2: Run and confirm they fail** — `npx vitest run src/test/mystery-box-modal.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the hook, modal and card, and mount `<MysteryBoxCard />` in Dashboard.
- [ ] **Step 4: Run and confirm they pass** — same command, then `npm test`. Expected: all new tests pass. Any other failure must also happen on `main`; if one looks unrelated, report it rather than fix it.
- [ ] **Step 5: Commit** — `feat(mystery-box): dashboard card, popup and reveal flow`.

---

### Task 5: Admin page

**Files:**
- Create: `src/pages/AdminMysteryBox.tsx`
- Modify: `src/App.tsx` (lazy import next to line 102; `<Route path="mystery-box" element={<AdminMysteryBox />} />` next to line 583)
- Modify: `src/components/AdminLayout.tsx` (in the "Packages & Pricing" group after "Promo Codes": `{ label: "Mystery Box", icon: Gift, path: "/admin/mystery-box", permKey: "packages" }`, importing `Gift` from lucide-react if it isn't already imported)
- Test: `src/test/admin-mystery-box.test.tsx`

**Interfaces:**
- Consumes: tables from Task 2 (admin RLS), `global_package_settings` (network, package_size, is_enabled) and the `promo-banners` storage bucket (upload pattern at `src/pages/AdminBanners.tsx:106-113`).
- Produces: a page with three sections.
  1. **Campaign list + form:**
     - title, description, start/end datetime, orders per box, max boxes per user, minimum order amount (GH₵), three bullet inputs, image upload, active toggle
     - validation: end after start, integers ≥ 1
  2. **Prize pool for the selected campaign:**
     - add/edit/remove: label, network select, package select filtered by network from enabled `global_package_settings`, Mashup checkbox, weight, stock (blank = unlimited)
     - when a stock is set, it also sets `stock_remaining`
     - shows each prize's odds as `weight / sum(active weights)` to 1 decimal place
  3. **Opens table:** newest first, 50 rows. Shows the open's `created_at`, user (the profile's `full_name`), `recipient_phone`, `prize_label`, and order `status` from a second query on `orders` by the ids.
- Export a pure `oddsPercent(prizes: { weight: number; is_active: boolean }[]): number[]` from the page module, for the test.
- Styling: theme tokens only, matching the existing admin page shells (copy the header/card layout from `AdminPromotions.tsx`).

- [ ] **Step 1: Write the failing test.**
  - `oddsPercent([{weight:1,is_active:true},{weight:9,is_active:true},{weight:5,is_active:false}])` → `[10, 90, 0]`.
  - `oddsPercent([])` → `[]`.
- [ ] **Step 2: Run and confirm it fails** — `npx vitest run src/test/admin-mystery-box.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the page, route and nav entry.
- [ ] **Step 4: Verify.**
  - The test passes.
  - `npx tsc --noEmit -p tsconfig.app.json` shows no new errors.
  - `npm run build` succeeds.
  - `npm run dev`, then visit `/admin/mystery-box` as an admin: the page loads. Before the migration is applied, an empty or error state shows as a friendly message, not a crash.
- [ ] **Step 5: Commit** — `feat(mystery-box): admin campaign, prize pool and opens page`.

---

### Task 6: Go live and check end to end (needs the owner's go-ahead at each production step)

- [ ] **Step 1: Apply the migration.** The owner pastes `supabase/migrations/20261123120000_mystery_box_campaigns.sql` into the SQL editor.
- [ ] **Step 2: Run the checks.** The owner runs `supabase/tests/mystery_box_checks.sql`. Expected: every NOTICE is `PASS`, and the transaction rolls back.
- [ ] **Step 3: Deploy the functions** after confirming with the owner:
  - `supabase functions deploy open-mystery-box`
  - `supabase functions deploy verify-payment`
- [ ] **Step 4: Security check (Review Focus 1).** Insert an `orders` row with `order_type='mystery_box_prize'`, `status='paid'`, `amount=0` and no open record, then POST verify-payment with its id. Expected: status `fulfillment_failed` and `failure_reason = 'No mystery box record for this order'`.
- [ ] **Step 5: End to end.**
  - In the admin page, create a campaign with orders_per_box 1, max 1, and one cheap in-stock prize.
  - As a test account, place one real data order and wait for `fulfilled`.
  - The Dashboard popup shows `Open your box 🎁`. Open it: the prize is revealed, a `mystery_box_prize` order appears in AdminOrders labelled "Mystery Box" and reaches `fulfilled`, and the opens table lists it.
  - Then turn the test campaign off.
- [ ] **Step 6: Finish.** Use superpowers:finishing-a-development-branch.
