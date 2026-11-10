// Location welcome SMS check flow. All I/O is injected so it runs in Vitest and Deno.
// GPS coordinates are used only to pick a town and are never logged or stored.
import { GHANA_TOWNS, type Town } from "./ghana_towns.ts";
import {
  decideTownAction,
  isValidGhanaCoords,
  matchTownByCoords,
  matchTownByName,
  type KnownTownRow,
} from "./location_rules.ts";

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
  // Contract: an upsert that must never overwrite sms_sent_at on an existing row and
  // must never replace a set established_at with null (a concurrent claim may have set them).
  saveTownRow(userId: string, row: KnownTownRow): Promise<void>;
  deleteTownRows(userId: string): Promise<void>;
  claimSms(userId: string, townKey: string, dailyLimit: number): Promise<ClaimResult>;
  releaseClaim(userId: string, townKey: string): Promise<void>;
  sendSms(phone: string, townName: string): Promise<"sent" | "no_template" | "failed">;
  now(): string;
}

type CheckResult = { needs_consent: boolean; outcome: string };
const done = (outcome: string, needs_consent = false): CheckResult => ({ needs_consent, outcome });

export async function runLocationCheck(
  deps: LocationDeps,
  input: { userId: string; ip: string | null; lat?: unknown; lng?: unknown; towns?: Town[] },
): Promise<CheckResult> {
  const { userId } = input;
  const towns = input.towns ?? GHANA_TOWNS;

  const settings = await deps.getSettings();
  if (settings.mode === "off") return done("off");

  if (await deps.isAdmin(userId)) return done("admin");

  const [prefs, profile] = await Promise.all([deps.getPrefs(userId), deps.getProfile(userId)]);
  const phone = deps.normalizePhone(profile?.phone);

  // Never asked: prompt only if they could actually be texted.
  if (!prefs || (!prefs.prompted_at && prefs.status === "unset")) {
    return phone ? done("needs_consent", true) : done("no_phone");
  }

  if (prefs.status !== "granted") return done("not_granted");
  if (profile?.sms_opt_out) return done("opted_out");
  if (!phone) return done("no_phone");
  const today = deps.today();
  if (prefs.last_check_on === today) return done("already_checked");

  await deps.savePrefs(userId, { last_check_on: today });

  // Find the town: valid GPS first, then IP.
  let town: Town | null = null;
  let source: "gps" | "ip" = "gps";
  const hasGps = isValidGhanaCoords(input.lat, input.lng);
  if (hasGps) {
    // A usable GPS position that matches no listed town is ignored; IP is not consulted.
    town = matchTownByCoords(input.lat as number, input.lng as number, towns);
  } else if (input.ip) {
    const hit = await deps.lookupIp(input.ip);
    if (hit) {
      town = matchTownByName(hit.city, hit.countryCode, towns);
      source = "ip";
    }
  }
  if (!town) return done("no_town");

  const known = await deps.getTownRows(userId);
  const { action, daysSeen } = decideTownAction({ town, source, today, known, towns });
  const existing = known.find((r) => r.town_key === town.key);
  const now = deps.now();
  const base: KnownTownRow = {
    town_key: town.key,
    town_name: town.name,
    first_seen_on: existing?.first_seen_on ?? today,
    last_seen_on: today,
    days_seen: daysSeen,
    is_home: existing?.is_home ?? false,
    established_at: existing?.established_at ?? null,
    sms_sent_at: existing?.sms_sent_at ?? null,
  };

  switch (action) {
    case "set_home":
      await deps.saveTownRow(userId, { ...base, is_home: true, established_at: now });
      return done("home_set");
    case "update_seen":
      await deps.saveTownRow(userId, base);
      return done("seen");
    case "establish_nearby":
      await deps.saveTownRow(userId, { ...base, established_at: now });
      return done("established_nearby");
    case "keep_tracking":
      await deps.saveTownRow(userId, base);
      return done("tracking");
    case "claim": {
      // The claim RPC needs the row to exist first.
      await deps.saveTownRow(userId, { ...base, established_at: null });
      const claim = await deps.claimSms(userId, town.key, settings.dailyLimit);
      if (claim === "limit_30d") {
        await deps.saveTownRow(userId, { ...base, established_at: now });
        return done("limit_30d");
      }
      if (claim !== "claimed") return done(claim);
      let result: "sent" | "no_template" | "failed";
      try {
        result = await deps.sendSms(phone, town.name);
      } catch {
        result = "failed";
      }
      if (result !== "sent") {
        await deps.releaseClaim(userId, town.key);
        return done(`send_${result}`);
      }
      return done("sent");
    }
  }
}

export async function applyConsent(
  deps: LocationDeps,
  userId: string,
  choice: "yes" | "no" | "dismissed",
  version: string,
): Promise<void> {
  const now = deps.now();
  if (choice === "dismissed") {
    await deps.savePrefs(userId, { prompted_at: now });
    return;
  }
  await deps.savePrefs(userId, {
    status: choice === "yes" ? "granted" : "declined",
    prompted_at: now,
    consent_at: now,
    consent_version: version,
  });
  if (choice === "no") {
    await deps.deleteTownRows(userId);
  }
}
