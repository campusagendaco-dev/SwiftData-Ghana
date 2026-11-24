import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { guestBoxProgress } from "@/components/GuestMysteryBoxBanner";

const row = (o: Partial<Parameters<typeof guestBoxProgress>[0]> = {}) => ({
  orders_per_box: 5, qualifying_orders: 0, boxes_available: 0, orders_to_next: 5, pending_orders: 0, ...o,
});

describe("guest Mystery Box progress", () => {
  it("counts delivered purchases only; pending ones don't move the bar", () => {
    const p = guestBoxProgress(row({ qualifying_orders: 2, orders_to_next: 3, pending_orders: 3 }));
    expect(p).toMatchObject({ done: 2, remaining: 3, pending: 3, isReady: false, pct: 40 });
  });

  it("shows a full bar when a box is earned", () => {
    expect(guestBoxProgress(row({ qualifying_orders: 5, boxes_available: 1, orders_to_next: 5 }))).toMatchObject({ isReady: true, done: 5, remaining: 0, pct: 100 });
  });

  it("starts the next box from zero after a full one", () => {
    expect(guestBoxProgress(row({ qualifying_orders: 0 }))).toMatchObject({ done: 0, remaining: 5, pct: 0 });
  });
});

describe("guest lookup never takes a typed phone number", () => {
  const src = join(__dirname, "..");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (f !== "test") walk(p); }
      else if (/\.tsx?$/.test(f)) files.push(p);
    }
  };
  walk(src);

  it("no page calls the old lookup by phone", () => {
    const hits = files.filter((f) => /["'`]guest_mystery_box_progress["'`]/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the banner looks up by order reference and both pages pass one", () => {
    const banner = readFileSync(join(src, "components", "GuestMysteryBoxBanner.tsx"), "utf8");
    expect(banner).toMatch(/rpc\("guest_mystery_box_progress_for_order",\s*\{\s*p_reference: ref/);
    for (const page of ["PurchaseSuccess.tsx", "OrderStatus.tsx"]) {
      const s = readFileSync(join(src, "pages", page), "utf8");
      expect(s, page).toMatch(/<GuestMysteryBoxBanner reference=\{/);
    }
  });
});
