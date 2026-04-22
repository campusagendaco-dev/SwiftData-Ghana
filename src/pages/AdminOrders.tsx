import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search, RotateCcw, Loader2, RefreshCw,
  TrendingUp, ShoppingCart, AlertTriangle, Clock,
  ChevronDown, Filter,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";

interface OrderRow {
  id: string;
  order_type: string;
  network: string | null;
  package_size: string | null;
  customer_phone: string | null;
  amount: number;
  profit: number;
  parent_profit: number;
  parent_agent_id: string | null;
  status: string;
  failure_reason: string | null;
  created_at: string;
  agent_id: string;
  agent_name?: string;
  agent_email?: string;
  is_sub_agent?: boolean;
}

interface AgentProfile {
  user_id: string;
  full_name: string;
  email: string;
  is_sub_agent: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  paid: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  fulfilled: "bg-green-500/20 text-green-400 border-green-500/30",
  fulfillment_failed: "bg-red-500/20 text-red-400 border-red-500/30",
};

type FilterType = "all" | "agents" | "sub_agents";

const AdminOrders = () => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, AgentProfile>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [networkFilter, setNetworkFilter] = useState("all");

  const fetchOrders = useCallback(async () => {
    setLoading(true);

    // Fetch orders and profiles in parallel
    const [ordersRes, profilesRes] = await Promise.all([
      supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase
        .from("profiles")
        .select("user_id, full_name, email, is_sub_agent")
        .or("agent_approved.eq.true,sub_agent_approved.eq.true"),
    ]);

    // Build profile lookup map
    const profileMap: Record<string, AgentProfile> = {};
    for (const p of (profilesRes.data ?? [])) {
      profileMap[p.user_id] = p as AgentProfile;
    }
    setProfiles(profileMap);

    // Enrich orders with agent names
    const enriched = (ordersRes.data ?? []).map((o: any) => ({
      ...o,
      agent_name: profileMap[o.agent_id]?.full_name || "Unknown",
      agent_email: profileMap[o.agent_id]?.email || "",
      is_sub_agent: profileMap[o.agent_id]?.is_sub_agent ?? false,
    }));

    setOrders(enriched as OrderRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handleRetry = async (orderId: string) => {
    setRetrying(orderId);
    try {
      const { data, error } = await invokePublicFunctionAsUser("verify-payment", {
        body: { reference: orderId },
      });
      if (error) {
        const description = await getFunctionErrorMessage(error, "Could not retry this order.");
        toast({ title: "Retry failed", description, variant: "destructive" });
      } else if (data?.status === "fulfilled") {
        toast({ title: "Order fulfilled successfully!" });
      } else {
        toast({
          title: "Retry completed",
          description: data?.failure_reason || `Status: ${data?.status}`,
          variant: data?.status === "fulfilled" ? "default" : "destructive",
        });
      }
      await fetchOrders();
    } catch {
      toast({ title: "Retry error", description: "Could not retry order.", variant: "destructive" });
    }
    setRetrying(null);
  };

  // Apply filters
  const filtered = orders.filter((o) => {
    if (typeFilter === "agents" && o.is_sub_agent) return false;
    if (typeFilter === "sub_agents" && !o.is_sub_agent) return false;
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (networkFilter !== "all" && o.network !== networkFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return [o.id, o.customer_phone, o.network, o.status, o.agent_name, o.agent_email, o.package_size]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    }
    return true;
  });

  // Stats
  const totalRevenue = orders.reduce((s, o) => s + Number(o.amount || 0), 0);
  const totalParentProfit = orders.reduce((s, o) => s + Number(o.parent_profit || 0), 0);
  const failed = orders.filter((o) => o.status === "fulfillment_failed").length;
  const pending = orders.filter((o) => o.status === "pending" || o.status === "paid").length;
  const subAgentOrders = orders.filter((o) => o.is_sub_agent).length;

  const uniqueNetworks = [...new Set(orders.map((o) => o.network).filter(Boolean))] as string[];

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
    </div>
  );

  return (
    <div className="space-y-6 pb-10">
      {/* Phone tracker */}
      <PhoneOrderTracker
        title="Track Customer Order by Phone"
        subtitle="Admin quick lookup for live delivery status and bundle size."
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">All Orders</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Full transaction history — agents and sub-agents</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2 self-start" onClick={fetchOrders}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Orders", value: orders.length, icon: ShoppingCart, color: "text-blue-400" },
          { label: "Revenue", value: `GH₵${totalRevenue.toFixed(2)}`, icon: TrendingUp, color: "text-emerald-400" },
          { label: "Agent Profits", value: `GH₵${totalParentProfit.toFixed(2)}`, icon: TrendingUp, color: "text-amber-400" },
          { label: "Sub-Agent Orders", value: subAgentOrders, icon: ShoppingCart, color: "text-purple-400" },
          { label: "Pending / Failed", value: `${pending} / ${failed}`, icon: failed > 0 ? AlertTriangle : Clock, color: failed > 0 ? "text-red-400" : "text-yellow-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-white/3 border-white/8">
            <CardContent className="p-3 flex items-center gap-2">
              <Icon className={`w-6 h-6 ${color} shrink-0 opacity-70`} />
              <div className="min-w-0">
                <p className="text-base font-black text-white truncate">{value}</p>
                <p className="text-[10px] text-white/40 truncate">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <Input
            placeholder="Search orders, agents, phones..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white/5 border-white/10 text-sm"
          />
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-1">
          {(["all", "agents", "sub_agents"] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setTypeFilter(f)}
              className={`px-3 py-1 text-xs rounded-md font-semibold transition-all ${typeFilter === f ? "bg-amber-400 text-black" : "text-white/40 hover:text-white"}`}
            >
              {f === "all" ? "All" : f === "agents" ? "Agents" : "Sub-Agents"}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white/70 outline-none"
        >
          <option value="all">All Statuses</option>
          <option value="fulfilled">Fulfilled</option>
          <option value="paid">Paid (pending)</option>
          <option value="fulfillment_failed">Failed</option>
          <option value="pending">Pending</option>
        </select>

        {/* Network filter */}
        <select
          value={networkFilter}
          onChange={(e) => setNetworkFilter(e.target.value)}
          className="text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white/70 outline-none"
        >
          <option value="all">All Networks</option>
          {uniqueNetworks.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>

        <span className="text-xs text-white/30 ml-auto">{filtered.length} results</span>
      </div>

      {/* Orders table */}
      <div className="rounded-xl border border-white/8 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 bg-white/3">
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white/30">Date</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white/30">Agent</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white/30">Type</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white/30 hidden sm:table-cell">Phone</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white/30 hidden md:table-cell">Network</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white/30 hidden md:table-cell">Package</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white/30">Amount</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white/30 hidden lg:table-cell">Agent Profit</th>
                <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white/30">Status</th>
                <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white/30">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map((order) => (
                <tr key={order.id} className="hover:bg-white/3 transition-colors group">
                  <td className="px-4 py-3 text-white/40 text-xs whitespace-nowrap">
                    {new Date(order.created_at).toLocaleDateString("en-GH", { day: "2-digit", month: "short" })}
                    <span className="block text-white/25 text-[10px]">
                      {new Date(order.created_at).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs font-semibold text-white/80 truncate max-w-[120px]">{order.agent_name}</p>
                    <p className="text-[10px] text-white/30 truncate max-w-[120px]">{order.agent_email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${order.is_sub_agent ? "border-purple-500/30 text-purple-400 bg-purple-500/10" : "border-amber-500/30 text-amber-400 bg-amber-500/10"}`}>
                      {order.is_sub_agent ? "Sub-Agent" : "Agent"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-white/50 hidden sm:table-cell">{order.customer_phone || "—"}</td>
                  <td className="px-4 py-3 text-xs text-white/60 hidden md:table-cell">{order.network || "—"}</td>
                  <td className="px-4 py-3 text-xs text-white/60 hidden md:table-cell">{order.package_size || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-bold text-white">GH₵{Number(order.amount).toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-3 text-right hidden lg:table-cell">
                    {Number(order.parent_profit) > 0 ? (
                      <span className="text-xs font-bold text-emerald-400">+GH₵{Number(order.parent_profit).toFixed(2)}</span>
                    ) : (
                      <span className="text-xs text-white/20">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge className={`text-[10px] border ${STATUS_COLORS[order.status] || "bg-white/10 text-white/40 border-white/10"}`}>
                      {order.status.replace(/_/g, " ")}
                    </Badge>
                    {order.failure_reason && (
                      <p className="text-[10px] text-red-400 mt-0.5 max-w-[120px] truncate mx-auto" title={order.failure_reason}>
                        {order.failure_reason}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {(order.status === "pending" || order.status === "fulfillment_failed" || order.status === "paid") && (
                      <Button
                        size="sm" variant="outline"
                        className="text-xs gap-1 h-7 px-2 border-white/10 hover:border-amber-400/30"
                        disabled={retrying === order.id}
                        onClick={() => handleRetry(order.id)}
                      >
                        {retrying === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                        Retry
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-16 text-center">
            <ShoppingCart className="w-10 h-10 text-white/10 mx-auto mb-3" />
            <p className="text-white/40 text-sm">No orders match your filters.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminOrders;
