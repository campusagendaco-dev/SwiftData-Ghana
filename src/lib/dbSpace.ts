// Helpers for the admin Database Space page.

export type DbSpaceTable = {
  target: string;
  label: string;
  keep_days: number;
  rule: string;
  total_bytes: number;
  approx_rows: number;
};

export type DbCleanupRun = {
  started_at: string;
  finished_at: string | null;
  source: "nightly" | "manual";
  deleted: Record<string, number>;
  more_remaining: boolean;
};

export type DbSpace = {
  database_bytes: number;
  tables: DbSpaceTable[];
  last_run: DbCleanupRun | null;
};

export type DbCleanupResult = { deleted: Record<string, number>; more_remaining: boolean };

/** Sizes in the same style as Supabase's report: "1018 MB", "2.55 GB", "7.9 MB", "512 kB". */
export function formatBytes(bytes: number): string {
  const kb = bytes / 1024;
  const mb = kb / 1024;
  const gb = mb / 1024;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  if (mb >= 100) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(kb)} kB`;
}

export function addDeleted(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [key, n] of Object.entries(b)) out[key] = (out[key] ?? 0) + Number(n || 0);
  return out;
}

export const sumDeleted = (d: Record<string, number> | null | undefined): number =>
  Object.values(d ?? {}).reduce((s, n) => s + Number(n || 0), 0);

/** Hands freed space back to disk. Must run outside a function, so it's a one-time manual paste. */
export const COMPACT_SQL = [
  "VACUUM FULL cron.job_run_details;",
  "VACUUM FULL public.system_logs;",
  "VACUUM FULL public.user_notifications;",
  "VACUUM FULL public.sms_logs;",
  "VACUUM FULL public.security_logs;",
  "VACUUM FULL public.push_notification_logs;",
].join("\n");
