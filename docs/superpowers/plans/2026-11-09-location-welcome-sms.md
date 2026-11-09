# Location Welcome SMS (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send one consented "SwiftData GH works in {town}" SMS when a signed-in user arrives in a new Ghanaian town.

**Architecture:** A new `location-check` Edge Function, called at most once a day from the app, finds the town from GPS or IP and applies new-town rules. Decisions live in dependency-free TypeScript modules so Vitest can cover them. A database RPC makes the once-per-town and limit rules safe under concurrent requests.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, Supabase Postgres and Deno Edge Functions, ipgeolocation.io.

**Spec:** `docs/superpowers/specs/2026-11-09-location-welcome-sms-design.md`

## Global Constraints

- Work on branch `feature/location-welcome-sms`. Never stage `supabase/migrations/20261105100000_fix_order_disputes_rls_and_guest_support.sql`, which has unrelated uncommitted changes.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- SMS template text, exactly: `SwiftData GH works in {town} too! Buy cheap non-expiry data anytime: https://swiftdatagh.shop`
- Popup question, exactly: `Want a text when SwiftData reaches a new town you visit?`
- Button labels, exactly: `Yes, text me` and `No thanks`.
- Fixed values: GPS match radius 20 km, commuter distance 30 km, 2 separate days for IP, 30 days between SMS per user, default daily limit 200, GPS timeout 8 seconds, popup delay 20 seconds, consent wording version `v1`.
- Dates are UTC `YYYY-MM-DD` strings, which match Ghana time.
- GPS coordinates are never stored or logged. The IP service key is never logged.
- No location lookup may run for a user whose status is not `granted`.
- The feature must never affect sign-in, browsing or purchases. Client calls run in the background and swallow all errors.
- New UI uses theme tokens (`bg-card`, `text-foreground`, `border-border`, `text-muted-foreground`), never `text-white` or opaque page backgrounds.
- Do not change `log-user-activity`. Do not add the new settings to the `public_system_settings` view.
- Nothing touches production (migration, function deploy, secrets) until Task 9, and only with the owner's go-ahead.

## Review Focus

Each line has a pinned test in the owning task.

1. Another dialog is open when the popup is due: the popup is skipped and offered again at the next app open, even on the same day (Task 6).
2. `localStorage` throws, as in private browsing: the check still runs and nothing crashes (Task 6).
3. Malformed GPS such as `"abc"`, `NaN` or `999`: treated as no GPS, falls back to IP (Task 4).
4. Missing or invalid phone number: never prompted and never texted (Task 4).
5. Two tabs check at the same moment: only one SMS is claimed (Task 3).

## IP Location Service Decision

Use **ipgeolocation.io**, starting on the free Developer plan. Volume is one lookup per consenting user per day, and only for people without GPS.

| Service | Cost | Allowance | City data | Commercial use | Verdict |
|---|---|---|---|---|---|
| **ipgeolocation.io Developer** | $0 | 1,000 credits a day, 1 per lookup | Yes | Allowed | **Start here** |
| ipgeolocation.io Starter | $19/month | 150,000 credits a month | Yes | Yes | Upgrade path |
| MaxMind City Plus | About $0.0003 per lookup, prepaid (about $9/month at 1,000 a day) | Pay as you go | Yes | Check licence | Backup. Price from a search summary of its support page, which could not be opened directly. |
| IPinfo Core | $26/month, billed yearly at $310 | 150,000 a month | Yes | Yes | No advantage |
| IPinfo Lite | $0 | Unlimited | No, country only | Yes | Cannot name towns |
| ip-api.com Pro | No confirmed public price | Unlimited | Yes | Yes | Current free plan is non-commercial |

Prices were checked on 2026-11-09 from each provider's pricing page unless noted. Accuracy for Ghanaian mobile networks is unverified for all of them, so Task 9 includes a real-world check.

API: `GET https://api.ipgeolocation.io/v3/ipgeo?apiKey={key}&ip={ip}`. Read `location.city` and `location.country_code2`. Treat any non-200 response as no result. The secret name is `IPGEOLOCATION_API_KEY`.

---

### Task 1: Ghana town list

**Files:**
- Create: `scripts/build-ghana-towns.mjs`
- Create (generated): `supabase/functions/_shared/ghana_towns.ts`
- Test: `src/test/ghana-towns.test.ts`

**Interfaces:**
- Produces: `export interface Town { key: string; name: string; lat: number; lng: number; aliases: string[] }` and `export const GHANA_TOWNS: Town[]`, both from `ghana_towns.ts`.

- [ ] **Step 1: Create the branch and add the approved spec and this plan**

```bash
git checkout -b feature/location-welcome-sms
git add docs/superpowers/specs/2026-11-09-location-welcome-sms-design.md docs/superpowers/plans/2026-11-09-location-welcome-sms.md
git commit -m "docs: location welcome SMS phase 1 spec and plan"
```

