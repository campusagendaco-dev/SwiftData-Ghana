// Shared fire-and-forget logger for edge functions
// Inserts into system_logs table — never awaited so it never blocks order processing

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  source: string;
  event: string;
  message: string;
  order_id?: string | null;
  agent_id?: string | null;
  provider_id?: string | null;
  data?: Record<string, unknown> | null;
  duration_ms?: number | null;
}

const SENSITIVE_KEYS = ["api_key", "apikey", "x-api-key", "authorization", "password", "secret", "token", "key"];

function maskSensitive(obj: unknown): unknown {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
      out[k] = "***";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = maskSensitive(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function log(supabaseAdmin: any, entry: LogEntry): void {
  const safeData = entry.data ? (maskSensitive(entry.data) as Record<string, unknown>) : null;

  // Fire and forget — do NOT await this call
  supabaseAdmin
    .from("system_logs")
    .insert({
      level: entry.level,
      source: entry.source,
      event: entry.event,
      message: entry.message,
      order_id: entry.order_id ?? null,
      agent_id: entry.agent_id ?? null,
      provider_id: entry.provider_id ?? null,
      data: safeData,
      duration_ms: entry.duration_ms ?? null,
    })
    .then(({ error }: { error: any }) => {
      if (error) console.error("[logger] insert failed:", error.message);
    });
}

interface AdminAlertEntry {
  title: string;
  message: string;
  type?: string;
  data?: Record<string, unknown> | null;
}

// Immediately in-app-notifies every admin, for a single incident that needs
// eyes on it right away (e.g. a confirmed money transfer whose completion
// record failed to save) — unlike cron-error-alert, this doesn't wait for a
// spike threshold or cooldown window. Fire-and-forget by design, same as log().
export function notifyAdmins(supabaseAdmin: any, entry: AdminAlertEntry): void {
  supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .then(({ data: admins, error: rolesErr }: { data: any; error: any }) => {
      if (rolesErr) {
        console.error("[notifyAdmins] failed to fetch admins:", rolesErr.message);
        return;
      }
      if (!admins?.length) return;
      const safeData = entry.data ? (maskSensitive(entry.data) as Record<string, unknown>) : null;
      const notifications = admins.map((a: any) => ({
        user_id: a.user_id,
        title: entry.title,
        message: entry.message,
        type: entry.type || "error",
        data: safeData,
      }));
      supabaseAdmin
        .from("user_notifications")
        .insert(notifications)
        .then(({ error }: { error: any }) => {
          if (error) console.error("[notifyAdmins] insert failed:", error.message);
        });
    });
}
