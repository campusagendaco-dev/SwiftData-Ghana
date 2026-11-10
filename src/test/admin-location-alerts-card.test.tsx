import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const callLocationCheck = vi.fn();
vi.mock("@/lib/locationAlerts", () => ({
  callLocationCheck: (...a: unknown[]) => callLocationCheck(...a),
}));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) },
}));

import { AdminLocationAlertsCard } from "@/components/AdminLocationAlertsCard";

const STATS = { granted: 5, declined: 2, sent_today: 3, sent_total: 40, mode: "off", daily_limit: 200 };
const bodies = () => callLocationCheck.mock.calls.map((c) => c[0] as Record<string, unknown>);

function setup(stats: unknown = STATS, extra: Record<string, unknown> = {}) {
  callLocationCheck.mockImplementation(async (body: { action: string }) => {
    if (body.action === "admin_stats") return stats;
    if (body.action in extra) return extra[body.action];
    return { ok: true };
  });
  return render(<MemoryRouter><AdminLocationAlertsCard /></MemoryRouter>);
}

describe("AdminLocationAlertsCard", () => {
  beforeEach(() => {
    callLocationCheck.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
  });
  afterEach(() => cleanup());

  it("loads mode, limit and counts", async () => {
    setup();
    const sw = await screen.findByRole("switch", { name: "Location welcome SMS" });
    expect(sw).not.toBeChecked();
    expect(screen.getByLabelText("Daily SMS limit")).toHaveValue(200);
    expect(screen.getByText(/Sent today: 3/)).toBeInTheDocument();
    expect(screen.getByText(/Granted: 5/)).toBeInTheDocument();
  });

  it("shows an inline message when stats fail to load", async () => {
    setup(null);
    expect(await screen.findByText(/Could not load/)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("turning on saves consent mode", async () => {
    setup();
    fireEvent.click(await screen.findByRole("switch", { name: "Location welcome SMS" }));
    await waitFor(() => expect(bodies()).toContainEqual({ action: "admin_set_settings", mode: "consent" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Location welcome SMS" })).toBeChecked());
  });

  it("reverts the switch and toasts when saving the mode fails", async () => {
    setup(STATS, { admin_set_settings: null });
    fireEvent.click(await screen.findByRole("switch", { name: "Location welcome SMS" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole("switch", { name: "Location welcome SMS" })).not.toBeChecked();
  });

  it("rejects a negative daily limit", async () => {
    setup();
    const input = await screen.findByLabelText("Daily SMS limit");
    fireEvent.change(input, { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limit" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(bodies().some((b) => b.action === "admin_set_settings")).toBe(false);
  });

  it("saves a valid daily limit", async () => {
    setup();
    const input = await screen.findByLabelText("Daily SMS limit");
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limit" }));
    await waitFor(() => expect(bodies()).toContainEqual({ action: "admin_set_settings", daily_limit: 50 }));
  });

  it("sends a test to a chosen town", async () => {
    setup(STATS, { admin_test_send: { ok: false, error: "no credits" } });
    fireEvent.change(await screen.findByLabelText("Test town"), { target: { value: "Kumasi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    await waitFor(() => expect(bodies()).toContainEqual({ action: "admin_test_send", town: "Kumasi" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining("no credits")));
  });
});
