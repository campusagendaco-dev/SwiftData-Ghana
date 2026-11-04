import React from "react";
import { Link } from "react-router-dom";
import { Award, Zap, Trophy, TrendingUp, Sparkles, ChevronRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AgentTierRecommenderCardProps {
  totalOrders: number;
  totalSales: number;
}

interface TierInfo {
  name: string;
  badge: string;
  icon: typeof Trophy;
  minOrders: number;
  maxOrders: number;
  bonus: string;
  color: string;
  bgGrad: string;
  borderColor: string;
}

const TIERS: TierInfo[] = [
  {
    name: "Bronze Agent",
    badge: "🥉 Tier 1",
    icon: Trophy,
    minOrders: 0,
    maxOrders: 50,
    bonus: "Standard Margins",
    color: "text-amber-500",
    bgGrad: "from-amber-500/10 via-amber-950/5 to-transparent",
    borderColor: "border-amber-500/20",
  },
  {
    name: "Silver Agent",
    badge: "🥈 Tier 2",
    icon: Award,
    minOrders: 50,
    maxOrders: 200,
    bonus: "+2% Profit Margin",
    color: "text-slate-300",
    bgGrad: "from-slate-400/10 via-slate-900/5 to-transparent",
    borderColor: "border-slate-400/20",
  },
  {
    name: "Gold Agent",
    badge: "🥇 Tier 3",
    icon: Sparkles,
    minOrders: 200,
    maxOrders: 500,
    bonus: "+4% Profit Margin & Priority Fulfillment",
    color: "text-amber-400",
    bgGrad: "from-amber-400/15 via-orange-950/10 to-transparent",
    borderColor: "border-amber-400/30",
  },
  {
    name: "Platinum Agent",
    badge: "💎 Tier 4 (VIP)",
    icon: Zap,
    minOrders: 500,
    maxOrders: Infinity,
    bonus: "+6% Profit Margin & Free Developer API",
    color: "text-cyan-400",
    bgGrad: "from-cyan-500/15 via-blue-950/10 to-transparent",
    borderColor: "border-cyan-400/30",
  },
];

export const AgentTierRecommenderCard: React.FC<AgentTierRecommenderCardProps> = ({
  totalOrders,
  totalSales,
}) => {
  // Determine current tier
  const currentTierIndex = TIERS.findIndex(
    (t) => totalOrders >= t.minOrders && totalOrders < t.maxOrders
  );
  const activeTierIndex = currentTierIndex === -1 ? TIERS.length - 1 : currentTierIndex;
  const currentTier = TIERS[activeTierIndex];
  const nextTier = TIERS[activeTierIndex + 1] || null;

  // Calculate progress
  let progressPercent = 100;
  let remainingOrders = 0;

  if (nextTier) {
    const ordersInCurrentTier = totalOrders - currentTier.minOrders;
    const tierSpan = nextTier.minOrders - currentTier.minOrders;
    progressPercent = Math.min(100, Math.max(0, (ordersInCurrentTier / tierSpan) * 100));
    remainingOrders = nextTier.minOrders - totalOrders;
  }

  const IconComponent = currentTier.icon;
  const tierLabel = currentTier.badge.replace(/^[^A-Za-z]+/, "");

  return (
    <section className="rounded-2xl border border-border/70 bg-card/85 p-4 sm:p-5 dark:border-white/[0.07] dark:bg-black/30">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3 sm:w-72 shrink-0">
          <span className="h-11 w-11 shrink-0 rounded-xl bg-muted flex items-center justify-center dark:bg-white/[0.06]">
            <IconComponent className={cn("h-5 w-5", currentTier.color)} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-muted-foreground">{tierLabel}</p>
            <p className="text-[16px] font-semibold text-foreground leading-snug">{currentTier.name}</p>
            <p className="text-[11.5px] text-muted-foreground tabular-nums">
              {totalOrders.toLocaleString()} order{totalOrders !== 1 ? "s" : ""} · GH₵{totalSales.toFixed(2)} sold
            </p>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          {nextTier ? (
            <>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-muted-foreground">
                  Next: <span className="font-semibold text-foreground">{nextTier.name}</span>
                </span>
                <span className="font-semibold tabular-nums text-foreground">{Math.round(progressPercent)}%</span>
              </div>
              <div className="mt-1.5 h-2 w-full rounded-full bg-muted overflow-hidden dark:bg-white/[0.06]">
                <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${progressPercent}%` }} />
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground flex items-start gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <span>
                  Sell <span className="font-semibold text-foreground">{remainingOrders} more</span> to unlock {nextTier.name} ({nextTier.bonus}).
                </span>
              </p>
            </>
          ) : (
            <p className="text-[13px] text-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              Top tier reached. You’re earning the highest agent margins.
            </p>
          )}
        </div>

        <div className="flex gap-2 sm:flex-col shrink-0">
          <Link
            to="/dashboard/buy-data/mtn"
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold hover:brightness-105"
          >
            <Zap className="h-4 w-4" /> Sell & level up
          </Link>
          <Link
            to="/dashboard/agent-prices"
            className="flex-1 inline-flex items-center justify-center gap-1 h-9 px-3.5 rounded-xl border border-border text-[13px] font-semibold text-foreground hover:bg-muted dark:border-white/10"
          >
            Tier prices <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default AgentTierRecommenderCard;
