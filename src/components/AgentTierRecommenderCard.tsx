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

  return (
    <div className={cn(
      "relative overflow-hidden rounded-3xl border p-5 sm:p-6 backdrop-blur-2xl transition-all shadow-xl",
      currentTier.bgGrad,
      currentTier.borderColor,
      "bg-card/70"
    )}>
      {/* Decorative ambient glow */}
      <div className="absolute top-0 right-0 -mt-10 -mr-10 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 space-y-4">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn("p-2.5 rounded-2xl border bg-black/40 shadow-inner", currentTier.borderColor)}>
              <IconComponent className={cn("w-6 h-6", currentTier.color)} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={cn("text-xs font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full border bg-black/40", currentTier.borderColor, currentTier.color)}>
                  {currentTier.badge}
                </span>
                <span className="text-[11px] text-muted-foreground font-mono">
                  {totalOrders} Order{totalOrders !== 1 ? "s" : ""} Completed
                </span>
              </div>
              <h3 className="text-lg font-black text-foreground tracking-tight mt-0.5">
                {currentTier.name} Status
              </h3>
            </div>
          </div>

          <Link to="/dashboard/agent-prices">
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs font-extrabold rounded-xl border-white/10 bg-white/5 hover:bg-white/10 text-foreground gap-1.5"
            >
              View Tier Discounts <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>

        {/* Progress Bar Section */}
        {nextTier ? (
          <div className="space-y-2 bg-black/20 p-3.5 rounded-2xl border border-white/5">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                Progress to <strong className={nextTier.color}>{nextTier.name}</strong>
              </span>
              <span className="text-foreground font-mono font-black">{Math.round(progressPercent)}%</span>
            </div>

            <div className="relative w-full h-3 bg-secondary/80 rounded-full overflow-hidden p-0.5 border border-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-400 transition-all duration-500 shadow-sm"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Smart Recommendation Tip */}
            <div className="flex items-start gap-2 pt-1">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-foreground/90 font-medium leading-snug">
                <strong className="text-amber-400">AI Recommendation:</strong> Sell{" "}
                <span className="font-extrabold underline text-amber-400">{remainingOrders} more bundle{remainingOrders !== 1 ? "s" : ""}</span> to unlock{" "}
                <strong className={nextTier.color}>{nextTier.name} Status</strong> ({nextTier.bonus}).
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-cyan-500/10 p-3.5 rounded-2xl border border-cyan-500/20 text-cyan-300 text-xs font-bold">
            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Highest VIP Tier Achieved! You are earning maximum agent margins (+6% profit bonus).</span>
          </div>
        )}

        {/* Quick Action CTA Row */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="text-xs text-muted-foreground font-medium flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Total Sales Volume: <strong className="text-foreground font-mono">GH₵{totalSales.toFixed(2)}</strong></span>
          </div>

          <Link to="/dashboard/buy-data/mtn">
            <Button
              size="sm"
              className="h-9 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs shadow-md border border-amber-400/40 gap-1.5"
            >
              <Zap className="w-3.5 h-3.5 fill-current" /> Sell Data & Level Up
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AgentTierRecommenderCard;
