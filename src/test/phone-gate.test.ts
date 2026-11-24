import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The login gate must ask for a VERIFIED phone, not just any phone on the profile
// (signup could be done without the browser check).
describe("phone verification gate", () => {
  it("asks everyone without a server-verified phone to verify", () => {
    const src = readFileSync(join(__dirname, "..", "components", "SecurityGuard.tsx"), "utf8");
    const gate = /const needsPhoneVerification = Boolean\(([\s\S]*?)\);/.exec(src)?.[1] ?? "";
    expect(gate).toMatch(/!\s*\(profile as any\)\.phone_verified/);
    expect(gate).not.toMatch(/!String\(profile\.phone \|\| ""\)\.trim\(\)\s*$/);
  });
});
