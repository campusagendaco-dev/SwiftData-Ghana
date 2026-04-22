import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, Users, Smartphone, Zap, Loader2, RefreshCw, DollarSign, ShoppingCart, Target } from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface OrderRecord {
  id: string;
  profit: number | null;
  network: string | null;
  agent_id: string | null;
  amount: number;
  status: string;
  created_at: string;
}

interface AgentRecord {
  user_id: string;
  full_name: string;
  store_name: string;
}

const NETWORK_COLORS: Record<string, string> = {
  MTN: "#FFC107",
  Telecel: "#E53935",
  AirtelTigo: "#E91E8C",
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0d0d18] border border-white/10 rounded-xl p-3 shadow-xl text-xs">
      <p className="text-white/60 mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="font-bold">
          {p.name}: {p.name === "Revenue" || p.name === "Profit" ? `GH₵${Number(p.value).toFixed(2)}` : p.value}
        </p>
      ))}
    </div>
  );
};

const AdminAnalytics = () => {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);

  const fetchData = async () => {
    setLoading(true);
    const [ordersRes, agentsRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id, profit, network, agent_id, amount, status, created_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("profiles")
        .select("user_id, full_name, store_name")
        .eq("is_agent", true)
        .eq("agent_approved", true),
    ]);
    setOrders((ordersRes.data as OrderRecord[]) || []);
    setAgents((agentsRes.data as AgentRecord[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const fulfilledOrders = useMemo(() => orders.filter(o => o.status === "fulfilled"), [orders]);

  // Key stats
  const totalRevenue = useMemo(() => fulfilledOrders.reduce((s, o) => s + (o.amount || 0), 0), [fulfilledOrders]);
  const totalProfit = useMemo(() => fulfilledOrders.reduce((s, o) => s + (Number(o.profit) || 0), 0), [fulfilledOrders]);
  const activeAgents = useMemo(() => {
    const ids = new Set(fulfilledOrders.map(o => o.agent_id).filter(Boolean));
    return ids.size;
  }, [fulfilledOrders]);
  const fulfillmentRate = orders.length > 0
    ? ((fulfilledOrders.length / orders.filter(o => o.status !== "pending").length) * 100)
    : 0;

  // Top network by order count
  const networkCounts = useMemo(() => {
    const counts: Record<string, { orders: number; revenue: number }> = {};
    fulfilledOrders.forEach(o => {
      if (o.network) {
        if (!counts[o.network]) counts[o.network] = { orders: 0, revenue: 0 };
        counts[o.network].orders++;
        counts[o.network].revenue += o.amount || 0;
      }
    });
    return counts;
  }, [fulfilledOrders]);
  const topNetwork = Object.entries(networkCounts).sort((a, b) => b[1].orders - a[1].orders)[0]?.[0] || "N/A";

  // Daily revenue for last 14 days
  const dailyData = useMemo(() => {
    const days: Record<string, { date: string; Revenue: number; Profit: number; Orders: number }> = {};
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days[key] = { date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), Revenue: 0, Profit: 0, Orders: 0 };
    }
    fulfilledOrders.forEach(o => {
      const key = o.created_at.slice(0, 10);
      if (days[key]) {
        days[key].Revenue += o.amount || 0;
        days[key].Profit += Number(o.profit) || 0;
        days[key].Orders++;
      }
    });
    return Object.values(days);
  }, [fulfilledOrders]);

  // Network pie chart data
  const networkPieData = useMemo(() =>
    Object.entries(networkCounts).map(([name, val]) => ({ name, value: val.orders, revenue: val.revenue })),
    [networkCounts]
  );

  // Top agents by revenue
  const topAgents = useMemo(() => {
    const agentMap: Record<string, number> = {};
    fulfilledOrders.forEach(o => {
      if (o.agent_id) agentMap[o.agent_id] = (agentMap[o.agent_id] || 0) + (o.amount || 0);
    });
    return Object.entries(agentMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, revenue]) => ({
        id,
        revenue,
        name: agents.find(a => a.user_id === id)?.full_name || "Unknown",
        store: agents.find(a => a.user_id === id)?.store_name || "",
      }));
  }, [fulfilledOrders, agents]);

  const statCards = [
    { title: "Total Revenue", value: `GH₵ ${totalRevenue.toFixed(2)}`, icon: DollarSign, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
    { title: "Net Profit", value: `GH₵ ${totalProfit.toFixed(2)}`, icon: TrendingUp, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
    { title: "Total Orders", value: orders.length.toLocaleString(), icon: ShoppingCart, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
    { title: "Active Agents", value: activeAgents, icon: Users, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
    { title: "Top Network", value: topNetwork, icon: Smartphone, color: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500/20" },
    { title: "Fulfillment Rate", value: `${isFinite(fulfillmentRate) ? fulfillmentRate.toFixed(1) : 0}%`, icon: Target, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  ];

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <h1 className="font-display text-3xl font-black tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            Analytics
          </h1>
          <p className="text-sm text-white/50 mt-1">Revenue, profit, network performance, and top agents.</p>
        </div>
        <Button onClick={fetchData} disabled={loading} className="gap-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          <p className="text-white/50 text-sm">Loading analytics...</p>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            {statCards.map((card) => (
              <div key={card.title} className={`p-4 rounded-2xl bg-white/[0.02] border ${card.border} shadow-xl`}>
                <div className={`w-8 h-8 rounded-xl ${card.bg} flex items-center justify-center mb-3`}>
                  <card.icon className={`w-4 h-4 ${card.color}`} />
                </div>
                <p className={`font-display text-xl font-black ${card.color}`}>{card.value}</p>
                <p className="text-xs text-white/40 mt-1">{card.title}</p>
              </div>
            ))}
          </div>

          {/* Revenue / Profit area chart */}
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
            <h3 className="font-bold text-white mb-1">Revenue & Profit — Last 14 Days</h3>
            <p className="text-xs text-white/40 mb-6">Daily breakdown of fulfilled order revenue and platform profit.</p>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={dailyData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend formatter={(v) => <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{v}</span>} />
                <Area type="monotone" dataKey="Revenue" stroke="#22c55e" strokeWidth={2} fill="url(#colorRevenue)" dot={false} />
                <Area type="monotone" dataKey="Profit" stroke="#f59e0b" strokeWidth={2} fill="url(#colorProfit)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Orders by network bar chart */}
            <div className="lg:col-span-2 rounded-2xl bg-white/[0.02] border border-white/5 p-6">
              <h3 className="font-bold text-white mb-1">Orders by Network</h3>
              <p className="text-xs text-white/40 mb-6">Volume of fulfilled orders per telecom network.</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={networkPieData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" name="Orders" radius={[6, 6, 0, 0]}>
                    {networkPieData.map((entry) => (
                      <Cell key={entry.name} fill={NETWORK_COLORS[entry.name] || "#6366f1"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Network revenue breakdown */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
              <h3 className="font-bold text-white mb-1">Network Revenue</h3>
              <p className="text-xs text-white/40 mb-4">Revenue share per network.</p>
              <div className="space-y-4 mt-2">
                {networkPieData.length === 0 ? (
                  <p className="text-white/30 text-sm text-center py-8">No data yet</p>
                ) : networkPieData.map((net) => {
                  const pct = totalRevenue > 0 ? ((net.revenue / totalRevenue) * 100) : 0;
                  return (
                    <div key={net.name}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: NETWORK_COLORS[net.name] || "#6366f1" }} />
                          <span className="text-sm font-semibold text-white/80">{net.name}</span>
                        </div>
                        <span className="text-xs text-white/50 font-mono">GH₵{net.revenue.toFixed(2)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: NETWORK_COLORS[net.name] || "#6366f1" }}
                        />
                      </div>
                      <p className="text-[10px] text-white/30 mt-1">{net.value} orders • {pct.toFixed(1)}%</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Top agents */}
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
            <h3 className="font-bold text-white mb-1">Top 5 Agents by Revenue</h3>
            <p className="text-xs text-white/40 mb-5">Agents generating the highest sales volume on the platform.</p>
            {topAgents.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <BarChart3 className="w-8 h-8 text-white/20 mb-3" />
                <p className="text-white/40 text-sm">No fulfilled agent orders yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {topAgents.map((agent, idx) => {
                  const pct = topAgents[0].revenue > 0 ? ((agent.revenue / topAgents[0].revenue) * 100) : 0;
                  return (
                    <div key={agent.id} className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${idx === 0 ? "bg-amber-400/20 text-amber-400" : "bg-white/5 text-white/50"}`}>
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white truncate">{agent.name}</p>
                        <p className="text-[10px] text-white/40 truncate">{agent.store}</p>
                        <div className="mt-1.5 h-1 rounded-full bg-white/5 overflow-hidden">
                          <div className="h-full rounded-full bg-amber-400/60" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-black text-amber-400">GH₵{agent.revenue.toFixed(2)}</p>
                        <Badge variant="outline" className="text-[9px] border-white/10 text-white/40 mt-0.5">
                          {fulfilledOrders.filter(o => o.agent_id === agent.id).length} orders
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AdminAnalytics;
