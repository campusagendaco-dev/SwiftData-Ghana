import { describe, it, expect } from "vitest";
import { allowsSiblingDedup, mysteryBoxError, prizeOrderGuard, routingOrderType, toLocalGhPhone } from "../../supabase/functions/_shared/mystery_box";
import {
  boxState,
  DONE_TODAY_TEXT,
  lockedButtonLabel,
  packageSizeGb,
  progressLine,
  rememberSeen,
  seenKey,
  shouldPopUp,
  type MysteryProgress,
} from "@/lib/mysteryBox";

const order = { id: "o1", agent_id: "u1", customer_phone: "0241234567" };
const open = { order_id: "o1", user_id: "u1", recipient_phone: "0241234567" };

describe("prizeOrderGuard", () => {
  it("rejects a prize order with no open record", () => {
    expect(prizeOrderGuard(order, null)).toBe("No mystery box record for this order");
  });
  it("rejects when the order owner differs from the opener", () => {
    expect(prizeOrderGuard({ ...order, agent_id: "other" }, open)).toBe("Mystery box owner mismatch");
  });
  it("rejects when the recipient phone was changed", () => {
    expect(prizeOrderGuard({ ...order, customer_phone: "0249999999" }, open)).toBe("Mystery box recipient mismatch");
  });
  it("rejects when the open record belongs to a different order", () => {
    expect(prizeOrderGuard(order, { ...open, order_id: "o2" })).toBe("No mystery box record for this order");
  });
  it("accepts a matching order", () => {
    expect(prizeOrderGuard(order, open)).toBeNull();
  });
});

describe("toLocalGhPhone", () => {
  it("normalises international and short formats", () => {
    expect(toLocalGhPhone("+233 24 123 4567")).toBe("0241234567");
    expect(toLocalGhPhone("233241234567")).toBe("0241234567");
    expect(toLocalGhPhone("241234567")).toBe("0241234567");
    expect(toLocalGhPhone("0551234567")).toBe("0551234567");
  });
  it("rejects invalid numbers", () => {
    expect(toLocalGhPhone("0741234567")).toBeNull();
    expect(toLocalGhPhone("abc")).toBeNull();
    expect(toLocalGhPhone("")).toBeNull();
    expect(toLocalGhPhone(null)).toBeNull();
  });
});

const p0: MysteryProgress = {
  qualifying_orders: 0, boxes_earned: 0, boxes_opened: 0, boxes_available: 0, orders_to_next: 5, today: "2026-11-23",
};

describe("progress copy", () => {
  it("shows today's progress toward the daily target", () => {
    expect(progressLine(p0, 5)).toBe("Today: 0/5 orders · 5 more to unlock");
    expect(progressLine({ ...p0, qualifying_orders: 1, orders_to_next: 4 }, 5)).toBe("Today: 1/5 orders · 4 more to unlock");
  });
  it("tells the customer how many more orders today earn the reward", () => {
    expect(lockedButtonLabel(4, "5GB or more")).toBe("Complete 4 more orders today to earn 5GB or more");
    expect(lockedButtonLabel(1, "5GB or more")).toBe("Complete 1 more order today to earn 5GB or more");
  });
  it("has the opened-today text", () => {
    expect(DONE_TODAY_TEXT).toBe("You've opened today's box. Come back tomorrow!");
  });
});

describe("boxState", () => {
  it("is locked with no box earned today", () => {
    expect(boxState(p0, 1)).toBe("locked");
  });
  it("is available when today's box is unopened", () => {
    expect(boxState({ ...p0, qualifying_orders: 5, boxes_earned: 1, boxes_available: 1, orders_to_next: 0 }, 1)).toBe("available");
  });
  it("is done once today's boxes are opened", () => {
    expect(boxState({ ...p0, qualifying_orders: 6, boxes_earned: 1, boxes_opened: 1, orders_to_next: 0 }, 1)).toBe("done");
  });
});

