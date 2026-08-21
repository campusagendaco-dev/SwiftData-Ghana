import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Wallet, ShoppingCart, TrendingUp, ArrowDownToLine, ArrowUpRight,
  Users2, Zap, Store, ClipboardList, ChevronRight, RefreshCw, CloudOff,
  Gift, Sparkles, Activity, Clock, Eye, EyeOff, ShieldCheck, CreditCard,
  Send, Layers, Trophy, CheckCircle2, ArrowRight, Award
} from "lucide-react";
import { format } from "date-fns";
import { useMaskedBalance } from "@/hooks/useMaskedBalance";
import { cn } from "@/lib/utils";

import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppTheme } from "@/contexts/ThemeContext";
import FreeDataClaimBanner from "@/components/FreeDataClaimBanner";
import WelcomeAnnouncement from "@/components/WelcomeAnnouncement";
import ReferAndEarn from "@/components/ReferAndEarn";
import DailyCheckIn from "@/components/DailyCheckIn";
import PromoCarousel from "@/components/PromoCarousel";
import CompleteProfileBanner from "@/components/CompleteProfileBanner";
import LastMtnOrderWidget from "@/components/LastMtnOrderWidget";
import { CardTilt } from "@/components/ui/CardTilt";
import { Badge } from "@/components/ui/badge";
import WorldCupPredictor from "@/components/WorldCupPredictor";
import AgentTierRecommenderCard from "@/components/AgentTierRecommenderCard";
import { Button } from "@/components/ui/button";

interface DashboardStats {
  walletBalance: number;
  totalOrders: number;
  totalDeposited: number;
  totalSalesAmount: number;
  subAgentEarnings: number;
  totalProfit: number;
  loyaltyBalance: number;
}

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

import FrequentCustomersReorder from "@/components/FrequentCustomersReorder";
import LowBalanceAlertDrawer from "@/components/LowBalanceAlertDrawer";
import StoreShareCard from "@/components/StoreShareCard";

