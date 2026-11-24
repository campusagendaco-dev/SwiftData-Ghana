import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import AmaProposalCard from "@/components/ama/AmaProposalCard";

const purchase = { kind: "purchase" as const, network: "MTN", package_size: "2GB", phone: "0241112222", amount_ghs: 12 };

describe("Ama's confirm card", () => {
  beforeEach(() => invoke.mockReset());
  afterEach(cleanup);

  it("shows exactly what will be bought before anything happens", () => {
    render(<AmaProposalCard proposal={purchase} onDone={() => {}} />);
    expect(screen.getByText("MTN 2GB")).toBeInTheDocument();
    expect(screen.getByText("0241112222")).toBeInTheDocument();
    expect(screen.getByText("GH₵12.00")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("buys only when the user taps Confirm, and only once", async () => {
    let resolve: (v: unknown) => void = () => {};
    invoke.mockReturnValue(new Promise((r) => (resolve = r)));
    const onDone = vi.fn();
    render(<AmaProposalCard proposal={purchase} onDone={onDone} />);
    const btn = screen.getByRole("button", { name: "Confirm purchase" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("wallet-buy-data", { body: expect.objectContaining({ network: "MTN", package_size: "2GB", customer_phone: "0241112222", amount: 12 }) });
    resolve({ data: { order_id: "o1" }, error: null });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.stringContaining("o1")));
  });

  it("does nothing when cancelled", () => {
    const onDone = vi.fn();
    render(<AmaProposalCard proposal={purchase} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(invoke).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith("Okay, I didn't buy anything.");
  });

  it("redeems points through Ama's confirm step, not the AI", async () => {
    invoke.mockResolvedValue({ data: { ok: true, points: 1200, amount_ghs: 12 }, error: null });
    const onDone = vi.fn();
    render(<AmaProposalCard proposal={{ kind: "redeem", points: 1200, amount_ghs: 12 }} onDone={onDone} />);
    expect(screen.getByText("1200 points → GH₵12.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm redemption" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("oracle-ai", { body: { action: "confirm_redeem", points: 1200 } }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.stringContaining("GH₵12.00")));
  });

  it("reports a failed purchase without retrying", async () => {
    invoke.mockResolvedValue({ data: { error: "Insufficient balance" }, error: null });
    const onDone = vi.fn();
    render(<AmaProposalCard proposal={purchase} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm purchase" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.stringContaining("Insufficient balance")));
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
