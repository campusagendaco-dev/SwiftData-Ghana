# Location Welcome SMS: Phase 1 Design

Date: 2026-11-09
Status: awaiting review

## Goal

When a signed-in SwiftData user who has agreed to these messages arrives in a new town in Ghana, send them one SMS:

> SwiftData GH works in {town} too! Buy cheap non-expiry data anytime: https://swiftdatagh.shop

Audience: customers, agents and sub-agents. Admins are excluded.

## Scope

**In Phase 1:** one-time consent popup, once-a-day location check, GPS and IP detection, new-town rules, SMS sending, user settings switches, admin controls, Privacy page update.

**Not in Phase 1:** sending to people who have not said yes. That is Phase 2, which gets its own spec after Phase 1 has been running. See "Phase 2 compatibility".

## Known limitation

A website can only detect location while it is open. This feature cannot reach someone who does not open SwiftData in the new town.

## User flow

1. A signed-in, non-admin user with a valid phone number opens the app. The feature must be switched on by an admin.
2. If they have never been asked, a warm popup with Ama appears: "Want a text when SwiftData reaches a new town you visit?"
3. They choose one of:
   - **Yes, text me:** consent is recorded. The browser then asks for GPS permission. Refusing GPS is fine and keeps them on IP detection.
   - **No thanks:** recorded as declined. They are never asked again and never texted.
   - **Close (X):** recorded as asked, with no answer. They are not asked again and are not texted in Phase 1.
4. From then on, the app checks location at most once a day when opened.
5. A new town that passes the rules below triggers the SMS.
6. The user can change their answer at any time in Account Settings.

### Popup rules

- Mounted in `App.tsx` beside `DataPromoPopupModal`, for signed-in users only. Not shown on admin, agent store or Challenge Arena pages.
- Waits 20 seconds after the app opens and only appears if no other dialog is open. Otherwise it tries again at the next app open.
- GPS permission is requested only after the user taps "Yes, text me".
- Uses theme tokens and soft, friendly styling, and leaves the Adinkra background visible around it.

## New-town rules

These live in a pure module with no Deno or network imports, so they can be unit tested.

**Finding the town**

| Source | Rule |
|---|---|
| GPS | Coordinates must be inside Ghana's bounding box. Use the nearest listed town within 20 km. Otherwise ignore the reading. |
| IP | City name, normalised, must match a listed town or alias and the country must be Ghana. Otherwise ignore the reading. |

GPS is used when the browser already has permission and returns a position within 8 seconds. Otherwise IP is used.

**Deciding what to do**, checked in this order:

| # | Situation | Result |
|---|---|---|
| 1 | The user has no established town yet | This town becomes home. No SMS. |
| 2 | Town is already established | Update last seen. No SMS. |
| 3 | Town is within 30 km of any established town | Record it as established. No SMS. This stops commuters, such as Madina to Accra, from being texted. |
| 4 | IP reading seen on fewer than 2 separate days | Keep tracking. No SMS. |
| 5 | User has received one of these SMS in the last 30 days | Record it as established. No SMS and no later retry. |
| 6 | Platform daily limit reached | Not established. Retried at the next day's check. |
| 7 | Otherwise | Record it as established and send the SMS. |

A GPS reading counts as confirmed immediately. Days are UTC days, which match Ghana time.

Once a town is established, it never triggers another SMS for that person.

## Town list

`supabase/functions/_shared/ghana_towns.ts` holds Ghana towns with name, latitude, longitude and aliases. It is generated once from the GeoNames Ghana extract, keeping towns with a population of at least 15,000 plus all regional capitals. GeoNames is CC BY 4.0 and is credited at the top of the file.

## Data model

Migration: `20261109120000_location_welcome_sms.sql`.

**`location_alert_preferences`** (one row per user)

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid, primary key | References `auth.users`, cascades on delete |
| `status` | text | `unset`, `granted` or `declined`. Default `unset` |
| `prompted_at` | timestamptz | When the popup was answered or closed |
| `consent_at` | timestamptz | When the current status was chosen |
| `consent_version` | text | Which wording the user saw |
| `last_check_on` | date | Server-side once-a-day limit |
| `updated_at` | timestamptz | |

**`user_location_towns`** (one row per user and town)

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | Part of the unique key |
| `town_key` | text | Part of the unique key |
| `town_name` | text | Display name used in the SMS |
| `first_seen_on`, `last_seen_on` | date | |
| `days_seen` | int | Goes up at most once a day |
| `is_home` | boolean | The user's first established town |
| `established_at` | timestamptz | Null while still being tracked |
| `sms_sent_at` | timestamptz | Null until the SMS is claimed |

Both tables have row level security on with no client policies. Only the backend function can read or write them.

GPS coordinates are never stored. Only the matched town is kept.

**`system_settings` additions**

- `location_sms_mode` text, default `off`. Allowed values in Phase 1: `off`, `consent`.
- `location_sms_daily_limit` integer, default 200.

These are not added to the `public_system_settings` view.

**`sms_templates` row**

Key `location_welcome`, using the template text in "Goal", editable on the existing SMS Templates admin page. Deactivating it stops sending.

**RPC `claim_location_sms(p_user_id, p_town_key, p_daily_limit)`**

