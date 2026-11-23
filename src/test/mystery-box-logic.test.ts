import { describe, it, expect } from "vitest";
import { prizeOrderGuard, toLocalGhPhone } from "../../supabase/functions/_shared/mystery_box";
import {
  boxState,
  dismissKey,
  lockedButtonLabel,
  progressLine,
  rememberDismiss,
  shouldAutoShow,
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

const p0: MysteryProgress = { qualifying_orders: 0, boxes_earned: 0, boxes_opened: 0, boxes_available: 0, orders_to_next: 2 };

describe("progress copy", () => {
  it("shows the starting progress line", () => {
    expect(progressLine(p0, 2)).toBe("Progress: 0/2 qualifying orders · 2 more to unlock");
  });
  it("counts progress toward the next box after one is earned", () => {
    expect(progressLine({ ...p0, qualifying_orders: 3, boxes_earned: 1, orders_to_next: 1 }, 2)).toBe(
      "Progress: 1/2 qualifying orders · 1 more to unlock",
    );
  });
  it("pluralises the locked button", () => {
    expect(lockedButtonLabel(2)).toBe("Place 2 orders to unlock");
    expect(lockedButtonLabel(1)).toBe("Place 1 order to unlock");
  });
});

describe("boxState", () => {
  it("is locked with no boxes earned", () => {
    expect(boxState(p0, 3)).toBe("locked");
  });
  it("is available when an unopened box exists", () => {
    expect(boxState({ ...p0, boxes_earned: 1, boxes_available: 1 }, 3)).toBe("available");
  });
  it("is done when every box is opened", () => {
    expect(boxState({ ...p0, boxes_earned: 3, boxes_opened: 3 }, 3)).toBe("done");
  });
});

describe("dismissal", () => {
  const makeStore = () => {
    const mem = new Map<string, string>();
    return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  };

  it("uses a per-campaign key", () => {
    expect(dismissKey("c1")).toBe("swift_mystery_box_dismissed_c1");
  });
  it("shows until dismissed, then again only when a new box is earned", () => {
    const s = makeStore();
    expect(shouldAutoShow("c1", 0, s)).toBe(true);
    rememberDismiss("c1", 0, s);
    expect(shouldAutoShow("c1", 0, s)).toBe(false);
    expect(shouldAutoShow("c1", 1, s)).toBe(true);
    expect(shouldAutoShow("c2", 0, s)).toBe(true);
  });
  it("survives storage that throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(shouldAutoShow("c1", 0, throwing)).toBe(true);
    expect(() => rememberDismiss("c1", 0, throwing)).not.toThrow();
    expect(shouldAutoShow("c1", 0, null)).toBe(true);
  });
});
