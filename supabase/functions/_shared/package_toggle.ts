// Out-of-stock switch for bundles (system-payout-v1 toggle_package_availability).
// Open to admins signed in by SMS (everyday work), so it is kept narrow:
//   - it only updates bundles already in the price list (never creates a price-less entry)
//   - it never reads or writes a price column
//   - every switch is recorded in audit_logs with how the admin signed in
//   - an SMS sign-in flipping more than a handful at once texts the other admins
// Pure: the database and the admin alert are passed in, so it is unit-tested.

export const SMS_TOGGLE_ALERT_THRESHOLD = 5;
const MAX_PACKAGES = 200;

export type ToggleDeps = {
  now: Date;
  alertOtherAdmins: (exceptUserId: string, text: string) => Promise<void>;
};

type Res = { status: number; body: Record<string, unknown> };
type Change = { network: string; package_size: string; is_unavailable: boolean };

export async function togglePackageAvailability(
  db: any,
  input: { adminId: string; via: "sms" | "authenticator"; packages: unknown },
  deps: ToggleDeps,
): Promise<Res> {
  if (!Array.isArray(input.packages) || input.packages.length === 0) {
    return { status: 400, body: { error: "packages array is required" } };
  }
  if (input.packages.length > MAX_PACKAGES) {
    return { status: 400, body: { error: `At most ${MAX_PACKAGES} bundles at a time` } };
  }

  const wanted = new Map<string, Change>();
  for (const p of input.packages as any[]) {
    const network = String(p?.network || "").trim();
    const package_size = String(p?.package_size || "").trim();
    if (!network || !package_size) continue;
    wanted.set(`${network}::${package_size}`, { network, package_size, is_unavailable: Boolean(p?.is_unavailable) });
  }

  const changes: Change[] = [];
  const skipped: string[] = [];
  const updatedAt = deps.now.toISOString();
  for (const w of wanted.values()) {
    const { data, error } = await db
      .from("global_package_settings")
      .update({ is_unavailable: w.is_unavailable, updated_at: updatedAt })
      .eq("network", w.network)
      .eq("package_size", w.package_size)
      .select("network, package_size");
    if (error) {
      return { status: 500, body: { error: error.message || "Could not update bundle", saved: changes.length } };
    }
    if (!data || data.length === 0) skipped.push(`${w.network} ${w.package_size}`);
    else changes.push(w);
  }

  if (changes.length > 0) {
    await db.from("audit_logs").insert({
      admin_id: input.adminId,
      action: "package_availability_toggled",
      details: { via: input.via, changes, skipped },
    });
  }

  if (input.via === "sms" && changes.length > SMS_TOGGLE_ALERT_THRESHOLD) {
    const off = changes.filter((c) => c.is_unavailable).length;
    const on = changes.length - off;
    await deps.alertOtherAdmins(
      input.adminId,
      `An admin signed in by SMS switched ${off} bundle(s) off and ${on} on at ${updatedAt.slice(11, 16)} UTC. If this wasn't expected, check Admin > Packages and switch off their SMS login.`,
    ).catch(() => {});
  }

  return { status: 200, body: { success: true, saved: changes.length, skipped } };
}
