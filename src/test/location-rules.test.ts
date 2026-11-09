import { describe, it, expect } from "vitest";
import {
  distanceKm,
  isValidGhanaCoords,
  matchTownByCoords,
  matchTownByName,
  normalizeTownName,
  decideTownAction,
  type KnownTownRow,
} from "../../supabase/functions/_shared/location_rules";
import type { Town } from "../../supabase/functions/_shared/ghana_towns";

const accra: Town = { key: "accra", name: "Accra", lat: 5.556, lng: -0.197, aliases: [] };
const madina: Town = { key: "madina", name: "Madina", lat: 5.668, lng: -0.166, aliases: [] };
const kumasi: Town = { key: "kumasi", name: "Kumasi", lat: 6.688, lng: -1.624, aliases: [] };
const towns = [accra, madina, kumasi];

const row = (key: string, overrides: Partial<KnownTownRow> = {}): KnownTownRow => ({
  town_key: key,
  town_name: key,
  first_seen_on: "2026-11-01",
  last_seen_on: "2026-11-08",
  days_seen: 1,
  is_home: false,
  established_at: "2026-11-01T00:00:00Z",
  sms_sent_at: null,
  ...overrides,
});

describe("finding the town", () => {
  it("matches GPS within 20 km", () => expect(matchTownByCoords(5.6, -0.19, towns)?.key).toBe("accra"));
  it("ignores GPS further than 20 km from any town", () => expect(matchTownByCoords(8.5, -2.5, towns)).toBeNull());
  it("matches IP city case-insensitively in Ghana", () => expect(matchTownByName("KUMASI", "GH", towns)?.key).toBe("kumasi"));
  it("ignores a matching city outside Ghana", () => expect(matchTownByName("Kumasi", "NG", towns)).toBeNull());
  it("ignores unknown cities", () => expect(matchTownByName("Atlantis", "GH", towns)).toBeNull());
  it("matches aliases", () =>
    expect(
      matchTownByName("Bolga", "GH", [{ key: "bolgatanga", name: "Bolgatanga", lat: 10.78, lng: -0.85, aliases: ["Bolga"] }])?.key,
    ).toBe("bolgatanga"));
  it.each([[undefined, 1], ["abc", -1], [NaN, -1], [999, -1], [5.6, 200], [40.7, -74]])("rejects bad coords %s,%s", (a, b) =>
    expect(isValidGhanaCoords(a, b)).toBe(false));
  it("accepts Ghana coords", () => expect(isValidGhanaCoords(5.6, -0.19)).toBe(true));
  it("normalises names", () => expect(normalizeTownName("  Tamalé-North  ")).toBe("tamale north"));
  it("computes distance", () => expect(distanceKm(accra, madina)).toBeGreaterThan(10));
});

describe("decideTownAction", () => {
  const act = (town: Town, source: "gps" | "ip", known: KnownTownRow[]) =>
    decideTownAction({ town, source, today: "2026-11-09", known, towns });
  it("rule 1: no established town sets home", () => expect(act(accra, "ip", []).action).toBe("set_home"));
  it("rule 2: established town only updates", () => expect(act(accra, "gps", [row("accra")]).action).toBe("update_seen"));
  it("rule 3: within 30 km establishes without SMS", () => expect(act(madina, "gps", [row("accra")]).action).toBe("establish_nearby"));
  it("rule 4: first IP day keeps tracking", () => expect(act(kumasi, "ip", [row("accra")])).toEqual({ action: "keep_tracking", daysSeen: 1 }));
  it("rule 4: second reading on the same day still tracks", () =>
    expect(act(kumasi, "ip", [row("accra"), row("kumasi", { established_at: null, last_seen_on: "2026-11-09", days_seen: 1 })])).toEqual({ action: "keep_tracking", daysSeen: 1 }));
  it("second separate IP day claims", () =>
    expect(act(kumasi, "ip", [row("accra"), row("kumasi", { established_at: null, last_seen_on: "2026-11-08", days_seen: 1 })])).toEqual({ action: "claim", daysSeen: 2 }));
  it("GPS claims on first sighting", () => expect(act(kumasi, "gps", [row("accra")]).action).toBe("claim"));
  it("an unconfirmed town does not count as nearby or as home", () =>
    expect(act(kumasi, "ip", [row("kumasi2", { established_at: null })]).action).toBe("set_home"));
});
