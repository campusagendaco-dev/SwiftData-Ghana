# Mystery Box campaign — design + build plan

## Context
The user wants a "Mystery Box" promo like the reference screenshot: a popup with a box illustration, "Progress: 0/2 qualifying orders · 2 more to unlock", three bullet points and a call-to-action button. **The goal is more repeat orders from existing customers.**

User decisions:
- The server picks the prize from a **weighted pool** with stock limits.
- Progress is **counted live** from completed orders (approach A).
- Boxes **repeat with a cap**: every N completed orders earns another box, up to a per-user limit.

Nothing like this exists yet. The closest existing piece is `DataPromoPopupModal` (a shadcn Dialog with dismissal remembered per session).

## Approaches (picked: A)
- **A. Live count + opening on the server (picked).** A database function counts the user's `fulfilled` orders inside the campaign window. Opening runs in one database transaction, so a user can't open the same box twice and the last unit of stock can't go to two people. Nothing has to be kept in sync.
- B. A running counter updated by a trigger: every order write does extra work, and refunds and campaign edits need corrections. Rejected.
- C. Browser-only, like the current promo popup: anyone could fake their progress or pick their own prize. Rejected.

## Goals / non-goals / anti-goals
- Goals: a progress popup and dashboard card; a box-opening animation with the prize revealed; the prize data delivered automatically; an admin page to run campaigns and see who opened which box.
- Non-goals (v1): wallet cash or loyalty-point prizes, guest users, "no prize" outcomes.
- Anti-goals: progress that can be faked (orders can be inserted by anyone; only `fulfilled` counts), prizes that can be claimed without a server-written open record, sending out more prizes than the stock allows, covering the Adinkra background, or ugly default alerts.

## Data model — new migration `supabase/migrations/20261123120000_mystery_box_campaigns.sql`
Apply it **in the Supabase SQL editor**, never with `supabase db push`.

**`mystery_box_campaigns`**
- `id`, `title`, `description`, `image_url` (optional; falls back to a built-in illustration)
- `starts_at`, `ends_at`, `is_active`
- `orders_per_box` int (default 2), `max_boxes_per_user` int (default 3), `min_order_amount` numeric (default 0)
- `bullets` jsonb (the three lines of copy)
- `created_at`

**`mystery_box_prizes`**
- `id`, `campaign_id`, `label` (e.g. "1GB MTN Data"), `network`, `package_size`, `is_mashup` bool
- `weight` int > 0, `stock_total` int (nullable = unlimited), `stock_remaining` int, `is_active`

**`mystery_box_opens`**
- `id`, `campaign_id`, `user_id`, `box_number` int, `prize_id`, `prize_label` (snapshot), `recipient_phone`, `order_id` uuid, `created_at`
- `UNIQUE (campaign_id, user_id, box_number)` — the database itself blocks a second open of the same box.

**Access rules (RLS)**
- Campaigns and prizes: signed-in users can only *read* active rows. Admins (via `user_roles.role='admin'`) can write.
- **Do not copy the `auth.role()='authenticated'` mistake** from `data_promo_popups`.
- Opens: users can read their own rows; nobody can insert from the client.

**Functions** (`SECURITY DEFINER SET search_path=public`; `REVOKE FROM PUBLIC, anon`, following the `spin_the_wheel` pattern)

1. `mystery_box_progress(p_campaign_id) → (qualifying_orders, boxes_earned, boxes_opened, boxes_available, orders_to_next)`
   - Granted to `authenticated`. Uses `auth.uid()`.
   - Counts `orders` where:
     - `agent_id = auth.uid()`
     - `status IN ('fulfilled','completed')`
     - `order_type = 'data'`
     - `amount >= min_order_amount` and `amount > 0`
     - `created_at` is between `starts_at` and `ends_at`
   - The existing `idx_orders_agent_id_status` and `idx_orders_agent_id_created_at` indexes cover this query.
   - `boxes_earned = LEAST(floor(count / orders_per_box), max_boxes_per_user)`.
2. `mystery_box_open(p_campaign_id, p_user_id, p_phone) → open row + prize`
   - **Granted to `service_role` only.** In one transaction it:
     - locks the campaign row (`FOR UPDATE`)
     - checks the campaign is active and inside its window
     - works out the user's progress
     - checks `boxes_opened < boxes_earned`
     - picks a prize at random, weighted, from active prizes with stock
     - lowers stock with `UPDATE … SET stock_remaining = stock_remaining - 1 WHERE id = ? AND stock_remaining > 0` (or skips this when stock is unlimited)
   - Then it inserts the prize **order**:
     - `order_type='mystery_box_prize'`, `status='paid'`, `amount=0`, `profit=0`, `payment_method='promo'`
     - `agent_id=p_user_id`, plus `network`, `package_size` and `customer_phone`
     - `metadata` = `{mystery_box_open_id, campaign_id, category:'mashup' if is_mashup}`
   - It also inserts the `mystery_box_opens` row.
   - It raises clear errors: `not_eligible`, `out_of_stock`, `campaign_closed`.

