import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import AdminTwoFactorBadge from "@/components/admin/AdminTwoFactorBadge";

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
