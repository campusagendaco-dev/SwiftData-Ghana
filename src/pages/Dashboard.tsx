import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookUser,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CloudOff,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Gift,
  GraduationCap,
  HandCoins,
  Medal,
  Plus,
  Receipt,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, formatDistanceToNowStrict, startOfDay, subDays } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";
import { useMaskedBalance } from "@/hooks/useMaskedBalance";
import { cn } from "@/lib/utils";
import FreeDataClaimBanner from "@/components/FreeDataClaimBanner";
import WelcomeAnnouncement from "@/components/WelcomeAnnouncement";
import ReferAndEarn from "@/components/ReferAndEarn";
import DailyCheckIn from "@/components/DailyCheckIn";
import PromoCarousel from "@/components/PromoCarousel";
import CompleteProfileBanner from "@/components/CompleteProfileBanner";
import LastMtnOrderWidget from "@/components/LastMtnOrderWidget";
import WorldCupPredictor from "@/components/WorldCupPredictor";
import AgentTierRecommenderCard from "@/components/AgentTierRecommenderCard";
import FrequentCustomersReorder from "@/components/FrequentCustomersReorder";
import LowBalanceAlertDrawer from "@/components/LowBalanceAlertDrawer";
import {
  EmptyState,
  NetworkMark,
  PageContainer,
  PageHeader,
  Panel,
  PanelLink,
  SkeletonRows,
  StatCard,
  StatusBadge,
  btnPrimary,
  btnSecondary,
  fmtCedi,
  fmtInt,
  iconBtn,
  surface,
} from "@/components/dashboard/ui";

type OrderRow = {
  amount: number | null;
  order_type: string | null;
  status: string | null;
  profit: number | null;
  parent_profit: number | null;
  agent_id: string | null;
  parent_agent_id: string | null;
  created_at: string | null;
};

type RecentOrder = {
  id: string;
  customer_phone: string | null;
  network: string | null;
  package_size: string | null;
  amount: number | null;
  status: string | null;
  order_type: string | null;
  created_at: string;
};

const SALE_TYPES = ["data", "api", "airtime", "utility"];

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

const pctChange = (now: number, before: number): number | null => {
  if (before <= 0) return now > 0 ? null : 0;
  return ((now - before) / before) * 100;
};

const maskPhone = (p?: string | null) => {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  return d.length >= 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : p;
};