## Server
**New edge function `supabase/functions/open-mystery-box/index.ts`**, modelled on `supabase/functions/claim-free-data/index.ts`:
- Checks the `disable_ordering` setting.
- Gets the user from the JWT and normalises the phone number (same logic as lines 54–66).
- Calls `mystery_box_open` with the service role.
- Hands delivery to `verify-payment` with `{reference: order_id}`.
- Returns `{success, prize_label, order_id, status}`.

**`supabase/functions/verify-payment/index.ts`** — handle `mystery_box_prize` as a zero-cost *data* order:
- **Do NOT** add it to the `isProviderOrder` exclusion list at line 875 (correction made after approval). `free_data_claim` sits on that list, which turns off the double-send and duplicate-order protection at lines 950, 1060, 1156 and 1952. Prize orders keep that protection. For the same reason, don't add it to the non-telecom lists in `check-order-status`, `cron-auto-retry`, `admin-retry-autorouter` or `AdminOrders`, so prizes get normal status polling and admin retry.
- Line 1259: treat it as internally paid.
- Line 1872: map it to `effectiveOrderType = 'data'`.
- **New guard next to line 1207:** for `mystery_box_prize`, fail the order unless a `mystery_box_opens` row exists with `order_id = targetReference`, and its `user_id` and `recipient_phone` match the order. This closes the gap where anyone can insert orders and someone could otherwise fake a prize order.

## Frontend
**`src/hooks/useMysteryBox.ts`** (React Query):
- Gets the current active campaign and its prizes (labels only).
- Calls `mystery_box_progress`.
- Exposes `open(phone)`, which invokes the edge function and then refreshes progress.

**`src/components/MysteryBoxModal.tsx`** — layout matches the screenshot:
- **Header:** LIVE badge, close button, and the campaign image, or a built-in CSS/SVG purple-and-gold gift box.
- **Progress:** "Progress: X/N qualifying orders · Y more to unlock", plus "Box k of max" when the box repeats.
- **Body:** the three bullets from `bullets`.
- **Button by state:**
  - Locked: "Place Y orders to unlock" → goes to the buy-data page.
  - Box available: "Open your box 🎁" → phone field prefilled from the profile → box shakes (framer-motion) → prize revealed with a burst animation.
  - Done: "You've opened all your boxes. Thanks!"
- **Errors** use friendly toasts (sonner), never default browser alerts.
- **Mounting:** dismissal is remembered per session per campaign (same pattern as `DataPromoPopupModal.tsx:191/236`). It shows automatically on the Dashboard only, for signed-in non-admin users. It also pops up again when a new box becomes available, even after dismissal; store the `boxes_available` count in the session key.

**`src/components/MysteryBoxCard.tsx`:** a small progress card in `src/pages/Dashboard.tsx` placed up top, near `FreeDataClaimBanner` (line ~304), so the popup can be reopened. It must not cover the Adinkra background.

## Admin
New page `src/pages/AdminMysteryBox.tsx`:
- **Routing:** lazy import plus `<Route path="mystery-box">` inside the `/admin` block in `src/App.tsx` (~line 583). Nav entry in `src/components/AdminLayout.tsx` in the promotions group, with `permKey: "packages"`.
- **Campaigns:** create, edit and toggle (title, window, orders per box, max boxes, minimum amount, bullets, image upload using the bucket `AdminBanners.tsx` uses).
- **Prize pool editor:** network and package picked from `global_package_settings`, plus weight, stock, and the live odds % shown.
- **Opens table:** user, phone, prize, order status (joined from `orders`).
- **Styling:** use theme tokens only, per the admin-console style layer.

## Left to the builder
Exact animation timing, copy wording, and the default illustration's details. Failed prize deliveries use the existing admin order retry tools, since prizes are treated as telecom orders, so no new retry button is needed. AdminOrders gets a "Mystery Box" type label.

## Build steps
1. Save this design to `docs/superpowers/specs/2026-11-23-mystery-box-design.md`.
2. Write the migration (tables, RLS, the two functions). The user applies it in the SQL editor.
3. Write the `open-mystery-box` edge function and the `verify-payment` changes, including the open-record guard.
4. Write `useMysteryBox`, `MysteryBoxModal` and `MysteryBoxCard`, and mount them on the Dashboard.
5. Build the `AdminMysteryBox` page, route and nav entry.
6. Write the tests (below).

## Verification
- **Unit/component tests:** `src/test/mystery-box-modal.test.tsx` (Vitest + Testing Library, mocking supabase). Cover the locked, available and opened/revealed states, the "Y more" maths, and session dismissal with re-show when a new box is earned. Run `npm test`. Also run `npx tsc --noEmit` and `npm run build`.
- **SQL checks** in the SQL editor after applying, against a test user:
  - progress stays at 0 with only `paid` orders and goes up when an order is `fulfilled`
  - a second `mystery_box_open` of the same box fails because of the unique constraint
  - out-of-stock prizes are never picked
  - with weights 1:9, roughly 10%/90% over 200 simulated picks in a rolled-back transaction
- **Security check:** insert a fake `mystery_box_prize` order with no open record and call verify-payment. It must end as `fulfillment_failed`.
- **End to end:** deploying the function and verify-payment is outward-facing, so confirm with the user first. Create a campaign with orders_per_box=1 and one cheap prize, place one real order, watch it reach fulfilled, open the box in the app, and confirm the prize order is delivered and shows in the admin opens table.
