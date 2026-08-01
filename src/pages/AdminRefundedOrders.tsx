import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw, RotateCcw, Wallet, Search, Check, Copy, Download, ShieldCheck, Users, Filter, Calendar, ExternalLink, Eye, AlertTriangle, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppTheme } from "@/contexts/ThemeContext";

interface AdminRefundedOrder {
  id: string;
  agent_id: string;
  order_type: string;
  customer_phone: string | null;
  network: string | null;
  package_size: string | null;
  amount: number;
  refund_amount: number | null;
  refund_reason: string | null;
  refunded_at: string | null;
  failure_reason: string | null;
  status: string;
  auto_refunded: boolean;
  payment_method: string | null;
  created_at: string;
  agent_email?: string;
  agent_name?: string;
  store_name?: string;
}

function fmt(dateStr: string) {
  const d = new Date(dateStr);
  return {
    date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
}

export default function AdminRefundedOrders() {
  const { isDark } = useAppTheme();
  const [orders, setOrders] = useState<AdminRefundedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [orderTypeFilter, setOrderTypeFilter] = useState("all");
  const [networkFilter, setNetworkFilter] = useState("all");
  const [dateRangeFilter, setDateRangeFilter] = useState("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<AdminRefundedOrder | null>(null);

  const fetchRefundedOrders = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch orders with refunded status or auto_refunded = true
      let q = supabase
        .from("orders")
        .select("id, agent_id, order_type, customer_phone, network, package_size, amount, refund_amount, refund_reason, refunded_at, failure_reason, status, auto_refunded, payment_method, created_at")
        .or("status.eq.refunded,auto_refunded.eq.true")
        .order("created_at", { ascending: false })
        .limit(300);

      if (dateRangeFilter === "today") {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        q = q.gte("created_at", todayStart.toISOString());
      } else if (dateRangeFilter === "7days") {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        q = q.gte("created_at", d.toISOString());
      } else if (dateRangeFilter === "30days") {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        q = q.gte("created_at", d.toISOString());
      }

      const { data: rawOrders, error } = await q;

      if (error) {
        console.error("Error fetching admin refunded orders:", error);
      } else if (rawOrders && rawOrders.length > 0) {
        // Fetch profile info for unique agent_ids
        const agentIds = Array.from(new Set(rawOrders.map(o => o.agent_id).filter(Boolean)));
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name, email, store_name")
          .in("user_id", agentIds);

        const profileMap = new Map<string, { full_name?: string; email?: string; store_name?: string }>();
        (profiles || []).forEach(p => {
          profileMap.set(p.user_id, p);
        });

        const enriched = rawOrders.map(o => {
          const prof = profileMap.get(o.agent_id);
          return {
            ...o,
            agent_email: prof?.email || "Unknown User",
            agent_name: prof?.full_name || prof?.email?.split("@")[0] || "Agent",
            store_name: prof?.store_name || undefined,
          };
        });

        setOrders(enriched);
      } else {
        setOrders([]);
      }
    } catch (err) {
      console.error("Fetch exception:", err);
    } finally {
      setLoading(false);
    }
  }, [dateRangeFilter]);

  useEffect(() => {
    fetchRefundedOrders();
  }, [fetchRefundedOrders]);

  // Real-time subscription for live refunds
  useEffect(() => {
    const channel = supabase
      .channel("admin-refunds-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        (payload: any) => {
          const updated = payload.new;
          if (updated?.status === "refunded" || updated?.auto_refunded) {
            fetchRefundedOrders();
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchRefundedOrders]);

  const copyOrderId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredOrders = orders.filter((o) => {
    if (orderTypeFilter !== "all" && o.order_type !== orderTypeFilter) return false;
    if (networkFilter !== "all" && (o.network || "").toUpperCase() !== networkFilter.toUpperCase()) return false;

    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      o.id.toLowerCase().includes(q) ||
      (o.customer_phone && o.customer_phone.toLowerCase().includes(q)) ||
      (o.agent_email && o.agent_email.toLowerCase().includes(q)) ||
      (o.agent_name && o.agent_name.toLowerCase().includes(q)) ||
      (o.store_name && o.store_name.toLowerCase().includes(q)) ||
      (o.network && o.network.toLowerCase().includes(q)) ||
      (o.package_size && o.package_size.toLowerCase().includes(q)) ||
      (o.failure_reason && o.failure_reason.toLowerCase().includes(q))
    );
  });

  const totalRefundedAmount = orders.reduce((sum, o) => sum + Number(o.refund_amount || o.amount || 0), 0);
  const totalCount = orders.length;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayOrders = orders.filter(o => new Date(o.created_at) >= todayStart);
  const todayRefundedAmount = todayOrders.reduce((sum, o) => sum + Number(o.refund_amount || o.amount || 0), 0);

  const uniqueAgentsCount = new Set(orders.map(o => o.agent_id)).size;

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className={cn("font-display text-2xl sm:text-3xl font-bold flex items-center gap-2.5", isDark ? "text-white" : "text-gray-900")}>
            <RotateCcw className="w-7 h-7 text-purple-500" /> Platform Refunded Orders
          </h1>
          <p className={cn("text-sm mt-1", isDark ? "text-muted-foreground" : "text-gray-600")}>
            Real-time master ledger of all auto-refunded and wallet-returned orders across all agents.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2 h-9 border-purple-500/30 hover:bg-purple-500/10 text-purple-600 dark:text-purple-400" onClick={fetchRefundedOrders} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh Table
        </Button>
      </div>

      {/* Analytics KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={cn("p-5 rounded-2xl border transition-all", isDark ? "bg-card/60 border-purple-500/20 shadow-lg shadow-purple-950/10" : "bg-white border-purple-100 shadow-sm")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Refunded Volume</span>
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-purple-600 dark:text-purple-400">
            GH₵ {totalRefundedAmount.toFixed(2)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{totalCount} total refunded transactions</p>
        </div>

        <div className={cn("p-5 rounded-2xl border transition-all", isDark ? "bg-card/60 border-border shadow-lg" : "bg-white border-gray-200 shadow-sm")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today's Refunds</span>
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
              <Calendar className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight">
            GH₵ {todayRefundedAmount.toFixed(2)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{todayOrders.length} orders refunded today</p>
        </div>

        <div className={cn("p-5 rounded-2xl border transition-all", isDark ? "bg-card/60 border-border shadow-lg" : "bg-white border-gray-200 shadow-sm")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unique Agents</span>
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight">
            {uniqueAgentsCount}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Distinct reseller accounts</p>
        </div>

        <div className={cn("p-5 rounded-2xl border transition-all", isDark ? "bg-card/60 border-emerald-500/20 shadow-lg shadow-emerald-950/10" : "bg-white border-emerald-100 shadow-sm")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sentinel Guard</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-lg font-bold text-emerald-600 dark:text-emerald-400">
            Active Protection
          </div>
          <p className="text-xs text-muted-foreground mt-1">Wallet-only payment validation active</p>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search order ID, phone, agent email, reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 text-sm bg-background border-border"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Order Type Filter */}
          <Select value={orderTypeFilter} onValueChange={setOrderTypeFilter}>
            <SelectTrigger className="w-36 h-10 text-xs">
              <SelectValue placeholder="Order Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="data">Data</SelectItem>
              <SelectItem value="airtime">Airtime</SelectItem>
              <SelectItem value="utility">Utility</SelectItem>
              <SelectItem value="afa">AFA</SelectItem>
              <SelectItem value="api">API</SelectItem>
            </SelectContent>
          </Select>

          {/* Network Filter */}
          <Select value={networkFilter} onValueChange={setNetworkFilter}>
            <SelectTrigger className="w-32 h-10 text-xs">
              <SelectValue placeholder="Network" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Networks</SelectItem>
              <SelectItem value="MTN">MTN</SelectItem>
              <SelectItem value="Telecel">Telecel</SelectItem>
              <SelectItem value="AirtelTigo">AirtelTigo</SelectItem>
            </SelectContent>
          </Select>

          {/* Date Range Filter */}
          <Select value={dateRangeFilter} onValueChange={setDateRangeFilter}>
            <SelectTrigger className="w-36 h-10 text-xs">
              <SelectValue placeholder="Date Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today Only</SelectItem>
              <SelectItem value="7days">Last 7 Days</SelectItem>
              <SelectItem value="30days">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Main Refunds Table */}
      <div className={cn("rounded-2xl border overflow-hidden transition-all", isDark ? "bg-card/60 border-border" : "bg-white border-gray-200 shadow-sm")}>
        {loading ? (
          <div className="p-8 space-y-4">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-purple-500/10 text-purple-500 flex items-center justify-center mx-auto">
              <RotateCcw className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold">No Refunded Orders Match</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {search || orderTypeFilter !== "all" || networkFilter !== "all" ? "No records matched your search filters." : "No refunded orders found in the selected timeframe."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className={cn("border-b text-xs font-semibold uppercase tracking-wider", isDark ? "bg-muted/30 border-border text-muted-foreground" : "bg-gray-50 border-gray-100 text-gray-500")}>
                  <th className="py-3.5 px-4">Order & Date</th>
                  <th className="py-3.5 px-4">Agent / User</th>
                  <th className="py-3.5 px-4">Service & Phone</th>
                  <th className="py-3.5 px-4">Amount Refunded</th>
                  <th className="py-3.5 px-4">Status & Reason</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filteredOrders.map((o) => {
                  const { date, time } = fmt(o.refunded_at || o.created_at);
                  const amount = Number(o.refund_amount || o.amount || 0).toFixed(2);
                  return (
                    <tr key={o.id} className={cn("transition-colors hover:bg-muted/20", isDark ? "" : "hover:bg-gray-50/80")}>
                      {/* ID & Date */}
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-bold text-xs uppercase flex items-center gap-1.5">
                          {o.id.slice(0, 8)}
                          <button onClick={() => copyOrderId(o.id)} className="text-muted-foreground hover:text-foreground">
                            {copiedId === o.id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{date} at {time}</div>
                      </td>

                      {/* Agent Details */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-xs text-foreground">{o.agent_name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono truncate max-w-[160px]">{o.agent_email}</div>
                        {o.store_name && <div className="text-[10px] text-purple-500 font-medium">Store: {o.store_name}</div>}
                      </td>

                      {/* Service & Phone */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-xs">
                          {o.network || o.order_type.toUpperCase()} — {o.package_size || "Standard"}
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground">{o.customer_phone || "—"}</div>
                      </td>

                      {/* Amount Refunded */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-purple-600 dark:text-purple-400 text-sm">
                          +GH₵ {amount}
                        </div>
                        <div className="text-[10px] text-muted-foreground">Credited to Wallet</div>
                      </td>

                      {/* Status & Reason */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/15 border border-purple-500/30 text-purple-600 dark:text-purple-400 mb-1">
                          <RotateCcw className="w-2.5 h-2.5" /> Refunded
                        </span>
                        <div className="text-[11px] text-muted-foreground truncate" title={o.failure_reason || o.refund_reason || "Auto-refund"}>
                          {o.failure_reason || o.refund_reason || "Fulfillment failed"}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => setSelectedOrder(o)}>
                          <Eye className="w-3.5 h-3.5" /> Details
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Order Details Modal */}
      <Dialog open={!!selectedOrder} onOpenChange={(op) => !op && setSelectedOrder(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <RotateCcw className="w-5 h-5 text-purple-500" /> Refunded Order Details
            </DialogTitle>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4 text-sm pt-2">
              <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-muted/40 border border-border">
                <div>
                  <div className="text-xs text-muted-foreground uppercase font-semibold">Order ID</div>
                  <div className="font-mono font-bold text-xs mt-0.5">{selectedOrder.id}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase font-semibold">Refund Amount</div>
                  <div className="font-bold text-purple-600 dark:text-purple-400 text-sm mt-0.5">GH₵ {Number(selectedOrder.refund_amount || selectedOrder.amount).toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase font-semibold">Agent Email</div>
                  <div className="text-xs font-mono truncate">{selectedOrder.agent_email}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase font-semibold">Recipient Phone</div>
                  <div className="text-xs font-mono font-bold">{selectedOrder.customer_phone || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase font-semibold">Network & Package</div>
                  <div className="text-xs font-medium">{selectedOrder.network} {selectedOrder.package_size}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase font-semibold">Payment Method</div>
                  <div className="text-xs font-bold uppercase">{selectedOrder.payment_method || "wallet"}</div>
                </div>
              </div>

              <div className="space-y-1.5 p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300">
                <div className="text-xs font-bold flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-purple-500" /> Failure & Refund Log
                </div>
                <p className="text-xs font-mono break-words leading-relaxed">
                  {selectedOrder.failure_reason || selectedOrder.refund_reason || "Auto-refund executed."}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => copyOrderId(selectedOrder.id)}>
                  <Copy className="w-3.5 h-3.5 mr-1" /> Copy Order ID
                </Button>
                <Button variant="default" size="sm" onClick={() => setSelectedOrder(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
