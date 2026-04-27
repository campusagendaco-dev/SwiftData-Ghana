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
    <div className={`rounded-xl p-3 shadow-xl text-xs border ${isDark ? "bg-[#0d0d18] border-white/10" : "bg-white border-gray-200"}`}>
      <p className={`mb-1.5 font-semibold ${isDark ? "text-white/60" : "text-gray-500"}`}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="font-bold">
          {p.name}: GH₵{Number(p.value).toFixed(2)}
        </p>
      ))}
      <p className={`font-bold mt-1.5 border-t pt-1.5 ${isDark ? "text-white/80 border-white/10" : "text-gray-800 border-gray-200"}`}>
        Total: GH₵{total.toFixed(2)}
      </p>
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

const AdminOverview = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isDark } = useAppTheme();

  const [stats, setStats] = useState({ 
    totalOrders: 0, 
    totalRevenue: 0, // This will be Total Inflow (Deposits + Activations)
    totalPurchases: 0, // This will be Total Consumption (Data/Airtime)
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
    rangePurchases: 0
  });
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [dailySales, setDailySales] = useState<DailySalesPoint[]>([]);
  const [todaySales, setTodaySales] = useState<TodaySales>({ total: 0, customers: 0, agents: 0, subAgents: 0, successCount: 0, failedCount: 0, pendingCount: 0, newUsers: 0 });
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

  const fetchData = useCallback(async () => {
    const now = new Date();
    let startDate = new Date();
    if (timeRange === "7d") startDate.setDate(now.getDate() - 6);
    else if (timeRange === "30d") startDate.setDate(now.getDate() - 29);
    else if (timeRange === "1y") startDate.setFullYear(now.getFullYear() - 1);
    else startDate = new Date(2024, 0, 1); // Earliest possible date
    
    startDate.setHours(0, 0, 0, 0);

    const [ordersRes, profilesRes, maintenanceRes, recentRes, rangeOrdersRes, providerRes, withdrawalsRes, ticketsRes, topupsRes, auditRes, walletsRes, salesStatsRes] = await Promise.all([
      supabase.from("orders").select("id, amount, status, order_type, profit, parent_profit"),
      supabase.from("profiles").select("user_id, is_agent, is_sub_agent, agent_approved, sub_agent_approved, onboarding_complete, created_at"),
      supabase.functions.invoke("maintenance-mode", { body: { action: "get" } }),
      supabase.from("orders").select("id, network, package_size, customer_phone, amount, status, created_at").order("created_at", { ascending: false }).limit(8),
      supabase.from("orders").select("id, amount, agent_id, created_at, status, order_type").gte("created_at", startDate.toISOString()).order("created_at", { ascending: false }).limit(2000),
      supabase.functions.invoke("admin-user-actions", { body: { action: "get_provider_balance" } }).catch(e => ({ data: { success: false, error: e.message }, error: e })),
      supabase.from("withdrawals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("orders").select("id, amount, network, package_size, customer_phone, order_type, created_at").eq("status", "fulfilled").order("created_at", { ascending: false }).limit(12),
      supabase.from("audit_logs").select("id, action, details, created_at, profiles(full_name)").order("created_at", { ascending: false }).limit(6),
      supabase.from("wallets").select("balance"),
      supabase.from("user_sales_stats").select("total_sales_volume, total_own_profit, total_commissions_paid"),
    ]);

    const orders = ordersRes?.data || [];
    const profiles = profilesRes?.data || [];
    const rangeOrders = rangeOrdersRes?.data || [];
    const wallets = walletsRes?.data || [];
    const salesStats = salesStatsRes?.data || [];

    const totalSystemBalance = Array.isArray(wallets) ? wallets.reduce((s, w) => s + (Number(w?.balance) || 0), 0) : 0;
    const totalVolumeAllTime = Array.isArray(salesStats) ? salesStats.reduce((s, st) => s + (Number(st?.total_sales_volume) || 0), 0) : 0;
    const totalAgentProfitsAllTime = Array.isArray(salesStats) ? salesStats.reduce((s, st) => s + (Number(st?.total_own_profit) || 0), 0) : 0;
    const totalSubAgentProfitsAllTime = Array.isArray(salesStats) ? salesStats.reduce((s, st) => s + (Number(st?.total_commissions_paid) || 0), 0) : 0;
    
    const maintenanceRow = (maintenanceRes?.data as any) || null;
    const maintenanceError = maintenanceRes?.error || maintenanceRow?.error;
    const isMonthly = timeRange === "1y" || timeRange === "all";

    const agentIds = new Set(profiles.filter((p: any) => p?.is_agent && p?.agent_approved).map((p: any) => p?.user_id));
    const subAgentIds = new Set(profiles.filter((p: any) => p?.is_sub_agent && p?.sub_agent_approved).map((p: any) => p?.user_id));

    const chartMap: Record<string, DailySalesPoint> = {};
    if (isMonthly) {
      // Monthly grouping
      for (let i = (timeRange === "1y" ? 11 : 24); i >= 0; i--) {
        const d = new Date(now);
        d.setMonth(now.getMonth() - i);
        const key = d.toISOString().slice(0, 7); // YYYY-MM
        chartMap[key] = { date: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }), Customers: 0, Agents: 0, "Sub-Agents": 0, Deposits: 0, Purchases: 0 };
      }
    } else {
      // Daily grouping
      const daysCount = timeRange === "7d" ? 7 : 30;
      for (let i = daysCount - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        chartMap[key] = { date: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), Customers: 0, Agents: 0, "Sub-Agents": 0, Deposits: 0, Purchases: 0 };
      }
    }

    const todayStr = now.toISOString().slice(0, 10);


    const DEPOSIT_TYPES = new Set(["wallet_topup", "agent_activation", "sub_agent_activation"]);
    const SALE_TYPES    = new Set(["data", "airtime", "utility", "afa", "api"]);

    rangeOrders.forEach((o: any) => {
      if (o.status !== "fulfilled") return;

      const fullKey  = (o.created_at as string).slice(0, 10);
      const chartKey = isMonthly ? fullKey.slice(0, 7) : fullKey;
      const amt      = Number(o.amount) || 0;
      const bucket   = chartMap[chartKey];

      if (!bucket) return;

      if (DEPOSIT_TYPES.has(o.order_type)) {
        // Deposits/activations go only into the Deposits column
        bucket.Deposits += amt;
      } else if (SALE_TYPES.has(o.order_type)) {
        // Product sales go into Purchases AND the correct segment column
        bucket.Purchases += amt;
        if      (agentIds.has(o.agent_id))    bucket.Agents        += amt;
        else if (subAgentIds.has(o.agent_id)) bucket["Sub-Agents"] += amt;
        else                                   bucket.Customers     += amt;
      }
    });

    setDailySales(Object.values(chartMap));
    
    const todayOrders = rangeOrders.filter((o: any) => (o.created_at as string).slice(0, 10) === todayStr);
    const todaySuccess = todayOrders.filter((o: any) => o.status === "fulfilled").length;
    const todayFailed = todayOrders.filter((o: any) => o.status === "fulfillment_failed").length;
    const todayPending = todayOrders.filter((o: any) => o.status === "pending").length;
    const todayUsers = profiles.filter((p: any) => (p.created_at as string)?.slice(0, 10) === todayStr).length;

    const inflowOrders = orders.filter((o: any) => o.status === "fulfilled" && ["wallet_topup", "agent_activation", "sub_agent_activation"].includes(o.order_type));
    const purchaseOrders = orders.filter((o: any) => o.status === "fulfilled" && ["data", "airtime", "utility", "afa", "api"].includes(o.order_type));

    const totalRevenue = inflowOrders.reduce((s: number, o: any) => s + (Number(o.amount) || 0), 0);
    const totalPurchases = purchaseOrders.reduce((s: number, o: any) => s + (Number(o.amount) || 0), 0);
    const displayRevenue = totalRevenue > 0 ? totalRevenue : totalVolumeAllTime;

    const PURCHASE_TYPES = ["data", "airtime", "utility", "afa", "api"];
    const todayFulfilledPurchases = todayOrders.filter((o: any) => o.status === "fulfilled" && PURCHASE_TYPES.includes(o.order_type));
    
    setTodaySales({ 
      total: todayFulfilledPurchases.reduce((s, o) => s + (Number(o.amount) || 0), 0),
      customers: todayFulfilledPurchases.filter(o => !agentIds.has(o.agent_id) && !subAgentIds.has(o.agent_id)).reduce((s, o) => s + (Number(o.amount) || 0), 0),
      agents: todayFulfilledPurchases.filter(o => agentIds.has(o.agent_id)).reduce((s, o) => s + (Number(o.amount) || 0), 0),
      subAgents: todayFulfilledPurchases.filter(o => subAgentIds.has(o.agent_id)).reduce((s, o) => s + (Number(o.amount) || 0), 0),
      successCount: todaySuccess,
      failedCount: todayFailed,
      pendingCount: todayPending,
      newUsers: todayUsers
    });
    const rangeInflow = rangeOrders.filter((o: any) => o.status === "fulfilled" && ["wallet_topup", "agent_activation", "sub_agent_activation"].includes(o.order_type)).reduce((s: number, o: any) => s + (Number(o.amount) || 0), 0);
    const rangeVerifiedInflow = rangeOrders.filter((o: any) => o.status === "fulfilled" && ["wallet_topup", "agent_activation", "sub_agent_activation"].includes(o.order_type)).reduce((s: number, o: any) => s + (Number(o.paystack_verified_amount) || Number(o.amount) || 0), 0);
    const rangePurchases = rangeOrders.filter((o: any) => o.status === "fulfilled" && ["data", "airtime", "utility", "afa", "api"].includes(o.order_type)).reduce((s: number, o: any) => s + (Number(o.amount) || 0), 0);

    setStats({
      totalOrders: orders.length,
      totalRevenue: displayRevenue,
      totalPurchases: totalPurchases,
      totalUsers: profiles.length,
      pendingAgents: profiles.filter((p: any) => p.is_agent && !p.agent_approved && p.onboarding_complete).length,
      swiftDataSubAgentShare: totalVolumeAllTime - totalAgentProfitsAllTime,
      totalAgentProfit: totalAgentProfitsAllTime,
      totalSubAgentProfit: totalSubAgentProfitsAllTime,
      pendingWithdrawals: withdrawalsRes.count || 0,
      unreadTickets: ticketsRes.count || 0,
      totalSystemBalance,
      todaySignups: todayUsers,
      totalRangePurchase: rangeOrders.filter((o: any) => o.status === "fulfilled" && PURCHASE_TYPES.includes(o.order_type)).reduce((s: number, o: any) => s + (Number(o.amount) || 0), 0),
      rangeInflow,
      rangeVerifiedInflow,
      rangePurchases
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
    setLoading(false);
  }, [timeRange]);

  useEffect(() => {
    fetchData();

    const ordersChannel = supabase
      .channel("admin-live-orders")
      .on("postgres_changes", { event: "*", table: "orders", schema: "public" }, (payload) => {
        fetchData();
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
        fetchData();
        setUpdatedKeys(new Set(["Pending Agents", "Active Users"]));
        setTimeout(() => setUpdatedKeys(new Set()), 1500);
      })
      .subscribe();

    const interval = setInterval(fetchData, 60_000);

    return () => {
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(profilesChannel);
      clearInterval(interval);
    };
  }, [timeRange, fetchData, toast]);

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
    const { data: pending } = await supabase.from("profiles").select("user_id").eq("is_agent", true).eq("onboarding_complete", true).eq("agent_approved", false);
    if (!pending || pending.length === 0) {
      toast({ title: "No pending agents to approve" });
      setApprovingPending(false);
      return;
    }
    const ids = pending.map((p: any) => p.user_id);
    const { error } = await supabase.from("profiles").update({ agent_approved: true }).in("user_id", ids);
    if (error) {
      toast({ title: "Failed to approve agents", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Approved ${ids.length} agent${ids.length !== 1 ? "s" : ""}` });
      await fetchData();
    }
    setApprovingPending(false);
  };

  const statCards = [
    { title: "Total Inflow",     value: `GH₵ ${(stats.totalRevenue || 0).toFixed(2)}`,                                icon: DollarSign, color: "text-emerald-500",  bg: "bg-emerald-500/10",  border: "border-emerald-500/20"  },
    { title: "Data/Airtime Volume",   value: `GH₵ ${(stats.totalPurchases || 0).toFixed(2)}`,                                icon: ShoppingCart, color: "text-blue-500",  bg: "bg-blue-500/10",  border: "border-blue-500/20"  },
    { title: "Agent Profits",   value: `GH₵ ${(stats.totalAgentProfit || 0).toFixed(2)}`, icon: DollarSign, color: "text-amber-500",  bg: "bg-amber-400/10",  border: "border-amber-400/20"  },
    { title: "User Balances",   value: `GH₵ ${(stats.totalSystemBalance || 0).toFixed(2)}`,                        icon: Wallet,     color: "text-red-400",    bg: "bg-red-400/10",    border: "border-red-400/20"    },
    { title: "Platform Share",  value: `GH₵ ${(stats.swiftDataSubAgentShare || 0).toFixed(2)}`,                      icon: Activity,   color: "text-sky-500",   bg: "bg-sky-400/10",   border: "border-sky-400/20"   },
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
    { title: "Today's Success", value: todaySales.successCount, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    { title: "Today's Failed",  value: todaySales.failedCount,  icon: XCircle,      color: "text-red-500",     bg: "bg-red-500/10",     border: "border-red-500/20"     },
    { title: "Today's New Users", value: todaySales.newUsers,     icon: Users,        color: "text-indigo-500",  bg: "bg-indigo-500/10",  border: "border-indigo-500/20"  },
    { title: "Pending Withdrawals", value: stats.pendingWithdrawals, icon: Wallet,   color: stats.pendingWithdrawals > 0 ? "text-red-500" : "text-emerald-500", bg: stats.pendingWithdrawals > 0 ? "bg-red-500/10" : "bg-emerald-500/10", border: stats.pendingWithdrawals > 0 ? "border-red-500/20" : "border-emerald-500/20" },
    { title: "Open Tickets",      value: stats.unreadTickets,      icon: MessageCircle, color: stats.unreadTickets > 0 ? "text-amber-500" : "text-emerald-500", bg: stats.unreadTickets > 0 ? "bg-amber-500/10" : "bg-emerald-500/10", border: stats.unreadTickets > 0 ? "border-amber-500/20" : "border-emerald-500/20" },
    { title: "Total Purchase", value: `GH₵ ${(stats.totalRangePurchase || 0).toFixed(2)}`, icon: ShoppingCart, color: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" },
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
      <div className={`flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b pb-6 ${divider}`}>
        <div>
          <h1 className={`text-3xl font-black tracking-tight ${head}`}>Overview</h1>
          <div className="flex items-center gap-3 mt-1">
            <p className={`text-sm ${sub}`}>Monitor platform metrics and recent activities.</p>
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full uppercase tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </div>
          {lastUpdated && (
            <p className={`text-[10px] mt-1 ${muted}`}>
              Last updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          )}
        </div>
        <Button
          onClick={fetchData}
          className={`gap-2 rounded-xl border font-semibold text-sm transition-all ${
            isDark ? "bg-white/5 hover:bg-white/10 text-white border-white/10" : "bg-white hover:bg-gray-50 text-gray-700 border-gray-200 shadow-sm"
          }`}
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {statCards.map((c) => {
          const isFlashing = updatedKeys.has(c.title);
          return (
            <div
              key={c.title}
              className={`relative group p-5 rounded-2xl border overflow-hidden transition-all hover:scale-[1.01] ${card}`}
              style={isFlashing ? { outline: `1.5px solid ${isDark ? "rgba(251,191,36,0.4)" : "rgba(251,191,36,0.5)"}`, outlineOffset: "2px" } : undefined}
            >
              <div className={`absolute top-0 right-0 w-24 h-24 ${c.bg} blur-2xl -mr-10 -mt-10 rounded-full transition-transform group-hover:scale-150`} />
              <div className="relative z-10 flex items-center justify-between mb-3">
                <p className={`text-xs font-semibold uppercase tracking-wider ${muted}`}>{c.title}</p>
                <div className={`w-8 h-8 rounded-xl ${c.bg} ${c.border} border flex items-center justify-center`}>
                  <c.icon className={`w-4 h-4 ${c.color}`} />
                </div>
              </div>
              <p className={`relative z-10 text-2xl font-black tracking-tight ${head}`}>{c.value}</p>
              {isFlashing && (
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              )}
            </div>
          );
        })}
      </div>

      <div className={`p-6 rounded-[2rem] border ${isDark ? "bg-[#0d0d12] border-amber-500/20 shadow-[0_20px_50px_rgba(0,0,0,0.3)]" : "bg-amber-50/50 border-amber-200"}`}>
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-6 h-6 text-amber-500" />
          </div>
          <div className="space-y-4 flex-1">
            <div>
              <h2 className={`text-xl font-black tracking-tight ${head}`}>Financial Reconciliation</h2>
              <p className={`text-sm mt-1 leading-relaxed ${sub}`}>
                Understanding the discrepancy between Paystack inflows and dashboard purchases.
              </p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className={`p-4 rounded-2xl border ${isDark ? "bg-black/40 border-white/5 shadow-inner" : "bg-white border-gray-100 shadow-sm"}`}>
                <p className={`text-[10px] uppercase font-black tracking-widest mb-1 text-emerald-500`}>Verified Inflow ({timeRange})</p>
                <p className={`text-lg font-black text-white`}>GH₵ {(stats.rangeVerifiedInflow || 0).toFixed(2)}</p>
                <p className="text-[9px] text-white/20 mt-1">Confirmed Paystack settlements.</p>
              </div>
              <div className={`p-4 rounded-2xl border ${isDark ? "bg-black/40 border-white/5" : "bg-white border-gray-100"}`}>
                <p className={`text-[10px] uppercase font-black tracking-widest mb-1 ${muted}`}>Held in Wallets</p>
                <p className={`text-lg font-black text-red-400`}>GH₵ {(stats.totalSystemBalance || 0).toFixed(2)}</p>
                <p className="text-[9px] text-white/20 mt-1">Snapshot of unspent funds right now.</p>
              </div>
              <div className={`p-4 rounded-2xl border ${isDark ? "bg-black/40 border-white/5" : "bg-white border-gray-100"}`}>
                <p className={`text-[10px] uppercase font-black tracking-widest mb-1 ${muted}`}>Product Sales ({timeRange})</p>
                <p className={`text-lg font-black text-blue-400`}>GH₵ {(stats.rangePurchases || 0).toFixed(2)}</p>
                <p className="text-[9px] text-white/20 mt-1">Total consumption in this period.</p>
              </div>
            </div>

            <div className={`text-xs p-4 rounded-xl border italic ${isDark ? "bg-white/5 border-white/10 text-white/60" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
              💡 <strong>Note:</strong> If your Paystack total is higher than "Total Purchase", it means users have topped up their wallets but 
              <strong> haven't spent the money yet</strong>. That money is sitting safely in their account balances (Liability) and will show up in revenue once they buy data.
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
                      href={providerDiagnostics.baseUrl} 
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
                    {providerDiagnostics.baseUrl.replace(/https?:\/\//, "")}
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

            {/* ── Chart (segment stacked) ── */}
            <div className={`rounded-2xl border p-6 ${card}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                <div>
                  <h3 className={`font-bold ${head}`}>
                    {timeRange === "1y" || timeRange === "all" ? "Monthly Sales Volume" : "Daily Sales Volume"}
                  </h3>
                  <p className={`text-xs mt-0.5 ${muted}`}>
                    {timeRange === "1y" || timeRange === "all"
                      ? "Monthly revenue by segment across your network."
                      : "Daily revenue breakdown from fulfilled orders."}
                  </p>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  {[
                    { label: "Customers",  color: "#0ea5e9" },
                    { label: "Agents",     color: "#f59e0b" },
                    { label: "Sub-Agents", color: "#a855f7" },
                  ].map((l) => (
                    <div key={l.label} className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: l.color }} />
                      <span className={`text-[10px] font-semibold ${muted}`}>{l.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={dailySales} margin={{ top: 5, right: 10, left: -10, bottom: 0 }} barCategoryGap="35%">
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="date" tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={(props: any) => <DailySalesTooltip {...props} isDark={isDark} />} />
                  <Bar dataKey="Customers"  stackId="seg" fill="#0ea5e9" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Agents"     stackId="seg" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Sub-Agents" stackId="seg" fill="#a855f7" radius={[6, 6, 0, 0]} />
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
                <div className="space-y-0.5">
                  {recentOrders.map((o) => (
                    <div key={o.id} className={`group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl transition-colors border border-transparent ${
                      isDark ? "hover:bg-white/[0.03] hover:border-white/5" : "hover:bg-gray-50 hover:border-gray-100"
                    }`}>
                      <div className="flex items-center gap-3">
                        {statusIcon(o.status)}
                        <div>
                          <p className={`text-sm font-bold ${isDark ? "text-white/90" : "text-gray-800"}`}>
                            {o.network && o.package_size ? `${o.network} ${o.package_size}` : "General Order"}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-xs font-mono ${muted}`}>{o.customer_phone || "No phone"}</span>
                            <span className={`w-1 h-1 rounded-full ${isDark ? "bg-white/20" : "bg-gray-300"}`} />
                            <span className={`text-xs ${muted}`}>{new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 w-full sm:w-auto">
                        <p className="text-sm font-black text-amber-500">GH₵{Number(o.amount).toFixed(2)}</p>
                        <Badge variant="outline" className={`text-[9px] uppercase tracking-wider font-bold border ${
                          o.status === "fulfilled"         ? "bg-green-500/10 text-green-600 border-green-500/25" :
                          o.status === "fulfillment_failed"? "bg-red-500/10 text-red-600 border-red-500/25" :
                                                             "bg-amber-500/10 text-amber-600 border-amber-500/25"
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
                      <div key={log.id} className="p-3 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] transition-all">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest border border-amber-400/20 px-1.5 py-0.5 rounded-md bg-amber-400/5">
                            {log.action.replace(/_/g, " ")}
                          </span>
                          <span className="text-[9px] text-white/20 font-mono">{new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <p className="text-xs font-black text-white/90 mb-1">{log.profiles?.full_name || "System"}</p>
                        <p className="text-[10px] text-white/40 font-mono truncate bg-black/20 p-2 rounded-lg border border-white/5">
                          {JSON.stringify(log.details)}
                        </p>
                      </div>
                    ))
                  )}
                  <Button variant="ghost" onClick={() => navigate("/admin/audit-logs")} className="w-full h-10 text-[9px] font-black uppercase tracking-[0.2em] text-white/20 hover:text-white/60 hover:bg-white/5">
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
