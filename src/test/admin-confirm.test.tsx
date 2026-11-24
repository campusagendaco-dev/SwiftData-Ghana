import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { useState } from "react";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, rpc: (...a: unknown[]) => rpc(...a) },
}));

import { ConfirmActionProvider, useConfirmedCall } from "@/components/admin/ConfirmActionProvider";
import { needsTypedAmount, formatGhs } from "@/lib/adminSensitive";

function Harness({ amount, kind }: { amount?: number; kind: "money" | "refund" | "send" }) {
  const { invoke: confirmedInvoke } = useConfirmedCall();
  const [result, setResult] = useState("idle");
  return (
    <>
      <button
        onClick={async () => {
          const res = await confirmedInvoke(
            "verify-and-refund",
            { body: { order_id: "o1" } },
            { title: "Refund order", kind, orders: 3, amountGhs: amount },
          );
          setResult(res.cancelled ? "cancelled" : "done");
        }}
      >
        go
      </button>
      <span data-testid="result">{result}</span>
    </>
  );
}

const renderHarness = (props: { amount?: number; kind: "money" | "refund" | "send" }) =>
  render(
    <ConfirmActionProvider>
      <Harness {...props} />
    </ConfirmActionProvider>,
  );

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  rpc.mockReset();
});
afterEach(() => cleanup());

describe("needsTypedAmount", () => {
  it("requires typing for refunds, payouts and amounts over GH₵100", () => {
    expect(needsTypedAmount({ kind: "refund", amountGhs: 5 })).toBe(true);
    expect(needsTypedAmount({ kind: "payout", amountGhs: 5 })).toBe(true);
    expect(needsTypedAmount({ kind: "money", amountGhs: 100.01 })).toBe(true);
    expect(needsTypedAmount({ kind: "money", amountGhs: 100 })).toBe(false);
    expect(needsTypedAmount({ kind: "send", orders: 50 })).toBe(false);
    expect(needsTypedAmount({ kind: "refund" })).toBe(false); // nothing to type without an amount
  });
  it("formats cedis with two decimals", () => {
    expect(formatGhs(120)).toBe("120.00");
    expect(formatGhs(4.5)).toBe("4.50");
  });
});

describe("confirmation box", () => {
  it("shows the count and amount, and cancelling never calls the server", async () => {
    renderHarness({ kind: "send", amount: 40 });
    fireEvent.click(screen.getByText("go"));
    expect(await screen.findByText("Refund order")).toBeInTheDocument();
    expect(screen.getByText(/3 orders/)).toBeInTheDocument();
    expect(screen.getByText(/GH₵ 40\.00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("cancelled"));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("confirming calls the server once with the same arguments", async () => {
    renderHarness({ kind: "send", amount: 40 });
    fireEvent.click(screen.getByText("go"));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("done"));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("verify-and-refund", { body: { order_id: "o1" } });
  });

  it("a refund stays locked until the exact amount is typed", async () => {
    renderHarness({ kind: "refund", amount: 120 });
    fireEvent.click(screen.getByText("go"));
    const confirmBtn = await screen.findByRole("button", { name: "Confirm" });
    expect(confirmBtn).toBeDisabled();
    const input = screen.getByLabelText(/Type 120\.00 to confirm/);
    fireEvent.change(input, { target: { value: "12" } });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(input, { target: { value: "120.00" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  });
});
