import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import AdminTwoFactorBadge, { adminRowMfaStatus } from "@/components/admin/AdminTwoFactorBadge";

describe("admin 2FA badge", () => {
  afterEach(cleanup);

  it("verified shows 2FA OK", () => {
    render(<AdminTwoFactorBadge status="verified" />);
    expect(screen.getByText("2FA OK")).toBeInTheDocument();
  });

  it("none shows NO 2FA", () => {
    render(<AdminTwoFactorBadge status="none" />);
    expect(screen.getByText("NO 2FA")).toBeInTheDocument();
  });

  it("unknown never shows NO 2FA", () => {
    render(<AdminTwoFactorBadge status="unknown" />);
    expect(screen.getByText("2FA UNKNOWN")).toBeInTheDocument();
    expect(screen.queryByText("NO 2FA")).toBeNull();
  });
});

describe("admin row 2FA status", () => {
  it("is unknown when the backend hasn't sent mfa_status yet", () => {
    // old get_admins read a broken view, so its is_mfa_verified was always false
    expect(adminRowMfaStatus({ is_mfa_verified: false })).toBe("unknown");
    expect(adminRowMfaStatus({ is_mfa_verified: true })).toBe("unknown");
  });

  it("uses mfa_status when present", () => {
    expect(adminRowMfaStatus({ mfa_status: "none", is_mfa_verified: false })).toBe("none");
    expect(adminRowMfaStatus({ mfa_status: "verified", is_mfa_verified: true })).toBe("verified");
  });
});
