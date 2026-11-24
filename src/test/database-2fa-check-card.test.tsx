import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import Database2faCheckCard from "@/components/admin/Database2faCheckCard";

const ok = (over: Record<string, unknown> = {}) => ({
  data: { is_admin_requires_2fa: true, has_role_requires_2fa: true, policies: [], functions: [], ...over },
  error: null,
});

describe("Database 2FA check card", () => {
  beforeEach(() => rpc.mockReset());
  afterEach(cleanup);

  it("shows a pass when both checks require 2FA and no policies", async () => {
    rpc.mockResolvedValue(ok());
    render(<Database2faCheckCard adminsWithout2fa={0} />);
    expect(await screen.findByText("Admin check requires 2FA: Yes")).toBeInTheDocument();
    expect(screen.getByText("Role check requires 2FA: Yes")).toBeInTheDocument();
    expect(screen.getByText("Policies with their own admin check: 0")).toBeInTheDocument();
    expect(screen.getByText("Functions with their own admin check: 0")).toBeInTheDocument();
    expect(screen.getByText("Admins without 2FA: 0")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("admin_security_2fa_report");
  });

  it("lists policies that check admin rights themselves", async () => {
    rpc.mockResolvedValue(ok({ policies: [{ table: "public.stub_t", policy: "Admins read", command: "SELECT" }] }));
    render(<Database2faCheckCard adminsWithout2fa={null} />);
    expect(await screen.findByText("public.stub_t / Admins read (SELECT)")).toBeInTheDocument();
    expect(screen.getByText("Policies with their own admin check: 1")).toBeInTheDocument();
    expect(screen.getByText("Admins without 2FA: —")).toBeInTheDocument();
  });

  it("lists functions that check admin rights themselves", async () => {
    rpc.mockResolvedValue(ok({ functions: [{ function: "public.reset_promo_claims(p_promo_id uuid)" }] }));
    render(<Database2faCheckCard adminsWithout2fa={0} />);
    expect(await screen.findByText("public.reset_promo_claims(p_promo_id uuid)")).toBeInTheDocument();
    expect(screen.getByText("Functions with their own admin check: 1")).toBeInTheDocument();
  });

  it("treats a report without functions (older database function) as 0", async () => {
    rpc.mockResolvedValue({ data: { is_admin_requires_2fa: true, has_role_requires_2fa: true, policies: [] }, error: null });
    render(<Database2faCheckCard adminsWithout2fa={0} />);
    expect(await screen.findByText("Functions with their own admin check: 0")).toBeInTheDocument();
  });

  it("shows No when a check does not require 2FA", async () => {
    rpc.mockResolvedValue(ok({ is_admin_requires_2fa: false }));
    render(<Database2faCheckCard adminsWithout2fa={0} />);
    expect(await screen.findByText("Admin check requires 2FA: No")).toBeInTheDocument();
  });

  it("says not installed when the function is missing", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    render(<Database2faCheckCard adminsWithout2fa={0} />);
    expect(await screen.findByText("Database check not installed yet")).toBeInTheDocument();
  });

  it("shows the error for other failures", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not_authorized" } });
    render(<Database2faCheckCard adminsWithout2fa={0} />);
    expect(await screen.findByText(/not_authorized/)).toBeInTheDocument();
  });
});
