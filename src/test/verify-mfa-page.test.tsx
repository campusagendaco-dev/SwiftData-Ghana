import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const challengeSpy = vi.fn(async (_arg?: any) => ({ data: { id: "c1" }, error: null }));
const verifySpy = vi.fn(async (_arg?: any) => ({ data: {}, error: null }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" }, loading: false, refreshMfaStatus: vi.fn(), isMfaChallenged: true }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signOut: vi.fn(),
      mfa: {
        listFactors: async () => ({ data: { all: [{ id: "f1", factor_type: "totp", status: "verified" }], totp: [{ id: "f1", status: "verified" }] }, error: null }),
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null }),
        challenge: (arg: any) => challengeSpy(arg),
        verify: (arg: any) => verifySpy(arg),
      },
    },
  },
}));

import VerifyMfa from "@/pages/VerifyMfa";

describe("2FA code page", () => {
  beforeEach(() => {
    challengeSpy.mockClear();
    verifySpy.mockClear();
  });

  it("shows six labelled digit boxes and waits for a full code", async () => {
    render(<MemoryRouter><VerifyMfa /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Enter your security code" })).toBeInTheDocument();
    for (let digit = 1; digit <= 6; digit++) {
      expect(screen.getByLabelText(`Digit ${digit} of 6`)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel and sign out" })).toBeInTheDocument();
  });

  it("submits 6-digit code once even if form is submitted concurrently with auto-submit", async () => {
    render(<MemoryRouter><VerifyMfa /></MemoryRouter>);
    const firstInput = await screen.findByLabelText("Digit 1 of 6");
    fireEvent.paste(firstInput, { clipboardData: { getData: () => "123456" } });
    fireEvent.submit(firstInput.closest("form")!);

    await waitFor(() => {
      expect(verifySpy).toHaveBeenCalledTimes(1);
    });
    expect(verifySpy).toHaveBeenCalledWith({
      factorId: "f1",
      challengeId: "c1",
      code: "123456",
    });
  });
});
