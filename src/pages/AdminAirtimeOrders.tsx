import { useEffect, useState, useCallback } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search, RotateCcw, Loader2, RefreshCw,
  TrendingUp, ShoppingCart, AlertTriangle, Clock,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  CheckCircle2, PlayCircle, UserCheck, Download,
  Phone, Coins, ShieldAlert, MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { logAudit } from "@/utils/auditLogger";
import { useAuth } from "@/hooks/useAuth";

interface OrderRow {
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
  agent_id: string;
  agent_name?: string;
  agent_email?: string;
  is_sub_agent?: boolean;
  metadata?: any;
  auto_refunded?: boolean;
  refund_amount?: number;
  refund_reason?: string;
}

interface AgentProfile {
  user_id: string;
  full_name: string;
  email: string;
  is_sub_agent: boolean;
  wallet_balance?: number;
}

const STATUS_COLORS: Record<string, string> = {
  awaiting_payment: "bg-yellow-500/10 text-yellow-500/80 border-yellow-500/20",
  pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  paid: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  processing: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  fulfilled: "bg-green-500/20 text-green-400 border-green-500/30",
  fulfillment_failed: "bg-red-500/20 text-red-400 border-red-500/30",
};

type FilterType = "all" | "agents" | "sub_agents";

const PAGE_SIZE = 50;