- [ ] **Step 2: Write the failing test `src/test/ghana-towns.test.ts`**

```ts
import { GHANA_TOWNS } from "../../supabase/functions/_shared/ghana_towns";
const CAPITALS = ["Accra","Kumasi","Sekondi-Takoradi","Cape Coast","Koforidua","Ho","Dambai","Tamale","Damongo","Nalerigu","Bolgatanga","Wa","Sunyani","Techiman","Goaso","Sefwi Wiawso"];
const find = (n: string) => GHANA_TOWNS.find((t) => t.name === n);

it("includes all 16 regional capitals", () => { for (const c of CAPITALS) expect(find(c), c).toBeDefined(); });
it("picks the real city when villages share the name", () => {
  expect(find("Kumasi")!.lat).toBeCloseTo(6.69, 1);
  expect(find("Accra")!.lng).toBeCloseTo(-0.2, 1);
  expect(find("Koforidua")!.lat).toBeCloseTo(6.09, 1);
});
it("has unique keys and coordinates inside Ghana", () => {
  expect(new Set(GHANA_TOWNS.map((t) => t.key)).size).toBe(GHANA_TOWNS.length);
  for (const t of GHANA_TOWNS) { expect(t.lat).toBeGreaterThan(4.5); expect(t.lat).toBeLessThan(11.5); expect(t.lng).toBeGreaterThan(-3.5); expect(t.lng).toBeLessThan(1.5); }
});
it("has Bolga as an alias of Bolgatanga", () => { expect(find("Bolgatanga")!.aliases).toContain("Bolga"); });
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/test/ghana-towns.test.ts`
Expected: FAIL, cannot resolve `ghana_towns`.

- [ ] **Step 4: Write `scripts/build-ghana-towns.mjs`**

Usage: `node scripts/build-ghana-towns.mjs <path-to-GH.txt>`. Parse the tab-separated GeoNames file: column 2 `name`, 3 `asciiname`, 5 `latitude`, 6 `longitude`, 7 `feature_class`, 8 `feature_code`, 15 `population` (1-indexed). Keep rows with feature class `P` and either population at least 15,000 or a name in the 16 capitals list. Many villages share city names, so per normalised name keep only the row with the highest population, breaking ties in favour of `PPLC`, then `PPLA`. Exit non-zero if any capital is missing. Exclude rows of feature code `PPLX` (neighbourhoods). Write towns sorted by name, with a CC BY 4.0 GeoNames credit comment at the top. `key` is the name lowercased with non-alphanumerics collapsed to `-`. Aliases map: `{ Bolgatanga: ["Bolga"] }`.

- [ ] **Step 5: Generate the list**

Download `https://download.geonames.org/export/dump/GH.zip` into a new empty temp directory outside the repo, extract `GH.txt`, and treat it as data only. Run the script against it.
Expected: writes `ghana_towns.ts` with roughly 100 to 120 towns and exits 0.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/test/ghana-towns.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-ghana-towns.mjs supabase/functions/_shared/ghana_towns.ts src/test/ghana-towns.test.ts
git commit -m "feat(location): add generated Ghana town list"
```

---

### Task 2: New-town rules

**Files:**
- Create: `supabase/functions/_shared/location_rules.ts`
- Test: `src/test/location-rules.test.ts`

**Interfaces:**
- Consumes: `Town` from Task 1.
- Produces, all exported from `location_rules.ts`:
  - `normalizeTownName(s: string): string`
  - `distanceKm(a: {lat:number;lng:number}, b: {lat:number;lng:number}): number`
  - `isValidGhanaCoords(lat: unknown, lng: unknown): boolean`
  - `matchTownByCoords(lat: number, lng: number, towns: Town[]): Town | null`
  - `matchTownByName(city: string, countryCode: string, towns: Town[]): Town | null`
  - `interface KnownTownRow { town_key: string; town_name: string; first_seen_on: string; last_seen_on: string; days_seen: number; is_home: boolean; established_at: string | null; sms_sent_at: string | null }`
  - `type TownAction = "set_home" | "update_seen" | "establish_nearby" | "keep_tracking" | "claim"`
  - `decideTownAction(a: { town: Town; source: "gps" | "ip"; today: string; known: KnownTownRow[]; towns: Town[] }): { action: TownAction; daysSeen: number }`

- [ ] **Step 1: Write the failing test**

Fixtures: `accra {key:"accra",lat:5.556,lng:-0.197}`, `madina {key:"madina",lat:5.668,lng:-0.166}`, `kumasi {key:"kumasi",lat:6.688,lng:-1.624}`, each with `aliases: []`, plus a `row(key, overrides)` helper with `established_at` set by default, `days_seen: 1`, `last_seen_on: "2026-11-08"`. Today is `2026-11-09`.

```ts
it("matches GPS within 20 km", () => expect(matchTownByCoords(5.6, -0.19, towns)?.key).toBe("accra"));
it("ignores GPS further than 20 km from any town", () => expect(matchTownByCoords(8.5, -2.5, towns)).toBeNull());
it("matches IP city case-insensitively in Ghana", () => expect(matchTownByName("KUMASI", "GH", towns)?.key).toBe("kumasi"));
it("ignores a matching city outside Ghana", () => expect(matchTownByName("Kumasi", "NG", towns)).toBeNull());
it("ignores unknown cities", () => expect(matchTownByName("Atlantis", "GH", towns)).toBeNull());
it("matches aliases", () => expect(matchTownByName("Bolga", "GH", [{ key:"bolgatanga", name:"Bolgatanga", lat:10.78, lng:-0.85, aliases:["Bolga"] }])?.key).toBe("bolgatanga"));
it.each([[undefined,1],["abc",-1],[NaN,-1],[999,-1],[5.6,200],[40.7,-74]])("rejects bad coords %s,%s", (a,b) => expect(isValidGhanaCoords(a,b)).toBe(false));

