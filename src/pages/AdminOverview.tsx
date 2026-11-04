import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAppTheme } from "@/contexts/ThemeContext";
import {
  Users, ShoppingCart, DollarSign, ShieldCheck,
  Package, Wallet, ArrowUpRight, RefreshCw,
  CheckCircle2, Clock, XCircle, Activity, ChevronRight, TrendingUp,
  MessageCircle, Zap, AlertTriangle, Layers, Cpu, Server, Lock, Filter, Sparkles
} from "lucide-react";
import { NetworkMark, StatusBadge } from "@/components/dashboard/ui";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";
import { CardTilt } from "@/components/ui/CardTilt";
import { cn } from "@/lib/utils";

interface RecentOrder {
  id: string;
  network: string | null;
  package_size: string | null;
  customer_phone: string | null;
  amount: number;
  status: string;
  created_at: string;
}

interface DailySalesPoint {
  date: string;
  Customers: number;
  Agents: number;
  "Sub-Agents": number;
  Deposits: number;
  Purchases: number;
  GB: number;
  Orders: number;
}

interface TodaySales {
  total: number;
  customers: number;
  agents: number;
  subAgents: number;
  successCount: number;
  failedCount: number;
  pendingCount: number;
  newUsers: number;
}

const DailySalesTooltip = ({ active, payload, label, isDark }: any) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0);
  return (
    <div className={`rounded-2xl p-4 shadow-2xl text-xs border backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-200 ${isDark ? "bg-slate-950/95 border-white/15 text-white" : "bg-white/95 border-slate-200 text-slate-900"}`}>
      <p className={`mb-2 font-black tracking-wider uppercase text-[10px] ${isDark ? "text-slate-400" : "text-slate-500"}`}>{label}</p>
      <div className="space-y-1.5">
        {payload.map((p: any, i: number) => (
          <div key={i} className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color, boxShadow: `0 0 8px ${p.color}` }} />
              <span className={`font-extrabold text-[10px] uppercase tracking-wider ${isDark ? "text-slate-300" : "text-slate-700"}`}>{p.name}</span>
            </div>
            <span style={{ color: p.color }} className="font-mono font-black">GH₵ {Number(p.value).toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className={`mt-3 pt-2.5 border-t flex items-center justify-between gap-4 ${isDark ? "border-white/10" : "border-slate-200"}`}>
        <span className={`text-[10px] font-extrabold uppercase tracking-wider ${isDark ? "text-slate-400" : "text-slate-500"}`}>Total Volume</span>
        <span className="font-mono font-black text-sm text-emerald-400">GH₵ {total.toFixed(2)}</span>
      </div>
      <div className="flex justify-between items-center mt-1.5 gap-4">
        <span className="text-[10px] font-bold text-sky-400">{payload[0]?.payload?.GB?.toFixed(2) || "0.00"} GB Sold</span>
        <span className="text-[10px] font-bold text-purple-400">{payload[0]?.payload?.Orders || 0} Orders</span>
      </div>
    </div>
  );
};

const statusIcon = (s: string) => {
  if (s === "fulfilled")
    return <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/30"><CheckCircle2 className="w-4 h-4 text-emerald-400" /></div>;
  if (s === "fulfillment_failed")
    return <div className="w-8 h-8 rounded-xl bg-rose-500/10 flex items-center justify-center border border-rose-500/30"><XCircle className="w-4 h-4 text-rose-400" /></div>;
  return <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/30"><Clock className="w-4 h-4 text-amber-400" /></div>;
};

const parseCapacity = (sizeStr: string | null) => {
  if (!sizeStr) return 0;
  const s = sizeStr.toUpperCase().replace(/\s+/g, "");
  const match = s.match(/([0-9.]+)(MB|GB|TB)/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  if (match[2] === "MB") return val / 1024;
  if (match[2] === "TB") return val * 1024;
  return val;
};

/**
 * PostgREST returns at most 1,000 rows per request (supabase/config.toml max_rows),
 * so totals summed in the browser must page through every row. Returns the rows,
 * the server's exact count, and whether we stopped early at maxRows.
 */
async function fetchAllRows(
  build: (from: number, to: number) => any,
  maxRows = 50_000
): Promise<{ data: any[] | null; error: any; total: number | null; partial: boolean }> {
  const PAGE = 1000;
  let all: any[] = [];
  let total: number | null = null;
  for (let from = 0; from < maxRows; from += PAGE) {
    const { data, error, count } = await build(from, from + PAGE - 1);
    if (error) return { data: all.length ? all : null, error, total, partial: true };
    if (total === null && typeof count === "number") total = count;
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
  }
  return { data: all, error: null, total, partial: total !== null ? all.length < total : false };
}

const AdminOverview = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isDark } = useAppTheme();

  const [stats, setStats] = useState({
    totalOrders: 0,
    totalRevenue: 0,
    totalPurchases: 0,
    totalUsers: 0,
    pendingAgents: 0,
    swiftDataSubAgentShare: 0,
    totalAgentProfit: 0,
    totalSubAgentProfit: 0,
    todaySignups: 0,
    pendingWithdrawals: 0,
    unreadTickets: 0,
    totalSystemBalance: 0,
    totalRangePurchase: 0,
    rangeInflow: 0,
    rangeVerifiedInflow: 0,
    rangePurchases: 0,
    totalNetAdminProfit: 0,
    apiVolume: 0,
    paystackVolume: 0,
    totalGb: 0,
    rangeGb: 0,
    rangeCount: 0,
  });
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [dailySales, setDailySales] = useState<DailySalesPoint[]>([]);
  const [todaySales, setTodaySales] = useState<TodaySales & { gb: number; count: number }>({ total: 0, customers: 0, agents: 0, subAgents: 0, successCount: 0, failedCount: 0, pendingCount: 0, newUsers: 0, gb: 0, count: 0 });
  const [providerBalance, setProviderBalance] = useState<number | null>(null);
  const [providerBalancesList, setProviderBalancesList] = useState<any[]>([]);
  const [syncingProviders, setSyncingProviders] = useState(false);
  const [providerDiagnostics, setProviderDiagnostics] = useState<any>(null);
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "1y" | "all">("7d");
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("We are performing scheduled maintenance. Please check back soon.");
  const [savingMaintenance, setSavingMaintenance] = useState(false);
  const [maintenanceTableReady, setMaintenanceTableReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [approvingPending, setApprovingPending] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [updatedKeys, setUpdatedKeys] = useState<Set<string>>(new Set());
  const [verifiedLogs, setVerifiedLogs] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"topups" | "audit">("topups");
  const [aiRecommendations, setAiRecommendations] = useState<any[]>([]);
  const [totalsPartial, setTotalsPartial] = useState<{ orders: boolean; wallets: boolean; orderTotal: number | null }>({ orders: false, wallets: false, orderTotal: null });

  const fetchData = useCallback(async () => {
    const now = new Date();
    let startDate = new Date();
    if (timeRange === "7d") startDate.setDate(now.getDate() - 6);
    else if (timeRange === "30d") startDate.setDate(now.getDate() - 29);
    else if (timeRange === "1y") startDate.setFullYear(now.getFullYear() - 1);
    else startDate = new Date(2024, 0, 1);

    startDate.setHours(0, 0, 0, 0);
    const todayStr = now.toISOString().slice(0, 10);
    const todayIso = `${todayStr}T00:00:00.000Z`;

    const DEPOSIT_TYPES = new Set(["wallet_topup", "agent_activation", "sub_agent_activation"]);
    const SALE_TYPES    = new Set(["data", "airtime", "utility", "afa", "api"]);

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token || "";

    const settled = await Promise.allSettled([
      fetchAllRows((f, t) => supabase.from("orders").select("id, amount, status, order_type, profit, parent_profit, cost_price, paystack_fee, paystack_verified_amount, package_size", { count: "exact" }).order("id", { ascending: true }).range(f, t), 30_000),
      supabase.from("profiles").select("user_id, is_agent, is_sub_agent, agent_approved, sub_agent_approved, onboarding_complete, created_at").order("created_at", { ascending: false }).limit(5000),
      supabase.functions.invoke("maintenance-mode", { body: { action: "get" } }),
      supabase.from("orders").select("id, network, package_size, customer_phone, amount, status, created_at").order("created_at", { ascending: false }).limit(8),
      fetchAllRows((f, t) => supabase.from("orders").select("id, amount, agent_id, created_at, status, order_type, paystack_verified_amount, paystack_fee, profit, parent_profit, cost_price, package_size", { count: "exact" }).gte("created_at", startDate.toISOString()).order("created_at", { ascending: false }).order("id", { ascending: true }).range(f, t), 30_000),
      supabase.functions.invoke("system-payout-v1", {
        body: { action: "get_provider_balance" },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      }).catch(e => ({ data: { success: false, error: e.message }, error: e })),
      supabase.from("withdrawals").select("id, status", { count: "exact" }).in("status", ["pending", "processing"]),
      supabase.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("orders").select("id, order_type, amount, status, created_at, network, package_size, customer_phone").eq("status", "fulfilled").order("created_at", { ascending: false }).limit(15),
      supabase.from("audit_logs").select("id, action, details, created_at, profiles(full_name)").order("created_at", { ascending: false }).limit(6),
      fetchAllRows((f, t) => supabase.from("wallets").select("balance", { count: "exact" }).order("agent_id", { ascending: true }).range(f, t)),
      fetchAllRows((f, t) => supabase.from("user_sales_stats").select("total_sales_volume, total_own_profit, total_commissions_paid", { count: "exact" }).range(f, t)),
      (supabase.rpc as any)("get_admin_sales_stats_v2", { p_start_date: startDate.toISOString() }),
      supabase.from("ai_recommendations").select("*").is("user_id", null).eq("is_acted_upon", false).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_agent", true).eq("is_sub_agent" as any, false).eq("agent_approved", false),
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", todayIso),
      supabase.from("providers").select("id, name, handler_type, balance, is_active, consecutive_failures, last_synced_at, priority").eq("is_active", true).order("priority", { ascending: true }),
    ]);

    const unwrap = (r: PromiseSettledResult<any>) => r.status === "fulfilled" ? r.value : { data: null, error: null };
    const [ordersRes, profilesRes, maintenanceRes, recentRes, rangeOrdersRes, providerRes, withdrawalsRes, ticketsRes, topupsRes, auditRes, walletsRes, salesStatsRes, rpcStatsRes, aiRes, totalUsersCountRes, pendingAgentsCountRes, todayUsersCountRes, dbProvidersRes] = settled.map(unwrap);

    if (aiRes && aiRes.data) {
      setAiRecommendations(aiRes.data);
    }

    const orders = ordersRes?.data || [];
    const ordersPartial = Boolean((ordersRes as any)?.partial) || Boolean((rangeOrdersRes as any)?.partial);
    const walletsPartial = Boolean((walletsRes as any)?.partial);
    setTotalsPartial({ orders: ordersPartial, wallets: walletsPartial, orderTotal: (ordersRes as any)?.total ?? null });
    const profiles = profilesRes?.data || [];
    const rangeOrders = rangeOrdersRes?.data || [];
    const wallets = walletsRes?.data || [];
    const salesStats = salesStatsRes?.data || [];

    const totalSystemBalance = Array.isArray(wallets) ? wallets.reduce((s, w) => s + (Number(w?.balance) || 0), 0) : 0;
    const totalVolumeAllTime = Array.isArray(salesStats) ? salesStats.reduce((s, st) => s + (Number(st?.total_sales_volume) || 0), 0) : 0;
    const totalAgentProfitsAllTime = Array.isArray(salesStats) ? salesStats.reduce((s, st) => s + (Number(st?.total_own_profit) || 0), 0) : 0;
    const totalSubAgentProfitsAllTime = Array.isArray(salesStats) ? salesStats.reduce((s, st) => s + (Number(st?.total_commissions_paid) || 0), 0) : 0;

    const fulfilledOrders = orders.filter((o: any) => o.status === "fulfilled");
    const totalNetAdminProfit = fulfilledOrders.reduce((s, o: any) => {
      const isApiOrder = o.order_type === "api";
      const amt = isApiOrder
        ? (Number(o.amount) || 0)
        : (Number(o.paystack_verified_amount) || Number(o.amount) || 0);
      const fee = isApiOrder ? 0 : (Number(o.paystack_fee) || 0);
      const agentProf = Number(o.profit) || 0;
      const parentProf = Number(o.parent_profit) || 0;
      const cost = Number(o.cost_price) || 0;

      if (isApiOrder) {
        return s + agentProf;
      }

      if (["data", "airtime", "utility", "afa"].includes(o.order_type)) {
        return s + (amt - fee - agentProf - parentProf - cost);
      }

      if (["agent_activation", "sub_agent_activation"].includes(o.order_type)) {
        return s + (amt - fee);
      }

      if (o.order_type === "wallet_topup") {
        const credited = Number(o.amount) || 0;
        if (credited <= 0) return s;
        const received = Number(o.paystack_verified_amount) || credited;
        return s + (received - fee - credited);
      }

      return s;
    }, 0);
    
    const maintenanceRow = (maintenanceRes?.data as any) || null;
    const maintenanceError = maintenanceRes?.error || maintenanceRow?.error;

    const agentIds = new Set(profiles.filter((p: any) => p?.is_agent && p?.agent_approved).map((p: any) => p?.user_id));
    const subAgentIds = new Set(profiles.filter((p: any) => p?.is_sub_agent && p?.sub_agent_approved).map((p: any) => p?.user_id));

    const rpcStats = (rpcStatsRes as any)?.data;
    let dailySalesData: DailySalesPoint[] = [];

    if (rpcStats && Array.isArray(rpcStats)) {
      const daysCount = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
      const dateMap: Record<string, DailySalesPoint> = {};
      for (let i = daysCount - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        dateMap[key] = {
          date: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
          Customers: 0, Agents: 0, "Sub-Agents": 0, Deposits: 0, Purchases: 0, GB: 0, Orders: 0
        };
      }
      for (const r of rpcStats) {
        const key = String(r.bucket_date || "").slice(0, 10);
        if (dateMap[key]) {
          dateMap[key].Customers = Number(r.customer_sales) || 0;
          dateMap[key].Agents = Number(r.agent_sales) || 0;
          dateMap[key]["Sub-Agents"] = Number(r.sub_agent_sales) || 0;
          dateMap[key].Deposits = Number(r.deposit_volume) || 0;
          dateMap[key].Purchases = dateMap[key].Customers + dateMap[key].Agents + dateMap[key]["Sub-Agents"];
          dateMap[key].GB = Number(r.data_volume_gb) || 0;
          dateMap[key].Orders = Number(r.order_count) || 0;
        }
      }
      dailySalesData = Object.values(dateMap);
    } else {
      const chartMap: Record<string, DailySalesPoint> = {};
      const daysCount = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
      for (let i = daysCount - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        chartMap[key] = { date: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), Customers: 0, Agents: 0, "Sub-Agents": 0, Deposits: 0, Purchases: 0, GB: 0, Orders: 0 };
      }

      rangeOrders.forEach((o: any) => {
        if (o.status !== "fulfilled") return;
        const key = (o.created_at as string).slice(0, 10);
        if (!chartMap[key]) return;
        const amt = Number(o.paystack_verified_amount || o.amount) || 0;
        if (DEPOSIT_TYPES.has(o.order_type)) {
          chartMap[key].Deposits += amt;
        } else if (SALE_TYPES.has(o.order_type)) {
          chartMap[key].Purchases += amt;
          chartMap[key].GB += parseCapacity(o.package_size);
          chartMap[key].Orders += 1;
          if (agentIds.has(o.agent_id)) chartMap[key].Agents += amt;
          else if (subAgentIds.has(o.agent_id)) chartMap[key]["Sub-Agents"] += amt;
          else chartMap[key].Customers += amt;
        }
      });
      dailySalesData = Object.values(chartMap);
    }

    setDailySales(dailySalesData);
    
    const todayOrders = rangeOrders.filter((o: any) => (o.created_at as string).slice(0, 10) === todayStr);
    const todaySuccess = todayOrders.filter((o: any) => o.status === "fulfilled").length;
    const todayFailed = todayOrders.filter((o: any) => o.status === "fulfillment_failed").length;
    const todayPending = todayOrders.filter((o: any) => o.status === "pending").length;
    const totalUsersCount = totalUsersCountRes?.count ?? profiles.length;
    const pendingAgentsCount = pendingAgentsCountRes?.count ?? profiles.filter((p: any) => p.is_agent && !p.agent_approved && p.onboarding_complete).length;
    const todayUsersCount = todayUsersCountRes?.count ?? profiles.filter((p: any) => (p.created_at as string)?.slice(0, 10) === todayStr).length;

    const inflowOrders = orders.filter((o: any) => o.status === "fulfilled" && ["wallet_topup", "agent_activation", "sub_agent_activation"].includes(o.order_type) && Number(o.amount || 0) > 0);
    const purchaseOrders = orders.filter((o: any) => o.status === "fulfilled" && ["data", "airtime", "utility", "afa", "api"].includes(o.order_type));

    const totalRevenue = inflowOrders.reduce((s: number, o: any) => s + (Number(o.paystack_verified_amount) || Number(o.amount) || 0), 0);

    const totalPurchases = purchaseOrders.reduce((s: number, o: any) => {
      if (o.order_type === "api") return s + (Number(o.amount) || 0);
      return s + (Number(o.paystack_verified_amount) || Number(o.amount) || 0);
    }, 0);

    const apiVolume = purchaseOrders.filter((o: any) => o.order_type === "api").reduce((s: number, o: any) => s + (Number(o.amount) || 0), 0);
    const paystackVolume = purchaseOrders.filter((o: any) => o.order_type !== "api").reduce((s: number, o: any) => s + (Number(o.paystack_verified_amount) || Number(o.amount) || 0), 0);

    const PURCHASE_TYPES = ["data", "airtime", "utility", "afa", "api"];
    const todayFulfilledPurchases = todayOrders.filter((o: any) => o.status === "fulfilled" && PURCHASE_TYPES.includes(o.order_type));
    
    const todayAmt = (o: any) => o.order_type === "api"
      ? (Number(o.amount) || 0)
      : (Number(o.paystack_verified_amount) || Number(o.amount) || 0);

    setTodaySales({
      total: todayFulfilledPurchases.reduce((s, o) => s + todayAmt(o), 0),
      customers: todayFulfilledPurchases.filter(o => !agentIds.has(o.agent_id) && !subAgentIds.has(o.agent_id)).reduce((s, o) => s + todayAmt(o), 0),
      agents: todayFulfilledPurchases.filter(o => agentIds.has(o.agent_id)).reduce((s, o) => s + todayAmt(o), 0),
      subAgents: todayFulfilledPurchases.filter(o => subAgentIds.has(o.agent_id)).reduce((s, o) => s + todayAmt(o), 0),
      successCount: todaySuccess,
      failedCount: todayFailed,
      pendingCount: todayPending,
      newUsers: todayUsersCount,
      gb: todayFulfilledPurchases.reduce((s, o) => s + parseCapacity(o.package_size), 0),
      count: todayFulfilledPurchases.length,
    });
    const rangeInflow = rangeOrders.filter((o: any) => o.status === "fulfilled" && ["wallet_topup", "agent_activation", "sub_agent_activation"].includes(o.order_type) && Number(o.amount || 0) > 0).reduce((s: number, o: any) => s + (Number(o.amount) || 0), 0);
    const rangeVerifiedInflow = rangeOrders.filter((o: any) => o.status === "fulfilled" && ["wallet_topup", "agent_activation", "sub_agent_activation"].includes(o.order_type) && Number(o.amount || 0) > 0).reduce((s: number, o: any) => s + (Number(o.paystack_verified_amount) || Number(o.amount) || 0), 0);
    const rangePurchaseOrders = rangeOrders.filter((o: any) => o.status === "fulfilled" && ["data", "airtime", "utility", "afa", "api"].includes(o.order_type));
    const rangePurchases = rangePurchaseOrders.reduce((s: number, o: any) => {
      if (o.order_type === "api") return s + (Number(o.amount) || 0);
      return s + (Number(o.paystack_verified_amount) || Number(o.amount) || 0);
    }, 0);

    const withdrawalRows = withdrawalsRes.data || [];
    const pendingWithdrawalsCount = withdrawalRows.filter((w: any) => w.status === "pending").length;
    const processingWithdrawalsCount = withdrawalRows.filter((w: any) => w.status === "processing").length;

    setStats({
      totalOrders: orders.length,
      totalRevenue: totalRevenue,
      totalPurchases: totalPurchases,
      totalUsers: totalUsersCount,
      pendingAgents: pendingAgentsCount,
      swiftDataSubAgentShare: totalVolumeAllTime - totalAgentProfitsAllTime,
      totalAgentProfit: totalAgentProfitsAllTime,
      totalSubAgentProfit: totalSubAgentProfitsAllTime,
      pendingWithdrawals: pendingWithdrawalsCount + processingWithdrawalsCount,
      unreadTickets: ticketsRes.count || 0,
      totalSystemBalance,
      todaySignups: todayUsersCount,
      totalRangePurchase: rangePurchases,
      rangeInflow: rangeOrders.filter((o: any) => o.status === "fulfilled" && DEPOSIT_TYPES.has(o.order_type)).reduce((s: number, o: any) => s + (Number(o.amount) || 0), 0),
      rangeVerifiedInflow: rangeOrders.filter((o: any) => o.status === "fulfilled" && DEPOSIT_TYPES.has(o.order_type)).reduce((s: number, o: any) => s + (Number(o.paystack_verified_amount) || Number(o.amount) || 0), 0),
      rangePurchases,
      totalNetAdminProfit,
      apiVolume,
      paystackVolume,
      totalGb: purchaseOrders.reduce((s: number, o: any) => s + parseCapacity(o.package_size), 0),
      rangeGb: rangePurchaseOrders.reduce((s: number, o: any) => s + parseCapacity(o.package_size), 0),
      rangeCount: rangePurchaseOrders.length,
    });
    setRecentOrders((recentRes.data || []) as RecentOrder[]);
    setVerifiedLogs(topupsRes.data || []);
    setAuditLogs(auditRes.data || []);
    
    if (providerRes.data?.success) {
      setProviderBalance(Number(providerRes.data.balance ?? 0));
      if (Array.isArray(providerRes.data.results) && providerRes.data.results.length > 0) {
        setProviderBalancesList(providerRes.data.results);
      } else if (Array.isArray(dbProvidersRes?.data)) {
        setProviderBalancesList(dbProvidersRes.data);
      }
      setProviderDiagnostics(providerRes.data.diagnostics);
    } else {
      if (Array.isArray(dbProvidersRes?.data) && dbProvidersRes.data.length > 0) {
        setProviderBalancesList(dbProvidersRes.data);
        const fallbackPrimary =
          dbProvidersRes.data.find((p: any) => p.priority === 1 && Number(p.balance) > 0) ??
          dbProvidersRes.data.find((p: any) => Number(p.balance) > 0) ??
          dbProvidersRes.data[0];
        if (fallbackPrimary) {
          setProviderBalance(Number(fallbackPrimary.balance || 0));
        }
      }
      if (providerRes.data?.diagnostics) {
        setProviderDiagnostics(providerRes.data.diagnostics);
      }
    }

    if (maintenanceError) {
      setMaintenanceTableReady(false);
    } else if (maintenanceRow) {
      setMaintenanceTableReady(Boolean(maintenanceRow.table_ready ?? true));
      setMaintenanceEnabled(!!maintenanceRow.is_enabled);
      setMaintenanceMessage(maintenanceRow.message?.trim() || "We are performing scheduled maintenance. Please check back soon.");
    }
    setLastUpdated(new Date());
  }, [timeRange]);

  const safeFetchData = useCallback(async () => {
    try {
      await fetchData();
    } catch (err) {
      console.error("[AdminOverview] fetchData error:", err);
    } finally {
      setLoading(false);
    }
  }, [fetchData]);

  const refreshChart = useCallback(async () => {
    const now = new Date();
    let startDate = new Date();
    if (timeRange === "7d") startDate.setDate(now.getDate() - 6);
    else if (timeRange === "30d") startDate.setDate(now.getDate() - 29);
    else if (timeRange === "1y") startDate.setFullYear(now.getFullYear() - 1);
    else startDate = new Date(2024, 0, 1);
    startDate.setHours(0, 0, 0, 0);
    const todayStr = now.toISOString().slice(0, 10);
    const PURCHASE_TYPES = ["data", "airtime", "utility", "afa", "api"];

    try {
      const [rpcRes, recentRes, todayRes] = await Promise.all([
        (supabase.rpc as any)("get_admin_sales_stats_v2", { p_start_date: startDate.toISOString() }),
        supabase.from("orders").select("id, network, package_size, customer_phone, amount, status, created_at").order("created_at", { ascending: false }).limit(8),
        fetchAllRows((f, t) => supabase.from("orders").select("id, amount, agent_id, status, order_type, paystack_verified_amount, created_at, package_size", { count: "exact" }).gte("created_at", `${todayStr}T00:00:00`).order("id", { ascending: true }).range(f, t), 30_000),
      ]);

      const rpcStats = (rpcRes.data || []) as any[];
      if (rpcStats && Array.isArray(rpcStats)) {
        const daysCount = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
        const dateMap: Record<string, DailySalesPoint> = {};
        for (let i = daysCount - 1; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(now.getDate() - i);
          const key = d.toISOString().slice(0, 10);
          dateMap[key] = { date: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), Customers: 0, Agents: 0, "Sub-Agents": 0, Deposits: 0, Purchases: 0, GB: 0, Orders: 0 };
        }
        for (const r of rpcStats) {
          const key = String(r.bucket_date || "").slice(0, 10);
          if (dateMap[key]) {
            dateMap[key].Customers = Number(r.customer_sales) || 0;
            dateMap[key].Agents = Number(r.agent_sales) || 0;
            dateMap[key]["Sub-Agents"] = Number(r.sub_agent_sales) || 0;
            dateMap[key].Deposits = Number(r.deposit_volume) || 0;
            dateMap[key].Purchases = dateMap[key].Customers + dateMap[key].Agents + dateMap[key]["Sub-Agents"];
            dateMap[key].GB = Number(r.data_volume_gb) || 0;
            dateMap[key].Orders = Number(r.order_count) || 0;
          }
        }
        setDailySales(Object.values(dateMap));
      }

      if (recentRes.data) setRecentOrders(recentRes.data as RecentOrder[]);

      const todayOrders = todayRes.data || [];
      const todayFulfilled = todayOrders.filter((o: any) => o.status === "fulfilled" && PURCHASE_TYPES.includes(o.order_type));
      const todayAmt = (o: any) => o.order_type === "api" ? (Number(o.amount) || 0) : (Number(o.paystack_verified_amount) || Number(o.amount) || 0);
      setTodaySales((prev) => ({
        ...prev,
        total: todayFulfilled.reduce((s: number, o: any) => s + todayAmt(o), 0),
        successCount: todayOrders.filter((o: any) => o.status === "fulfilled").length,
        failedCount: todayOrders.filter((o: any) => o.status === "fulfillment_failed").length,
        pendingCount: todayOrders.filter((o: any) => o.status === "pending").length,
        gb: todayFulfilled.reduce((s: number, o: any) => s + parseCapacity(o.package_size), 0),
        count: todayFulfilled.length,
      }));

      setLastUpdated(new Date());
    } catch (err) {
      console.error("[AdminOverview] refreshChart error:", err);
    }
  }, [timeRange]);

  useEffect(() => {
    safeFetchData();

    const rand = Math.random().toString(36).substring(7);

    const ordersChannel = supabase
      .channel(`admin_live_orders_${rand}`)
      .on("postgres_changes", { event: "*", table: "orders", schema: "public" }, (payload) => {
        refreshChart();
        if (payload.eventType === "INSERT") {
          toast({
            title: "New Order Received!",
            description: `Amount: GHS ${payload.new.amount}. Customer: ${payload.new.customer_phone || "Unknown"}`,
          });
        }
        setUpdatedKeys(new Set(["totalRevenue", "Agent Profits", "Platform Share"]));
        setTimeout(() => setUpdatedKeys(new Set()), 1500);
      })
      .subscribe();

    const profilesChannel = supabase
      .channel(`admin_live_profiles_${rand}`)
      .on("postgres_changes", { event: "INSERT", table: "profiles", schema: "public" }, () => {
        safeFetchData();
        setUpdatedKeys(new Set(["Pending Agents", "Active Users"]));
        setTimeout(() => setUpdatedKeys(new Set()), 1500);
      })
      .subscribe();

    const handleGlobalAdminRefresh = () => {
      safeFetchData();
    };
    window.addEventListener("swiftdata:admin-refresh", handleGlobalAdminRefresh);

    const interval = setInterval(safeFetchData, 60_000);

    return () => {
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(profilesChannel);
      window.removeEventListener("swiftdata:admin-refresh", handleGlobalAdminRefresh);
      clearInterval(interval);
    };
  }, [timeRange, safeFetchData, refreshChart, toast]);

  const saveMaintenance = async () => {
    if (!maintenanceTableReady) {
      toast({ title: "Maintenance table missing", description: "Run the latest Supabase migration.", variant: "destructive" });
      return;
    }
    setSavingMaintenance(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      toast({ title: "Not authenticated", variant: "destructive" });
      setSavingMaintenance(false);
      return;
    }
    const { data, error } = await supabase.functions.invoke("maintenance-mode", {
      body: { action: "set", is_enabled: maintenanceEnabled, message: maintenanceMessage.trim() || "We are performing scheduled maintenance. Please check back soon." },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error || data?.error) {
      toast({ title: "Failed to save maintenance mode", description: (data?.error as string) || error?.message, variant: "destructive" });
    } else {
      toast({ title: maintenanceEnabled ? "Maintenance mode enabled" : "Maintenance mode disabled" });
    }
    setSavingMaintenance(false);
  };

  const approveAllPending = async () => {
    setApprovingPending(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "approve_all_pending_agents" },
      headers: { Authorization: `Bearer ${sessionData?.session?.access_token}` },
    });
    if (error || data?.error) {
      toast({ title: "Failed to approve agents", description: data?.error || error?.message, variant: "destructive" });
    } else {
      const count = data?.approved ?? 0;
      toast({ title: count > 0 ? `Approved ${count} agent${count !== 1 ? "s" : ""}` : "No pending agents to approve" });
      await safeFetchData();
    }
    setApprovingPending(false);
  };

  const [maintenanceDirty, setMaintenanceDirty] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [auditSyncing, setAuditSyncing] = useState(false);

  const refreshProviders = async () => {
    setSyncingProviders(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || "";
      const res = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "get_provider_balance" },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.data?.success && Array.isArray(res.data.results)) {
        setProviderBalancesList(res.data.results);
        setProviderBalance(Number(res.data.balance ?? 0));
        toast({ title: "Provider balances refreshed" });
      }
    } catch (err: any) {
      toast({ title: "Couldn't refresh providers", description: err?.message || "Error", variant: "destructive" });
    } finally {
      setSyncingProviders(false);
    }
  };

  const runAuditSync = async () => {
    setAuditSyncing(true);
    toast({ title: "Audit sync started", description: "Checking telecom orders with DataMart…" });
    try {
      await supabase.functions.invoke("datamart-sync");
      toast({ title: "Audit sync complete" });
      safeFetchData();
    } catch {
      toast({ title: "Audit sync failed", variant: "destructive" });
    } finally {
      setAuditSyncing(false);
    }
  };

  const ced = (n: number) => `GH₵${Number(n || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const rangeLabel = { "7d": "last 7 days", "30d": "last 30 days", "1y": "last 12 months", all: "all time" }[timeRange];
  const providerLow = providerBalance !== null && providerBalance < 50;
  const degradedProviders = providerBalancesList.filter((p: any) => Number(p.consecutive_failures || 0) >= 3);
  const todayAttempted = todaySales.successCount + todaySales.failedCount;
  const successRate = todayAttempted > 0 ? Math.round((todaySales.successCount / todayAttempted) * 100) : null;

  type ActionItem = { key: string; tone: "rose" | "amber" | "sky" | "violet"; icon: any; title: string; detail: string; cta?: { label: string; onClick: () => void }; extra?: React.ReactNode };
  const actions: ActionItem[] = [];
  if (stats.pendingAgents > 0)
    actions.push({
      key: "agents",
      tone: "amber",
      icon: ShieldCheck,
      title: `${stats.pendingAgents} agent${stats.pendingAgents === 1 ? "" : "s"} waiting for approval`,
      detail: "Review applications, or approve everyone at once.",
      cta: { label: "Review", onClick: () => navigate("/admin/agents") },
      extra: confirmApprove ? (
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={async () => { setConfirmApprove(false); await approveAllPending(); }} disabled={approvingPending} className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[12.5px] font-semibold hover:bg-emerald-500 disabled:opacity-60">
            {approvingPending ? "Approving…" : `Yes, approve ${stats.pendingAgents}`}
          </button>
          <button type="button" onClick={() => setConfirmApprove(false)} className="h-8 px-2.5 rounded-lg text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted">Cancel</button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirmApprove(true)} className="h-8 px-3 rounded-lg border border-border text-[12.5px] font-semibold text-foreground hover:bg-muted">Approve all</button>
      ),
    });
  if (stats.pendingWithdrawals > 0)
    actions.push({ key: "wd", tone: "amber", icon: Wallet, title: `${stats.pendingWithdrawals} withdrawal${stats.pendingWithdrawals === 1 ? "" : "s"} to process`, detail: "Agents are waiting for payouts.", cta: { label: "Open", onClick: () => navigate("/admin/withdrawals") } });
  if (todaySales.failedCount > 0)
    actions.push({ key: "failed", tone: "rose", icon: XCircle, title: `${todaySales.failedCount} failed order${todaySales.failedCount === 1 ? "" : "s"} today`, detail: "Retry or refund so customers aren't left waiting.", cta: { label: "View orders", onClick: () => navigate("/admin/orders") } });
  if (providerLow)
    actions.push({
      key: "prov",
      tone: "rose",
      icon: Server,
      title: `Provider wallet is low (${ced(providerBalance || 0)})`,
      detail: "Orders will start failing when it runs out.",
      cta: providerDiagnostics?.baseUrl ? { label: "Top up", onClick: () => window.open(providerDiagnostics.baseUrl, "_blank", "noopener,noreferrer") } : undefined,
    });
  if (degradedProviders.length > 0)
    actions.push({ key: "deg", tone: "amber", icon: AlertTriangle, title: `${degradedProviders.map((p: any) => p.name).join(", ")} failing repeatedly`, detail: "3 or more failures in a row. Check the provider or lower its priority.", cta: { label: "Providers", onClick: () => navigate("/admin/packages") } });
  if (stats.unreadTickets > 0)
    actions.push({ key: "tickets", tone: "sky", icon: MessageCircle, title: `${stats.unreadTickets} open support ticket${stats.unreadTickets === 1 ? "" : "s"}`, detail: "Customers are waiting on a reply.", cta: { label: "Reply", onClick: () => navigate("/admin/tickets") } });
  if (maintenanceEnabled && !maintenanceDirty)
    actions.push({ key: "maint", tone: "violet", icon: Lock, title: "Maintenance mode is on", detail: "Customers can't check out until you turn it off." });
  aiRecommendations.forEach((rec) =>
    actions.push({
      key: `ai-${rec.id}`,
      tone: "violet",
      icon: Sparkles,
      title: rec.title || "Recommendation",
      detail: rec.message,
      cta: {
        label: "Dismiss",
        onClick: async () => {
          await (supabase.from("ai_recommendations") as any).update({ is_acted_upon: true }).eq("id", rec.id);
          setAiRecommendations((prev) => prev.filter((r) => r.id !== rec.id));
        },
      },
    })
  );

  const toneCls: Record<ActionItem["tone"], string> = {
    rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  };

  const kpis = [
    { label: "Net admin profit", value: ced(stats.totalNetAdminProfit), icon: TrendingUp, hint: totalsPartial.orders ? `Latest 30,000 of ${(totalsPartial.orderTotal || 0).toLocaleString()} orders` : "After costs & fees" },
    { label: "Total inflow", value: ced(stats.totalRevenue), icon: DollarSign, hint: totalsPartial.orders ? "Partial: very large order history" : "All payments in" },
    { label: "Data sold", value: `${(stats.totalGb || 0).toLocaleString("en-GH", { maximumFractionDigits: 2 })} GB`, icon: Package, hint: `${(stats.rangeGb || 0).toFixed(1)} GB in ${rangeLabel}` },
    { label: "Agent profits", value: ced(Number(stats.totalAgentProfit || 0) + Number(stats.totalSubAgentProfit || 0)), icon: Users, hint: "Agents + sub-agents" },
    { label: "Provider wallet", value: providerBalance !== null ? ced(providerBalance) : "—", icon: Server, hint: providerLow ? "Low, top up soon" : "Main provider balance", warn: providerLow },
    { label: "User wallet balances", value: ced(stats.totalSystemBalance), icon: Wallet, hint: totalsPartial.wallets ? "Partial: couldn't load every wallet" : "All wallets · owed to users" },
    { label: "Users", value: stats.totalUsers.toLocaleString(), icon: Users, hint: `${stats.todaySignups || todaySales.newUsers || 0} joined today` },
    { label: "Sales today", value: ced(todaySales.total), icon: Activity, hint: successRate === null ? "No completed orders yet" : `${successRate}% delivered · ${todaySales.count || todayAttempted} orders` },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-9 w-56 rounded-lg bg-muted animate-pulse" />
        <div className="h-40 rounded-2xl bg-muted/70 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-muted/70 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const axisColor = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
  const card = "rounded-2xl border border-border/70 bg-card/85 dark:border-white/[0.08] dark:bg-black/30";

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Live"}
          </p>
          <h1 className="text-[22px] sm:text-[28px] font-bold tracking-[-0.02em] text-foreground leading-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">How SwiftData is doing, and what needs you.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-border/80 bg-card p-0.5 dark:bg-white/[0.03] dark:border-white/10" role="tablist" aria-label="Date range">
            {(["7d", "30d", "1y", "all"] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={timeRange === r}
                onClick={() => setTimeRange(r)}
                className={cn("h-8 px-3 rounded-lg text-[12.5px] font-semibold transition-colors", timeRange === r ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
              >
                {r === "all" ? "All" : r.toUpperCase()}
              </button>
            ))}
          </div>
          <button type="button" onClick={safeFetchData} aria-label="Refresh" className="h-9 w-9 rounded-xl border border-border/80 bg-card flex items-center justify-center text-muted-foreground hover:text-foreground dark:bg-white/[0.03] dark:border-white/10">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Needs attention */}
      <section className={card} aria-label="Needs your attention">
        <header className="flex items-center justify-between px-4 sm:px-5 pt-4">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">Needs your attention</h2>
            <p className="text-xs text-muted-foreground">{actions.length ? `${actions.length} item${actions.length === 1 ? "" : "s"}` : "Nothing urgent right now"}</p>
          </div>
        </header>
        {actions.length === 0 ? (
          <div className="flex items-center gap-3 px-4 sm:px-5 py-5">
            <span className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <p className="text-[13.5px] text-foreground">All clear. No pending agents, payouts, failed orders or provider issues.</p>
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border/60 dark:divide-white/[0.06]">
            {actions.map((a) => (
              <li key={a.key} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 sm:px-5 py-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className={cn("h-9 w-9 shrink-0 rounded-xl flex items-center justify-center", toneCls[a.tone])}>
                    <a.icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-foreground">{a.title}</p>
                    <p className="text-[12.5px] text-muted-foreground line-clamp-2">{a.detail}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 pl-12 sm:pl-0">
                  {a.extra}
                  {a.cta && (
                    <button type="button" onClick={a.cta.onClick} className="h-8 px-3 rounded-lg bg-foreground text-background text-[12.5px] font-semibold hover:opacity-90 inline-flex items-center gap-1">
                      {a.cta.label} <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className={cn(card, "p-4 flex flex-col gap-2.5 min-w-0", k.warn && "border-rose-500/40 dark:border-rose-500/40")}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted-foreground truncate">{k.label}</p>
              <k.icon className={cn("h-4 w-4 shrink-0", k.warn ? "text-rose-500" : "text-muted-foreground/70")} />
            </div>
            <p className={cn("text-[20px] sm:text-[22px] font-bold tracking-[-0.02em] tabular-nums leading-none truncate", k.warn ? "text-rose-600 dark:text-rose-400" : "text-foreground")}>
              {k.value}
              {updatedKeys.has(k.label) && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-primary animate-ping align-middle" />}
            </p>
            <p className="text-[11.5px] text-muted-foreground truncate">{k.hint}</p>
          </div>
        ))}
      </div>

      {/* Chart + today */}
      <div className="grid gap-4 lg:grid-cols-12">
        <section className={cn(card, "lg:col-span-8 p-4 sm:p-5")}>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">Sales by customer type</h2>
              <p className="text-xs text-muted-foreground">
                {ced(dailySales.reduce((s, d) => s + (d.Customers || 0) + (d.Agents || 0) + (d["Sub-Agents"] || 0), 0))} · {rangeLabel}
              </p>
            </div>
            <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />Customers</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />Agents</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-500" />Sub-agents</span>
            </div>
          </div>
          <div className="mt-4 h-[260px] -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailySales} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
                <CartesianGrid strokeDasharray="3 4" stroke={gridColor} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} tickMargin={8} />
                <YAxis tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => (v >= 1000 ? `₵${(v / 1000).toFixed(1)}k` : `₵${v}`)} />
                <Tooltip cursor={{ fill: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }} content={(props: any) => <DailySalesTooltip {...props} isDark={isDark} />} />
                <Bar dataKey="Customers" stackId="seg" fill="#0ea5e9" />
                <Bar dataKey="Agents" stackId="seg" fill="#f59e0b" />
                <Bar dataKey="Sub-Agents" stackId="seg" fill="#8b5cf6" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className={cn(card, "lg:col-span-4 p-4 sm:p-5")}>
          <h2 className="text-[15px] font-semibold text-foreground">Today</h2>
          <p className="mt-2 text-[30px] font-bold tracking-[-0.03em] tabular-nums text-foreground leading-none">{ced(todaySales.total)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{(todaySales.gb || 0).toFixed(2)} GB · {todaySales.newUsers || stats.todaySignups || 0} new users</p>
          <dl className="mt-4 space-y-2.5 text-[13px]">
            {[
              { k: "Delivered", v: todaySales.successCount, dot: "bg-emerald-500" },
              { k: "In progress", v: todaySales.pendingCount, dot: "bg-sky-500" },
              { k: "Failed", v: todaySales.failedCount, dot: "bg-rose-500" },
            ].map((r) => (
              <div key={r.k} className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-muted-foreground"><span className={cn("h-2 w-2 rounded-full", r.dot)} />{r.k}</dt>
                <dd className="font-semibold tabular-nums text-foreground">{r.v}</dd>
              </div>
            ))}
          </dl>
          {successRate !== null && (
            <div className="mt-4">
              <div className="flex justify-between text-[12px] text-muted-foreground"><span>Delivery rate</span><span className="font-semibold text-foreground">{successRate}%</span></div>
              <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden dark:bg-white/[0.06]">
                <div className={cn("h-full rounded-full", successRate >= 90 ? "bg-emerald-500" : successRate >= 70 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${successRate}%` }} />
              </div>
            </div>
          )}
          <dl className="mt-4 pt-4 border-t border-border/60 grid grid-cols-3 gap-2 text-[12px]">
            <div><dt className="text-muted-foreground">Customers</dt><dd className="font-semibold tabular-nums">{ced(todaySales.customers)}</dd></div>
            <div><dt className="text-muted-foreground">Agents</dt><dd className="font-semibold tabular-nums">{ced(todaySales.agents)}</dd></div>
            <div><dt className="text-muted-foreground">Sub-agents</dt><dd className="font-semibold tabular-nums">{ced(todaySales.subAgents)}</dd></div>
          </dl>
        </section>
      </div>

      {/* Providers */}
      {providerBalancesList.length > 0 && (
        <section className={cn(card, "p-4 sm:p-5")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">Providers</h2>
              <p className="text-xs text-muted-foreground">{providerBalancesList.length} active · balances and health</p>
            </div>
            <button type="button" onClick={refreshProviders} disabled={syncingProviders} className="h-8 px-3 rounded-lg border border-border text-[12.5px] font-semibold text-foreground hover:bg-muted inline-flex items-center gap-1.5 disabled:opacity-60">
              <RefreshCw className={cn("h-3.5 w-3.5", syncingProviders && "animate-spin")} /> {syncingProviders ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {providerBalancesList.map((prov: any) => {
              const bal = Number(prov.balance ?? 0);
              const isSms = prov.unit === "SMS" || String(prov.handler_type || "").toLowerCase() === "mnotify";
              const degraded = Number(prov.consecutive_failures || 0) >= 3;
              const isExpress = String(prov.handler_type || "").toLowerCase() === "bundlezone";
              const low = !isSms && bal < 50;
              return (
                <div key={prov.id || prov.name} className={cn("rounded-xl border p-3", degraded ? "border-amber-500/40 bg-amber-500/[0.06]" : "border-border/70 dark:border-white/[0.07]")}>
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[12.5px] font-semibold truncate text-foreground">{prov.name}</span>
                    <span className={cn("h-2 w-2 rounded-full shrink-0", degraded ? "bg-amber-500 animate-pulse" : "bg-emerald-500")} title={degraded ? `${prov.consecutive_failures} failures in a row` : "Healthy"} />
                  </div>
                  <p className={cn("mt-1.5 text-[16px] font-bold tabular-nums", low ? "text-rose-600 dark:text-rose-400" : "text-foreground")}>
                    {isSms ? `${bal.toLocaleString()} SMS` : ced(bal)}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">{isExpress ? "MTN Express" : prov.is_default ? "Primary" : String(prov.handler_type || "API")}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Recent orders + tracker */}
      <div className="grid gap-4 lg:grid-cols-12">
        <section className={cn(card, "lg:col-span-8 p-2 sm:p-3")}>
          <div className="flex items-center justify-between px-2 pt-2">
            <h2 className="text-[15px] font-semibold text-foreground">Latest orders</h2>
            <button type="button" onClick={() => navigate("/admin/orders")} className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted">
              All orders <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          {recentOrders.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-border/60 dark:divide-white/[0.05]">
              {recentOrders.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-2 py-2.5">
                  <NetworkMark network={o.network} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-foreground truncate">
                      {o.package_size || "Order"} <span className="font-normal text-muted-foreground">· {o.customer_phone || "API"}</span>
                    </p>
                    <p className="text-[11.5px] text-muted-foreground">{new Date(o.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</p>
                  </div>
                  <StatusBadge status={o.status} className="hidden sm:inline-flex" />
                  <span className="text-[13.5px] font-semibold tabular-nums text-foreground w-20 text-right">{ced(o.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={cn(card, "lg:col-span-4 p-4 sm:p-5")}>
          <PhoneOrderTracker variant="embedded" title="Find an order" subtitle="Look up delivery status by phone number or reference." />
        </section>
      </div>

      {/* Money + controls */}
      <div className="grid gap-4 lg:grid-cols-12">
        <section className={cn(card, "lg:col-span-8 p-4 sm:p-5")}>
          <h2 className="text-[15px] font-semibold text-foreground">Money</h2>
          <p className="text-xs text-muted-foreground">Settled payments vs what’s owed to users · {rangeLabel}</p>
          <dl className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { k: "Settled inflow", v: stats.rangeVerifiedInflow, sub: "Confirmed by Paystack", c: "text-emerald-600 dark:text-emerald-400" },
              { k: "Wallet liability", v: stats.totalSystemBalance, sub: "Unspent user balances", c: "text-rose-600 dark:text-rose-400" },
              { k: "Sales volume", v: stats.rangePurchases, sub: "Bundles & services sold", c: "text-foreground" },
            ].map((m) => (
              <div key={m.k} className="rounded-xl bg-muted/50 p-3.5 dark:bg-white/[0.04]">
                <dt className="text-[12px] text-muted-foreground">{m.k}</dt>
                <dd className={cn("mt-1 text-[19px] font-bold tabular-nums", m.c)}>{ced(m.v)}</dd>
                <p className="text-[11px] text-muted-foreground">{m.sub}</p>
              </div>
            ))}
          </dl>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-[12.5px]">
            <div className="rounded-xl border border-border/70 p-3 dark:border-white/[0.07]">
              <dt className="text-muted-foreground">API volume (all time)</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-foreground">{ced(stats.apiVolume)}</dd>
            </div>
            <div className="rounded-xl border border-border/70 p-3 dark:border-white/[0.07]">
              <dt className="text-muted-foreground">Paystack volume (all time)</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-foreground">{ced(stats.paystackVolume)}</dd>
            </div>
          </dl>
        </section>

        <section className={cn(card, "lg:col-span-4 p-4 sm:p-5 space-y-4")}>
          <h2 className="text-[15px] font-semibold text-foreground">Platform controls</h2>

          <div className={cn("rounded-xl border p-3.5", maintenanceEnabled ? "border-violet-500/40 bg-violet-500/[0.06]" : "border-border/70 dark:border-white/[0.07]")}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-foreground flex items-center gap-1.5">
                  <Lock className="h-4 w-4 text-muted-foreground" /> Maintenance mode
                </p>
                <p className="text-[12px] text-muted-foreground">Pauses checkout for customers.</p>
              </div>
              <Switch
                checked={maintenanceEnabled}
                onCheckedChange={(v) => {
                  setMaintenanceEnabled(v);
                  setMaintenanceDirty(true);
                }}
                aria-label="Maintenance mode"
              />
            </div>
            {maintenanceDirty && (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2">
                <p className="text-[12px] text-amber-800 dark:text-amber-300">Not applied yet. Save to {maintenanceEnabled ? "turn it on" : "turn it off"}.</p>
                <button
                  type="button"
                  onClick={async () => {
                    await saveMaintenance();
                    setMaintenanceDirty(false);
                  }}
                  disabled={savingMaintenance}
                  className="h-8 px-3 rounded-lg bg-foreground text-background text-[12.5px] font-semibold disabled:opacity-60 shrink-0"
                >
                  {savingMaintenance ? "Saving…" : "Save"}
                </button>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border/70 p-3.5 dark:border-white/[0.07]">
            <p className="text-[13.5px] font-semibold text-foreground">Audit sync</p>
            <p className="text-[12px] text-muted-foreground">Re-check telecom order statuses with DataMart.</p>
            <button type="button" onClick={runAuditSync} disabled={auditSyncing} className="mt-3 h-9 w-full rounded-lg border border-border text-[13px] font-semibold text-foreground hover:bg-muted inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
              <RefreshCw className={cn("h-4 w-4", auditSyncing && "animate-spin")} /> {auditSyncing ? "Syncing…" : "Run audit sync"}
            </button>
          </div>
        </section>
      </div>

      {/* Admin activity */}
      {auditLogs.length > 0 && (
        <section className={cn(card, "p-4 sm:p-5")}>
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-foreground">Recent admin activity</h2>
            <button type="button" onClick={() => navigate("/admin/audit-logs")} className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted">
              Audit log <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="mt-3 space-y-2.5">
            {auditLogs.map((l: any) => (
              <li key={l.id} className="flex items-start gap-3 text-[13px]">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                <p className="flex-1 min-w-0">
                  <span className="font-semibold text-foreground">{l.profiles?.full_name || "System"}</span>{" "}
                  <span className="text-muted-foreground">{String(l.action || "").replace(/_/g, " ")}</span>
                </p>
                <span className="text-[11.5px] text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default AdminOverview;
