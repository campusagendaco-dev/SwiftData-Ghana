import { useEffect, useRef, useState } from "react";
import { Gift } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useMysteryBox } from "@/hooks/useMysteryBox";
import { progressLine, rememberDismiss, shouldAutoShow } from "@/lib/mysteryBox";
import { MysteryBoxModal } from "@/components/MysteryBoxModal";

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Dashboard progress row for the live Mystery Box campaign; auto-opens the popup when there's news. */
export function MysteryBoxCard() {
  const { isAdmin } = useAuth();
  const { campaign, progress, state } = useMysteryBox();
  const [open, setOpen] = useState(false);
  const lastAutoKey = useRef<string | null>(null);

  useEffect(() => {
    if (!campaign || !progress || isAdmin) return;
    const key = `${campaign.id}:${progress.boxes_available}`;
    if (lastAutoKey.current === key) return;
    lastAutoKey.current = key;
    if (shouldAutoShow(campaign.id, progress.boxes_available, sessionStore())) setOpen(true);
  }, [campaign, progress, isAdmin]);

  if (!campaign || !progress || !state || isAdmin) return null;

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) rememberDismiss(campaign.id, progress.boxes_available, sessionStore());
  };

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
              ? "You've opened all your boxes. Thanks!"
              : state === "available"
                ? "Your box is ready to open! 🎁"
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
      <MysteryBoxModal open={open} onOpenChange={handleOpenChange} />
    </>
  );
}

export default MysteryBoxCard;
