// Admin roster with each admin's real 2FA status, shared by system-payout-v1 and
// admin-user-actions (`get_admins`). No Deno imports, so Vitest can test it.
//
// The old code read the `user_mfa_status` view, which only returns the caller's own row;
// called with the service key it returned nothing, so every admin showed "NO 2FA".
// This reads each admin's auth record instead, which also gives the real last sign-in.

export type AdminMfaStatus = "verified" | "none" | "unknown";

export type AdminRow = {
  user_id: string;
  role: string;
  allowed_ips: string[] | null;
  email: string;
  full_name: string;
  last_seen_at: string | null;
  last_sign_in_at: string | null;
  mfa_status: AdminMfaStatus;
  /** Kept for pages loaded before this change. */
  is_mfa_verified: boolean;
};

/** "unknown" when the lookup failed — never report "none" for an admin we couldn't check. */
export function mfaStatusFromUser(
  user: { factors?: { status: string }[] } | null | undefined,
  failed: boolean,
): AdminMfaStatus {
  if (failed || !user) return "unknown";
  return (user.factors ?? []).some((f) => f.status === "verified") ? "verified" : "none";
}

// deno-lint-ignore no-explicit-any
export async function listAdminsWith2fa(supabaseAdmin: any): Promise<AdminRow[]> {
  const { data: admins, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role, allowed_ips")
    .eq("role", "admin");
  if (error) throw error;

  const ids: string[] = (admins ?? []).map((a: { user_id: string }) => a.user_id);
  if (ids.length === 0) return [];

  const [profilesRes, authUsers] = await Promise.all([
    supabaseAdmin.from("profiles").select("user_id, email, full_name, last_seen_at").in("user_id", ids),
    Promise.all(
      ids.map(async (id) => {
        try {
          const { data, error: authErr } = await supabaseAdmin.auth.admin.getUserById(id);
          return { user: data?.user ?? null, failed: !!authErr || !data?.user };
        } catch {
          return { user: null, failed: true };
        }
      }),
    ),
  ]);

  const profiles = Object.fromEntries(
    ((profilesRes?.data ?? []) as { user_id: string }[]).map((p) => [p.user_id, p]),
  ) as Record<string, { email?: string; full_name?: string; last_seen_at?: string | null }>;

  return (admins as { user_id: string; role: string; allowed_ips: string[] | null }[]).map((a, i) => {
    const profile = profiles[a.user_id] ?? {};
    const { user, failed } = authUsers[i];
    const mfa_status = mfaStatusFromUser(user, failed);
    return {
      user_id: a.user_id,
      role: a.role,
      allowed_ips: a.allowed_ips,
      email: profile.email || user?.email || "",
      full_name: profile.full_name || "",
      last_seen_at: profile.last_seen_at ?? null,
      last_sign_in_at: failed ? null : (user?.last_sign_in_at ?? null),
      mfa_status,
      is_mfa_verified: mfa_status === "verified",
    };
  });
}
