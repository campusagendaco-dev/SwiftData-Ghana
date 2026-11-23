import { useState } from "react";
import { MysteryBoxDialog } from "@/components/MysteryBoxModal";
import type { MysteryCampaign, OpenResult } from "@/hooks/useMysteryBox";
import type { BoxState, MysteryProgress } from "@/lib/mysteryBox";

const FALLBACK_PRIZE = "5GB MTN Data";
const SAMPLE_PHONE = "0241234567";

type PreviewMode = "locked" | "ready" | "opened";

const MODES: { mode: PreviewMode; label: string }[] = [
  { mode: "locked", label: "Locked" },
  { mode: "ready", label: "Ready to open" },
  { mode: "opened", label: "Opened" },
];

export type PreviewCampaign = Pick<
  MysteryCampaign,
  "title" | "image_url" | "orders_per_box" | "boxes_per_day" | "reward_text" | "bullets"
>;

/** The prize shown on the preview's reveal screen: the first active prize, or a stand-in. */
export function previewSamplePrize(prizes: { label: string; is_active: boolean }[]): string {
  return prizes.find((p) => p.is_active && p.label.trim())?.label ?? FALLBACK_PRIZE;
}

function sampleProgress(mode: PreviewMode, ordersPerBox: number): MysteryProgress {
  const target = Math.max(1, Math.floor(ordersPerBox) || 1);
  const today = new Date().toISOString().slice(0, 10);
  if (mode === "locked") {
    const done = target > 1 ? 1 : 0;
    return { qualifying_orders: done, boxes_earned: 0, boxes_opened: 0, boxes_available: 0, orders_to_next: target - done, today };
  }
  return { qualifying_orders: target, boxes_earned: 1, boxes_opened: 0, boxes_available: 1, orders_to_next: 0, today };
}

/**
 * Admin-only look at the customer popup, built from the campaign form. It renders the same
 * MysteryBoxDialog customers see but with fake callbacks, so it never opens a box, uses stock,
 * creates an order or navigates.
 */
export function MysteryBoxPreview({
  open,
  onOpenChange,
  campaign,
  samplePrize,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaign: PreviewCampaign;
  samplePrize: string;
}) {
  const [mode, setMode] = useState<PreviewMode>("locked");
  const [switches, setSwitches] = useState(0);

  const previewCampaign: MysteryCampaign = {
    id: "preview",
    ends_at: new Date(Date.now() + 86_400_000).toISOString(),
    ...campaign,
    bullets: campaign.bullets.filter((b) => typeof b === "string" && b.trim()),
  };
  const progress = sampleProgress(mode, campaign.orders_per_box);
  const state: BoxState = mode === "locked" ? "locked" : "available";
  const fakeOpen = async (): Promise<OpenResult> => ({ success: true, prize_label: samplePrize, order_id: "preview" });

  const toolbar = (
    <div role="group" aria-label="Preview state" className="flex gap-1 border-b border-border bg-muted/60 p-1.5 pr-12">
      {MODES.map(({ mode: m, label }) => (
        <button
          key={m}
          type="button"
          onClick={() => {
            setMode(m);
            setSwitches((n) => n + 1);
          }}
          aria-pressed={mode === m}
          className={`flex-1 rounded-full px-2 py-1.5 text-xs font-semibold transition ${
            mode === m ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <MysteryBoxDialog
      open={open}
      onOpenChange={onOpenChange}
      campaign={previewCampaign}
      progress={progress}
      state={state}
      onOpenBox={fakeOpen}
      onGoBuy={() => undefined}
      defaultPhone={SAMPLE_PHONE}
      preview
      revealedPrize={mode === "opened" ? samplePrize : undefined}
      toolbar={toolbar}
      resetSignal={switches}
    />
  );
}

export default MysteryBoxPreview;
