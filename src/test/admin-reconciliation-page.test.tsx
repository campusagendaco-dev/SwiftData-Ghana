import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let run: Record<string, unknown> | null = null;
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const q: any = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: run, error: null }) };
      return q;
    },
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  },
}));

import AdminReconciliation from "@/pages/AdminReconciliation";

const issue = (over: Record<string, unknown>) => ({
  key: "k",
  type: "paid_without_order",
  order_id: "ref-aaa",
  amount_ghs: 25,
  detail: "GH₵25.00 paid, no order found",
  explanation: "The customer paid but checkout never created the order.",
  next_step: "Find the payment in Paystack and refund it through the refund service.",
  explained_by: "ai",
  ...over,
});

const sampleRun = () => ({
  id: 7,
  run_at: "2026-11-24T02:00:00Z",
  kind: "paystack",
  ok: false,
  issues: 2,
  details: {
    window_hours: 48,
    paystack_transactions: 120,
    paystack_total: 3450.5,
    issues_total_ghs: 37,
    by_type: { paid_without_order: 1, refunded_twice: 1 },
    sample: [
      issue({ key: "a", order_id: "ref-aaa" }),
      issue({ key: "b", type: "refunded_twice", order_id: "ord-bbb", amount_ghs: 12, explanation: "Refunded twice, GH₵12 too much went back.", next_step: "Request a wallet adjustment.", explained_by: "rules" }),
    ],
  },
});

describe("Reconciliation page", () => {
  beforeEach(() => {
    invoke.mockReset();
    run = sampleRun();
  });
  afterEach(cleanup);

  it("shows the latest nightly report with totals", async () => {
    render(<AdminReconciliation />);
    expect(await screen.findByText("2 problems · GH₵37.00")).toBeInTheDocument();
    expect(screen.getByText(/120 Paystack payments/)).toBeInTheDocument();
  });

  it("explains each problem in plain words with a next step", async () => {
    render(<AdminReconciliation />);
    expect(await screen.findByText("The customer paid but checkout never created the order.")).toBeInTheDocument();
    expect(screen.getByText("Find the payment in Paystack and refund it through the refund service.")).toBeInTheDocument();
    expect(screen.getByText("Paid, no order")).toBeInTheDocument();
    expect(screen.getByText("Refunded twice")).toBeInTheDocument();
    expect(screen.getAllByText(/AI explanation|Standard explanation/)).toHaveLength(2);
  });

  it("filters by problem type and searches by reference", async () => {
    render(<AdminReconciliation />);
    await screen.findByText("Paid, no order");
    fireEvent.click(screen.getByRole("button", { name: /Refunded twice \(1\)/ }));
    expect(screen.queryByText("The customer paid but checkout never created the order.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /All \(2\)/ }));
    fireEvent.change(screen.getByPlaceholderText("Search reference or order id"), { target: { value: "bbb" } });
    expect(screen.queryByText("Paid, no order")).not.toBeInTheDocument();
    expect(screen.getByText("Refunded twice")).toBeInTheDocument();
  });

  it("runs the read-only check on demand and reloads", async () => {
    invoke.mockResolvedValue({ data: { ok: true, issues: 0 }, error: null });
    render(<AdminReconciliation />);
    await screen.findByText("Paid, no order");
    fireEvent.click(screen.getByRole("button", { name: "Run check now" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("wallet-reconcile", expect.objectContaining({ body: {} })));
  });

  it("says when everything matched", async () => {
    run = { ...sampleRun(), ok: true, issues: 0, details: { window_hours: 48, paystack_transactions: 80, by_type: {}, sample: [] } };
    render(<AdminReconciliation />);
    expect(await screen.findByText("Everything matched in the last 48 hours.")).toBeInTheDocument();
  });

  it("says when no check has run yet", async () => {
    run = null;
    render(<AdminReconciliation />);
    expect(await screen.findByText("No check has run yet.")).toBeInTheDocument();
  });

  it("has no button that sends or re-sends orders", () => {
    const src = readFileSync(join(__dirname, "..", "pages", "AdminReconciliation.tsx"), "utf8");
    expect(src).not.toMatch(/verify-payment|Resolve|Retry fulfil/i);
  });
});
