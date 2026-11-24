import { supabase } from "@/integrations/supabase/client";

// The signup phone check is enforced on the server: the token from a verified code is handed
// back once the account exists and is signed in, and the server marks phone_verified. If this
// is missed (e.g. email confirmation first), the login gate asks to verify at first sign-in.
let pending: { phone: string; token: string } | null = null;

export function rememberPhoneToken(phone: string, token: string): void {
  pending = token ? { phone, token } : null;
}

export async function claimVerifiedPhone(): Promise<boolean> {
  const p = pending;
  if (!p) return false;
  pending = null;
  try {
    const { data, error } = await supabase.functions.invoke("verify-signup-phone-otp", {
      body: { action: "claim_token", phone: p.phone, token: p.token },
    });
    return !error && Boolean(data?.success);
  } catch {
    return false;
  }
}