`SECURITY DEFINER`, executable by `service_role` only. Inside one transaction, protected by an advisory lock, it checks the daily limit, the 30-day rule and that `sms_sent_at` is still null, then sets `sms_sent_at` and `established_at`. It returns whether the claim succeeded and, if not, the reason. This is what makes "once per town" and the limits hold when requests arrive at the same time.

## Backend function

New Edge Function `location-check`, authenticated with the user's token in the same way as `log-user-activity`. It is separate from `log-user-activity`, so login logging is not affected.

| Action | Who | What it does |
|---|---|---|
| `check` | User | The daily flow below. Optional `lat` and `lng`. |
| `status` | User | Returns consent status and `sms_opt_out` for the settings page. |
| `set_consent` | User | `yes`, `no` or `dismissed`, plus the wording version. |
| `set_sms_opt_out` | User | Updates `profiles.sms_opt_out`. |
| `admin_stats` | Admin | Counts of consents and SMS sent today and in total. |
| `admin_test_send` | Admin | Sends the template to the admin's own phone with a chosen town. Skips the limits and records nothing. |

Admin actions use the existing `verifyAdmin` helper in `_shared/auth.ts`.

**`check` flow**

1. Stop if `location_sms_mode` is `off`.
2. Load preferences and profile. If the user was never asked and has a valid phone, return `needs_consent: true`.
3. Stop if status is not `granted`, or `sms_opt_out` is true, or `last_check_on` is today.
4. Set `last_check_on` to today. No location lookup happens before this point, so nobody who has not agreed is looked up.
5. Find the town. If there is no usable reading, stop.
6. Update `user_location_towns` and apply the new-town rules.
7. If the result is "send", call `claim_location_sms`, then send through `dispatchUnifiedSms` with type `location_welcome`, formatted with `formatTemplate`. The phone is normalised with `normalizePhone`.
8. If the claim is refused, apply rule 5 or 6 of the new-town rules according to the reason returned.
9. If sending fails or the template is inactive, clear `sms_sent_at` and `established_at` so the town is retried at the next day's check.

## Frontend

- `src/hooks/useLocationAlerts.ts`: runs on app open for signed-in, non-admin users. Skips if already run today, using `localStorage` wrapped in try/catch. The server limit is the real one. Uses `navigator.permissions` so it never triggers a GPS prompt during the daily check.
- `src/components/LocationAlertPrompt.tsx`: the popup.
- `DashboardAccountSettings`: two new switches.
  - "Tell me when SwiftData is in a new town I visit", for consent.
  - "Promotional SMS", for `sms_opt_out`. It covers promotional messages only. Order and payment messages are unaffected.
- `AdminSettings`: on/off control, daily limit, counts from `admin_stats`, and a test-send form.
- `Privacy.tsx`: explains that, with consent, approximate location is used to send these messages, that only town names are stored, and how to turn it off.

## Failure handling

The feature must never affect sign-in, browsing or purchases.

- The client call runs in the background and ignores all errors.
- A GPS timeout or refusal falls back to IP.
- If the IP service fails or has no key configured, the check ends with no change. GPS users are unaffected.
- SMS failures are logged by the existing SMS code and retried the next day through the released claim.

## Privacy

- Nothing is looked up or stored for anyone who has not said yes.
- Choosing "No thanks" or turning the switch off deletes that user's `user_location_towns` rows.
- `consent_at` and `consent_version` keep a record of what each person agreed to.
- The existing `sms_opt_out` always wins.

## IP location service

The free ip-api.com plan is for non-commercial use, so this feature does not use it. A commercial service is called through one function, `lookupIpCity(ip)`, with its key stored as a Supabase secret.

Selection criteria: HTTPS, licensed for commercial use, returns city-level results for Ghanaian IPs, and affordable at one lookup per consenting user per day. The implementation plan compares candidates and costs. The feature can ship with GPS only until the key is added.

Changing the existing `log-user-activity` lookup is out of scope.

## Testing

**Automated (Vitest).** `src/test/location-rules.test.ts` imports the pure module directly:

- Town matching: GPS radius, outside Ghana, aliases, unknown city names.
- Every row of the decision table, in order.
- Day counting: two readings on one day do not confirm a town.

**Manual, before going live:**

1. Apply the migration and deploy with the mode set to `off`. Confirm no popup appears.
2. Use `admin_test_send` to confirm the SMS text, link and delivery to your own phone.
3. Switch to `consent` and walk through Yes, No thanks and Close on a test account.
4. Confirm a home town sends nothing, a town more than 30 km away sends once, and a repeat sends nothing.
5. Turn each settings switch off and confirm nothing sends.
6. Confirm sign-in and purchase still work with the function deliberately failing.

## Rollout

1. Migration and function deployed with mode `off`.
2. Frontend released, including the service worker build version bump.
3. Admin test send.
4. Mode set to `consent`.
5. Watch `admin_stats` and SMS cost for the first week before raising the daily limit.

## Phase 2 compatibility

Phase 2 adds a mode value, `opt_out`, that also includes users with status `unset`, using IP detection only. Users with status `declined` or `sms_opt_out` on stay excluded. The Phase 1 tables already separate "never answered" from "declined", so no data needs converting.