const act = (town, source, known) => decideTownAction({ town, source, today: "2026-11-09", known, towns });
it("rule 1: no established town sets home", () => expect(act(accra,"ip",[]).action).toBe("set_home"));
it("rule 2: established town only updates", () => expect(act(accra,"gps",[row("accra")]).action).toBe("update_seen"));
it("rule 3: within 30 km establishes without SMS", () => expect(act(madina,"gps",[row("accra")]).action).toBe("establish_nearby"));
it("rule 4: first IP day keeps tracking", () => expect(act(kumasi,"ip",[row("accra")])).toEqual({ action:"keep_tracking", daysSeen:1 }));
it("rule 4: second reading on the same day still tracks", () => expect(act(kumasi,"ip",[row("accra"), row("kumasi",{ established_at:null, last_seen_on:"2026-11-09", days_seen:1 })])).toEqual({ action:"keep_tracking", daysSeen:1 }));
it("second separate IP day claims", () => expect(act(kumasi,"ip",[row("accra"), row("kumasi",{ established_at:null, last_seen_on:"2026-11-08", days_seen:1 })])).toEqual({ action:"claim", daysSeen:2 }));
it("GPS claims on first sighting", () => expect(act(kumasi,"gps",[row("accra")]).action).toBe("claim"));
it("an unconfirmed town does not count as nearby or as home", () => expect(act(kumasi,"ip",[row("kumasi2",{ established_at:null })]).action).toBe("set_home"));
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/location-rules.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `location_rules.ts`**

No imports except the `Town` type. Bounds for `isValidGhanaCoords`: latitude 4.5 to 11.5, longitude -3.5 to 1.5, both finite numbers. Use the haversine formula. `normalizeTownName` lowercases, strips diacritics, collapses non-alphanumerics to one space and trims. Rules run in the spec's order. "Established" means `established_at` is not null. `daysSeen` is the row's `days_seen` plus 1 if `last_seen_on` differs from today, or 1 for a new row. A town with no matching entry in `towns` is skipped in the distance check.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/location-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/location_rules.ts src/test/location-rules.test.ts
git commit -m "feat(location): add new-town decision rules"
```

---

### Task 3: Database migration

**Files:**
- Create: `supabase/migrations/20261109120000_location_welcome_sms.sql`
- Create: `supabase/tests/location_welcome_sms_smoke.sql`

**Interfaces:**
- Produces: tables `location_alert_preferences` and `user_location_towns`, columns exactly as in the spec's data model with primary key `(user_id, town_key)` on the second; `system_settings.location_sms_mode` and `location_sms_daily_limit`; RPC `claim_location_sms(p_user_id uuid, p_town_key text, p_daily_limit int) RETURNS text`, returning `claimed`, `already_sent`, `limit_30d`, `daily_limit` or `no_row`.

- [ ] **Step 1: Write the migration**

Details not fixed by the spec:

- `status` has a `CHECK` for `unset`, `granted`, `declined`. `location_sms_mode` is `NOT NULL DEFAULT 'off'` with a `CHECK` for `off`, `consent`. `location_sms_daily_limit` is `NOT NULL DEFAULT 200` with a `CHECK` for `>= 0`.
- Enable row level security on both tables and add no policies. `REVOKE ALL` from `anon` and `authenticated`.
- Add an index on `user_location_towns (sms_sent_at) WHERE sms_sent_at IS NOT NULL`.
- Seed the template: `INSERT INTO public.sms_templates (key, label, body, is_active) VALUES ('location_welcome', 'Location welcome', '<exact text>', true) ON CONFLICT (key) DO NOTHING;`

RPC, `SECURITY DEFINER`, `SET search_path = public`:

```sql
PERFORM pg_advisory_xact_lock(hashtext('location_sms_claim'));
-- 1. row for this user and town has sms_sent_at set: RETURN 'already_sent'
-- 2. any row for this user with sms_sent_at > now() - interval '30 days': RETURN 'limit_30d'
-- 3. count of rows with sms_sent_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' is >= p_daily_limit: RETURN 'daily_limit'
-- 4. UPDATE the row SET sms_sent_at = now(), established_at = now() WHERE sms_sent_at IS NULL
-- 5. IF NOT FOUND RETURN 'no_row'; RETURN 'claimed'
```

`REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`

- [ ] **Step 2: Write `supabase/tests/location_welcome_sms_smoke.sql`**

Wrap everything in `BEGIN; ... ROLLBACK;`. Use one existing `auth.users` id and `RAISE EXCEPTION` on any mismatch. Assert in order: a claim for a row returns `claimed`; repeating that same claim, as two tabs would, returns `already_sent` and leaves one `sms_sent_at`; a different town for that user returns `limit_30d`; with limit `0` a different user returns `daily_limit`; a missing row returns `no_row`; `public_system_settings` has no `location_sms_mode` column.

- [ ] **Step 3: Review the SQL**

Run: `grep -ciE "drop |truncate |delete from" supabase/migrations/20261109120000_location_welcome_sms.sql`
Expected: `0`, because the migration only adds objects. The smoke file runs in Task 9.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261109120000_location_welcome_sms.sql supabase/tests/location_welcome_sms_smoke.sql
git commit -m "feat(location): add consent, town tracking and SMS claim schema"
```