const Dashboard = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);
  const firstName = profile?.full_name?.split(" ")[0] || "there";
  const { isMasked, toggleMask, maskValue } = useMaskedBalance();
  const hasStore = !!(profile?.store_name && profile.store_name.trim() !== "");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [predictorEnabled, setPredictorEnabled] = useState(false);
  const [range, setRange] = useState<7 | 30>(7);
  const [walletBalance, setWalletBalance] = useState(0);
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [recent, setRecent] = useState<RecentOrder[] | null>(null);

  const fetchData = useCallback(
    async (silent = false) => {
      if (!user) return;
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError(false);
      try {
        const [walletRes, ordersRes, recentRes, settingsRes] = await Promise.all([
          supabase.from("wallets" as any).select("balance, loyalty_balance").eq("agent_id", user.id).maybeSingle(),
          supabase
            .from("orders")
            .select("amount, order_type, status, profit, parent_profit, agent_id, parent_agent_id, created_at")
            .or(`agent_id.eq.${user.id},parent_agent_id.eq.${user.id}`)
            .in("status", ["paid", "processing", "fulfilled", "fulfillment_failed"]),
          supabase
            .from("orders")
            .select("id, customer_phone, network, package_size, amount, status, order_type, created_at")
            .eq("agent_id", user.id)
            .order("created_at", { ascending: false })
            .limit(6),
          Promise.resolve(supabase.from("public_system_settings" as any).select("world_cup_predictor_enabled").eq("id", 1).maybeSingle()).catch(
            (err) => ({ data: null, error: err })
          ),
        ]);
        if (ordersRes.error) throw ordersRes.error;
        const w: any = walletRes.data;
        setWalletBalance(Number(w?.balance || 0));
        setLoyaltyBalance(Number(w?.loyalty_balance || 0));
        setOrders((ordersRes.data as any) ?? []);
        setRecent(((recentRes as any).data as RecentOrder[]) ?? []);
        const s: any = (settingsRes as any)?.data;
        setPredictorEnabled(Boolean(s) && s.world_cup_predictor_enabled !== false);
      } catch (err) {
        console.error("Dashboard fetch error:", err);
        setError(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user]
  );

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedFetch = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      if (document.visibilityState === "visible") fetchData(true);
    }, 1500);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
    if (!user) return;
    const rand = Math.random().toString(36).substring(7);
    const walletChannel = supabase
      .channel(`dash_wallet_${user.id}_${rand}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wallets", filter: `agent_id=eq.${user.id}` }, (p: any) => {
        if (p.new?.balance !== undefined) setWalletBalance(Number(p.new.balance));
        if (p.new?.loyalty_balance !== undefined) setLoyaltyBalance(Number(p.new.loyalty_balance));
      })
      .subscribe();
    const ordersChannel = supabase
      .channel(`dash_orders_${user.id}_${rand}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `agent_id=eq.${user.id}` }, debouncedFetch)
      .subscribe();
    const parentOrdersChannel = supabase
      .channel(`dash_parent_orders_${user.id}_${rand}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `parent_agent_id=eq.${user.id}` }, debouncedFetch)
      .subscribe();
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      safeRemoveChannel(walletChannel);
      safeRemoveChannel(ordersChannel);
      safeRemoveChannel(parentOrdersChannel);
    };
  }, [user, fetchData, debouncedFetch]);

  /* ───────────── Derived numbers ───────────── */
  const stats = useMemo(() => {
    const uid = user?.id;
    const fulfilled = orders.filter((o) => o.status === "fulfilled");
    const isSale = (o: OrderRow) => SALE_TYPES.includes(String(o.order_type));
    const saleAmount = (o: OrderRow) => (isSale(o) ? Number(o.amount || 0) : 0);
    // Same profit formula the dashboard has always used: own profit + parent share + sub-agent activation earnings.
    const profitOf = (o: OrderRow) =>
      (o.agent_id === uid ? Number(o.profit || 0) : 0) +
      (o.parent_agent_id === uid ? Number(o.parent_profit || 0) : 0) +
      (o.order_type === "sub_agent_activation" ? Number(o.profit || 0) : 0);

    const totalSales = fulfilled.reduce((s, o) => s + saleAmount(o), 0);
    const totalProfit = fulfilled.reduce((s, o) => s + profitOf(o), 0);
    const totalDeposited = fulfilled
      .filter((o) => o.order_type === "wallet_topup" && Number(o.amount || 0) > 0)
      .reduce((s, o) => s + Number(o.amount || 0), 0);

    // Daily buckets for the trend chart and today/yesterday comparison.
    const days = 30;
    const today0 = startOfDay(new Date()).getTime();
    const buckets = Array.from({ length: days }, (_, i) => {
      const d = subDays(new Date(today0), days - 1 - i);
      return { key: d.getTime(), label: format(d, "d MMM"), short: format(d, "EEE"), sales: 0, profit: 0, orders: 0, failed: 0 };
    });
    const first = buckets[0].key;
    for (const o of orders) {
      if (!o.created_at) continue;
      const t = startOfDay(new Date(o.created_at)).getTime();
      if (t < first) continue;
      const b = buckets[Math.round((t - first) / 86_400_000)];
      if (!b) continue;
      if (o.status === "fulfilled") {
        b.sales += saleAmount(o);
        b.profit += profitOf(o);
        if (isSale(o)) b.orders += 1;
      } else if (o.status === "fulfillment_failed") {
        b.failed += 1;
      }
    }
    const t = buckets[days - 1];
    const y = buckets[days - 2];
    const last7 = buckets.slice(-7);
    const delivered7 = last7.reduce((s, b) => s + b.orders, 0);
    const failed7 = last7.reduce((s, b) => s + b.failed, 0);
    const successRate = delivered7 + failed7 > 0 ? (delivered7 / (delivered7 + failed7)) * 100 : null;
    const inFlight = orders.filter((o) => o.status === "paid" || o.status === "processing").length;

    return {
      totalSales,
      totalProfit,
      totalDeposited,
      totalOrders: fulfilled.length,
      buckets,
      today: t,
      yesterday: y,
      successRate,
      inFlight,
      failed7,
    };
  }, [orders, user?.id]);

  const chartData = stats.buckets.slice(-range);
  const rangeSales = chartData.reduce((s, b) => s + b.sales, 0);
  const rangeProfit = chartData.reduce((s, b) => s + b.profit, 0);
  const trend7 = (k: "sales" | "profit" | "orders") => stats.buckets.slice(-7).map((b) => b[k]);

  const storeSlug = (profile as any)?.store_slug || profile?.slug || profile?.store_name?.toLowerCase().replace(/[^a-z0-9]/g, "-") || "";
  const storeUrl = storeSlug ? `${window.location.origin}/store/${storeSlug}` : "";

  const copyStore = async () => {
    try {
      await navigator.clipboard.writeText(storeUrl);
      toast.success("Store link copied");
    } catch {
      toast.error("Couldn't copy. Long-press the link to copy it.");
    }
  };

  const quickSell = [
    { label: "MTN", sub: "Data", to: "/dashboard/buy-data/mtn", mark: "MTN" },
    { label: "Telecel", sub: "Data", to: "/dashboard/buy-data/telecel", mark: "Telecel" },
    { label: "AirtelTigo", sub: "Data", to: "/dashboard/buy-data/airteltigo", mark: "AirtelTigo" },
    { label: "Airtime", sub: "All networks", to: "/dashboard/buy-airtime", icon: Smartphone },
    { label: "Bills", sub: "ECG, water, TV", to: "/dashboard/utilities", icon: Zap },
    { label: "AFA", sub: "Registration", to: "/dashboard/afa", icon: ShieldCheck },
  ] as const;

  const explore = [
    { label: "Game arena", sub: "Play & win data", to: "/dashboard/challenges", icon: Trophy, tint: "text-amber-600 dark:text-amber-400 bg-amber-500/10" },
    { label: "Refer & earn", sub: "Invite friends", to: "/dashboard/referral", icon: Gift, tint: "text-pink-600 dark:text-pink-400 bg-pink-500/10" },
    isPaidAgent && { label: "Swift Vendor", sub: "Sell more products", to: "/dashboard/swift-vendor", icon: Zap, tint: "text-violet-600 dark:text-violet-400 bg-violet-500/10" },
    isPaidAgent && { label: "Leaderboard", sub: "Top agents this week", to: "/dashboard/leaderboard", icon: Medal, tint: "text-sky-600 dark:text-sky-400 bg-sky-500/10" },
    isPaidAgent && { label: "Result checker", sub: "WAEC & BECE", to: "/dashboard/result-checker", icon: GraduationCap, tint: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" },
    { label: "Customers", sub: "Saved numbers", to: "/dashboard/customers", icon: BookUser, tint: "text-orange-600 dark:text-orange-400 bg-orange-500/10" },
  ].filter(Boolean) as { label: string; sub: string; to: string; icon: any; tint: string }[];

  return (
    <PageContainer>
      <FreeDataClaimBanner />
      <CompleteProfileBanner />
      <LowBalanceAlertDrawer balance={walletBalance} />

      <PageHeader
        eyebrow={format(new Date(), "EEEE, d MMMM")}
        title={`${greeting()}, ${firstName}`}
        description={
          hasStore && isPaidAgent ? (
            <>Here’s how <span className="font-semibold text-foreground">{profile?.store_name}</span> is doing today.</>
          ) : (
            "Here’s a snapshot of your account today."
          )
        }
        actions={
          <>
            <LastMtnOrderWidget variant="pill" />
            <button type="button" onClick={() => fetchData(true)} disabled={refreshing} className={cn(iconBtn, "hidden sm:inline-flex border border-border/80 dark:border-white/10")} aria-label="Refresh">
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </button>
            <button type="button" onClick={() => navigate("/dashboard/buy-data/mtn")} className={cn(btnPrimary, "hidden sm:inline-flex")}>
              <ShoppingCart className="h-4 w-4" /> Sell data
            </button>
          </>
        }
      />

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-4 py-3">
          <CloudOff className="h-5 w-5 text-rose-500 shrink-0" />
          <p className="text-[13px] text-foreground flex-1">We couldn’t load your latest numbers. Check your connection and try again.</p>
          <button type="button" onClick={() => fetchData()} className="text-[13px] font-semibold text-rose-600 dark:text-rose-400 hover:underline">
            Retry
          </button>
        </div>
      )}

      {/* ── Balance + KPIs ── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <section
          className="lg:col-span-5 relative overflow-hidden rounded-2xl p-5 sm:p-6 text-white bg-[#0b0f17] ring-1 ring-white/[0.06] shadow-[0_20px_40px_-24px_rgba(0,0,0,0.6)]"
          aria-label="Wallet"
        >
          <div aria-hidden className="absolute inset-0 opacity-90" style={{ background: "radial-gradient(120% 90% at 100% 0%, hsl(var(--primary) / 0.28), transparent 55%), radial-gradient(90% 80% at 0% 100%, rgba(16,185,129,0.14), transparent 60%)" }} />
          <div aria-hidden className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)", backgroundSize: "28px 28px", maskImage: "linear-gradient(to bottom, black, transparent 80%)" }} />
          <div className="relative">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-white/60 flex items-center gap-2">
                Wallet balance
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
                </span>
              </p>
              <button type="button" onClick={toggleMask} aria-label={isMasked ? "Show balance" : "Hide balance"} className="h-8 w-8 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10">
                {isMasked ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {loading ? (
              <div className="mt-3 h-11 w-48 rounded-lg bg-white/10 animate-pulse" />
            ) : (
              <p className="mt-2 text-[38px] sm:text-[44px] font-bold tracking-[-0.03em] leading-none tabular-nums">
                <span className="text-white/50 text-[0.55em] font-semibold align-[0.35em] mr-1">GH₵</span>
                {maskValue(walletBalance)}
              </p>
            )}
            <button type="button" onClick={() => navigate("/dashboard/wallet")} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 py-1 text-[12px] font-medium text-white/80 hover:bg-white/[0.14]">
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              {fmtInt(loyaltyBalance)} SwiftPoints
              <ChevronRight className="h-3.5 w-3.5 text-white/40" />
            </button>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => navigate("/dashboard/wallet")} className="h-10 rounded-xl bg-white text-[#0b0f17] text-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-white/90 active:scale-[0.98] transition">
                <Plus className="h-4 w-4" /> Top up
              </button>
              {isPaidAgent ? (
                <button type="button" onClick={() => navigate("/dashboard/withdrawals")} className="h-10 rounded-xl bg-white/[0.1] text-white text-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-white/[0.16] active:scale-[0.98] transition">
                  <HandCoins className="h-4 w-4" /> Withdraw
                </button>
              ) : (
                <button type="button" onClick={() => navigate("/dashboard/transactions")} className="h-10 rounded-xl bg-white/[0.1] text-white text-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-white/[0.16] active:scale-[0.98] transition">
                  <Receipt className="h-4 w-4" /> History
                </button>
              )}
            </div>

            <dl className="mt-5 pt-4 border-t border-white/10 grid grid-cols-3 gap-3">
              {[
                { k: "Lifetime sales", v: fmtCedi(stats.totalSales, { compact: true }) },
                { k: isPaidAgent ? "Net profit" : "Deposited", v: fmtCedi(isPaidAgent ? stats.totalProfit : stats.totalDeposited, { compact: true }) },
                { k: "Delivered", v: fmtInt(stats.totalOrders) },
              ].map((x) => (
                <div key={x.k} className="min-w-0">
                  <dt className="text-[11px] text-white/50 truncate">{x.k}</dt>
                  <dd className="mt-0.5 text-[15px] font-semibold tabular-nums truncate">{loading ? "—" : isMasked && x.k !== "Delivered" ? "••••" : x.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <div className="lg:col-span-7 grid grid-cols-2 gap-3 sm:gap-4">
          <StatCard
            label="Sales today"
            icon={TrendingUp}
            loading={loading}
            value={fmtCedi(stats.today.sales)}
            delta={pctChange(stats.today.sales, stats.yesterday.sales)}
            trend={trend7("sales")}
          />
          <StatCard
            label={isPaidAgent ? "Profit today" : "Saved today"}
            icon={ArrowUpRight}
            loading={loading}
            value={fmtCedi(stats.today.profit)}
            delta={pctChange(stats.today.profit, stats.yesterday.profit)}
            trend={trend7("profit")}
          />
          <StatCard
            label="Orders today"
            icon={ClipboardList}
            loading={loading}
            value={fmtInt(stats.today.orders)}
            delta={pctChange(stats.today.orders, stats.yesterday.orders)}
            trend={trend7("orders")}
          />
          <StatCard
            label="Delivery success · 7d"
            icon={CheckCircle2}
            loading={loading}
            value={stats.successRate === null ? "—" : `${stats.successRate.toFixed(stats.successRate === 100 ? 0 : 1)}%`}
            hint={
              stats.inFlight > 0
                ? `${stats.inFlight} order${stats.inFlight === 1 ? "" : "s"} in progress`
                : stats.failed7 > 0
                ? `${stats.failed7} failed this week`
                : "All orders delivered"
            }
          />
        </div>
      </div>

      {/* ── Chart + quick sell ── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel
          className="lg:col-span-8"
          title="Sales performance"
          description={
            loading ? "Loading…" : (
              <>
                {fmtCedi(rangeSales)} in sales · {fmtCedi(rangeProfit)} {isPaidAgent ? "profit" : "saved"} · last {range} days
              </>
            )
          }
          action={
            <div className="inline-flex rounded-lg border border-border/80 p-0.5 dark:border-white/10" role="tablist" aria-label="Chart range">
              {([7, 30] as const).map((r) => (
                <button
                  key={r}
                  role="tab"
                  aria-selected={range === r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={cn("h-7 px-2.5 rounded-md text-xs font-semibold transition-colors", range === r ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                >
                  {r}D
                </button>
              ))}
            </div>
          }
        >
          <div className="h-[220px] sm:h-[260px] -ml-2">
            {loading ? (
              <div className="h-full w-full rounded-xl bg-muted/60 animate-pulse" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="dashSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="dashProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(152 60% 42%)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="hsl(152 60% 42%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
                  <XAxis
                    dataKey={range === 7 ? "short" : "label"}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    interval={range === 7 ? 0 : 4}
                    tickMargin={8}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))}
                  />
                  <Tooltip
                    cursor={{ stroke: "hsl(var(--border))" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p: any = payload[0].payload;
                      return (
                        <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                          <p className="font-semibold text-foreground mb-1">{p.label}</p>
                          <p className="flex items-center gap-2 text-muted-foreground">
                            <span className="h-2 w-2 rounded-full bg-primary" /> Sales <span className="ml-auto font-semibold text-foreground tabular-nums">{fmtCedi(p.sales)}</span>
                          </p>
                          <p className="flex items-center gap-2 text-muted-foreground">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" /> {isPaidAgent ? "Profit" : "Saved"}{" "}
                            <span className="ml-auto pl-4 font-semibold text-foreground tabular-nums">{fmtCedi(p.profit)}</span>
                          </p>
                          <p className="flex items-center gap-2 text-muted-foreground">
                            <span className="h-2 w-2 rounded-full bg-muted-foreground/50" /> Orders <span className="ml-auto font-semibold text-foreground tabular-nums">{p.orders}</span>
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Area type="monotone" dataKey="sales" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#dashSales)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="profit" stroke="hsl(152 60% 42%)" strokeWidth={2} fill="url(#dashProfit)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel className="lg:col-span-4" title="Quick sell" description="Start a sale in one tap">
          <div className="grid grid-cols-3 gap-2">
            {quickSell.map((q) => (
              <Link
                key={q.label}
                to={q.to}
                className="group rounded-xl border border-border/70 p-3 flex flex-col items-start gap-2 hover:border-foreground/20 hover:bg-muted/50 transition-colors dark:border-white/[0.07] dark:hover:bg-white/[0.04]"
              >
                {"mark" in q ? (
                  <NetworkMark network={q.mark} />
                ) : (
                  <span className="h-8 w-8 rounded-lg bg-muted text-foreground flex items-center justify-center dark:bg-white/[0.06]">
                    <q.icon className="h-4 w-4" />
                  </span>
                )}
                <span className="min-w-0 leading-tight">
                  <span className="block text-[13px] font-semibold text-foreground truncate">{q.label}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{q.sub}</span>
                </span>
              </Link>
            ))}
          </div>
          <Link to="/dashboard/customers" className="mt-3 flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-[13px] font-medium text-foreground hover:bg-muted dark:bg-white/[0.04]">
            <BookUser className="h-4 w-4 text-muted-foreground" />
            Sell to a saved customer
            <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground" />
          </Link>
        </Panel>
      </div>

      {/* ── Recent orders + side column ── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-8" title="Recent orders" description="Your latest sales, live" action={<PanelLink to="/dashboard/transactions">View all</PanelLink>} bodyClassName="px-2 sm:px-3 pb-2">
          {recent === null ? (
            <div className="px-2 py-2">
              <SkeletonRows rows={5} />
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No orders yet"
              description="Your first sale will show up here the moment it’s placed."
              action={
                <Link to="/dashboard/buy-data/mtn" className={btnPrimary}>
                  <ShoppingCart className="h-4 w-4" /> Make a sale
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-border/60 dark:divide-white/[0.05]">
              {recent.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-2 py-2.5 rounded-lg">
                  <NetworkMark network={o.network} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-foreground truncate">
                      {o.order_type === "airtime" ? "Airtime" : o.package_size || "Bundle"}
                      <span className="font-normal text-muted-foreground"> · {maskPhone(o.customer_phone)}</span>
                    </p>
                    <p className="text-[11.5px] text-muted-foreground">{formatDistanceToNowStrict(new Date(o.created_at), { addSuffix: true })}</p>
                  </div>
                  <StatusBadge status={o.status} className="hidden sm:inline-flex" />
                  <div className="text-right shrink-0">
                    <p className="text-[13.5px] font-semibold tabular-nums text-foreground">{fmtCedi(Number(o.amount || 0))}</p>
                    <StatusBadge status={o.status} className="sm:hidden mt-0.5" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="lg:col-span-4 space-y-4">
          {isPaidAgent && hasStore && storeUrl ? (
            <section className={cn(surface, "p-4 sm:p-5")}>
              <div className="flex items-center gap-3">
                <span className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Store className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-foreground truncate">{profile?.store_name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Store is live
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-border/70 bg-muted/40 pl-3 pr-1 h-10 dark:border-white/[0.07] dark:bg-white/[0.03]">
                <span className="text-[12.5px] text-muted-foreground truncate flex-1">{storeUrl.replace(/^https?:\/\//, "")}</span>
                <button type="button" onClick={copyStore} aria-label="Copy store link" className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background">
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a href={storeUrl} target="_blank" rel="noreferrer" className={cn(btnSecondary, "h-9 text-[13px]")}>
                  <ExternalLink className="h-4 w-4" /> Open
                </a>
                <Link to="/dashboard/my-store" className={cn(btnSecondary, "h-9 text-[13px]")}>
                  Manage
                </Link>
              </div>
            </section>
          ) : !isPaidAgent ? (
            <section className="rounded-2xl p-5 border border-primary/25 bg-gradient-to-br from-primary/[0.12] via-primary/[0.04] to-transparent">
              <p className="text-[11px] font-semibold text-primary">Agent programme</p>
              <h3 className="mt-1 text-[16px] font-semibold text-foreground leading-snug">Sell at wholesale prices with your own store</h3>
              <p className="mt-1 text-[13px] text-muted-foreground">Get agent rates, a storefront link, profit tracking and a team of sub-agents.</p>
              <button type="button" onClick={() => navigate("/agent-program")} className={cn(btnPrimary, "mt-4 w-full")}>
                Become an agent <ChevronRight className="h-4 w-4" />
              </button>
            </section>
          ) : null}

          <DailyCheckIn />
        </div>
      </div>

      <FrequentCustomersReorder />

      {/* ── Explore ── */}
      <section aria-label="Explore">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-foreground">Explore</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {explore.map((e) => (
            <Link key={e.to} to={e.to} className={cn(surface, "group p-4 flex flex-col gap-3 hover:border-foreground/20 transition-colors")}>
              <span className={cn("h-9 w-9 rounded-xl flex items-center justify-center", e.tint)}>
                <e.icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-foreground truncate">{e.label}</span>
                <span className="block text-[11.5px] text-muted-foreground truncate">{e.sub}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <WelcomeAnnouncement />
      <PromoCarousel />
      {isPaidAgent && <AgentTierRecommenderCard totalOrders={stats.totalOrders} totalSales={stats.totalSales} />}
      <ReferAndEarn />
      {predictorEnabled && <WorldCupPredictor />}

      {stats.totalDeposited > 0 && isPaidAgent && (
        <p className="text-center text-[11px] text-muted-foreground flex items-center justify-center gap-1.5">
          <ArrowDownToLine className="h-3.5 w-3.5" /> {isMasked ? "Deposits hidden" : `${fmtCedi(stats.totalDeposited)} deposited to date`}
        </p>
      )}
    </PageContainer>
  );
};

export default Dashboard;
