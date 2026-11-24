import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// Chainable Supabase stand-in: records eq() filters and answers per table. Campaign B's prizes
// never arrive, to show the preview doesn't reuse campaign A's prizes while B loads.
const never = new Promise(() => {});
function respond(table: string, filters: Record<string, unknown>): Promise<unknown> {
  if (table === "mystery_box_campaigns") return Promise.resolve({ data: [campaignA, campaignB], error: null });
  if (table === "mystery_box_prizes") {
    return filters.campaign_id === "A" ? Promise.resolve({ data: [prizeA], error: null }) : never;
  }
  return Promise.resolve({ data: [], error: null });
}
function builder(table: string) {
  const filters: Record<string, unknown> = {};
  const proxy: any = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === "then") return (res: any, rej: any) => respond(table, filters).then(res, rej);
        if (key === "eq") return (col: string, val: unknown) => ((filters[col] = val), proxy);
        return () => proxy;
      },
    },
  );
  return proxy;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => builder(t), rpc: () => builder("rpc"), storage: { from: () => builder("storage") } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin" }, profile: null, isAdmin: true }) }));

const base = {
  description: "",
  image_url: null,
  starts_at: "2026-11-01T00:00:00Z",
  ends_at: "2099-01-01T00:00:00Z",
  is_active: false,
  orders_per_box: 5,
  boxes_per_day: 1,
  reward_text: "5GB or more",
  min_order_amount: 0,
  bullets: ["Open it to win 5GB or more."],
};
const campaignA = { ...base, id: "A", title: "Campaign A" };
const campaignB = { ...base, id: "B", title: "Campaign B" };
const prizeA = {
  id: "pa",
  campaign_id: "A",
  label: "10GB A",
  network: "MTN",
  package_size: "10GB",
  is_mashup: false,
  weight: 1,
  stock_total: null,
  stock_remaining: null,
  is_active: true,
};

import AdminMysteryBox from "@/pages/AdminMysteryBox";

beforeEach(() => {
  (URL as any).createObjectURL = vi.fn(() => "blob:preview-image");
  (URL as any).revokeObjectURL = vi.fn();
});
afterEach(() => cleanup());

describe("AdminMysteryBox preview button", () => {
  it("previews unsaved form edits and a newly chosen image", async () => {
    const { container } = render(<AdminMysteryBox />);
    fireEvent.click(await screen.findByRole("button", { name: /Campaign A/ }));
    fireEvent.change(screen.getByLabelText("Reward wording"), { target: { value: "7GB" } });
    const file = new File(["x"], "box.png", { type: "image/png" });
    fireEvent.change(container.querySelector("#mb-image") as HTMLInputElement, { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("button", { name: "Complete 4 more orders today to earn 7GB" })).toBeInTheDocument();
    expect(document.querySelector('img[src="blob:preview-image"]')).not.toBeNull();
  });

  it("does not show the previous campaign's prize while the next one loads", async () => {
    render(<AdminMysteryBox />);
    fireEvent.click(await screen.findByRole("button", { name: /Campaign A/ }));
    await waitFor(() => expect(screen.getAllByText("10GB A").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /Campaign B/ }));

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Opened" }));
    expect(await screen.findByText("You won 5GB MTN Data! 🎉")).toBeInTheDocument();
  });
});
