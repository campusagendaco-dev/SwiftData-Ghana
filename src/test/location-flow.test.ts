import { describe, it, expect, vi } from "vitest";
import { runLocationCheck, applyConsent, type LocationDeps, type ClaimResult } from "../../supabase/functions/_shared/location_flow";
import { lookupIpCity } from "../../supabase/functions/_shared/ip_location";
import type { KnownTownRow } from "../../supabase/functions/_shared/location_rules";
import type { Town } from "../../supabase/functions/_shared/ghana_towns";

const accra: Town = { key: "accra", name: "Accra", lat: 5.556, lng: -0.197, aliases: [] };
const kumasi: Town = { key: "kumasi", name: "Kumasi", lat: 6.688, lng: -1.624, aliases: [] };
const towns = [accra, kumasi];

const accraRow: KnownTownRow = {
  town_key: "accra", town_name: "Accra", first_seen_on: "2026-10-01", last_seen_on: "2026-11-01",
  days_seen: 5, is_home: true, established_at: "2026-10-01T00:00:00Z", sms_sent_at: null,
};

function fakeDeps(o: Record<string, any> = {}) {
  const d = {
    today: vi.fn(() => "2026-11-09"),
    getSettings: vi.fn(async () => ({ mode: o.mode ?? "consent", dailyLimit: 200 })),
    isAdmin: vi.fn(async () => o.admin ?? false),
    getProfile: vi.fn(async () => ({ phone: "phone" in o ? o.phone : "0241234567", sms_opt_out: o.optOut ?? false })),
    normalizePhone: vi.fn(o.normalize ?? ((raw: any) => (raw ? "233241234567" : null))),
    getPrefs: vi.fn(async () => ("prefs" in o ? o.prefs : { status: "granted", prompted_at: "x", last_check_on: null })),
    savePrefs: vi.fn(async (_u: string, _p: any) => {}),
    lookupIp: vi.fn(async () => ("ipResult" in o ? o.ipResult : { city: "Kumasi", countryCode: "GH" })),
    getTownRows: vi.fn(async () => [accraRow]),
    saveTownRow: vi.fn(async (_u: string, _r: KnownTownRow) => {}),
    deleteTownRows: vi.fn(async () => {}),
    claimSms: vi.fn(async (): Promise<ClaimResult> => o.claim ?? "claimed"),
    releaseClaim: vi.fn(async () => {}),
    sendSms: vi.fn(async () => o.send ?? "sent"),
    now: vi.fn(() => "2026-11-09T10:00:00Z"),
  };
  return d as unknown as typeof d & LocationDeps;
}
const lastSavedRow = (d: ReturnType<typeof fakeDeps>): KnownTownRow => {
  const c = d.saveTownRow.mock.calls;
  return c[c.length - 1][1] as KnownTownRow;
};
const run = (d: any, extra = {}) => runLocationCheck(d, { userId: "u1", ip: "41.1.1.1", towns, ...extra });
const gps = { lat: 6.688, lng: -1.624 };

