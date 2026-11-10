import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" }, loading: false, refreshMfaStatus: vi.fn(), isMfaChallenged: true }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signOut: vi.fn(),
      mfa: {
        listFactors: async () => ({ data: { all: [{ id: "f1", factor_type: "totp", status: "verified" }], totp: [{ id: "f1", status: "verified" }] }, error: null }),
        challenge: async () => ({ data: { id: "c1" }, error: null }),
        verify: async () => ({ data: {}, error: null }),
      },
    },
  },
}));

import VerifyMfa from "@/pages/VerifyMfa";

describe("2FA code page", () => {
  it("shows six labelled digit boxes and waits for a full code", async () => {
    render(<MemoryRouter><VerifyMfa /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Enter your security code" })).toBeInTheDocument();
    for (let digit = 1; digit <= 6; digit++) {
      expect(screen.getByLabelText(`Digit ${digit} of 6`)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel and sign out" })).toBeInTheDocument();
  });
});
