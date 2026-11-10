import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const callLocationCheck = vi.fn();
const requestPosition = vi.fn();
vi.mock("@/lib/locationAlerts", () => ({
  LOCATION_CONSENT_VERSION: "v1",
  callLocationCheck: (...a: unknown[]) => callLocationCheck(...a),
  requestPosition: () => requestPosition(),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

import { LocationAlertSettings } from "@/components/LocationAlertSettings";

const LOC = "Tell me when SwiftData is in a new town I visit";
const PROMO = "Promotional SMS";

type St = "unset" | "granted" | "declined";
function mockStatus(status: St, sms_opt_out = false, eligible = true) {
  callLocationCheck.mockImplementation(async (body: { action: string }) => {
    if (body.action === "status") return { eligible, status, sms_opt_out };
    return { ok: true };
  });
}
const bodies = () => callLocationCheck.mock.calls.map((c) => c[0] as Record<string, unknown>);

describe("LocationAlertSettings", () => {
  beforeEach(() => {
    callLocationCheck.mockReset();
    requestPosition.mockReset();
    toastError.mockReset();
    requestPosition.mockResolvedValue(null);
  });
  afterEach(() => cleanup());

  it("renders nothing when not eligible", async () => {
    mockStatus("granted", false, false);
    const { container } = render(<LocationAlertSettings />);
    await waitFor(() => expect(callLocationCheck).toHaveBeenCalledWith({ action: "status" }));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when status call fails", async () => {
    callLocationCheck.mockResolvedValue(null);
    const { container } = render(<LocationAlertSettings />);
    await waitFor(() => expect(callLocationCheck).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows both switches with server values", async () => {
    mockStatus("granted", false);
    render(<LocationAlertSettings />);
    expect(await screen.findByRole("switch", { name: LOC })).toBeChecked();
    expect(screen.getByRole("switch", { name: PROMO })).toBeChecked();
    expect(screen.getByText("SMS preferences")).toBeInTheDocument();
    expect(screen.getByText("Order and payment messages are not affected.")).toBeInTheDocument();
  });

  it("unchecks Promotional SMS when opted out and location when declined", async () => {
    mockStatus("declined", true);
    render(<LocationAlertSettings />);
    expect(await screen.findByRole("switch", { name: LOC })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: PROMO })).not.toBeChecked();
  });

  it("turning location off sends no", async () => {
    mockStatus("granted");
    render(<LocationAlertSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: LOC }));
    await waitFor(() =>
      expect(callLocationCheck).toHaveBeenCalledWith({ action: "set_consent", choice: "no", version: "v1" }),
    );
    await waitFor(() => expect(screen.getByRole("switch", { name: LOC })).not.toBeChecked());
    expect(requestPosition).not.toHaveBeenCalled();
  });

  it("turning location on sends yes, asks for GPS and runs a check", async () => {
    mockStatus("declined");
    requestPosition.mockResolvedValue({ lat: 5.6, lng: -0.2 });
    render(<LocationAlertSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: LOC }));
    await waitFor(() =>
      expect(callLocationCheck).toHaveBeenCalledWith({ action: "set_consent", choice: "yes", version: "v1" }),
    );
    await waitFor(() => expect(requestPosition).toHaveBeenCalled());
    await waitFor(() =>
      expect(callLocationCheck).toHaveBeenCalledWith({ action: "check", lat: 5.6, lng: -0.2 }),
    );
    expect(screen.getByRole("switch", { name: LOC })).toBeChecked();
  });

  it("turning location on stays on when GPS is denied", async () => {
    mockStatus("declined");
    render(<LocationAlertSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: LOC }));
    await waitFor(() => expect(requestPosition).toHaveBeenCalled());
    expect(bodies().some((b) => b.action === "check")).toBe(false);
    await waitFor(() => expect(screen.getByRole("switch", { name: LOC })).toBeChecked());
  });

  it("Promotional SMS off sets opt-out true", async () => {
    mockStatus("granted", false);
    render(<LocationAlertSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: PROMO }));
    await waitFor(() =>
      expect(callLocationCheck).toHaveBeenCalledWith({ action: "set_sms_opt_out", value: true }),
    );
  });

  it("reverts the switch and toasts when saving fails", async () => {
    mockStatus("granted");
    render(<LocationAlertSettings />);
    const sw = await screen.findByRole("switch", { name: LOC });
    callLocationCheck.mockResolvedValueOnce(null);
    fireEvent.click(sw);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("switch", { name: LOC })).toBeChecked());
  });
});
