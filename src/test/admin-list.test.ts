import { describe, expect, it } from "vitest";
import { listAdminsWith2fa, mfaStatusFromUser } from "../../supabase/functions/_shared/admin_list";

// Fake service-role client: just enough of supabase-js for the admin list.
function fakeAdmin() {
  const tables: Record<string, unknown[]> = {
    user_roles: [
      { user_id: "A", role: "admin", allowed_ips: null, otp_login_approved: true, otp_phone: "233241112222" },
      { user_id: "B", role: "admin", allowed_ips: ["1.2.3.4"] },
      { user_id: "C", role: "admin", allowed_ips: null },
    ],
    profiles: [
      { user_id: "A", email: "a@x.com", full_name: "Ama", last_seen_at: "2026-11-24T08:00:00Z" },
      { user_id: "B", email: "b@x.com", full_name: "Kofi", last_seen_at: null },
      { user_id: "C", email: "", full_name: "Esi", last_seen_at: null },
    ],
  };
  const query = (rows: unknown[]) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      in: () => q,
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    return q;
  };
  const users: Record<string, unknown> = {
    A: { data: { user: { id: "A", email: "a@x.com", last_sign_in_at: "2026-11-24T09:00:00Z", factors: [{ status: "verified" }] } }, error: null },
    B: { data: { user: { id: "B", email: "b@x.com", last_sign_in_at: "2026-11-20T09:00:00Z", factors: [{ status: "unverified" }] } }, error: null },
    C: { data: { user: null }, error: new Error("x") },
  };
  return {
    from: (t: string) => query(tables[t] ?? []),
    auth: { admin: { getUserById: async (id: string) => users[id] } },
  };
}

describe("admin list 2FA status", () => {
  it("mfaStatusFromUser reads verified, none and unknown", () => {
    expect(mfaStatusFromUser({ factors: [{ status: "verified" }] }, false)).toBe("verified");
    expect(mfaStatusFromUser({}, false)).toBe("none");
    expect(mfaStatusFromUser(null, true)).toBe("unknown");
  });

  it("unverified factors count as none", async () => {
    const rows = await listAdminsWith2fa(fakeAdmin());
    expect(rows.find((r) => r.user_id === "B")?.mfa_status).toBe("none");
  });

  it("marks only the failed admin unknown", async () => {
    const rows = await listAdminsWith2fa(fakeAdmin());
    expect(rows).toHaveLength(3);
    const a = rows.find((r) => r.user_id === "A")!;
    const c = rows.find((r) => r.user_id === "C")!;
    expect(c.mfa_status).toBe("unknown");
    expect(c.last_sign_in_at).toBeNull();
    expect(a.mfa_status).toBe("verified");
    expect(a.last_sign_in_at).toBe("2026-11-24T09:00:00Z");
    expect(a).toMatchObject({ email: "a@x.com", full_name: "Ama", last_seen_at: "2026-11-24T08:00:00Z" });
  });

  it("keeps is_mfa_verified for older pages", async () => {
    const rows = await listAdminsWith2fa(fakeAdmin());
    const byId = Object.fromEntries(rows.map((r) => [r.user_id, r.is_mfa_verified]));
    expect(byId).toEqual({ A: true, B: false, C: false });
  });

  it("shows who has SMS login on, with the pinned phone masked", async () => {
    const rows = await listAdminsWith2fa(fakeAdmin());
    expect(rows.find((r) => r.user_id === "A")).toMatchObject({ sms_login: true, sms_phone_masked: "024****222" });
    expect(rows.find((r) => r.user_id === "B")).toMatchObject({ sms_login: false, sms_phone_masked: null });
  });
});
