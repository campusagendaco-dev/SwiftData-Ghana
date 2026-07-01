import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Decodes JWT token payload to read custom claims (e.g. aal, role)
 */
function getJwtClaims(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error("[auth] Failed to decode JWT claims:", e);
    return null;
  }
}

export interface VerifyAdminResult {
  success: boolean;
  user?: any;
  error?: string;
  status?: number;
}

/**
 * Verifies that the request caller is an authenticated admin with MFA (aal2) active
 * and whitelisted IP address (if whitelisting is configured).
 */
export async function verifyAdmin(
  req: Request,
  supabaseAdmin: any,
  options: { checkMfa?: boolean; checkIp?: boolean } = {}
): Promise<VerifyAdminResult> {
  const { checkMfa = true, checkIp = true } = options;

  // 1. Extract Authorization or x-user-access-token
  const authHeader = req.headers.get("Authorization");
  const userToken = req.headers.get("x-user-access-token");
  const token = userToken || authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return { success: false, error: "Unauthorized: Missing authentication token", status: 401 };
  }

  try {
    const claims = getJwtClaims(token);
    const isServiceRole = claims && claims.role === "service_role";

    let user;
    if (isServiceRole) {
      user = { id: "00000000-0000-0000-0000-000000000000", email: "service-role@supabase.local" };
    } else {
      const { data: { user: authUser }, error: userError } = await supabaseAdmin.auth.getUser(token);
      if (userError || !authUser) {
        return { success: false, error: "Unauthorized: Invalid session token", status: 401 };
      }
      user = authUser;
    }

    // 4. Validate Admin role (unless bypass via service role)
    if (!isServiceRole) {
      const { data: roles, error: rolesError } = await supabaseAdmin
        .from("user_roles")
        .select("role, allowed_ips")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .limit(1);

      if (rolesError || !roles || roles.length === 0) {
        return { success: false, error: "Forbidden: Admin privileges required", status: 403 };
      }

      const roleObj = roles[0];

      // 5. Enforce MFA (AAL2)
      if (checkMfa) {
        const aal = claims?.aal;
        if (aal !== "aal2") {
          return {
            success: false,
            error: "Forbidden: Multi-Factor Authentication (MFA) required for admin actions.",
            status: 403,
          };
        }
      }

      // 6. Enforce IP Whitelisting
      if (checkIp && roleObj.allowed_ips && roleObj.allowed_ips.length > 0) {
        const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
                      || req.headers.get("x-real-ip") 
                      || "0.0.0.0";
        if (!roleObj.allowed_ips.includes(clientIp)) {
          return {
            success: false,
            error: `Forbidden: IP address ${clientIp} is not authorized for administrative access.`,
            status: 403,
          };
        }
      }
    }

    return { success: true, user };
  } catch (e: any) {
    console.error("[auth] Error in verifyAdmin:", e);
    return { success: false, error: "Internal Server Error in authentication: " + e.message, status: 500 };
  }
}
