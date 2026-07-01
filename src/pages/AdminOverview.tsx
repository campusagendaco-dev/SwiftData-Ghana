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
  MessageCircle,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";
import { CardTilt } from "@/components/ui/CardTilt";

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
    <div className={`rounded-[20px] p-4 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] text-sm border backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-200 ${isDark ? "bg-[#111116]/90 border-white/10" : "bg-white/90 border-gray-200"}`}>
      <p className={`mb-3 font-black tracking-tight text-xs uppercase ${isDark ? "text-white/50" : "text-gray-500"}`}>{label}</p>
      <div className="space-y-2">
        {payload.map((p: any, i: number) => (
          <div key={i} className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color, boxShadow: `0 0 10px ${p.color}` }} />
              <span className={`font-semibold text-[11px] uppercase tracking-widest ${isDark ? "text-white/70" : "text-gray-600"}`}>{p.name}</span>
            </div>
            <span style={{ color: p.color }} className="font-black">GH₵{Number(p.value).toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className={`mt-3 pt-3 border-t flex items-center justify-between gap-4 ${isDark ? "border-white/10" : "border-gray-200"}`}>
        <span className={`text-[10px] font-black uppercase tracking-widest ${isDark ? "text-white/40" : "text-gray-400"}`}>Total Vol</span>
        <span className={`font-black text-lg ${isDark ? "text-white" : "text-gray-900"}`}>GH₵{total.toFixed(2)}</span>
      </div>
      <div className="flex justify-between items-center mt-2 gap-4">
        <span className="text-[10px] font-bold text-blue-400">{payload[0]?.payload?.GB?.toFixed(2) || "0.00"} GB Sold</span>
        <span className="text-[10px] font-bold text-purple-400">{payload[0]?.payload?.Orders || 0} Orders</span>
      </div>
      {payload[0]?.payload?.Deposits > 0 && (
        <p className="text-[10px] text-amber-500 mt-1 font-bold text-right">
          + GH₵{payload[0].payload.Deposits.toFixed(2)} Deposits
        </p>
      )}
    </div>
  );
};

const statusIcon = (s: string) => {
  if (s === "fulfilled")
    return <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center border border-green-500/20"><CheckCircle2 className="w-4 h-4 text-green-500" /></div>;
  if (s === "fulfillment_failed")
    return <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20"><XCircle className="w-4 h-4 text-red-500" /></div>;
  return <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20"><Clock className="w-4 h-4 text-amber-500" /></div>;
};

