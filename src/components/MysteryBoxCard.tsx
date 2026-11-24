import { useState } from "react";
import { Gift, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useMysteryBox } from "@/hooks/useMysteryBox";
import { DONE_TODAY_TEXT, READY_TEXT, progressLine } from "@/lib/mysteryBox";
import { MysteryBoxModal } from "@/components/MysteryBoxModal";

/**
 * Animated dashboard progress row for today's Mystery Box. It never opens the popup by itself —
 * MysteryBoxWatcher does that after a delivered order — but lets the customer reopen it.
 */
export function MysteryBoxCard() {
  const { isAdmin } = useAuth();
  const { campaign, progress, state } = useMysteryBox();
  const [open, setOpen] = useState(false);

  if (!campaign || !progress || !state || isAdmin) return null;

  const isAvailable = state === "available";
  const isDone = state === "done";
  const target = Math.max(1, campaign.orders_per_box || 1);
  const towardNext = Math.min(Math.max(progress.qualifying_orders - progress.boxes_earned * target, 0), target);
  const progressPct = isAvailable || isDone ? 100 : Math.round((towardNext / target) * 100);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        whileHover={{ y: -2 }}
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`group relative cursor-pointer overflow-hidden rounded-2xl border p-3.5 shadow-sm transition-colors ${
          isAvailable
            ? "border-amber-400/60 bg-gradient-to-r from-violet-950/60 via-fuchsia-950/40 to-amber-950/40 shadow-lg shadow-amber-500/10"
            : "border-border bg-card hover:border-violet-500/40"
        }`}
      >
        {/* Ambient shimmer sweep */}
        <motion.div
          aria-hidden
          initial={{ x: "-120%" }}
          animate={{ x: "220%" }}
          transition={{
            repeat: Infinity,
            repeatDelay: isAvailable ? 2.2 : 5.5,
            duration: 1.4,
            ease: "easeInOut",
          }}
          className={`pointer-events-none absolute inset-y-0 w-1/3 -skew-x-12 ${
            isAvailable
              ? "bg-gradient-to-r from-transparent via-amber-300/20 to-transparent"
              : "bg-gradient-to-r from-transparent via-violet-400/10 to-transparent"
          }`}
        />

        <div className="relative z-10 flex items-center gap-3.5">
          {/* Animated Gift Icon */}
          <div className="relative shrink-0">
            {isAvailable && (
              <motion.span
                aria-hidden
                animate={{ scale: [1, 1.35, 1], opacity: [0.55, 0, 0.55] }}
                transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
                className="absolute inset-0 rounded-xl bg-amber-400/50 blur-md"
              />
            )}
            <motion.div
              animate={
                isAvailable
                  ? {
                      rotate: [0, -12, 12, -9, 9, -4, 4, 0],
                      scale: [1, 1.1, 1.05, 1.1, 1],
                      y: [0, -3, 0],
                    }
                  : isDone
                    ? { scale: [1, 1.03, 1] }
                    : { y: [0, -3.5, 0], rotate: [0, -3, 3, 0] }
              }
              transition={{
                repeat: Infinity,
                repeatDelay: isAvailable ? 1.4 : 2.6,
                duration: isAvailable ? 1.1 : 2.2,
                ease: "easeInOut",
              }}
              className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-amber-500 shadow-md shadow-fuchsia-600/25"
            >
              <Gift className="h-6 w-6 text-amber-200 drop-shadow" />
              <motion.span
                aria-hidden
                animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.25, 0.8], rotate: [0, 20, 0] }}
                transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-black shadow"
              >
                <Sparkles className="h-2.5 w-2.5" />
              </motion.span>
            </motion.div>
          </div>

          {/* Copy + Animated Progress Bar */}
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <p className="truncate text-[14px] font-bold text-foreground">{campaign.title}</p>
              {isAvailable && (
                <motion.span
                  animate={{ scale: [1, 1.08, 1] }}
                  transition={{ repeat: Infinity, duration: 1.4 }}
                  className="shrink-0 rounded-full bg-amber-400/20 border border-amber-400/40 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-400"
                >
                  Ready!
                </motion.span>
              )}
            </div>

            <p className="truncate text-[12px] text-muted-foreground">
              {isDone
                ? DONE_TODAY_TEXT
                : isAvailable
                  ? READY_TEXT
                  : progressLine(progress, campaign.orders_per_box)}
            </p>

            {/* Progress bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/70">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                className={`h-full rounded-full ${
                  isAvailable
                    ? "bg-gradient-to-r from-amber-400 via-yellow-300 to-fuchsia-400"
                    : isDone
                      ? "bg-emerald-500"
                      : "bg-gradient-to-r from-violet-500 to-fuchsia-500"
                }`}
              />
            </div>
          </div>

          {/* Animated CTA Button */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.94 }}
            animate={isAvailable ? { scale: [1, 1.05, 1] } : undefined}
            transition={isAvailable ? { repeat: Infinity, duration: 1.8, ease: "easeInOut" } : undefined}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            className={
              isAvailable
                ? "shrink-0 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-300 px-3.5 py-2 text-[13px] font-black text-black shadow-md shadow-amber-400/30 hover:brightness-105"
                : "shrink-0 rounded-xl border border-border bg-background/60 px-3.5 py-2 text-[13px] font-semibold text-foreground hover:bg-muted"
            }
          >
            {isAvailable ? "Open now" : "View"}
          </motion.button>
        </div>
      </motion.div>

      <MysteryBoxModal open={open} onOpenChange={setOpen} />
    </>
  );
}

export default MysteryBoxCard;