---

### Task 4: Check flow

**Files:**
- Create: `supabase/functions/_shared/location_flow.ts`
- Create: `supabase/functions/_shared/ip_location.ts`
- Test: `src/test/location-flow.test.ts`

**Interfaces:**
- Consumes: Task 1 and Task 2 exports.
- Produces:
  - `lookupIpCity(ip: string, apiKey: string | undefined, fetchFn?: typeof fetch): Promise<{ city: string; countryCode: string } | null>` in `ip_location.ts`. Returns null on a missing key, private IP, non-200 response, exception, or after 3 seconds.
  - In `location_flow.ts`:

```ts
export type ConsentStatus = "unset" | "granted" | "declined";
export interface Prefs { status: ConsentStatus; prompted_at: string | null; last_check_on: string | null }
export type ClaimResult = "claimed" | "already_sent" | "limit_30d" | "daily_limit" | "no_row";
export interface LocationDeps {
  today(): string;
  getSettings(): Promise<{ mode: "off" | "consent"; dailyLimit: number }>;
  isAdmin(userId: string): Promise<boolean>;
  getProfile(userId: string): Promise<{ phone: string | null; sms_opt_out: boolean } | null>;
  normalizePhone(raw: string | null | undefined): string | null;
  getPrefs(userId: string): Promise<Prefs | null>;
  savePrefs(userId: string, patch: Partial<Prefs> & { consent_at?: string; consent_version?: string }): Promise<void>;
  lookupIp(ip: string): Promise<{ city: string; countryCode: string } | null>;
  getTownRows(userId: string): Promise<KnownTownRow[]>;
  saveTownRow(userId: string, row: KnownTownRow): Promise<void>;
  deleteTownRows(userId: string): Promise<void>;
  claimSms(userId: string, townKey: string, dailyLimit: number): Promise<ClaimResult>;
  releaseClaim(userId: string, townKey: string): Promise<void>;
  sendSms(phone: string, townName: string): Promise<"sent" | "no_template" | "failed">;
  now(): string;
}
export function runLocationCheck(deps: LocationDeps, input: { userId: string; ip: string | null; lat?: unknown; lng?: unknown; towns?: Town[] }): Promise<{ needs_consent: boolean; outcome: string }>;
export function applyConsent(deps: LocationDeps, userId: string, choice: "yes" | "no" | "dismissed", version: string): Promise<void>;
```

`towns` defaults to `GHANA_TOWNS`.

- [ ] **Step 1: Write the failing test**

Build a `fakeDeps(overrides)` with `vi.fn()` defaults: mode `consent`, limit 200, not admin, phone `0241234567`, opt-out false, prefs `{status:"granted", prompted_at:"x", last_check_on:null}`, `normalizePhone` returns `233241234567` for truthy input, one established Accra row, `lookupIp` returns Kumasi/GH, claim returns `claimed`, send returns `sent`, today `2026-11-09`.

