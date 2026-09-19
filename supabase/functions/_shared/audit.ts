import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuditLogOptions {
  adminId: string;
  action: string;
  targetUserId?: string | null;
  details?: Record<string, any>;
  ipAddress?: string | null;
}

export interface SecurityEventOptions {
  userId?: string | null;
  eventType: string;
  severity: "info" | "warning" | "critical";
  details?: Record<string, any>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Logs an administrative audit event to audit_logs table.
 */
export async function logAdminAudit(
  supabaseAdmin: SupabaseClient,
  options: AuditLogOptions
): Promise<void> {
  try {
    const { adminId, action, targetUserId, details, ipAddress } = options;
    const payload = {
      admin_id: adminId,
      action,
      details: {
        ...(details || {}),
        ...(targetUserId ? { target_user_id: targetUserId } : {}),
        ...(ipAddress ? { ip_address: ipAddress } : {}),
      },
      created_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin.from("audit_logs").insert(payload);
    if (error) {
      console.warn("[audit] Failed to write audit_log entry:", error.message);
    }
  } catch (err: any) {
    console.error("[audit] Unexpected error in logAdminAudit:", err?.message || err);
  }
}

/**
 * Logs a security event or anomaly to security_logs table.
 */
export async function logSecurityEvent(
  supabaseAdmin: SupabaseClient,
  options: SecurityEventOptions
): Promise<void> {
  try {
    const { userId, eventType, severity, details, ipAddress, userAgent } = options;
    const payload = {
      user_id: userId || null,
      event_type: eventType,
      severity: severity || "info",
      details: {
        ...(details || {}),
        ...(ipAddress ? { ip_address: ipAddress } : {}),
        ...(userAgent ? { user_agent: userAgent } : {}),
      },
      created_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin.from("security_logs").insert(payload);
    if (error) {
      console.warn("[audit] Failed to write security_log entry:", error.message);
    }
  } catch (err: any) {
    console.error("[audit] Unexpected error in logSecurityEvent:", err?.message || err);
  }
}
