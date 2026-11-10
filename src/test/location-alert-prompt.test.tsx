import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

const hasCheckedToday = vi.fn();
const markCheckedToday = vi.fn();
const getGrantedPosition = vi.fn();
const requestPosition = vi.fn();
vi.mock("@/lib/locationAlerts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/locationAlerts")>("@/lib/locationAlerts");
  return {
    ...actual,
    hasCheckedToday: () => hasCheckedToday(),
    markCheckedToday: () => markCheckedToday(),
    getGrantedPosition: () => getGrantedPosition(),
    requestPosition: () => requestPosition(),
  };
});

import { LocationAlertPrompt } from "@/components/LocationAlertPrompt";

const QUESTION = "Want a text when SwiftData reaches a new town you visit?";
type Body = { action: string };
const status = (s: "unset" | "granted" | "declined") => ({
  data: { eligible: true, status: s, sms_opt_out: false },
  error: null,
});
const bodies = () => invoke.mock.calls.map((c) => (c[1] as { body: Record<string, unknown> }).body);
const consentCalls = () => bodies().filter((b) => b.action === "set_consent");

async function openPopup() {
  render(<LocationAlertPrompt />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
  hasCheckedToday.mockReset().mockReturnValue(false);
  markCheckedToday.mockReset();
  getGrantedPosition.mockReset().mockResolvedValue(null);
  requestPosition.mockReset().mockResolvedValue(null);
  invoke.mockImplementation(async (_n: string, { body }: { body: Body }) =>
    body.action === "status"
      ? status("unset")
      : body.action === "check"
        ? { data: { needs_consent: true }, error: null }
        : { data: { ok: true }, error: null },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LocationAlertPrompt", () => {
  it("shows the popup after 20 seconds when consent is needed", async () => {
    render(<LocationAlertPrompt />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_000);
    });
    expect(screen.queryByText(QUESTION)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    expect(markCheckedToday).toHaveBeenCalled();
  });

  it("does not mark the day as checked when another dialog blocks the popup", async () => {
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    document.body.appendChild(other);
    await openPopup();
    other.remove();
    expect(screen.queryByText(/new town you visit/)).toBeNull();
    expect(markCheckedToday).not.toHaveBeenCalled();
  });

  it("marks the day as checked after checking a granted user", async () => {
    invoke.mockImplementation(async (_n: string, { body }: { body: Body }) =>
      body.action === "status" ? status("granted") : { data: { needs_consent: false }, error: null },
    );
    getGrantedPosition.mockResolvedValue({ lat: 5.6, lng: -0.2 });
    await openPopup();
    expect(bodies()).toContainEqual({ action: "check", lat: 5.6, lng: -0.2 });
    expect(markCheckedToday).toHaveBeenCalled();
  });

  it("marks the day as checked when the user declined, without asking", async () => {
    invoke.mockImplementation(async () => status("declined"));
    await openPopup();
    expect(markCheckedToday).toHaveBeenCalled();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(getGrantedPosition).not.toHaveBeenCalled();
  });

  it("shows no popup and marks the day when an unset user no longer needs consent", async () => {
    invoke.mockImplementation(async (_n: string, { body }: { body: Body }) =>
      body.action === "status" ? status("unset") : { data: { needs_consent: false }, error: null },
    );
    await openPopup();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(markCheckedToday).toHaveBeenCalled();
  });

  it("shows the popup when an unset user needs consent", async () => {
    await openPopup();
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
  });

  it("skips the call if already checked today", async () => {
    hasCheckedToday.mockReturnValue(true);
    await openPopup();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not read GPS when consent is unset, even if the browser granted it", async () => {
    await openPopup();
    expect(getGrantedPosition).not.toHaveBeenCalled();
    expect(bodies().filter((b) => b.action === "check").every((b) => !("lat" in b))).toBe(true);
  });

  it("does nothing and leaves the day unmarked when status fails", async () => {
    invoke.mockImplementation(async () => ({ data: null, error: new Error("boom") }));
    await openPopup();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(markCheckedToday).not.toHaveBeenCalled();
  });

  it("leaves the day unmarked when check fails for a granted user", async () => {
    invoke.mockImplementation(async (_n: string, { body }: { body: Body }) =>
      body.action === "status" ? status("granted") : { data: null, error: new Error("boom") },
    );
    await openPopup();
    expect(markCheckedToday).not.toHaveBeenCalled();
  });

  it("asks for GPS only after tapping yes, then checks with the position", async () => {
    requestPosition.mockResolvedValue({ lat: 6.7, lng: -1.6 });
    await openPopup();
    screen.getByText(QUESTION);
    expect(requestPosition).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText("Yes, text me"));
    });
    expect(requestPosition).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("location-check", {
      body: { action: "set_consent", choice: "yes", version: "v1" },
    });
    expect(consentCalls()).toHaveLength(1);
    expect(bodies()).toContainEqual({ action: "check", lat: 6.7, lng: -1.6 });
  });

  it("does nothing more when GPS is refused after yes", async () => {
    await openPopup();
    await act(async () => {
      fireEvent.click(screen.getByText("Yes, text me"));
    });
    expect(bodies().filter((b) => b.action === "check")).toEqual([{ action: "check" }]);
  });

  it("records no thanks once", async () => {
    await openPopup();
    await act(async () => {
      fireEvent.click(screen.getByText("No thanks"));
    });
    expect(invoke).toHaveBeenCalledWith("location-check", {
      body: { action: "set_consent", choice: "no", version: "v1" },
    });
    expect(consentCalls()).toHaveLength(1);
    expect(requestPosition).not.toHaveBeenCalled();
  });

  it("records closing as dismissed once", async () => {
    await openPopup();
    await act(async () => {
      fireEvent.click(screen.getByText("Close"));
    });
    expect(invoke).toHaveBeenCalledWith("location-check", {
      body: { action: "set_consent", choice: "dismissed", version: "v1" },
    });
    expect(consentCalls()).toHaveLength(1);
  });
});

describe("locationAlerts helpers", () => {
  it("works when localStorage throws", async () => {
    const real = await vi.importActual<typeof import("@/lib/locationAlerts")>("@/lib/locationAlerts");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(real.hasCheckedToday()).toBe(false);
    expect(() => real.markCheckedToday()).not.toThrow();
    vi.restoreAllMocks();
  });

  it("callLocationCheck returns null on invoke error or throw", async () => {
    const real = await vi.importActual<typeof import("@/lib/locationAlerts")>("@/lib/locationAlerts");
    invoke.mockResolvedValueOnce({ data: { x: 1 }, error: new Error("e") });
    expect(await real.callLocationCheck({ action: "status" })).toBeNull();
    invoke.mockRejectedValueOnce(new Error("net"));
    expect(await real.callLocationCheck({ action: "status" })).toBeNull();
  });
});