```ts
const run = (d, extra = {}) => runLocationCheck(d, { userId:"u1", ip:"41.1.1.1", towns, ...extra });

it("does nothing when mode is off", async () => { const d = fakeDeps({ mode:"off" }); expect((await run(d)).needs_consent).toBe(false); expect(d.getPrefs).not.toHaveBeenCalled(); });
it("asks a never-prompted user with a valid phone", async () => { const d = fakeDeps({ prefs:null }); expect((await run(d)).needs_consent).toBe(true); expect(d.lookupIp).not.toHaveBeenCalled(); });
it("does not ask or text a user with no valid phone", async () => { const d = fakeDeps({ prefs:null, phone:null, normalize:() => null }); expect((await run(d)).needs_consent).toBe(false); expect(d.sendSms).not.toHaveBeenCalled(); });
it("granted user with an invalid phone does not trigger a lookup or SMS", async () => { const d = fakeDeps({ normalize:() => null }); await run(d); expect(d.lookupIp).not.toHaveBeenCalled(); expect(d.sendSms).not.toHaveBeenCalled(); });
it("does not ask admins", async () => { const d = fakeDeps({ prefs:null, admin:true }); expect((await run(d)).needs_consent).toBe(false); });
it.each(["declined","unset"])("never looks up a %s user", async (status) => { const d = fakeDeps({ prefs:{ status, prompted_at:"x", last_check_on:null } }); await run(d); expect(d.lookupIp).not.toHaveBeenCalled(); expect(d.saveTownRow).not.toHaveBeenCalled(); });
it("sms_opt_out always wins", async () => { const d = fakeDeps({ optOut:true }); await run(d); expect(d.lookupIp).not.toHaveBeenCalled(); });
it("runs at most once a day", async () => { const d = fakeDeps({ prefs:{ status:"granted", prompted_at:"x", last_check_on:"2026-11-09" } }); await run(d); expect(d.lookupIp).not.toHaveBeenCalled(); });
it("prefers valid GPS over IP", async () => { const d = fakeDeps(); await run(d, { lat:6.688, lng:-1.624 }); expect(d.lookupIp).not.toHaveBeenCalled(); expect(d.sendSms).toHaveBeenCalledWith("233241234567","Kumasi"); });
it.each([["abc",1],[NaN,NaN],[999,999]])("falls back to IP on malformed GPS %s,%s", async (lat,lng) => { const d = fakeDeps(); await run(d, { lat, lng }); expect(d.lookupIp).toHaveBeenCalled(); });
it("stops quietly when no town is found", async () => { const d = fakeDeps({ ipResult:null }); await run(d); expect(d.saveTownRow).not.toHaveBeenCalled(); expect(d.savePrefs).toHaveBeenCalledWith("u1", { last_check_on:"2026-11-09" }); });
it("limit_30d establishes without texting", async () => { const d = fakeDeps({ claim:"limit_30d" }); await run(d, { lat:6.688, lng:-1.624 }); expect(d.sendSms).not.toHaveBeenCalled(); expect(lastSavedRow(d).established_at).toBeTruthy(); });
it("daily_limit leaves the town unestablished", async () => { const d = fakeDeps({ claim:"daily_limit" }); await run(d, { lat:6.688, lng:-1.624 }); expect(d.sendSms).not.toHaveBeenCalled(); expect(lastSavedRow(d).established_at).toBeNull(); });
it.each(["failed","no_template"])("releases the claim when send is %s", async (r) => { const d = fakeDeps({ send:r }); await run(d, { lat:6.688, lng:-1.624 }); expect(d.releaseClaim).toHaveBeenCalledWith("u1","kumasi"); });
it("saying no deletes towns", async () => { const d = fakeDeps(); await applyConsent(d,"u1","no","v1"); expect(d.deleteTownRows).toHaveBeenCalledWith("u1"); expect(d.savePrefs).toHaveBeenCalledWith("u1", expect.objectContaining({ status:"declined", consent_version:"v1" })); });
it("dismissing records only that the prompt was seen", async () => { const d = fakeDeps(); await applyConsent(d,"u1","dismissed","v1"); const patch = d.savePrefs.mock.calls[0][1]; expect(patch.prompted_at).toBeTruthy(); expect(patch.status).toBeUndefined(); });
it("lookupIpCity returns null on non-200", async () => { expect(await lookupIpCity("41.1.1.1","k", async () => new Response("", { status:429 }))).toBeNull(); });
it("lookupIpCity returns null with no key", async () => { expect(await lookupIpCity("41.1.1.1",undefined)).toBeNull(); });
it("lookupIpCity reads city and country", async () => { const r = new Response(JSON.stringify({ location:{ city:"Kumasi", country_code2:"GH" } })); expect(await lookupIpCity("41.1.1.1","k", async () => r)).toEqual({ city:"Kumasi", countryCode:"GH" }); });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/location-flow.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement both modules**

`runLocationCheck` follows the spec's `check` flow, with these specifics. A user is prompted only when `prefs` is null or `prompted_at` is null, status is `unset`, they are not an admin, and the phone normalises. A granted user with an invalid phone stops before any lookup. Set `last_check_on` before finding the town. On `set_home`, set `is_home: true` and `established_at`. On `claim`, save the row with `established_at: null` first, because the RPC needs the row to exist. `applyConsent("yes")` sets `status: "granted"`, `prompted_at`, `consent_at`, `consent_version`. `applyConsent("no")` also deletes town rows.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/location-flow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/location_flow.ts supabase/functions/_shared/ip_location.ts src/test/location-flow.test.ts
git commit -m "feat(location): add check flow and IP lookup"
```

