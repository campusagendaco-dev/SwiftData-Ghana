import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useMysteryBox, type MysteryCampaign, type OpenResult } from "@/hooks/useMysteryBox";
import {
  DONE_TODAY_TEXT,
  READY_TEXT,
  lockedButtonLabel,
  progressLine,
  type BoxState,
  type MysteryProgress,
} from "@/lib/mysteryBox";

type Phase = "idle" | "opening" | "revealed";

function GiftBoxArt() {
  return (
    <svg viewBox="0 0 200 170" className="h-full w-auto drop-shadow-[0_10px_30px_rgba(251,191,36,0.45)]" aria-hidden="true">
      <defs>
        <linearGradient id="mb-box" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#4c1d95" />
        </linearGradient>
        <linearGradient id="mb-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="160" rx="70" ry="8" fill="#fbbf24" opacity="0.35" />
      <rect x="35" y="70" width="130" height="88" rx="10" fill="url(#mb-box)" stroke="#fbbf24" strokeWidth="3" />
      <rect x="27" y="52" width="146" height="26" rx="8" fill="#6d28d9" stroke="#fbbf24" strokeWidth="3" />
      <rect x="92" y="52" width="16" height="106" fill="url(#mb-gold)" />
      <path d="M100 52 C80 20, 50 30, 70 50 Z M100 52 C120 20, 150 30, 130 50 Z" fill="url(#mb-gold)" />
      <text x="100" y="112" textAnchor="middle" fontSize="34" fontWeight="900" fill="url(#mb-gold)">?</text>
      <rect x="50" y="122" width="100" height="26" rx="8" fill="#3b0764" stroke="#fbbf24" strokeWidth="2" />
      <text x="100" y="140" textAnchor="middle" fontSize="13" fontWeight="900" fill="#fde68a" letterSpacing="1">MYSTERY BOX</text>
    </svg>
  );
}

/**
 * The customer popup itself, driven entirely by props. The connected MysteryBoxModal below feeds it
 * live data; the admin preview feeds it form values and fake callbacks, so a preview can never reach
 * the server.
 */
