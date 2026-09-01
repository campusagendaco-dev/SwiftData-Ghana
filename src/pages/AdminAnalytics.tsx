import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BarChart3, TrendingUp, Users, Smartphone, Loader2, RefreshCw, DollarSign, ShoppingCart, Target, Award, Sparkles, Activity } from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppTheme } from "@/contexts/ThemeContext";
import { CardTilt } from "@/components/ui/CardTilt";
import { cn } from "@/lib/utils";

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
  MTN: "#f59e0b",
  Telecel: "#ef4444",
  AirtelTigo: "#ec4899",
};

const CustomTooltip = ({ active, payload, label, isDark }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className={`border rounded-2xl p-4 shadow-2xl text-xs backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-200 ${isDark ? "bg-slate-950/95 border-white/15 text-white" : "bg-white/95 border-slate-200 text-slate-900"}`}>
      <p className={`mb-2 font-black tracking-wider uppercase text-[10px] ${isDark ? "text-slate-400" : "text-slate-500"}`}>{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-6 py-0.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color, boxShadow: `0 0 8px ${p.color}` }} />
            <span className={`font-extrabold text-[10px] uppercase tracking-wider ${isDark ? "text-slate-300" : "text-slate-700"}`}>{p.name}</span>
          </div>
          <span style={{ color: p.color }} className="font-mono font-black">
            {p.name === "Revenue" || p.name === "Profit" ? `GH₵ ${Number(p.value).toFixed(2)}` : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

const AdminAnalytics = () => {
  const { isDark } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [daysFilter, setDaysFilter] = useState<number>(30);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);

  const isMounted = useRef(true);
  
  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  const fetchData = async () => {
    setLoading(true);
    
    let allOrders: OrderRecord[] = [];
    let from = 0;
    let hasMore = true;

    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - daysFilter);
    const dateLimit = limitDate.toISOString();

    while (hasMore && isMounted.current) {
      const { data, error } = await supabase
        .from("orders")
        .select("id, profit, network, agent_id, amount, status, created_at")
        .gte("created_at", dateLimit)
        .order("created_at", { ascending: false })
        .range(from, from + 999);
      
      if (error || !data || data.length === 0) {
        hasMore = false;
      } else {
        allOrders = [...allOrders, ...data as OrderRecord[]];
        from += 1000;
        if (data.length < 1000) hasMore = false;
      }
    }

    if (!isMounted.current) return;

    const { data: agentsData } = await supabase
      .from("profiles")
      .select("user_id, full_name, store_name")
      .eq("is_agent", true)
      .eq("agent_approved", true);

    setOrders(allOrders);
    setAgents((agentsData as AgentRecord[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [daysFilter]);

  const fulfilledOrders = useMemo(() => orders.filter(o => o.status === "fulfilled"), [orders]);

  const totalRevenue = useMemo(() => fulfilledOrders.reduce((s, o) => s + (o.amount || 0), 0), [fulfilledOrders]);
  const totalProfit = useMemo(() => fulfilledOrders.reduce((s, o) => s + (Number(o.profit) || 0), 0), [fulfilledOrders]);
  const activeAgents = useMemo(() => {
    const ids = new Set(fulfilledOrders.map(o => o.agent_id).filter(Boolean));
    return ids.size;
  }, [fulfilledOrders]);
  const fulfillmentRate = orders.length > 0
    ? ((fulfilledOrders.length / orders.filter(o => o.status !== "pending").length) * 100)
    : 0;

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

  const dailyData = useMemo(() => {
    const days: Record<string, { date: string; Revenue: number; Profit: number; Orders: number }> = {};
    const now = new Date();
    const count = Math.min(daysFilter, 30);
    for (let i = count - 1; i >= 0; i--) {
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
  }, [fulfilledOrders, daysFilter]);

  const networkPieData = useMemo(() =>
    Object.entries(networkCounts).map(([name, val]) => ({ name, value: val.orders, revenue: val.revenue })),
    [networkCounts]
  );

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
        name: agents.find(a => a.user_id === id)?.full_name || "Unknown Agent",
        store: agents.find(a => a.user_id === id)?.store_name || "",
      }));
  }, [fulfilledOrders, agents]);

  const statCards = [
    { title: "Total Revenue", value: `GH₵ ${totalRevenue.toFixed(2)}`, icon: DollarSign, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
    { title: "Net Profit", value: `GH₵ ${totalProfit.toFixed(2)}`, icon: TrendingUp, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
    { title: "Total Orders", value: orders.length.toLocaleString(), icon: ShoppingCart, color: "text-sky-400", bg: "bg-sky-500/10 border-sky-500/30" },
    { title: "Active Agents", value: activeAgents, icon: Users, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/30" },
    { title: "Top Carrier", value: topNetwork, icon: Smartphone, color: "text-pink-400", bg: "bg-pink-500/10 border-pink-500/30" },
    { title: "Fulfillment Rate", value: `${isFinite(fulfillmentRate) ? fulfillmentRate.toFixed(1) : 0}%`, icon: Target, color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/30" },
  ];

  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const tickColor = isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.5)";

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header ── */}
      <div className="glass-card-neo p-5 sm:p-6 rounded-3xl border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5" /> Intelligence Center
            </span>
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px] font-mono uppercase">
              Last {daysFilter} Days
            </Badge>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">Platform Sales Intelligence</h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-background/60 p-1 rounded-xl border border-border">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDaysFilter(d)}
                className={`px-3 py-1 text-[10px] font-black uppercase rounded-lg transition-all ${
                  daysFilter === d
                    ? "bg-amber-400 text-black shadow-md"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {d}D
              </button>
            ))}
          </div>

          <Button
            onClick={fetchData}
            disabled={loading}
            variant="outline"
            className="h-9 px-4 rounded-xl border-border bg-background/80 font-bold text-xs uppercase tracking-wider gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[350px] gap-4">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest animate-pulse">Calculating sales metrics...</p>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {statCards.map((card) => (
              <CardTilt key={card.title} className="rounded-2xl w-full">
                <div className={cn("glass-card-neo p-4 rounded-2xl border flex flex-col justify-between gap-3 h-full", card.bg)}>
                  <div className="w-8 h-8 rounded-xl bg-background/50 border border-white/10 flex items-center justify-center">
                    <card.icon className={cn("w-4 h-4", card.color)} />
                  </div>
                  <div>
                    <p className={cn("font-mono font-black text-lg sm:text-xl", card.color)}>{card.value}</p>
                    <p className="text-[11px] font-bold text-muted-foreground mt-0.5">{card.title}</p>
                  </div>
                </div>
              </CardTilt>
            ))}
          </div>

          {/* Revenue & Profit Area Chart */}
          <div className="glass-card-neo p-6 rounded-3xl border border-white/10 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-black text-lg text-foreground">Revenue & Net Profit Trend</h3>
                <p className="text-xs text-muted-foreground">Daily breakdown of fulfilled order revenue vs platform margin over the last 14 days.</p>
              </div>

              <div className="flex items-center gap-4 text-xs font-bold">
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-emerald-500" /><span className="text-muted-foreground">Revenue</span></div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-amber-500" /><span className="text-muted-foreground">Net Profit</span></div>
              </div>
            </div>

            <div className="h-[280px] w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="date" tick={{ fill: tickColor, fontSize: 11, fontWeight: "bold" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: tickColor, fontSize: 11, fontWeight: "bold" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip isDark={isDark} />} />
                  <Area type="monotone" dataKey="Revenue" stroke="#10b981" strokeWidth={3} fill="url(#colorRevenue)" dot={false} />
                  <Area type="monotone" dataKey="Profit" stroke="#f59e0b" strokeWidth={3} fill="url(#colorProfit)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Orders by network bar chart */}
            <div className="lg:col-span-2 glass-card-neo p-6 rounded-3xl border border-white/10 space-y-4">
              <div>
                <h3 className="font-black text-base text-foreground">Carrier Order Volume</h3>
                <p className="text-xs text-muted-foreground">Fulfilled volume distribution across telecom networks.</p>
              </div>

              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={networkPieData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="name" tick={{ fill: tickColor, fontSize: 12, fontWeight: "bold" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: tickColor, fontSize: 11, fontWeight: "bold" }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip isDark={isDark} />} />
                    <Bar dataKey="value" name="Orders" radius={[8, 8, 0, 0]}>
                      {networkPieData.map((entry) => (
                        <Cell key={entry.name} fill={NETWORK_COLORS[entry.name] || "#6366f1"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Network revenue share */}
            <div className="glass-card-neo p-6 rounded-3xl border border-white/10 space-y-4">
              <div>
                <h3 className="font-black text-base text-foreground">Revenue Share</h3>
                <p className="text-xs text-muted-foreground">Revenue percentage per carrier.</p>
              </div>

              <div className="space-y-4 pt-2">
                {networkPieData.length === 0 ? (
                  <p className="text-xs text-center py-8 text-muted-foreground">No network sales yet</p>
                ) : networkPieData.map((net) => {
                  const pct = totalRevenue > 0 ? ((net.revenue / totalRevenue) * 100) : 0;
                  return (
                    <div key={net.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: NETWORK_COLORS[net.name] || "#6366f1" }} />
                          <span className="font-extrabold text-foreground">{net.name}</span>
                        </div>
                        <span className="font-mono font-black text-amber-400">GH₵ {net.revenue.toFixed(2)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-background/50 overflow-hidden border border-white/10">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: NETWORK_COLORS[net.name] || "#6366f1" }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                        <span>{net.value} orders</span>
                        <span>{pct.toFixed(1)}% share</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Top 5 Agents */}
          <div className="glass-card-neo p-6 rounded-3xl border border-white/10 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-black text-base text-foreground flex items-center gap-2">
                  <Award className="w-5 h-5 text-amber-400" /> Top 5 Reseller Agents
                </h3>
                <p className="text-xs text-muted-foreground">Highest grossing agents on the platform.</p>
              </div>
              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px] uppercase font-mono">
                Top Performers
              </Badge>
            </div>

            {topAgents.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <Users className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">No fulfilled agent sales recorded yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {topAgents.map((agent, idx) => {
                  const pct = topAgents[0].revenue > 0 ? ((agent.revenue / topAgents[0].revenue) * 100) : 0;
                  return (
                    <div key={agent.id} className="p-4 rounded-2xl border border-border bg-background/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 font-mono font-black text-sm flex items-center justify-center shrink-0">
                          #{idx + 1}
                        </span>
                        <div>
                          <p className="text-xs font-black text-foreground">{agent.name}</p>
                          <p className="text-[10px] text-muted-foreground">{agent.store || "No store name"}</p>
                          <div className="w-36 h-1.5 rounded-full bg-background/80 overflow-hidden mt-1.5 border border-white/10">
                            <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4">
                        <div className="text-left sm:text-right">
                          <p className="text-sm font-black font-mono text-emerald-400">GH₵ {agent.revenue.toFixed(2)}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {fulfilledOrders.filter(o => o.agent_id === agent.id).length} fulfilled orders
                          </p>
                        </div>
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
