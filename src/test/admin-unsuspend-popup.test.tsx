import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const invoke = vi.fn();
const confirm = vi.fn();
let selected = "";
const rows = [{ id: "q1", user_id: "u1", user_name: "Kofi", phone: "0241112222", suspension_reason: "The account was suspended by an administrator.", route: "admin_review", status: "pending_admin_approval", created_at: "2026-11-24T12:00:00Z" }];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const q: any = { select: (cols: string) => { selected = cols; return q; }, eq: () => q, order: () => q, limit: () => Promise.resolve({ data: rows, error: null }) };
      return q;
    },
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));
vi.mock("@/components/admin/ConfirmActionProvider", () => ({ useConfirmedCall: () => ({ confirm: (...a: unknown[]) => confirm(...a) }) }));

import AdminUnsuspendPopup from "@/components/AdminUnsuspendPopup";

describe("admin unsuspend popup", () => {
  beforeEach(() => {
    invoke.mockReset();
    confirm.mockReset();
  });
  afterEach(cleanup);

  it("reads only columns admins are allowed to see", async () => {
    render(<AdminUnsuspendPopup />);
    await screen.findByText("Kofi");
    expect(selected).not.toMatch(/otp|\*/);
  });

  it("approving asks in the confirmation box first", async () => {
    confirm.mockResolvedValue(false);
    render(<AdminUnsuspendPopup />);
    fireEvent.click(await screen.findByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ kind: "unsuspend" })));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("approves after the admin confirms", async () => {
    confirm.mockResolvedValue(true);
    invoke.mockResolvedValue({ data: { success: true }, error: null });
    render(<AdminUnsuspendPopup />);
    fireEvent.click(await screen.findByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("self-unsuspend", { body: { action: "admin_decision", request_id: "q1", decision: "approve" } }));
  });

  it("rejecting needs no box (the account stays suspended)", async () => {
    invoke.mockResolvedValue({ data: { success: true }, error: null });
    render(<AdminUnsuspendPopup />);
    fireEvent.click(await screen.findByRole("button", { name: /Reject|Keep suspended/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("self-unsuspend", { body: { action: "admin_decision", request_id: "q1", decision: "reject" } }));
    expect(confirm).not.toHaveBeenCalled();
  });
});