---

### Task 5: `location-check` Edge Function

**Files:**
- Create: `supabase/functions/location-check/index.ts`

**Interfaces:**
- Consumes: Task 4 exports; `verifyAdmin` from `_shared/auth.ts`; `getSmsConfig`, `dispatchUnifiedSms`, `normalizePhone`, `formatTemplate` from `_shared/sms.ts`; `corsHeaders` from `_shared/cors.ts`.
- Produces: POST endpoint with JSON body `{ action, ... }`. Responses:
  - `check` (`lat?`, `lng?`): `{ needs_consent: boolean }`
  - `status`: `{ eligible: boolean; status: ConsentStatus; sms_opt_out: boolean }`. `eligible` is false for admins, when mode is `off`, or with no valid phone.
  - `set_consent` (`choice`, `version`): `{ ok: true }`
  - `set_sms_opt_out` (`value: boolean`): `{ ok: true }`
  - `admin_stats`: `{ granted: number; declined: number; sent_today: number; sent_total: number }`
  - `admin_test_send` (`town: string`): `{ ok: boolean; error?: string }`

- [ ] **Step 1: Write the function**

Authenticate with `auth.getUser()` as `log-user-activity` does (`index.ts:60-71`), and read the client IP with the same header order (`index.ts:50-54`). Build `LocationDeps` from a service-role client. `sendSms` reads `templates.location_welcome` from `getSmsConfig`, returns `no_template` when absent, sends with `dispatchUnifiedSms(gateway, apiKey, senderId, phone, body, "location_welcome")`, and returns `failed` on an exception. `isAdmin` checks `user_roles` for role `admin`. `lookupIp` calls `lookupIpCity` with `Deno.env.get("IPGEOLOCATION_API_KEY")`.

Both admin actions call `verifyAdmin(req, supabaseAdmin, { checkMfa: true })`. `admin_test_send` validates that `town` matches a `GHANA_TOWNS` name, sends to the admin's own phone, and writes nothing to the location tables.

Reject unknown actions and `set_consent` choices with status 400. Unexpected exceptions return `{ needs_consent: false }` with status 200 and log only the message, never coordinates.

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -E "location" ; echo done`
Expected: only `done`. No errors mention the new files. Existing errors elsewhere are out of scope.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/location-check/index.ts
git commit -m "feat(location): add location-check edge function"
```

---

### Task 6: Daily check and consent popup

**Files:**
- Create: `src/lib/locationAlerts.ts`
- Create: `src/components/LocationAlertPrompt.tsx`
- Modify: `src/App.tsx` (lazy import near line 33, mount after line 609)
- Test: `src/test/location-alert-prompt.test.tsx`

**Interfaces:**
- Consumes: the endpoint from Task 5, through `supabase.functions.invoke("location-check", { body })`.
- Produces, from `locationAlerts.ts`:
  - `export const LOCATION_CONSENT_VERSION = "v1"`
  - `hasCheckedToday(): boolean` and `markCheckedToday(): void`, both safe if storage throws
  - `getGrantedPosition(): Promise<{ lat: number; lng: number } | null>`: only if `navigator.permissions` reports `granted`, never prompts
  - `requestPosition(): Promise<{ lat: number; lng: number } | null>`: triggers the browser prompt, 8-second timeout, low accuracy
  - `callLocationCheck<T>(body: Record<string, unknown>): Promise<T | null>`: returns null on any error

- [ ] **Step 1: Write the failing test**

Mock `@/integrations/supabase/client`, `@/hooks/useAuth` (signed-in user), and `@/lib/locationAlerts` partially. Use fake timers.

