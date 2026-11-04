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
  CheckCircle2, PlayCircle, PauseCircle, UserCheck, Download,
  Coins, ShieldAlert, Zap, Check, X,
  DollarSign, Sparkles, AlertCircle, AlertTriangle, Copy, Activity,
  Calendar, FileSpreadsheet, Edit3, FileText, Smartphone, ChevronDown
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";
import UserDetailDrawer from "@/components/UserDetailDrawer";
import WhatsAppReceiptModal from "@/components/WhatsAppReceiptModal";
import { ProviderBadge } from "@/components/ProviderBadge";
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
  provider_id?: string | null;
  provider_order_id?: string | null;
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

function isBeneficiaryFailure(order: Pick<OrderRow, "status" | "failure_reason"> & { network?: string; order_type?: string }): boolean {
  if (order.status !== "fulfillment_failed") return false;
  const net = String(order.network || "").toUpperCase();
  const isMtn = net.includes("MTN") || net.includes("YELLO");
  const isData = !order.order_type || order.order_type === "data" || order.order_type === "sme";
  if (!isMtn || !isData) return false;

  const reason = (order.failure_reason || "").toLowerCase();
  return reason.includes("beneficiary") || reason.includes("not added");
}

function isOrderApiPaused(order: Pick<OrderRow, "provider_order_id" | "metadata" | "status">): boolean {
  return (
    order.provider_order_id === "paused_by_admin" ||
    order.metadata?.api_paused === true ||
    order.provider_order_id === "manual_fulfillment_mode" ||
    order.status === "paused"
  );
}

function canPauseOrResumeOrder(order: OrderRow): boolean {
  const isNonTelecom = [
    "wallet_topup",
    "store_wallet_topup",
    "agent_activation",
    "sub_agent_activation",
    "vendor_activation",
    "free_data_claim",
  ].includes(String(order.order_type || "").toLowerCase());
  if (isNonTelecom) return false;
  if (order.status === "fulfilled" || order.status === "completed" || order.status === "cancelled" || order.auto_refunded) {
    return false;
  }
  if (isOrderApiPaused(order)) return true;
  const provRef = String(order.provider_order_id || "").trim();
  const hasLiveExternalRef =
    provRef.length > 0 &&
    !["failed_api_call", "timeout", "dispatching", "duplicate_cooldown", "paused_by_admin", "manual_fulfillment_mode", "refunded"].includes(provRef);
  return !hasLiveExternalRef;
}

function formatOrderFailureReason(
  order: Pick<OrderRow, "failure_reason"> & {
    network?: string | null;
    order_type?: string;
    status?: string;
    provider_order_id?: string | null;
  }
): string {
  if (!order.failure_reason) return "";
  if (order.status === "fulfilled") return "";
  const provRef = String(order.provider_order_id || "").trim();
  const hasActiveProviderRef =
    provRef.length > 0 && !["failed_api_call", "timeout", "dispatching", "paused_by_admin", "manual_fulfillment_mode"].includes(provRef);
  if (order.status === "processing" && hasActiveProviderRef) {
    return "";
  }
  const net = String(order.network || "").toUpperCase();
  const isMtn = net.includes("MTN") || net.includes("YELLO");
  const isData = !order.order_type || order.order_type === "data" || order.order_type === "sme";
  const rUpper = order.failure_reason.toUpperCase();

  if (rUpper.startsWith("ROUTE NOT FOUND")) {
    return order.failure_reason.replace(/^Route not found/i, "Order not found on provider");
  }

  // If a non-MTN, non-SME, or Korba order somehow has the generic MTN error message saved, clean it up for display
  if ((!isMtn || !isData) && (rUpper.includes("MTN DATA TRANSFER LIMIT") || rUpper.includes("MTN BENEFICIARY ERROR") || rUpper.includes("UNSUPPORTED PLAN (E.G. CORPORATE SIM)"))) {
    return order.order_type === "airtime"
      ? "Airtime delivery failed by carrier. Check recipient or balance."
      : "Delivery declined by carrier network.";
  }
  return order.failure_reason;
}