describe("pop-up memory", () => {
  const makeStore = () => {
    const mem = new Map<string, string>();
    return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  };

  it("uses a per-user, per-campaign, per-day key", () => {
    expect(seenKey("u1", "c1", "2026-11-23")).toBe("swift_mystery_box_seen_u1_c1_2026-11-23");
  });
  it("pops up only when today's count rises above what was last seen", () => {
    const s = makeStore();
    expect(shouldPopUp("u1", "c1", "2026-11-23", 0, s)).toBe(false);
    expect(shouldPopUp("u1", "c1", "2026-11-23", 1, s)).toBe(true);
    rememberSeen("u1", "c1", "2026-11-23", 1, s);
    expect(shouldPopUp("u1", "c1", "2026-11-23", 1, s)).toBe(false);
    expect(shouldPopUp("u1", "c1", "2026-11-23", 2, s)).toBe(true);
    expect(shouldPopUp("u1", "c1", "2026-11-24", 1, s)).toBe(true);
    expect(shouldPopUp("u2", "c1", "2026-11-23", 1, s)).toBe(true);
  });
  it("falls back to memory when storage throws or is missing", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(shouldPopUp("u1", "mem1", "2026-11-23", 1, throwing)).toBe(true);
    expect(() => rememberSeen("u1", "mem1", "2026-11-23", 1, throwing)).not.toThrow();
    expect(shouldPopUp("u1", "mem1", "2026-11-23", 1, throwing)).toBe(false);
    expect(shouldPopUp("u2", "mem1", "2026-11-23", 1, throwing)).toBe(true);
    expect(shouldPopUp("u1", "mem2", "2026-11-23", 1, null)).toBe(true);
    rememberSeen("u1", "mem2", "2026-11-23", 1, null);
    expect(shouldPopUp("u1", "mem2", "2026-11-23", 1, null)).toBe(false);
  });
});

describe("packageSizeGb", () => {
  it("parses bundle sizes into GB", () => {
    expect(packageSizeGb("5GB")).toBe(5);
    expect(packageSizeGb("10 GB")).toBe(10);
    expect(packageSizeGb("512MB")).toBe(0.5);
    expect(packageSizeGb("1TB")).toBe(1024);
    expect(packageSizeGb("abc")).toBeNull();
  });
});

describe("mysteryBoxError", () => {
  it("maps database exceptions to a code and friendly message", () => {
    expect(mysteryBoxError("not_eligible")).toEqual({
      error: "not_eligible",
      message: "You don't have a box to open yet. Keep ordering to unlock one!",
    });
    expect(mysteryBoxError("out_of_stock").error).toBe("out_of_stock");
    expect(mysteryBoxError("campaign_closed").message).toBe("This Mystery Box campaign has ended.");
    expect(mysteryBoxError("invalid_phone").message).toBe("Enter a valid Ghana number, e.g. 024 123 4567.");
  });
  it("falls back for unknown errors", () => {
    expect(mysteryBoxError("duplicate key value violates unique constraint")).toEqual({
      error: "open_failed",
      message: "We couldn't open your box right now. Please try again.",
    });
    expect(mysteryBoxError(undefined).error).toBe("open_failed");
  });
});

describe("routingOrderType", () => {
  it("routes mystery box prizes as data and leaves other types alone", () => {
    expect(routingOrderType("mystery_box_prize")).toBe("data");
    expect(routingOrderType("MYSTERY_BOX_PRIZE")).toBe("data");
    expect(routingOrderType("free_data_claim")).toBe("free_data_claim");
    expect(routingOrderType("airtime")).toBe("airtime");
    expect(routingOrderType(null)).toBe("data");
  });
});

describe("allowsSiblingDedup", () => {
  it("never treats two distinct prize orders as duplicates of each other", () => {
    expect(allowsSiblingDedup("mystery_box_prize")).toBe(false);
    expect(allowsSiblingDedup("data")).toBe(true);
    expect(allowsSiblingDedup("free_data_claim")).toBe(true);
  });
});
