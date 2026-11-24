import { describe, expect, it, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { claimVerifiedPhone, rememberPhoneToken } from "@/lib/phoneVerification";

describe("handing the phone token back after signup", () => {
  beforeEach(() => invoke.mockReset());

  it("sends the remembered token once, then forgets it", async () => {
    invoke.mockResolvedValue({ data: { success: true }, error: null });
    rememberPhoneToken("0241112222", "tok-1");
    expect(await claimVerifiedPhone()).toBe(true);
    expect(invoke).toHaveBeenCalledWith("verify-signup-phone-otp", { body: { action: "claim_token", phone: "0241112222", token: "tok-1" } });
    expect(await claimVerifiedPhone()).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no phone was verified, and reports a failed claim as false", async () => {
    expect(await claimVerifiedPhone()).toBe(false);
    rememberPhoneToken("0241112222", "tok-2");
    // supabase-js reports network failures as an error object
    invoke.mockResolvedValue({ data: null, error: { message: "Failed to send a request to the Edge Function" } });
    expect(await claimVerifiedPhone()).toBe(false);
  });
});
