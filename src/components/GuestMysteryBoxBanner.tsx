import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Gift, Sparkles, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { normalizeGhanaPhoneInput } from "@/components/PhoneOtpField";

interface GuestProgressRow {
  campaign_id: string;
  title: string;
  orders_per_box: number;
  boxes_per_day: number;
  qualifying_orders: number;
  pending_orders: number;
  boxes_available: number;
  orders_to_next: number;
}

interface GuestMysteryBoxBannerProps {
  phone?: string | null;
  className?: string;
}

/**
 * Animated Mystery Box progress & signup CTA for guest (non-account) buyers.
 * Credits their guest orders automatically once they verify the same phone number via SMS OTP.
 */
export function GuestMysteryBoxBanner({ phone, className = "" }: GuestMysteryBoxBannerProps) {
  const { user } = useAuth();
  const [data, setData] = useState<GuestProgressRow | null>(null);

  const normalized = normalizeGhanaPhoneInput(phone || "");

  useEffect(() => {
    if (user || !/^0\d{9}$/.test(normalized)) {
      setData(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data: rows, error } = await (supabase as any).rpc("guest_mystery_box_progress", {
          p_phone: normalized,
        });
        if (cancelled || error) return;
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (row?.campaign_id) {
          setData(row as GuestProgressRow);
        }
      } catch {
        // Ignore if RPC not migrated yet
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, normalized]);

  if (user || !data) return null;

  const target = Math.max(1, data.orders_per_box || 1);
  const effectiveCount = data.qualifying_orders + data.pending_orders;
  const isReady = data.boxes_available > 0;
  const shownCount = isReady ? target : Math.min(effectiveCount % target || (effectiveCount > 0 ? target : 0), target);
  const progressPct = isReady ? 100 : Math.min(100, Math.round((shownCount / target) * 100));
  const remaining = isReady ? 0 : Math.max(0, target - shownCount);
  const signupUrl = `/signup?phone=${encodeURIComponent(normalized)}&mystery_box=1`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`relative overflow-hidden rounded-2xl border p-4 ${
        isReady
          ? "border-amber-400/60 bg-gradient-to-br from-violet-950/75 via-fuchsia-950/50 to-amber-950/45 shadow-lg shadow-amber-500/15"
          : "border-violet-500/35 bg-gradient-to-br from-violet-950/45 via-card to-fuchsia-950/30 shadow-md"
      } ${className}`}
    >
      {/* Shimmer sweep */}
      <motion.div
        aria-hidden
        initial={{ x: "-120%" }}
        animate={{ x: "220%" }}
        transition={{ repeat: Infinity, repeatDelay: isReady ? 2.2 : 4.8, duration: 1.4, ease: "easeInOut" }}
        className="pointer-events-none absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-amber-300/15 to-transparent"
      />

      <div className="relative z-10 flex items-start gap-3.5">
        <div className="relative shrink-0 mt-0.5">
          {isReady && (
            <motion.span
              aria-hidden
              animate={{ scale: [1, 1.35, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ repeat: Infinity, duration: 1.7 }}
              className="absolute inset-0 rounded-xl bg-amber-400/50 blur-md"
            />
          )}
          <motion.div
            animate={
              isReady
                ? { rotate: [0, -12, 12, -8, 8, 0], scale: [1, 1.1, 1], y: [0, -3, 0] }
                : { y: [0, -3, 0], rotate: [0, -3, 3, 0] }
            }
            transition={{ repeat: Infinity, repeatDelay: isReady ? 1.5 : 2.8, duration: 1.2, ease: "easeInOut" }}
            className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-amber-500 shadow-md"
          >
            <Gift className="h-5 w-5 text-amber-200" />
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-black shadow">
              <Sparkles className="h-2.5 w-2.5" />
            </span>
          </motion.div>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">
                {data.title || "Mystery Box Reward"}
              </span>
              {isReady && (
                <span className="rounded-full bg-amber-400/20 border border-amber-400/40 px-2 py-0.5 text-[9px] font-black uppercase text-amber-300">
                  Unlocked!
                </span>
              )}
            </div>
            <p className="text-[13.5px] font-bold text-foreground leading-snug mt-0.5">
              {isReady
                ? "Your FREE Data Mystery Box is ready to open!"
                : `${shownCount}/${target} orders today toward FREE data!`}
            </p>
            <p className="text-[12px] text-muted-foreground leading-relaxed mt-0.5">
              {isReady
                ? `Create a free account with ${normalized} (verified via SMS OTP) to open your box immediately.`
                : remaining > 0
                  ? `Complete ${remaining} more order${remaining === 1 ? "" : "s"} today with ${normalized} — sign up free to save your progress & claim.`
                  : `Once your order delivers, verify ${normalized} on a free account to open your Mystery Box!`}
            </p>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/70">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className={`h-full rounded-full ${
                isReady
                  ? "bg-gradient-to-r from-amber-400 via-yellow-300 to-fuchsia-400"
                  : "bg-gradient-to-r from-violet-500 to-fuchsia-500"
              }`}
            />
          </div>

          <Link
            to={signupUrl}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-[12.5px] font-bold transition active:scale-95 ${
              isReady
                ? "w-full bg-gradient-to-r from-amber-400 to-yellow-300 text-black shadow-md shadow-amber-400/25 hover:brightness-105"
                : "w-full bg-primary/15 border border-primary/30 text-primary hover:bg-primary/25"
            }`}
          >
            {isReady ? "Claim Free Data with Account" : "Save Progress & Unlock Free Data"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

export default GuestMysteryBoxBanner;
