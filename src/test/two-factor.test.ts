import { beforeAll, describe, expect, it } from "vitest";
import { computeMfaStatus } from "@/lib/mfaStatus";

beforeAll(() => {
  (globalThis as any).Deno = { env: { get: () => "" } };
});

const tokenWith = (aal: string) => {
  const part = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${part({ alg: "HS256" })}.${part({ sub: "admin-1", aal })}.signature`;
};

const adminClient = (isAdmin = true) => ({
  auth: { getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }) },
  from: () => ({
    select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: isAdmin ? [{ role: "admin" }] : [], error: null }) }) }) }),
  }),
});

const requestWith = (token: string) => new Request("https://x.test", { headers: { Authorization: `Bearer ${token}` } });

describe("verifyAdmin", () => {
  const check = async (aal: string, options?: { checkMfa?: boolean }) => {
    const { verifyAdmin } = await import("../../supabase/functions/_shared/auth");
    return verifyAdmin(requestWith(tokenWith(aal)), adminClient(), options);
  };

  it("refuses an admin who has not completed 2FA by default", async () => {
    expect(await check("aal1")).toMatchObject({ success: false, status: 403 });
  });

  it("accepts an admin who completed 2FA", async () => {
    expect((await check("aal2")).success).toBe(true);
  });

  it("still refuses a non-admin who completed 2FA", async () => {
    const { verifyAdmin } = await import("../../supabase/functions/_shared/auth");
    expect(await verifyAdmin(requestWith(tokenWith("aal2")), adminClient(false))).toMatchObject({ success: false, status: 403 });
  });
});

describe("isSecondFactorMissing", () => {
  const withFactor = { factors: [{ status: "verified" }] };

  const missing = async (user: object, aal: string) => {
    const { isSecondFactorMissing } = await import("../../supabase/functions/_shared/auth");
    return isSecondFactorMissing(user, tokenWith(aal));
  };

  it("blocks a user with 2FA who only entered a password", async () => {
    expect(await missing(withFactor, "aal1")).toBe(true);
  });

  it("allows a user who completed 2FA", async () => {
    expect(await missing(withFactor, "aal2")).toBe(false);
  });

  it("allows users who have not turned 2FA on", async () => {
    expect(await missing({}, "aal1")).toBe(false);
    expect(await missing({ factors: [{ status: "unverified" }] }, "aal1")).toBe(false);
  });

  it("blocks when the token cannot be read", async () => {
    const { isSecondFactorMissing } = await import("../../supabase/functions/_shared/auth");
    expect(isSecondFactorMissing(withFactor, "not-a-token")).toBe(true);
  });
});

describe("computeMfaStatus", () => {
  const verified = [{ status: "verified" }];

  it("challenges a user with 2FA who has only entered a password", () => {
    expect(computeMfaStatus({ currentLevel: "aal1", nextLevel: "aal2" }, verified)).toEqual({ enabled: true, challenged: true });
  });

  it("does not challenge after the code is entered", () => {
    expect(computeMfaStatus({ currentLevel: "aal2", nextLevel: "aal2" }, verified)).toEqual({ enabled: true, challenged: false });
  });

  it("does not challenge a user without 2FA", () => {
    expect(computeMfaStatus({ currentLevel: "aal1", nextLevel: "aal1" }, [])).toEqual({ enabled: false, challenged: false });
  });

  it("still challenges when the factor list fails to load", () => {
    expect(computeMfaStatus({ currentLevel: "aal1", nextLevel: "aal2" }, null)).toEqual({ enabled: true, challenged: true });
  });

  it("ignores an unfinished 2FA setup", () => {
    expect(computeMfaStatus({ currentLevel: "aal1", nextLevel: "aal2" }, [{ status: "unverified" }])).toEqual({ enabled: false, challenged: false });
  });
});
