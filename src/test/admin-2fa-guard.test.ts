import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Owner decision (2026-11-24): admin access needs the authenticator-app 2FA (aal2). An SMS
// code must never count instead, in the admin check every admin function uses, in the
// admin page guards, or in the database's is_admin()/has_role().
const root = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

/** The bodies of every is_admin()/has_role() definition in a SQL file. */
export function adminFunctionBodies(sql: string): string[] {
  return [...sql.matchAll(/FUNCTION\s+public\.(?:is_admin|has_role)\b[\s\S]*?AS\s+\$\$([\s\S]*?)\$\$/gi)].map((m) => m[1]);
}

describe("admin 2FA can't be replaced by an SMS code", () => {
  it("verifyAdmin requires aal2 and has no SMS-code way past it", () => {
    const src = read("supabase", "functions", "_shared", "auth.ts");
    expect(src).toMatch(/aal\s*!==\s*"aal2"/);
    expect(src).not.toMatch(/admin_otp_sessions|otp_login_approved|hasAdminOtp/);
  });

  it("the admin page guard has no SMS-code bypass", () => {
    expect(read("src", "App.tsx")).not.toMatch(/isAdminOtpVerified/);
    expect(read("src", "hooks", "useAuth.tsx")).not.toMatch(/isAdminOtpVerified/);
  });

  it("finds an SMS-session check inside is_admin() (self-check)", () => {
    const bad = "CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean AS $$ SELECT public.has_valid_admin_otp_session() OR admin_otp $$;";
    const ok = "CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean AS $$ SELECT true $$;\nDROP TABLE IF EXISTS public.admin_otp_sessions;";
    expect(adminFunctionBodies(bad).some((b) => /admin_otp|otp_session/i.test(b))).toBe(true);
    expect(adminFunctionBodies(ok).some((b) => /admin_otp|otp_session/i.test(b))).toBe(false);
  });

  it("no migration lets an SMS-code session count as admin", () => {
    const dir = join(root, "supabase", "migrations");
    const offenders = readdirSync(dir).filter((f) => adminFunctionBodies(readFileSync(join(dir, f), "utf8")).some((b) => /admin_otp|otp_session/i.test(b)));
    expect(offenders).toEqual([]);
  });
});
