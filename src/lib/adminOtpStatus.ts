import { supabase } from "@/integrations/supabase/client";

export interface AdminOtpStatusData {
  success: boolean;
  eligible: boolean;
  has_phone: boolean;
  masked_phone: string | null;
  has_valid_session: boolean;
  expires_at?: string | null;
  cooldown_seconds?: number;
  daily_limit_reached?: boolean;
  codes_remaining_today?: number;
  has_pending_code?: boolean;
}

const CACHE_TTL_MS = 5_000;

let inFlightUserId: string | null = null;
let inFlightPromise: Promise<AdminOtpStatusData | null> | null = null;
let cachedResult: { userId: string; data: AdminOtpStatusData; fetchedAt: number } | null = null;

export function clearAdminOtpStatusCache(userId?: string) {
  if (!userId || cachedResult?.userId === userId) {
    cachedResult = null;
  }
  if (!userId || inFlightUserId === userId) {
    inFlightUserId = null;
    inFlightPromise = null;
  }
}

/**
 * Deduplicates concurrent `admin-otp-auth` status checks across `useAuth` and `VerifyMfa`
 * and briefly caches the response so page mounts/refreshes never fire duplicate requests.
 */
export async function fetchAdminOtpStatus(
  userId: string,
  options?: { force?: boolean }
): Promise<AdminOtpStatusData | null> {
  if (!userId || !supabase.functions?.invoke) return null;

  const force = options?.force === true;
  if (
    !force &&
    cachedResult &&
    cachedResult.userId === userId &&
    Date.now() - cachedResult.fetchedAt < CACHE_TTL_MS
  ) {
    return cachedResult.data;
  }

  if (!force && inFlightPromise && inFlightUserId === userId) {
    return inFlightPromise;
  }

  const promise = (async (): Promise<AdminOtpStatusData | null> => {
    try {
      const { data, error } = await supabase.functions.invoke("admin-otp-auth", {
        body: { action: "status" },
      });
      if (error || !data?.success) {
        return null;
      }
      const parsed = data as AdminOtpStatusData;
      cachedResult = { userId, data: parsed, fetchedAt: Date.now() };
      return parsed;
    } catch {
      return null;
    } finally {
      if (inFlightPromise === promise) {
        inFlightPromise = null;
        inFlightUserId = null;
      }
    }
  })();

  inFlightUserId = userId;
  inFlightPromise = promise;
  return promise;
}
