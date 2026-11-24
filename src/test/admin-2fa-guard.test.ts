import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Owner decision (2026-11-24): admin access requires either authenticator-app 2FA (aal2)
// OR an approved admin's verified, unexpired SMS OTP session (admin_otp_sessions).
const root = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

describe("admin second-factor enforcement", () => {
  it("verifyAdmin requires aal2 or an approved verified admin_otp_sessions record", () => {
    const src = read("supabase", "functions", "_shared", "auth.ts");
    expect(src).toMatch(/aal\s*!==\s*"aal2"/);
    expect(src).toMatch(/admin_otp_sessions/);
    expect(src).toMatch(/otp_login_approved/);
  });

  it("the admin page guard requires MFA or verified admin OTP", () => {
    const app = read("src", "App.tsx");
    expect(app).toMatch(/isMfaChallenged\s*&&\s*!isAdminOtpVerified/);
    expect(read("src", "hooks", "useAuth.tsx")).toMatch(/isAdminOtpVerified/);
  });
});
