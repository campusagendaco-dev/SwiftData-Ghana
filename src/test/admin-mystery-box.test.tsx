import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { oddsPercent } from "@/lib/mysteryBox";

// The preview must never reach the server: any touch of the client is recorded and fails the test.
const serverTouched = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: new Proxy(
    {},
    {
      get: (_t, key) => {
        serverTouched(String(key));
        return () => {
          throw new Error("preview reached the server");
        };
      },
    },
  ),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin" }, profile: null, isAdmin: true }) }));

import { MysteryBoxPreview, previewSamplePrize } from "@/components/MysteryBoxPreview";

afterEach(() => cleanup());

describe("oddsPercent", () => {
  it("shares odds across active prizes only, to one decimal", () => {
    expect(oddsPercent([
      { weight: 1, is_active: true },
      { weight: 9, is_active: true },
      { weight: 5, is_active: false },
    ])).toEqual([10, 90, 0]);
    expect(oddsPercent([{ weight: 1, is_active: true }, { weight: 2, is_active: true }])).toEqual([33.3, 66.7]);
  });
  it("handles an empty or all-inactive pool", () => {
    expect(oddsPercent([])).toEqual([]);
    expect(oddsPercent([{ weight: 3, is_active: false }])).toEqual([0]);
  });
});

describe("previewSamplePrize", () => {
  it("uses the first active prize, or 5GB MTN Data when there is none", () => {
    expect(previewSamplePrize([])).toBe("5GB MTN Data");
    expect(previewSamplePrize([{ label: "1GB", is_active: false }])).toBe("5GB MTN Data");
    expect(previewSamplePrize([{ label: "1GB", is_active: false }, { label: "10GB MTN", is_active: true }])).toBe("10GB MTN");
  });
});

describe("MysteryBoxPreview", () => {
  const campaign = {
    title: "Mystery Box",
    image_url: null,
    orders_per_box: 5,
    boxes_per_day: 1,
    reward_text: "5GB or more",
    bullets: ["A", "  ", "B"],
  };

  it("walks through locked, ready and opened without touching the server", async () => {
    render(<MysteryBoxPreview open onOpenChange={vi.fn()} campaign={campaign} samplePrize="10GB MTN" />);
    expect(screen.getByText("Preview — nothing is sent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete 4 more orders today to earn 5GB or more" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Ready to open" }));
    expect(screen.getByRole("button", { name: "Open your box 🎁" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Opened" }));
    expect(await screen.findByText("You won 10GB MTN! 🎉")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Locked" }));
    expect(screen.getByRole("button", { name: "Complete 4 more orders today to earn 5GB or more" })).toBeInTheDocument();
    expect(serverTouched).not.toHaveBeenCalled();
  });

  it("reveals the sample prize from Ready to open, and switching state resets the reveal", async () => {
    render(<MysteryBoxPreview open onOpenChange={vi.fn()} campaign={campaign} samplePrize="10GB MTN" />);
    fireEvent.click(screen.getByRole("button", { name: "Ready to open" }));
    fireEvent.click(screen.getByRole("button", { name: "Open your box 🎁" }));
    expect(await screen.findByText("You won 10GB MTN! 🎉")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ready to open" }));
    expect(screen.getByRole("button", { name: "Open your box 🎁" })).toBeInTheDocument();
    expect(serverTouched).not.toHaveBeenCalled();
  });
});
