import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Wallet, ShoppingCart, TrendingUp, ArrowDownToLine, ArrowUpRight,
  Users2, Zap, Store, ClipboardList, ChevronRight, RefreshCw, CloudOff,
  Gift, Sparkles, Activity, Clock, Eye, EyeOff
} from "lucide-react";
import { format } from "date-fns";
import { useMaskedBalance } from "@/hooks/useMaskedBalance";

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

const Dashboard = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { theme } = useAppTheme();
  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);
  const firstName = profile?.full_name?.split(" ")[0] || "there";
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
        supabase.from("wallets").select("balance, loyalty_balance").eq("agent_id", user.id).maybeSingle(),
        supabase
          .from("orders")
          .select("amount, order_type, status, profit, parent_profit, agent_id, parent_agent_id")
          .or(`agent_id.eq.${user.id},parent_agent_id.eq.${user.id}`)
          .in("status", ["paid", "processing", "fulfilled", "fulfillment_failed"]),
        supabase.from("public_system_settings").select("world_cup_predictor_enabled").eq("id", 1).maybeSingle().then(r => r).catch(err => ({ data: null, error: err })),
      ]);

      if (ordersRes.error) {
        console.error("Orders fetch error:", ordersRes.error);
        throw new Error("Fetch failed");
      }

      if (walletRes.error) {
        console.warn("Wallet fetch error (possibly missing column):", walletRes.error);
      }

      if (settingsRes && settingsRes.data) {
        setPredictorEnabled(settingsRes.data.world_cup_predictor_enabled !== false);
      }

      const balance = walletRes.data ? Number(walletRes.data.balance) : 0;
      const allOrders = ordersRes.data ?? [];
      
      const fulfilledOrders = allOrders.filter((o: any) => o.status === "fulfilled");
      const depositedOrders = allOrders.filter((o: any) => o.order_type === "wallet_topup" && o.status === "fulfilled" && Number(o.amount || 0) > 0);
      const subAgentActivationOrders = allOrders.filter((o: any) => o.order_type === "sub_agent_activation" && o.status === "fulfilled");

      // Direct profit + Parent profit (commissions from sub-agents)
      const directProfit = fulfilledOrders
        .filter((o: any) => o.agent_id === user.id)
        .reduce((s: number, o: any) => s + Number(o.profit || 0), 0);
      
      const parentProfit = fulfilledOrders
        .filter((o: any) => o.parent_agent_id === user.id)
        .reduce((s: number, o: any) => s + Number(o.parent_profit || 0), 0);

      // Define what counts as a "sale" (excludes topups and activations)
      const isSale = (o: any) => ["data", "api", "airtime", "utility"].includes(o.order_type);

      // Direct sales volume + Sub-agent sales volume
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
        loyaltyBalance: Number(walletRes.data?.loyalty_balance || 0),
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

    // Realtime listeners for live updates
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
    
    // Also listen for sub-agent orders
    const parentOrdersChannel = supabase
      .channel("dashboard-parent-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `parent_agent_id=eq.${user?.id}` }, () => {
        fetchData(true);
      })
      .subscribe();

    // Listen to updates on system settings to toggle the predictor
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

  const primary = `hsl(${theme.primary})`;

  const statCards = [
    { label: "Total Deposited", value: `GH₵ ${stats.totalDeposited.toFixed(2)}`, icon: ArrowDownToLine, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", glow: "shadow-blue-500/10" },
    { label: "Data Orders",     value: stats.totalOrders,                           icon: ShoppingCart,    color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", glow: "shadow-emerald-500/10" },
    { label: "Sales Volume",    value: `GH₵ ${stats.totalSalesAmount.toFixed(2)}`, icon: ArrowUpRight,    color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/20",  glow: "shadow-violet-500/10" },
    { label: "Profit Earned",   value: `GH₵ ${stats.totalProfit.toFixed(2)}`,      icon: TrendingUp,      color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20",   glow: "shadow-amber-500/10" },
  ];

  const quickActions = [
    { label: "Swift Vendor",   icon: Zap,          path: "/dashboard/swift-vendor",  color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20", isNew: true },
    { label: "Sub Agents",     icon: Users2,       path: "/dashboard/subagents",     color: "text-cyan-400",    bg: "bg-cyan-500/10",    border: "border-cyan-500/20", isNew: true },
    { label: "Transactions",   icon: ClipboardList, path: "/dashboard/transactions",  color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
    { label: "My Store",       icon: Store,         path: "/dashboard/my-store",      color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-5xl space-y-5 relative overflow-hidden">
      {/* Ambient background mesh blobs */}
      <div className="absolute top-12 left-1/4 w-72 h-72 bg-primary/5 rounded-full blur-[120px] pointer-events-none -z-10 animate-blob" />
      <div className="absolute bottom-24 right-1/4 w-72 h-72 bg-indigo-500/5 rounded-full blur-[120px] pointer-events-none -z-10 animate-blob-2" />

      <FreeDataClaimBanner />
      <CompleteProfileBanner />
      {predictorEnabled && <WorldCupPredictor />}

      {/* ── Greeting row ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* World Cup avatar glowing ring */}
          <div className={`relative w-10 h-10 rounded-full flex items-center justify-center overflow-visible ${
            predictorEnabled 
              ? "bg-[#10b981]/10 border-2 border-emerald-500/30" 
              : "bg-slate-100 border border-slate-200 dark:bg-slate-800 dark:border-slate-700"
          }`}>
            {/* Animated outer ring */}
            {predictorEnabled && (
              <span className="absolute -inset-1 rounded-full border border-emerald-500/40 animate-ping pointer-events-none opacity-45" />
            )}
            <span className={`text-lg font-black font-mono ${predictorEnabled ? "text-emerald-400" : "text-slate-600 dark:text-slate-300"}`}>
              {firstName.charAt(0).toUpperCase()}
            </span>
            {predictorEnabled && (
              <span className="absolute -bottom-1 -right-1 text-[10px] bg-amber-500 text-black font-black w-4.5 h-4.5 rounded-full flex items-center justify-center select-none shadow-md">
                🏆
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-muted-foreground text-xs font-medium">{getGreeting()} 👋</p>
              {predictorEnabled && (
                <Badge className="bg-amber-500 text-black hover:bg-amber-400 border-none font-black text-[8px] px-1.5 py-0.5 rounded-md tracking-wider flex items-center gap-0.5">
                  🏆 World Cup Season
                </Badge>
              )}
            </div>
            <h1 className="text-xl font-black text-foreground tracking-tight">{firstName}</h1>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Live Premium Clock */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-border bg-card backdrop-blur-md shadow-sm">
            <div className="relative flex items-center justify-center">
              <Clock className="w-3 h-3 text-amber-500 dark:text-amber-400/80" />
              <span className="absolute inset-0 rounded-full bg-amber-400/20 animate-ping pointer-events-none" />
            </div>
            <span className="text-[10px] font-bold text-foreground/80 font-mono tracking-tight">
              {format(currentTime, "hh:mm:ss a")}
            </span>
          </div>

          <button
            type="button"
            onClick={() => fetchData(true)}
            aria-label="Refresh dashboard"
            className={`w-9 h-9 rounded-xl border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all ${refreshing ? "animate-spin" : ""}`}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* MTN Live Delivery Status Widget */}
      <div className="flex justify-start">
        <LastMtnOrderWidget variant="pill" />
      </div>

      <DailyCheckIn />
      <WelcomeAnnouncement />
      <PromoCarousel />

      {/* ── Hero balance card ── */}
      <div
        className="relative rounded-3xl overflow-hidden p-5 sm:p-6 text-white shadow-2xl"
        style={{ background: theme.heroHex }}
      >
        {/* Decorative blobs */}
        <div className="absolute -top-8 -right-8 w-48 h-48 rounded-full bg-white/5 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-6 w-40 h-40 rounded-full bg-white/5 blur-2xl pointer-events-none" />

        <div className="relative flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 bg-white/5 px-2.5 py-1 rounded-xl w-fit border border-white/10">
              <div className="relative flex items-center justify-center">
                <Activity className="w-3 h-3 text-emerald-400" />
                <div className="absolute inset-0 rounded-full bg-emerald-400/30 animate-ping" />
              </div>
              <p className="text-white/60 text-[10px] font-black tracking-widest uppercase flex items-center gap-1.5">
                Live System 
                <span className="w-1 h-1 rounded-full bg-white/20" />
                {format(currentTime, "hh:mm:ss a")}
              </p>
            </div>

            {loading
              ? <Skeleton className="h-12 w-48 bg-white/10 rounded-xl" />
              : <p className="text-5xl sm:text-6xl font-black leading-none tracking-tight flex items-baseline flex-wrap gap-2">
                  <span>GH₵</span>
                  <span className={isMasked ? "font-mono opacity-80" : ""}>
                    {maskValue(stats.walletBalance)}
                  </span>
                </p>}

            <div className="flex items-center gap-2 mt-2">
              <p className="text-white/35 text-xs">Available for data bundles</p>
              <button
                onClick={toggleMask}
                className="p-1 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                title={isMasked ? "Show Balance" : "Hide Balance"}
              >
                {isMasked ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* SwiftPoints pill */}
            <button
              type="button"
              onClick={() => navigate("/dashboard/wallet")}
              className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 hover:bg-white/20 transition-all"
            >
              <Gift className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-white/80">
                {stats.loyaltyBalance} SwiftPoints
              </span>
              <ChevronRight className="w-3 h-3 text-white/30" />
            </button>
          </div>

          <div className="flex flex-row sm:flex-col gap-2.5 sm:items-end">
            <button
              type="button"
              onClick={() => navigate("/dashboard/wallet")}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-black transition-all hover:opacity-90 active:scale-95 shadow-lg shadow-primary-glow-hover"
              style={{ background: primary, color: "#000" }}
            >
              <Wallet className="w-4 h-4" /> Top Up
            </button>
            <button
              type="button"
              onClick={() => navigate("/dashboard/buy-data/mtn")}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-black border border-white/20 hover:border-white/40 hover:bg-white/5 transition-all active:scale-95"
            >
              <Zap className="w-4 h-4" /> Buy Data
            </button>
          </div>
        </div>

        {/* Mini stats row */}
        <div className="relative grid grid-cols-2 sm:grid-cols-3 gap-3 mt-5 pt-5 border-t border-white/10">
          <div>
            <p className="text-white/35 text-[10px] uppercase tracking-widest font-bold">Deposited</p>
            {loading
              ? <Skeleton className="h-5 w-24 mt-1 bg-white/10" />
              : <p className="text-white font-black text-base mt-0.5">GH₵ {maskValue(stats.totalDeposited)}</p>}
          </div>
          <div>
            <p className="text-white/35 text-[10px] uppercase tracking-widest font-bold">Orders</p>
            {loading
              ? <Skeleton className="h-5 w-16 mt-1 bg-white/10" />
              : <p className="text-white font-black text-base mt-0.5">{stats.totalOrders}</p>}
          </div>
          {isPaidAgent && (
            <div className="col-span-2 sm:col-span-1">
              <p className="text-white/35 text-[10px] uppercase tracking-widest font-bold">Total Profit</p>
              {loading
                ? <Skeleton className="h-5 w-24 mt-1 bg-white/10" />
                : <p className="font-black text-base mt-0.5" style={{ color: primary }}>
                    GH₵ {maskValue(stats.totalProfit)}
                  </p>}
            </div>
          )}
        </div>
      </div>

      <ReferAndEarn />

      {/* ── Error state ── */}
      {error && (
        <div className="rounded-3xl p-8 border border-red-500/20 bg-red-500/5 flex flex-col items-center text-center gap-4 animate-in fade-in zoom-in duration-500">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
            <CloudOff className="w-8 h-8 text-red-500" />
          </div>
          <div>
            <h3 className="text-lg font-black text-foreground">Connection Issues</h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto mt-1">Couldn't load your latest data. Check your connection and try again.</p>
          </div>
          <button
            type="button"
            onClick={() => fetchData()}
            className="inline-flex items-center gap-2 rounded-xl px-6 py-2.5 bg-slate-900 text-white dark:bg-white dark:text-black text-sm font-black hover:opacity-90 transition-all active:scale-95"
          >
            <RefreshCw className="w-4 h-4" /> Try Again
          </button>
        </div>
      )}

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl p-4 border border-border bg-card">
                <Skeleton className="h-4 w-4 mb-3 rounded-lg" />
                <Skeleton className="h-6 w-3/4 mb-1.5 rounded-lg" />
                <Skeleton className="h-3 w-full rounded-lg" />
              </div>
            ))
          : statCards.map((s) => (
              <CardTilt
                key={s.label}
                glowColor={s.color.includes("blue") ? "217 91% 60%" : s.color.includes("emerald") ? "142 70% 45%" : s.color.includes("violet") ? "262 83% 58%" : "48 96% 53%"}
                className="rounded-2xl"
              >
                <div
                  className={`rounded-2xl p-4 flex flex-col gap-2 border shadow-lg ${s.bg} ${s.glow} h-full`}
                >
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${s.bg}`}>
                    <s.icon className={`w-4 h-4 ${s.color}`} />
                  </div>
                  <p className={`font-black text-base sm:text-lg leading-tight ${s.color}`}>{s.value}</p>
                  <p className="text-muted-foreground text-[11px] font-medium">{s.label}</p>
                </div>
              </CardTilt>
            ))}
      </div>

      {/* ── Quick actions ── */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 mb-3 flex items-center gap-2">
          <Sparkles className="w-3 h-3" /> Quick Actions
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {quickActions.map((a) => (
            <CardTilt
              key={a.label}
              glowColor={a.color.includes("amber") ? "48 96% 53%" : a.color.includes("cyan") ? "185 85% 45%" : a.color.includes("blue") ? "217 91% 60%" : "142 70% 45%"}
              className="rounded-2xl w-full"
            >
              <button
                type="button"
                onClick={() => navigate(a.path)}
                className={`group flex flex-col items-start gap-3 rounded-2xl border p-4 transition-all w-full h-full ${a.bg} ${a.border}`}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${a.bg} border ${a.border}`}>
                  <a.icon className={`w-4 h-4 ${a.color}`} />
                </div>
                <div className="flex items-center justify-between w-full">
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-xs font-black text-foreground/80">{a.label}</span>
                    {(a as any).isNew && (
                      <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-emerald-500 text-white font-black uppercase leading-none shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                        NEW
                      </span>
                    )}
                  </div>
                  <ChevronRight className={`w-3.5 h-3.5 ${a.color} opacity-0 group-hover:opacity-100 transition-opacity`} />
                </div>
              </button>
            </CardTilt>
          ))}
        </div>
      </div>

      {/* ── Agent upsell ── */}
      {!isPaidAgent && (
        <div className="relative overflow-hidden rounded-3xl border border-amber-500/20 bg-amber-500/5 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full bg-amber-500/10 blur-2xl pointer-events-none" />
          <div className="flex-1 relative">
            <p className="font-black text-sm text-foreground mb-1 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" /> Unlock Agent Prices
            </p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Become an agent to get wholesale bundle rates, your own store, and profit tracking.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/agent-program")}
            className="relative shrink-0 inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-black text-black transition-all hover:opacity-90 active:scale-95 shadow-lg shadow-amber-500/20"
            style={{ background: primary }}
          >
            Become an Agent <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
