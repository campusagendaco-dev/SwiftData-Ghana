import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Wallet, ShoppingCart, TrendingUp, ArrowDownToLine, ArrowUpRight,
  Users2, Zap, Store, ClipboardList, ChevronRight, RefreshCw, CloudOff, Gift
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppTheme } from "@/contexts/ThemeContext";
import FreeDataClaimBanner from "@/components/FreeDataClaimBanner";
import WelcomeAnnouncement from "@/components/WelcomeAnnouncement";

interface DashboardStats {
  walletBalance: number;
  totalOrders: number;
  totalDeposited: number;
  totalSalesAmount: number;
  subAgentEarnings: number;
  totalProfit: number;
  loyaltyBalance: number;
}

const Dashboard = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { theme } = useAppTheme();
  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({
    walletBalance: 0,
    totalOrders: 0,
    totalDeposited: 0,
    totalSalesAmount: 0,
    subAgentEarnings: 0,
    totalProfit: 0,
    loyaltyBalance: 0,
  });

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    setError(false);
    
    try {
      const [walletRes, ordersRes] = await Promise.all([
        supabase.from("wallets").select("balance, loyalty_balance").eq("agent_id", user.id).single(),
        supabase
          .from("orders")
          .select("amount, order_type, status, profit")
          .eq("agent_id", user.id)
          .in("status", ["paid", "processing", "fulfilled", "fulfillment_failed"]),
      ]);

      // PGRST116 = "no rows returned" — user may not have a wallet row yet, treat as 0
      if (walletRes.error && walletRes.error.code !== "PGRST116") throw new Error("Fetch failed");
      if (ordersRes.error) throw new Error("Fetch failed");

      const balance = walletRes.data ? Number(walletRes.data.balance) : 0;
      const allOrders = ordersRes.data ?? [];
      const depositedOrders = allOrders.filter((o: any) => o.order_type === "wallet_topup");
      const dataOrders = allOrders.filter((o: any) => o.order_type === "data");
      const subAgentActivationOrders = allOrders.filter((o: any) => o.order_type === "sub_agent_activation");

      const totalDeposited = depositedOrders.reduce((s: number, o: any) => s + Number(o.amount || 0), 0);
      const totalSalesAmount = dataOrders.reduce((s: number, o: any) => s + Number(o.amount || 0), 0);
      const subAgentEarnings = subAgentActivationOrders.reduce((s: number, o: any) => s + Number(o.profit || 0), 0);
      const totalProfit = allOrders.reduce((s: number, o: any) => s + Number(o.profit || 0), 0);

      setStats({ 
        walletBalance: balance, 
        totalOrders: allOrders.length, 
        totalDeposited, 
        totalSalesAmount, 
        subAgentEarnings, 
        totalProfit,
        loyaltyBalance: Number(walletRes.data?.loyalty_balance || 0)
      });
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    const walletChannel = supabase
      .channel("dashboard-wallet")
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `agent_id=eq.${user.id}` }, (p: any) => {
        if (p.new?.balance !== undefined) setStats((prev) => ({ ...prev, walletBalance: Number(p.new.balance) }));
      })
      .subscribe();

    const ordersChannel = supabase
      .channel("dashboard-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `agent_id=eq.${user.id}` }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(walletChannel);
      supabase.removeChannel(ordersChannel);
    };
  }, [user]);

  const primary = `hsl(${theme.primary})`;

  return (
    <div className="p-4 sm:p-6 max-w-5xl space-y-5">

      <FreeDataClaimBanner />
      <WelcomeAnnouncement />

      {/* ── Hero balance card ── */}
      <div className="rounded-2xl p-5 sm:p-6 text-white" style={{ background: theme.heroHex }}>
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-white/50 text-xs uppercase tracking-wide mb-1">Wallet Balance</p>
            {loading
              ? <Skeleton className="h-10 w-44 bg-white/10" />
              : <p className="text-4xl sm:text-5xl font-black leading-none">GH₵ {stats.walletBalance.toFixed(2)}</p>}
            <p className="text-white/40 text-xs mt-2">Available to spend on data bundles</p>
            
            {/* Loyalty Points Display */}
            <div 
              onClick={() => navigate("/dashboard/wallet")}
              className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 hover:bg-white/20 transition-all cursor-pointer"
            >
              <Gift className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-white/80">
                {stats.loyaltyBalance} SwiftPoints
              </span>
              <ChevronRight className="w-3 h-3 text-white/30" />
            </div>
          </div>
          <div className="flex flex-row sm:flex-col gap-3 sm:gap-2 sm:items-end">
            <button
              onClick={() => navigate("/dashboard/wallet")}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all hover:opacity-90"
              style={{ background: primary, color: "#000" }}
            >
              <Wallet className="w-4 h-4" /> Top Up
            </button>
            <button
              onClick={() => navigate("/dashboard/buy-data/mtn")}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold border border-white/25 hover:border-white/50 transition-colors"
            >
              <Zap className="w-4 h-4" /> Buy Data
            </button>
          </div>
        </div>

        {/* Mini stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-5 pt-4 border-t border-white/10">
          <div>
            <p className="text-white/40 text-[11px]">Total Deposited</p>
            {loading
              ? <Skeleton className="h-5 w-24 mt-0.5 bg-white/10" />
              : <p className="text-white font-bold text-base">GH₵ {stats.totalDeposited.toFixed(2)}</p>}
          </div>
          <div>
            <p className="text-white/40 text-[11px]">Total Orders</p>
            {loading
              ? <Skeleton className="h-5 w-16 mt-0.5 bg-white/10" />
              : <p className="text-white font-bold text-base">{stats.totalOrders}</p>}
          </div>
          {isPaidAgent && (
            <div className="col-span-2 sm:col-span-1">
              <p className="text-white/40 text-[11px]">Total Profit</p>
              {loading
                ? <Skeleton className="h-5 w-24 mt-0.5 bg-white/10" />
                : <p className="font-bold text-base" style={{ color: primary }}>GH₵ {stats.totalProfit.toFixed(2)}</p>}
            </div>
          )}
        </div>
      </div>

      {/* ── Error State ── */}
      {error && (
        <div className="rounded-2xl p-8 border border-red-500/20 bg-red-500/5 flex flex-col items-center text-center gap-4 animate-in fade-in zoom-in duration-500">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
            <CloudOff className="w-8 h-8 text-red-500" />
          </div>
          <div>
            <h3 className="text-lg font-black text-white">Connection Issues</h3>
            <p className="text-sm text-white/50 max-w-xs mx-auto">We couldn't fetch your latest dashboard data. Please check your internet connection.</p>
          </div>
          <button
            onClick={() => fetchData()}
            className="inline-flex items-center gap-2 rounded-xl px-6 py-2.5 bg-white text-black text-sm font-black hover:bg-white/90 transition-all active:scale-95"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        </div>
      )}


      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl p-4 border border-border bg-card">
                <Skeleton className="h-4 w-4 mb-2 rounded" />
                <Skeleton className="h-6 w-3/4 mb-1" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))
          : [
              { label: "Sales Volume", value: `GH₵ ${stats.totalSalesAmount.toFixed(2)}`, icon: ArrowUpRight },
              { label: "Data Orders", value: String(stats.totalOrders), icon: ShoppingCart },
              { label: "Sub-Agent Earnings", value: `GH₵ ${stats.subAgentEarnings.toFixed(2)}`, icon: Users2 },
              { label: "Profit Earned", value: `GH₵ ${stats.totalProfit.toFixed(2)}`, icon: TrendingUp },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl p-4 flex flex-col gap-1.5 border border-border bg-card"
              >
                <s.icon className="w-4 h-4 mb-0.5" style={{ color: primary }} />
                <p className="font-bold text-base sm:text-lg leading-tight">{s.value}</p>
                <p className="text-muted-foreground text-xs">{s.label}</p>
              </div>
            ))}
      </div>

      {/* ── Quick actions ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Quick Actions</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Buy MTN Data", icon: Zap, path: "/dashboard/buy-data/mtn" },
            { label: "Transactions", icon: ClipboardList, path: "/dashboard/transactions" },
            { label: "My Store", icon: Store, path: "/dashboard/my-store" },
            { label: "Wallet", icon: ArrowDownToLine, path: "/dashboard/wallet" },
          ].map((a) => (
            <button
              key={a.label}
              onClick={() => navigate(a.path)}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-3 sm:p-4 text-sm font-medium hover:border-primary/40 transition-colors group text-left"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `hsl(${theme.primary}/0.12)` }}>
                <a.icon className="w-4 h-4" style={{ color: primary }} />
              </div>
              <span className="truncate">{a.label}</span>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-auto shrink-0 group-hover:text-foreground transition-colors" />
            </button>
          ))}
        </div>
      </div>

      {/* ── Agent upsell ── */}
      {!isPaidAgent && (
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="font-semibold text-sm mb-0.5">Unlock Agent Prices</p>
            <p className="text-muted-foreground text-xs">Become an agent to get wholesale bundle rates, your own public store, and profit tracking.</p>
          </div>
          <button
            onClick={() => navigate("/agent-program")}
            className="shrink-0 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-opacity hover:opacity-90"
            style={{ background: primary, color: "#000" }}
          >
            Become an Agent <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
