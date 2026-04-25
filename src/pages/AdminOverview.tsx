import { useEffect, useState } from "react";
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
}

interface TodaySales {
  total: number;
  customers: number;
  agents: number;
  subAgents: number;
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

  const [stats, setStats] = useState({ totalOrders: 0, totalRevenue: 0, totalUsers: 0, pendingAgents: 0, swiftDataSubAgentShare: 0, totalAgentProfit: 0, totalSubAgentProfit: 0 });
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [dailySales, setDailySales] = useState<DailySalesPoint[]>([]);
  const [todaySales, setTodaySales] = useState<TodaySales>({ total: 0, customers: 0, agents: 0, subAgents: 0 });
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("We are performing scheduled maintenance. Please check back soon.");
  const [savingMaintenance, setSavingMaintenance] = useState(false);
  const [maintenanceTableReady, setMaintenanceTableReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [approvingPending, setApprovingPending] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [updatedKeys, setUpdatedKeys] = useState<Set<string>>(new Set());

  const fetchData = async () => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const [ordersRes, profilesRes, maintenanceRes, recentRes, weeklyOrdersRes] = await Promise.all([
      supabase.from("orders").select("id, amount, status, order_type, profit, parent_profit"),
      supabase.from("profiles").select("user_id, is_agent, is_sub_agent, agent_approved, sub_agent_approved, onboarding_complete"),
      supabase.functions.invoke("maintenance-mode", { body: { action: "get" } }),
      supabase.from("orders").select("id, network, package_size, customer_phone, amount, status, created_at").order("created_at", { ascending: false }).limit(8),
      supabase.from("orders").select("id, amount, agent_id, created_at").gte("created_at", sevenDaysAgo.toISOString()).eq("status", "fulfilled"),
    ]);

    const orders = ordersRes.data || [];
    const profiles = profilesRes.data || [];
    const weeklyOrders = weeklyOrdersRes.data || [];
    const maintenanceRow = maintenanceRes.data as { is_enabled?: boolean; message?: string; table_ready?: boolean; error?: string } | null;
    const maintenanceError = maintenanceRes.error || maintenanceRow?.error;

    const agentIds = new Set(profiles.filter((p: any) => p.is_agent && p.agent_approved).map((p: any) => p.user_id));
    const subAgentIds = new Set(profiles.filter((p: any) => p.is_sub_agent && p.sub_agent_approved).map((p: any) => p.user_id));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = today.toISOString().slice(0, 10);

    const dayMap: Record<string, DailySalesPoint> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dayMap[key] = { date: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), Customers: 0, Agents: 0, "Sub-Agents": 0 };
    }

    let todayCustomers = 0, todayAgents = 0, todaySubAgents = 0;
    weeklyOrders.forEach((o: any) => {
      const key = (o.created_at as string).slice(0, 10);
      if (!dayMap[key]) return;
      const amt = Number(o.amount) || 0;
      if (o.agent_id && subAgentIds.has(o.agent_id)) {
        dayMap[key]["Sub-Agents"] += amt;
        if (key === todayKey) todaySubAgents += amt;
      } else if (o.agent_id && agentIds.has(o.agent_id)) {
        dayMap[key].Agents += amt;
        if (key === todayKey) todayAgents += amt;
      } else {
        dayMap[key].Customers += amt;
        if (key === todayKey) todayCustomers += amt;
      }
    });

    setDailySales(Object.values(dayMap));
    setTodaySales({ total: todayCustomers + todayAgents + todaySubAgents, customers: todayCustomers, agents: todayAgents, subAgents: todaySubAgents });
    setStats({
      totalOrders: orders.length,
      totalRevenue: orders.filter((o: any) => o.status === "fulfilled").reduce((s: number, o: any) => s + (o.amount || 0), 0),
      totalUsers: profiles.length,
      pendingAgents: profiles.filter((p: any) => p.is_agent && p.onboarding_complete && !p.agent_approved).length,
      swiftDataSubAgentShare: orders.filter((o: any) => o.status === "fulfilled" && o.order_type === "sub_agent_activation").reduce((s: number, o: any) => s + (Number(o.amount || 0) * 0.5), 0),
      totalAgentProfit: orders.filter((o: any) => o.status === "fulfilled").reduce((s: number, o: any) => s + Number(o.profit || 0), 0),
      totalSubAgentProfit: orders.filter((o: any) => o.status === "fulfilled").reduce((s: number, o: any) => s + Number(o.parent_profit || 0), 0),
    });
    setRecentOrders((recentRes.data || []) as RecentOrder[]);

    if (maintenanceError) {
      setMaintenanceTableReady(false);
    } else if (maintenanceRow) {
      setMaintenanceTableReady(Boolean(maintenanceRow.table_ready ?? true));
      setMaintenanceEnabled(!!maintenanceRow.is_enabled);
      setMaintenanceMessage(maintenanceRow.message?.trim() || "We are performing scheduled maintenance. Please check back soon.");
    }
    setLastUpdated(new Date());
    setLoading(false);
  };

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
        // Flash the revenue/profit cards
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

    // Fallback refresh every 60 seconds
    const interval = setInterval(fetchData, 60_000);

    return () => {
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(profilesChannel);
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    { title: "Total Revenue",   value: `GH₵ ${stats.totalRevenue.toFixed(2)}`,                                icon: DollarSign, color: "text-green-500",  bg: "bg-green-500/10",  border: "border-green-500/20"  },
    { title: "Agent Profits",   value: `GH₵ ${(stats.totalAgentProfit + stats.totalSubAgentProfit).toFixed(2)}`, icon: DollarSign, color: "text-amber-500",  bg: "bg-amber-400/10",  border: "border-amber-400/20"  },
    { title: "Platform Share",  value: `GH₵ ${stats.swiftDataSubAgentShare.toFixed(2)}`,                      icon: Activity,   color: "text-blue-500",   bg: "bg-blue-400/10",   border: "border-blue-400/20"   },
    { title: "Active Users",    value: stats.totalUsers.toLocaleString(),                                      icon: Users,      color: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" },
    {
      title: "Pending Agents",
      value: stats.pendingAgents,
      icon: ShieldCheck,
      color: stats.pendingAgents > 0 ? "text-red-500" : "text-emerald-500",
      bg:    stats.pendingAgents > 0 ? "bg-red-500/10"     : "bg-emerald-500/10",
      border:stats.pendingAgents > 0 ? "border-red-500/20" : "border-emerald-500/20",
    },
  ];

  // Chart axis/grid colors
  const axisColor  = isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)";
  const gridColor  = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
  const legendColor= isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)";

  // Shared card classes
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

      {/* Page header */}
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

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {statCards.map((c) => {
          const isFlashing = updatedKeys.has(c.title) || updatedKeys.has("totalRevenue" ) && c.title === "Total Revenue";
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

      {/* Daily Sales */}
      <div className="space-y-4">
        <div>
          <h2 className={`font-bold text-xl flex items-center gap-2 ${head}`}>
            <TrendingUp className="w-5 h-5 text-amber-500" /> Daily Sales
          </h2>
          <p className={`text-xs mt-0.5 ${muted}`}>Fulfilled sales from customers, agents and sub-agents — last 7 days.</p>
        </div>

        {/* Today totals */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Today Total", value: `GH₵ ${todaySales.total.toFixed(2)}`,     color: head,             bg: isDark ? "bg-white/[0.03] border-white/8" : "bg-white border-gray-200 shadow-sm" },
            { label: "Customers",   value: `GH₵ ${todaySales.customers.toFixed(2)}`, color: "text-sky-500",   bg: isDark ? "bg-sky-500/10 border-sky-500/20" : "bg-sky-50 border-sky-200" },
            { label: "Agents",      value: `GH₵ ${todaySales.agents.toFixed(2)}`,    color: "text-amber-500", bg: isDark ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50 border-amber-200" },
            { label: "Sub-Agents",  value: `GH₵ ${todaySales.subAgents.toFixed(2)}`, color: "text-purple-500",bg: isDark ? "bg-purple-500/10 border-purple-500/20" : "bg-purple-50 border-purple-200" },
          ].map((c) => (
            <div key={c.label} className={`p-4 rounded-2xl border ${c.bg}`}>
              <p className={`text-[10px] mb-2 uppercase tracking-wider font-semibold ${muted}`}>{c.label}</p>
              <p className={`text-xl font-black ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* 7-day stacked bar chart */}
        <div className={`rounded-2xl border p-6 ${card}`}>
          <h3 className={`font-bold mb-1 ${head}`}>Sales by Seller Type — Last 7 Days</h3>
          <p className={`text-xs mb-5 ${muted}`}>Revenue from fulfilled orders grouped by seller type per day.</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dailySales} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="date" tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={(props) => <DailySalesTooltip {...props} isDark={isDark} />} />
              <Legend formatter={(v) => <span style={{ color: legendColor, fontSize: 12 }}>{v}</span>} />
              <Bar dataKey="Customers"  stackId="a" fill="#38bdf8" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Agents"     stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Sub-Agents" stackId="a" fill="#a855f7" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

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

          {/* Quick tools */}
          <div className={`rounded-2xl border p-5 ${card}`}>
            <h3 className={`font-bold text-base tracking-tight mb-0.5 ${head}`}>Quick Tools</h3>
            <p className={`text-xs mb-5 ${muted}`}>Access frequent admin functions.</p>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { label: "Agents",      icon: Users,       path: "/admin/agents",      color: "text-blue-500",   bg: "bg-blue-500/10"   },
                { label: "Orders",      icon: ShoppingCart,path: "/admin/orders",      color: "text-emerald-500",bg: "bg-emerald-500/10"},
                { label: "Packages",    icon: Package,     path: "/admin/packages",    color: "text-purple-500", bg: "bg-purple-500/10" },
                { label: "Withdrawals", icon: Wallet,      path: "/admin/withdrawals", color: "text-amber-500",  bg: "bg-amber-500/10"  },
              ].map((a) => (
                <button
                  key={a.label}
                  onClick={() => navigate(a.path)}
                  className={`group flex flex-col items-center justify-center p-4 rounded-xl border transition-all gap-2.5 ${
                    isDark ? "border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/8" : "border-gray-200 bg-gray-50 hover:bg-white hover:border-gray-300 shadow-sm"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl ${a.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <a.icon className={`w-4.5 h-4.5 ${a.color}`} />
                  </div>
                  <span className={`text-xs font-semibold transition-colors ${isDark ? "text-white/60 group-hover:text-white" : "text-gray-500 group-hover:text-gray-900"}`}>{a.label}</span>
                </button>
              ))}
            </div>

            {stats.pendingAgents > 0 && (
              <button
                onClick={approveAllPending}
                disabled={approvingPending}
                className="w-full mt-4 group flex items-center justify-between p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4 text-amber-500" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-amber-600 dark:text-amber-400">Action Required</p>
                    <p className="text-[10px] text-amber-500/80">{stats.pendingAgents} agent{stats.pendingAgents !== 1 ? "s" : ""} awaiting approval</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-amber-500/50 group-hover:translate-x-1 transition-transform" />
              </button>
            )}
          </div>

          {/* Maintenance / System Status */}
          <div className={`rounded-2xl border overflow-hidden relative ${card}`}>
            <div className={`absolute top-0 left-0 right-0 h-0.5 ${maintenanceEnabled ? "bg-red-500" : "bg-emerald-500"}`} />
            <div className="p-5">
              <h3 className={`font-bold text-base tracking-tight mb-0.5 ${head}`}>System Status</h3>
              <p className={`text-xs mb-5 ${muted}`}>Manage platform accessibility.</p>

              {!maintenanceTableReady && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-xs text-red-500 font-medium">Database migration required for maintenance mode.</p>
                </div>
              )}

              <div className="space-y-4">
                <div className={`flex items-center justify-between p-3.5 rounded-xl border ${card2}`}>
                  <div>
                    <Label className={`text-sm font-bold ${head}`}>Maintenance Mode</Label>
                    <p className={`text-[10px] mt-0.5 ${muted}`}>Restrict access to admins only</p>
                  </div>
                  <Switch checked={maintenanceEnabled} onCheckedChange={setMaintenanceEnabled} className="data-[state=checked]:bg-red-500" />
                </div>

                <div>
                  <Label className={`text-xs font-semibold mb-1.5 block ${muted}`}>Display Message</Label>
                  <Textarea
                    value={maintenanceMessage}
                    onChange={(e) => setMaintenanceMessage(e.target.value)}
                    className={`resize-none rounded-xl text-sm ${
                      isDark ? "bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-amber-400/50" : "bg-gray-50 border-gray-200 text-gray-800 placeholder:text-gray-400 focus:border-amber-400"
                    }`}
                    placeholder="Enter message for visitors..."
                    rows={3}
                  />
                </div>

                <Button
                  onClick={saveMaintenance}
                  disabled={savingMaintenance}
                  className={`w-full font-bold rounded-xl h-10 transition-all ${
                    isDark ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-gray-800"
                  }`}
                >
                  {savingMaintenance ? "Saving…" : "Apply Changes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminOverview;
