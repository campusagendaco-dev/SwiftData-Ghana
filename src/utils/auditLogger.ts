import { supabase } from "@/integrations/supabase/client";

/**
 * Logs an administrative action to the audit_logs table.
 * Supports both signatures:
 * 1. logAudit(adminId, action, details)
 * 2. logAudit({ action, targetId, details }) or logAudit(action, details)
 */
export const logAudit = async (adminIdOrObj: any, action?: string, details?: any) => {
  try {
    let finalAdminId: string | null = null;
    let finalAction = "";
    let finalDetails: any = {};

    if (typeof adminIdOrObj === "object" && adminIdOrObj !== null) {
      finalAction = adminIdOrObj.action || "";
      finalDetails = adminIdOrObj.details || adminIdOrObj;
      finalAdminId = adminIdOrObj.adminId || adminIdOrObj.admin_id || null;
    } else if (typeof adminIdOrObj === "string" && typeof action === "string") {
      finalAdminId = adminIdOrObj;
      finalAction = action;
      finalDetails = details || {};
    } else if (typeof adminIdOrObj === "string") {
      finalAction = adminIdOrObj;
      finalDetails = action || {};
    }

    // Resolve authenticated user ID if missing
    if (!finalAdminId) {
      const { data } = await supabase.auth.getUser();
      finalAdminId = data?.user?.id || null;
    }

    if (!finalAdminId) {
      console.warn("Audit log skipped: No authenticated admin ID.");
      return;
    }

    const { error } = await supabase.from("audit_logs").insert({
      admin_id: finalAdminId,
      action: finalAction,
      details: finalDetails,
    });

    if (error) {
      console.error("Audit log failed:", error);
    }
  } catch (err) {
    console.error("Audit log error:", err);
  }
};
