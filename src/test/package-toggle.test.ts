import { describe, expect, it, vi } from "vitest";
import { SMS_TOGGLE_ALERT_THRESHOLD, togglePackageAvailability } from "../../supabase/functions/_shared/package_toggle";
import { fakeDb } from "./helpers/fakeDb";

const NOW = new Date("2026-11-25T08:00:00Z");
const deps = () => ({ now: NOW, alertOtherAdmins: vi.fn(async () => {}) });
const row = (network: string, package_size: string, extra: Record<string, unknown> = {}) =>
  ({ network, package_size, agent_price: 100, public_price: 110, is_unavailable: false, ...extra });
const seed = (rows = [row("MTN", "25GB"), row("MTN", "30GB")]) => fakeDb({ global_package_settings: rows, audit_logs: [] });

describe("switching bundles on and off", () => {
  it("only changes bundles already in the price list, and never touches prices", async () => {
    const db = seed();
    const res = await togglePackageAvailability(db, { adminId: "a1", via: "authenticator", packages: [
      { network: "MTN", package_size: "25GB", is_unavailable: true, agent_price: 0.1 },
    ] }, deps());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, saved: 1, skipped: [] });
    expect(db.tables.global_package_settings[0]).toMatchObject({ is_unavailable: true, agent_price: 100, public_price: 110 });
    expect(db.writes.filter((w) => w.table === "global_package_settings").every((w) => w.op === "update")).toBe(true);
  });

  it("does not create a price-less entry for a bundle that isn't in the price list", async () => {
    const db = seed();
    const res = await togglePackageAvailability(db, { adminId: "a1", via: "sms", packages: [
      { network: "MTN", package_size: "99GB", is_unavailable: false },
    ] }, deps());
    expect(res.body).toMatchObject({ success: true, saved: 0, skipped: ["MTN 99GB"] });
    expect(db.tables.global_package_settings).toHaveLength(2);
    expect(db.writes.some((w) => w.op === "insert" || w.op === "upsert")).toBe(false);
  });

  it("records who switched what, and how they signed in", async () => {
    const db = seed();
    await togglePackageAvailability(db, { adminId: "a1", via: "sms", packages: [
      { network: "MTN", package_size: "25GB", is_unavailable: true },
      { network: "MTN", package_size: "30GB", is_unavailable: false },
    ] }, deps());
    const log = db.writes.find((w) => w.table === "audit_logs");
    expect(log?.values).toMatchObject({
      admin_id: "a1",
      action: "package_availability_toggled",
      details: { via: "sms", changes: [
        { network: "MTN", package_size: "25GB", is_unavailable: true },
        { network: "MTN", package_size: "30GB", is_unavailable: false },
      ] },
    });
  });

  it("texts the other admins when an SMS sign-in switches more than a handful at once", async () => {
    const rows = Array.from({ length: SMS_TOGGLE_ALERT_THRESHOLD + 1 }, (_, i) => row("MTN", `${i + 1}GB`));
    const packages = rows.map((r) => ({ network: r.network, package_size: r.package_size, is_unavailable: true }));
    const d = deps();
    await togglePackageAvailability(seed(rows), { adminId: "a1", via: "sms", packages }, d);
    expect(d.alertOtherAdmins).toHaveBeenCalledWith("a1", expect.stringContaining(`${SMS_TOGGLE_ALERT_THRESHOLD + 1} bundle(s) off`));

    const quiet = deps();
    await togglePackageAvailability(seed(rows), { adminId: "a1", via: "sms", packages: packages.slice(0, SMS_TOGGLE_ALERT_THRESHOLD) }, quiet);
    await togglePackageAvailability(seed(rows), { adminId: "a1", via: "authenticator", packages }, quiet);
    expect(quiet.alertOtherAdmins).not.toHaveBeenCalled();
  });

  it("refuses an empty request", async () => {
    expect((await togglePackageAvailability(seed(), { adminId: "a1", via: "sms", packages: [] }, deps())).status).toBe(400);
  });
});

describe("the payout function uses these rules", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  it("toggle_package_availability goes through togglePackageAvailability, with the sign-in method", () => {
    const src = readFileSync(join(__dirname, "../../supabase/functions/system-payout-v1/index.ts"), "utf8");
    const body = src.slice(src.indexOf('case "toggle_package_availability"'), src.indexOf('case "reset_user_mfa"'));
    expect(body).toMatch(/togglePackageAvailability\(supabaseAdmin/);
    expect(body).toMatch(/authResult\.secondFactor === "sms"/);
    expect(body).not.toMatch(/upsert\(/);
  });
});
