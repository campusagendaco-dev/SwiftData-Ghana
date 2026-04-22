import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Loader2, TrendingUp, Users, DollarSign,
  Users2, Search, ChevronDown, ChevronUp, ArrowUpRight,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface OrderRow {
  id: string;
  agent_id: string;
  amount: number;
  profit: number;
  parent_profit: number;
  parent_agent_id: string | null;
  status: string;
  network: string | null;
  package_size: string | null;
  customer_phone: string | null;
  created_at: string;
  is_sub_agent_order?: boolean;
}

interface Profile {
  user_id: string;
  full_name: string;
  email: string;
  store_name: string;
  is_sub_agent: boolean;
  agent_approved: boolean;
  sub_agent_approved: boolean;
  parent_agent_id: string | null;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0d0d18] border border-white/10 rounded-xl p-3 shadow-xl text-xs">
      <p className="text-white/60 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="font-bold">
          {p.name}: GH₵{Number(p.value).toFixed(2)}
        </p>
      ))}
    </div>
  );
};

const AdminProfits = () => {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [search, setSearch] = useState("");
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<"7" | "30" | "90" | "all">("30");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [ordersRes, profilesRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id, agent_id, amount, profit, parent_profit, parent_agent_id, status, network, package_size, customer_phone, created_at")
        .eq("status", "fulfilled")
        .order("created_at", { ascending: false }),
      supabase
        .from("profiles")
        .select("user_id, full_name, email, store_name, is_sub_agent, agent_approved, sub_agent_approved, parent_agent_id")
        .or("agent_approved.eq.true,sub_agent_approved.eq.true"),
    ]);
    setOrders((ordersRes.data ?? []) as OrderRow[]);
    setProfiles((profilesRes.data ?? []) as Profile[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filter by date range
  const filteredOrders = useMemo(() => {
    if (dateRange === "all") return orders;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(dateRange));
    return orders.filter(o => new Date(o.created_at) >= cutoff);
  }, [orders, dateRange]);

  // Platform totals
  const totalRevenue = useMemo(() => filteredOrders.reduce((s, o) => s + Number(o.amount), 0), [filteredOrders]);
  const totalAgentProfit = useMemo(() => filteredOrders.reduce((s, o) => s + Number(o.profit || 0), 0), [filteredOrders]);
  const totalParentProfit = useMemo(() => filteredOrders.reduce((s, o) => s + Number(o.parent_profit || 0), 0), [filteredOrders]);
  const totalAllAgentProfits = totalAgentProfit + totalParentProfit;

  // Build profile map
  const profileMap = useMemo(() => {
    const m: Record<string, Profile> = {};
    profiles.forEach(p => { m[p.user_id] = p; });
    return m;
  }, [profiles]);

  // Per-agent profit breakdown
  const agentProfits = useMemo(() => {
    const map: Record<string, { directProfit: number; subAgentProfit: number; orderCount: number; subAgentOrderCount: number }> = {};
    filteredOrders.forEach(o => {
      // Direct agent profit
      if (o.agent_id && !profileMap[o.agent_id]?.is_sub_agent) {
        if (!map[o.agent_id]) map[o.agent_id] = { directProfit: 0, subAgentProfit: 0, orderCount: 0, subAgentOrderCount: 0 };
        map[o.agent_id].directProfit += Number(o.profit || 0);
        map[o.agent_id].orderCount++;
      }
      // Parent agent profit from sub-agent orders
      if (o.parent_agent_id && Number(o.parent_profit) > 0) {
        if (!map[o.parent_agent_id]) map[o.parent_agent_id] = { directProfit: 0, subAgentProfit: 0, orderCount: 0, subAgentOrderCount: 0 };
        map[o.parent_agent_id].subAgentProfit += Number(o.parent_profit);
        map[o.parent_agent_id].subAgentOrderCount++;
      }
    });
    return Object.entries(map)
      .map(([id, data]) => ({
        id,
        ...data,
        totalProfit: data.directProfit + data.subAgentProfit,
        name: profileMap[id]?.full_name || "Unknown",
        email: profileMap[id]?.email || "",
        store: profileMap[id]?.store_name || "",
      }))
      .sort((a, b) => b.totalProfit - a.totalProfit);
  }, [filteredOrders, profileMap]);

  // Sub-agent profit breakdown
  const subAgentProfits = useMemo(() => {
    const map: Record<string, { profit: number; orderCount: number; parentId: string | null }> = {};
    filteredOrders.forEach(o => {
      if (o.agent_id && profileMap[o.agent_id]?.is_sub_agent) {
        if (!map[o.agent_id]) map[o.agent_id] = { profit: Number(o.profit || 0), orderCount: 0, parentId: profileMap[o.agent_id]?.parent_agent_id ?? null };
        else map[o.agent_id].profit += Number(o.profit || 0);
        map[o.agent_id].orderCount++;
      }
    });
    return Object.entries(map)
      .map(([id, data]) => ({
        id,
        ...data,
        name: profileMap[id]?.full_name || "Unknown",
        email: profileMap[id]?.email || "",
        parentName: data.parentId ? (profileMap[data.parentId]?.full_name || "Unknown") : "—",
      }))
      .sort((a, b) => b.profit - a.profit);
  }, [filteredOrders, profileMap]);

  // Daily chart data (last 14 days always for chart)
  const dailyData = useMemo(() => {
    const days: Record<string, { date: string; "Agent Profits": number; "Sub-Agent Profits": number }> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days[key] = { date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), "Agent Profits": 0, "Sub-Agent Profits": 0 };
    }
    filteredOrders.forEach(o => {
      const key = o.created_at.slice(0, 10);
      if (!days[key]) return;
      days[key]["Agent Profits"] += Number(o.profit || 0);
      days[key]["Sub-Agent Profits"] += Number(o.parent_profit || 0);
    });
    return Object.values(days);
  }, [filteredOrders]);

  const filteredAgents = agentProfits.filter(a =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.email.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-3">
      <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
      <span className="text-white/50 text-sm">Loading profit data...</span>
    </div>
  );

  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <h1 className="font-display text-3xl font-black tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            Profits & Earnings
          </h1>
          <p className="text-sm text-white/50 mt-1">Full profit breakdown — agents, sub-agents, and platform revenue.</p>
        </div>
        <div className="flex items-center gap-2">
          {(["7", "30", "90", "all"] as const).map(r => (
            <button key={r} onClick={() => setDateRange(r)}
              className={`px-3 py-1.5 text-xs rounded-lg font-bold transition-all ${dateRange === r ? "bg-amber-400 text-black" : "bg-white/5 text-white/40 hover:text-white"}`}>
              {r === "all" ? "All Time" : `${r}d`}
            </button>
          ))}
          <Button onClick={fetchData} variant="outline" size="sm" className="gap-2 border-white/10 text-white/60 hover:text-white ml-2">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Revenue", value: `GH₵${totalRevenue.toFixed(2)}`, icon: DollarSign, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
          { label: "All Agent Profits", value: `GH₵${totalAllAgentProfits.toFixed(2)}`, icon: TrendingUp, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
          { label: "From Direct Sales", value: `GH₵${totalAgentProfit.toFixed(2)}`, icon: Users, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
          { label: "From Sub-Agents", value: `GH₵${totalParentProfit.toFixed(2)}`, icon: Users2, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
        ].map(({ label, value, icon: Icon, color, bg, border }) => (
          <div key={label} className={`p-5 rounded-2xl bg-white/[0.02] border ${border} shadow-xl relative overflow-hidden`}>
            <div className={`absolute top-0 right-0 w-20 h-20 ${bg} blur-2xl -mr-8 -mt-8 rounded-full`} />
            <div className={`w-8 h-8 rounded-xl ${bg} ${border} border flex items-center justify-center mb-3 relative z-10`}>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <p className={`font-display text-2xl font-black ${color} relative z-10`}>{value}</p>
            <p className="text-xs text-white/40 mt-1 relative z-10">{label}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
        <h3 className="font-bold text-white mb-1">Daily Profit Breakdown — Last 14 Days</h3>
        <p className="text-xs text-white/40 mb-5">Agent direct profits vs. sub-agent margin profits, per day.</p>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={dailyData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="gAgent" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gSub" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend formatter={(v) => <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{v}</span>} />
            <Area type="monotone" dataKey="Agent Profits" stroke="#f59e0b" strokeWidth={2} fill="url(#gAgent)" dot={false} />
            <Area type="monotone" dataKey="Sub-Agent Profits" stroke="#a855f7" strokeWidth={2} fill="url(#gSub)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Agent leaderboard */}
      <div className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
        <div className="p-5 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-white">Agent Profit Leaderboard</h3>
            <p className="text-xs text-white/40 mt-0.5">Click any agent to see their individual sub-agent breakdown.</p>
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
            <Input placeholder="Search agents..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-8 bg-white/5 border-white/10 text-sm h-8" />
          </div>
        </div>

        {filteredAgents.length === 0 ? (
          <div className="py-16 text-center text-white/30 text-sm">No agent profit data found.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {filteredAgents.map((agent, idx) => {
              const isExpanded = expandedAgent === agent.id;
              const subAgentRows = subAgentProfits.filter(sa => sa.parentId === agent.id);
              const pct = filteredAgents[0].totalProfit > 0 ? (agent.totalProfit / filteredAgents[0].totalProfit) * 100 : 0;

              return (
                <div key={agent.id}>
                  <button
                    onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                    className="w-full flex items-center gap-4 p-4 hover:bg-white/3 transition-colors text-left"
                  >
                    {/* Rank */}
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${idx === 0 ? "bg-amber-400/20 text-amber-400" : idx === 1 ? "bg-white/10 text-white/60" : "bg-white/5 text-white/30"}`}>
                      {idx + 1}
                    </span>

                    {/* Name + progress */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{agent.name}</p>
                      <p className="text-[10px] text-white/30 truncate">{agent.email}</p>
                      <div className="mt-1.5 h-1 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-amber-400/50" style={{ width: `${pct}%` }} />
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="text-right shrink-0 hidden sm:block">
                      <div className="flex gap-4 items-end justify-end">
                        <div>
                          <p className="text-[10px] text-white/30">Direct</p>
                          <p className="text-xs font-bold text-blue-400">GH₵{agent.directProfit.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-white/30">Sub-Agent</p>
                          <p className="text-xs font-bold text-purple-400">GH₵{agent.subAgentProfit.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-white/30">Total</p>
                          <p className="text-sm font-black text-amber-400">GH₵{agent.totalProfit.toFixed(2)}</p>
                        </div>
                      </div>
                      <p className="text-[10px] text-white/20 mt-1">{agent.orderCount} orders • {agent.subAgentOrderCount} sub-agent</p>
                    </div>
                    {/* Mobile total */}
                    <div className="sm:hidden text-right shrink-0">
                      <p className="text-sm font-black text-amber-400">GH₵{agent.totalProfit.toFixed(2)}</p>
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-white/30 shrink-0" /> : <ChevronDown className="w-4 h-4 text-white/30 shrink-0" />}
                  </button>

                  {/* Sub-agent breakdown */}
                  {isExpanded && (
                    <div className="bg-black/20 border-t border-white/5 px-4 pb-4 pt-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-3">Sub-Agents under {agent.name}</p>
                      {subAgentRows.length === 0 ? (
                        <p className="text-xs text-white/20 italic">No sub-agents with profits yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {subAgentRows.map(sa => (
                            <div key={sa.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-white/3 border border-white/5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-white/70 truncate">{sa.name}</p>
                                  <p className="text-[10px] text-white/30 truncate">{sa.email}</p>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-xs font-bold text-purple-400">GH₵{sa.profit.toFixed(2)}</p>
                                <p className="text-[10px] text-white/20">{sa.orderCount} orders</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sub-agent profit table */}
      <div className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
        <div className="p-5 border-b border-white/5">
          <h3 className="font-bold text-white">Sub-Agent Individual Profits</h3>
          <p className="text-xs text-white/40 mt-0.5">Every sub-agent's own earnings and the parent agent they belong to.</p>
        </div>
        {subAgentProfits.length === 0 ? (
          <div className="py-12 text-center text-white/30 text-sm">No sub-agent orders yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-white/3">
                  {["Sub-Agent", "Parent Agent", "Orders", "Profit"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white/30">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {subAgentProfits.map(sa => (
                  <tr key={sa.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-xs font-semibold text-white/80">{sa.name}</p>
                      <p className="text-[10px] text-white/30">{sa.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="border-amber-500/20 text-amber-400 text-[10px]">{sa.parentName}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-white/50">{sa.orderCount}</td>
                    <td className="px-4 py-3 text-xs font-black text-purple-400">GH₵{sa.profit.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminProfits;
