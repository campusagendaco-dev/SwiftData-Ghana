import { supabase } from "@/integrations/supabase/client";

export const LOCATION_CONSENT_VERSION = "v1";

const CHECK_KEY = "sd_location_checked_on";

export type LatLng = { lat: number; lng: number };

const today = () => new Date().toISOString().slice(0, 10);
const keyFor = (userId: string) => `${CHECK_KEY}:${userId}`;

export function hasCheckedToday(userId: string): boolean {
  try {
    return localStorage.getItem(keyFor(userId)) === today();
  } catch {
    return false;
  }
}

export function markCheckedToday(userId: string): void {
  try {
    localStorage.setItem(keyFor(userId), today());
  } catch {
    /* storage unavailable: the server limit still applies */
  }
}

function readPosition(options: PositionOptions): Promise<LatLng | null> {
  return new Promise((resolve) => {
    try {
      if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        options,
      );
    } catch {
      resolve(null);
    }
  });
}

/** Returns a position only if the browser already granted permission. Never prompts. */
export async function getGrantedPosition(): Promise<LatLng | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return null;
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    if (status.state !== "granted") return null;
    return await readPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
  } catch {
    return null;
  }
}

/** Triggers the browser permission prompt. Call only from a user tap. */
export function requestPosition(): Promise<LatLng | null> {
  return readPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
}

/** Calls the location-check endpoint. Returns null on any error and never throws. */
export async function callLocationCheck<T>(body: Record<string, unknown>): Promise<T | null> {
  try {
    const { data, error } = await supabase.functions.invoke("location-check", { body });
    if (error) return null;
    return (data ?? null) as T | null;
  } catch {
    return null;
  }
}
