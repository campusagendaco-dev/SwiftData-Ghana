import { useState } from "react";
import { Gift } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useMysteryBox } from "@/hooks/useMysteryBox";
import { DONE_TODAY_TEXT, READY_TEXT, progressLine } from "@/lib/mysteryBox";
import { MysteryBoxModal } from "@/components/MysteryBoxModal";

/**
 * Dashboard progress row for today's Mystery Box. It never opens the popup by itself —
 * MysteryBoxWatcher does that after a delivered order — but lets the customer reopen it.
 */
export function MysteryBoxCard() {
  const { isAdmin } = useAuth();
  const { campaign, progress, state } = useMysteryBox();
  const [open, setOpen] = useState(false);

  if (!campaign || !progress || !state || isAdmin) return null;

  return (
    <>
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-700 to-fuchsia-600 shadow-inner">
          <Gift className="h-5 w-5 text-amber-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-foreground">{campaign.title}</p>
          <p className="truncate text-[12px] text-muted-foreground">
            {state === "done"
              ? DONE_TODAY_TEXT
              : state === "available"
                ? READY_TEXT
                : progressLine(progress, campaign.orders_per_box)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            state === "available"
              ? "shrink-0 rounded-lg bg-amber-400 px-3 py-2 text-[13px] font-bold text-black hover:bg-amber-300"
              : "shrink-0 rounded-lg border border-border px-3 py-2 text-[13px] font-semibold text-foreground hover:bg-muted"
          }
        >
          {state === "available" ? "Open now" : "View"}
        </button>
      </div>
      <MysteryBoxModal open={open} onOpenChange={setOpen} />
    </>
  );
}

export default MysteryBoxCard;
