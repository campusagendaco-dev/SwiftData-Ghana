import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Owner decision (2026-11-24): admin access needs the authenticator-app 2FA (aal2). An SMS
// code must never count instead, in the admin check every admin function uses, in the
// admin page guards, or in the database's is_admin()/has_role().
const root = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

describe("admin 2FA can't be replaced by an SMS code", () => {
  it("verifyAdmin requires aal2 and has no SMS-code way past it", () => {
    const src = read("supabase", "functions", "_shared", "auth.ts");
    expect(src).toMatch(/aal\s*!==\s*"aal2"/);
    expect(src).not.toMatch(/admin_otp_sessions|otp_login_approved|hasAdminOtp/);
  });

  it("the admin page guard has no SMS-code bypass", () => {
    const app = read("src", "App.tsx");
    expect(app).not.toMatch(/isAdminOtpVerified/);
    expect(read("src", "hooks", "useAuth.tsx")).not.toMatch(/isAdminOtpVerified/);
  });

  it("no migration lets an SMS-code session count as admin", () => {
    const dir = join(root, "supabase", "migrations");
    const offenders = readdirSync(dir).filter((f) => {
      const sql = readFileSync(join(dir, f), "utf8");
      return /FUNCTION\s+public\.(is_admin|has_role)\b/i.test(sql) && /admin_otp|otp_session/i.test(sql);
    });
    expect(offenders).toEqual([]);
  });
});
