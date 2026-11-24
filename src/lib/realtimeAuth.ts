/**
 * supabase-js only passes a new token to realtime on SIGNED_IN / TOKEN_REFRESHED. After the
 * 2FA code is entered (MFA_CHALLENGE_VERIFIED) live feeds would keep the password-only token,
 * and admin-only tables (is_admin()/has_role() now require 2FA) would stop sending updates.
 */
export function syncRealtimeTokenAfterMfa(
  event: string,
  session: { access_token: string } | null,
  realtime: { setAuth: (token?: string) => unknown },
): void {
  if (event === "MFA_CHALLENGE_VERIFIED" && session?.access_token) {
    void realtime.setAuth(session.access_token);
  }
}