export function MysteryBoxDialog({
  open,
  onOpenChange,
  campaign,
  progress,
  state,
  onOpenBox,
  onGoBuy,
  defaultPhone = "",
  revealDelayMs = 900,
  preview = false,
  revealedPrize,
  toolbar,
  resetSignal,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaign: MysteryCampaign;
  progress: MysteryProgress;
  state: BoxState;
  onOpenBox: (phone: string) => Promise<OpenResult>;
  onGoBuy: () => void;
  defaultPhone?: string;
  revealDelayMs?: number;
  preview?: boolean;
  /** Preview only: show the reveal screen straight away with this prize. */
  revealedPrize?: string;
  /** Preview only: controls shown inside the popup (outside it, the modal blocks clicks). */
  toolbar?: ReactNode;
  /** Preview only: any change returns the popup to its first screen. */
  resetSignal?: unknown;
}) {
  const [phone, setPhone] = useState<string>(defaultPhone);
  const [phase, setPhase] = useState<Phase>("idle");
  const [revealed, setRevealed] = useState<string>("");
  const prize = revealedPrize ?? revealed;

  // Prefill from the profile when the popup opens (or the profile loads) without overwriting typing.
  useEffect(() => {
    if (open) {
      setPhone((current) => current || defaultPhone);
    } else {
      setPhase("idle");
      setRevealed("");
    }
  }, [open, defaultPhone]);

  useEffect(() => {
    setPhase("idle");
    setRevealed("");
  }, [resetSignal]);

  const handleOpen = async () => {
    setPhase("opening");
    const started = Date.now();
    const result = await onOpenBox(phone.trim());
    const wait = Math.max(revealDelayMs - (Date.now() - started), 0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    // `in` narrowing: this project's tsconfig isn't strict, so `success` alone doesn't narrow the union.
    if ("prize_label" in result) {
      setRevealed(result.prize_label);
      setPhase("revealed");
    } else {
      setPhase("idle");
      toast.error(result.message);
    }
  };

  const shownPhase: Phase = revealedPrize ? "revealed" : phase;
  const showBoxCount = campaign.boxes_per_day > 1 && state !== "done" && shownPhase !== "revealed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] w-[calc(100%-2rem)] p-0 gap-0 overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-2xl [&>button:last-child]:z-20 [&>button:last-child]:rounded-full [&>button:last-child]:bg-black/45 [&>button:last-child]:p-1.5 [&>button:last-child]:text-white [&>button:last-child]:opacity-100">
        {toolbar}
        {/* Hero */}
        <div className="relative h-56 overflow-hidden bg-gradient-to-b from-violet-950 via-purple-800 to-fuchsia-700">
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400/25 blur-3xl" />
          {preview ? (
            <span className="absolute left-3 top-3 z-10 inline-flex items-center rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-black shadow">
              Preview — nothing is sent
            </span>
          ) : (
            <span className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white shadow">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> LIVE
            </span>
          )}
          <AnimatePresence mode="wait">
            {shownPhase === "revealed" ? (
              <motion.div
                key="prize"
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 220, damping: 14 }}
                className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"
              >
                <div className="text-5xl" aria-hidden="true">🎁✨</div>
                <p className="mt-3 text-xl font-black text-amber-200 drop-shadow">You won {prize}! 🎉</p>
              </motion.div>
            ) : (
              <motion.div
                key="box"
                className="absolute inset-0 flex items-center justify-center p-4"
                animate={phase === "opening" ? { rotate: [0, -8, 8, -6, 6, -3, 3, 0], scale: [1, 1.05, 1] } : { rotate: 0, scale: 1 }}
                transition={phase === "opening" ? { duration: 0.8, repeat: Infinity } : { duration: 0.2 }}
              >
                {campaign.image_url ? (
                  <img src={campaign.image_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <GiftBoxArt />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Body */}
        <div className="space-y-3 p-4">
          <DialogTitle className="sr-only">{campaign.title}</DialogTitle>
          {shownPhase === "revealed" ? (
            <>
              <DialogDescription className="text-sm text-muted-foreground">
                Your prize is on its way to {phone.trim()}. It usually arrives within a few minutes.
              </DialogDescription>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="h-12 w-full rounded-xl bg-foreground text-sm font-semibold text-background transition hover:opacity-90"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <DialogDescription className="text-[13px] text-muted-foreground">
                {state === "done" ? DONE_TODAY_TEXT : state === "available" ? READY_TEXT : progressLine(progress, campaign.orders_per_box)}
              </DialogDescription>

              <ul className="space-y-2">
                {campaign.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-[14px] leading-snug text-foreground">
                    <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-amber-400 ring-2 ring-amber-200/60" aria-hidden="true" />
                    {b}
                  </li>
                ))}
              </ul>

              {showBoxCount && (
                <p className="text-xs font-medium text-muted-foreground">
                  Today's box {Math.min(progress.boxes_opened + 1, campaign.boxes_per_day)} of {campaign.boxes_per_day}
                </p>
              )}

              {state === "available" && (
                <div className="space-y-1">
                  <label htmlFor="mystery-box-phone" className="text-xs font-medium text-muted-foreground">
                    Send prize to
                  </label>
                  <Input
                    id="mystery-box-phone"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="024 123 4567"
                    disabled={phase === "opening"}
                  />
                </div>
              )}

              {state === "available" && (
                <button
                  type="button"
                  onClick={handleOpen}
                  disabled={phase === "opening" || !phone.trim()}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-foreground text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-60"
                >
                  {phase === "opening" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Opening…
                    </>
                  ) : (
                    "Open your box 🎁"
                  )}
                </button>
              )}

              {state === "locked" && (
                <button
                  type="button"
                  onClick={onGoBuy}
                  className="h-12 w-full rounded-xl bg-foreground text-sm font-semibold text-background transition hover:opacity-90"
                >
                  {lockedButtonLabel(progress.orders_to_next, campaign.reward_text)}
                </button>
              )}

              {state === "done" && (
                <button
                  type="button"
                  disabled
                  className="h-12 w-full rounded-xl bg-muted text-sm font-semibold text-muted-foreground"
                >
                  {DONE_TODAY_TEXT}
                </button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MysteryBoxModal({
  open,
  onOpenChange,
  revealDelayMs = 900,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  revealDelayMs?: number;
}) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { campaign, progress, state, open: openBox } = useMysteryBox();

  if (!campaign || !progress || !state) return null;

  const goBuy = () => {
    onOpenChange(false);
    navigate("/dashboard/buy-data/mtn");
  };

  return (
    <MysteryBoxDialog
      open={open}
      onOpenChange={onOpenChange}
      campaign={campaign}
      progress={progress}
      state={state}
      onOpenBox={openBox}
      onGoBuy={goBuy}
      defaultPhone={profile?.phone || ""}
      revealDelayMs={revealDelayMs}
    />
  );
}

export default MysteryBoxModal;
