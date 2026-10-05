import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeSearchTerm } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search, RotateCcw, Loader2, RefreshCw,
  TrendingUp, ShoppingCart, AlertTriangle, Clock,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  CheckCircle2, PlayCircle, Download,
  Phone, Coins, MoreHorizontal, Bot, MessageSquare,
  ExternalLink, Eye, ArrowUpRight, Copy, Check, Filter, Sparkles
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/utils/auditLogger";
import { useAppTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

interface BotOrderRow {
  id: string;
  order_type: string;
  network: string | null;
  package_size: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  amount: number;
  profit: number;
  parent_profit: number;
  parent_agent_id: string | null;
  paystack_verified_amount: number | null;
  paystack_fee: number | null;
  cost_price: number | null;
  status: string;
  failure_reason: string | null;
  created_at: string;
  agent_id: string | null;
  channel: string | null;
  metadata: any;
  agent_name?: string;
  agent_slug?: string;
  agent_code?: string;
  wa_from?: string;
}

const PAGE_SIZE = 25;

export default function AdminBotOrders() {
  const { user } = useAuth();
  const { isDark } = useAppTheme();
  const { toast } = useToast();

  const [orders, setOrders] = useState<BotOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [networkFilter, setNetworkFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [attributionFilter, setAttributionFilter] = useState("all"); // all | direct | agent
  const [dateFilter, setDateFilter] = useState("all"); // all | today | yesterday | week | month

  // Modal / Detail state
  const [activeModalOrder, setActiveModalOrder] = useState<BotOrderRow | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<string | null>(null);

  // Aggregated Stats
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalVolume: 0,
    totalProfit: 0,
    agentProfit: 0,
    successCount: 0,
    failedCount: 0,
    pendingCount: 0,
  });

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Copied to clipboard!" });
  };

  // Fetch KPI Stats for Bot Orders
  const fetchStats = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("amount, profit, parent_profit, status, channel, metadata")
        .or("channel.eq.whatsapp,channel.eq.whatsapp_agent,metadata->>channel.eq.whatsapp,metadata->>wa_from.neq.null");

      if (error || !data) return;

      let volume = 0;
      let profit = 0;
      let agentProf = 0;
      let success = 0;
      let failed = 0;
      let pending = 0;

      data.forEach((o: any) => {
        const amt = Number(o.amount || 0);
        const prof = Number(o.profit || 0);
        const parentProf = Number(o.parent_profit || 0);

        volume += amt;
        profit += prof;
        agentProf += parentProf;

        if (o.status === "fulfilled" || o.status === "completed") success++;
        else if (o.status === "failed" || o.status === "cancelled" || o.status === "refunded") failed++;
        else pending++;
      });

      setStats({
        totalOrders: data.length,
        totalVolume: volume,
        totalProfit: profit,
        agentProfit: agentProf,
        successCount: success,
        failedCount: failed,
        pendingCount: pending,
      });
    } catch (e) {
      console.error("[AdminBotOrders] Stats fetch error:", e);
    }
  }, []);

  // Fetch paginated bot orders
  const fetchOrders = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);

    try {
      const fromIdx = (page - 1) * PAGE_SIZE;
      const toIdx = fromIdx + PAGE_SIZE - 1;

      let q = supabase
        .from("orders")
        .select("*", { count: "estimated" })
        .or("channel.eq.whatsapp,channel.eq.whatsapp_agent,metadata->>channel.eq.whatsapp,metadata->>wa_from.neq.null")
        .order("created_at", { ascending: false })
        .range(fromIdx, toIdx);

      // Status
      if (statusFilter !== "all") {
        q = q.eq("status", statusFilter);
      }

      // Network
      if (networkFilter !== "all") {
        q = q.ilike("network", `%${networkFilter}%`);
      }

      // Order Type
      if (typeFilter !== "all") {
        q = q.eq("order_type", typeFilter);
      }

      // Attribution
      if (attributionFilter === "direct") {
        q = q.is("agent_id", null);
      } else if (attributionFilter === "agent") {
        q = q.not("agent_id", "is", null);
      }

      // Date Range
      if (dateFilter !== "all") {
        const now = new Date();
        if (dateFilter === "today") {
          now.setHours(0, 0, 0, 0);
          q = q.gte("created_at", now.toISOString());
        } else if (dateFilter === "yesterday") {
          const yStart = new Date(now);
          yStart.setDate(now.getDate() - 1);
          yStart.setHours(0, 0, 0, 0);
          const yEnd = new Date(now);
          yEnd.setDate(now.getDate() - 1);
          yEnd.setHours(23, 59, 59, 999);
          q = q.gte("created_at", yStart.toISOString()).lte("created_at", yEnd.toISOString());
        } else if (dateFilter === "week") {
          const wStart = new Date(now);
          wStart.setDate(now.getDate() - 7);
          q = q.gte("created_at", wStart.toISOString());
        } else if (dateFilter === "month") {
          const mStart = new Date(now);
          mStart.setDate(now.getDate() - 30);
          q = q.gte("created_at", mStart.toISOString());
        }
      }

      // Search Filter
      if (search.trim()) {
        const clean = sanitizeSearchTerm(search);
        q = q.or(
          `customer_phone.ilike.%${clean}%,network.ilike.%${clean}%,package_size.ilike.%${clean}%,id.ilike.%${clean}%`
        );
      }

      const { data, count, error } = await q;

      if (error) {
        toast({ title: "Failed to fetch bot orders", description: error.message, variant: "destructive" });
        if (!isSilent) setLoading(false);
        return;
      }

      setTotalCount(count || 0);

      // Hydrate Agent details for matched orders
      const rawRows = (data || []) as BotOrderRow[];
      const agentIds = Array.from(new Set(rawRows.map(r => r.agent_id).filter(Boolean))) as string[];

      let agentMap: Record<string, { name: string; slug: string; code: string }> = {};
      if (agentIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, store_name, full_name, slug, referral_code")
          .in("user_id", agentIds);

        (profiles || []).forEach((p: any) => {
          agentMap[p.user_id] = {
            name: p.store_name || p.full_name || "Agent Store",
            slug: p.slug || "",
            code: (p.referral_code || p.slug || "").toUpperCase(),
          };
        });
      }

      const hydrated: BotOrderRow[] = rawRows.map(r => {
        const meta = r.metadata || {};
        const agentInfo = r.agent_id ? agentMap[r.agent_id] : null;
        return {
          ...r,
          agent_name: agentInfo?.name || (r.agent_id ? "Unknown Agent" : "Direct SwiftData Bot"),
          agent_slug: agentInfo?.slug || "",
          agent_code: agentInfo?.code || "",
          wa_from: meta.wa_from || meta.agent_phone || null,
        };
      });

      setOrders(hydrated);
    } catch (err: any) {
      console.error("[AdminBotOrders] Error:", err);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [page, statusFilter, networkFilter, typeFilter, attributionFilter, dateFilter, search, toast]);

  useEffect(() => {
    fetchOrders();
    fetchStats();
  }, [fetchOrders, fetchStats]);

  // Real-time listener for incoming WhatsApp bot orders
  useEffect(() => {
    const channel = supabase
      .channel("admin-bot-orders-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => {
          fetchOrders(true);
          fetchStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOrders, fetchStats]);

  // Status badge helper
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "fulfilled":
      case "completed":
        return <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">Fulfilled</Badge>;
      case "processing":
      case "in_progress":
        return <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 animate-pulse">Processing</Badge>;
      case "pending":
      case "pending_payment":
        return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">Pending</Badge>;
      case "failed":
      case "cancelled":
        return <Badge className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">Failed</Badge>;
      case "refunded":
        return <Badge className="bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30">Refunded</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Status update
  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    setIsUpdatingStatus(orderId);
    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", orderId);

      if (error) throw error;

      if (user) {
        await logAudit(user.id, "bot_order_status_update", { order_id: orderId, new_status: newStatus });
      }

      toast({ title: "Order Updated", description: `Order status set to ${newStatus}` });
      fetchOrders(true);
      fetchStats();
      if (activeModalOrder && activeModalOrder.id === orderId) {
        setActiveModalOrder(prev => prev ? { ...prev, status: newStatus } : null);
      }
    } catch (e: any) {
      toast({ title: "Update Failed", description: e.message, variant: "destructive" });
    } finally {
      setIsUpdatingStatus(null);
    }
  };

  // CSV Export
  const exportToCSV = () => {
    if (orders.length === 0) {
      toast({ title: "No orders to export", variant: "destructive" });
      return;
    }

    const headers = [
      "Order ID", "Date", "Channel", "Type", "Network", "Package",
      "Customer Phone", "WhatsApp Number", "Amount (GHS)", "Profit (GHS)",
      "Agent Name", "Agent Code", "Status"
    ];

    const rows = orders.map(o => [
      o.id,
      new Date(o.created_at).toLocaleString(),
      o.channel || "whatsapp",
      o.order_type,
      o.network || "N/A",
      o.package_size || "N/A",
      o.customer_phone || "N/A",
      o.wa_from || "N/A",
      o.amount.toFixed(2),
      o.profit.toFixed(2),
      `"${o.agent_name || "Direct"}"`,
      o.agent_code || "DIRECT",
      o.status
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `whatsapp_bot_orders_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "CSV Exported successfully!" });
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
  const successRate = stats.totalOrders > 0 ? ((stats.successCount / stats.totalOrders) * 100).toFixed(1) : "100";

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto animate-in fade-in duration-500">
      
      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-green-500/20 text-white">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h1 className={cn("text-2xl md:text-3xl font-black tracking-tight", isDark ? "text-white" : "text-gray-900")}>
                WhatsApp Bot Orders & Purchases
              </h1>
              <p className={cn("text-xs md:text-sm mt-0.5", isDark ? "text-white/50" : "text-gray-500")}>
                Real-time monitor of WhatsApp conversational sales, carrier dispatches & agent profit attributions.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { fetchOrders(); fetchStats(); }}
            disabled={loading}
            className="rounded-xl border-dashed h-9"
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", loading && "animate-spin")} />
            Refresh
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={exportToCSV}
            className="rounded-xl h-9 font-semibold"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Export CSV
          </Button>

          <Button
            size="sm"
            onClick={() => window.open("https://wa.me/233548942122", "_blank")}
            className="rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold h-9 shadow-md shadow-green-600/20"
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Test Bot (+233548942122)
          </Button>
        </div>
      </div>

      {/* ── KPI Metrics Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <Card className={cn("border rounded-2xl overflow-hidden", isDark ? "bg-white/[0.02] border-white/8" : "bg-white border-gray-100 shadow-sm")}>
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Total Bot Orders</span>
              <ShoppingCart className="w-4 h-4 text-blue-500" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black">{stats.totalOrders}</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">Automated bot purchases</p>
            </div>
          </CardContent>
        </Card>

        <Card className={cn("border rounded-2xl overflow-hidden", isDark ? "bg-white/[0.02] border-white/8" : "bg-white border-gray-100 shadow-sm")}>
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Bot Gross Sales</span>
              <Coins className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">GH₵ {stats.totalVolume.toFixed(2)}</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">Paid via MoMo / Paystack</p>
            </div>
          </CardContent>
        </Card>

        <Card className={cn("border rounded-2xl overflow-hidden", isDark ? "bg-white/[0.02] border-white/8" : "bg-white border-gray-100 shadow-sm")}>
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Platform Margin</span>
              <TrendingUp className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400">GH₵ {stats.totalProfit.toFixed(2)}</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">Platform net earnings</p>
            </div>
          </CardContent>
        </Card>

        <Card className={cn("border rounded-2xl overflow-hidden", isDark ? "bg-white/[0.02] border-white/8" : "bg-white border-gray-100 shadow-sm")}>
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Agent Commissions</span>
              <Sparkles className="w-4 h-4 text-amber-500" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black text-amber-600 dark:text-amber-400">GH₵ {stats.agentProfit.toFixed(2)}</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">Credited to reseller wallets</p>
            </div>
          </CardContent>
        </Card>

        <Card className={cn("border rounded-2xl overflow-hidden col-span-2 lg:col-span-1", isDark ? "bg-white/[0.02] border-white/8" : "bg-white border-gray-100 shadow-sm")}>
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
              <span>Fulfillment Rate</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-black">{successRate}%</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">{stats.successCount} fulfilled / {stats.failedCount} failed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Search & Filter Controls ── */}
      <Card className={cn("border rounded-2xl p-4", isDark ? "bg-white/[0.02] border-white/8" : "bg-white border-gray-100 shadow-sm")}>
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
          
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by Order ID, Phone, Network, or Package..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 rounded-xl h-10 bg-transparent"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className={cn("h-10 px-3 rounded-xl border text-xs font-semibold outline-none", isDark ? "bg-zinc-900 border-white/10" : "bg-gray-50 border-gray-200")}
          >
            <option value="all">All Statuses</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="processing">Processing</option>
            <option value="pending">Pending Payment</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </select>

          {/* Network Filter */}
          <select
            value={networkFilter}
            onChange={(e) => { setNetworkFilter(e.target.value); setPage(1); }}
            className={cn("h-10 px-3 rounded-xl border text-xs font-semibold outline-none", isDark ? "bg-zinc-900 border-white/10" : "bg-gray-50 border-gray-200")}
          >
            <option value="all">All Networks</option>
            <option value="MTN">MTN</option>
            <option value="Telecel">Telecel</option>
            <option value="AirtelTigo">AirtelTigo</option>
          </select>

          {/* Order Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className={cn("h-10 px-3 rounded-xl border text-xs font-semibold outline-none", isDark ? "bg-zinc-900 border-white/10" : "bg-gray-50 border-gray-200")}
          >
            <option value="all">All Services</option>
            <option value="data">Data Bundle</option>
            <option value="airtime">Airtime</option>
            <option value="utility">Utility</option>
            <option value="afa">AFA</option>
          </select>

          {/* Attribution Filter */}
          <select
            value={attributionFilter}
            onChange={(e) => { setAttributionFilter(e.target.value); setPage(1); }}
            className={cn("h-10 px-3 rounded-xl border text-xs font-semibold outline-none", isDark ? "bg-zinc-900 border-white/10" : "bg-gray-50 border-gray-200")}
          >
            <option value="all">All Sources</option>
            <option value="direct">Direct Platform Bot</option>
            <option value="agent">Agent Store Bot</option>
          </select>

          {/* Date Filter */}
          <select
            value={dateFilter}
            onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
            className={cn("h-10 px-3 rounded-xl border text-xs font-semibold outline-none", isDark ? "bg-zinc-900 border-white/10" : "bg-gray-50 border-gray-200")}
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">Past 7 Days</option>
            <option value="month">Past 30 Days</option>
          </select>
        </div>
      </Card>

      {/* ── Orders Table ── */}
      <Card className={cn("border rounded-2xl overflow-hidden", isDark ? "bg-white/[0.02] border-white/8" : "bg-white border-gray-100 shadow-sm")}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={cn("border-b text-[11px] font-bold uppercase tracking-wider", isDark ? "bg-white/[0.02] border-white/8 text-white/50" : "bg-gray-50 border-gray-200 text-gray-500")}>
              <tr>
                <th className="py-3 px-4">Order ID & Date</th>
                <th className="py-3 px-4">Service & Network</th>
                <th className="py-3 px-4">Customer WhatsApp / Recipient</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Store Attribution</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-green-500" />
                    Loading WhatsApp bot orders...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    <Bot className="w-8 h-8 opacity-30 mx-auto mb-2 text-green-500" />
                    No WhatsApp bot orders found matching your filters.
                  </td>
                </tr>
              ) : (
                orders.map((o) => {
                  const recipient = o.customer_phone || "N/A";
                  const waNumber = o.wa_from || o.metadata?.wa_from || recipient;
                  const shortId = o.id.slice(0, 8);

                  return (
                    <tr
                      key={o.id}
                      className={cn(
                        "transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]",
                        activeModalOrder?.id === o.id && "bg-green-500/5"
                      )}
                    >
                      {/* Order ID & Date */}
                      <td className="py-3 px-4 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-gray-900 dark:text-white">#{shortId}</span>
                          <button
                            type="button"
                            onClick={() => handleCopy(o.id, `id-${o.id}`)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            {copiedId === `id-${o.id}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                        <span className="text-[10px] text-muted-foreground block mt-0.5">
                          {new Date(o.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </td>

                      {/* Service & Network */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                          <span>{o.network || "Data"}</span>
                          {o.package_size && (
                            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-foreground">
                              {o.package_size}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground capitalize">
                          {o.order_type}
                        </span>
                      </td>

                      {/* Recipient & WhatsApp */}
                      <td className="py-3 px-4 font-mono">
                        <div className="flex items-center gap-1 text-gray-900 dark:text-white">
                          <Phone className="w-3 h-3 text-muted-foreground" />
                          <span>{recipient}</span>
                        </div>
                        {waNumber && waNumber !== recipient && (
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MessageSquare className="w-2.5 h-2.5 text-green-500" />
                            <span>WA: {waNumber}</span>
                          </div>
                        )}
                      </td>

                      {/* Amount & Profits */}
                      <td className="py-3 px-4">
                        <span className="font-bold text-gray-900 dark:text-white">
                          GH₵ {Number(o.amount || 0).toFixed(2)}
                        </span>
                        {o.profit > 0 && (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block font-mono">
                            +GH₵ {Number(o.profit).toFixed(2)} profit
                          </span>
                        )}
                      </td>

                      {/* Attribution */}
                      <td className="py-3 px-4">
                        {o.agent_id ? (
                          <div>
                            <span className="font-bold text-amber-600 dark:text-amber-400 block truncate max-w-[140px]">
                              {o.agent_name}
                            </span>
                            {o.agent_code && (
                              <span className="text-[10px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1 py-0.5 rounded">
                                {o.agent_code}
                              </span>
                            )}
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground border-dashed">
                            Direct Bot
                          </Badge>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        {getStatusBadge(o.status)}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48 rounded-xl text-xs">
                            <DropdownMenuItem onClick={() => setActiveModalOrder(o)}>
                              <Eye className="w-3.5 h-3.5 mr-2" />
                              View Order Payload
                            </DropdownMenuItem>

                            {waNumber && (
                              <DropdownMenuItem
                                onClick={() => window.open(`https://wa.me/${waNumber.replace(/\D/g, "")}`, "_blank")}
                              >
                                <MessageSquare className="w-3.5 h-3.5 mr-2 text-green-500" />
                                Chat with Customer
                              </DropdownMenuItem>
                            )}

                            <DropdownMenuSeparator />

                            <DropdownMenuItem
                              onClick={() => handleUpdateStatus(o.id, "fulfilled")}
                              disabled={isUpdatingStatus === o.id || o.status === "fulfilled"}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 mr-2 text-emerald-500" />
                              Mark Fulfilled
                            </DropdownMenuItem>

                            <DropdownMenuItem
                              onClick={() => handleUpdateStatus(o.id, "processing")}
                              disabled={isUpdatingStatus === o.id || o.status === "processing"}
                            >
                              <PlayCircle className="w-3.5 h-3.5 mr-2 text-blue-500" />
                              Mark Processing
                            </DropdownMenuItem>

                            <DropdownMenuItem
                              onClick={() => handleUpdateStatus(o.id, "failed")}
                              disabled={isUpdatingStatus === o.id || o.status === "failed"}
                              className="text-rose-600 focus:text-rose-600"
                            >
                              <AlertTriangle className="w-3.5 h-3.5 mr-2" />
                              Mark Failed
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        <div className="p-4 border-t flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>
            Showing {orders.length} of {totalCount} orders (Page {page} of {totalPages})
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(1)}
              disabled={page <= 1 || loading}
              className="h-8 w-8 p-0 rounded-lg"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="h-8 w-8 p-0 rounded-lg"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>

            <span className="px-2 font-semibold">
              {page} / {totalPages}
            </span>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="h-8 w-8 p-0 rounded-lg"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages || loading}
              className="h-8 w-8 p-0 rounded-lg"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Order Detail & Raw JSON Modal ── */}
      <Dialog open={Boolean(activeModalOrder)} onOpenChange={(open) => !open && setActiveModalOrder(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl">
          {activeModalOrder && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-lg font-black">
                  <Bot className="w-5 h-5 text-green-500" />
                  Bot Order #{activeModalOrder.id.slice(0, 8)}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Created on {new Date(activeModalOrder.created_at).toLocaleString()} via WhatsApp Bot channel.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 text-xs mt-2">
                {/* Highlights grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 border">
                  <div>
                    <span className="text-[10px] text-muted-foreground uppercase font-bold block">Status</span>
                    {getStatusBadge(activeModalOrder.status)}
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground uppercase font-bold block">Total Amount</span>
                    <span className="font-bold text-sm text-foreground">GH₵ {activeModalOrder.amount.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground uppercase font-bold block">Network / Size</span>
                    <span className="font-bold text-foreground">{activeModalOrder.network} ({activeModalOrder.package_size || "N/A"})</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground uppercase font-bold block">Agent Code</span>
                    <span className="font-bold text-amber-500">{activeModalOrder.agent_code || "DIRECT"}</span>
                  </div>
                </div>

                {/* Customer Info */}
                <div className="p-3 rounded-xl border space-y-1.5">
                  <span className="font-bold text-[11px] block uppercase tracking-wider text-muted-foreground">Recipient & Contact Details</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Recipient Number: </span>
                      <span className="font-mono font-bold">{activeModalOrder.customer_phone}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">WhatsApp Sender Phone: </span>
                      <span className="font-mono font-bold">{activeModalOrder.wa_from || "N/A"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Store Name: </span>
                      <span className="font-bold">{activeModalOrder.agent_name}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Profit Earned: </span>
                      <span className="font-bold text-emerald-500">GH₵ {activeModalOrder.profit.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Raw JSON Payload */}
                <div>
                  <span className="font-bold text-[11px] block uppercase tracking-wider text-muted-foreground mb-1.5">Metadata & Gateway Payload</span>
                  <pre className="p-3 rounded-xl bg-zinc-950 text-emerald-400 font-mono text-[11px] overflow-x-auto max-h-52 border border-zinc-800">
                    {JSON.stringify(activeModalOrder.metadata, null, 2)}
                  </pre>
                </div>

                {/* Actions inside modal */}
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t">
                  {activeModalOrder.wa_from && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(`https://wa.me/${activeModalOrder.wa_from?.replace(/\D/g, "")}`, "_blank")}
                      className="rounded-xl h-8 text-xs font-bold"
                    >
                      <MessageSquare className="w-3.5 h-3.5 mr-1.5 text-green-500" />
                      Chat on WhatsApp
                    </Button>
                  )}

                  <Button
                    size="sm"
                    onClick={() => handleUpdateStatus(activeModalOrder.id, "fulfilled")}
                    disabled={activeModalOrder.status === "fulfilled" || isUpdatingStatus === activeModalOrder.id}
                    className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs font-bold"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                    Mark Fulfilled
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