const BENEFICIARY_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  submitted: { label: "in queue", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold shadow-sm" },
  whitelisted: { label: "in queue", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold shadow-sm" },
  in_queue: { label: "in queue", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold shadow-sm" },
};

type FilterType = "all" | "agents" | "sub_agents";
type DatePreset = "all" | "today" | "yesterday" | "last_7_days" | "last_30_days" | "this_month" | "custom";

const PAGE_SIZE = 50;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const [checkingStatusId, setCheckingStatusId] = useState<string | null>(null);
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
  const [syncingBalances, setSyncingBalances] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [autoRouterQueueCount, setAutoRouterQueueCount] = useState<number>(0);
  const [retryingAutoRouter, setRetryingAutoRouter] = useState(false);

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

  // Receipt Modal and SMS Resend State
  const [receiptOrder, setReceiptOrder] = useState<OrderRow | null>(null);
  const [resendingSmsId, setResendingSmsId] = useState<string | null>(null);
  const [bulkResendingSms, setBulkResendingSms] = useState(false);
  const [bulkCheckingStatus, setBulkCheckingStatus] = useState(false);

  // API Pause / Hold State
  const [pausingOrderId, setPausingOrderId] = useState<string | null>(null);
  const [bulkPausing, setBulkPausing] = useState(false);
  const [globalApiPaused, setGlobalApiPaused] = useState(false);
  const [togglingGlobalPause, setTogglingGlobalPause] = useState(false);

  const handleQuickResendSms = async (order: OrderRow) => {
    if (!order.customer_phone) {
      toast({ title: "No Phone Number", description: "Order has no customer phone number.", variant: "destructive" });
      return;
    }
    setResendingSmsId(order.id);
    try {
      const statusLabel = order.status === "fulfilled" ? "FULFILLED & DELIVERED 🎉" :
                          order.status === "processing" ? "PROCESSING ⏳" :
                          order.status === "pending" ? "PENDING ⏳" :
                          order.status === "fulfillment_failed" || order.status === "failed" ? "FAILED ❌" :
                          order.status.toUpperCase();

      const smsMessage = `SwiftData Alert: Order #${order.id.slice(0, 8).toUpperCase()} for ${order.customer_phone} (${order.network || ""} ${order.package_size || ""}, GHS ${Number(order.amount || 0).toFixed(2)}) Status: [${statusLabel}]. Thank you!`;
      const { error } = await supabase.functions.invoke("send-order-sms", {
        body: {
          phone: order.customer_phone,
          action: "custom",
          custom_message: smsMessage,
          order_id: order.id,
          amount: order.amount,
          package_size: order.package_size,
          network: order.network,
          agent_id: order.agent_id,
          status: order.status,
        },
      });

      if (error) throw error;

      toast({
        title: "SMS Resent! 📱",
        description: `Order receipt SMS sent to ${order.customer_phone}.`,
      });
    } catch (err: any) {
      console.error("Resend SMS error:", err);
      toast({
        title: "Failed to Send SMS",
        description: err.message || "An error occurred while sending SMS.",
        variant: "destructive",
      });
    } finally {
      setResendingSmsId(null);
    }
  };

  const handleBulkResendSms = async () => {
    if (selectedIds.size === 0) return;
    setBulkResendingSms(true);
    let successCount = 0;
    let failCount = 0;

    const selectedOrdersList = allOrders.filter(o => selectedIds.has(o.id) && o.customer_phone);

    for (const order of selectedOrdersList) {
      try {
        const statusLabel = order.status === "fulfilled" ? "FULFILLED & DELIVERED 🎉" :
                            order.status === "processing" ? "PROCESSING ⏳" :
                            order.status === "pending" ? "PENDING ⏳" :
                            order.status === "fulfillment_failed" || order.status === "failed" ? "FAILED ❌" :
                            order.status.toUpperCase();

        const smsMessage = `SwiftData Alert: Order #${order.id.slice(0, 8).toUpperCase()} for ${order.customer_phone} (${order.network || ""} ${order.package_size || ""}, GHS ${Number(order.amount || 0).toFixed(2)}) Status: [${statusLabel}]. Thank you!`;
        const { error } = await supabase.functions.invoke("send-order-sms", {
          body: {
            phone: order.customer_phone,
            action: "custom",
            custom_message: smsMessage,
            order_id: order.id,
            amount: order.amount,
            package_size: order.package_size,
            network: order.network,
            agent_id: order.agent_id,
            status: order.status,
          },
        });
        if (error) failCount++;
        else successCount++;
      } catch (err) {
        failCount++;
      }
    }

    setBulkResendingSms(false);
    toast({
      title: "Bulk SMS Complete 📱",
      description: `Sent SMS to ${successCount} order(s). ${failCount > 0 ? `Failed: ${failCount}` : ""}`,
    });
  };

  const fetchAutoRouterQueueCount = useCallback(async () => {
    try {
      const { data } = await supabase.functions.invoke("admin-retry-autorouter", {
        body: { count_only: true }
      });
      if (data && typeof data.count === "number") {
        setAutoRouterQueueCount(data.count);
      }
    } catch (err) {
      console.error("Failed to fetch auto router queue count:", err);
    }
  }, []);

  const fetchProviders = useCallback(async () => {
    const { data } = await supabase.from("providers").select("*").order("name", { ascending: true });
    setProviders(data || []);
  }, []);

  const fetchGlobalPauseState = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("system_settings")
        .select("manual_fulfillment_mode")
        .eq("id", 1)
        .maybeSingle();
      if (data) {
        setGlobalApiPaused(Boolean((data as any).manual_fulfillment_mode));
      }
    } catch (err) {
      console.error("Failed to fetch global API pause setting:", err);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
    fetchAutoRouterQueueCount();
    fetchGlobalPauseState();
  }, [fetchProviders, fetchAutoRouterQueueCount, fetchGlobalPauseState]);

  const [pausingProviderId, setPausingProviderId] = useState<string | null>(null);

  const handleTogglePauseProvider = async (prov: any) => {
    const currentlyPaused = prov?.settings?.is_paused === true;
    const nextPaused = !currentlyPaused;
    setPausingProviderId(prov.id);
    try {
      const nextSettings = {
        ...(prov.settings || {}),
        is_paused: nextPaused,
        paused_at: nextPaused ? new Date().toISOString() : null,
      };
      const { error } = await (supabase.from("providers") as any)
        .update({ settings: nextSettings })
        .eq("id", prov.id);
      if (error) throw error;

      setProviders((prev) =>
        prev.map((p) => (p.id === prov.id ? { ...p, settings: nextSettings } : p))
      );

      if (currentUser) {
        await logAudit(currentUser.id, nextPaused ? "admin_pause_provider_api" : "admin_resume_provider_api", {
          provider_id: prov.id,
          provider_name: prov.name,
        });
      }

      if (nextPaused) {
        toast({
          title: `⏸ ${prov.name} API Paused`,
          description: `Orders will now be held from entering ${prov.name} until you click Resume API.`,
        });
      } else {
        toast({
          title: `▶ ${prov.name} API Resumed`,
          description: `Releasing any orders held for ${prov.name}...`,
        });
        try {
          await supabase.functions.invoke("admin-retry-autorouter", {
            body: { resume_api: true, resume_provider_id: prov.id },
          });
          await fetchOrders(true);
          await fetchAutoRouterQueueCount();
        } catch (err) {
          console.warn("Auto-resume dispatch warning:", err);
        }
      }
    } catch (err: any) {
      toast({
        title: nextPaused ? "Failed to Pause Provider API" : "Failed to Resume Provider API",
        description: err.message || "Could not update provider pause state.",
        variant: "destructive",
      });
    } finally {
      setPausingProviderId(null);
    }
  };

  const handleTogglePauseOrder = async (order: OrderRow) => {
    const currentlyPaused = isOrderApiPaused(order);
    setPausingOrderId(order.id);
    try {
      if (currentlyPaused) {
        // Resume order and dispatch to active API provider
        const { data, error } = await invokePublicFunctionAsUser("verify-payment", {
          body: { reference: order.id, force: true, resume_api: true },
        });
        if (error) {
          const description = await getFunctionErrorMessage(error, "Could not resume and dispatch this order.");
          toast({ title: "Resume failed", description, variant: "destructive" });
        } else {
          if (currentUser) {
            await logAudit(currentUser.id, "admin_resume_order_api", {
              order_id: order.id,
              status: data?.status,
              provider_order_id: data?.provider_order_id,
            });
          }
          toast({
            title: data?.status === "fulfilled" ? "Order Resumed & Fulfilled! 🎉" : "Order Resumed & Sent to API ▶️",
            description: data?.message || `Order #${order.id.slice(0, 8)} released to active API provider.`,
          });
        }
        await fetchOrders(true);
        await fetchAutoRouterQueueCount();
      } else {
        // Pause order from entering API provider
        const nextMeta = {
          ...(order.metadata || {}),
          api_paused: true,
          paused_at: new Date().toISOString(),
          paused_by: currentUser?.email || currentUser?.id || "admin",
        };
        const nextStatus = order.status === "paid" ? "processing" : order.status;
        const { error } = await (supabase.from("orders") as any)
          .update({
            status: nextStatus,
            provider_order_id: "paused_by_admin",
            failure_reason: "Paused by admin — held from entering API provider",
            metadata: nextMeta,
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);

        if (error) throw error;

        setAllOrders((prev) =>
          prev.map((o) =>
            o.id === order.id
              ? {
                  ...o,
                  status: nextStatus,
                  provider_order_id: "paused_by_admin",
                  failure_reason: "Paused by admin — held from entering API provider",
                  metadata: nextMeta,
                }
              : o
          )
        );

        if (currentUser) {
          await logAudit(currentUser.id, "admin_pause_order_api", { order_id: order.id });
        }
        toast({
          title: "Order Paused (API Hold) ⏸️",
          description: `Order #${order.id.slice(0, 8)} is now held and blocked from entering any API provider.`,
        });
        await fetchAutoRouterQueueCount();
      }
    } catch (err: any) {
      toast({
        title: currentlyPaused ? "Failed to Resume Order" : "Failed to Pause Order",
        description: err.message || "An error occurred.",
        variant: "destructive",
      });
    } finally {
      setPausingOrderId(null);
    }
  };

  const handleBulkPauseOrders = async (shouldPause: boolean) => {
    if (selectedIds.size === 0) return;
    const selectedEligible = allOrders.filter((o) => selectedIds.has(o.id) && canPauseOrResumeOrder(o));
    if (selectedEligible.length === 0) {
      toast({
        title: "No Eligible Orders Selected",
        description: "Only unfulfilled telecom orders that haven't entered an external provider can be paused or resumed.",
        variant: "destructive",
      });
      return;
    }

    setBulkPausing(true);
    try {
      const ids = selectedEligible.map((o) => o.id);
      if (shouldPause) {
        let pausedCount = 0;
        for (const ord of selectedEligible) {
          const nextMeta = {
            ...(ord.metadata || {}),
            api_paused: true,
            paused_at: new Date().toISOString(),
            paused_by: currentUser?.email || currentUser?.id || "admin",
          };
          const nextStatus = ord.status === "paid" ? "processing" : ord.status;
          const { error } = await (supabase.from("orders") as any)
            .update({
              status: nextStatus,
              provider_order_id: "paused_by_admin",
              failure_reason: "Paused by admin — held from entering API provider",
              metadata: nextMeta,
              updated_at: new Date().toISOString(),
            })
            .eq("id", ord.id);
          if (!error) pausedCount++;
        }
        if (currentUser) {
          await logAudit(currentUser.id, "bulk_pause_orders_api", { order_ids: ids, count: pausedCount });
        }
        toast({
          title: `Paused ${pausedCount} Order(s) ⏸️`,
          description: "Selected orders are now held from entering any API provider.",
        });
        setSelectedIds(new Set());
        await fetchOrders(true);
        await fetchAutoRouterQueueCount();
      } else {
        const { data, error } = await supabase.functions.invoke("admin-retry-autorouter", {
          body: { order_ids: ids, resume_api: true },
        });
        if (error) throw error;
        if (currentUser) {
          await logAudit(currentUser.id, "bulk_resume_orders_api", { order_ids: ids, result: data?.summary });
        }
        toast({
          title: "Orders Resumed & Dispatched! 🚀",
          description: data?.message || `Resumed and routed ${ids.length} order(s) to active API providers.`,
        });
        setSelectedIds(new Set());
        await fetchOrders(true);
        await fetchAutoRouterQueueCount();
      }
    } catch (err: any) {
      toast({
        title: shouldPause ? "Bulk Pause Failed" : "Bulk Resume Failed",
        description: err.message || "Operation failed.",
        variant: "destructive",
      });
    } finally {
      setBulkPausing(false);
    }
  };

  const syncAllProviderBalances = async () => {
    setSyncingBalances(true);
    try {
      const { data: updatedProviders } = await supabase.from("providers").select("*").order("name", { ascending: true });
      if (updatedProviders) setProviders(updatedProviders);

      const activeDataProviders = (updatedProviders || []).filter((p: any) => p.is_active && p.handler_type);
      for (const prov of activeDataProviders) {
        try {
          await supabase.functions.invoke("sync-provider-data", {
            body: { provider_id: prov.id },
          });
        } catch {
          /* continue */
        }
      }

      const { data: finalProviders } = await supabase.from("providers").select("*").order("name", { ascending: true });
      if (finalProviders) setProviders(finalProviders);

      toast({ title: "Balances Updated 🔄", description: "Provider API gateway balances have been refreshed." });
    } catch (err: any) {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    } finally {
      setSyncingBalances(false);
    }
  };

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

  const fetchOrders = useCallback(async (isSilent = false) => {
    if (!isSilent) {
      setLoading(true);
    }

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = supabase
      .from("orders")
      .select("*", { count: "estimated" })
      .order("created_at", { ascending: false });

    // Search filter
    if (search.trim()) {
      const cleanSearch = sanitizeSearchTerm(search);
      const isUuid = UUID_REGEX.test(cleanSearch);
      const isHex8 = /^[0-9a-f]{8}$/i.test(cleanSearch);
      const digitsOnly = cleanSearch.replace(/\D/g, "");
      const isPhoneQuery = /^(\+?233|0)\d{8,9}$/.test(cleanSearch.replace(/\s+/g, "")) && digitsOnly.length >= 9;

      if (isUuid) {
        q = q.or(`id.eq.${cleanSearch},agent_id.eq.${cleanSearch}`);
      } else if (isPhoneQuery) {
        const core9 = digitsOnly.slice(-9);
        const phoneVariants = Array.from(new Set([cleanSearch, `0${core9}`, `233${core9}`, `+233${core9}`, core9]));
        const { data: matchedProfiles } = await supabase
          .from("profiles")
          .select("user_id")
          .in("phone", phoneVariants);
        const matchedUserIds = (matchedProfiles || [])
          .map((p: any) => p.user_id)
          .filter((id: any) => id && UUID_REGEX.test(id));
        if (matchedUserIds.length > 0) {
          q = q.or(`customer_phone.in.(${phoneVariants.join(",")}),agent_id.in.(${matchedUserIds.join(",")})`);
        } else {
          q = q.in("customer_phone", phoneVariants);
        }
      } else {
        const { data: matchedProfiles } = await supabase
          .from("profiles")
          .select("user_id")
          .or(`full_name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,phone.ilike.%${cleanSearch}%`);

        const matchedUserIds = (matchedProfiles || [])
          .map((p: any) => p.user_id)
          .filter((id: any) => id && UUID_REGEX.test(id));
        
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

        if (orParts.length > 0) {
          q = q.or(orParts.join(","));
        }
      }
    }

    // Status Filter
    if (statusFilter !== "all" && statusFilter !== "in_queue" && statusFilter !== "auto_router_queue" && statusFilter !== "parked" && statusFilter !== "paused_api") {
      q = q.eq("status", statusFilter);
    } else if (statusFilter === "paused_api") {
      q = q.or("provider_order_id.eq.paused_by_admin,provider_order_id.eq.manual_fulfillment_mode,metadata->>api_paused.eq.true");
    } else if (statusFilter === "parked") {
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      q = q.eq("status", "processing").lte("created_at", thirtyMinsAgo);
    } else if (statusFilter === "auto_router_queue") {
      const excludedTypes = "(wallet_topup,store_wallet_topup,agent_activation,sub_agent_activation,vendor_activation,free_data_claim)";
      q = q
        .neq("network", "MTN Mash Up")
        .not("package_size", "is", null)
        .not("order_type", "in", excludedTypes)
        .or("status.in.(paid,processing),paystack_verified_amount.gt.0,payment_method.in.(wallet,credit)")
        .or("provider_id.is.null,provider_order_id.is.null,provider_order_id.eq.failed_api_call,provider_order_id.eq.timeout,provider_order_id.eq.manual_fulfillment_mode");
    }
    // Network Filter
    if (networkFilter !== "all") {
      q = q.eq("network", networkFilter);
    }
    // Order Type Filter
    if (orderTypeFilter !== "all") {
      if (orderTypeFilter === "afa") {
        q = q.or("order_type.eq.afa,network.ilike.%AFA%");
      } else {
        q = q.eq("order_type", orderTypeFilter);
      }
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
      if (!isSilent) setLoading(false);
      return;
    }

    setTotalCount(count || 0);

    // Resolve profile and wallet info for only valid UUIDs
    const validAgentIds = [...new Set((data || [])
      .map((o: any) => o.agent_id)
      .filter((id: string) => id && UUID_REGEX.test(id)))];
    
    const currentProfiles: Record<string, AgentProfile> = {};

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

    setAllOrders((prevOrders) => {
      return (data || []).map((o: any) => {
        const profile = currentProfiles[o.agent_id];
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
    });

    if (!isSilent) {
      setLoading(false);
    }
  }, [page, search, statusFilter, networkFilter, orderTypeFilter, startDate, endDate, toast]);

  useEffect(() => {
    const timer = setTimeout(() => fetchOrders(), 200);
    return () => clearTimeout(timer);
  }, [fetchOrders]);

  // Live updates — re-fetch current page silently whenever any order changes
  useRealtimeRefresh({
    tables: ["orders"],
    onRefresh: (isSilent) => {
      fetchOrders(isSilent ?? true);
      fetchAutoRouterQueueCount();
    },
  });

  const handleRetryAutoRouterQueue = async () => {
    const isSelected = selectedIds.size > 0;
    const targetCount = isSelected ? selectedIds.size : autoRouterQueueCount;

    if (targetCount === 0) {
      toast({
        title: "Auto-Router Queue Empty ✨",
        description: "There are currently 0 verified orders waiting for provider dispatch."
      });
      return;
    }

    const confirmMsg = isSelected
      ? `Retry ${selectedIds.size} selected verified order(s) through the 3-tier cascade (DataHub -> Spendless -> SKPlug)?`
      : `Retry all verified orders in Auto-Router queue (${autoRouterQueueCount} pending) through the 3-tier cascade (DataHub -> Spendless -> SKPlug)?`;

    if (!confirm(confirmMsg)) return;

    setRetryingAutoRouter(true);
    toast({
      title: "Auto-Routing Started ⚡",
      description: `Dispatching ${targetCount} verified orders through active provider cascade...`
    });

    try {
      if (isSelected) {
        const ids = Array.from(selectedIds);
        const { data, error } = await supabase.functions.invoke("admin-retry-autorouter", {
          body: { order_ids: ids }
        });
        if (error) throw error;
        toast({
          title: "Auto-Route Complete! 🚀",
          description: data?.message || `Processed ${ids.length} orders.`
        });
        setSelectedIds(new Set());
        if (currentUser) {
          await logAudit(currentUser.id, "bulk_autoroute_selected", { order_ids: ids, result: data?.summary });
        }
      } else {
        let totalFulfilled = 0;
        let totalProcessing = 0;
        let totalFailed = 0;
        const batchLimit = 25;
        let hasMore = true;
        let iteration = 0;
        const maxIterations = 20;

        while (hasMore && iteration < maxIterations) {
          iteration++;
          const { data, error } = await supabase.functions.invoke("admin-retry-autorouter", {
            body: { limit: batchLimit }
          });
          if (error) throw error;

          if (!data || !data.success || !data.summary || data.summary.total === 0) {
            hasMore = false;
            break;
          }

          totalFulfilled += data.summary.fulfilled || 0;
          totalProcessing += data.summary.processing || 0;
          totalFailed += data.summary.failed || 0;

          if (data.remaining_count !== undefined) {
            setAutoRouterQueueCount(data.remaining_count);
            if (data.remaining_count === 0) hasMore = false;
          }
          if (data.summary.total < batchLimit) {
            hasMore = false;
          }
        }

        toast({
          title: "Auto-Routing Complete! 🚀",
          description: `Dispatched orders across active providers: ${totalFulfilled} fulfilled, ${totalProcessing} processing, ${totalFailed} rejected.`
        });

        if (currentUser) {
          await logAudit(currentUser.id, "bulk_autoroute_queue", {
            iterations: iteration,
            fulfilled: totalFulfilled,
            processing: totalProcessing,
            failed: totalFailed
          });
        }
      }

      await fetchOrders();
      await fetchAutoRouterQueueCount();
    } catch (e: any) {
      toast({
        title: "Auto-Route Error",
        description: e.message || "Failed to execute auto-routing",
        variant: "destructive"
      });
    } finally {
      setRetryingAutoRouter(false);
    }
  };

  const handleRouteAllToDatamart = async () => {
    await handleRetryAutoRouterQueue();
  };

  const handleRetry = async (orderId: string, confirmRedispatch = false) => {
    setRetrying(orderId);
    try {
      const { data, error } = await invokePublicFunctionAsUser("verify-payment", {
        body: confirmRedispatch ? { reference: orderId, confirm_redispatch: true } : { reference: orderId },
      });
      if (error) {
        const description = await getFunctionErrorMessage(error, "Could not retry this order.");
        toast({ title: "Retry failed", description, variant: "destructive" });
      } else if (data?.status === "awaiting_provider_confirmation") {
        // Backend blocked the re-send: the provider already holds this order but could not confirm it.
        setRetrying(null);
        const proceed = confirm(
          `⚠️ DOUBLE DELIVERY RISK\n\n${data?.failure_reason || "The provider already has this order."}\n\n` +
          `Only continue if you have CONFIRMED with the provider that this order failed.\n\nRe-send anyway?`
        );
        if (proceed) {
          if (currentUser) {
            await logAudit(currentUser.id, "manual_order_redispatch_override", { order_id: orderId, provider_order_id: data?.provider_order_id });
          }
          await handleRetry(orderId, true);
        } else {
          toast({ title: "Not re-sent", description: "Order left as-is to avoid double delivery." });
        }
        return;
      } else if (data?.status === "fulfilled") {
        if (currentUser) {
          await logAudit(currentUser.id, "manual_order_retry", { order_id: orderId, status: "fulfilled" });
        }
        toast({ title: "Order Fulfilled! 🎉", description: "Data bundle successfully delivered." });
      } else if (data?.status === "processing") {
        if (currentUser) {
          await logAudit(currentUser.id, "manual_order_retry", { order_id: orderId, status: "processing" });
        }
        toast({ 
          title: "Order Dispatched 🚀", 
          description: data?.message || "Order sent to network provider and is currently processing.",
          variant: "default" 
        });
      } else {
        toast({
          title: "Retry status",
          description: data?.failure_reason || `Status: ${data?.status}`,
          variant: "destructive",
        });
      }
      await fetchOrders();
    } catch {
      toast({ title: "Retry error", description: "Could not retry order.", variant: "destructive" });
    }
    setRetrying(null);
  };

  const handleRefund = async (orderId: string, amount: number, mode: "refund" | "refund_and_reroute" = "refund") => {
    const targetOrder = allOrders.find((o) => o.id === orderId);
    const assignedProv = targetOrder?.provider_id ? providers.find((p) => p.id === targetOrder.provider_id) : null;
    const provLabel = assignedProv?.name || "current provider";
    const promptMsg = mode === "refund_and_reroute"
      ? `Verify & re-route order ${orderId.slice(0, 8)} away from ${provLabel} and immediately dispatch to the next available active API provider?`
      : `Are you sure you want to refund GH₵ ${amount.toFixed(2)} for order ${orderId.slice(0, 8)}?`;
    if (!confirm(promptMsg)) {
      return;
    }
    setRefunding(orderId);
    try {
      if (targetOrder?.status === "processing" || targetOrder?.status === "pending" || Boolean(targetOrder?.provider_id) || mode === "refund_and_reroute") {
        const { data: edgeData, error: edgeErr } = await supabase.functions.invoke("verify-and-refund", {
          body: {
            order_id: orderId,
            reference: orderId,
            mode,
            reason: "Cancelled by administrator"
          },
        });
        if (edgeErr || !edgeData?.success) {
          const defaultErr = mode === "refund_and_reroute" ? "Could not re-route order to another provider." : "Order is not eligible for self-refund.";
          const errMsg = edgeData?.error || (edgeErr ? await getFunctionErrorMessage(edgeErr, defaultErr) : defaultErr);
          toast({ title: mode === "refund_and_reroute" ? "Reroute Rejected" : "Self-Refund Rejected", description: errMsg, variant: "destructive" });
          setRefunding(null);
          await fetchOrders();
          return;
        }
        if (currentUser) {
          await logAudit(currentUser.id, mode === "refund_and_reroute" ? "provider_self_refund_and_reroute" : "manual_order_refund", {
            order_id: orderId,
            amount,
            mode,
            result: edgeData,
          });
        }
        if (edgeData.rerouted) {
          toast({
            title: "Order Re-routed! 🚀",
            description: edgeData.message || `Skipped ${provLabel} and dispatched to next available API provider.`,
          });
        } else {
          const newBalText = edgeData.data?.newBalance !== undefined ? ` (New Wallet Balance: GH₵ ${Number(edgeData.data.newBalance).toFixed(2)})` : "";
          toast({
            title: "Order Self-Refunded! 💰",
            description: `${edgeData.message || "Refund credited to wallet."}${newBalText}`,
          });
        }
        await fetchOrders();
        return;
      }

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
      const isSettingPause = newOrderStatus === "paused_by_admin";
      const targetDbStatus = isSettingPause ? "processing" : newOrderStatus;
      const updatedMeta = { ...(orderToEditStatus.metadata || {}) };
      if (isSettingPause) {
        updatedMeta.api_paused = true;
        updatedMeta.paused_at = new Date().toISOString();
      } else {
        delete updatedMeta.api_paused;
        delete updatedMeta.paused_at;
      }

      const nextProviderOrderId = isSettingPause
        ? "paused_by_admin"
        : orderToEditStatus.provider_order_id === "paused_by_admin" || orderToEditStatus.provider_order_id === "manual_fulfillment_mode"
        ? null
        : orderToEditStatus.provider_order_id;

      const { error } = await (supabase
        .from("orders") as any)
        .update({
          status: targetDbStatus,
          provider_order_id: nextProviderOrderId,
          metadata: updatedMeta,
          failure_reason: newStatusReason.trim() || (isSettingPause ? "Paused by admin — held from entering API provider" : null),
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

  const handleCheckProviderStatus = async (orderId: string) => {
    setCheckingStatusId(orderId);
    try {
      const { data, error } = await supabase.functions.invoke("check-order-status", {
        body: { order_id: orderId },
      });

      if (error) throw error;
      if (!data || !data.success) {
        throw new Error(data?.error || "Failed to check provider status");
      }

      const orderData = data.order;
      const newStatus = orderData?.status || "processing";
      const provInfo = data.provider;
      const provName = provInfo?.name || "Provider";
      const rawStatus = provInfo?.raw_status || newStatus;

      setAllOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus, failure_reason: orderData?.failure_reason } : o))
      );

      const smsNote = data.sms_sent ? " (Customer SMS dispatched)" : "";

      toast({
        title: `Provider Status: ${String(rawStatus).toUpperCase()} 📡`,
        description: provInfo 
          ? `${provName} reports "${rawStatus}". Order is "${newStatus.replace(/_/g, " ")}".${smsNote}`
          : `Order is "${newStatus.replace(/_/g, " ")}". No provider assigned.${smsNote}`,
      });
    } catch (err: any) {
      toast({
        title: "Status Check Failed",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setCheckingStatusId(null);
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
    if (bulkStatus === "paused_by_admin") {
      await handleBulkPauseOrders(true);
      setBulkStatus("");
      return;
    }
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

  const handleBulkCheckStatus = useCallback(async (targetOrderIds?: string[], isSilent = false) => {
    const isExplicit = Array.isArray(targetOrderIds) && targetOrderIds.length > 0;
    const ids = isExplicit
      ? targetOrderIds
      : (selectedIds.size > 0 && !isSilent
          ? Array.from(selectedIds) 
          : allOrders.filter(o => o.status === "processing" || o.status === "paid" || o.status === "in_queue").map(o => o.id));

    if (!isSilent && ids.length === 0) {
      toast({
        title: "No Orders to Check 📡",
        description: "Select orders using the checkboxes, or ensure there are active processing orders on the page.",
      });
      return;
    }

    setBulkCheckingStatus(true);
    if (!isSilent) {
      toast({
        title: "Checking Live Provider Status 📡",
        description: `Querying carrier APIs for ${ids.length} order(s)...`,
      });
    }

    try {
      const { data, error } = await supabase.functions.invoke("check-order-status", {
        body: isSilent && ids.length === 0
          ? { auto_bulk: true, limit: 50 }
          : { order_ids: ids },
      });

      if (error) throw error;
      if (!data || !data.success) {
        throw new Error(data?.error || "Failed to check order statuses");
      }

      const summary = data.summary || {};
      const results = data.results || [];
      const updatedCount = summary.updated || results.filter((r: any) => r.updated).length;

      // Update local state immediately with updated order statuses
      if (Array.isArray(results) && results.length > 0) {
        const resultMap = new Map(results.map((r: any) => [r.id, r]));
        setAllOrders(prev => prev.map(o => {
          const match = resultMap.get(o.id);
          if (!match) return o;
          return {
            ...o,
            status: match.status || o.status,
            failure_reason: match.failure_reason !== undefined ? match.failure_reason : o.failure_reason
          };
        }));
      }

      if (!isSilent || updatedCount > 0) {
        toast({
          title: isSilent ? `Auto Status Check (3m) 📡` : `Bulk Status Check Complete! 📡`,
          description: `Checked ${summary.total ?? ids.length} orders: ${summary.fulfilled || 0} Fulfilled ✅, ${summary.failed || 0} Failed ❌, ${summary.processing || 0} In Processing ⏳${updatedCount > 0 ? ` (${updatedCount} updated)` : ""}`,
        });
      }

      if (currentUser && (!isSilent || updatedCount > 0)) {
        await logAudit(currentUser.id, isSilent ? "auto_bulk_check_order_status" : "bulk_check_order_status", {
          total: summary.total ?? ids.length,
          summary
        });
      }

      if (!isSilent || updatedCount > 0) {
        await fetchOrders(true);
      }
    } catch (err: any) {
      if (!isSilent) {
        toast({
          title: "Bulk Status Check Error",
          description: err.message || "Failed to verify statuses with upstream providers",
          variant: "destructive",
        });
      }
    } finally {
      setBulkCheckingStatus(false);
    }
  }, [allOrders, currentUser, fetchOrders, selectedIds, toast]);

  // Automated Bulk Status Check every 3 minutes (180,000 ms)
  useEffect(() => {
    const interval = setInterval(() => {
      if (!bulkCheckingStatus) {
        handleBulkCheckStatus(undefined, true);
      }
    }, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [bulkCheckingStatus, handleBulkCheckStatus]);

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

    if (isOrderApiPaused(order)) {
      return {
        className: "bg-violet-500/20 text-violet-300 border-violet-500/40 font-extrabold shadow-sm backdrop-blur-md",
        label: order.provider_order_id === "manual_fulfillment_mode" ? "API Hold (Global)" : "Paused (API Hold)",
      };
    }

    if (order.provider_order_id === "duplicate_cooldown" || (order.status === "processing" && String(order.failure_reason || "").toLowerCase().includes("duplicate"))) {
      return {
        className: "bg-amber-500/20 text-amber-400 border-amber-500/30 font-semibold shadow-sm backdrop-blur-md",
        label: "duplicate cooldown (60m)",
      };
    }

    const ageMinutes = Math.floor((Date.now() - new Date(order.created_at).getTime()) / (60 * 1000));
    if (order.status === "processing" && ageMinutes >= 30) {
      const ageLabel = ageMinutes >= 60 ? `${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}m` : `${ageMinutes}m`;
      return {
        className: "bg-orange-500/20 text-orange-400 border-orange-500/30 font-bold shadow-sm backdrop-blur-md animate-pulse",
        label: `parked (${ageLabel})`,
      };
    }

    return {
      className: STATUS_COLORS[order.status] || "bg-muted text-muted-foreground border-border",
      label: order.status === "pending" ? "Awaiting Checkout" : order.status.replace(/_/g, " "),
    };
  };

  const getStatusIcon = (order: OrderRow) => {
    if (isBeneficiaryFailure(order)) return Clock;
    if (isOrderApiPaused(order)) return PauseCircle;
    if (order.provider_order_id === "duplicate_cooldown" || (order.status === "processing" && String(order.failure_reason || "").toLowerCase().includes("duplicate"))) {
      return Clock;
    }
    const ageMinutes = Math.floor((Date.now() - new Date(order.created_at).getTime()) / (60 * 1000));
    if (order.status === "processing" && ageMinutes >= 30) return AlertTriangle;

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
      if (statusFilter === "paused_api") {
        return isOrderApiPaused(o);
      }
      if (statusFilter === "parked") {
        const ageMinutes = Math.floor((Date.now() - new Date(o.created_at).getTime()) / (60 * 1000));
        return o.status === "processing" && ageMinutes >= 30;
      }
      if (statusFilter === "auto_router_queue") {
        const isPaid = o.payment_method === "wallet" || 
                       o.payment_method === "credit" || 
                       Number(o.paystack_verified_amount || 0) > 0 || 
                       o.status === "paid" || 
                       o.status === "processing";
        const hasNoProvider = !o.provider_id || !o.provider_order_id || ["failed_api_call", "timeout", "manual_fulfillment_mode", "duplicate_cooldown"].includes(o.provider_order_id);
        const isNonTelecom = ["wallet_topup", "store_wallet_topup", "agent_activation", "sub_agent_activation", "vendor_activation", "free_data_claim"].includes(String(o.order_type || "").toLowerCase());
        const isMashUp = String(o.network || "").toLowerCase().includes("mash up");
        return isPaid && hasNoProvider && !isNonTelecom && !isMashUp;
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
  const pausedCount = allOrders.filter(o => isOrderApiPaused(o)).length;
  const parkedCount = allOrders.filter(o => o.status === "processing" && Math.floor((Date.now() - new Date(o.created_at).getTime()) / (60 * 1000)) >= 30).length;
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
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] sm:text-[26px] font-bold tracking-[-0.02em] text-foreground leading-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">
            {totalCount.toLocaleString()} orders · <span className="font-semibold text-foreground">{fulfillmentSuccessRate}%</span> delivered
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl text-[13px] font-semibold" onClick={() => fetchOrders()}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl text-[13px] font-semibold" disabled={allOrders.length === 0}>
                <Download className="w-4 h-4" /> Export <ChevronDown className="w-3.5 h-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 rounded-xl p-1.5">
              <DropdownMenuItem onSelect={handleExportCSV} className="gap-2 rounded-lg">
                <FileSpreadsheet className="w-4 h-4" /> Full CSV (all columns)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleExportSimpleCSV} className="gap-2 rounded-lg">
                <FileText className="w-4 h-4" /> Simple queue CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-9 gap-1.5 rounded-xl text-[13px] font-semibold">
                {retryingAutoRouter || retryingAll || bulkCheckingStatus || forcingFulfill ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Bulk actions <ChevronDown className="w-3.5 h-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-xl p-1.5">
              <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground">Retry &amp; check</DropdownMenuLabel>
              <DropdownMenuItem onSelect={handleRetryAutoRouterQueue} disabled={retryingAutoRouter} className="gap-2 rounded-lg">
                <Zap className="w-4 h-4" />
                <span className="flex-1">Retry auto-router queue</span>
                <span className="text-xs tabular-nums text-muted-foreground">{autoRouterQueueCount}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleRetryAll} disabled={retryingAll} className="gap-2 rounded-lg">
                <PlayCircle className="w-4 h-4" />
                <span className="flex-1">Retry pending/failed on this page</span>
                <span className="text-xs tabular-nums text-muted-foreground">{pending + failed + allOrders.filter(o => o.status === "processing").length}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => handleBulkCheckStatus(allOrders.filter(o => o.status === "processing").map(o => o.id))}
                disabled={bulkCheckingStatus || allOrders.filter(o => o.status === "processing").length === 0}
                className="gap-2 rounded-lg"
              >
                <RefreshCw className="w-4 h-4" />
                <span className="flex-1">Check provider status (auto every 3 min)</span>
                <span className="text-xs tabular-nums text-muted-foreground">{allOrders.filter(o => o.status === "processing").length}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">Danger zone</DropdownMenuLabel>
              <DropdownMenuItem onSelect={handleForceFulfillAllProcessing} disabled={forcingFulfill} className="gap-2 rounded-lg text-rose-600 focus:text-rose-600 focus:bg-rose-500/10 dark:text-rose-400">
                <CheckCircle2 className="w-4 h-4" />
                <span className="flex-1">Force-fulfil all processing orders…</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-2.5">
        {[
          { label: "On this page", value: allOrders.length.toLocaleString() },
          { label: "Auto-router queue", value: autoRouterQueueCount.toString(), onClick: () => setStatusFilter("auto_router_queue"), highlight: autoRouterQueueCount > 0 },
          { label: "In queue / approval", value: inQueueCount.toString(), onClick: () => setStatusFilter("in_queue"), highlight: inQueueCount > 0 },
          { label: "Delivered volume", value: `GH₵${totalRevenue.toFixed(2)}` },
          { label: "Admin net profit", value: `GH₵${totalAdminNetProfit.toFixed(2)}` },
          { label: "Agent profits", value: `GH₵${(totalAgentProfits + totalParentProfits).toFixed(2)}` },
          { label: "Paystack fees", value: `GH₵${totalPaystackFees.toFixed(2)}` },
          { label: "Platform costs", value: `GH₵${totalCosts.toFixed(2)}` },
          { label: "Paystack verified", value: verifiedCount.toLocaleString() },
        ].map(({ label, value, onClick, highlight }: any) => {
          const Tag: any = onClick ? "button" : "div";
          return (
            <Tag
              key={label}
              type={onClick ? "button" : undefined}
              onClick={onClick}
              className={cn(
                "text-left rounded-xl border px-3 py-2.5 min-w-0 transition-colors",
                highlight ? "border-amber-500/40 bg-amber-500/[0.07]" : "border-border/70 bg-card/85 dark:border-white/[0.08] dark:bg-black/30",
                onClick && "hover:border-foreground/25"
              )}
              title={onClick ? `Show only: ${label}` : undefined}
            >
              <p className="text-[11px] text-muted-foreground truncate">{label}{onClick ? " ›" : ""}</p>
              <p className="mt-0.5 text-[15px] font-bold tabular-nums text-foreground truncate">{value}</p>
            </Tag>
          );
        })}
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
            <option value="auto_router_queue">⚡ Auto-Router Queue ({autoRouterQueueCount})</option>
            <option value="paused_api">⏸️ Paused / API Hold {pausedCount > 0 ? `(${pausedCount})` : ""}</option>
            <option value="parked">⚠️ Parked / Stalled (&gt;30m) {parkedCount > 0 ? `(${parkedCount})` : ""}</option>
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
            <option value="voucher">Result Checkers</option>
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
              <option value="paused_by_admin">⏸️ Pause API Dispatch</option>
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
            <Button
              size="sm"
              variant="outline"
              disabled={selectedIds.size === 0 || bulkCheckingStatus}
              onClick={() => handleBulkCheckStatus()}
              className="h-8 gap-1.5 rounded-lg text-xs font-bold border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
              title="Query upstream carrier/provider API live for all selected orders"
            >
              {bulkCheckingStatus ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Check Provider Status ({selectedIds.size})
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={selectedIds.size === 0 || bulkResendingSms}
              onClick={handleBulkResendSms}
              className="h-8 gap-1.5 rounded-lg text-xs font-bold border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20"
            >
              {bulkResendingSms ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Smartphone className="w-3.5 h-3.5" />}
              Resend SMS ({selectedIds.size})
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
                <th className="text-left px-4 py-3.5 font-extrabold uppercase tracking-wider text-muted-foreground">Provider Gateway</th>
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
                        {order.agent_id === "00000000-0000-0000-0000-000000000000" || !order.agent_id ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded border border-slate-700/50 text-slate-400 bg-slate-800/40">
                            Guest / Direct
                          </span>
                        ) : (
                          <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${order.is_sub_agent ? "border-purple-500/30 text-purple-400 bg-purple-500/10" : "border-amber-500/30 text-amber-400 bg-amber-500/10"}`}>
                            {order.is_sub_agent ? "Sub-Agent" : "Agent"}
                          </span>
                        )}
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
                        {order.network || (order.order_type === "wallet_topup" ? (order.payment_method === "admin" ? "Admin" : "Deposit") : "Standard")}
                      </Badge>
                    </td>

                    <td className="px-4 py-3.5 max-w-[150px]">
                      <p className="font-semibold text-foreground truncate">
                        {order.package_size || (order.order_type === "wallet_topup" ? (order.payment_method === "admin" ? "Admin Credit" : "Wallet Top-up") : "—")}
                      </p>
                      {order.metadata?.prepaid_token && (
                        <div className="mt-1 text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded font-mono truncate" title={order.metadata.prepaid_token}>
                          ECG: {order.metadata.prepaid_token}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <ProviderBadge
                        providerId={order.provider_id}
                        providerOrderId={order.provider_order_id}
                        network={order.network}
                        orderType={order.order_type}
                        paymentMethod={order.payment_method}
                        metadata={order.metadata}
                        status={order.status}
                        providers={providers}
                      />
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
                      {formatOrderFailureReason(order) && !isBeneficiaryFailure(order) && (
                        <p className="text-[9px] text-rose-400 mt-1 max-w-[130px] truncate mx-auto" title={formatOrderFailureReason(order)}>
                          {formatOrderFailureReason(order)}
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
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-[10px] gap-1 h-7 px-2 border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-lg font-bold"
                              onClick={() => setReceiptOrder(order)}
                              title="Copy Receipt & Send/Resend SMS"
                            >
                              <FileText className="w-3 h-3" />
                              Receipt
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-[10px] gap-1 h-7 px-2 border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 rounded-lg font-bold"
                              disabled={resendingSmsId === order.id}
                              onClick={() => handleQuickResendSms(order)}
                              title="Resend SMS to Customer"
                            >
                              {resendingSmsId === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Smartphone className="w-3 h-3" />}
                              SMS
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-[10px] gap-1 h-7 px-2 border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 rounded-lg font-bold"
                              disabled={checkingStatusId === order.id}
                              onClick={() => handleCheckProviderStatus(order.id)}
                              title="Check exact live status from upstream provider"
                            >
                              {checkingStatusId === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                              Status
                            </Button>
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
                            {(order.status === "fulfillment_failed" || order.status === "processing" || order.status === "pending") && !order.auto_refunded && (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="text-[10px] gap-1 h-7 px-2 border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-lg font-bold"
                                disabled={refunding === order.id}
                                onClick={() => handleRefund(order.id, order.amount, "refund")}
                                title={order.status === "processing" || order.status === "pending" ? "Cancel order on provider (/cancel-order or /order-refund) & refund to wallet" : "Refund failed order to wallet"}
                              >
                                {refunding === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3" />}
                                {order.status === "processing" || order.status === "pending" ? "Cancel & Refund" : "Refund"}
                              </Button>
                            )}
                            {(order.status === "processing" || order.status === "fulfillment_failed") && !order.auto_refunded && (Boolean(order.provider_id) || order.provider_order_id === "dispatching") && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-[10px] gap-1 h-7 px-2 border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded-lg font-bold"
                                disabled={refunding === order.id}
                                onClick={() => handleRefund(order.id, order.amount, "refund_and_reroute")}
                                title="Skip current provider (e.g. SKPlug / DataHub) and immediately re-route to the next active API provider"
                              >
                                {refunding === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                                Reroute Provider
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
                  <p className="font-bold text-foreground mt-0.5">
                    {order.network || (order.order_type === "wallet_topup" ? (order.payment_method === "admin" ? "Admin" : "Deposit") : "—")} ({order.package_size || (order.order_type === "wallet_topup" ? (order.payment_method === "admin" ? "Admin Credit" : "Wallet Top-up") : "—")})
                  </p>
                </div>
                <div className="col-span-2 flex items-center justify-between pt-1.5 border-t border-white/5">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Provider Gateway:</span>
                  <ProviderBadge
                    providerId={order.provider_id}
                    providerOrderId={order.provider_order_id}
                    network={order.network}
                    orderType={order.order_type}
                    paymentMethod={order.payment_method}
                    metadata={order.metadata}
                    status={order.status}
                    providers={providers}
                  />
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
                {formatOrderFailureReason(order) && (
                  <p className="text-[10px] text-rose-400 italic truncate max-w-[160px]" title={formatOrderFailureReason(order)}>
                    {formatOrderFailureReason(order)}
                  </p>
                )}
                <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1 h-8 px-2 rounded-lg border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-bold"
                    onClick={() => setReceiptOrder(order)}
                    title="Copy Receipt & SMS"
                  >
                    <FileText className="w-3 h-3" />
                    Receipt
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1 h-8 px-2 rounded-lg border-cyan-500/30 bg-cyan-500/10 text-cyan-400 font-bold"
                    disabled={resendingSmsId === order.id}
                    onClick={() => handleQuickResendSms(order)}
                    title="Resend SMS"
                  >
                    {resendingSmsId === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Smartphone className="w-3 h-3" />}
                    SMS
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1 h-8 px-2 rounded-lg border-cyan-500/30 bg-cyan-500/10 text-cyan-400 font-bold"
                    disabled={checkingStatusId === order.id}
                    onClick={() => handleCheckProviderStatus(order.id)}
                    title="Check exact live status from provider"
                  >
                    {checkingStatusId === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                    Status
                  </Button>
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
                  {(order.status === "fulfillment_failed" || order.status === "processing") && !order.auto_refunded && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="text-xs gap-1 h-8 rounded-lg bg-rose-500/15 border-rose-500/30 text-rose-300"
                      disabled={refunding === order.id}
                      onClick={() => handleRefund(order.id, order.amount, "refund")}
                    >
                      {refunding === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3" />}
                      Refund
                    </Button>
                  )}
                  {(order.status === "processing" || order.status === "fulfillment_failed") && !order.auto_refunded && (Boolean(order.provider_id) || order.provider_order_id === "dispatching") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs gap-1 h-8 rounded-lg bg-amber-500/15 border-amber-500/30 text-amber-300"
                      disabled={refunding === order.id}
                      onClick={() => handleRefund(order.id, order.amount, "refund_and_reroute")}
                    >
                      {refunding === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      Reroute Provider
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

      {/* ── Providers & lookup ── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
      <div className="rounded-2xl border border-border/70 bg-card/85 p-4 sm:p-5 space-y-3 dark:border-white/[0.08] dark:bg-black/30">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Coins className="w-[18px] h-[18px]" />
            </div>
            <div>
              <h4 className="text-[15px] font-semibold text-foreground">Provider balances</h4>
              <p className="text-xs text-muted-foreground">Live balances. Pause a provider to stop new orders reaching it.</p>
            </div>
          </div>

          <Button
            onClick={syncAllProviderBalances}
            disabled={syncingBalances}
            variant="outline"
            className="h-8 px-3 rounded-lg border-border text-[12.5px] font-semibold gap-1.5 shrink-0"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", syncingBalances && "animate-spin text-amber-400")} />
            {syncingBalances ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {/* Provider Balance Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
          {providers.length === 0 ? (
            <div className="col-span-full py-4 text-center text-xs text-muted-foreground font-mono">
              No API providers configured.
            </div>
          ) : (
            providers.map((prov) => {
              const balanceNum = Number(prov.balance || 0);
              const isProvPaused = prov?.settings?.is_paused === true;
              const isHealthy = prov.is_active && !isProvPaused && balanceNum > 50;
              const isLow = prov.is_active && !isProvPaused && balanceNum <= 50 && balanceNum > 0;

              return (
                <div
                  key={prov.id}
                  className={cn(
                    "flex flex-col justify-between gap-2.5 p-3 rounded-xl border transition-colors",
                    isProvPaused
                      ? "bg-violet-500/[0.07] border-violet-500/40"
                      : isHealthy
                      ? "border-border/70 dark:border-white/[0.08]"
                      : isLow
                      ? "bg-amber-500/[0.06] border-amber-500/40"
                      : "bg-rose-500/[0.06] border-rose-500/40"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          isProvPaused
                            ? "bg-violet-400 animate-pulse"
                            : isHealthy
                            ? "bg-emerald-400 animate-pulse"
                            : isLow
                            ? "bg-amber-400 animate-pulse"
                            : "bg-rose-500"
                        )} />
                        <span className="text-[12.5px] font-semibold text-foreground truncate max-w-[120px]">
                          {prov.name}
                        </span>
                        {prov.handler_type && (
                          <span className="text-[10px] px-1.5 rounded bg-muted text-muted-foreground shrink-0">
                            {prov.handler_type}
                          </span>
                        )}
                      </div>
                      <p className="text-[11.5px] text-muted-foreground">
                        {isProvPaused
                          ? "Paused"
                          : prov.is_active
                          ? prov?.settings?.is_primary_provider
                            ? "Primary"
                            : "Backup"
                          : "Inactive"}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <div className={cn(
                        "text-[14px] font-bold tabular-nums",
                        isProvPaused ? "text-violet-600 dark:text-violet-300" : isHealthy ? "text-foreground" : isLow ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"
                      )}>
                        GH₵ {balanceNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <span className="text-[10.5px] text-muted-foreground">Balance</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end pt-1.5 border-t border-border/60">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pausingProviderId === prov.id}
                      onClick={() => handleTogglePauseProvider(prov)}
                      className={cn(
                        "text-[11.5px] gap-1.5 h-7 px-3 rounded-lg font-semibold",
                        isProvPaused
                          ? "border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-200 hover:bg-violet-500/25"
                          : "border-border text-foreground hover:bg-muted"
                      )}
                      title={
                        isProvPaused
                          ? `Resume ${prov.name} API and release any held orders`
                          : `Pause orders from entering ${prov.name} API`
                      }
                    >
                      {pausingProviderId === prov.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : isProvPaused ? (
                        <PlayCircle className="w-3.5 h-3.5" />
                      ) : (
                        <PauseCircle className="w-3.5 h-3.5" />
                      )}
                      {isProvPaused ? "Resume" : "Pause"}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

        </div>
        <div className="lg:col-span-4 rounded-2xl border border-border/70 bg-card/85 p-4 sm:p-5 dark:border-white/[0.08] dark:bg-black/30">
          <PhoneOrderTracker variant="embedded" title="Find a customer's orders" subtitle="Look up by phone number or order reference." />
        </div>
      </div>

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
                  <option value="paused_by_admin">⏸️ Paused (Hold from API Provider)</option>
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

      {/* Order Receipt & SMS Resend Modal */}
      <WhatsAppReceiptModal
        order={receiptOrder ? {
          id: receiptOrder.id,
          network: receiptOrder.network || "Bundle",
          package_size: receiptOrder.package_size || "",
          customer_phone: receiptOrder.customer_phone || "",
          customer_name: receiptOrder.customer_name,
          amount: receiptOrder.amount,
          created_at: receiptOrder.created_at,
          status: receiptOrder.status,
          store_name: profiles[receiptOrder.agent_id]?.full_name || "SwiftData Hub",
          agent_id: receiptOrder.agent_id,
        } : null}
        isOpen={!!receiptOrder}
        onClose={() => setReceiptOrder(null)}
      />
    </div>
  );
}
