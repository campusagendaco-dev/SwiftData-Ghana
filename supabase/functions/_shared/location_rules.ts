// Pure new-town decision rules. No runtime imports so it runs in Vitest and Deno.
// Spec rules 5 and 6 (SMS cooldown, daily platform limit) are enforced by the
// claim_location_sms database function, so "claim" is returned where they apply.
import type { Town } from "./ghana_towns.ts";

export interface KnownTownRow {
  town_key: string;
  town_name: string;
  first_seen_on: string;
  last_seen_on: string;
  days_seen: number;
  is_home: boolean;
  established_at: string | null;
  sms_sent_at: string | null;
}

export type TownAction = "set_home" | "update_seen" | "establish_nearby" | "keep_tracking" | "claim";

const GPS_MATCH_KM = 20;
const NEARBY_KM = 30;
const MIN_IP_DAYS = 2;

export function normalizeTownName(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidGhanaCoords(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= 4.5 && lat <= 11.5 && lng >= -3.5 && lng <= 1.5
  );
}

export function matchTownByCoords(lat: number, lng: number, towns: Town[]): Town | null {
  if (!isValidGhanaCoords(lat, lng)) return null;
  let best: Town | null = null;
  let bestKm = Infinity;
  for (const t of towns) {
    const km = distanceKm({ lat, lng }, t);
    if (km < bestKm) { best = t; bestKm = km; }
  }
  return best && bestKm <= GPS_MATCH_KM ? best : null;
}

export function matchTownByName(city: string, countryCode: string, towns: Town[]): Town | null {
  if (String(countryCode ?? "").toUpperCase() !== "GH") return null;
  const n = normalizeTownName(city);
  if (!n) return null;
  return towns.find((t) => normalizeTownName(t.name) === n || t.key === n || t.aliases.some((a) => normalizeTownName(a) === n)) ?? null;
}

export function decideTownAction(a: {
  town: Town;
  source: "gps" | "ip";
  today: string;
  known: KnownTownRow[];
  towns: Town[];
}): { action: TownAction; daysSeen: number } {
  const { town, source, today, known, towns } = a;
  const existing = known.find((r) => r.town_key === town.key);
  const daysSeen = existing ? existing.days_seen + (existing.last_seen_on !== today ? 1 : 0) : 1;
  const established = known.filter((r) => r.established_at !== null);

  if (established.length === 0) return { action: "set_home", daysSeen };
  if (existing && existing.established_at !== null) return { action: "update_seen", daysSeen };

  const nearEstablished = established.some((r) => {
    const t = towns.find((x) => x.key === r.town_key);
    return t ? distanceKm(town, t) <= NEARBY_KM : false;
  });
  if (nearEstablished) return { action: "establish_nearby", daysSeen };

  if (source === "ip" && daysSeen < MIN_IP_DAYS) return { action: "keep_tracking", daysSeen };
  return { action: "claim", daysSeen };
}
