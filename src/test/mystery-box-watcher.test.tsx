import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { MysteryProgress } from "@/lib/mysteryBox";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const auth = {
  current: { user: { id: "u1" } as { id: string } | null, profile: { phone: "0241234567" }, isAdmin: false },
};
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));

type Handler = (payload: { new: { status?: string } }) => void;
const channelOn = vi.fn();
const channelNames: string[] = [];
const removeChannel = vi.fn();
let handler: Handler | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string) => {
      channelNames.push(name);
      const ch = {
        on: (...args: unknown[]) => {
          channelOn(...args);
          handler = args[2] as Handler;
          return ch;
        },
        subscribe: () => ch,
        unsubscribe: () => undefined,
      };
      return ch;
    },
    removeChannel: (...a: unknown[]) => removeChannel(...a),
  },
}));

const refresh = vi.fn();
const campaign = {
  id: "c1",
  title: "Mystery Box",
  image_url: null,
  orders_per_box: 5,
  boxes_per_day: 1,
  reward_text: "5GB or more",
  bullets: ["Open it to win 5GB or more."],
  ends_at: "2099-01-01T00:00:00Z",
};
// The watcher's in-memory fallback lives for the whole test file, so each test uses its own day.
let testDay = 0;
const prog = (q: number): MysteryProgress => ({
  qualifying_orders: q,
  boxes_earned: q >= 5 ? 1 : 0,
  boxes_opened: 0,
  boxes_available: q >= 5 ? 1 : 0,
  orders_to_next: q >= 5 ? 0 : 5 - q,
  today: `2026-12-${String(testDay).padStart(2, "0")}`,
});
const hook = {
  current: { campaign, progress: prog(0), state: "locked", isLoading: false, open: vi.fn(), refresh },
};
vi.mock("@/hooks/useMysteryBox", () => ({ useMysteryBox: () => hook.current }));

import { MysteryBoxWatcher } from "@/components/MysteryBoxWatcher";

const setCount = (q: number) => {
  hook.current = { ...hook.current, progress: prog(q), state: q >= 5 ? "available" : "locked" };
};

const memoryStorage = () => {
  const mem = new Map<string, string>();
  return {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  };
};

beforeEach(() => {
  testDay += 1;
  vi.stubGlobal("localStorage", memoryStorage());
  channelOn.mockReset();
  channelNames.length = 0;
  removeChannel.mockReset();
  refresh.mockReset();
  handler = null;
  auth.current = { user: { id: "u1" }, profile: { phone: "0241234567" }, isAdmin: false };
  setCount(0);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MysteryBoxWatcher", () => {
  it("stays quiet before any delivered order today", () => {
    render(<MysteryBoxWatcher />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("pops up after a delivered order, once per new count", async () => {
    setCount(1);
    render(<MysteryBoxWatcher />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Today: 1/5 orders · 4 more to unlock")).toBeInTheDocument();

    cleanup();
    render(<MysteryBoxWatcher />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    cleanup();
    setCount(2);
    render(<MysteryBoxWatcher />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("listens to the customer's own orders and refreshes when one is delivered", () => {
    render(<MysteryBoxWatcher />);
    expect(channelOn).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ event: "UPDATE", table: "orders", filter: "agent_id=eq.u1" }),
      expect.any(Function),
    );
    act(() => handler?.({ new: { status: "processing" } }));
    expect(refresh).not.toHaveBeenCalled();
    act(() => handler?.({ new: { status: "fulfilled" } }));
    expect(refresh).toHaveBeenCalledTimes(1);
    cleanup();
    expect(removeChannel).toHaveBeenCalled();
  });

  it("keeps pop-up memory separate for each account on the device", async () => {
    setCount(1);
    render(<MysteryBoxWatcher />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    cleanup();
    auth.current = { ...auth.current, user: { id: "u2" } };
    render(<MysteryBoxWatcher />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("does not pop up again after today's box is opened", () => {
    hook.current = {
      ...hook.current,
      progress: { ...prog(7), boxes_opened: 1, boxes_available: 0 },
      state: "done",
    };
    render(<MysteryBoxWatcher />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses a fresh realtime channel name on every mount", () => {
    render(<MysteryBoxWatcher />);
    cleanup();
    render(<MysteryBoxWatcher />);
    expect(channelNames).toHaveLength(2);
    expect(channelNames[0]).not.toBe(channelNames[1]);
    expect(channelNames[0]).toMatch(/^mystery-box-orders-u1-/);
  });

  it("does nothing for admins or signed-out visitors", () => {
    auth.current = { ...auth.current, isAdmin: true };
    setCount(1);
    const { container } = render(<MysteryBoxWatcher />);
    expect(container).toBeEmptyDOMElement();
    expect(channelOn).not.toHaveBeenCalled();
    cleanup();
    auth.current = { ...auth.current, isAdmin: false, user: null };
    render(<MysteryBoxWatcher />);
    expect(channelOn).not.toHaveBeenCalled();
  });

  it("still pops up once when localStorage throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    setCount(3);
    render(<MysteryBoxWatcher />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    cleanup();
    render(<MysteryBoxWatcher />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
