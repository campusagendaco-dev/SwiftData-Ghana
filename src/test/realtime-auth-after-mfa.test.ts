import { describe, it, expect, vi } from "vitest";
import { syncRealtimeTokenAfterMfa } from "@/lib/realtimeAuth";

// supabase-js only hands realtime a new token on SIGNED_IN / TOKEN_REFRESHED. After the 2FA
// code, live feeds would keep the password-only token, which admin-only tables now refuse.
describe("realtime token after 2FA", () => {
  it("gives realtime the new token when the 2FA code is verified", () => {
    const realtime = { setAuth: vi.fn() };
    syncRealtimeTokenAfterMfa("MFA_CHALLENGE_VERIFIED", { access_token: "aal2-token" }, realtime);
    expect(realtime.setAuth).toHaveBeenCalledWith("aal2-token");
  });

  it("leaves other events to supabase-js", () => {
    const realtime = { setAuth: vi.fn() };
    syncRealtimeTokenAfterMfa("SIGNED_IN", { access_token: "t" }, realtime);
    syncRealtimeTokenAfterMfa("TOKEN_REFRESHED", { access_token: "t" }, realtime);
    syncRealtimeTokenAfterMfa("MFA_CHALLENGE_VERIFIED", null, realtime);
    expect(realtime.setAuth).not.toHaveBeenCalled();
  });
});