```tsx
it("shows the popup after 20 seconds when consent is needed", async () => { /* check returns needs_consent:true; advance 20s */ expect(await screen.findByText("Want a text when SwiftData reaches a new town you visit?")).toBeInTheDocument(); });
it("does not mark the day as checked when another dialog blocks the popup", async () => { /* render a role=dialog element; advance 20s */ expect(screen.queryByText(/new town you visit/)).toBeNull(); expect(markCheckedToday).not.toHaveBeenCalled(); });
it("marks the day as checked when no consent is needed", async () => { /* needs_consent:false */ expect(markCheckedToday).toHaveBeenCalled(); });
it("skips the call if already checked today", async () => { hasCheckedToday.mockReturnValue(true); /* render */ expect(invoke).not.toHaveBeenCalled(); });
it("asks for GPS only after tapping yes", async () => { expect(requestPosition).not.toHaveBeenCalled(); /* click "Yes, text me" */ expect(requestPosition).toHaveBeenCalledTimes(1); expect(invoke).toHaveBeenCalledWith("location-check", { body: { action:"set_consent", choice:"yes", version:"v1" } }); });
it("records no thanks", async () => { /* click "No thanks" */ expect(invoke).toHaveBeenCalledWith("location-check", { body: { action:"set_consent", choice:"no", version:"v1" } }); });
it("records closing as dismissed", async () => { /* click close */ expect(invoke).toHaveBeenCalledWith("location-check", { body: { action:"set_consent", choice:"dismissed", version:"v1" } }); });
```

Add a separate describe that imports the real `locationAlerts`:

```ts
it("works when localStorage throws", () => { vi.spyOn(Storage.prototype,"getItem").mockImplementation(() => { throw new Error("denied"); }); vi.spyOn(Storage.prototype,"setItem").mockImplementation(() => { throw new Error("denied"); }); expect(hasCheckedToday()).toBe(false); expect(() => markCheckedToday()).not.toThrow(); });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/location-alert-prompt.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`LocationAlertPrompt` renders null until needed. On mount, for a signed-in user: stop if `hasCheckedToday()`; otherwise call `check` with `await getGrantedPosition()` spread in. If `needs_consent` is false, `markCheckedToday()`. If true, wait 20 seconds. If `document.querySelector('[role="dialog"]')` then exists, do nothing and leave the day unmarked. Otherwise show the dialog and call `markCheckedToday()`. After `Yes, text me`: record consent, close, call `requestPosition()`, then run `check` with the position if there is one.

Use the existing `Dialog` from `@/components/ui/dialog`, `bg-card/95`, rounded corners, `/assets/ama_avatar.webp`, and one line of friendly supporting text: `We'll only text you when you arrive somewhere new. You can turn this off anytime in Account Settings.`

In `App.tsx`, lazy-load it as `DataPromoPopupModal` is loaded, and mount it inside the same `Suspense`: `{!isAgentStore && !isChallengeArenaPage && !isAdmin && <LocationAlertPrompt />}`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/location-alert-prompt.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/locationAlerts.ts src/components/LocationAlertPrompt.tsx src/App.tsx src/test/location-alert-prompt.test.tsx
git commit -m "feat(location): add daily check and consent popup"
```

---

### Task 7: Account Settings switches

**Files:**
- Create: `src/components/LocationAlertSettings.tsx`
- Modify: `src/pages/DashboardAccountSettings.tsx` (import, and render directly before the `Saved Accounts & Switcher` card near line 754)
- Test: `src/test/location-alert-settings.test.tsx`

**Interfaces:**
- Consumes: `callLocationCheck`, `requestPosition`, `LOCATION_CONSENT_VERSION` from Task 6; the `status`, `set_consent` and `set_sms_opt_out` actions.

- [ ] **Step 1: Write the failing test**

```tsx
it("renders nothing when not eligible", async () => { /* status eligible:false */ await waitFor(() => expect(container).toBeEmptyDOMElement()); });
it("shows both switches with server values", async () => { /* eligible, granted, opt-out false */ expect(await screen.findByRole("switch", { name:"Tell me when SwiftData is in a new town I visit" })).toBeChecked(); expect(screen.getByRole("switch", { name:"Promotional SMS" })).toBeChecked(); });
it("turning location off sends no", async () => { /* toggle */ expect(callLocationCheck).toHaveBeenCalledWith({ action:"set_consent", choice:"no", version:"v1" }); });
it("turning location on sends yes and asks for GPS", async () => { /* start declined, toggle */ expect(callLocationCheck).toHaveBeenCalledWith({ action:"set_consent", choice:"yes", version:"v1" }); expect(requestPosition).toHaveBeenCalled(); });
it("Promotional SMS off sets opt-out true", async () => { /* toggle */ expect(callLocationCheck).toHaveBeenCalledWith({ action:"set_sms_opt_out", value:true }); });
it("reverts the switch when saving fails", async () => { callLocationCheck.mockResolvedValueOnce(null); /* toggle */ await waitFor(() => expect(sw).toBeChecked()); });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/location-alert-settings.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `LocationAlertSettings`**

