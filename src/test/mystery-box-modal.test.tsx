import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { MysteryProgress } from "@/lib/mysteryBox";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

const auth = { current: { user: { id: "u1" }, profile: { phone: "0241234567" }, isAdmin: false } };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));

const openBox = vi.fn();
const campaign = {
  id: "c1",
  title: "Mystery Box",
  image_url: null,
  orders_per_box: 2,
  max_boxes_per_user: 3,
  bullets: [
    "Every order on your account during the campaign counts toward your box.",
    "Open your box when you qualify.",
    "Discover the surprise prize waiting inside!",
  ],
  ends_at: "2099-01-01T00:00:00Z",
};
const p0: MysteryProgress = { qualifying_orders: 0, boxes_earned: 0, boxes_opened: 0, boxes_available: 0, orders_to_next: 2 };
const available: MysteryProgress = { qualifying_orders: 2, boxes_earned: 1, boxes_opened: 0, boxes_available: 1, orders_to_next: 2 };
const done: MysteryProgress = { qualifying_orders: 6, boxes_earned: 3, boxes_opened: 3, boxes_available: 0, orders_to_next: 0 };

type HookValue = {
  campaign: typeof campaign | null;
  progress: MysteryProgress | null;
  state: "locked" | "available" | "done" | null;
  isLoading: boolean;
  open: typeof openBox;
};
const hook: { current: HookValue } = {
  current: { campaign, progress: p0, state: "locked", isLoading: false, open: openBox },
};
vi.mock("@/hooks/useMysteryBox", () => ({ useMysteryBox: () => hook.current }));

import { MysteryBoxModal } from "@/components/MysteryBoxModal";
import { MysteryBoxCard } from "@/components/MysteryBoxCard";

const setHook = (progress: MysteryProgress | null, state: HookValue["state"], c: typeof campaign | null = campaign) => {
  hook.current = { campaign: c, progress, state, isLoading: false, open: openBox };
};

beforeEach(() => {
  navigate.mockReset();
  toastError.mockReset();
  openBox.mockReset();
  auth.current = { user: { id: "u1" }, profile: { phone: "0241234567" }, isAdmin: false };
  setHook(p0, "locked");
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MysteryBoxModal", () => {
  it("shows locked progress and sends the user to buy data", () => {
    const onOpenChange = vi.fn();
    render(<MysteryBoxModal open onOpenChange={onOpenChange} revealDelayMs={0} />);
    expect(screen.getByText("Progress: 0/2 qualifying orders · 2 more to unlock")).toBeInTheDocument();
    expect(screen.getByText("Open your box when you qualify.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Place 2 orders to unlock" }));
    expect(navigate).toHaveBeenCalledWith("/dashboard/buy-data/mtn");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens an available box to the profile phone and reveals the prize", async () => {
    setHook(available, "available");
    openBox.mockResolvedValue({ success: true, prize_label: "1GB MTN Data", order_id: "o1" });
    render(<MysteryBoxModal open onOpenChange={vi.fn()} revealDelayMs={0} />);
    expect(screen.getByLabelText("Send prize to")).toHaveValue("0241234567");
    fireEvent.click(screen.getByRole("button", { name: "Open your box 🎁" }));
    expect(openBox).toHaveBeenCalledWith("0241234567");
    expect(await screen.findByText("You won 1GB MTN Data! 🎉")).toBeInTheDocument();
  });

  it("says the box is ready instead of showing unlock progress", () => {
    setHook(available, "available");
    render(<MysteryBoxModal open onOpenChange={vi.fn()} revealDelayMs={0} />);
    expect(screen.getByText("Your box is ready to open! 🎁")).toBeInTheDocument();
    expect(screen.queryByText(/more to unlock/)).not.toBeInTheDocument();
  });

  it("lets the user clear and retype the prize phone", () => {
    setHook(available, "available");
    render(<MysteryBoxModal open onOpenChange={vi.fn()} revealDelayMs={0} />);
    const input = screen.getByLabelText("Send prize to");
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "Open your box 🎁" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "0551234567" } });
    expect(input).toHaveValue("0551234567");
  });

  it("shows a friendly toast when opening fails", async () => {
    setHook(available, "available");
    openBox.mockResolvedValue({ success: false, error: "out_of_stock", message: "All the prizes have been claimed." });
    render(<MysteryBoxModal open onOpenChange={vi.fn()} revealDelayMs={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Open your box 🎁" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("All the prizes have been claimed."));
    expect(screen.queryByText(/You won/)).not.toBeInTheDocument();
  });

  it("shows the done state when every box is opened", () => {
    setHook(done, "done");
    render(<MysteryBoxModal open onOpenChange={vi.fn()} revealDelayMs={0} />);
    expect(screen.getAllByText("You've opened all your boxes. Thanks!").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Place .* to unlock/ })).not.toBeInTheDocument();
  });
});

describe("MysteryBoxCard", () => {
  it("renders nothing without a campaign", () => {
    setHook(null, null, null);
    const { container } = render(<MysteryBoxCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for admins", () => {
    auth.current = { ...auth.current, isAdmin: true };
    const { container } = render(<MysteryBoxCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("auto-opens once, stays dismissed, and re-opens when a new box is earned", async () => {
    render(<MysteryBoxCard />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    cleanup();
    render(<MysteryBoxCard />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Progress: 0/2 qualifying orders · 2 more to unlock")).toBeInTheDocument();

    setHook(available, "available");
    cleanup();
    render(<MysteryBoxCard />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("still works when sessionStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<MysteryBoxCard />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
