import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "./gateway-security.ts";
import { smsLoginAllowed } from "./admin_sms_otp.ts";

/**
 * Decodes JWT token payload to read custom claims (e.g. aal, role)
 */
function getJwtClaims(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const jsonPayload = decodeURIComponent(
      atob(padded)
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

/**
 * True when the user has 2FA turned on but this session has not completed it.
 * Call only after the token has been verified with auth.getUser.
 */
export function isSecondFactorMissing(user: any, token: string): boolean {
  const hasVerifiedFactor = (user?.factors || []).some((factor: any) => factor.status === "verified");
  return hasVerifiedFactor && getJwtClaims(token)?.aal !== "aal2";
}

export interface VerifyAdminResult {
  success: boolean;
  user?: any;
  error?: string;
  status?: number;
  /** How the admin passed the second factor. "sms" only when the caller allowed it. */
  secondFactor?: "authenticator" | "sms" | "service";
}

/**
 * Verifies that the request caller is an authenticated admin with MFA (aal2) active
 * and whitelisted IP address (if whitelisting is configured).
 */
export async function verifyAdmin(
  req: Request,
  supabaseAdmin: any,
  options: { checkMfa?: boolean; checkIp?: boolean; allowSms?: boolean } = {}
): Promise<VerifyAdminResult> {
  // allowSms: accept an approved admin's SMS login instead of the authenticator app. Only
  // functions that then block money/send/access actions for SMS logins may pass it
  // (see needsAuthenticatorApp in admin_sms_otp.ts). Default: authenticator app required.
  const { checkMfa = true, checkIp = false, allowSms = false } = options;

  // 1. Extract Authorization or x-user-access-token
  const authHeader = req.headers.get("Authorization");
  const userToken = req.headers.get("x-user-access-token");
  const token = userToken || authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return { success: false, error: "Unauthorized: Missing authentication token", status: 401 };
  }

  try {
    const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    const claims = getJwtClaims(token);

    // Cryptographic security enforcement:
    // 1. Direct match against SUPABASE_SERVICE_ROLE_KEY env var (e.g. sb_secret_... or JWT)
    // 2. Or if token is a JWT with role === "service_role", verify it cryptographically against Supabase PostgREST
    //    (which validates the HMAC-SHA256 JWT signature against the project JWT secret).
    let secondFactor: "authenticator" | "sms" | undefined;
    let isServiceRole = !!(serviceRoleKey && timingSafeEqual(token.trim(), serviceRoleKey));
    if (!isServiceRole && claims?.role === "service_role") {
      const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
      if (supabaseUrl) {
        const verifyRes = await fetch(`${supabaseUrl}/rest/v1/system_secrets?limit=1`, {
          headers: {
            apikey: token.trim(),
            Authorization: `Bearer ${token.trim()}`,
          },
        });
        if (verifyRes.ok) {
          isServiceRole = true;
        }
      }
    }

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
        .select("role, allowed_ips, otp_login_approved, otp_phone")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .limit(1);

      if (rolesError || !roles || roles.length === 0) {
        return { success: false, error: "Forbidden: Admin privileges required", status: 403 };
      }

      const roleObj = roles[0];

      // 5. Enforce MFA (AAL2) OR Approved-Admin SMS OTP Session
      if (checkMfa) {
        const aal = claims?.aal;
        let hasAdminOtp = false;
        if (allowSms && aal !== "aal2" && smsLoginAllowed(roleObj) && claims?.session_id) {
          const { data: otpSess } = await supabaseAdmin
            .from("admin_otp_sessions")
            .select("id")
            .eq("user_id", user.id)
            .eq("session_id", String(claims.session_id))
            .not("verified_at", "is", null)
            .gt("expires_at", new Date().toISOString())
            .limit(1)
            .maybeSingle();
          hasAdminOtp = Boolean(otpSess?.id);
        }
        if (aal !== "aal2" && !hasAdminOtp) {
          return {
            success: false,
            error: allowSms
              ? "Forbidden: 2FA (authenticator app or approved admin SMS login) required for admin actions."
              : "Forbidden: this needs your authenticator app (2FA). An SMS login can't do it.",
            status: 403,
          };
        }
        secondFactor = aal === "aal2" ? "authenticator" : "sms";
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

    return { success: true, user, secondFactor: isServiceRole ? "service" : (checkMfa ? secondFactor : undefined) };
  } catch (e: any) {
    console.error("[auth] Error in verifyAdmin:", e);
    return { success: false, error: "Internal Server Error in authentication: " + e.message, status: 500 };
  }
}
