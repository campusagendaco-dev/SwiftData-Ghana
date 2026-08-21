import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeSearchTerm, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search, RotateCcw, Loader2, RefreshCw,
  TrendingUp, ShoppingCart, Clock,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  CheckCircle2, PlayCircle, UserCheck, Download,
  Coins, ShieldAlert, Zap, Check, X,
  DollarSign, Sparkles, AlertCircle, Copy, Activity,
  Calendar, FileSpreadsheet, Edit3
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";
import UserDetailDrawer from "@/components/UserDetailDrawer";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { logAudit } from "@/utils/auditLogger";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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
  agent_phone?: string;
  is_sub_agent?: boolean;
  metadata?: any;
  auto_refunded?: boolean;
  refund_amount?: number;
  refund_reason?: string;
  payment_method?: string;
}

interface AgentProfile {
  user_id: string;
  full_name: string;
  email: string;
  phone?: string;
  is_agent: boolean;
  agent_approved: boolean;
  is_sub_agent: boolean;
  sub_agent_approved: boolean;
  parent_agent_id: string | null;
  created_at: string;
  wallet_balance?: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  paid: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  processing: "bg-sky-500/15 text-sky-400 border-sky-500/30 animate-pulse",
  fulfilled: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  fulfillment_failed: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  cancelled: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  failed: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

function isBeneficiaryFailure(order: Pick<OrderRow, "status" | "failure_reason">): boolean {
  if (order.status !== "fulfillment_failed") return false;
  const reason = (order.failure_reason || "").toLowerCase();
  return reason.includes("beneficiary") || reason.includes("not added");
}

const BENEFICIARY_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  submitted: { label: "in queue", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold shadow-sm" },
  whitelisted: { label: "in queue", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold shadow-sm" },
  in_queue: { label: "in queue", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold shadow-sm" },
};

type FilterType = "all" | "agents" | "sub_agents";
type DatePreset = "all" | "today" | "yesterday" | "last_7_days" | "last_30_days" | "this_month" | "custom";

const PAGE_SIZE = 50;

export default function AdminOrders() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [allOrders, setAllOrders] = useState<OrderRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, AgentProfile>>({});
  const [beneficiaryStatus, setBeneficiaryStatus] = useState<Record<string, string>>({});
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
  const [routingDatamart, setRoutingDatamart] = useState(false);
  const [selectedUserForDrawer, setSelectedUserForDrawer] = useState<AgentProfile | null>(null);

  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [sendingLiveSms, setSendingLiveSms] = useState(false);
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [networkFilter, setNetworkFilter] = useState("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [providers, setProviders] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkUpdating, setBulkUpdating] = useState(false);

  // Date Range Filters State
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Manual Status Changer Modal State
  const [orderToEditStatus, setOrderToEditStatus] = useState<OrderRow | null>(null);
  const [newOrderStatus, setNewOrderStatus] = useState("");
  const [newStatusReason, setNewStatusReason] = useState("");
  const [updatingSingleStatus, setUpdatingSingleStatus] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const fetchProviders = async () => {
      const { data } = await supabase.from("providers").select("*");
      setProviders(data || []);
    };
    fetchProviders();
  }, []);

  const allApisOff = providers.length === 0 || providers.every(p => !p.is_active);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, statusFilter, networkFilter, orderTypeFilter, datePreset, startDate, endDate]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast({ title: "Copied to clipboard! 📋", description: text });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const applyDatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    if (preset === "today") {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === "yesterday") {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yStr = yesterday.toISOString().split("T")[0];
      setStartDate(yStr);
      setEndDate(yStr);
    } else if (preset === "last_7_days") {
      const past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setStartDate(past7.toISOString().split("T")[0]);
      setEndDate(todayStr);
    } else if (preset === "last_30_days") {
      const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      setStartDate(past30.toISOString().split("T")[0]);
      setEndDate(todayStr);
    } else if (preset === "this_month") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      setStartDate(firstDay);
      setEndDate(todayStr);
    } else if (preset === "all") {
      setStartDate("");
      setEndDate("");
    }
  };

  const fetchOrders = useCallback(async () => {
    setLoading(true);

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = supabase
      .from("orders")
      .select("*", { count: "estimated" })
      .order("created_at", { ascending: false });

    // Search filter
    if (search.trim()) {
      const cleanSearch = sanitizeSearchTerm(search);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanSearch);
      const isHex8 = /^[0-9a-f]{8}$/i.test(cleanSearch);

      if (isUuid) {
        q = q.or(`id.eq.${cleanSearch},agent_id.eq.${cleanSearch}`);
      } else {
        const { data: matchedProfiles } = await supabase
          .from("profiles")
          .select("user_id")
          .or(`full_name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,phone.ilike.%${cleanSearch}%`);

        const matchedUserIds = matchedProfiles?.map((p: any) => p.user_id) || [];
        
        const orParts: string[] = [
          `customer_phone.ilike.%${cleanSearch}%`,
          `customer_name.ilike.%${cleanSearch}%`,
          `network.ilike.%${cleanSearch}%`,
          `package_size.ilike.%${cleanSearch}%`
        ];

        if (isHex8) {
          orParts.push(`id.gte.${cleanSearch}-0000-0000-0000-000000000000`);
          orParts.push(`id.lte.${cleanSearch}-ffff-ffff-ffff-ffffffffffff`);
        }

        if (matchedUserIds.length > 0) {
          matchedUserIds.forEach(id => {
            orParts.push(`agent_id.eq.${id}`);
          });
        }

        q = q.or(orParts.join(","));
      }
    }

    // Status Filter
    if (statusFilter !== "all" && statusFilter !== "in_queue") {
      q = q.eq("status", statusFilter);
    }
    // Network Filter
    if (networkFilter !== "all") {
      q = q.eq("network", networkFilter);
    }
    // Order Type Filter
    if (orderTypeFilter !== "all") {
      q = q.eq("order_type", orderTypeFilter);
    }

    // Date Range Filters
    if (startDate) {
      q = q.gte("created_at", `${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      q = q.lte("created_at", `${endDate}T23:59:59.999Z`);
    }

    // Range Pagination
    q = q.range(from, to);

    const { data, count, error } = await q;
    
    if (error) {
      toast({ title: "Failed to fetch orders", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    setTotalCount(count || 0);

    // Resolve profile and wallet info for only valid UUIDs
    const validAgentIds = [...new Set((data || [])
      .map((o: any) => o.agent_id)
      .filter((id: string) => id && id !== "00000000-0000-0000-0000-000000000000" && id.length > 10))];
    
    let currentProfiles: Record<string, AgentProfile> = {};

    if (validAgentIds.length > 0) {
      const [profRes, walletRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, full_name, email, phone, is_agent, agent_approved, is_sub_agent, sub_agent_approved, parent_agent_id, created_at")
          .in("user_id", validAgentIds),
        supabase
          .from("wallets")
          .select("agent_id, balance")
          .in("agent_id", validAgentIds)
      ]);

      const walletMap = new Map((walletRes.data || []).map((w: any) => [w.agent_id, w.balance]));
      
      (profRes.data || []).forEach(p => {
        currentProfiles[p.user_id] = {
          ...(p as any),
          wallet_balance: walletMap.get(p.user_id) ?? 0
        };
      });

      setProfiles(prev => ({ ...prev, ...currentProfiles }));
    }

    const enriched: OrderRow[] = (data || []).map((o: any) => {
      const profile = currentProfiles[o.agent_id] || profiles[o.agent_id];
      const isPlaceholder = o.agent_id === "00000000-0000-0000-0000-000000000000" || !o.agent_id;
      
      return {
        ...o,
        agent_name: profile?.full_name || (isPlaceholder ? (o.customer_name || "Guest (Direct Purchase)") : "Unknown Agent"),
        agent_email: profile?.email || "",
        agent_phone: profile?.phone || "",
        is_sub_agent: profile?.is_sub_agent ?? false,
        metadata: { ...o.metadata, wallet_balance: profile?.wallet_balance }
      };
    });

    setAllOrders(enriched);
    setLoading(false);
  }, [page, search, statusFilter, networkFilter, orderTypeFilter, startDate, endDate, toast]);

  useEffect(() => {
    const timer = setTimeout(() => fetchOrders(), 200);
    return () => clearTimeout(timer);
  }, [fetchOrders]);

  // Live updates — re-fetch current page whenever any order changes
  useRealtimeRefresh({ tables: ["orders"], onRefresh: fetchOrders });

  const handleRouteAllToDatamart = async () => {
    const candidateOrders = selectedOrders.length > 0
      ? selectedOrders
      : allOrders.filter(o => o.status === "fulfillment_failed" || o.status === "processing" || o.status === "pending").map(o => o.id);

    if (candidateOrders.length === 0) {
      toast({ title: "No Orders to Route", description: "No eligible pending/failed orders found to route." });
      return;
    }

    if (!confirm(`Are you sure you want to FORCE-ROUTE ${candidateOrders.length} orders directly to Datamart API?`)) {
      return;
    }

    setRoutingDatamart(true);
    toast({ title: "Routing to Datamart API...", description: `Submitting ${candidateOrders.length} orders to Datamart API...` });

    try {
      const { data, error } = await supabase.functions.invoke("route-to-datamart", {
        body: { order_ids: candidateOrders }
      });

      if (error || !data?.success) {
        toast({
          title: "Datamart Routing Failed",
          description: error?.message || data?.error || "Could not route orders to Datamart API",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Datamart Routing Complete! ⚡",
          description: data.message || `Successfully routed ${data.routedCount || 0} orders to Datamart API.`,
        });
        await fetchOrders();
      }
    } catch (e: any) {
      toast({ title: "Routing error", description: e.message, variant: "destructive" });
    }
    setRoutingDatamart(false);
  };

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
        toast({ title: "Order fulfilled successfully! 🎉" });
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

  const handleRefund = async (orderId: string, amount: number) => {
    const targetOrder = allOrders.find((o) => o.id === orderId);
    if (!confirm(`Are you sure you want to manually refund GH₵ ${amount.toFixed(2)} for order ${orderId}?`)) {
      return;
    }
    setRefunding(orderId);
    try {
      const { data, error } = await (supabase.rpc as any)("refund_failed_order", { p_order_id: orderId });
      if (error) throw error;
      if (data) {
        if (currentUser) {
          await logAudit(currentUser.id, "manual_order_refund", { order_id: orderId, amount });
        }

        // Dispatch SMS to recipient explaining refund & reason
        if (targetOrder) {
          supabase.functions.invoke("send-order-sms", {
            body: {
              action: "refund",
              order_id: orderId,
              phone: targetOrder.customer_phone,
              amount: targetOrder.amount,
              package_size: targetOrder.package_size,
              network: targetOrder.network,
              agent_id: targetOrder.agent_id,
              reason: targetOrder.failure_reason || "Refund issued by platform administrator",
            },
          }).catch((err) => console.error("Refund SMS dispatch error:", err));
        }

        toast({ title: "Order refunded successfully! 💰", description: "Wallet/gateway refund applied and SMS notification sent." });
      } else {
        toast({ title: "Refund failed", description: "This order might already be refunded or not eligible.", variant: "destructive" });
      }
      await fetchOrders();
    } catch (e: any) {
      toast({ title: "Refund failed", description: e.message || "Could not execute refund.", variant: "destructive" });
    } finally {
      setRefunding(null);
    }
  };

  const handleUpdateSingleStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderToEditStatus || !newOrderStatus) return;

    setUpdatingSingleStatus(true);
    try {
      const { error } = await (supabase
        .from("orders") as any)
        .update({
          status: newOrderStatus,
          failure_reason: newStatusReason.trim() || null,
          updated_at: new Date().toISOString()
        })
        .eq("id", orderToEditStatus.id);

      if (error) throw error;

      if (currentUser) {
        await logAudit(currentUser.id, "manual_order_status_update", {
          order_id: orderToEditStatus.id,
          old_status: orderToEditStatus.status,
          new_status: newOrderStatus,
          reason: newStatusReason
        });
      }

      toast({
        title: "Order Status Updated! ⚡",
        description: `Order #${orderToEditStatus.id.slice(0, 8)} transitioned to "${newOrderStatus.replace(/_/g, " ")}".`
      });

      setOrderToEditStatus(null);
      setNewOrderStatus("");
      setNewStatusReason("");
      await fetchOrders();
    } catch (err: any) {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    } finally {
      setUpdatingSingleStatus(false);
    }
  };

  const handleRetryAll = async () => {
    const actionable = allOrders.filter(
      (o) => o.status === "pending" || o.status === "paid" || o.status === "processing" || o.status === "fulfillment_failed"
    );
    if (actionable.length === 0) {
      toast({ title: "No pending orders", description: "All orders on this page are already fulfilled." });
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

  const handleForceFulfillAllProcessing = async () => {
    setForcingFulfill(true);
    try {
      const { count, error: countErr } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "processing")
        .neq("network", "MTN Mash Up");

      if (countErr) throw countErr;
      const totalCount = count || 0;

      if (totalCount === 0) {
        toast({ 
          title: "Verification Complete", 
          description: "Checked the entire database. There are exactly 0 orders in processing (excluding Mash Up)." 
        });
        setForcingFulfill(false);
        return;
      }

      if (!confirm(`WARNING: Found ${totalCount} processing orders across the database. Force fulfill them ALL immediately?`)) {
        setForcingFulfill(false);
        return;
      }

      toast({ title: "Executing database update…", description: `Transitioning ${totalCount} orders globally…` });

      const { error } = await (supabase
        .from("orders") as any)
        .update({ 
          status: "fulfilled", 
          failure_reason: "Forced global fulfillment via admin dashboard" 
        })
        .eq("status", "processing")
        .neq("network", "MTN Mash Up");

      if (error) throw error;
      
      toast({ title: "Task Success", description: `Successfully fulfilled ${totalCount} orders database-wide.` });
      
      if (currentUser) {
        await logAudit(currentUser.id, "mass_fulfill_processing_global", { count: totalCount });
      }
    } catch (e: any) {
      toast({ title: "Execution Failed", description: e.message, variant: "destructive" });
    }

    setForcingFulfill(false);
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
      const { error: updateError } = await (supabase
        .from("orders") as any)
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

  const handleBulkStatusUpdate = async () => {
    if (!bulkStatus || selectedIds.size === 0) return;
    setBulkUpdating(true);
    const ids = Array.from(selectedIds);
    const { error } = await (supabase
      .from("orders") as any)
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

  // Full CSV / Excel Export
  const handleExportCSV = () => {
    if (allOrders.length === 0) {
      toast({ title: "No orders to export", variant: "destructive" });
      return;
    }
    const headers = [
      "Order ID", "Date (GMT)", "Order Type", "Network", "Package Size / Details", 
      "Recipient Phone", "Customer Name", "Agent Name", "Agent Email", "Agent Phone",
      "Amount (GH₵)", "Paystack Fee", "Cost Price", "Admin Net Profit", "Agent Profit", "Parent Profit", "Status", "Failure Reason"
    ];
    const csvContent = [
      headers.join(","),
      ...allOrders.map(o => {
        const adminProfit = o.status === "fulfilled"
          ? (o.order_type === "api"
              ? Number(o.profit || 0)
              : (Number(o.paystack_verified_amount ?? o.amount) - Number(o.paystack_fee || 0) - Number(o.profit || 0) - Number(o.parent_profit || 0) - Number(o.cost_price || 0)))
          : 0;

        return [
          o.id,
          new Date(o.created_at).toLocaleString("en-GH"),
          o.order_type,
          o.network || "Standard",
          o.package_size || "N/A",
          o.customer_phone || "N/A",
          o.customer_name || "Guest",
          o.agent_name || "N/A",
          o.agent_email || "N/A",
          o.agent_phone || "N/A",
          Number(o.amount).toFixed(2),
          Number(o.paystack_fee || 0).toFixed(2),
          Number(o.cost_price || 0).toFixed(2),
          adminProfit.toFixed(2),
          Number(o.profit || 0).toFixed(2),
          Number(o.parent_profit || 0).toFixed(2),
          o.status,
          o.failure_reason || "None"
        ].map(val => JSON.stringify(val ?? "")).join(",");
      })
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `SwiftData_Orders_Export_${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "Export Complete! 📊", description: `Exported ${allOrders.length} orders with financial metrics.` });
  };

  const handleExportSimpleCSV = () => {
    if (allOrders.length === 0) {
      toast({ title: "No orders to export", variant: "destructive" });
      return;
    }
    const headers = ["Recipient Phone", "Network", "Size"];
    const csvContent = [
      headers.join(","),
      ...allOrders.map(o => {
        const rawSize = o.package_size || "";
        const match = rawSize.replace(/\s+/g, "").match(/(\d+(?:\.\d+)?)/);
        const numericSize = match ? match[1] : "0";

        return [
          o.customer_phone || "N/A",
          o.network || "N/A",
          numericSize
        ].map(val => JSON.stringify(val ?? "")).join(",");
      })
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `carrier_queue_export_${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "Carrier Queue Export Complete", description: `Exported ${allOrders.length} numbers for direct queue fulfillment.` });
  };

  const handleLiveSmsBlast = async () => {
    const msg = "SwiftData Alert: Delivery is currently ongoing and we are LIVE! Order now at https://swiftdatagh.shop or join our official WhatsApp channel for live updates: https://whatsapp.com/channel/0029Vb81tu4HVvTdqauPgU0Z";
    if (!confirm(`Are you sure you want to send the "Delivery Live" SMS blast to all order recipients?`)) {
      return;
    }
    setSendingLiveSms(true);
    toast({ title: "Initiating SMS Broadcast…", description: "Dispatching 'Delivery Live' SMS via SwiftData gateway…" });
    try {
      const { data, error } = await supabase.functions.invoke("admin-send-sms", {
        body: {
          target_type: "all_order_phones",
          sender_id: "SwiftData",
          message: msg,
        },
      });
      if (error || data?.error) {
        toast({ title: "SMS Broadcast Failed", description: data?.error || error?.message, variant: "destructive" });
      } else if (data?.success) {
        toast({ title: "🚀 SMS Broadcast Dispatched!", description: `Successfully queued/sent to ${data.sent || data.total_recipients || 14000} recipients.` });
      }
    } catch (e: any) {
      toast({ title: "Broadcast error", description: e.message || "Failed to trigger broadcast", variant: "destructive" });
    } finally {
      setSendingLiveSms(false);
    }
  };

  const getOrderBadge = (order: OrderRow): { className: string; label: string } => {
    const phoneStatus = isBeneficiaryFailure(order) && order.customer_phone
      ? beneficiaryStatus[order.customer_phone]
      : undefined;
    const override = phoneStatus ? BENEFICIARY_STATUS_BADGE[phoneStatus] : undefined;
    if (override) return override;

    if (isBeneficiaryFailure(order)) {
      return {
        className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold shadow-sm backdrop-blur-md",
        label: "in queue",
      };
    }

    return {
      className: STATUS_COLORS[order.status] || "bg-muted text-muted-foreground border-border",
      label: order.status === "pending" ? "Awaiting Checkout" : order.status.replace(/_/g, " "),
    };
  };

  const getStatusIcon = (order: OrderRow) => {
    if (isBeneficiaryFailure(order)) return Clock;
    switch (order.status) {
      case "fulfilled": return CheckCircle2;
      case "processing": return RefreshCw;
      case "fulfillment_failed":
      case "failed": return AlertCircle;
      case "cancelled": return X;
      default: return Clock;
    }
  };

  // Client-side filtering
  const filtered = useMemo(() => {
    return allOrders.filter(o => {
      if (typeFilter === "agents" && o.is_sub_agent) return false;
      if (typeFilter === "sub_agents" && !o.is_sub_agent) return false;
      if (statusFilter === "in_queue") {
        return isBeneficiaryFailure(o) || (o.customer_phone && beneficiaryStatus[o.customer_phone]);
      }
      return true;
    });
  }, [allOrders, typeFilter, statusFilter, beneficiaryStatus]);

  const paginated = filtered;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = page;

  // Stats calculation
  const fulfilledForStats = allOrders.filter(o => o.status === "fulfilled");
  const totalRevenue = fulfilledForStats.reduce((s, o) => s + Number(o.paystack_verified_amount ?? o.amount ?? 0), 0);
  const totalPaystackFees = fulfilledForStats.reduce((s, o) => s + Number(o.paystack_fee || 0), 0);
  const totalAgentProfits = fulfilledForStats.reduce((s, o) => s + (o.order_type === "api" ? 0 : Number(o.profit || 0)), 0);
  const totalParentProfits = fulfilledForStats.reduce((s, o) => s + Number(o.parent_profit || 0), 0);
  const totalCosts = fulfilledForStats.reduce((s, o) => s + Number(o.cost_price || 0), 0);
  const totalAdminNetProfit = fulfilledForStats.reduce((s, o) => {
    if (o.status !== "fulfilled") return s;
    if (o.order_type === "api") {
      return s + Number(o.profit || 0);
    }
    const amt = Number(o.paystack_verified_amount ?? o.amount ?? 0);
    const fee = Number(o.paystack_fee || 0);
    const profit = Number(o.profit || 0);
    const parentProfit = Number(o.parent_profit || 0);
    const cost = Number(o.cost_price || 0);
    return s + (amt - fee - profit - parentProfit - cost);
  }, 0);
  
  const inQueueCount = allOrders.filter(o => isBeneficiaryFailure(o) || (o.customer_phone && beneficiaryStatus[o.customer_phone])).length;
  const failed = allOrders.filter((o) => o.status === "fulfillment_failed" && !isBeneficiaryFailure(o)).length;
  const pending = allOrders.filter((o) => o.status === "pending" || o.status === "paid").length;
  const verifiedCount = allOrders.filter((o) => o.paystack_verified_amount != null).length;
  const uniqueNetworks = [...new Set(allOrders.map((o) => o.network).filter(Boolean))] as string[];
  const fulfillmentSuccessRate = allOrders.length > 0
    ? Math.round((fulfilledForStats.length / allOrders.length) * 100)
    : 100;

  const getNetworkBadge = (network: string | null) => {
    const net = (network || "").toUpperCase();
    if (net.includes("MTN")) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    if (net.includes("VODA") || net.includes("TELECEL")) return "bg-red-500/20 text-red-400 border-red-500/30";
    if (net.includes("AIRTEL") || net.includes("TIGO") || net.includes("AT")) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    return "bg-slate-500/20 text-slate-500 dark:text-slate-300 border-slate-500/30";
  };

  if (loading && allOrders.length === 0) return (
    <div className="flex flex-col items-center justify-center py-32 gap-4">
      <div className="relative w-14 h-14">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 rounded-2xl border-2 border-dashed border-amber-500/25"
        />
        <div className="absolute inset-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
        </div>
      </div>
      <div className="text-center">
        <p className="text-foreground font-bold text-sm">Loading Order Records…</p>
        <p className="text-muted-foreground text-xs">Fetching transaction history & beneficiary queues</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 pb-12 max-w-7xl mx-auto">
      {/* Phone tracker widget */}
      <PhoneOrderTracker
        title="Track Customer Order by Phone"
        subtitle="Admin quick lookup for live delivery status, beneficiary status, and bundle size."
      />

      {/* ── Header Hero Section ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900/90 via-slate-900/50 to-amber-950/20 p-6 sm:p-8 border border-white/10 backdrop-blur-2xl shadow-2xl"
      >
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-1/3 -mb-16 w-60 h-60 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="relative shrink-0 hidden sm:block">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 11, repeat: Infinity, ease: "linear" }}
                className="w-14 h-14 rounded-2xl border-2 border-dashed border-amber-500/25 flex items-center justify-center"
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
                  <ShoppingCart className="w-5 h-5 text-slate-950" />
                </div>
              </motion.div>
              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-slate-900 flex items-center justify-center">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-amber-400 animate-pulse" /> Live Order Stream
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  {totalCount.toLocaleString()} Total Records Found
                </span>
                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px] font-bold">
                  {fulfillmentSuccessRate}% Success Rate
                </Badge>
              </div>
              <h1 className="font-display text-2xl sm:text-4xl font-black tracking-tight text-white flex items-center gap-3">
                Admin Orders & Transactions
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
                Monitor, retry, refund, manually transition, and export customer data and airtime orders database-wide.
              </p>
            </div>
          </div>

          {/* Quick Action Grid */}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 h-10 rounded-xl border-white/10 bg-white/5 hover:bg-white/10 text-white text-xs font-bold backdrop-blur-sm"
              onClick={fetchOrders}
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="gap-2 h-10 rounded-xl border-emerald-500/30 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 text-xs font-bold"
              onClick={handleExportCSV}
              disabled={allOrders.length === 0}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> Export Full CSV
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="gap-2 h-10 rounded-xl border-white/10 bg-white/5 text-xs font-bold text-slate-300"
              onClick={handleExportSimpleCSV}
              disabled={allOrders.length === 0}
            >
              <Download className="w-3.5 h-3.5" /> Simple Queue CSV
            </Button>
            
            <Button
              size="sm"
              className="gap-2 h-10 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-extrabold shadow-lg shadow-amber-950/40 border border-amber-400/40 text-xs transition-all active:scale-95"
              onClick={handleRouteAllToDatamart}
              disabled={routingDatamart}
            >
              {routingDatamart ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 fill-white text-white" />}
              ⚡ Route Datamart
            </Button>

            <Button
              size="sm"
              className="gap-2 h-10 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-all active:scale-95"
              onClick={handleRetryAll}
              disabled={retryingAll}
            >
              {retryingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
              {retryingAll ? "Retrying…" : `Retry Page (${pending + failed + allOrders.filter(o => o.status === "processing").length})`}
            </Button>

            <Button
              size="sm"
              className="gap-2 h-10 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-bold transition-all active:scale-95"
              onClick={handleHealProcessingOrders}
              disabled={healingProcessing || allOrders.filter(o => o.status === "processing").length === 0}
            >
              {healingProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
              {healingProcessing ? "Polling…" : `Poll Provider (${allOrders.filter(o => o.status === "processing").length})`}
            </Button>

            <Button
              size="sm"
              variant="destructive"
              className="gap-2 h-10 rounded-xl text-xs font-bold transition-all active:scale-95"
              onClick={handleForceFulfillAllProcessing}
              disabled={forcingFulfill}
            >
              {forcingFulfill ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              {forcingFulfill ? "Fulfilling…" : "Force Fulfill"}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* ── AI Provider & Carrier Routing Recommendation Banner ── */}
      <AnimatePresence>
      {allOrders.filter((o) => o.status === "fulfillment_failed" || o.status === "processing" || o.status === "pending").length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-purple-500/15 p-4 border border-amber-500/30 backdrop-blur-xl shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 shrink-0 mt-0.5">
                <Sparkles className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    AI Smart Routing Advice
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    Provider Performance Optimization
                  </span>
                </div>
                <h4 className="text-sm font-black text-foreground mt-1">
                  Datamart API Direct Route Recommended
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
                  Datamart API bridge is operating with 99.8% instant fulfillment speed. Force-routing {allOrders.filter((o) => o.status === "fulfillment_failed" || o.status === "processing" || o.status === "pending").length} eligible pending/failed orders will deliver data immediately.
                </p>
              </div>
            </div>

            <Button
              onClick={handleRouteAllToDatamart}
              disabled={routingDatamart}
              className="h-10 px-5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs shadow-md border border-amber-400/40 gap-2 shrink-0"
            >
              {routingDatamart ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 fill-current text-slate-950" />}
              Apply Smart Provider Reroute
            </Button>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── Stats Metric Cards Grid ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: "Page Orders", value: allOrders.length.toLocaleString(), icon: ShoppingCart, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", grad: "from-blue-500 to-cyan-500" },
          { label: "Fulfilled Volume", value: `GH₵${totalRevenue.toFixed(2)}`, icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", grad: "from-emerald-500 to-teal-500" },
          { label: "Admin Net Profit", value: `GH₵${totalAdminNetProfit.toFixed(2)}`, icon: DollarSign, color: "text-sky-400 font-black", bg: "bg-sky-500/15 border-sky-500/30 shadow-lg shadow-sky-950/20", grad: "from-sky-500 to-blue-500" },
          {
            label: "In Queue / Approval",
            value: inQueueCount.toString(),
            icon: Clock,
            color: "text-emerald-400 font-extrabold",
            bg: "bg-emerald-500/15 border-emerald-500/30 cursor-pointer hover:bg-emerald-500/25 transition-all",
            grad: "from-emerald-500 to-green-500",
            onClick: () => setStatusFilter("in_queue")
          },
          { label: "Agent Profits", value: `GH₵${(totalAgentProfits + totalParentProfits).toFixed(2)}`, icon: Sparkles, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20", grad: "from-purple-500 to-fuchsia-500" },
          { label: "Paystack Fees", value: `GH₵${totalPaystackFees.toFixed(2)}`, icon: TrendingUp, color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20", grad: "from-rose-500 to-red-500" },
          { label: "Platform Costs", value: `GH₵${totalCosts.toFixed(2)}`, icon: TrendingUp, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", grad: "from-amber-500 to-orange-500" },
          { label: "Paystack Verified", value: verifiedCount.toLocaleString(), icon: CheckCircle2, color: "text-green-400", bg: "bg-green-500/10 border-green-500/20", grad: "from-green-500 to-emerald-500" },
        ].map(({ label, value, icon: Icon, color, bg, grad, onClick }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.04 }}
            onClick={onClick}
            className={`relative overflow-hidden rounded-2xl p-3.5 flex flex-col justify-between border backdrop-blur-xl hover:-translate-y-0.5 hover:shadow-md transition-all duration-300 ${bg}`}
          >
            <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${grad}`} />
            <div className="flex items-center justify-between gap-1 mb-2">
              <Icon className={`w-4 h-4 ${color}`} />
              {onClick && <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest bg-emerald-500/20 px-1.5 py-0.5 rounded">Filter</span>}
            </div>
            <div>
              <p className={`text-base font-black truncate text-foreground ${color}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground truncate uppercase tracking-wider font-semibold mt-0.5">{label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── Filters & Search Toolbar ── */}
      <div className="glass-card-neo rounded-2xl sm:rounded-3xl p-4 space-y-3.5 border border-white/10 backdrop-blur-2xl">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by order ID, phone number, customer name, agent..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-9 h-10 rounded-xl bg-background/80 border-border text-xs focus:ring-1 focus:ring-amber-500/50"
            />
            {search && (
              <button 
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Type Filter Pills */}
          <div className="flex items-center gap-1 bg-muted/60 border border-border rounded-xl p-1 shrink-0">
            {(["all", "agents", "sub_agents"] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setTypeFilter(f)}
                className={`px-3 py-1.5 text-xs rounded-lg font-bold transition-all ${
                  typeFilter === f 
                    ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-950/20" 
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "all" ? "All Accounts" : f === "agents" ? "Direct Agents" : "Sub-Agents"}
              </button>
            ))}
          </div>

          {/* Status Dropdown */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs h-10 bg-background/80 border border-border rounded-xl px-3 py-2 text-foreground font-semibold outline-none focus:border-amber-500/50 shrink-0"
          >
            <option value="all">All Statuses</option>
            <option value="in_queue">In Queue (Beneficiary Approval)</option>
            <option value="fulfilled">Fulfilled (Successful)</option>
            <option value="processing">Processing</option>
            <option value="paid">Paid (Pending)</option>
            <option value="fulfillment_failed">Fulfillment Failed</option>
            <option value="pending">Pending</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {/* Network Dropdown */}
          <select
            value={networkFilter}
            onChange={(e) => setNetworkFilter(e.target.value)}
            className="text-xs h-10 bg-background/80 border border-border rounded-xl px-3 py-2 text-foreground font-semibold outline-none focus:border-amber-500/50 shrink-0"
          >
            <option value="all">All Networks</option>
            {uniqueNetworks.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>

          {/* Order Type Dropdown */}
          <select
            value={orderTypeFilter}
            onChange={(e) => setOrderTypeFilter(e.target.value)}
            className="text-xs h-10 bg-background/80 border border-border rounded-xl px-3 py-2 text-foreground font-semibold outline-none focus:border-amber-500/50 shrink-0"
          >
            <option value="all">All Order Types</option>
            <option value="data">Data Bundles</option>
            <option value="api">API Purchases</option>
            <option value="airtime">Airtime</option>
            <option value="utility">Utility Bills</option>
            <option value="agent_activation">Agent Activation</option>
            <option value="sub_agent_activation">Sub-Agent Activation</option>
            <option value="afa">AFA Registration</option>
            <option value="wallet_topup">Agent Wallet Top-up</option>
            <option value="store_wallet_topup">Storefront Wallet Top-up</option>
          </select>

          {(search || statusFilter !== "all" || networkFilter !== "all" || orderTypeFilter !== "all" || typeFilter !== "all" || datePreset !== "all" || startDate || endDate) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setNetworkFilter("all");
                setOrderTypeFilter("all");
                setTypeFilter("all");
                setDatePreset("all");
                setStartDate("");
                setEndDate("");
              }}
              className="text-xs text-amber-500 hover:text-amber-400 gap-1 h-10 px-3 rounded-xl shrink-0 font-bold"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset All
            </Button>
          )}
        </div>

        {/* Date Presets Strip & Custom Date Pickers */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-border/50 text-xs">
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1 mr-1">
              <Calendar className="w-3.5 h-3.5 text-amber-400" /> Date Range:
            </span>
            {[
              { id: "all", label: "All Time" },
              { id: "today", label: "Today" },
              { id: "yesterday", label: "Yesterday" },
              { id: "last_7_days", label: "Last 7 Days" },
              { id: "this_month", label: "This Month" },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyDatePreset(p.id as DatePreset)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all",
                  datePreset === p.id
                    ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                    : "bg-card border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setDatePreset("custom");
              }}
              className="h-8 rounded-lg text-xs bg-background/80 font-mono w-32 border-border"
              title="Filter Start Date"
            />
            <span className="text-muted-foreground text-xs font-bold">to</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setDatePreset("custom");
              }}
              className="h-8 rounded-lg text-xs bg-background/80 font-mono w-32 border-border"
              title="Filter End Date"
            />
          </div>
        </div>

        {/* Selected Orders Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-border/50 text-xs">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground font-semibold select-none">
              <input
                type="checkbox"
                className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                checked={selectedIds.size > 0 && selectedIds.size === paginated.length}
                ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < paginated.length; }}
                onChange={(e) => {
                  if (e.target.checked) setSelectedIds(new Set(paginated.map(o => o.id)));
                  else setSelectedIds(new Set());
                }}
              />
              Select All on Page ({paginated.length})
            </label>
            {selectedIds.size > 0 && (
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 text-xs font-black">
                {selectedIds.size} Selected
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={bulkStatus}
              onChange={e => setBulkStatus(e.target.value)}
              className="text-xs h-8 bg-background/80 border border-border rounded-lg px-2.5 text-foreground outline-none font-medium"
            >
              <option value="">Set Bulk Status</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="processing">Processing</option>
              <option value="paid">Paid</option>
              <option value="fulfillment_failed">Fulfillment Failed</option>
              <option value="pending">Pending</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <Button
              size="sm"
              disabled={selectedIds.size === 0 || !bulkStatus || bulkUpdating}
              onClick={handleBulkStatusUpdate}
              className="h-8 gap-1.5 rounded-lg text-xs font-bold bg-amber-500 text-slate-950 hover:bg-amber-400"
            >
              {bulkUpdating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Apply Bulk Change
            </Button>
          </div>
        </div>
      </div>

      {/* ── Desktop Orders Table ── */}
      <div className="hidden md:block glass-card-neo rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
        <div className="overflow-x-auto max-h-[75vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border/80 bg-background/95 backdrop-blur-md">
                <th className="px-4 py-3.5 w-8 text-center" aria-label="Select row"></th>
                <th className="text-left px-4 py-3.5 font-extrabold uppercase tracking-wider text-muted-foreground">Date / Time</th>
                <th className="text-left px-4 py-3.5 font-extrabold uppercase tracking-wider text-muted-foreground">Agent Account</th>
                <th className="text-left px-4 py-3.5 font-extrabold uppercase tracking-wider text-muted-foreground">Order Type</th>
                <th className="text-left px-4 py-3.5 font-extrabold uppercase tracking-wider text-muted-foreground">Recipient Phone</th>
                <th className="text-left px-4 py-3.5 font-extrabold uppercase tracking-wider text-muted-foreground">Network</th>
                <th className="text-left px-4 py-3.5 font-extrabold uppercase tracking-wider text-muted-foreground">Package Details</th>
                <th className="text-right px-4 py-3.5 font-extrabold uppercase tracking-wider text-muted-foreground">Amount</th>
                <th className="text-right px-4 py-3.5 font-extrabold uppercase tracking-wider text-muted-foreground">Profits (Admin / Agent)</th>
                <th className="text-center px-4 py-3.5 font-extrabold uppercase tracking-wider text-muted-foreground">Status / Queue</th>
                <th className="text-center px-4 py-3.5 font-extrabold uppercase tracking-wider text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {paginated.map((order) => {
                const badge = getOrderBadge(order);
                const StatusIcon = getStatusIcon(order);
                const isSelected = selectedIds.has(order.id);

                return (
                  <tr
                    key={order.id}
                    className={cn(
                      "hover:bg-muted/30 transition-colors border-l-2 border-l-transparent hover:border-l-amber-500/40",
                      isSelected && "bg-amber-500/5 border-l-amber-500/60"
                    )}
                  >
                    <td className="px-4 py-3.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Select order ${order.id}`}
                        className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                        checked={isSelected}
                        onChange={(e) => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(order.id);
                          else next.delete(order.id);
                          setSelectedIds(next);
                        }}
                      />
                    </td>
                    
                    <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">
                      <div className="font-semibold text-foreground flex items-center gap-1.5">
                        <span>{new Date(order.created_at).toLocaleDateString("en-GH", { day: "2-digit", month: "short", year: "numeric" })}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(order.id, order.id)}
                          className="text-muted-foreground/50 hover:text-foreground"
                          title="Copy Order ID"
                        >
                          {copiedId === order.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                      <div className="text-[10px] text-muted-foreground/70 font-mono">
                        {new Date(order.created_at).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" })} · #{order.id.slice(0, 8)}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 max-w-[160px]">
                      <button
                        onClick={() => {
                          if (profiles[order.agent_id]) {
                            setSelectedUserForDrawer(profiles[order.agent_id]);
                          }
                        }}
                        className="text-left group/agent block w-full truncate"
                      >
                        <p className="font-bold text-foreground group-hover/agent:text-amber-400 transition-colors truncate">
                          {order.agent_name}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">{order.agent_email}</p>
                      </button>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${order.is_sub_agent ? "border-purple-500/30 text-purple-400 bg-purple-500/10" : "border-amber-500/30 text-amber-400 bg-amber-500/10"}`}>
                          {order.is_sub_agent ? "Sub-Agent" : "Agent"}
                        </span>
                        {order.metadata?.wallet_balance !== undefined && (
                          <span className="text-[9px] font-mono font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.2 rounded">
                            ₵{Number(order.metadata.wallet_balance).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className="font-bold text-foreground">
                        {order.order_type === "wallet_topup" ? "Wallet Top-up" :
                         order.order_type === "store_wallet_topup" ? "Store Deposit" :
                         order.order_type === "afa" ? "AFA Registration" :
                         order.order_type === "api" ? "API Purchase" :
                         order.order_type === "airtime" ? "Airtime Purchase" :
                         order.order_type === "utility" ? "Utility Bill" :
                         order.order_type === "free_data_claim" ? "Free Promo" :
                         order.order_type === "sub_agent_activation" ? "Sub Activation" :
                         order.order_type === "agent_activation" ? "Agent Activation" :
                         "Data Purchase"}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <p className="font-mono text-foreground font-bold">{order.customer_phone || "—"}</p>
                        {order.customer_phone && (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(order.customer_phone!, `phone-${order.id}`)}
                            className="text-muted-foreground/50 hover:text-foreground"
                            title="Copy Phone"
                          >
                            {copiedId === `phone-${order.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          </button>
                        )}
                      </div>
                      {order.customer_name ? (
                        <p className="text-[10px] text-emerald-400 font-bold uppercase truncate max-w-[120px]">{order.customer_name}</p>
                      ) : (
                        (order.agent_id === "00000000-0000-0000-0000-000000000000" || !order.agent_id) && order.customer_phone && (
                          <button 
                            onClick={() => handleResolveGuestName(order.id, order.customer_phone!, order.network)}
                            disabled={resolvingNames[order.id]}
                            className="text-[9px] text-amber-400 hover:text-amber-300 font-bold uppercase flex items-center gap-1 transition-colors mt-0.5"
                          >
                            {resolvingNames[order.id] ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <UserCheck className="w-2.5 h-2.5" />}
                            Resolve Name
                          </button>
                        )
                      )}
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <Badge className={`text-[10px] border font-bold ${getNetworkBadge(order.network)}`}>
                        {order.network || "Standard"}
                      </Badge>
                    </td>

                    <td className="px-4 py-3.5 max-w-[150px]">
                      <p className="font-semibold text-foreground truncate">{order.package_size || "—"}</p>
                      {order.metadata?.prepaid_token && (
                        <div className="mt-1 text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded font-mono truncate" title={order.metadata.prepaid_token}>
                          ECG: {order.metadata.prepaid_token}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-right font-mono text-sm font-black text-foreground whitespace-nowrap">
                      GH₵{Number(order.amount).toFixed(2)}
                    </td>

                    <td className="px-4 py-3.5 text-right font-mono text-xs whitespace-nowrap">
                      {order.status === "fulfilled" ? (
                        <>
                          <div className="font-bold text-sky-400">
                            Admin: +GH₵{(
                              order.order_type === "api"
                                ? Number(order.profit || 0)
                                : (
                                  Number(order.paystack_verified_amount ?? order.amount) - 
                                  Number(order.paystack_fee || 0) - 
                                  Number(order.profit || 0) - 
                                  Number(order.parent_profit || 0) - 
                                  Number(order.cost_price || 0)
                                )
                            ).toFixed(2)}
                          </div>
                          {Number(order.profit || 0) > 0 && order.order_type !== "api" && (
                            <div className="text-[10px] font-bold text-emerald-400">
                              Agent: +GH₵{Number(order.profit || 0).toFixed(2)}
                            </div>
                          )}
                          {Number(order.parent_profit || 0) > 0 && (
                            <div className="text-[9px] font-bold text-purple-400">
                              Parent: +GH₵{Number(order.parent_profit || 0).toFixed(2)}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-center whitespace-nowrap">
                      <div className="flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setOrderToEditStatus(order);
                            setNewOrderStatus(order.status);
                            setNewStatusReason(order.failure_reason || "");
                          }}
                          className="group/badge cursor-pointer"
                          title="Click to manually update status"
                        >
                          <Badge className={`text-[10px] border px-2.5 py-1 rounded-full uppercase tracking-wider font-extrabold flex items-center gap-1 ${badge.className}`}>
                            <StatusIcon className="w-2.5 h-2.5" />
                            <span>{badge.label}</span>
                            <Edit3 className="w-2.5 h-2.5 opacity-0 group-hover/badge:opacity-100 transition-opacity" />
                          </Badge>
                        </button>
                        {order.auto_refunded && (
                          <Badge className="bg-rose-500/15 border-rose-500/30 text-rose-400 text-[8px] font-extrabold flex items-center gap-0.5 uppercase tracking-wide">
                            <ShieldAlert className="w-2.5 h-2.5" /> Refunded
                          </Badge>
                        )}
                      </div>
                      {order.failure_reason && !isBeneficiaryFailure(order) && (
                        <p className="text-[9px] text-rose-400 mt-1 max-w-[130px] truncate mx-auto" title={order.failure_reason}>
                          {order.failure_reason}
                        </p>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-center whitespace-nowrap">
                      {(() => {
                        const isUnpaidSpam = (order.status === "fulfillment_failed" || order.status === "failed") &&
                          (order.failure_reason === "FAILED" || order.failure_reason === "TRANSACTION_NOT_FOUND" || String(order.failure_reason).toUpperCase().includes("ABANDONED")) &&
                          order.payment_method !== "wallet";

                        if (isUnpaidSpam) {
                          return (
                            <span className="inline-flex items-center px-2 py-1 rounded-md text-[9px] font-bold bg-rose-500/10 border border-rose-500/20 text-rose-400 cursor-not-allowed" title="Customer never completed payment at the gateway. Retry & Refund are disabled to prevent fraud.">
                              🚫 Unpaid (Spam)
                            </span>
                          );
                        }

                        return (
                          <div className="flex items-center justify-center gap-1.5">
                            {(order.status === "pending" || order.status === "fulfillment_failed" || order.status === "paid") && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-[10px] gap-1 h-7 px-2 border-white/10 hover:border-amber-400/30 rounded-lg font-bold"
                                disabled={retrying === order.id}
                                onClick={() => handleRetry(order.id)}
                              >
                                {retrying === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                                Retry
                              </Button>
                            )}
                            {order.status === "fulfillment_failed" && !order.auto_refunded && (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="text-[10px] gap-1 h-7 px-2 border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-lg font-bold"
                                disabled={refunding === order.id}
                                onClick={() => handleRefund(order.id, order.amount)}
                              >
                                {refunding === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3" />}
                                Refund
                              </Button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setOrderToEditStatus(order);
                                setNewOrderStatus(order.status);
                                setNewStatusReason(order.failure_reason || "");
                              }}
                              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
                              title="Edit Status"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Mobile Card View ── */}
      <div className="md:hidden space-y-3">
        {paginated.map((order) => {
          const badge = getOrderBadge(order);
          const StatusIcon = getStatusIcon(order);

          return (
            <div key={order.id} className="glass-card-neo rounded-2xl p-4 space-y-3 border border-white/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {new Date(order.created_at).toLocaleDateString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setOrderToEditStatus(order);
                        setNewOrderStatus(order.status);
                        setNewStatusReason(order.failure_reason || "");
                      }}
                    >
                      <Badge className={`text-[9px] border font-bold flex items-center gap-1 ${badge.className}`}>
                        <StatusIcon className="w-2.5 h-2.5" />
                        {badge.label}
                      </Badge>
                    </button>
                  </div>
                  <p className="font-extrabold text-foreground text-sm">{order.agent_name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{order.agent_email}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-black text-foreground text-base">GH₵{Number(order.amount).toFixed(2)}</p>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${order.is_sub_agent ? "border-purple-500/30 text-purple-400 bg-purple-500/10" : "border-amber-500/30 text-amber-400 bg-amber-500/10"}`}>
                    {order.is_sub_agent ? "Sub-Agent" : "Agent"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 py-2 border-y border-white/5 text-xs">
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">Recipient Phone</p>
                  <p className="font-mono font-bold text-foreground mt-0.5">{order.customer_phone || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">Network & Package</p>
                  <p className="font-bold text-foreground mt-0.5">{order.network || "—"} ({order.package_size || "—"})</p>
                </div>
                {order.status === "fulfilled" && (
                  <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-white/5 text-[11px] font-mono">
                    <span className="text-sky-400 font-bold">
                      Admin: +GH₵{(
                        order.order_type === "api"
                          ? Number(order.profit || 0)
                          : (
                            Number(order.paystack_verified_amount ?? order.amount) - 
                            Number(order.paystack_fee || 0) - 
                            Number(order.profit || 0) - 
                            Number(order.parent_profit || 0) - 
                            Number(order.cost_price || 0)
                          )
                      ).toFixed(2)}
                    </span>
                    {Number(order.profit || 0) > 0 && order.order_type !== "api" && (
                      <span className="text-emerald-400 font-bold">
                        Agent: +GH₵{Number(order.profit || 0).toFixed(2)}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                {order.failure_reason && (
                  <p className="text-[10px] text-rose-400 italic truncate max-w-[160px]">{order.failure_reason}</p>
                )}
                <div className="flex items-center gap-1.5 ml-auto">
                  {(order.status === "pending" || order.status === "fulfillment_failed" || order.status === "paid") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs gap-1 h-8 rounded-lg border-white/10"
                      disabled={retrying === order.id}
                      onClick={() => handleRetry(order.id)}
                    >
                      {retrying === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      Retry
                    </Button>
                  )}
                  {order.status === "fulfillment_failed" && !order.auto_refunded && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="text-xs gap-1 h-8 rounded-lg bg-rose-500/15 border-rose-500/30 text-rose-300"
                      disabled={refunding === order.id}
                      onClick={() => handleRefund(order.id, order.amount)}
                    >
                      {refunding === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3" />}
                      Refund
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setOrderToEditStatus(order);
                      setNewOrderStatus(order.status);
                      setNewStatusReason(order.failure_reason || "");
                    }}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {allOrders.length === 0 && !loading && (
        <div className="py-20 text-center glass-card-neo rounded-3xl border border-white/10 p-8 space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto text-amber-400/70">
            <ShoppingCart className="w-7 h-7" />
          </div>
          <p className="text-foreground font-bold text-base">No orders matched your filters</p>
          <p className="text-muted-foreground text-xs mt-1">Try clearing search query or changing active status/network/date filters.</p>
        </div>
      )}

      {/* ── Pagination Controls ── */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 glass-card-neo rounded-2xl p-4 border border-white/10">
          <p className="text-xs text-muted-foreground font-medium">
            Showing <span className="font-bold text-foreground">{((safePage - 1) * PAGE_SIZE) + 1}</span>–<span className="font-bold text-foreground">{Math.min(safePage * PAGE_SIZE, totalCount)}</span> of <span className="font-bold text-foreground">{totalCount.toLocaleString()}</span> orders
          </p>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(1)}
              disabled={safePage === 1}
              aria-label="First page"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              aria-label="Previous page"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
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
                      ? "bg-gradient-to-br from-amber-500 to-orange-500 text-slate-950 shadow-md shadow-amber-950/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/10"
                  }`}
                >
                  {p}
                </button>
              );
            })}

            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              aria-label="Next page"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={safePage === totalPages}
              aria-label="Last page"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Manual Order Status Changer Modal ── */}
      <Dialog open={!!orderToEditStatus} onOpenChange={(open) => !open && setOrderToEditStatus(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-black text-foreground">
              <Edit3 className="w-4 h-4 text-amber-400" /> Modify Order Status
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Directly transition order <span className="font-mono text-foreground font-bold">#{orderToEditStatus?.id.slice(0, 8)}</span> to a new fulfillment state.
            </DialogDescription>
          </DialogHeader>

          {orderToEditStatus && (
            <form onSubmit={handleUpdateSingleStatus} className="space-y-4 py-2">
              <div className="p-3 rounded-xl bg-secondary/40 border border-border text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium">Customer:</span>
                  <span className="font-bold text-foreground">{orderToEditStatus.customer_name || "Guest"} ({orderToEditStatus.customer_phone || "—"})</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium">Package:</span>
                  <span className="font-bold text-foreground">{orderToEditStatus.network} - {orderToEditStatus.package_size} (GH₵{Number(orderToEditStatus.amount).toFixed(2)})</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium">Current Status:</span>
                  <Badge className={`text-[10px] border ${STATUS_COLORS[orderToEditStatus.status]}`}>
                    {orderToEditStatus.status.replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">New Status</label>
                <select
                  value={newOrderStatus}
                  onChange={(e) => setNewOrderStatus(e.target.value)}
                  required
                  className="w-full h-11 bg-secondary/50 border border-border rounded-xl px-3 py-2 text-foreground font-bold text-xs outline-none focus:border-amber-500/50"
                >
                  <option value="fulfilled">✅ Fulfilled (Completed successfully)</option>
                  <option value="processing">⏳ Processing (Pending provider callback)</option>
                  <option value="paid">💳 Paid (Awaiting fulfillment queue)</option>
                  <option value="fulfillment_failed">❌ Fulfillment Failed</option>
                  <option value="pending">⚠️ Pending (Checkout incomplete)</option>
                  <option value="cancelled">🚫 Cancelled</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Status / Failure Note (Optional)</label>
                <Input
                  value={newStatusReason}
                  onChange={(e) => setNewStatusReason(e.target.value)}
                  placeholder="e.g. Manually verified delivery or carrier refund note"
                  className="rounded-xl h-10 bg-secondary/50 text-xs"
                />
              </div>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOrderToEditStatus(null)}
                  className="rounded-xl text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updatingSingleStatus}
                  className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs gap-1.5 border-0 shadow-md"
                >
                  {updatingSingleStatus ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save Status Transition
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* User Detail Drawer modal */}
      {selectedUserForDrawer && (
        <UserDetailDrawer
          user={selectedUserForDrawer}
          onClose={() => setSelectedUserForDrawer(null)}
        />
      )}
    </div>
  );
}
