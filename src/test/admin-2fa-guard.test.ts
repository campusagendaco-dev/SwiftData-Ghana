import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Owner decision (2026-11-24, option B): an approved admin may sign in with an SMS code to
// view and do everyday work, but money, sends and admin-access actions still need the
// authenticator app (aal2). This guards that split.
const root = join(__dirname, "..", "..");
const fnDir = join(root, "supabase", "functions");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

const SMS_ALLOWED = ["system-payout-v1", "admin-user-actions", "admin-retry-autorouter", "ops-worker-ai"];

describe("admin SMS login stays limited", () => {
  it("verifyAdmin needs the authenticator app unless a function explicitly allows SMS", () => {
    const src = read("supabase", "functions", "_shared", "auth.ts");
    expect(src).toMatch(/allowSms\s*=\s*false/);
    expect(src).toMatch(/if \(allowSms && aal !== "aal2" && smsLoginAllowed\(roleObj\)/);
  });

  it(`only ${SMS_ALLOWED.join(" and ")} accept SMS logins, and both block sensitive actions for them`, () => {
    const allowing = readdirSync(fnDir).filter((d) => {
      const f = join(fnDir, d, "index.ts");
      return existsSync(f) && /allowSms:\s*true/.test(readFileSync(f, "utf8"));
    });
    expect(allowing.sort()).toEqual([...SMS_ALLOWED].sort());
    for (const fn of SMS_ALLOWED) {
      const src = readFileSync(join(fnDir, fn, "index.ts"), "utf8");
      expect(src, fn).toMatch(new RegExp(`authResult\\.secondFactor === "sms" && needsAuthenticatorApp\\("${fn}", action\\)`));
    }
  });

  it("switching SMS login on needs the authenticator app; for yourself, only your own verified phone", () => {
    const src = read("supabase", "functions", "_shared", "admin_sms_otp.ts");
    expect(src).toMatch(/adminSecondFactor !== "authenticator"/);
    expect(src).toMatch(/const self = input\.adminId === input\.targetUserId/);
    expect(src).toMatch(/self && input\.approved[\s\S]{0,400}phone_verified !== true/);
  });

  it("the database has an authenticator-only admin check for money and access changes", () => {
    const sql = read("supabase", "migrations", "20261124210000_admin_sms_login_hardening.sql");
    expect(sql).toMatch(/FUNCTION public\.admin_strong\(\)[\s\S]*?aal'?, ''\) = 'aal2'/);
    expect(sql).toMatch(/otp_login_approved SET DEFAULT false/);
  });
});
