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
  orders_per_box: 5,
  boxes_per_day: 1,
  reward_text: "5GB or more",
  bullets: [
    "Complete 5 successful orders today to unlock your box.",
    "Open it to win 5GB or more.",
    "New box every day: progress resets at midnight.",
  ],
  ends_at: "2099-01-01T00:00:00Z",
};
const today = "2026-11-23";
const p1: MysteryProgress = { qualifying_orders: 1, boxes_earned: 0, boxes_opened: 0, boxes_available: 0, orders_to_next: 4, today };
const available: MysteryProgress = { qualifying_orders: 5, boxes_earned: 1, boxes_opened: 0, boxes_available: 1, orders_to_next: 0, today };
const done: MysteryProgress = { qualifying_orders: 6, boxes_earned: 1, boxes_opened: 1, boxes_available: 0, orders_to_next: 0, today };

type HookValue = {
  campaign: typeof campaign | null;
  progress: MysteryProgress | null;
  state: "locked" | "available" | "done" | null;
  isLoading: boolean;
  open: typeof openBox;
  refresh: () => void;
};
const hook: { current: HookValue } = {
  current: { campaign, progress: p1, state: "locked", isLoading: false, open: openBox, refresh: vi.fn() },
};
vi.mock("@/hooks/useMysteryBox", () => ({ useMysteryBox: () => hook.current }));

import { MysteryBoxModal } from "@/components/MysteryBoxModal";
import { MysteryBoxCard } from "@/components/MysteryBoxCard";

const setHook = (progress: MysteryProgress | null, state: HookValue["state"], c: typeof campaign | null = campaign) => {
  hook.current = { campaign: c, progress, state, isLoading: false, open: openBox, refresh: vi.fn() };
};

beforeEach(() => {
  navigate.mockReset();
  toastError.mockReset();
  openBox.mockReset();
  auth.current = { user: { id: "u1" }, profile: { phone: "0241234567" }, isAdmin: false };
  setHook(p1, "locked");
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MysteryBoxModal", () => {
  it("shows today's progress and sends the user to buy data", () => {
    const onOpenChange = vi.fn();
    render(<MysteryBoxModal open onOpenChange={onOpenChange} revealDelayMs={0} />);
    expect(screen.getByText("Today: 1/5 orders · 4 more to unlock")).toBeInTheDocument();
    expect(screen.getByText("Open it to win 5GB or more.")).toBeInTheDocument();
    expect(screen.queryByText(/Box \d of/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Complete 4 more orders today to earn 5GB or more" }));
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

  it("shows the come-back-tomorrow state once today's box is opened", () => {
    setHook(done, "done");
    render(<MysteryBoxModal open onOpenChange={vi.fn()} revealDelayMs={0} />);
    expect(screen.getAllByText("You've opened today's box. Come back tomorrow!").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Complete .* today/ })).not.toBeInTheDocument();
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

  it("does not open by itself on the dashboard, but opens from its button", async () => {
    setHook(available, "available");
    render(<MysteryBoxCard />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Your box is ready to open! 🎁")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open now" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows today's progress while locked", () => {
    render(<MysteryBoxCard />);
    expect(screen.getByText("Today: 1/5 orders · 4 more to unlock")).toBeInTheDocument();
  });
});