const AdminAirtimeOrders = () => {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [allOrders, setAllOrders] = useState<OrderRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, AgentProfile>>({});
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("agent") || "";
  const [search, setSearch] = useState(initialSearch);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [forcingFulfill, setForcingFulfill] = useState(false);
  const [healingProcessing, setHealingProcessing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [providers, setProviders] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkUpdating, setBulkUpdating] = useState(false);

  useEffect(() => {
    const fetchProviders = async () => {
      const { data } = await supabase.from("providers").select("*");
      setProviders(data || []);
    };
    fetchProviders();
  }, []);

  const allApisOff = providers.length === 0 || providers.every(p => !p.is_active);

  // Reset to page 1 when any filter changes
  useEffect(() => { setPage(1); }, [search, typeFilter, statusFilter]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = supabase
      .from("orders")
      .select("*", { count: "estimated" })
      .eq("order_type", "airtime")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (search) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search.trim());
      if (isUuid) {
        q = q.or(`id.eq.${search.trim()},agent_id.eq.${search.trim()}`);
      } else {
        const { data: matchedProfiles } = await supabase
          .from("profiles")
          .select("user_id")
          .or(`full_name.ilike.%${search.trim()}%,email.ilike.%${search.trim()}%,phone.ilike.%${search.trim()}%`);

        const matchedUserIds = matchedProfiles?.map((p: any) => p.user_id) || [];
        
        let orString = `customer_phone.ilike.%${search}%,customer_name.ilike.%${search}%,status.ilike.%${search}%,network.ilike.%${search}%`;
        if (matchedUserIds.length > 0) {
          matchedUserIds.forEach(id => {
            orString += `,agent_id.eq.${id}`;
          });
        }
        q = q.or(orString);
      }
    }

    if (statusFilter !== "all") q = q.eq("status", statusFilter);

    const { data, count, error } = await q;
    
    if (error) {
      toast({ title: "Failed to fetch orders", variant: "destructive" });
      setLoading(false);
      return;
    }

    setTotalCount(count || 0);

    const agentIds = [...new Set((data || []).map((o: any) => o.agent_id))];
    const profileMap: Record<string, AgentProfile> = { ...profiles };
    
    if (agentIds.length > 0) {
      const [profRes, walletRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, full_name, email, is_sub_agent")
          .in("user_id", agentIds),
        supabase
          .from("wallets")
          .select("agent_id, balance")
          .in("agent_id", agentIds)
      ]);

      const walletMap = new Map((walletRes.data || []).map((w: any) => [w.agent_id, w.balance]));
      
      (profRes.data || []).forEach(p => {
        profileMap[p.user_id] = {
          ...(p as any),
          wallet_balance: walletMap.get(p.user_id) ?? 0
        };
      });
      setProfiles(profileMap);
    }

    const enriched: OrderRow[] = (data || []).map((o: any) => {
      const profile = profileMap[o.agent_id];
      const isPlaceholder = o.agent_id === "00000000-0000-0000-0000-000000000000" || !o.agent_id;
      
      return {
        ...o,
        agent_name: profile?.full_name || (isPlaceholder ? (o.customer_name || "Guest (Direct Purchase)") : "Unknown Agent"),
        agent_email: profile?.email || "",
        is_sub_agent: profile?.is_sub_agent ?? false,
        metadata: { ...o.metadata, wallet_balance: profile?.wallet_balance }
      };
    });

    setAllOrders(enriched);
    setLoading(false);
  }, [page, search, statusFilter, toast]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useRealtimeRefresh({ tables: ["orders"], onRefresh: fetchOrders });

  const handleRetryOrder = async (orderId: string) => {
    if (!window.confirm("Are you sure you want to retry this order manually?")) return;
    setRetrying(orderId);
    try {
      const { data, error } = await supabase.functions.invoke("verify-payment", {
        body: { action: "retry_order", orderId },
      });
      const errMsg = getFunctionErrorMessage(data, error);
      if (errMsg) {
        toast({ title: "Retry failed", description: errMsg, variant: "destructive" });
      } else {
        toast({ title: "Order retried successfully!" });
        fetchOrders();
      }
    } catch (e: any) {
      toast({ title: "Network error", description: e.message, variant: "destructive" });
    } finally {
      setRetrying(null);
    }
  };

  const handleForceFulfill = async (orderId: string) => {
    if (!window.confirm("CRITICAL: This marks the order as fulfilled without hitting any provider gateway API. Verify that the customer has indeed received the airtime before continuing. Proceed?")) {
      return;
    }
    setForcingFulfill(true);
    try {
      const sessionRes = await supabase.auth.getSession();
      const session = sessionRes.data.session;
      if (!session) {
        toast({ title: "Unauthorized", description: "Log in again", variant: "destructive" });
        return;
      }

      const { data, error } = await supabase.functions.invoke("admin-user-actions", {
        body: { action: "force_fulfill_order", orderId },
        headers: { Authorization: `Bearer ${session.access_token}` }
      });

      const errMsg = getFunctionErrorMessage(data, error);
      if (errMsg) {
        toast({ title: "Action failed", description: errMsg, variant: "destructive" });
      } else {
        toast({ title: "Order force-fulfilled successfully!" });
        if (currentUser) {
          await logAudit(currentUser.id, "force_fulfill_order", { orderId, orderType: "airtime" });
        }
        fetchOrders();
      }
    } catch (e: any) {
      toast({ title: "Network error", description: e.message, variant: "destructive" });
    } finally {
      setForcingFulfill(false);
    }
  };

  const handleRefundOrder = async (orderId: string) => {
    const reason = window.prompt("Enter refund reason (will be logged in user transactions history):");
    if (reason === null) return; 
    if (!reason.trim()) {
      alert("Refund reason is mandatory.");
      return;
    }

    setRefunding(orderId);
    try {
      const sessionRes = await supabase.auth.getSession();
      const session = sessionRes.data.session;
      if (!session) {
        toast({ title: "Unauthorized", description: "Log in again", variant: "destructive" });
        return;
      }

      const { data, error } = await supabase.functions.invoke("admin-user-actions", {
        body: { action: "refund_order", orderId, reason: reason.trim() },
        headers: { Authorization: `Bearer ${session.access_token}` }
      });

      const errMsg = getFunctionErrorMessage(data, error);
      if (errMsg) {
        toast({ title: "Refund failed", description: errMsg, variant: "destructive" });
      } else {
        toast({ title: "Order refunded to wallet successfully!" });
        if (currentUser) {
          await logAudit(currentUser.id, "refund_order_to_wallet", { orderId, reason: reason.trim() });
        }
        fetchOrders();
      }
    } catch (e: any) {
      toast({ title: "Network error", description: e.message, variant: "destructive" });
    } finally {
      setRefunding(null);
    }
  };

  const handleRetryAllFailed = async () => {
    const failedOrders = allOrders.filter(o => o.status === "fulfillment_failed");
    if (failedOrders.length === 0) {
      toast({ title: "No failed orders", description: "No failed orders found in the current page view." });
      return;
    }

    if (!window.confirm(`Are you sure you want to retry all ${failedOrders.length} failed orders on this page?`)) return;

    setRetryingAll(true);
    let successCount = 0;
    let failCount = 0;

    for (const order of failedOrders) {
      try {
        const { data, error } = await supabase.functions.invoke("verify-payment", {
          body: { action: "retry_order", orderId: order.id },
        });
        if (!error && !data?.error) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
      }
    }

    toast({
      title: "Batch retry complete",
      description: `Successfully retried: ${successCount} orders. Failed: ${failCount} orders.`
    });
    fetchOrders();
    setRetryingAll(false);
  };

  const handleHealProcessingOrders = async () => {
    if (!window.confirm("This action heals stuck 'processing' or 'paid' orders older than 5 minutes by querying their status with their providers. Run scan?")) return;
    setHealingProcessing(true);
    try {
      const sessionRes = await supabase.auth.getSession();
      const session = sessionRes.data.session;
      if (!session) {
        toast({ title: "Unauthorized", description: "Log in again", variant: "destructive" });
        return;
      }

      const { data, error } = await supabase.functions.invoke("admin-user-actions", {
        body: { action: "heal_stuck_orders" },
        headers: { Authorization: `Bearer ${session.access_token}` }
      });

      const errMsg = getFunctionErrorMessage(data, error);
      if (errMsg) {
        toast({ title: "Scan failed", description: errMsg, variant: "destructive" });
      } else {
        toast({ title: "Stuck orders scan completed!", description: data?.message || "Check logs for detailed resolutions." });
        fetchOrders();
      }
    } catch (e: any) {
      toast({ title: "Network error", description: e.message, variant: "destructive" });
    } finally {
      setHealingProcessing(false);
    }
  };

  const handleBulkUpdateStatus = async () => {
    if (selectedIds.size === 0) {
      toast({ title: "No orders selected", description: "Select at least one order to update.", variant: "destructive" });
      return;
    }
    if (!bulkStatus) {
      toast({ title: "Select target status", description: "Please choose a status from the menu.", variant: "destructive" });
      return;
    }

    if (!window.confirm(`Are you sure you want to change the status of ${selectedIds.size} selected orders to '${bulkStatus}'?`)) {
      return;
    }

    setBulkUpdating(true);
    try {
      const sessionRes = await supabase.auth.getSession();
      const session = sessionRes.data.session;
      if (!session) return;

      const { data, error } = await supabase.functions.invoke("admin-user-actions", {
        body: {
          action: "bulk_update_order_status",
          orderIds: Array.from(selectedIds),
          status: bulkStatus
        },
        headers: { Authorization: `Bearer ${session.access_token}` }
      });

      const errMsg = getFunctionErrorMessage(data, error);
      if (errMsg) {
        toast({ title: "Bulk update failed", description: errMsg, variant: "destructive" });
      } else {
        toast({ title: "Bulk update completed!", description: `Successfully updated ${selectedIds.size} orders.` });
        if (currentUser) {
          await logAudit(currentUser.id, "bulk_update_order_status", { count: selectedIds.size, status: bulkStatus });
        }
        setSelectedIds(new Set());
        fetchOrders();
      }
    } catch (e: any) {
      toast({ title: "Network error", description: e.message, variant: "destructive" });
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleExportCsv = () => {
    try {
      const headers = [
        "Order ID", "Date", "Agent Name", "Agent Email", "Type",
        "Network", "Amount", "Cost Price", "Profit", "Recipient", "Status", "Failure Reason"
      ];
      const rows = allOrders.map(o => [
        o.id,
        new Date(o.created_at).toLocaleString(),
        o.agent_name || "Guest",
        o.agent_email || "",
        o.is_sub_agent ? "Sub-Agent" : "Agent",
        o.network || "Unknown",
        o.amount.toFixed(2),
        o.cost_price?.toFixed(2) || "0.00",
        o.profit.toFixed(2),
        o.customer_phone || "",
        o.status,
        o.failure_reason || ""
      ]);

      const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `airtime_orders_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({ title: "Export Success", description: "CSV exported successfully." });
    } catch (err: any) {
      toast({ title: "Export Failed", description: err.message, variant: "destructive" });
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === allOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allOrders.map(o => o.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

  // Filter orders by Agent type
  const displayedOrders = allOrders.filter(o => {
    if (typeFilter === "agents") return !o.is_sub_agent;
    if (typeFilter === "sub_agents") return o.is_sub_agent;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Phone className="w-6 h-6 text-amber-500" />
            Airtime Orders
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage all customer airtime top-up orders across networks.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetryAllFailed}
            disabled={retryingAll || loading}
            className="gap-1.5 border-amber-500/20 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20"
          >
            {retryingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            Retry Failed
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleHealProcessingOrders}
            disabled={healingProcessing || loading}
            className="gap-1.5 border-sky-500/20 text-sky-600 hover:bg-sky-500/10 dark:text-sky-400 dark:hover:bg-sky-500/20"
          >
            {healingProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Scan stuck orders
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={loading || allOrders.length === 0}
            className="gap-1.5 border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>

          <Button variant="outline" size="icon" onClick={() => fetchOrders()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {allApisOff && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold text-red-600 dark:text-red-400">WARNING: All Provider APIs are offline!</p>
            <p className="text-muted-foreground">Orders will remain stuck in 'paid' status until a provider API is reactivated.</p>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card border-border shadow-sm">
          <CardContent className="pt-6 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Total Airtime Transactions</span>
              <p className="text-2xl font-black">{totalCount}</p>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-amber-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-sm">
          <CardContent className="pt-6 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Pending/Paid Orders</span>
              <p className="text-2xl font-black text-amber-500">
                {allOrders.filter(o => o.status === "pending" || o.status === "paid" || o.status === "processing").length}
              </p>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 flex items-center justify-center animate-pulse">
              <Clock className="w-5 h-5 text-amber-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-sm">
          <CardContent className="pt-6 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Fulfillment Failure Rate</span>
              <p className="text-2xl font-black text-red-500">
                {totalCount > 0 ? `${((allOrders.filter(o => o.status === "fulfillment_failed").length / Math.max(allOrders.length, 1)) * 100).toFixed(1)}%` : "0%"}
              </p>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between bg-card p-4 border border-border rounded-2xl shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search phone number, order ID, agent name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 bg-secondary/30 rounded-xl"
          />
        </div>
        
        <div className="flex flex-wrap gap-2">
          {/* Agent Category Filter */}
          <div className="flex rounded-lg border border-border p-1 bg-secondary/10">
            <button
              onClick={() => setTypeFilter("all")}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${typeFilter === "all" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
            >
              All Users
            </button>
            <button
              onClick={() => setTypeFilter("agents")}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${typeFilter === "agents" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
            >
              Agents
            </button>
            <button
              onClick={() => setTypeFilter("sub_agents")}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${typeFilter === "sub_agents" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
            >
              Sub-Agents
            </button>
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-card border border-border text-xs rounded-xl px-3 h-10 font-bold focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Statuses</option>
            <option value="awaiting_payment">Awaiting Payment</option>
            <option value="paid">Paid (Fulfillment Queue)</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="fulfillment_failed">Fulfillment Failed</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
      </div>

      {/* Bulk actions bar (if rows selected) */}
      {selectedIds.size > 0 && (
        <div className="bg-primary/5 border border-primary/20 p-4 rounded-xl flex flex-wrap items-center justify-between gap-4 animate-in slide-in-from-top-2">
          <div className="text-xs font-bold text-primary">
            {selectedIds.size} order{selectedIds.size > 1 ? "s" : ""} selected
          </div>
          <div className="flex items-center gap-2">
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="bg-card border border-border text-xs rounded-lg px-2 h-8 font-bold focus:outline-none"
            >
              <option value="">Update status to...</option>
              <option value="paid">Paid</option>
              <option value="processing">Processing</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="fulfillment_failed">Fulfillment Failed</option>
              <option value="refunded">Refunded</option>
            </select>
            <Button size="sm" onClick={handleBulkUpdateStatus} disabled={bulkUpdating}>
              {bulkUpdating && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
              Apply
            </Button>
          </div>
        </div>
      )}

      {/* Orders Table Card */}
      <Card className="border border-border bg-card shadow-sm overflow-hidden rounded-2xl">
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border bg-secondary/10 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                <th className="p-2 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={displayedOrders.length > 0 && selectedIds.size === displayedOrders.length}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="p-2">Order Details</th>
                <th className="p-2">Recipient</th>
                <th className="p-2 text-right">Amount</th>
                <th className="p-2">User &amp; Wallet</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2 py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      Loading airtime orders...
                    </div>
                  </td>
                </tr>
              ) : displayedOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    No airtime orders found matching the filter criteria.
                  </td>
                </tr>
              ) : (
                displayedOrders.map((o) => {
                  const isChecked = selectedIds.has(o.id);
                  return (
                    <tr
                      key={o.id}
                      className={`hover:bg-muted/5 transition-colors ${isChecked ? "bg-primary/5" : ""}`}
                    >
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectRow(o.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="p-2 space-y-0.5">
                        <div className="font-bold font-mono text-[10px] truncate w-24 uppercase text-muted-foreground" title={o.id}>
                          #{o.id.slice(0, 8)}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <span className={`text-[8px] px-1 py-0.5 rounded font-black uppercase tracking-wider ${
                            o.network === "MTN" ? "bg-amber-500/10 text-amber-500" : o.network === "Telecel" ? "bg-red-500/10 text-red-500" : "bg-blue-500/10 text-blue-500"
                          }`}>
                            {o.network}
                          </span>
                          <span className="text-[9px] text-muted-foreground font-medium">
                            {new Date(o.created_at).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" })}{" "}
                            {new Date(o.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
                          </span>
                        </div>
                      </td>
                      <td className="p-2 font-semibold">
                        <div className="flex flex-col text-[11px]">
                          <span>{o.customer_phone}</span>
                          <PhoneOrderTracker phoneNumber={o.customer_phone || ""} />
                        </div>
                      </td>
                      <td className="p-2 text-right font-black text-foreground text-[11px]">
                        ₵{o.amount.toFixed(2)}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-col text-[11px]">
                          <span className="font-bold text-foreground truncate max-w-[120px]" title={o.agent_name}>{o.agent_name}</span>
                          <span className="text-[9px] text-muted-foreground truncate max-w-[120px]" title={o.agent_email}>{o.agent_email}</span>
                          {o.metadata?.wallet_balance !== undefined && (
                            <span className="text-[9px] text-amber-600 font-semibold mt-0.5">
                              Bal: ₵{o.metadata.wallet_balance.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-2">
                        <div className="space-y-0.5">
                          <Badge variant="outline" className={`font-black uppercase tracking-wider text-[8px] px-1.5 py-0.5 ${STATUS_COLORS[o.status] || "bg-secondary text-secondary-foreground"}`}>
                            {o.status.replace("_", " ")}
                          </Badge>
                          {o.failure_reason && (
                            <p className="text-[9px] text-red-500 font-medium max-w-[150px] truncate leading-normal" title={o.failure_reason}>
                              Reason: {o.failure_reason}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="p-2 text-center">
                        <div className="flex items-center justify-center">
                          {(o.status === "fulfillment_failed" || o.status === "paid" || o.status === "processing") ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-7 w-7 p-0 hover:bg-muted">
                                  <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-36">
                                <DropdownMenuItem 
                                  onClick={() => handleRetryOrder(o.id)}
                                  disabled={retrying === o.id || forcingFulfill}
                                  className="text-[11px] font-semibold cursor-pointer"
                                >
                                  {retrying === o.id ? "Retrying..." : "Retry API"}
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => handleForceFulfill(o.id)}
                                  disabled={retrying === o.id || forcingFulfill}
                                  className="text-[11px] font-semibold text-green-600 dark:text-green-400 cursor-pointer"
                                >
                                  Force Complete
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => handleRefundOrder(o.id)}
                                  disabled={refunding === o.id || forcingFulfill}
                                  className="text-[11px] font-semibold text-red-600 dark:text-red-400 cursor-pointer"
                                >
                                  {refunding === o.id ? "Refunding..." : "Refund Wallet"}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <span className="text-[10px] text-muted-foreground font-semibold">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 py-4 border-t border-border bg-card rounded-xl">
          <div className="text-xs text-muted-foreground">
            Showing Page <span className="font-bold text-foreground">{page}</span> of <span className="font-bold text-foreground">{totalPages}</span> ({totalCount} total airtime orders)
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPage(1)}
              disabled={page === 1}
            >
              <ChevronsLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page === totalPages}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
            >
              <ChevronsRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminAirtimeOrders;