A `Card` titled `SMS preferences`, with two `Switch` controls using the exact accessible names from the test. "Promotional SMS" is checked when `sms_opt_out` is false. Add the helper text `Order and payment messages are not affected.` Show a toast only on failure. Render it in `DashboardAccountSettings`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/location-alert-settings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LocationAlertSettings.tsx src/pages/DashboardAccountSettings.tsx src/test/location-alert-settings.test.tsx
git commit -m "feat(location): add SMS preference switches to account settings"
```

---

### Task 8: Admin controls, Privacy page and release bump

**Files:**
- Create: `src/components/AdminLocationAlertsCard.tsx`
- Modify: `src/pages/AdminSettings.tsx` (render before the `Contact & Support` card near line 1405)
- Modify: `src/pages/Privacy.tsx` (sections 1 and 2)
- Modify: `src/main.tsx` (`CURRENT_SW_BUILD_KEY`)
- Test: `src/test/admin-location-alerts-card.test.tsx`

**Interfaces:**
- Consumes: `admin_stats` and `admin_test_send`, plus direct admin read and update of `system_settings` where `id = 1`.

The card saves its own two columns. `AdminSettings.handleSave` builds its payload only from fields loaded explicitly at lines 483 onward, so it does not overwrite them. Do not add these fields to its `SystemSettings` state.

- [ ] **Step 1: Write the failing test**

```tsx
it("loads mode, limit and counts", async () => { expect(await screen.findByRole("switch", { name:"Location welcome SMS" })).not.toBeChecked(); expect(screen.getByLabelText("Daily SMS limit")).toHaveValue(200); expect(screen.getByText(/Sent today: 3/)).toBeInTheDocument(); });
it("turning on saves consent mode", async () => { /* toggle */ expect(update).toHaveBeenCalledWith({ location_sms_mode:"consent" }); });
it("rejects a negative daily limit", async () => { /* type -1, save */ expect(update).not.toHaveBeenCalled(); });
it("sends a test to a chosen town", async () => { /* type Kumasi, click Send test */ expect(invoke).toHaveBeenCalledWith("location-check", { body:{ action:"admin_test_send", town:"Kumasi" } }); });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/admin-location-alerts-card.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the card and page changes**

Use theme tokens only, as the card sits inside `.admin-shell main`. Show granted, declined, sent today and sent total, and a link to `/admin/sms-templates` for editing the message.

In `Privacy.tsx`, add to section 1: `<li><strong>Approximate Location:</strong> If you agree to location alerts, the town you are in, worked out from your IP address or device location. We store town names only, never exact coordinates.</li>`. Add to section 2: `<li>To send you a text when you arrive in a new town, only if you have agreed. You can turn this off anytime in Account Settings.</li>`.

Set `CURRENT_SW_BUILD_KEY` to `swiftdata_sw_build_2026_11_09_location_v1`.

- [ ] **Step 4: Run all tests, type-check and build**

Run: `npx vitest run`
Expected: all new tests PASS and no previously passing test fails.

Run: `npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -E "location|LocationAlert" ; echo done`
Expected: only `done`.

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/AdminLocationAlertsCard.tsx src/pages/AdminSettings.tsx src/pages/Privacy.tsx src/main.tsx src/test/admin-location-alerts-card.test.tsx
git commit -m "feat(location): add admin controls and privacy notice"
```

---

### Task 9: Production rollout

Do each step only with the owner's go-ahead. These change the live system.

- [ ] **Step 1: Add the IP key.** Owner creates a free ipgeolocation.io account. Run: `npx supabase secrets set IPGEOLOCATION_API_KEY=<key>`. Expected: secret listed by `npx supabase secrets list`.
- [ ] **Step 2: Apply the migration.** Run `npx supabase db push` after confirming with `npx supabase migration list` that only `20261109120000` is pending. The unrelated `20261105100000` file has local edits, so stop and ask if it appears as pending.
- [ ] **Step 3: Run the smoke test.** Run `supabase/tests/location_welcome_sms_smoke.sql` in the SQL editor. Expected: completes with no exception, and nothing is kept because of the rollback.
- [ ] **Step 4: Deploy the function.** Run: `npx supabase functions deploy location-check --no-verify-jwt`. With mode `off`, confirm in the app that no popup appears.
- [ ] **Step 5: Release the frontend.** Merge the branch and deploy through the usual Vercel flow. Confirm sign-in and a purchase work.
- [ ] **Step 6: Test send.** From Admin Settings, send a test for `Kumasi`. Expected: SMS arrives with correct text and a working link.
- [ ] **Step 7: Walk through the spec's manual checks 3 to 6** on a test account, after setting the mode to `consent`. To simulate a move, edit the test user's rows in `user_location_towns`.
- [ ] **Step 8: Check IP accuracy.** Compare `location-check` results against the real town for a few phones on MTN, Telecel and AirtelTigo data. If most are wrong, leave IP off by removing the secret. GPS keeps working.
- [ ] **Step 9: Monitor for one week** using the admin counts and SMS spend before raising the daily limit.