describe("runLocationCheck", () => {
  it("does nothing when mode is off", async () => { const d = fakeDeps({ mode: "off" }); expect((await run(d)).needs_consent).toBe(false); expect(d.getPrefs).not.toHaveBeenCalled(); });
  it("asks a never-prompted user with a valid phone", async () => { const d = fakeDeps({ prefs: null }); expect((await run(d)).needs_consent).toBe(true); expect(d.lookupIp).not.toHaveBeenCalled(); });
  it("does not ask or text a user with no valid phone", async () => { const d = fakeDeps({ prefs: null, phone: null, normalize: () => null }); expect((await run(d)).needs_consent).toBe(false); expect(d.sendSms).not.toHaveBeenCalled(); });
  it("granted user with an invalid phone does not trigger a lookup or SMS", async () => { const d = fakeDeps({ normalize: () => null }); await run(d); expect(d.lookupIp).not.toHaveBeenCalled(); expect(d.sendSms).not.toHaveBeenCalled(); });
  it("does not ask admins", async () => { const d = fakeDeps({ prefs: null, admin: true }); expect((await run(d)).needs_consent).toBe(false); });
  it.each(["declined", "unset"])("never looks up a %s user", async (status) => { const d = fakeDeps({ prefs: { status, prompted_at: "x", last_check_on: null } }); await run(d); expect(d.lookupIp).not.toHaveBeenCalled(); expect(d.saveTownRow).not.toHaveBeenCalled(); });
  it("sms_opt_out always wins", async () => { const d = fakeDeps({ optOut: true }); await run(d); expect(d.lookupIp).not.toHaveBeenCalled(); });
  it("runs at most once a day", async () => { const d = fakeDeps({ prefs: { status: "granted", prompted_at: "x", last_check_on: "2026-11-09" } }); await run(d); expect(d.lookupIp).not.toHaveBeenCalled(); });
  it("prefers valid GPS over IP", async () => { const d = fakeDeps(); await run(d, gps); expect(d.lookupIp).not.toHaveBeenCalled(); expect(d.sendSms).toHaveBeenCalledWith("233241234567", "Kumasi"); });
  it.each([["abc", 1], [NaN, NaN], [999, 999]])("falls back to IP on malformed GPS %s,%s", async (lat, lng) => { const d = fakeDeps(); await run(d, { lat, lng }); expect(d.lookupIp).toHaveBeenCalled(); });
  it("stops quietly when no town is found", async () => { const d = fakeDeps({ ipResult: null }); await run(d); expect(d.saveTownRow).not.toHaveBeenCalled(); expect(d.savePrefs).toHaveBeenCalledWith("u1", { last_check_on: "2026-11-09" }); });
  it("limit_30d establishes without texting", async () => { const d = fakeDeps({ claim: "limit_30d" }); await run(d, gps); expect(d.sendSms).not.toHaveBeenCalled(); expect(lastSavedRow(d).established_at).toBeTruthy(); });
  it("daily_limit leaves the town unestablished", async () => { const d = fakeDeps({ claim: "daily_limit" }); await run(d, gps); expect(d.sendSms).not.toHaveBeenCalled(); expect(lastSavedRow(d).established_at).toBeNull(); });
  it.each(["failed", "no_template"])("releases the claim when send is %s", async (r) => { const d = fakeDeps({ send: r }); await run(d, gps); expect(d.releaseClaim).toHaveBeenCalledWith("u1", "kumasi"); });
  it("releases the claim when send throws", async () => { const d = fakeDeps(); d.sendSms.mockRejectedValue(new Error("boom")); await run(d, gps); expect(d.releaseClaim).toHaveBeenCalledWith("u1", "kumasi"); });
  it("saves the claim row before claiming", async () => { const d = fakeDeps(); await run(d, gps); expect(d.saveTownRow.mock.invocationCallOrder[0]).toBeLessThan(d.claimSms.mock.invocationCallOrder[0]); });
  it("first town becomes home with no SMS", async () => { const d = fakeDeps(); d.getTownRows.mockResolvedValue([]); await run(d, gps); expect(d.sendSms).not.toHaveBeenCalled(); expect(lastSavedRow(d)).toMatchObject({ is_home: true }); expect(lastSavedRow(d).established_at).toBeTruthy(); });
});

describe("applyConsent", () => {
  it("saying no deletes towns", async () => { const d = fakeDeps(); await applyConsent(d, "u1", "no", "v1"); expect(d.deleteTownRows).toHaveBeenCalledWith("u1"); expect(d.savePrefs).toHaveBeenCalledWith("u1", expect.objectContaining({ status: "declined", consent_version: "v1" })); });
  it("saying yes grants consent", async () => { const d = fakeDeps(); await applyConsent(d, "u1", "yes", "v1"); expect(d.deleteTownRows).not.toHaveBeenCalled(); expect(d.savePrefs).toHaveBeenCalledWith("u1", expect.objectContaining({ status: "granted", consent_version: "v1", consent_at: expect.any(String), prompted_at: expect.any(String) })); });
  it("dismissing records only that the prompt was seen", async () => { const d = fakeDeps(); await applyConsent(d, "u1", "dismissed", "v1"); const patch = d.savePrefs.mock.calls[0][1]; expect(patch.prompted_at).toBeTruthy(); expect(patch.status).toBeUndefined(); });
});

describe("lookupIpCity", () => {
  it("returns null on non-200", async () => { expect(await lookupIpCity("41.1.1.1", "k", async () => new Response("", { status: 429 }))).toBeNull(); });
  it("returns null with no key", async () => { expect(await lookupIpCity("41.1.1.1", undefined)).toBeNull(); });
  it("reads city and country", async () => { const r = new Response(JSON.stringify({ location: { city: "Kumasi", country_code2: "GH" } })); expect(await lookupIpCity("41.1.1.1", "k", async () => r)).toEqual({ city: "Kumasi", countryCode: "GH" }); });
  it.each(["", "127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "172.31.9.9", "::1"])("skips private ip '%s' without fetching", async (ip) => { const f = vi.fn(); expect(await lookupIpCity(ip, "k", f as any)).toBeNull(); expect(f).not.toHaveBeenCalled(); });
  it("returns null when fetch throws", async () => { expect(await lookupIpCity("41.1.1.1", "k", async () => { throw new Error("x"); })).toBeNull(); });
  it("encodes key and ip in the documented URL", async () => { const f = vi.fn(async (_u: string) => new Response("{}", { status: 500 })); await lookupIpCity("41.1.1.1", "a b", f as any); expect(f.mock.calls[0][0]).toBe("https://api.ipgeolocation.io/v3/ipgeo?apiKey=a%20b&ip=41.1.1.1"); });
  it("returns null after 3 seconds", async () => { vi.useFakeTimers(); try { const p = lookupIpCity("41.1.1.1", "k", (() => new Promise(() => {})) as any); await vi.advanceTimersByTimeAsync(3100); expect(await p).toBeNull(); } finally { vi.useRealTimers(); } });
});
