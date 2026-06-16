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
  Zap
} from "lucide-react";
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
}

interface AgentProfile {
  user_id: string;
  full_name: string;
  email: string;
  is_sub_agent: boolean;
  wallet_balance?: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  paid: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  processing: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  fulfilled: "bg-green-500/20 text-green-400 border-green-500/30",
  fulfillment_failed: "bg-red-500/20 text-red-400 border-red-500/30",
};

type FilterType = "all" | "agents" | "sub_agents";

const PAGE_SIZE = 50;

const AdminMashUpOrders = () => {
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
  const [retryingAll, setRetryingAll] = useState(false);
  const [forcingFulfill, setForcingFulfill] = useState(false);
  const [healingProcessing, setHealingProcessing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState("all");
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
  useEffect(() => { setPage(1); }, [search, typeFilter, statusFilter, orderTypeFilter]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = supabase
      .from("orders")
      .select("*", { count: "estimated" })
      .eq("network", "MTN Mash Up")
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
        
        let orString = `customer_phone.ilike.%${search}%,customer_name.ilike.%${search}%,status.ilike.%${search}%`;
        if (matchedUserIds.length > 0) {
          matchedUserIds.forEach(id => {
            orString += `,agent_id.eq.${id}`;
          });
        }
        q = q.or(orString);
      }
    }

    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    if (orderTypeFilter !== "all") q = q.eq("order_type", orderTypeFilter);

    const { data, count, error } = await q;
    
    if (error) {
      toast({ title: "Failed to fetch orders", variant: "destructive" });
      setLoading(false);
      return;
    }

    setTotalCount(count || 0);

    // Resolve profile info for this batch
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
  }, [page, search, statusFilter, orderTypeFilter, toast]);

  useEffect(() => {
    const timer = setTimeout(() => fetchOrders(), 300);
    return () => clearTimeout(timer);
  }, [fetchOrders]);

  // Live updates
  useRealtimeRefresh({ tables: ["orders"], onRefresh: fetchOrders });

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
        if (currentUser) {
          await logAudit(currentUser.id, "manual_order_retry", { order_id: orderId, status: "fulfilled" });
        }
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

  const handleRetryAll = async () => {
    const actionable = allOrders.filter(
      (o) => o.status === "pending" || o.status === "paid" || o.status === "processing" || o.status === "fulfillment_failed"
    );
    if (actionable.length === 0) {
      toast({ title: "No pending orders", description: "All orders are already fulfilled." });
      return;
    }
    setRetryingAll(true);
    toast({ title: "Processing…", description: `Retrying ${actionable.length} orders in batches…` });

    let fulfilled = 0;
    const BATCH = 5;
    for (let i = 0; i < actionable.length; i += BATCH) {
      const batch = actionable.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map((o) => invokePublicFunctionAsUser("verify-payment", { body: { reference: o.id } }))
      );
      fulfilled += results.filter(
        (r) => r.status === "fulfilled" && (r as PromiseFulfilledResult<any>).value?.data?.status === "fulfilled"
      ).length;
    }

    if (currentUser) {
      await logAudit(currentUser.id, "bulk_retry_orders", { attempted: actionable.length, fulfilled });
    }
    toast({ title: "Done", description: `${fulfilled} of ${actionable.length} orders fulfilled.` });
    setRetryingAll(false);
    await fetchOrders();
  };

  const handleForceFulfillAllProcessing = async () => {
    setForcingFulfill(true);
    try {
      const { count, error: countErr } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "processing")
        .eq("network", "MTN Mash Up");

      if (countErr) throw countErr;
      const totalCount = count || 0;

      if (totalCount === 0) {
        toast({ 
          title: "Verification Complete", 
          description: "Checked the database. There are exactly 0 Mash Up orders in processing." 
        });
        setForcingFulfill(false);
        return;
      }

      if (!confirm(`WARNING: Found ${totalCount} processing MTN Mash Up orders. Force fulfill them ALL immediately?`)) {
        setForcingFulfill(false);
        return;
      }

      toast({ title: "Executing database update…", description: `Transitioning ${totalCount} Mash Up orders…` });

      const { error } = await supabase
        .from("orders")
        .update({ 
          status: "fulfilled", 
          failure_reason: "Forced global Mash Up fulfillment via admin dashboard" 
        })
        .eq("status", "processing")
        .eq("network", "MTN Mash Up");

      if (error) throw error;
      
      toast({ title: "Task Success", description: `Successfully fulfilled ${totalCount} Mash Up orders.` });
      
      if (currentUser) {
        await logAudit(currentUser.id, "mass_fulfill_mashup_processing", { count: totalCount });
      }
    } catch (e: any) {
      toast({ title: "Execution Failed", description: e.message, variant: "destructive" });
    }

    setForcingFulfill(false);
    await fetchOrders();
  };

  const handleBulkStatusUpdate = async () => {
    if (!bulkStatus || selectedIds.size === 0) return;
    setBulkUpdating(true);
    const ids = Array.from(selectedIds);
    const { error } = await supabase
      .from("orders")
      .update({ status: bulkStatus, failure_reason: null, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (error) {
      toast({ title: "Bulk update failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Updated ${ids.length} order${ids.length > 1 ? "s" : ""} to "${bulkStatus.replace(/_/g, " ")}"` });
      setSelectedIds(new Set());
      setBulkStatus("");
      fetchOrders();
    }
    setBulkUpdating(false);
  };

  const handleHealProcessingOrders = async () => {
    const processingOrders = allOrders.filter(o => o.status === "processing");
    if (processingOrders.length === 0) {
      toast({ title: "No processing orders", description: "Nothing to heal." });
      return;
    }
    setHealingProcessing(true);
    toast({ title: "Polling provider…", description: `Checking ${processingOrders.length} stuck orders against DataHub.` });
    try {
      const { data, error } = await supabase.functions.invoke("heal-processing-orders", {
        body: { order_ids: processingOrders.map(o => o.id) },
      });
      if (error) throw error;
      const { summary } = data;
      toast({
        title: "Heal complete",
        description: `Fulfilled: ${summary.fulfilled} · Re-queued: ${summary.requeued} · Still processing: ${summary.still_processing} · Failed: ${summary.failed}`,
      });
    } catch (e: any) {
      toast({ title: "Heal failed", description: e.message, variant: "destructive" });
    }
    setHealingProcessing(false);
    await fetchOrders();
  };

  const [resolvingNames, setResolvingNames] = useState<Record<string, boolean>>({});

  const handleResolveGuestName = async (orderId: string, phone: string, network: string | null) => {
    if (!phone || !network) return;
    setResolvingNames(prev => ({ ...prev, [orderId]: true }));
    
    try {
      let bankCode = "MTN";
      const net = (network || "").toUpperCase();
      if (net.includes("VODA") || net.includes("TELECEL")) bankCode = "VOD";
      if (net.includes("AIRTEL") || net.includes("TIGO") || net.includes("AT")) bankCode = "ATL";

      const { data, error } = await supabase.functions.invoke("paystack-resolve", {
        body: { account_number: phone.replace(/\D+/g, ""), bank_code: bankCode }
      });

      if (error || !data?.success) {
        throw new Error(data?.error || "Could not resolve name");
      }

      const name = data.account_name;
      const { error: updateError } = await supabase
        .from("orders")
        .update({ customer_name: name })
        .eq("id", orderId);

      if (updateError) throw updateError;

      toast({ title: "Name Resolved", description: `Updated to: ${name}` });
      await fetchOrders();
    } catch (e: any) {
      toast({ title: "Resolution failed", description: e.message, variant: "destructive" });
    } finally {
      setResolvingNames(prev => ({ ...prev, [orderId]: false }));
    }
  };

  const handleExportCSV = () => {
    if (allOrders.length === 0) {
      toast({ title: "No orders to export", variant: "destructive" });
      return;
    }
    const headers = [
      "Order ID", "Date", "Type", "Network", "Size/Details", 
      "Recipient Phone", "Customer Name", "Agent Name", "Agent Email",
      "Amount (GHS)", "Profit", "Status", "Failure Reason"
    ];
    const csvContent = [
      headers.join(","),
      ...allOrders.map(o => [
        o.id,
        new Date(o.created_at).toLocaleString(),
        o.order_type,
        o.network || "N/A",
        o.package_size || "N/A",
        o.customer_phone || "N/A",
        o.customer_name || "Guest",
        o.agent_name || "N/A",
        o.agent_email || "N/A",
        o.amount,
        o.profit,
        o.status,
        o.failure_reason || "None"
      ].map(val => JSON.stringify(val ?? "")).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `mashup_orders_export_${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "Export Complete", description: `Exported ${allOrders.length} Mash Up orders to CSV.` });
  };

  // Client-side filtering
  const filtered = allOrders.filter(o => {
    if (typeFilter === "agents") return !o.is_sub_agent;
    if (typeFilter === "sub_agents") return o.is_sub_agent;
    return true;
  });
  const paginated = filtered;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = page;

  const fulfilledForStats = allOrders.filter(o => o.status === "fulfilled");
  const totalRevenue = fulfilledForStats.reduce((s, o) => s + Number(o.paystack_verified_amount ?? o.amount ?? 0), 0);
  const totalPaystackFees = fulfilledForStats.reduce((s, o) => s + Number(o.paystack_fee || 0), 0);
  const totalNetRevenue = totalRevenue - totalPaystackFees;
  const totalAgentProfits = fulfilledForStats.reduce((s, o) => s + Number(o.profit || 0), 0);
  const totalParentProfits = fulfilledForStats.reduce((s, o) => s + Number(o.parent_profit || 0), 0);
  const totalCosts = fulfilledForStats.reduce((s, o) => s + Number(o.cost_price || 0), 0);
  const totalAdminNetProfit = totalNetRevenue - totalAgentProfits - totalParentProfits - totalCosts;
  
  const failed = allOrders.filter((o) => o.status === "fulfillment_failed").length;
  const pending = allOrders.filter((o) => o.status === "pending" || o.status === "paid").length;

  if (loading && allOrders.length === 0) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <Loader2 className="w-7 h-7 animate-spin text-amber-500" />
      <div className="text-center">
        <p className="text-muted-foreground text-sm font-medium">Loading Mash Up orders…</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 pb-10">
      {/* Phone tracker */}
      <PhoneOrderTracker
        title="Track MTN Mash Up Order by Phone"
        subtitle="Admin quick lookup for live delivery status of Mash Up bundles."
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">MTN Mash Up Orders</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Strictly MTN Mash Up transactions — {totalCount.toLocaleString()} total orders
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start">
          <Button variant="outline" size="sm" className="gap-2" onClick={fetchOrders}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
          {allApisOff && (
            <Button variant="outline" size="sm" className="gap-2 bg-white/5 border-white/10 hover:bg-white/10" onClick={handleExportCSV} disabled={allOrders.length === 0}>
              <Download className="w-4 h-4" /> Export CSV
            </Button>
          )}
          <Button
            size="sm"
            className="gap-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20"
            onClick={handleRetryAll}
            disabled={retryingAll}
          >
            {retryingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            {retryingAll ? "Retrying…" : `Retry All Actionable (${pending + failed + allOrders.filter(o => o.status === "processing").length})`}
          </Button>
          <Button
            size="sm"
            className="gap-2 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/20"
            onClick={handleHealProcessingOrders}
            disabled={healingProcessing || allOrders.filter(o => o.status === "processing").length === 0}
          >
            {healingProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
            {healingProcessing ? "Polling Provider…" : `Poll Provider Status (${allOrders.filter(o => o.status === "processing").length})`}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="gap-2"
            onClick={handleForceFulfillAllProcessing}
            disabled={forcingFulfill}
          >
            {forcingFulfill ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {forcingFulfill ? "Analyzing DB…" : "Force Fulfill ALL Mash Up"}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: "Total Orders", value: allOrders.length.toLocaleString(), icon: ShoppingCart, color: "text-blue-500" },
          { label: "Fulfilled Volume", value: `GH₵${totalRevenue.toFixed(2)}`, icon: TrendingUp, color: "text-emerald-500" },
          { label: "Paystack Fees", value: `GH₵${totalPaystackFees.toFixed(2)}`, icon: TrendingUp, color: "text-red-500" },
          { label: "Agent Profits", value: `GH₵${(totalAgentProfits + totalParentProfits).toFixed(2)}`, icon: TrendingUp, color: "text-purple-500" },
          { label: "Platform Costs", value: `GH₵${totalCosts.toFixed(2)}`, icon: TrendingUp, color: "text-orange-500" },
          { label: "Net Admin Profit", value: `GH₵${totalAdminNetProfit.toFixed(2)}`, icon: TrendingUp, color: "text-sky-500 font-black" },
          { label: "Pending / Processing / Failed", value: `${pending} / ${allOrders.filter(o => o.status === "processing").length} / ${failed}`, icon: failed > 0 ? AlertTriangle : Clock, color: failed > 0 ? "text-red-500" : "text-amber-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-card border-border shadow-sm">
            <CardContent className="p-3 flex items-center gap-2">
              <Icon className={`w-6 h-6 ${color} shrink-0 opacity-90`} />
              <div className="min-w-0">
                <p className="text-base font-black text-foreground truncate">{value}</p>
                <p className="text-[10px] text-muted-foreground truncate">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search Mash Up orders, agents, phones…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-secondary/50 border-input text-sm"
          />
        </div>

        <div className="flex items-center gap-1 bg-secondary/50 border border-input rounded-lg p-1">
          {(["all", "agents", "sub_agents"] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setTypeFilter(f)}
              className={`px-3 py-1 text-xs rounded-md font-semibold transition-all ${typeFilter === f ? "bg-amber-400 text-black shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {f === "all" ? "All" : f === "agents" ? "Agents" : "Sub-Agents"}
            </button>
          ))}
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs bg-secondary/50 border border-input rounded-lg px-3 py-2 text-foreground outline-none"
        >
          <option value="all">All Statuses</option>
          <option value="fulfilled">Fulfilled</option>
          <option value="paid">Paid (pending)</option>
          <option value="fulfillment_failed">Failed</option>
          <option value="pending">Pending</option>
        </select>

        <select
          value={orderTypeFilter}
          onChange={(e) => setOrderTypeFilter(e.target.value)}
          className="text-xs bg-secondary/50 border border-input rounded-lg px-3 py-2 text-foreground outline-none"
        >
          <option value="all">All Order Types</option>
          <option value="data">Data Bundles</option>
          <option value="api">API Purchases</option>
        </select>

        <span className="text-xs text-muted-foreground ml-auto">
          {totalCount.toLocaleString()} result{totalCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Bulk Status Update Toolbar */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          title="Select all on this page"
          className="w-4 h-4 accent-primary cursor-pointer"
          checked={selectedIds.size > 0 && selectedIds.size === paginated.length}
          ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < paginated.length; }}
          onChange={(e) => {
            if (e.target.checked) setSelectedIds(new Set(paginated.map(o => o.id)));
            else setSelectedIds(new Set());
          }}
        />
        <span className="text-xs text-muted-foreground">{selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all on page"}</span>
        <select
          value={bulkStatus}
          onChange={e => setBulkStatus(e.target.value)}
          className="text-xs bg-secondary/50 border border-input rounded-lg px-3 py-2 text-foreground outline-none"
        >
          <option value="">Select Status</option>
          <option value="fulfilled">Fulfilled</option>
          <option value="processing">Processing</option>
          <option value="paid">Paid</option>
          <option value="fulfillment_failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        <Button
          size="sm"
          disabled={selectedIds.size === 0 || !bulkStatus || bulkUpdating}
          onClick={handleBulkStatusUpdate}
          className="gap-2"
        >
          {bulkUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Update Selected ({selectedIds.size})
        </Button>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block rounded-xl border border-border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 w-8" aria-label="Select"></th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Date</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Agent</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Type</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hidden sm:table-cell">Phone</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hidden md:table-cell">Network</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hidden md:table-cell">Package</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Amount</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hidden xl:table-cell">Cost</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hidden lg:table-cell">Agent Profit</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hidden lg:table-cell">Admin Profit</th>
                <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status</th>
                <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginated.map((order) => (
                <tr key={order.id} className={`hover:bg-muted/30 transition-colors bg-card ${selectedIds.has(order.id) ? "bg-primary/5" : ""}`}>
                  <td className="px-4 py-3 w-8">
                    <input
                      type="checkbox"
                      title="Select order"
                      className="w-4 h-4 accent-primary cursor-pointer"
                      checked={selectedIds.has(order.id)}
                      onChange={(e) => {
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(order.id);
                        else next.delete(order.id);
                        setSelectedIds(next);
                      }}
                    />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                    {new Date(order.created_at).toLocaleDateString("en-GH", { day: "2-digit", month: "short" })}
                    <span className="block text-muted-foreground/60 text-[10px]">
                      {new Date(order.created_at).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs font-semibold text-foreground truncate max-w-[120px]">{order.agent_name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-[10px] text-muted-foreground truncate max-w-[80px]">{order.agent_email}</p>
                      {order.metadata?.wallet_balance !== undefined && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-500 border border-cyan-500/20 whitespace-nowrap">
                          ₵{Number(order.metadata.wallet_balance).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-xs font-bold text-foreground/90">
                        {order.order_type === "api" ? "API Purchase" : "Data Purchase"}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${order.is_sub_agent ? "border-purple-500/30 text-purple-600 dark:text-purple-400 bg-purple-500/10" : "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10"}`}>
                        {order.is_sub_agent ? "Sub-Agent" : "Agent"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell group/phone">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-muted-foreground">{order.customer_phone || "—"}</p>
                        {order.customer_name ? (
                          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase truncate max-w-[100px]">{order.customer_name}</p>
                        ) : (
                          (order.agent_id === "00000000-0000-0000-0000-000000000000" || !order.agent_id) && order.customer_phone && (
                            <button 
                              onClick={() => handleResolveGuestName(order.id, order.customer_phone!, order.network)}
                              disabled={resolvingNames[order.id]}
                              className="text-[9px] text-muted-foreground/60 hover:text-amber-500 font-bold uppercase flex items-center gap-1 transition-colors mt-0.5"
                            >
                              {resolvingNames[order.id] ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <UserCheck className="w-2.5 h-2.5" />}
                              Resolve Name
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground/70 hidden md:table-cell">{order.network || "—"}</td>
                  <td className="px-4 py-3 text-xs text-foreground/70 hidden md:table-cell">
                    <div>{order.package_size || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-bold text-foreground">GH₵{Number(order.amount).toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-3 text-right hidden xl:table-cell">
                    {order.cost_price != null ? (
                      <span className="text-xs text-foreground/70">GH₵{Number(order.cost_price).toFixed(2)}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right hidden lg:table-cell">
                    {Number(order.profit) + Number(order.parent_profit) > 0 ? (
                      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">+GH₵{(Number(order.profit) + Number(order.parent_profit)).toFixed(2)}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right hidden lg:table-cell">
                    {order.status === "fulfilled" && order.cost_price != null ? (
                      <span className="text-xs font-black text-sky-600 dark:text-sky-400">
                        GH₵{(
                          Number(order.paystack_verified_amount ?? order.amount) - 
                          Number(order.paystack_fee || 0) - 
                          Number(order.profit || 0) - 
                          Number(order.parent_profit || 0) - 
                          Number(order.cost_price)
                        ).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge className={`text-[10px] border ${STATUS_COLORS[order.status] || "bg-muted text-muted-foreground border-border"}`}>
                      {order.status === "pending" ? "Awaiting Checkout" : order.status.replace(/_/g, " ")}
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
                        {retrying === order.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                        Retry
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-4">
        {paginated.map((order) => (
          <div key={order.id} className="rounded-2xl bg-card border border-border p-4 space-y-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold text-muted-foreground">{new Date(order.created_at).toLocaleDateString()}</span>
                  <Badge className={`text-[9px] border ${STATUS_COLORS[order.status] || "bg-muted text-muted-foreground border-border"}`}>
                    {order.status.replace(/_/g, " ")}
                  </Badge>
                </div>
                <p className="font-bold text-foreground text-sm">{order.agent_name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{order.agent_email}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-black text-foreground">GH₵{Number(order.amount).toFixed(2)}</p>
                {order.paystack_verified_amount != null && (
                  <p className="flex items-center justify-end gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    GH₵{Number(order.paystack_verified_amount).toFixed(2)}
                  </p>
                )}
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${order.is_sub_agent ? "border-purple-500/30 text-purple-600 dark:text-purple-400 bg-purple-500/10" : "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10"}`}>
                  {order.is_sub_agent ? "Sub-Agent" : "Agent"}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4 py-3 border-y border-border">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Type</p>
                <p className="text-xs text-foreground/80 font-bold">
                  {order.order_type === "api" ? "API" : "Data"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Network</p>
                <p className="text-xs text-foreground/80 font-bold">{order.network || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Package</p>
                <div className="space-y-1">
                  <p className="text-xs text-foreground/80 font-bold">{order.package_size || "—"}</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Recipient</p>
                <div className="flex flex-col">
                  <span className="text-xs text-foreground/80 font-mono">{order.customer_phone || "—"}</span>
                  {order.customer_name ? (
                    <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold uppercase truncate">{order.customer_name}</span>
                  ) : (
                    (order.agent_id === "00000000-0000-0000-0000-000000000000" || !order.agent_id) && order.customer_phone && (
                      <button 
                        onClick={() => handleResolveGuestName(order.id, order.customer_phone!, order.network)}
                        disabled={resolvingNames[order.id]}
                        className="text-[9px] text-amber-600 hover:text-amber-500 font-bold uppercase flex items-center gap-1 transition-colors mt-0.5"
                      >
                        {resolvingNames[order.id] ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <UserCheck className="w-2.5 h-2.5" />}
                        Resolve Name
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              {(order.status === "pending" || order.status === "fulfillment_failed" || order.status === "paid") && (
                <Button
                  size="sm" variant="outline"
                  className="flex-1 text-xs gap-2 h-9 border-input hover:border-amber-400/30 rounded-xl"
                  disabled={retrying === order.id}
                  onClick={() => handleRetry(order.id)}
                >
                  {retrying === order.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  Retry Fulfillment
                </Button>
              )}
              {order.failure_reason && (
                <div className="flex-1 text-[9px] text-red-600 dark:text-red-400/80 italic leading-tight">
                  Error: {order.failure_reason}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {allOrders.length === 0 && !loading && (
        <div className="py-16 text-center">
          <ShoppingCart className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No orders match your filters.</p>
        </div>
      )}

      {/* ── Pagination controls ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-4 pt-2">
          <p className="text-xs text-muted-foreground">
            Showing {((safePage - 1) * PAGE_SIZE) + 1}–{Math.min(safePage * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
          </p>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={safePage === 1}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let p: number;
              if (totalPages <= 7) {
                p = i + 1;
              } else if (safePage <= 4) {
                p = i + 1;
              } else if (safePage >= totalPages - 3) {
                p = totalPages - 6 + i;
              } else {
                p = safePage - 3 + i;
              }
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                    p === safePage
                      ? "bg-amber-400 text-black"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {p}
                </button>
              );
            })}

            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={safePage === totalPages}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-muted-foreground hidden sm:block">
            Page {safePage} of {totalPages}
          </p>
        </div>
      )}
    </div>
  );
};

export default AdminMashUpOrders;
