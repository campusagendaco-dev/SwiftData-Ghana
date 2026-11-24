import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const invoke = vi.fn();
const confirm = vi.fn();
const inserted: any[] = [];
let accounts: any[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === "momo_receiving_accounts" ? accounts : [];
      const q: any = {
        select: () => q, eq: () => q, order: () => q, limit: () => q,
        insert: (v: any) => { inserted.push({ table, v }); return Promise.resolve({ error: null }); },
        update: (v: any) => { inserted.push({ table, update: v }); return q; },
        then: (ok: any) => Promise.resolve({ data: rows, error: null }).then(ok),
      };
      return q;
    },
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));
vi.mock("@/components/admin/ConfirmActionProvider", () => ({ useConfirmedCall: () => ({ confirm: (...a: unknown[]) => confirm(...a) }) }));

import AdminMomoReceipts from "@/pages/AdminMomoReceipts";

const result = (over: Record<string, unknown> = {}) => ({
  check_id: "c1",
  verdict: "flagged",
  risk_level: "high",
  flags: [{ code: "RECIPIENT_NOT_OURS", severity: "high", message: "The money went to 0209998888 (Kojo), which is not a SwiftData MoMo number." }],
  extracted: { provider: "MTN MoMo", transaction_id: "48291034567", amount: 50, sender_name: "Ama", sender_phone: "0241112222", recipient_name: "Kojo", recipient_phone: "0209998888", timestamp: "2026-11-24T11:30:00Z", status: "successful" },
  order_amount: 50,
  ...over,
});

const upload = async () => {
  const file = new File(["x"], "receipt.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Receipt picture"), { target: { files: [file] } });
  // FileReader is async; under a full parallel run it can take over the 1s default.
  await waitFor(() => expect(screen.getByRole("button", { name: "Check receipt" })).not.toBeDisabled(), { timeout: 5000 });
};

describe("MoMo receipt checker page", () => {
  beforeEach(() => {
    invoke.mockReset();
    confirm.mockReset();
    inserted.length = 0;
    accounts = [{ id: "a1", phone: "233553334444", account_name: "SwiftData", is_active: true }];
  });
  afterEach(cleanup);

  it("checks a receipt and shows the red flags in plain words", async () => {
    invoke.mockResolvedValue({ data: result(), error: null });
    render(<AdminMomoReceipts />);
    await upload();
    fireEvent.change(screen.getByLabelText("Order ID (optional)"), { target: { value: "o1" } });
    fireEvent.click(screen.getByRole("button", { name: "Check receipt" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("verify-momo-receipt", expect.objectContaining({ body: expect.objectContaining({ action: "check", order_id: "o1" }) })));
    expect(await screen.findByText("Flagged · 1 problem")).toBeInTheDocument();
    expect(screen.getByText(/not a SwiftData MoMo number/)).toBeInTheDocument();
    expect(screen.getByText("48291034567")).toBeInTheDocument();
  });

  it("never says verified; at best 'no red flags found', with a reminder", async () => {
    invoke.mockResolvedValue({ data: result({ verdict: "no_red_flags", risk_level: "low", flags: [] }), error: null });
    render(<AdminMomoReceipts />);
    await upload();
    fireEvent.click(screen.getByRole("button", { name: "Check receipt" }));
    expect(await screen.findByText("No red flags found")).toBeInTheDocument();
    expect(screen.getAllByText(/can't prove a payment/).length).toBeGreaterThan(1);
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it("accepting asks in the confirmation box first, then records the decision", async () => {
    invoke.mockResolvedValueOnce({ data: result({ verdict: "no_red_flags", flags: [] }), error: null }).mockResolvedValueOnce({ data: { ok: true }, error: null });
    confirm.mockResolvedValue(true);
    render(<AdminMomoReceipts />);
    await upload();
    fireEvent.click(screen.getByRole("button", { name: "Check receipt" }));
    fireEvent.click(await screen.findByRole("button", { name: "Accept receipt" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ kind: "receipt", amountGhs: 50 })));
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith("verify-momo-receipt", { body: { action: "decide", check_id: "c1", decision: "accepted" } }));
  });

  it("does not record anything when the admin cancels", async () => {
    invoke.mockResolvedValueOnce({ data: result(), error: null });
    confirm.mockResolvedValue(false);
    render(<AdminMomoReceipts />);
    await upload();
    fireEvent.click(screen.getByRole("button", { name: "Check receipt" }));
    fireEvent.click(await screen.findByRole("button", { name: "Accept receipt" }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("adds a SwiftData number in the 233 format after confirming", async () => {
    confirm.mockResolvedValue(true);
    render(<AdminMomoReceipts />);
    fireEvent.change(screen.getByLabelText("MoMo number"), { target: { value: "024 123 4567" } });
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "SwiftData Ghana" } });
    fireEvent.click(screen.getByRole("button", { name: "Add number" }));
    await waitFor(() => expect(inserted).toContainEqual({ table: "momo_receiving_accounts", v: { phone: "233241234567", account_name: "SwiftData Ghana", is_active: true } }));
  });

  it("warns when no SwiftData number is set up", async () => {
    accounts = [];
    render(<AdminMomoReceipts />);
    expect(await screen.findByText(/No SwiftData MoMo number yet/)).toBeInTheDocument();
  });
});