const Dashboard = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { theme } = useAppTheme();
  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);
  const firstName = profile?.full_name?.split(" ")[0] || "Agent";
  const { isMasked, toggleMask, maskValue } = useMaskedBalance();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [predictorEnabled, setPredictorEnabled] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const [stats, setStats] = useState<DashboardStats>({
    walletBalance: 0,
    totalOrders: 0,
    totalDeposited: 0,
    totalSalesAmount: 0,
    subAgentEarnings: 0,
    totalProfit: 0,
    loyaltyBalance: 0,
  });

  const fetchData = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(false);

    try {
      const [walletRes, ordersRes, settingsRes] = await Promise.all([
        (supabase.from("wallets" as any)).select("balance, loyalty_balance").eq("agent_id", user.id).maybeSingle(),
        supabase
          .from("orders")
          .select("amount, order_type, status, profit, parent_profit, agent_id, parent_agent_id")
          .or(`agent_id.eq.${user.id},parent_agent_id.eq.${user.id}`)
          .in("status", ["paid", "processing", "fulfilled", "fulfillment_failed"]),
        Promise.resolve(supabase.from("public_system_settings" as any).select("world_cup_predictor_enabled").eq("id", 1).maybeSingle()).catch(err => ({ data: null, error: err })),
      ]);

      if (ordersRes.error) {
        console.error("Orders fetch error:", ordersRes.error);
        throw new Error("Fetch failed");
      }

      if (settingsRes && settingsRes.data) {
        setPredictorEnabled(settingsRes.data.world_cup_predictor_enabled !== false);
      }

      const walletData: any = walletRes.data;
      const balance = walletData ? Number(walletData.balance || 0) : 0;
      const allOrders = ordersRes.data ?? [];
      
      const fulfilledOrders = allOrders.filter((o: any) => o.status === "fulfilled");
      const depositedOrders = allOrders.filter((o: any) => o.order_type === "wallet_topup" && o.status === "fulfilled" && Number(o.amount || 0) > 0);
      const subAgentActivationOrders = allOrders.filter((o: any) => o.order_type === "sub_agent_activation" && o.status === "fulfilled");

      const directProfit = fulfilledOrders
        .filter((o: any) => o.agent_id === user.id)
        .reduce((s: number, o: any) => s + Number(o.profit || 0), 0);
      
      const parentProfit = fulfilledOrders
        .filter((o: any) => o.parent_agent_id === user.id)
        .reduce((s: number, o: any) => s + Number(o.parent_profit || 0), 0);

      const isSale = (o: any) => ["data", "api", "airtime", "utility"].includes(o.order_type);

      const directSales = fulfilledOrders
        .filter((o: any) => o.agent_id === user.id && isSale(o))
        .reduce((s: number, o: any) => s + Number(o.amount || 0), 0);
      
      const subAgentSales = fulfilledOrders
        .filter((o: any) => o.parent_agent_id === user.id && isSale(o))
        .reduce((s: number, o: any) => s + Number(o.amount || 0), 0);

      const subAgentEarnings = subAgentActivationOrders.reduce((s: number, o: any) => s + Number(o.profit || 0), 0);
      
      setStats({
        walletBalance: balance,
        totalOrders: fulfilledOrders.length,
        totalDeposited: depositedOrders.reduce((s: number, o: any) => s + Number(o.amount || 0), 0),
        totalSalesAmount: directSales + subAgentSales,
        subAgentEarnings,
        totalProfit: directProfit + parentProfit + subAgentEarnings,
        loyaltyBalance: Number(walletData?.loyalty_balance || 0),
      });

    } catch (err) {
      console.error("Dashboard fetch error:", err);
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();

    const walletChannel = supabase
      .channel("dashboard-wallet")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wallets", filter: `agent_id=eq.${user?.id}` }, (p: any) => {
        if (p.new?.balance !== undefined) setStats(prev => ({ ...prev, walletBalance: Number(p.new.balance) }));
        if (p.new?.loyalty_balance !== undefined) setStats(prev => ({ ...prev, loyaltyBalance: Number(p.new.loyalty_balance) }));
      })
      .subscribe();

    const ordersChannel = supabase
      .channel("dashboard-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `agent_id=eq.${user?.id}` }, () => {
        fetchData(true);
      })
      .subscribe();
    
    const parentOrdersChannel = supabase
      .channel("dashboard-parent-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `parent_agent_id=eq.${user?.id}` }, () => {
        fetchData(true);
      })
      .subscribe();

    const settingsChannel = supabase
      .channel("dashboard-settings")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "system_settings", filter: "id=eq.1" }, (p: any) => {
        if (p.new?.world_cup_predictor_enabled !== undefined) {
          setPredictorEnabled(p.new.world_cup_predictor_enabled);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(walletChannel);
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(parentOrdersChannel);
      supabase.removeChannel(settingsChannel);
    };
  }, [user, fetchData]);

  const hasStore = !!(profile?.store_name && profile.store_name.trim() !== "");

  const quickActions = [
    { label: "Swift Vendor",   icon: Zap,          path: "/dashboard/swift-vendor",  color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20", isNew: true },
    { label: "AFA Register",   icon: ShieldCheck,  path: "/dashboard/afa",           color: "text-purple-400",  bg: "bg-purple-500/10",  border: "border-purple-500/20", isNew: true },
    hasStore && { label: "Sub Agents",     icon: Users2,       path: "/dashboard/subagents",     color: "text-cyan-400",    bg: "bg-cyan-500/10",    border: "border-cyan-500/20", isNew: true },
    { label: "Transactions",   icon: ClipboardList, path: "/dashboard/transactions",  color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
    hasStore && { label: "My Store",       icon: Store,         path: "/dashboard/my-store",      color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  ].filter(Boolean) as { label: string; icon: any; path: string; color: string; bg: string; border: string; isNew?: boolean }[];

  return (
    <div className="space-y-6 pb-12">
      <FreeDataClaimBanner />
      <CompleteProfileBanner />
      <LowBalanceAlertDrawer balance={stats.walletBalance} />

      {/* ── Top Greeting Bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-card-neo p-4 sm:p-5 rounded-3xl">
        <div className="flex items-center gap-3.5">
          <div className="relative w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
            <span className="text-xl font-black text-amber-400 font-mono">
              {firstName.charAt(0).toUpperCase()}
            </span>
            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-slate-900 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">{getGreeting()} 👋</span>
              {predictorEnabled && (
                <Badge className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[9px] font-black uppercase tracking-wider">
                  🏆 Promo Season
                </Badge>
              )}
            </div>
            <h1 className="text-lg sm:text-2xl font-black text-foreground tracking-tight">
              {profile?.full_name || firstName}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-end sm:self-auto">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border bg-background/80 text-xs font-mono font-bold">
            <Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span>{format(currentTime, "hh:mm:ss a")}</span>
          </div>

          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-xl border-border bg-background/80"
            onClick={() => fetchData(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* ── MTN Live Status Widget ── */}
      <LastMtnOrderWidget variant="pill" />

      <DailyCheckIn />
      <WelcomeAnnouncement />
      <PromoCarousel />
      {predictorEnabled && <WorldCupPredictor />}

      {/* ── Hero Balance Card (Cyber Dark Glass) ── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-amber-950/30 p-6 sm:p-8 border border-white/15 shadow-2xl backdrop-blur-2xl">
        <div className="absolute -top-12 -right-12 w-64 h-64 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-12 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-extrabold flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" /> Live Balance
              </span>
              <button
                onClick={toggleMask}
                className="text-slate-400 hover:text-white transition-colors p-1"
                title={isMasked ? "Show Balance" : "Hide Balance"}
              >
                {isMasked ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Wallet Balance</p>
              {loading ? (
                <Skeleton className="h-12 w-56 bg-slate-800 rounded-xl mt-1" />
              ) : (
                <p className="text-4xl sm:text-5xl font-black text-white font-mono tracking-tight mt-1">
                  GH₵ {maskValue(stats.walletBalance)}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => navigate("/dashboard/wallet")}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 hover:bg-white/20 text-white text-xs font-bold transition-all"
            >
              <Gift className="w-3.5 h-3.5 text-amber-400" />
              <span>{stats.loyaltyBalance} SwiftPoints</span>
              <ChevronRight className="w-3.5 h-3.5 text-white/50" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => navigate("/dashboard/wallet")}
              className="h-11 px-6 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs shadow-lg shadow-amber-950/40 border border-amber-400/40 gap-2"
            >
              <Wallet className="w-4 h-4" /> Top Up Wallet
            </Button>

            <Button
              onClick={() => navigate("/dashboard/buy-data/mtn")}
              variant="outline"
              className="h-11 px-6 rounded-xl border-white/20 bg-white/10 hover:bg-white/20 text-white font-black text-xs backdrop-blur-md gap-2"
            >
              <Zap className="w-4 h-4 text-amber-400 fill-current" /> Buy Data Bundles
            </Button>
          </div>
        </div>

        {/* Sub-Stat Pills Footer */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-6 mt-6 border-t border-white/10">
          <div className="bg-black/30 p-3 rounded-2xl border border-white/5">
            <p className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">Total Deposited</p>
            <p className="text-sm font-black text-white font-mono mt-0.5">GH₵ {maskValue(stats.totalDeposited)}</p>
          </div>

          <div className="bg-black/30 p-3 rounded-2xl border border-white/5">
            <p className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">Total Orders</p>
            <p className="text-sm font-black text-white font-mono mt-0.5">{stats.totalOrders}</p>
          </div>

          {isPaidAgent && (
            <div className="bg-black/30 p-3 rounded-2xl border border-white/5 col-span-2 sm:col-span-1">
              <p className="text-[10px] text-emerald-400 font-extrabold uppercase tracking-wider">Net Agent Profit</p>
              <p className="text-sm font-black text-emerald-400 font-mono mt-0.5">GH₵ {maskValue(stats.totalProfit)}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Frequent Customers Quick Re-Order ── */}
      <FrequentCustomersReorder />

      {/* ── Online Storefront Promotion Card ── */}
      <StoreShareCard />

      <ReferAndEarn />

      {/* ── Error state ── */}
      {error && (
        <div className="rounded-3xl p-6 border border-rose-500/30 bg-rose-500/10 flex flex-col items-center text-center gap-3">
          <CloudOff className="w-8 h-8 text-rose-400" />
          <div>
            <h3 className="text-base font-black text-foreground">Connection Issues</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Could not load latest dashboard metrics. Please check network connection.</p>
          </div>
          <Button onClick={() => fetchData()} size="sm" className="rounded-xl font-bold">
            <RefreshCw className="w-3.5 h-3.5 mr-2" /> Try Again
          </Button>
        </div>
      )}

      {/* ── Metrics Cards Grid ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Deposited", value: `GH₵ ${stats.totalDeposited.toFixed(2)}`, icon: ArrowDownToLine, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
          { label: "Delivered Orders", value: stats.totalOrders, icon: ShoppingCart, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
          { label: "Sales Volume", value: `GH₵ ${stats.totalSalesAmount.toFixed(2)}`, icon: ArrowUpRight, color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
          { label: "Net Agent Profit", value: `GH₵ ${stats.totalProfit.toFixed(2)}`, icon: TrendingUp, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
        ].map((s) => (
          <div key={s.label} className={cn("glass-card-neo p-4 rounded-2xl border flex flex-col justify-between gap-2", s.bg)}>
            <div className="flex items-center justify-between">
              <s.icon className={cn("w-4 h-4", s.color)} />
              <span className="text-[10px] font-mono text-muted-foreground">Live</span>
            </div>
            <div>
              <p className={cn("font-mono font-black text-lg sm:text-xl", s.color)}>{s.value}</p>
              <p className="text-[11px] font-bold text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Agent Tier Upgrade & Loyalty Goal Recommender ── */}
      <AgentTierRecommenderCard totalOrders={stats.totalOrders} totalSales={stats.totalSalesAmount} />

      {/* ── Quick Actions Grid ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Quick Agent Tools
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quickActions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => navigate(a.path)}
              className="glass-card-neo p-4 rounded-2xl flex flex-col items-start gap-3 transition-all text-left group w-full h-full"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${a.bg} border ${a.border}`}>
                <a.icon className={`w-5 h-5 ${a.color}`} />
              </div>
              <div className="w-full flex items-center justify-between">
                <div>
                  <p className="text-xs font-black text-foreground group-hover:text-amber-400 transition-colors">{a.label}</p>
                  {a.isNew && (
                    <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-emerald-500 text-slate-950 uppercase">NEW</span>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Agent Upgrade Upsell Card ── */}
      {!isPaidAgent && (
        <div className="relative overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent p-6 backdrop-blur-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                <span className="text-xs font-black uppercase tracking-wider text-amber-400">Upgrade to Paid Agent</span>
              </div>
              <h3 className="text-base font-black text-foreground">Unlock Wholesale Bundle Prices & Your Own Online Store</h3>
              <p className="text-xs text-muted-foreground max-w-xl">
                Become a verified SwiftData Agent to get wholesale bundle rates, reseller store link, profit tracking, and sub-agent management.
              </p>
            </div>
            <Button
              onClick={() => navigate("/agent-program")}
              className="h-10 px-6 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-black text-xs shrink-0 shadow-md"
            >
              Become an Agent <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