const parseCapacity = (sizeStr: string | null) => {
  if (!sizeStr) return 0;
  const s = sizeStr.toUpperCase().replace(/\s+/g, "");
  const match = s.match(/([0-9.]+)(MB|GB|TB)/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  if (match[2] === "MB") return val / 1024;
  if (match[2] === "TB") return val * 1024;
  return val; // GB
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

    const settled = await Promise.allSettled([
      supabase.from("orders").select("id, amount, status, order_type, profit, parent_profit, cost_price, paystack_fee, paystack_verified_amount, package_size"),
      supabase.from("profiles").select("user_id, is_agent, is_sub_agent, agent_approved, sub_agent_approved, onboarding_complete, created_at"),
      supabase.functions.invoke("maintenance-mode", { body: { action: "get" } }),
      supabase.from("orders").select("id, network, package_size, customer_phone, amount, status, created_at").order("created_at", { ascending: false }).limit(8),
      supabase.from("orders").select("id, amount, agent_id, created_at, status, order_type, paystack_verified_amount, paystack_fee, profit, parent_profit, cost_price, package_size").gte("created_at", startDate.toISOString()).order("created_at", { ascending: false }).limit(4000),
      supabase.functions.invoke("system-payout-v1", { body: { action: "get_provider_balance" } }).catch(e => ({ data: { success: false, error: e.message }, error: e })),
      supabase.from("withdrawals").select("id, status", { count: "exact" }).in("status", ["pending", "processing"]),
      supabase.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("orders").select("id, order_type, amount, status, created_at, network, package_size, customer_phone").eq("status", "fulfilled").order("created_at", { ascending: false }).limit(15),
      supabase.from("audit_logs").select("id, action, details, created_at, profiles(full_name)").order("created_at", { ascending: false }).limit(6),
      supabase.from("wallets").select("balance"),
      supabase.from("user_sales_stats").select("total_sales_volume, total_own_profit, total_commissions_paid"),
      supabase.rpc("get_admin_sales_stats_v2", { p_start_date: startDate.toISOString() }),
      supabase.from("ai_recommendations").select("*").is("user_id", null).eq("is_acted_upon", false).order("created_at", { ascending: false }),
    ]);

    // Safely unwrap allSettled results — failed queries default to empty/null
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
    
    // Calculate Net Admin Profit for fulfilled orders.
    // API orders: amount - profit - parent_profit - cost_price (no Paystack fee).
    // Paystack orders: paystack_verified_amount - paystack_fee - profit - parent_profit - cost_price.
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

      // wallet_topup: admin earns the Paystack spread (verified - fee - amount credited to wallet)
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
    const isMonthly = timeRange === "1y" || timeRange === "all";

    const agentIds = new Set(profiles.filter((p: any) => p?.is_agent && p?.agent_approved).map((p: any) => p?.user_id));
    const subAgentIds = new Set(profiles.filter((p: any) => p?.is_sub_agent && p?.sub_agent_approved).map((p: any) => p?.user_id));

    const rpcStats = (rpcStatsRes as any)?.data;
    let dailySalesData: DailySalesPoint[] = [];

    if (rpcStats && Array.isArray(rpcStats)) {
      // Build a full date range with zeros first so every day is represented
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
      // Overlay RPC data — use string slice to avoid timezone shifts
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
      // Fallback to browser-side aggregation if RPC is missing/failed
      console.warn("Sales stats RPC failed or not found, falling back to local calculation.");
      const chartMap: Record<string, DailySalesPoint> = {};
      const daysCount = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90; // Limit fallback range
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

    // Inflow: always use paystack_verified_amount (confirmed settlement)
    const totalRevenue = inflowOrders.reduce((s: number, o: any) => s + (Number(o.paystack_verified_amount) || Number(o.amount) || 0), 0);

    // Purchases: API orders use amount (no Paystack), Paystack orders use verified amount
    const totalPurchases = purchaseOrders.reduce((s: number, o: any) => {
      if (o.order_type === "api") return s + (Number(o.amount) || 0);
      return s + (Number(o.paystack_verified_amount) || Number(o.amount) || 0);
    }, 0);

    // Separate API vs Paystack volumes for reconciliation accuracy
    const apiVolume = purchaseOrders.filter((o: any) => o.order_type === "api").reduce((s: number, o: any) => s + (Number(o.amount) || 0), 0);
    const paystackVolume = purchaseOrders.filter((o: any) => o.order_type !== "api").reduce((s: number, o: any) => s + (Number(o.paystack_verified_amount) || Number(o.amount) || 0), 0);

    const displayRevenue = totalRevenue;

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
    // Range purchases: API orders use amount, Paystack orders use verified amount
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
      totalRevenue: displayRevenue,
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

  // Wrap fetchData in a stable function that always clears loading and never crashes the page
  const safeFetchData = useCallback(async () => {
    try {
      await fetchData();
    } catch (err) {
      console.error("[AdminOverview] fetchData error:", err);
    } finally {
      setLoading(false);
    }
  }, [fetchData]);

  // Lightweight chart-only refresh — only re-runs the RPC + recent orders.
  // Used for realtime triggers so the chart updates instantly without re-running all 13 queries.
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
        supabase.rpc("get_admin_sales_stats_v2", { p_start_date: startDate.toISOString() }),
        supabase.from("orders").select("id, network, package_size, customer_phone, amount, status, created_at").order("created_at", { ascending: false }).limit(8),
        supabase.from("orders").select("id, amount, agent_id, status, order_type, paystack_verified_amount, created_at, package_size").gte("created_at", `${todayStr}T00:00:00`),
      ]);

      const rpcStats = rpcRes.data;
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
        refreshChart(); // Fast: only updates chart + recent orders + today's stats
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
    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "approve_all_pending_agents" },
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
    { title: "Total Inflow",     value: `GH₵ ${(stats.totalRevenue || 0).toFixed(2)}`,                                icon: DollarSign, color: "text-emerald-500",  bg: "bg-emerald-500/10",  border: "border-emerald-500/20"  },
    { title: "Total Data Sold",   value: `${(stats.totalGb || 0).toFixed(2)} GB`,                                icon: Package, color: "text-blue-500",  bg: "bg-blue-500/10",  border: "border-blue-500/20"  },
    { title: "Agent Profits",   value: `GH₵ ${(Number(stats.totalAgentProfit || 0) + Number(stats.totalSubAgentProfit || 0)).toFixed(2)}`, icon: DollarSign, color: "text-amber-500",  bg: "bg-amber-400/10",  border: "border-amber-400/20"  },
    { title: "User Balances",   value: `GH₵ ${(stats.totalSystemBalance || 0).toFixed(2)}`,                        icon: Wallet,     color: "text-red-400",    bg: "bg-red-400/10",    border: "border-red-400/20"    },
    { 
      title: "Net Admin Profit", 
      value: `GH₵ ${(stats.totalNetAdminProfit || 0).toFixed(2)}`, 
      icon: TrendingUp, 
      color: "text-emerald-500", 
      bg: "bg-emerald-500/10",
      description: "Lifetime net profit after all costs."
    },
    { title: "Active Users",    value: stats.totalUsers.toLocaleString(),                                      icon: Users,      color: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" },
    {
      title: "Pending Agents",
      value: stats.pendingAgents,
      icon: ShieldCheck,
      color: stats.pendingAgents > 0 ? "text-red-500" : "text-emerald-500",
      bg:    stats.pendingAgents > 0 ? "bg-red-500/10"     : "bg-emerald-500/10",
      border:stats.pendingAgents > 0 ? "border-red-500/20" : "border-emerald-500/20",
    },
    {
      title: "Provider Wallet",
      value: providerBalance !== null ? `GH₵ ${providerBalance.toFixed(2)}` : "...",
      icon: Wallet,
      color: "text-sky-500",
      bg: "bg-sky-500/10",
      border: "border-sky-500/20"
    },
    { title: "Today's Data Sold", value: `${(todaySales.gb || 0).toFixed(2)} GB`, icon: Package, color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
    { title: "Today's Orders", value: todaySales.count, icon: ShoppingCart, color: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" },
    { title: "Today's Success", value: todaySales.successCount, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    { title: "Today's Failed",  value: todaySales.failedCount,  icon: XCircle,      color: "text-red-500",     bg: "bg-red-500/10",     border: "border-red-500/20"     },
    { title: "Today's New Users", value: todaySales.newUsers,     icon: Users,        color: "text-indigo-500",  bg: "bg-indigo-500/10",  border: "border-indigo-500/20"  },
    { title: "Pending Withdrawals", value: stats.pendingWithdrawals, icon: Wallet,   color: stats.pendingWithdrawals > 0 ? "text-red-500" : "text-emerald-500", bg: stats.pendingWithdrawals > 0 ? "bg-red-500/10" : "bg-emerald-500/10", border: stats.pendingWithdrawals > 0 ? "border-red-500/20" : "border-emerald-500/20" },
    { title: "Open Tickets",      value: stats.unreadTickets,      icon: MessageCircle, color: stats.unreadTickets > 0 ? "text-amber-500" : "text-emerald-500", bg: stats.unreadTickets > 0 ? "bg-amber-500/10" : "bg-emerald-500/10", border: stats.unreadTickets > 0 ? "border-amber-500/20" : "border-emerald-500/20" },
    { title: "Total Orders", value: stats.totalOrders.toLocaleString(), icon: ShoppingCart, color: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" },
  ];

  const axisColor  = isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)";
  const gridColor  = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
  const legendColor= isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)";

  const card  = isDark ? "bg-white/[0.02] border-white/5" : "bg-white border-gray-200 shadow-sm";
  const card2 = isDark ? "bg-white/[0.03] border-white/5" : "bg-gray-50 border-gray-200";
  const muted = isDark ? "text-white/40" : "text-gray-400";
  const head  = isDark ? "text-white"    : "text-gray-900";
  const sub   = isDark ? "text-white/50" : "text-gray-500";
  const divider = isDark ? "border-white/5" : "border-gray-200";

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
        <p className={`font-medium tracking-widest uppercase text-xs ${muted}`}>Loading Dashboard…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      
      {/* ── LIVE ACTIVITY TICKER ── */}
      <div className={`relative flex items-center h-10 overflow-hidden rounded-xl border backdrop-blur-xl shadow-inner ${isDark ? "bg-emerald-500/5 border-emerald-500/10 text-emerald-400" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
        <div className="absolute left-0 z-10 h-full flex items-center px-4 rounded-l-xl backdrop-blur-xl border-r" style={{ background: isDark ? "rgba(16,185,129,0.1)" : "rgba(16,185,129,0.05)", borderColor: isDark ? "rgba(16,185,129,0.2)" : "rgba(16,185,129,0.3)" }}>
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)] mr-2" />
          <span className="text-[10px] font-black uppercase tracking-widest">Live Ticker</span>
        </div>
        
        <div className="flex whitespace-nowrap pl-32 animate-[marquee_30s_linear_infinite] items-center text-xs font-bold font-mono tracking-tight gap-8">
          <style>{`@keyframes marquee { 0% { transform: translateX(100%); } 100% { transform: translateX(-100%); } }`}</style>
          {recentOrders.slice(0, 5).map((o, i) => (
            <div key={`${o.id}-${i}`} className="flex items-center gap-2">
              <span className={isDark ? "text-white/40" : "text-gray-400"}>{new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span className={isDark ? "text-emerald-400" : "text-emerald-600"}>[GH₵{Number(o.amount).toFixed(2)}]</span>
              <span className={isDark ? "text-white/80" : "text-gray-800"}>{o.network ? `${o.network} ${o.package_size}` : "Order"}</span>
              <span className={isDark ? "text-white/40" : "text-gray-400"}>via {o.customer_phone || "API"}</span>
            </div>
          ))}
          {recentOrders.length === 0 && <span>Waiting for new transactions...</span>}
        </div>
      </div>

      <div className={`flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4`}>
        <div>
          <h1 className={`text-4xl font-black tracking-tighter ${head}`}>Terminal Overview</h1>
          <div className="flex items-center gap-3 mt-1.5">
            <p className={`text-sm font-medium ${sub}`}>High-level platform metrics and financial reconciliation.</p>
          </div>
          {lastUpdated && (
            <p className={`text-[10px] mt-2 font-mono uppercase tracking-widest ${muted}`}>
              Last sync: {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          )}
        </div>
        <Button
          onClick={safeFetchData}
          className={`gap-2 rounded-xl border font-bold text-[11px] uppercase tracking-widest transition-all h-10 ${
            isDark ? "bg-white/5 hover:bg-white/10 text-white border-white/10" : "bg-white hover:bg-gray-50 text-gray-700 border-gray-200 shadow-sm"
          }`}
        >
          <RefreshCw className="w-3.5 h-3.5" /> Sync Data
        </Button>
      </div>

      {/* AI Critical Alerts Banner */}
      {aiRecommendations.length > 0 && (
        <div className="grid gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
          {aiRecommendations.map((rec) => (
            <div key={rec.id} className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 backdrop-blur-md relative overflow-hidden flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between shadow-[0_0_30px_-5px_rgba(239,68,68,0.15)]">
              <div className="absolute top-0 left-0 w-1 h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]"></div>
              <div className="flex items-start gap-4 z-10">
                <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center shrink-0 border border-red-500/30">
                  <Activity className="w-5 h-5 text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                </div>
                <div>
                  <h3 className="font-black text-red-500">{rec.title}</h3>
                  <p className="text-sm mt-1 text-gray-800 dark:text-gray-200 font-medium">
                    {rec.message}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto z-10">
                <button 
                  onClick={async () => {
                    await supabase.from("ai_recommendations").update({ is_acted_upon: true }).eq("id", rec.id);
                    setAiRecommendations(prev => prev.filter(r => r.id !== rec.id));
                  }}
                  className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-black text-sm flex-1 sm:flex-none text-center shadow-[0_0_15px_rgba(239,68,68,0.4)] transition-all active:scale-95"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {statCards.map((c) => {
          const isFlashing = updatedKeys.has(c.title);
          return (
            <CardTilt
              key={c.title}
              glowColor={c.color.includes("emerald") ? "142 70% 45%" : c.color.includes("blue") ? "217 91% 60%" : c.color.includes("amber") ? "48 96% 53%" : c.color.includes("red") ? "0 72% 51%" : c.color.includes("sky") ? "185 85% 45%" : c.color.includes("purple") ? "262 83% 58%" : "238 75% 70%"}
              className="rounded-[2rem] w-full"
            >
              <div
                className={`relative group p-6 rounded-[2rem] border overflow-hidden transition-all duration-500 hover:scale-[1.02] hover:shadow-2xl h-full ${
                  isDark ? "bg-white/[0.03] border-white/10 hover:bg-white/[0.05]" : "bg-white border-gray-100 shadow-xl shadow-black/[0.02]"
                }`}
              >
                {/* Animated Background Glow */}
                <div className={`absolute -top-12 -right-12 w-32 h-32 ${c.bg} blur-[60px] opacity-40 group-hover:scale-150 transition-transform duration-700 rounded-full`} />
                
                <div className="relative z-10 flex items-center justify-between mb-5">
                  <div className={`w-12 h-12 rounded-2xl ${c.bg} ${c.border} border-2 flex items-center justify-center shadow-lg`}>
                    <c.icon className={`w-6 h-6 ${c.color}`} />
                  </div>
                  <div className="text-right">
                    <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${muted}`}>{c.title}</p>
                  </div>
                </div>
                
                <div className="relative z-10 flex items-baseline gap-2">
                   <p className={`text-3xl font-black tracking-tighter ${head}`}>{c.value}</p>
                   {isFlashing && (
                     <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                   )}
                </div>
                
                {c.description && (
                  <p className={`relative z-10 text-[10px] mt-2 font-medium ${sub} italic`}>
                    {c.description}
                  </p>
                )}
              </div>
            </CardTilt>
          );
        })}
      </div>

      {/* --- Action Center --- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`lg:col-span-2 p-8 rounded-[2.5rem] border relative overflow-hidden ${
          isDark ? "bg-indigo-600/5 border-indigo-500/20" : "bg-indigo-50 border-indigo-100"
        }`}>
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[100px] rounded-full" />
          
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                 <div className="w-8 h-8 rounded-xl bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/40">
                    <Activity className="w-4 h-4 text-white" />
                 </div>
                 <h2 className={`text-2xl font-black tracking-tight ${head}`}>Global Management</h2>
              </div>
              <p className={`text-sm ${sub} max-w-md`}>
                One-click administrative tools to audit accounts, sync provider records, and approve waiting agents.
              </p>
            </div>
            
            <div className="flex flex-wrap gap-3">
              <Button 
                onClick={async () => {
                  toast({ title: "Global Sync Started", description: "Audit in progress..." });
                  try {
                    await supabase.functions.invoke("datamart-sync");
                    toast({ title: "Sync Complete", description: "All orders recovered and fulfilled." });
                    safeFetchData();
                  } catch (e) {
                    toast({ title: "Sync Failed", variant: "destructive" });
                  }
                }}
                className="h-12 px-6 rounded-2xl bg-amber-400 hover:bg-amber-300 text-black font-black uppercase tracking-widest text-[10px] shadow-lg shadow-amber-400/20 border-none group"
              >
                <RefreshCw className="w-4 h-4 mr-2 group-hover:rotate-180 transition-transform duration-700" />
                Global Audit Sync
              </Button>
              
              <Button 
                onClick={approveAllPending}
                disabled={approvingPending || stats.pendingAgents === 0}
                className="h-12 px-6 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white font-black uppercase tracking-widest text-[10px] shadow-lg shadow-emerald-500/20 border-none"
              >
                {approvingPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                Approve {stats.pendingAgents} Agents
              </Button>
            </div>
          </div>
        </div>

        <div className={`p-8 rounded-[2.5rem] border relative overflow-hidden ${
          isDark ? "bg-white/[0.02] border-white/5" : "bg-white border-gray-200"
        }`}>
           <div className="relative z-10 space-y-4">
              <div className="flex items-center justify-between">
                 <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${muted}`}>Maintenance</p>
                 <Switch 
                   checked={maintenanceEnabled} 
                   onCheckedChange={setMaintenanceEnabled}
                   className="data-[state=checked]:bg-red-500"
                 />
              </div>
              <h3 className={`text-lg font-black ${head}`}>Safe Mode</h3>
              <p className={`text-[11px] ${sub} leading-relaxed`}>
                Instantly disable all checkout paths. Use this during provider outages or upgrades.
              </p>
              <Button 
                onClick={saveMaintenance}
                disabled={savingMaintenance}
                variant="outline"
                className="w-full h-10 rounded-xl font-bold uppercase tracking-widest text-[10px] border-dashed border-2"
              >
                {savingMaintenance ? "Applying..." : "Save Config"}
              </Button>
           </div>
        </div>
      </div>

      <div className={`p-8 rounded-[3rem] border ${isDark ? "bg-[#0d0d12] border-amber-500/10 shadow-2xl" : "bg-amber-50/30 border-amber-100 shadow-sm"}`}>
        <div className="flex flex-col md:flex-row gap-8 items-start">
          <div className="w-16 h-16 rounded-[1.5rem] bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 shadow-lg">
            <DollarSign className="w-8 h-8 text-amber-500" />
          </div>
          <div className="space-y-6 flex-1">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className={`text-2xl font-black tracking-tight ${head}`}>Financial Reconciliation</h2>
                <p className={`text-sm mt-1 leading-relaxed ${sub}`}>
                  Real-time liquidity analysis and Paystack settlement auditing.
                </p>
              </div>
              <div className={`px-4 py-2 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-2`}>
                 <Clock className={`w-3 h-3 ${muted}`} />
                 <span className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>Range: {timeRange.toUpperCase()}</span>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className={`p-6 rounded-[2rem] border ${isDark ? "bg-black/40 border-white/5 shadow-inner" : "bg-white border-gray-100 shadow-sm"}`}>
                <p className={`text-[10px] uppercase font-black tracking-widest mb-2 text-emerald-500`}>Settled Inflow</p>
                <div className="flex items-baseline gap-1">
                   <p className={`text-2xl font-black ${head}`}>GH₵ {(stats.rangeVerifiedInflow || 0).toFixed(2)}</p>
                   <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                </div>
                <p className={`text-[10px] mt-2 font-medium ${muted}`}>Paystack confirmed settlements.</p>
              </div>
              
              <div className={`p-6 rounded-[2rem] border ${isDark ? "bg-black/40 border-white/5 shadow-inner" : "bg-white border-gray-100 shadow-sm"}`}>
                <p className={`text-[10px] uppercase font-black tracking-widest mb-2 text-red-400`}>Wallet Liability</p>
                <div className="flex items-baseline gap-1">
                   <p className={`text-2xl font-black ${head}`}>GH₵ {(stats.totalSystemBalance || 0).toFixed(2)}</p>
                   <Wallet className="w-4 h-4 text-red-400" />
                </div>
                <p className={`text-[10px] mt-2 font-medium ${muted}`}>Total unspent funds in user wallets.</p>
              </div>
              
              <div className={`p-6 rounded-[2rem] border ${isDark ? "bg-black/40 border-white/5 shadow-inner" : "bg-white border-gray-100 shadow-sm"}`}>
                <p className={`text-[10px] uppercase font-black tracking-widest mb-2 text-blue-400`}>Consumed Volume</p>
                <div className="flex items-baseline gap-1">
                   <p className={`text-2xl font-black ${head}`}>GH₵ {(stats.rangePurchases || 0).toFixed(2)}</p>
                   <ShoppingCart className="w-4 h-4 text-blue-400" />
                </div>
                <p className={`text-[10px] mt-2 font-medium ${muted}`}>Gross data and airtime consumption.</p>
              </div>
            </div>

            {/* API vs Paystack volume split */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className={`p-6 rounded-[2rem] border ${isDark ? "bg-black/40 border-white/5 shadow-inner" : "bg-white border-gray-100 shadow-sm"}`}>
                <p className="text-[10px] uppercase font-black tracking-widest mb-2 text-pink-400">API Volume (All-time)</p>
                <div className="flex items-baseline gap-1">
                  <p className={`text-2xl font-black ${head}`}>GH₵ {(stats.apiVolume || 0).toFixed(2)}</p>
                  <Activity className="w-4 h-4 text-pink-400" />
                </div>
                <p className={`text-[10px] mt-2 font-medium ${muted}`}>Developer API orders — no Paystack fee.</p>
              </div>
              <div className={`p-6 rounded-[2rem] border ${isDark ? "bg-black/40 border-white/5 shadow-inner" : "bg-white border-gray-100 shadow-sm"}`}>
                <p className="text-[10px] uppercase font-black tracking-widest mb-2 text-emerald-400">Paystack Volume (All-time)</p>
                <div className="flex items-baseline gap-1">
                  <p className={`text-2xl font-black ${head}`}>GH₵ {(stats.paystackVolume || 0).toFixed(2)}</p>
                  <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                </div>
                <p className={`text-[10px] mt-2 font-medium ${muted}`}>Direct Paystack sales — verified settlement amounts.</p>
              </div>
            </div>

            <div className={`text-[11px] p-5 rounded-2xl border flex items-start gap-4 ${isDark ? "bg-white/[0.03] border-white/10 text-white/50" : "bg-white border-amber-200 text-amber-900 shadow-sm"}`}>
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 mt-1">
                 <ShieldCheck className="w-5 h-5 text-amber-500" />
              </div>
              <p className="leading-relaxed">
                <strong className="text-amber-500 block mb-0.5">Admin Insight</strong>
                API volume uses the billed amount (no Paystack fee). Paystack volume uses the verified settlement amount.
                Net Admin Profit deducts Paystack fees only from Paystack orders, keeping API margins accurate.
              </p>
            </div>
          </div>
        </div>
      </div>

      {providerDiagnostics && (
        <div className={`relative group overflow-hidden rounded-3xl border transition-all duration-500 ${
          providerBalance !== null && providerBalance < 50 
            ? "bg-red-500/10 border-red-500/20 shadow-[0_8px_32px_rgba(239,68,68,0.1)]" 
            : "bg-white/[0.03] border-white/10"
        }`}>
          <div className={`absolute top-0 right-0 w-64 h-64 blur-[80px] -mr-32 -mt-32 rounded-full transition-all duration-700 ${
            providerBalance !== null && providerBalance < 50 ? "bg-red-500/15" : "bg-sky-500/10"
          }`} />

          <div className="relative z-10 p-5 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border shadow-inner transition-transform group-hover:scale-110 ${
                providerBalance !== null && providerBalance < 50 
                  ? "bg-red-500/20 border-red-500/30 text-red-500" 
                  : "bg-sky-500/10 border-sky-500/20 text-sky-500"
              }`}>
                <Activity className="w-7 h-7" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className={`font-black text-lg tracking-tight ${isDark ? "text-white" : "text-gray-900"}`}>Provider Health</h3>
                  <span className={`w-2 h-2 rounded-full animate-pulse ${providerBalance !== null && providerBalance < 50 ? "bg-red-500" : "bg-emerald-500"}`} />
                  {providerBalance !== null && providerBalance < 50 && (
                    <a
                      href={providerDiagnostics?.baseUrl || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 px-2 py-0.5 rounded-md bg-red-500 text-white text-[10px] font-black uppercase tracking-tighter hover:bg-red-600 transition-colors"
                    >
                      Top Up Now
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="outline" className={`text-[10px] font-black tracking-widest px-2 py-0.5 uppercase border ${
                    isDark ? "border-white/10 bg-white/5 text-white/40" : "border-gray-200 bg-gray-50 text-gray-400"
                  }`}>
                    {(providerDiagnostics?.baseUrl || "").replace(/https?:\/\//, "")}
                  </Badge>
                  {providerBalance !== null && (
                    <span className={`text-[10px] font-bold ${providerBalance < 50 ? "text-red-500" : "text-emerald-500"}`}>
                      {providerBalance < 50 ? "⚠️ Critical Balance" : "✓ Active"}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {[
                { label: "Data API",    value: providerDiagnostics.activeKey },
                { label: "Airtime API", value: providerDiagnostics.activeAirtimeKey },
              ].map(d => (
                <div key={d.label} className={`px-4 py-3 rounded-2xl border transition-all ${
                  isDark ? "bg-black/40 border-white/5 hover:border-white/10" : "bg-white border-gray-100 hover:border-gray-200"
                }`}>
                  <p className={`text-[9px] uppercase font-black tracking-widest mb-1 ${isDark ? "text-white/20" : "text-gray-400"}`}>{d.label}</p>
                  <p className={`text-xs font-mono font-bold ${isDark ? "text-white/70" : "text-gray-700"}`}>
                    {d.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── SALES ANALYTICS (rebuilt) ─────────────────────────────── */}
      {(() => {
        const periodCustomers  = dailySales.reduce((s, d) => s + (d.Customers  || 0), 0);
        const periodAgents     = dailySales.reduce((s, d) => s + (d.Agents     || 0), 0);
        const periodSubAgents  = dailySales.reduce((s, d) => s + (d["Sub-Agents"] || 0), 0);
        const periodTotal      = periodCustomers + periodAgents + periodSubAgents;
        const todayTotal       = todaySales.total;
        const todayAttempted   = todaySales.successCount + todaySales.failedCount;
        const successRate      = todayAttempted > 0 ? Math.round((todaySales.successCount / todayAttempted) * 100) : 100;
        const srColor          = successRate >= 90 ? "text-emerald-400" : successRate >= 70 ? "text-amber-400" : "text-red-400";
        const srBg             = isDark
          ? successRate >= 90 ? "bg-emerald-500/10 border-emerald-500/20" : successRate >= 70 ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20"
          : successRate >= 90 ? "bg-emerald-50 border-emerald-200" : successRate >= 70 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200";

        return (
          <div className="space-y-4">

            {/* ── Header + time filter ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border shrink-0 ${isDark ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50 border-amber-200"}`}>
                  <TrendingUp className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className={`font-black text-xl tracking-tight ${head}`}>Sales Analytics</h2>
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-black text-emerald-500 uppercase tracking-widest">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Live
                    </span>
                  </div>
                  <p className={`text-xs mt-0.5 ${muted}`}>Tracking fulfilled sales across your entire network.</p>
                </div>
              </div>

              <div className={`flex p-1 rounded-xl border ${isDark ? "bg-white/5 border-white/10" : "bg-gray-100 border-gray-200"}`}>
                {(["7d","30d","1y","all"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setTimeRange(r)}
                    className={`px-4 py-1.5 rounded-lg text-[10px] font-black tracking-widest transition-all ${
                      timeRange === r
                        ? isDark ? "bg-amber-400 text-black shadow-lg shadow-amber-400/20" : "bg-white text-gray-900 shadow-sm"
                        : isDark ? "text-white/40 hover:text-white/60" : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Period KPI strip ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                {
                  label: `${timeRange.toUpperCase()} Sales`,
                  value: `GH₵ ${periodTotal.toFixed(2)}`,
                  icon: DollarSign,
                  color: "text-emerald-400",
                  bg: isDark ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200",
                  sub: stats.totalRangePurchase > 0 ? `GH₵ ${stats.totalRangePurchase.toFixed(2)} in products` : "No purchases yet",
                },
                {
                  label: "Today's Revenue",
                  value: `GH₵ ${todayTotal.toFixed(2)}`,
                  icon: Activity,
                  color: "text-sky-400",
                  bg: isDark ? "bg-sky-500/10 border-sky-500/20" : "bg-sky-50 border-sky-200",
                  sub: `${todaySales.successCount + todaySales.failedCount + todaySales.pendingCount} orders placed`,
                },
                {
                  label: "Success Rate",
                  value: `${successRate}%`,
                  icon: CheckCircle2,
                  color: srColor,
                  bg: srBg,
                  sub: `${todaySales.successCount} fulfilled · ${todaySales.failedCount} failed`,
                },
                {
                  label: "New Users Today",
                  value: todaySales.newUsers.toLocaleString(),
                  icon: Users,
                  color: "text-purple-400",
                  bg: isDark ? "bg-purple-500/10 border-purple-500/20" : "bg-purple-50 border-purple-200",
                  sub: "Registrations today",
                },
              ].map((c) => (
                <div key={c.label} className={`relative overflow-hidden p-4 rounded-2xl border transition-all hover:scale-[1.01] ${c.bg}`}>
                  <div className="flex items-start justify-between mb-2">
                    <p className={`text-[10px] uppercase font-black tracking-widest leading-tight ${muted}`}>{c.label}</p>
                    <c.icon className={`w-4 h-4 shrink-0 ${c.color}`} />
                  </div>
                  <p className={`text-2xl font-black tracking-tight ${c.color}`}>{c.value}</p>
                  <p className={`text-[10px] mt-1.5 ${muted}`}>{c.sub}</p>
                </div>
              ))}
            </div>

            {/* ── Today's segment breakdown ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                {
                  label: "TODAY TOTAL",
                  value: `GH₵ ${todayTotal.toFixed(2)}`,
                  pct: 100,
                  color: isDark ? "text-white" : "text-gray-900",
                  barColor: isDark ? "bg-white/30" : "bg-gray-400",
                  bg: isDark ? "bg-white/[0.04] border-white/10" : "bg-white border-gray-200 shadow-sm",
                  badge: `${todaySales.successCount + todaySales.failedCount + todaySales.pendingCount} orders`,
                },
                {
                  label: "CUSTOMERS",
                  value: `GH₵ ${todaySales.customers.toFixed(2)}`,
                  pct: todayTotal > 0 ? Math.round((todaySales.customers / todayTotal) * 100) : 0,
                  color: "text-sky-400",
                  barColor: "bg-sky-500",
                  bg: isDark ? "bg-sky-500/10 border-sky-500/20" : "bg-sky-50 border-sky-200",
                  badge: null,
                },
                {
                  label: "AGENTS",
                  value: `GH₵ ${todaySales.agents.toFixed(2)}`,
                  pct: todayTotal > 0 ? Math.round((todaySales.agents / todayTotal) * 100) : 0,
                  color: "text-amber-400",
                  barColor: "bg-amber-500",
                  bg: isDark ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50 border-amber-200",
                  badge: null,
                },
                {
                  label: "SUB-AGENTS",
                  value: `GH₵ ${todaySales.subAgents.toFixed(2)}`,
                  pct: todayTotal > 0 ? Math.round((todaySales.subAgents / todayTotal) * 100) : 0,
                  color: "text-purple-400",
                  barColor: "bg-purple-500",
                  bg: isDark ? "bg-purple-500/10 border-purple-500/20" : "bg-purple-50 border-purple-200",
                  badge: null,
                },
              ].map((c) => (
                <div key={c.label} className={`p-4 rounded-2xl border ${c.bg}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className={`text-[9px] uppercase tracking-widest font-black ${muted}`}>{c.label}</p>
                    {c.badge
                      ? <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${isDark ? "bg-white/10 text-white/40" : "bg-gray-100 text-gray-500"}`}>{c.badge}</span>
                      : <span className={`text-[10px] font-black ${c.color}`}>{c.pct}%</span>
                    }
                  </div>
                  <p className={`text-xl font-black ${c.color}`}>{c.value}</p>
                  <div className={`h-1.5 rounded-full mt-3 overflow-hidden ${isDark ? "bg-white/5" : "bg-black/5"}`}>
                    <div className={`h-full rounded-full transition-all duration-700 ${c.barColor}`} style={{ width: `${c.pct}%` }} />
                  </div>
                  {!c.badge && (
                    <p className={`text-[9px] mt-1.5 ${muted}`}>{c.pct}% of today's total</p>
                  )}
                </div>
              ))}
            </div>

            {/* ── Chart (Bloomberg Aesthetic) ── */}
            <div className={`rounded-3xl border p-7 ${card} relative overflow-hidden`} style={{ background: isDark ? "linear-gradient(180deg, rgba(20,20,25,0.8) 0%, rgba(10,10,15,0.95) 100%)" : undefined }}>
              <div className="absolute inset-0 pointer-events-none rounded-3xl ring-1 ring-inset ring-white/5" />
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 relative z-10">
                <div>
                  <h3 className={`font-black text-xl tracking-tight ${head}`}>
                    {timeRange === "1y" || timeRange === "all" ? "Monthly Sales Volume" : "Daily Sales Volume"}
                  </h3>
                  <p className={`text-[11px] font-bold uppercase tracking-widest mt-1 ${muted}`}>
                    {timeRange === "1y" || timeRange === "all"
                      ? "Monthly revenue by segment"
                      : "Daily revenue breakdown"}
                  </p>
                </div>
                <div className="flex items-center gap-4 flex-wrap bg-black/20 p-2 rounded-2xl backdrop-blur-md border border-white/5">
                  {[
                    { label: "Customers",  color: "#0ea5e9" },
                    { label: "Agents",     color: "#f59e0b" },
                    { label: "Sub-Agents", color: "#a855f7" },
                  ].map((l) => (
                    <div key={l.label} className="flex items-center gap-2 px-2">
                      <span className="w-2 h-2 rounded-full shrink-0 shadow-[0_0_8px_currentColor]" style={{ backgroundColor: l.color, color: l.color }} />
                      <span className={`text-[10px] font-black uppercase tracking-widest ${isDark ? "text-white/70" : "text-gray-600"}`}>{l.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280} className="relative z-10">
                <BarChart data={dailySales} margin={{ top: 10, right: 10, left: -10, bottom: 0 }} barCategoryGap="30%">
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
                  <Bar dataKey="Customers"  stackId="seg" fill="url(#colorCust)" radius={[0, 0, 0, 0]} minPointSize={2} />
                  <Bar dataKey="Agents"     stackId="seg" fill="url(#colorAgent)" radius={[0, 0, 0, 0]} minPointSize={2} />
                  <Bar dataKey="Sub-Agents" stackId="seg" fill="url(#colorSub)" radius={[8, 8, 0, 0]} minPointSize={2} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* ── Status strip ── */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Fulfilled Today", value: todaySales.successCount, icon: CheckCircle2, color: "text-emerald-400", bg: isDark ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200" },
                { label: "Failed Today",    value: todaySales.failedCount,  icon: XCircle,      color: "text-red-400",     bg: isDark ? "bg-red-500/10 border-red-500/20"         : "bg-red-50 border-red-200"         },
                { label: "Pending Today",   value: todaySales.pendingCount, icon: Clock,        color: "text-amber-400",   bg: isDark ? "bg-amber-500/10 border-amber-500/20"     : "bg-amber-50 border-amber-200"     },
              ].map((s) => (
                <div key={s.label} className={`p-4 rounded-2xl border flex items-center gap-3 ${s.bg}`}>
                  <s.icon className={`w-5 h-5 shrink-0 ${s.color}`} />
                  <div>
                    <p className={`text-[10px] uppercase font-black tracking-widest ${muted}`}>{s.label}</p>
                    <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                  </div>
                </div>
              ))}
            </div>

          </div>
        );
      })()}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 space-y-8">

          {/* Recent orders */}
          <div className={`rounded-2xl border overflow-hidden ${card}`}>
            <div className={`p-5 border-b flex items-center justify-between ${divider} ${isDark ? "bg-white/[0.01]" : "bg-gray-50/80"}`}>
              <div>
                <h3 className={`font-bold text-lg tracking-tight ${head}`}>Recent Transactions</h3>
                <p className={`text-xs mt-0.5 ${muted}`}>The latest 8 orders on the platform.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate("/admin/orders")}
                className={`text-xs gap-1 transition-colors ${isDark ? "hover:text-amber-400 hover:bg-amber-400/10" : "hover:text-amber-600 hover:bg-amber-50"}`}>
                View All <ArrowUpRight className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="p-2">
              {recentOrders.length === 0 ? (
                <div className="text-center py-10">
                  <Package className={`w-8 h-8 mx-auto mb-3 ${muted}`} />
                  <p className={`text-sm ${muted}`}>No recent orders found.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {recentOrders.map((o) => (
                    <div key={o.id} className={`group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl transition-all border ${
                      isDark ? "border-transparent hover:bg-white/[0.04] hover:border-white/10 hover:shadow-lg hover:shadow-black/50 active:scale-[0.99]" : "border-transparent hover:bg-white hover:border-gray-200 hover:shadow-sm active:scale-[0.99]"
                    }`}>
                      <div className="flex items-center gap-4">
                        {statusIcon(o.status)}
                        <div>
                          <p className={`text-sm font-black tracking-tight ${isDark ? "text-white" : "text-gray-900"}`}>
                            {o.network && o.package_size ? `${o.network} ${o.package_size}` : "General Order"}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[11px] font-mono font-bold ${muted}`}>{o.customer_phone || "No phone"}</span>
                            <span className={`w-1 h-1 rounded-full ${isDark ? "bg-white/20" : "bg-gray-300"}`} />
                            <span className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>{new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 w-full sm:w-auto">
                        <p className="text-sm font-black text-amber-500">GH₵{Number(o.amount).toFixed(2)}</p>
                        <Badge variant="outline" className={`text-[9px] uppercase tracking-[0.2em] font-black border ${
                          o.status === "fulfilled"         ? "bg-green-500/10 text-green-500 border-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.1)]" :
                          o.status === "fulfillment_failed"? "bg-red-500/10 text-red-500 border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.1)]" :
                                                             "bg-amber-500/10 text-amber-500 border-amber-500/20 shadow-[0_0_10px_rgba(245,158,11,0.1)]"
                        }`}>
                          {o.status.replace("_", " ")}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Order tracker */}
          <div className={`rounded-2xl border p-6 ${card}`}>
            <PhoneOrderTracker
              title="Manual Order Tracker"
              subtitle="Quickly lookup the status of any order using the customer's phone number."
            />
          </div>
        </div>

        <div className="space-y-6">

          {/* Live Activity Hub (Logs) */}
          <div className={`rounded-[2rem] border overflow-hidden flex flex-col ${card}`}>
            <div className={`p-6 border-b ${divider} bg-white/[0.02]`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className={`font-black text-lg tracking-tight ${head}`}>Activity Hub</h3>
                  <p className={`text-[10px] uppercase font-bold tracking-widest ${muted}`}>Live Monitor</p>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[9px] font-black text-emerald-500 uppercase tracking-tighter">Realtime</span>
                </div>
              </div>

              <div className={`flex p-1 rounded-xl border ${isDark ? "bg-white/5 border-white/5" : "bg-gray-100 border-gray-200"}`}>
                <button
                  onClick={() => setActiveTab("topups")}
                  className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === "topups" ? "bg-amber-400 text-black shadow-lg" : isDark ? "text-white/40 hover:text-white/60" : "text-gray-500 hover:text-gray-700"}`}
                >
                  Transactions
                </button>
                <button
                  onClick={() => setActiveTab("audit")}
                  className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === "audit" ? "bg-amber-400 text-black shadow-lg" : isDark ? "text-white/40 hover:text-white/60" : "text-gray-500 hover:text-gray-700"}`}
                >
                  Audit Logs
                </button>
              </div>
            </div>

            <div className="p-4 flex-1 min-h-[360px]">
              {activeTab === "topups" ? (
                <div className="space-y-2">
                  {verifiedLogs.length === 0 ? (
                    <div className="py-12 text-center opacity-20">
                      <Activity className="w-8 h-8 mx-auto mb-2" />
                      <p className="text-[10px] font-bold uppercase tracking-widest">No transactions yet</p>
                    </div>
                  ) : (
                    verifiedLogs.map((log: any) => {
                      const typeMap: Record<string, { label: string; color: string; bg: string }> = {
                        data:                  { label: "Data",      color: "text-sky-400",     bg: "bg-sky-500/10 border-sky-500/20"         },
                        airtime:               { label: "Airtime",   color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20"       },
                        wallet_topup:          { label: "Top-up",    color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                        agent_activation:      { label: "Agent Act", color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20"     },
                        sub_agent_activation:  { label: "Sub-Agent", color: "text-purple-400",  bg: "bg-purple-500/10 border-purple-500/20"   },
                        utility:               { label: "Utility",   color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/20"   },
                        api:                   { label: "API",       color: "text-pink-400",    bg: "bg-pink-500/10 border-pink-500/20"       },
                      };
                      const t = typeMap[log.order_type] || { label: log.order_type || "Order", color: "text-white/50", bg: "bg-white/5 border-white/10" };
                      const label = log.network && log.package_size
                        ? `${log.network} ${log.package_size}`
                        : log.customer_phone || "—";
                      return (
                        <div key={log.id} className={`p-3 rounded-2xl border transition-all hover:brightness-110 ${isDark ? "bg-white/[0.03] border-white/5" : "bg-gray-50 border-gray-100"}`}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${t.bg} ${t.color}`}>
                              {t.label}
                            </span>
                            <span className={`text-[9px] font-mono ${muted}`}>
                              {new Date(log.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                              {" · "}
                              {new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <p className={`text-xs font-bold truncate ${isDark ? "text-white/90" : "text-gray-800"}`}>{label}</p>
                              <p className={`text-[10px] font-mono ${muted}`}>#{log.id.slice(0, 8).toUpperCase()}</p>
                            </div>
                            <p className={`text-sm font-black shrink-0 ml-3 ${t.color}`}>GH₵{Number(log.amount).toFixed(2)}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <Button variant="ghost" onClick={() => navigate("/admin/orders")} className={`w-full h-10 text-[9px] font-black uppercase tracking-[0.2em] transition-colors ${isDark ? "text-white/20 hover:text-white/60 hover:bg-white/5" : "text-gray-400 hover:text-gray-700"}`}>
                    View All Orders
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {auditLogs.length === 0 ? (
                    <div className="py-12 text-center opacity-20">
                      <Activity className="w-8 h-8 mx-auto mb-2" />
                      <p className="text-[10px] font-bold uppercase tracking-widest">No audit events</p>
                    </div>
                  ) : (
                    auditLogs.map((log: any) => (
                      <div key={log.id} className={`p-3 rounded-2xl border transition-all hover:brightness-110 ${isDark ? "bg-white/[0.03] border-white/5" : "bg-gray-50 border-gray-100"}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest border border-amber-500/20 px-1.5 py-0.5 rounded-md bg-amber-500/5">
                            {log.action.replace(/_/g, " ")}
                          </span>
                          <span className={`text-[9px] font-mono ${muted}`}>{new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <p className={`text-xs font-black mb-1 ${head}`}>{log.profiles?.full_name || "System"}</p>
                        <p className={`text-[10px] font-mono truncate p-2 rounded-lg border ${isDark ? "text-white/40 bg-black/20 border-white/5" : "text-gray-600 bg-white border-gray-200"}`}>
                          {JSON.stringify(log.details)}
                        </p>
                      </div>
                    ))
                  )}
                  <Button variant="ghost" onClick={() => navigate("/admin/audit-logs")} className={`w-full h-10 text-[9px] font-black uppercase tracking-[0.2em] transition-colors ${isDark ? "text-white/20 hover:text-white/60 hover:bg-white/5" : "text-gray-400 hover:text-gray-700"}`}>
                    Open Security Center
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Quick Tools */}
          <div className={`rounded-[2rem] border p-8 ${card}`}>
            <h3 className={`font-black text-lg tracking-tight mb-0.5 ${head}`}>Quick Tools</h3>
            <p className={`text-xs mb-6 ${muted}`}>Platform management shortcuts.</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Agents",      icon: Users,       path: "/admin/agents",      color: "text-blue-500",   bg: "bg-blue-500/10"   },
                { label: "Orders",      icon: ShoppingCart,path: "/admin/orders",      color: "text-emerald-500",bg: "bg-emerald-500/10"},
                { label: "Packages",    icon: Package,     path: "/admin/packages",    color: "text-purple-500", bg: "bg-purple-500/10" },
                { label: "Withdrawals", icon: Wallet,      path: "/admin/withdrawals", color: "text-amber-500",  bg: "bg-amber-500/10"  },
              ].map((a) => (
                <button
                  key={a.label}
                  onClick={() => navigate(a.path)}
                  className={`group flex flex-col items-center justify-center p-5 rounded-2xl border transition-all gap-3 ${
                    isDark ? "border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/8 shadow-inner" : "border-gray-200 bg-gray-50 hover:bg-white hover:border-gray-300 shadow-sm"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-2xl ${a.bg} flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm`}>
                    <a.icon className={`w-5 h-5 ${a.color}`} />
                  </div>
                  <span className={`text-[10px] font-black uppercase tracking-widest transition-colors ${isDark ? "text-white/40 group-hover:text-white" : "text-gray-500 group-hover:text-gray-900"}`}>{a.label}</span>
                </button>
              ))}
            </div>

            {stats.pendingAgents > 0 && (
              <button
                onClick={approveAllPending}
                disabled={approvingPending}
                className="w-full mt-6 group flex items-center justify-between p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15 transition-all shadow-lg shadow-amber-500/5"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-black text-amber-600 dark:text-amber-400">Action Required</p>
                    <p className="text-[10px] text-amber-500/80 font-bold uppercase tracking-tighter">{stats.pendingAgents} agent{stats.pendingAgents !== 1 ? "s" : ""} awaiting approval</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-amber-500/50 group-hover:translate-x-1 transition-transform" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminOverview;
