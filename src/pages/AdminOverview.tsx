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
  MessageCircle, Zap, AlertTriangle, Layers, Cpu, Server, Lock, Filter
} from "lucide-react";
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

  const fetchData = useCallback(async () => {
    const now = new Date();
    let startDate = new Date();
    if (timeRange === "7d") startDate.setDate(now.getDate() - 6);
    else if (timeRange === "30d") startDate.setDate(now.getDate() - 29);
    else if (timeRange === "1y") startDate.setFullYear(now.getFullYear() - 1);
    else startDate = new Date(2024, 0, 1);

    startDate.setHours(0, 0, 0, 0);
    const todayStr = now.toISOString().slice(0, 10);

    const DEPOSIT_TYPES = new Set(["wallet_topup", "agent_activation", "sub_agent_activation"]);
    const SALE_TYPES    = new Set(["data", "airtime", "utility", "afa", "api"]);

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token || "";

    const settled = await Promise.allSettled([
      supabase.from("orders").select("id, amount, status, order_type, profit, parent_profit, cost_price, paystack_fee, paystack_verified_amount, package_size"),
      supabase.from("profiles").select("user_id, is_agent, is_sub_agent, agent_approved, sub_agent_approved, onboarding_complete, created_at"),
      supabase.functions.invoke("maintenance-mode", { body: { action: "get" } }),
      supabase.from("orders").select("id, network, package_size, customer_phone, amount, status, created_at").order("created_at", { ascending: false }).limit(8),
      supabase.from("orders").select("id, amount, agent_id, created_at, status, order_type, paystack_verified_amount, paystack_fee, profit, parent_profit, cost_price, package_size").gte("created_at", startDate.toISOString()).order("created_at", { ascending: false }).limit(4000),
      supabase.functions.invoke("system-payout-v1", {
        body: { action: "get_provider_balance" },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      }).catch(e => ({ data: { success: false, error: e.message }, error: e })),
      supabase.from("withdrawals").select("id, status", { count: "exact" }).in("status", ["pending", "processing"]),
      supabase.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("orders").select("id, order_type, amount, status, created_at, network, package_size, customer_phone").eq("status", "fulfilled").order("created_at", { ascending: false }).limit(15),
      supabase.from("audit_logs").select("id, action, details, created_at, profiles(full_name)").order("created_at", { ascending: false }).limit(6),
      supabase.from("wallets").select("balance"),
      supabase.from("user_sales_stats").select("total_sales_volume, total_own_profit, total_commissions_paid"),
      (supabase.rpc as any)("get_admin_sales_stats_v2", { p_start_date: startDate.toISOString() }),
      supabase.from("ai_recommendations").select("*").is("user_id", null).eq("is_acted_upon", false).order("created_at", { ascending: false }),
    ]);

    const unwrap = (r: PromiseSettledResult<any>) => r.status === "fulfilled" ? r.value : { data: null, error: null };
    const [ordersRes, profilesRes, maintenanceRes, recentRes, rangeOrdersRes, providerRes, withdrawalsRes, ticketsRes, topupsRes, auditRes, walletsRes, salesStatsRes, rpcStatsRes, aiRes] = settled.map(unwrap);

    if (aiRes && aiRes.data) {
      setAiRecommendations(aiRes.data);
    }

    const orders = ordersRes?.data || [];
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
    const todayUsers = profiles.filter((p: any) => (p.created_at as string)?.slice(0, 10) === todayStr).length;

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
      newUsers: todayUsers,
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
      totalUsers: profiles.length,
      pendingAgents: profiles.filter((p: any) => p.is_agent && !p.agent_approved && p.onboarding_complete).length,
      swiftDataSubAgentShare: totalVolumeAllTime - totalAgentProfitsAllTime,
      totalAgentProfit: totalAgentProfitsAllTime,
      totalSubAgentProfit: totalSubAgentProfitsAllTime,
      pendingWithdrawals: pendingWithdrawalsCount + processingWithdrawalsCount,
      unreadTickets: ticketsRes.count || 0,
      totalSystemBalance,
      todaySignups: todayOrders.filter((p: any) => (p.created_at as string)?.slice(0, 10) === todayStr).length,
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
      setProviderBalance(providerRes.data.balance);
      setProviderDiagnostics(providerRes.data.diagnostics);
    } else if (providerRes.data?.diagnostics) {
      setProviderDiagnostics(providerRes.data.diagnostics);
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
        supabase.from("orders").select("id, amount, agent_id, status, order_type, paystack_verified_amount, created_at, package_size").gte("created_at", `${todayStr}T00:00:00`),
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

    const ordersChannel = supabase
      .channel("admin-live-orders")
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
      .channel("admin-live-profiles")
      .on("postgres_changes", { event: "*", table: "profiles", schema: "public" }, () => {
        safeFetchData();
        setUpdatedKeys(new Set(["Pending Agents", "Active Users"]));
        setTimeout(() => setUpdatedKeys(new Set()), 1500);
      })
      .subscribe();

    const interval = setInterval(safeFetchData, 60_000);

    return () => {
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(profilesChannel);
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

  const statCards = [
    { title: "Net Admin Profit", value: `GH₵ ${(stats.totalNetAdminProfit || 0).toFixed(2)}`, icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", description: "Verified net profit after costs & fees" },
    { title: "Total Inflow", value: `GH₵ ${(stats.totalRevenue || 0).toFixed(2)}`, icon: DollarSign, color: "text-sky-400", bg: "bg-sky-500/10 border-sky-500/30" },
    { title: "Total Data Sold", value: `${(stats.totalGb || 0).toFixed(2)} GB`, icon: Package, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/30" },
    { title: "Agent Profits", value: `GH₵ ${(Number(stats.totalAgentProfit || 0) + Number(stats.totalSubAgentProfit || 0)).toFixed(2)}`, icon: DollarSign, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
    { title: "Provider Wallet", value: providerBalance !== null ? `GH₵ ${providerBalance.toFixed(2)}` : "...", icon: Server, color: providerBalance !== null && providerBalance < 50 ? "text-rose-400" : "text-cyan-400", bg: providerBalance !== null && providerBalance < 50 ? "bg-rose-500/10 border-rose-500/30" : "bg-cyan-500/10 border-cyan-500/30" },
    { title: "User Balances", value: `GH₵ ${(stats.totalSystemBalance || 0).toFixed(2)}`, icon: Wallet, color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/30" },
    { title: "Active Users", value: stats.totalUsers.toLocaleString(), icon: Users, color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/30" },
    { title: "Pending Agents", value: stats.pendingAgents, icon: ShieldCheck, color: stats.pendingAgents > 0 ? "text-rose-400" : "text-emerald-400", bg: stats.pendingAgents > 0 ? "bg-rose-500/10 border-rose-500/30" : "bg-emerald-500/10 border-emerald-500/30" },
  ];

  const axisColor = isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-2 border-amber-500/20 border-t-amber-500 animate-spin" />
          <Cpu className="w-5 h-5 text-amber-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
        </div>
        <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest animate-pulse">Initializing Admin Command Center...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      {/* ── LIVE MARQUEE TICKER ── */}
      <div className="relative flex items-center h-10 overflow-hidden rounded-2xl border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 backdrop-blur-xl shadow-inner">
        <div className="absolute left-0 z-10 h-full flex items-center px-4 rounded-l-2xl bg-emerald-500/10 border-r border-emerald-500/30 backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.8)] mr-2" />
          <span className="text-[10px] font-black uppercase tracking-widest font-mono">Live Feed</span>
        </div>
        
        <div className="flex whitespace-nowrap pl-36 animate-[marquee_30s_linear_infinite] items-center text-xs font-bold font-mono tracking-tight gap-8">
          <style>{`@keyframes marquee { 0% { transform: translateX(100%); } 100% { transform: translateX(-100%); } }`}</style>
          {recentOrders.slice(0, 6).map((o, i) => (
            <div key={`${o.id}-${i}`} className="flex items-center gap-2">
              <span className="text-muted-foreground text-[11px]">{new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span className="text-emerald-400 font-extrabold">[GH₵ {Number(o.amount).toFixed(2)}]</span>
              <span className="text-foreground font-semibold">{o.network ? `${o.network} ${o.package_size}` : "Order"}</span>
              <span className="text-muted-foreground">via {o.customer_phone || "API"}</span>
            </div>
          ))}
          {recentOrders.length === 0 && <span>Waiting for live order stream...</span>}
        </div>
      </div>

      {/* ── COMMAND CENTER HEADER ── */}
      <div className="glass-card-neo p-5 sm:p-6 rounded-3xl border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-amber-400" /> Admin Command Center
            </span>
            {lastUpdated && (
              <span className="text-[10px] font-mono text-muted-foreground">
                Sync: {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">System Overview & Analytics</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Time Range Selector */}
          <div className="flex p-1 rounded-xl border border-border bg-background/80">
            {(["7d", "30d", "1y", "all"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wider uppercase transition-all ${
                  timeRange === r
                    ? "bg-amber-500 text-slate-950 shadow-md font-mono"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>

          <Button
            onClick={safeFetchData}
            variant="outline"
            className="h-9 px-4 rounded-xl border-border bg-background/80 font-extrabold text-xs uppercase tracking-wider gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5 text-amber-400" /> Sync
          </Button>
        </div>
      </div>

      {/* ── AI CRITICAL ALERTS BANNER ── */}
      {aiRecommendations.length > 0 && (
        <div className="space-y-3">
          {aiRecommendations.map((rec) => (
            <div key={rec.id} className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 backdrop-blur-md flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center shrink-0 border border-rose-500/40">
                  <AlertTriangle className="w-5 h-5 text-rose-400" />
                </div>
                <div>
                  <h3 className="font-black text-rose-400 text-sm">{rec.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{rec.message}</p>
                </div>
              </div>
              <Button 
                onClick={async () => {
                  await (supabase.from("ai_recommendations") as any).update({ is_acted_upon: true }).eq("id", rec.id);
                  setAiRecommendations(prev => prev.filter(r => r.id !== rec.id));
                }}
                variant="destructive"
                size="sm"
                className="rounded-xl font-bold shrink-0"
              >
                Dismiss
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* ── PRIMARY KPI CARDS GRID ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCards.map((c) => {
          const isFlashing = updatedKeys.has(c.title);
          return (
            <CardTilt key={c.title} className="rounded-2xl w-full">
              <div className={cn("glass-card-neo p-4 rounded-2xl border flex flex-col justify-between gap-3 h-full relative overflow-hidden", c.bg)}>
                <div className="flex items-center justify-between z-10">
                  <div className="w-8 h-8 rounded-xl bg-background/50 border border-white/10 flex items-center justify-center">
                    <c.icon className={cn("w-4 h-4", c.color)} />
                  </div>
                  <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase">{c.title}</span>
                </div>
                
                <div className="z-10">
                  <div className="flex items-baseline gap-1.5">
                    <p className={cn("text-xl sm:text-2xl font-black font-mono tracking-tight", c.color)}>{c.value}</p>
                    {isFlashing && <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />}
                  </div>
                  {c.description && (
                    <p className="text-[10px] text-muted-foreground font-medium mt-1">{c.description}</p>
                  )}
                </div>
              </div>
            </CardTilt>
          );
        })}
      </div>

      {/* ── GLOBAL CONTROL HUB & MAINTENANCE ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Actions Card */}
        <div className="md:col-span-2 glass-card-neo p-6 rounded-3xl border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400 fill-current" />
              <h2 className="text-lg font-black text-foreground">Global Administrative Actions</h2>
            </div>
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px] font-mono uppercase">System Controls</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Execute global platform syncs, batch audit order statuses, and approve onboarding reseller agents.
          </p>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button
              onClick={async () => {
                toast({ title: "Global Audit Sync Started", description: "Syncing telecom orders with Datamart..." });
                try {
                  await supabase.functions.invoke("datamart-sync");
                  toast({ title: "Sync Complete", description: "Orders successfully audited." });
                  safeFetchData();
                } catch (e) {
                  toast({ title: "Sync Failed", variant: "destructive" });
                }
              }}
              className="h-11 px-5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-black text-xs shadow-md gap-2"
            >
              <RefreshCw className="w-4 h-4" /> Global Audit Sync
            </Button>

            <Button
              onClick={approveAllPending}
              disabled={approvingPending || stats.pendingAgents === 0}
              className="h-11 px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow-md gap-2"
            >
              <ShieldCheck className="w-4 h-4" /> Approve {stats.pendingAgents} Pending Agents
            </Button>
          </div>
        </div>

        {/* Safe Mode / Maintenance */}
        <div className="glass-card-neo p-6 rounded-3xl border border-white/10 space-y-3 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-rose-400" />
              <span className="text-xs font-black uppercase text-foreground">Maintenance Mode</span>
            </div>
            <Switch
              checked={maintenanceEnabled}
              onCheckedChange={setMaintenanceEnabled}
            />
          </div>
          
          <p className="text-xs text-muted-foreground">
            Instantly restrict checkout paths during carrier upgrades.
          </p>

          <Button
            onClick={saveMaintenance}
            disabled={savingMaintenance}
            variant="outline"
            size="sm"
            className="w-full rounded-xl font-bold border-dashed text-xs"
          >
            {savingMaintenance ? "Saving Config..." : "Save Maintenance Config"}
          </Button>
        </div>
      </div>

      {/* ── FINANCIAL RECONCILIATION & LIQUIDITY ── */}
      <div className="glass-card-neo p-6 rounded-3xl border border-white/10 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-foreground">Financial Reconciliation & Liquidity</h2>
            <p className="text-xs text-muted-foreground">Audited settlement amounts vs platform wallet liabilities.</p>
          </div>
          <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] font-mono uppercase w-fit">
            Range: {timeRange.toUpperCase()}
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400">Settled Inflow</p>
            <p className="text-xl sm:text-2xl font-black font-mono text-emerald-400 mt-1">GH₵ {(stats.rangeVerifiedInflow || 0).toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Paystack confirmed settlements</p>
          </div>

          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-rose-400">Wallet Liability</p>
            <p className="text-xl sm:text-2xl font-black font-mono text-rose-400 mt-1">GH₵ {(stats.totalSystemBalance || 0).toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Unspent balance in user wallets</p>
          </div>

          <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/20">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-sky-400">Consumed Volume</p>
            <p className="text-xl sm:text-2xl font-black font-mono text-sky-400 mt-1">GH₵ {(stats.rangePurchases || 0).toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Gross bundle & service sales</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <div className="p-4 rounded-2xl bg-background/50 border border-border">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">API Volume (All-time)</p>
            <p className="text-lg font-black font-mono text-foreground mt-0.5">GH₵ {(stats.apiVolume || 0).toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Developer API orders (no Paystack fee)</p>
          </div>

          <div className="p-4 rounded-2xl bg-background/50 border border-border">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">Paystack Volume (All-time)</p>
            <p className="text-lg font-black font-mono text-foreground mt-0.5">GH₵ {(stats.paystackVolume || 0).toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Direct Paystack verified settlements</p>
          </div>
        </div>
      </div>

      {/* ── PROVIDER HEALTH & DIAGNOSTICS ── */}
      {providerDiagnostics && (
        <div className="glass-card-neo p-5 rounded-3xl border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-sm text-foreground">Datamart Carrier Bridge Health</h3>
                <span className={cn("w-2 h-2 rounded-full animate-pulse", providerBalance !== null && providerBalance < 50 ? "bg-rose-500" : "bg-emerald-500")} />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {(providerDiagnostics?.baseUrl || "").replace(/https?:\/\//, "")} · Balance:{" "}
                <span className={cn("font-bold font-mono", providerBalance !== null && providerBalance < 50 ? "text-rose-400" : "text-emerald-400")}>
                  {providerBalance !== null ? `GH₵ ${providerBalance.toFixed(2)}` : "..."}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {providerBalance !== null && providerBalance < 50 && (
              <a
                href={providerDiagnostics?.baseUrl || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-950 text-xs font-black uppercase tracking-wider"
              >
                Top Up Provider
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── SALES ANALYTICS CHART ── */}
      {(() => {
        const periodCustomers  = dailySales.reduce((s, d) => s + (d.Customers  || 0), 0);
        const periodAgents     = dailySales.reduce((s, d) => s + (d.Agents     || 0), 0);
        const periodSubAgents  = dailySales.reduce((s, d) => s + (d["Sub-Agents"] || 0), 0);
        const periodTotal      = periodCustomers + periodAgents + periodSubAgents;
        const todayTotal       = todaySales.total;
        const todayAttempted   = todaySales.successCount + todaySales.failedCount;
        const successRate      = todayAttempted > 0 ? Math.round((todaySales.successCount / todayAttempted) * 100) : 100;

        return (
          <div className="glass-card-neo p-6 rounded-3xl border border-white/10 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-foreground">Network Sales Analytics</h2>
                <p className="text-xs text-muted-foreground">Daily sales breakdown across Customers, Agents & Sub-agents.</p>
              </div>

              <div className="flex items-center gap-4 flex-wrap text-xs">
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-sky-500" /><span className="font-bold text-muted-foreground">Customers</span></div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-amber-500" /><span className="font-bold text-muted-foreground">Agents</span></div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-purple-500" /><span className="font-bold text-muted-foreground">Sub-Agents</span></div>
              </div>
            </div>

            {/* Recharts Bar Chart */}
            <div className="h-[300px] w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailySales} margin={{ top: 10, right: 10, left: -10, bottom: 0 }} barCategoryGap="25%">
                  <defs>
                    <linearGradient id="colorCust" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={1}/>
                      <stop offset="95%" stopColor="#0284c7" stopOpacity={0.8}/>
                    </linearGradient>
                    <linearGradient id="colorAgent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={1}/>
                      <stop offset="95%" stopColor="#d97706" stopOpacity={0.8}/>
                    </linearGradient>
                    <linearGradient id="colorSub" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={1}/>
                      <stop offset="95%" stopColor="#7e22ce" stopOpacity={0.8}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: axisColor, fontSize: 10, fontWeight: "bold" }} axisLine={false} tickLine={false} dy={10} />
                  <YAxis tick={{ fill: axisColor, fontSize: 10, fontWeight: "bold" }} axisLine={false} tickLine={false} dx={-10} tickFormatter={(val) => `₵${val}`} />
                  <Tooltip cursor={{ fill: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" }} content={(props: any) => <DailySalesTooltip {...props} isDark={isDark} />} />
                  <Bar dataKey="Customers" stackId="seg" fill="url(#colorCust)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Agents" stackId="seg" fill="url(#colorAgent)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Sub-Agents" stackId="seg" fill="url(#colorSub)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* ── RECENT TRANSACTIONS & ORDER TRACKER ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-card-neo p-6 rounded-3xl border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-black text-base text-foreground">Recent Network Orders</h3>
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/orders")} className="text-xs font-bold text-amber-400">
              View All <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>

          <div className="space-y-2">
            {recentOrders.map((o) => (
              <div key={o.id} className="p-3 rounded-2xl border border-border bg-background/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {statusIcon(o.status)}
                  <div>
                    <p className="text-xs font-black text-foreground">
                      {o.network && o.package_size ? `${o.network} ${o.package_size}` : "Order"}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {o.customer_phone || "API"} · {new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-3">
                  <span className="text-sm font-black font-mono text-amber-400">GH₵ {Number(o.amount).toFixed(2)}</span>
                  <Badge variant="outline" className="text-[9px] uppercase font-black">
                    {o.status.replace("_", " ")}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card-neo p-6 rounded-3xl border border-white/10">
          <PhoneOrderTracker
            title="Manual Order Tracker"
            subtitle="Lookup status using customer phone number."
          />
        </div>
      </div>

      {/* ── QUICK TOOLS SHORTCUTS GRID ── */}
      <div className="space-y-3">
        <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Admin Quick Shortcuts</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Agents", icon: Users, path: "/admin/agents", color: "text-blue-400", bg: "bg-blue-500/10" },
            { label: "Orders", icon: ShoppingCart, path: "/admin/orders", color: "text-emerald-400", bg: "bg-emerald-500/10" },
            { label: "Packages", icon: Package, path: "/admin/packages", color: "text-purple-400", bg: "bg-purple-500/10" },
            { label: "Withdrawals", icon: Wallet, path: "/admin/withdrawals", color: "text-amber-400", bg: "bg-amber-500/10" },
          ].map((a) => (
            <button
              key={a.label}
              onClick={() => navigate(a.path)}
              className="glass-card-neo p-4 rounded-2xl border border-white/10 hover:border-amber-500/40 flex flex-col items-center justify-center gap-2 transition-all group"
            >
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border border-white/10", a.bg)}>
                <a.icon className={cn("w-5 h-5", a.color)} />
              </div>
              <span className="text-xs font-black text-foreground group-hover:text-amber-400">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdminOverview;
