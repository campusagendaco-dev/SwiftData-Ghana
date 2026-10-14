import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeSearchTerm, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search, RotateCcw, Loader2, RefreshCw,
  TrendingUp, ShoppingCart, Clock,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  CheckCircle2, UserCheck, Download,
  Phone, Coins, ShieldAlert, MoreHorizontal,
  FileSpreadsheet, Copy, Check, Eye, XCircle, DollarSign, Sparkles, AlertCircle,
  Calendar, Briefcase, Mail, MapPin, Send, ExternalLink, X, ShieldCheck
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
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import UserDetailDrawer from "@/components/UserDetailDrawer";
import { logAudit } from "@/utils/auditLogger";
import { useAuth } from "@/hooks/useAuth";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";

export interface AfaOrderRow {
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
  status: string;
  failure_reason: string | null;
  created_at: string;
  updated_at?: string;
  agent_id: string;
  payment_method?: string;
  provider_id?: string | null;
  provider_order_id?: string | null;
  metadata?: any;
  // AFA Applicant Specific Fields
  afa_full_name?: string | null;
  afa_ghana_card?: string | null;
  afa_occupation?: string | null;
  afa_email?: string | null;
  afa_residence?: string | null;
  afa_date_of_birth?: string | null;
  // Enriched Agent Information
  agent_name?: string;
  agent_email?: string;
  agent_phone?: string;
  is_sub_agent?: boolean;
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
  refunded: "bg-purple-500/15 text-purple-400 border-purple-500/30",
};

type DatePreset = "all" | "today" | "yesterday" | "last_7_days" | "last_30_days";
const PAGE_SIZE = 50;

/** Normalises Ghana Card numbers to GHA-XXXXXXXXX-X */
function formatGhanaCard(raw?: string | null): string {
  if (!raw) return "N/A";
  const compact = String(raw).toUpperCase().replace(/[\s-]+/g, "");
  const m = compact.match(/^GHA(\d{9})(\d)$/);
  return m ? `GHA-${m[1]}-${m[2]}` : String(raw).trim().toUpperCase();
}

/** Resolve applicant field with fallback to metadata or customer info */
function resolveApplicant(order: AfaOrderRow) {
  const meta = order.metadata || {};
  const fullName = order.afa_full_name || order.customer_name || meta.fullName || meta.afa_full_name || meta.name || "N/A";
  const ghanaCard = formatGhanaCard(order.afa_ghana_card || meta.ghana_card || meta.ghanaCardNumber || meta.afa_ghana_card);
  const occupation = order.afa_occupation || meta.occupation || meta.afa_occupation || "Not Specified";
  const dob = order.afa_date_of_birth || meta.dateOfBirth || meta.afa_date_of_birth || meta.dob || "N/A";
  const residence = order.afa_residence || meta.residence || meta.afa_residence || meta.location || "Not Specified";
  const email = order.afa_email || meta.email || meta.afa_email || "N/A";
  const phone = order.customer_phone || meta.customer_phone || meta.phone || "N/A";

  return { fullName, ghanaCard, occupation, dob, residence, email, phone };
}

export default function AdminAfaOrders() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [allOrders, setAllOrders] = useState<AfaOrderRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, AgentProfile>>({});
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("agent") || "";
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  // Date Range Filters State
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Drawer & Modal States
  const [selectedUserForDrawer, setSelectedUserForDrawer] = useState<AgentProfile | null>(null);
  const [activeDossierOrder, setActiveDossierOrder] = useState<AfaOrderRow | null>(null);
  const [orderToEditStatus, setOrderToEditStatus] = useState<AfaOrderRow | null>(null);
  const [newOrderStatus, setNewOrderStatus] = useState("");
  const [newStatusReason, setNewStatusReason] = useState("");
  const [updatingSingleStatus, setUpdatingSingleStatus] = useState(false);

  // Multi-selection for bulk operations
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);

  // Processing indicators
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [checkingStatusId, setCheckingStatusId] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [resendingSmsId, setResendingSmsId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, datePreset, startDate, endDate]);

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
    } else if (preset === "all") {
      setStartDate("");
      setEndDate("");
    }
  };

  const copyToClipboard = (text: string, label: string, keyId?: string) => {
    navigator.clipboard.writeText(text);
    if (keyId) {
      setCopiedKey(keyId);
      setTimeout(() => setCopiedKey(null), 2000);
    }
    toast({ title: "Copied!", description: `${label} copied to clipboard.` });
  };

  const fetchOrders = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    // Filter strictly for AFA orders
    let q = supabase
      .from("orders")
      .select("*", { count: "estimated" })
      .or("network.ilike.%AFA%,order_type.ilike.%afa%")
      .order("created_at", { ascending: false })
      .range(from, to);

    // Search filter across phone, names, ghana card, residence, or order/agent ID
    if (search.trim()) {
      const cleanSearch = sanitizeSearchTerm(search);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanSearch);

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
          `afa_full_name.ilike.%${cleanSearch}%`,
          `afa_ghana_card.ilike.%${cleanSearch}%`,
          `afa_occupation.ilike.%${cleanSearch}%`,
          `afa_residence.ilike.%${cleanSearch}%`,
          `afa_email.ilike.%${cleanSearch}%`
        ];

        if (matchedUserIds.length > 0) {
          matchedUserIds.forEach(id => {
            orParts.push(`agent_id.eq.${id}`);
          });
        }

        q = q.or(orParts.join(","));
      }
    }

    // Status filter
    if (statusFilter !== "all") {
      q = q.eq("status", statusFilter);
    }

    // Date Range filters
    if (startDate) {
      q = q.gte("created_at", `${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      q = q.lte("created_at", `${endDate}T23:59:59.999Z`);
    }

    const { data, count, error } = await q;

    if (error) {
      toast({ title: "Failed to fetch AFA orders", description: error.message, variant: "destructive" });
      if (!isSilent) setLoading(false);
      return;
    }

    setTotalCount(count || 0);

    const agentIds = [...new Set((data || []).map((o: any) => o.agent_id).filter(Boolean))];
    const profileMap: Record<string, AgentProfile> = {};

    if (agentIds.length > 0) {
      const [profRes, walletRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, full_name, email, phone, is_agent, agent_approved, is_sub_agent, sub_agent_approved, parent_agent_id, created_at")
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
      setProfiles(prev => ({ ...prev, ...profileMap }));
    }

    const enriched: AfaOrderRow[] = (data || []).map((o: any) => {
      const profile = profileMap[o.agent_id];
      const isPlaceholder = o.agent_id === "00000000-0000-0000-0000-000000000000" || !o.agent_id;

      return {
        ...o,
        agent_name: profile?.full_name || (isPlaceholder ? (o.customer_name || "Guest Direct Purchase") : "Unknown Agent"),
        agent_email: profile?.email || "",
        agent_phone: profile?.phone || "",
        is_sub_agent: profile?.is_sub_agent ?? false,
      };
    });

    setAllOrders(enriched);
    if (!isSilent) setLoading(false);
  }, [page, search, statusFilter, startDate, endDate, toast]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useRealtimeRefresh({
    tables: ["orders"],
    onRefresh: (isSilent) => fetchOrders(isSilent ?? true),
  });

  // Summary Metrics calculations
  const metrics = useMemo(() => {
    let totalSales = 0;
    let totalProfit = 0;
    let fulfilledCount = 0;
    let pendingCount = 0;
    let failedCount = 0;

    allOrders.forEach(o => {
      totalSales += Number(o.amount || 0);
      totalProfit += Number(o.profit || 0);

      const s = (o.status || "").toLowerCase();
      if (s === "fulfilled") fulfilledCount++;
      else if (s === "paid" || s === "processing" || s === "pending") pendingCount++;
      else if (s.includes("fail") || s === "cancelled") failedCount++;
    });

    const completionRate = allOrders.length > 0 ? ((fulfilledCount / allOrders.length) * 100).toFixed(0) : "0";

    return { totalSales, totalProfit, fulfilledCount, pendingCount, failedCount, completionRate };
  }, [allOrders]);

  // Bulk Selection Handlers
  const handleToggleSelectAll = () => {
    if (selectedIds.size === allOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allOrders.map(o => o.id)));
    }
  };

  const handleToggleSelectRow = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Bulk Actions
  const handleBulkMarkFulfilled = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Are you sure you want to mark ${selectedIds.size} selected AFA orders as Fulfilled?`)) return;

    setBulkUpdating(true);
    try {
      const ids = Array.from(selectedIds);
      const { error } = await (supabase.from("orders") as any)
        .update({
          status: "fulfilled",
          updated_at: new Date().toISOString()
        })
        .in("id", ids);

      if (error) throw error;

      if (currentUser) {
        await logAudit(currentUser.id, "bulk_afa_orders_fulfilled", { count: ids.length, ids });
      }

      toast({
        title: "Orders Fulfilled! 🎉",
        description: `Successfully marked ${ids.length} AFA registrations as fulfilled.`,
      });
      setSelectedIds(new Set());
      await fetchOrders();
    } catch (err: any) {
      toast({ title: "Bulk Update Failed", description: err.message, variant: "destructive" });
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleBulkCopyGhanaCards = () => {
    const selected = allOrders.filter(o => selectedIds.has(o.id));
    const cards = selected.map(o => resolveApplicant(o).ghanaCard).filter(c => c !== "N/A");
    if (cards.length === 0) {
      toast({ title: "No Ghana Cards", description: "No valid Ghana Cards found in selection.", variant: "destructive" });
      return;
    }
    const text = cards.join("\n");
    copyToClipboard(text, `${cards.length} Ghana Cards`);
  };

  const handleBulkCopyPhones = () => {
    const selected = allOrders.filter(o => selectedIds.has(o.id));
    const phones = selected.map(o => o.customer_phone).filter(Boolean);
    if (phones.length === 0) {
      toast({ title: "No Phone Numbers", description: "No valid phone numbers found in selection.", variant: "destructive" });
      return;
    }
    const text = phones.join("\n");
    copyToClipboard(text, `${phones.length} Phone Numbers`);
  };

  // Export full AFA manifest CSV
  const exportAfaOrdersCSV = (onlySelected = false) => {
    const targetOrders = onlySelected ? allOrders.filter(o => selectedIds.has(o.id)) : allOrders;
    if (!targetOrders.length) {
      toast({ title: "No orders to export", variant: "destructive" });
      return;
    }

    const headers = [
      "Order ID",
      "Date",
      "Full Legal Name",
      "Ghana Card ID",
      "SIM / Phone Number",
      "Occupation",
      "Date of Birth",
      "Place of Residence",
      "Email Address",
      "Amount (GHS)",
      "Profit (GHS)",
      "Payment Method",
      "Status",
      "Agent Name",
      "Agent Phone",
      "Provider ID",
      "Failure Reason"
    ];

    const rows = targetOrders.map(o => {
      const app = resolveApplicant(o);
      return [
        `"${o.id}"`,
        `"${new Date(o.created_at).toLocaleString()}"`,
        `"${app.fullName}"`,
        `"${app.ghanaCard}"`,
        `"${app.phone}"`,
        `"${app.occupation}"`,
        `"${app.dob}"`,
        `"${app.residence}"`,
        `"${app.email}"`,
        o.amount,
        o.profit,
        `"${o.payment_method || 'wallet'}"`,
        `"${o.status}"`,
        `"${o.agent_name || ''}"`,
        `"${o.agent_phone || ''}"`,
        `"${o.provider_order_id || o.provider_id || ''}"`,
        `"${(o.failure_reason || '').replace(/"/g, '""')}"`
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `afa_registrations_manifest_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Manifest Exported! 📊",
      description: `Downloaded ${targetOrders.length} AFA registration records as CSV.`,
    });
  };

  // Status Changer Handler
  const handleUpdateSingleStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderToEditStatus || !newOrderStatus) return;

    setUpdatingSingleStatus(true);
    try {
      const { error } = await (supabase.from("orders") as any)
        .update({
          status: newOrderStatus,
          failure_reason: newStatusReason.trim() || null,
          updated_at: new Date().toISOString()
        })
        .eq("id", orderToEditStatus.id);

      if (error) throw error;

      if (currentUser) {
        await logAudit(currentUser.id, "manual_afa_status_update", {
          order_id: orderToEditStatus.id,
          old_status: orderToEditStatus.status,
          new_status: newOrderStatus,
          reason: newStatusReason
        });
      }

      toast({
        title: "AFA Order Updated! ⚡",
        description: `Order #${orderToEditStatus.id.slice(0, 8)} set to "${newOrderStatus.replace(/_/g, " ")}".`
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

  // Provider verification & retry
  const handleRetryOrder = async (orderId: string) => {
    setRetryingId(orderId);
    try {
      const { data, error } = await invokePublicFunctionAsUser("verify-payment", {
        body: { reference: orderId },
      });

      if (error) {
        const description = await getFunctionErrorMessage(error, "Could not retry this AFA registration.");
        toast({ title: "Retry Failed", description, variant: "destructive" });
      } else if (data?.status === "fulfilled") {
        if (currentUser) {
          await logAudit(currentUser.id, "afa_order_retry_fulfilled", { order_id: orderId });
        }
        toast({ title: "AFA Order Fulfilled! 🎉", description: "Registration successfully activated." });
      } else {
        toast({
          title: "Retry Completed",
          description: data?.failure_reason || `Status: ${data?.status}`,
          variant: data?.status === "fulfilled" ? "default" : "destructive",
        });
      }
      await fetchOrders();
    } catch (e: any) {
      toast({ title: "Retry Error", description: e.message || "Failed to trigger retry.", variant: "destructive" });
    } finally {
      setRetryingId(null);
    }
  };

  // Provider Check Status
  const handleCheckProviderStatus = async (orderId: string) => {
    setCheckingStatusId(orderId);
    try {
      const { data, error } = await supabase.functions.invoke("check-order-status", {
        body: { order_id: orderId },
      });

      if (error) throw error;

      toast({
        title: "Provider Status Checked 🔍",
        description: data?.message || `Current status: ${data?.status || "Updated"}`,
      });
      await fetchOrders();
    } catch (err: any) {
      toast({ title: "Status Check Failed", description: err.message, variant: "destructive" });
    } finally {
      setCheckingStatusId(null);
    }
  };

  // Manual Refund
  const handleRefund = async (orderId: string, amount: number) => {
    const targetOrder = allOrders.find(o => o.id === orderId);
    if (!confirm(`Are you sure you want to refund GH₵ ${amount.toFixed(2)} for AFA order ${orderId.slice(0, 8)}?`)) {
      return;
    }

    setRefundingId(orderId);
    try {
      const { data, error } = await (supabase.rpc as any)("refund_failed_order", { p_order_id: orderId });
      if (error) throw error;

      if (data) {
        if (currentUser) {
          await logAudit(currentUser.id, "manual_afa_order_refund", { order_id: orderId, amount });
        }

        if (targetOrder?.customer_phone) {
          supabase.functions.invoke("send-order-sms", {
            body: {
              action: "refund",
              order_id: orderId,
              phone: targetOrder.customer_phone,
              amount: targetOrder.amount,
              package_size: "AFA Registration",
              network: "AFA",
              agent_id: targetOrder.agent_id,
              reason: targetOrder.failure_reason || "Refund issued by platform administrator",
            },
          }).catch((err) => console.error("Refund SMS dispatch error:", err));
        }

        toast({
          title: "Order Refunded! 💰",
          description: `GH₵ ${amount.toFixed(2)} refunded back to agent/customer balance.`,
        });
      } else {
        toast({ title: "Refund Ineligible", description: "This order might already be refunded.", variant: "destructive" });
      }
      await fetchOrders();
    } catch (e: any) {
      toast({ title: "Refund Failed", description: e.message || "Could not execute refund.", variant: "destructive" });
    } finally {
      setRefundingId(null);
    }
  };

  // Resend SMS confirmation
  const handleResendSms = async (order: AfaOrderRow) => {
    if (!order.customer_phone) {
      toast({ title: "No Phone Number", description: "Order has no customer phone number.", variant: "destructive" });
      return;
    }

    setResendingSmsId(order.id);
    try {
      const app = resolveApplicant(order);
      const statusLabel = order.status === "fulfilled" ? "FULFILLED & ACTIVATED 🎉" :
                          order.status === "processing" ? "IN PROGRESS ⏳" :
                          order.status === "paid" ? "RECEIVED (PENDING LINKING) ⏳" :
                          order.status.toUpperCase();

      const smsMsg = `SwiftData Alert: AFA Registration for ${app.fullName} (Card: ${app.ghanaCard}, SIM: ${order.customer_phone}) Status: [${statusLabel}]. Amount: GHS ${Number(order.amount || 0).toFixed(2)}. Thank you!`;

      const { error } = await supabase.functions.invoke("send-order-sms", {
        body: {
          phone: order.customer_phone,
          action: "custom",
          custom_message: smsMsg,
          order_id: order.id,
          amount: order.amount,
          package_size: "AFA Registration",
          network: "AFA",
          agent_id: order.agent_id,
          status: order.status,
        },
      });

      if (error) throw error;
      toast({ title: "SMS Resent! 📱", description: `Registration update sent to ${order.customer_phone}.` });
    } catch (err: any) {
      toast({ title: "Failed to Send SMS", description: err.message, variant: "destructive" });
    } finally {
      setResendingSmsId(null);
    }
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1700px] mx-auto animate-in fade-in duration-300">
      
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 bg-emerald-500/15 text-emerald-400 px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest border border-emerald-500/20 mb-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            National SIM Linking & Carrier Registry
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
              <UserCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-black text-3xl tracking-tight text-foreground">AFA Registrations</h1>
              <p className="text-muted-foreground text-sm">
                Comprehensive directory of all national AFA member registrations, Ghana Card verifications, and carrier SIM linkings.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={() => fetchOrders()}
            disabled={loading}
            variant="outline"
            className="h-11 rounded-2xl gap-2 text-xs font-bold border-border bg-card/50 backdrop-blur-sm"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </Button>

          <Button
            onClick={() => exportAfaOrdersCSV(false)}
            disabled={allOrders.length === 0}
            className="h-11 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs uppercase tracking-wider gap-2 shadow-sm transition-all"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export Page Manifest
          </Button>
        </div>
      </div>

      {/* Summary Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-5 shadow-sm">
          <CardContent className="p-0 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total AFA Registrations</p>
              <p className="text-2xl font-black text-foreground font-mono mt-1">{totalCount.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{allOrders.length} on current page</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-black">
              <ShoppingCart className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-5 shadow-sm">
          <CardContent className="p-0 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Fulfilled & Activated</p>
              <p className="text-2xl font-black text-emerald-400 font-mono mt-1">{metrics.fulfilledCount}</p>
              <p className="text-xs text-emerald-500/80 font-bold mt-0.5">{metrics.completionRate}% completion rate</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center font-black">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-5 shadow-sm">
          <CardContent className="p-0 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Pending / In Queue</p>
              <p className="text-2xl font-black text-amber-400 font-mono mt-1">{metrics.pendingCount}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Awaiting carrier linking</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-400 flex items-center justify-center font-black">
              <Clock className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-5 shadow-sm">
          <CardContent className="p-0 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total Revenue</p>
              <p className="text-2xl font-black text-foreground font-mono mt-1">₵{metrics.totalSales.toFixed(2)}</p>
              <p className="text-xs text-emerald-400 font-bold mt-0.5">₵{metrics.totalProfit.toFixed(2)} profit</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-teal-500/15 text-teal-400 flex items-center justify-center font-black">
              <DollarSign className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bulk Operations Toolbar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 rounded-3xl bg-emerald-500/10 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-4 backdrop-blur-md"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center font-black text-xs">
                {selectedIds.size}
              </div>
              <div>
                <p className="font-bold text-sm text-foreground">
                  {selectedIds.size} {selectedIds.size === 1 ? "applicant order" : "applicant orders"} selected
                </p>
                <p className="text-xs text-muted-foreground">Apply batch actions or extract carrier registration payloads.</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={handleBulkCopyGhanaCards}
                variant="outline"
                className="h-9 rounded-xl text-xs font-bold gap-1.5 border-border"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy Ghana Cards
              </Button>

              <Button
                size="sm"
                onClick={handleBulkCopyPhones}
                variant="outline"
                className="h-9 rounded-xl text-xs font-bold gap-1.5 border-border"
              >
                <Phone className="w-3.5 h-3.5" />
                Copy Phones
              </Button>

              <Button
                size="sm"
                onClick={() => exportAfaOrdersCSV(true)}
                variant="outline"
                className="h-9 rounded-xl text-xs font-bold gap-1.5 border-border"
              >
                <Download className="w-3.5 h-3.5" />
                Export Selected CSV
              </Button>

              <Button
                size="sm"
                onClick={handleBulkMarkFulfilled}
                disabled={bulkUpdating}
                className="h-9 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs gap-1.5 shadow-sm"
              >
                {bulkUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Mark All as Fulfilled
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedIds(new Set())}
                className="h-9 rounded-xl text-xs text-muted-foreground hover:text-foreground"
              >
                Deselect
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search & Filters Controls */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between bg-card/60 border border-border p-4 rounded-3xl backdrop-blur-sm">
        
        {/* Search Input */}
        <div className="relative flex-1 min-w-[280px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Ghana Card (GHA-...), Name, Phone, Residence, or Order ID..."
            className="pl-10 h-10 rounded-2xl bg-background/60 border-border text-xs focus-visible:ring-emerald-500"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status Dropdown */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs h-10 bg-background/80 border border-border rounded-2xl px-3 py-2 text-foreground font-semibold outline-none focus:border-emerald-500 shrink-0"
          >
            <option value="all">All Statuses</option>
            <option value="fulfilled">Fulfilled (Active)</option>
            <option value="paid">Paid (Pending Registry)</option>
            <option value="processing">Processing</option>
            <option value="fulfillment_failed">Fulfillment Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="refunded">Refunded</option>
          </select>

          {/* Date Presets Dropdown */}
          <select
            value={datePreset}
            onChange={(e) => applyDatePreset(e.target.value as DatePreset)}
            className="text-xs h-10 bg-background/80 border border-border rounded-2xl px-3 py-2 text-foreground font-semibold outline-none focus:border-emerald-500 shrink-0"
          >
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last_7_days">Last 7 Days</option>
            <option value="last_30_days">Last 30 Days</option>
          </select>

          {/* Reset Filters */}
          {(search || statusFilter !== "all" || datePreset !== "all" || startDate || endDate) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setDatePreset("all");
                setStartDate("");
                setEndDate("");
              }}
              className="h-10 px-3 text-xs text-muted-foreground hover:text-foreground rounded-2xl gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Main AFA Orders Table Card */}
      <Card className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/80 bg-muted/30 text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                <th className="p-4 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={allOrders.length > 0 && selectedIds.size === allOrders.length}
                    onChange={handleToggleSelectAll}
                    className="rounded border-border accent-emerald-500 cursor-pointer"
                  />
                </th>
                <th className="p-4">Applicant & Ghana Card</th>
                <th className="p-4">Linked Phone & DOB</th>
                <th className="p-4">Location & Job</th>
                <th className="p-4">Agent / Purchaser</th>
                <th className="p-4">Amount & Payment</th>
                <th className="p-4">Status & Provider</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-24 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                      <p className="text-muted-foreground text-sm font-bold">Loading AFA applicant registry...</p>
                    </div>
                  </td>
                </tr>
              ) : allOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-24 text-center">
                    <div className="flex flex-col items-center justify-center gap-3 max-w-md mx-auto">
                      <div className="w-14 h-14 rounded-3xl bg-muted/50 flex items-center justify-center text-muted-foreground">
                        <UserCheck className="w-7 h-7" />
                      </div>
                      <h3 className="font-black text-lg text-foreground">No AFA Orders Found</h3>
                      <p className="text-xs text-muted-foreground">
                        No AFA registration records matched your active filters. Try changing your search query or reset date presets.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                allOrders.map((order) => {
                  const isSelected = selectedIds.has(order.id);
                  const applicant = resolveApplicant(order);
                  const hasGhanaCard = applicant.ghanaCard !== "N/A";

                  return (
                    <tr
                      key={order.id}
                      className={cn(
                        "hover:bg-muted/30 transition-colors group",
                        isSelected && "bg-emerald-500/5"
                      )}
                    >
                      {/* Checkbox */}
                      <td className="p-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectRow(order.id)}
                          className="rounded border-border accent-emerald-500 cursor-pointer"
                        />
                      </td>

                      {/* Applicant & Ghana Card */}
                      <td className="p-4">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-sm text-foreground tracking-tight">
                              {applicant.fullName}
                            </span>
                            <button
                              onClick={() => setActiveDossierOrder(order)}
                              title="View Full Registration Dossier"
                              className="text-muted-foreground hover:text-emerald-400 p-0.5 rounded transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Ghana Card pill */}
                          <div className="flex items-center gap-1.5">
                            <span className={cn(
                              "inline-flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-0.5 rounded-lg border font-bold",
                              hasGhanaCard
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : "bg-muted text-muted-foreground border-border"
                            )}>
                              <ShieldCheck className="w-3 h-3 text-emerald-400" />
                              {applicant.ghanaCard}
                            </span>

                            {hasGhanaCard && (
                              <button
                                onClick={() => copyToClipboard(applicant.ghanaCard, "Ghana Card Number", `card-${order.id}`)}
                                title="Copy Ghana Card"
                                className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors"
                              >
                                {copiedKey === `card-${order.id}` ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>

                          <div className="text-[10px] text-muted-foreground font-mono">
                            Order ID: <span className="text-foreground/80 font-semibold">{order.id.slice(0, 8)}</span>
                          </div>
                        </div>
                      </td>

                      {/* Linked Phone & DOB */}
                      <td className="p-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="font-mono font-bold text-foreground">
                              {order.customer_phone || "N/A"}
                            </span>
                            {order.customer_phone && (
                              <button
                                onClick={() => copyToClipboard(order.customer_phone!, "Phone Number", `phone-${order.id}`)}
                                title="Copy Phone Number"
                                className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                              >
                                {copiedKey === `phone-${order.id}` ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Calendar className="w-3 h-3" />
                            <span>DOB: <strong className="text-foreground">{applicant.dob}</strong></span>
                          </div>
                        </div>
                      </td>

                      {/* Location & Job */}
                      <td className="p-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-[11px] text-foreground">
                            <Briefcase className="w-3 h-3 text-muted-foreground" />
                            <span className="font-medium truncate max-w-[150px]">{applicant.occupation}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <MapPin className="w-3 h-3 text-muted-foreground" />
                            <span className="truncate max-w-[150px]">{applicant.residence}</span>
                          </div>
                          {applicant.email !== "N/A" && (
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <Mail className="w-3 h-3 text-muted-foreground" />
                              <span className="truncate max-w-[150px]">{applicant.email}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Agent / Purchaser */}
                      <td className="p-4">
                        <div className="space-y-0.5">
                          {order.agent_id ? (
                            <button
                              onClick={() => {
                                const prof = profiles[order.agent_id];
                                if (prof) setSelectedUserForDrawer(prof);
                              }}
                              className="font-bold text-foreground hover:text-emerald-400 transition-colors text-left block truncate max-w-[150px]"
                            >
                              {order.agent_name || "Agent"}
                            </button>
                          ) : (
                            <span className="text-muted-foreground font-semibold">Direct Customer</span>
                          )}

                          {order.agent_phone && (
                            <div className="text-[10px] text-muted-foreground font-mono">
                              {order.agent_phone}
                            </div>
                          )}

                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-border font-bold">
                            {order.is_sub_agent ? "Sub-Agent" : order.agent_id ? "Agent" : "Guest"}
                          </Badge>
                        </div>
                      </td>

                      {/* Amount & Payment */}
                      <td className="p-4">
                        <div className="space-y-0.5">
                          <div className="font-black text-sm text-foreground font-mono">
                            ₵{Number(order.amount || 0).toFixed(2)}
                          </div>
                          {Number(order.profit || 0) > 0 && (
                            <div className="text-[10px] text-emerald-400 font-bold font-mono">
                              +₵{Number(order.profit).toFixed(2)} profit
                            </div>
                          )}
                          <span className="inline-block uppercase text-[9px] font-black tracking-wider text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                            {order.payment_method || "Wallet"}
                          </span>
                        </div>
                      </td>

                      {/* Status & Provider */}
                      <td className="p-4">
                        <div className="space-y-1.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full border",
                              STATUS_COLORS[order.status] || "bg-muted text-muted-foreground border-border"
                            )}
                          >
                            {order.status.replace(/_/g, " ")}
                          </Badge>

                          {order.failure_reason && (
                            <div
                              title={order.failure_reason}
                              className="text-[10px] text-rose-400 truncate max-w-[140px] font-medium"
                            >
                              {order.failure_reason}
                            </div>
                          )}

                          <div className="text-[10px] text-muted-foreground font-mono">
                            {new Date(order.created_at).toLocaleDateString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit"
                            })}
                          </div>
                        </div>
                      </td>

                      {/* Action Menu */}
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setActiveDossierOrder(order)}
                            className="h-8 px-2.5 rounded-xl text-xs font-bold gap-1 border-border bg-background/50 hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-400"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Dossier
                          </Button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-foreground"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56 rounded-2xl p-1.5">
                              <DropdownMenuItem
                                onClick={() => {
                                  setOrderToEditStatus(order);
                                  setNewOrderStatus(order.status);
                                  setNewStatusReason(order.failure_reason || "");
                                }}
                                className="rounded-xl text-xs font-semibold gap-2 py-2 cursor-pointer"
                              >
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                Change Order Status
                              </DropdownMenuItem>

                              <DropdownMenuItem
                                onClick={() => handleRetryOrder(order.id)}
                                disabled={retryingId === order.id}
                                className="rounded-xl text-xs font-semibold gap-2 py-2 cursor-pointer"
                              >
                                {retryingId === order.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                                ) : (
                                  <RefreshCw className="w-4 h-4 text-amber-400" />
                                )}
                                Retry Provider Submission
                              </DropdownMenuItem>

                              <DropdownMenuItem
                                onClick={() => handleCheckProviderStatus(order.id)}
                                disabled={checkingStatusId === order.id}
                                className="rounded-xl text-xs font-semibold gap-2 py-2 cursor-pointer"
                              >
                                {checkingStatusId === order.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                                ) : (
                                  <Search className="w-4 h-4 text-sky-400" />
                                )}
                                Check Provider Status
                              </DropdownMenuItem>

                              <DropdownMenuItem
                                onClick={() => handleResendSms(order)}
                                disabled={resendingSmsId === order.id}
                                className="rounded-xl text-xs font-semibold gap-2 py-2 cursor-pointer"
                              >
                                {resendingSmsId === order.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin text-teal-400" />
                                ) : (
                                  <Send className="w-4 h-4 text-teal-400" />
                                )}
                                Resend Order SMS
                              </DropdownMenuItem>

                              <DropdownMenuItem
                                onClick={() => {
                                  const payload = `${applicant.fullName} | ${applicant.ghanaCard} | ${order.customer_phone || ''} | ${applicant.dob} | ${applicant.occupation} | ${applicant.residence}`;
                                  copyToClipboard(payload, "Carrier Registry String");
                                }}
                                className="rounded-xl text-xs font-semibold gap-2 py-2 cursor-pointer"
                              >
                                <Copy className="w-4 h-4 text-primary" />
                                Copy Carrier String
                              </DropdownMenuItem>

                              <DropdownMenuSeparator />

                              <DropdownMenuItem
                                onClick={() => handleRefund(order.id, order.amount)}
                                disabled={refundingId === order.id || order.status === "refunded"}
                                className="rounded-xl text-xs font-semibold gap-2 py-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                              >
                                {refundingId === order.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <RotateCcw className="w-4 h-4" />
                                )}
                                Refund Order (GHS {Number(order.amount).toFixed(2)})
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              Showing page <strong className="text-foreground">{page}</strong> of <strong className="text-foreground">{totalPages}</strong> ({totalCount.toLocaleString()} total orders)
            </p>

            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage(1)}
                className="h-8 w-8 p-0 rounded-xl border-border"
              >
                <ChevronsLeft className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="h-8 w-8 p-0 rounded-xl border-border"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>

              <span className="text-xs font-bold px-3 py-1 bg-muted/50 rounded-xl border border-border">
                {page} / {totalPages}
              </span>

              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="h-8 w-8 p-0 rounded-xl border-border"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage(totalPages)}
                className="h-8 w-8 p-0 rounded-xl border-border"
              >
                <ChevronsRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Comprehensive Applicant Dossier Modal */}
      <Dialog open={!!activeDossierOrder} onOpenChange={(open) => !open && setActiveDossierOrder(null)}>
        <DialogContent className="max-w-2xl rounded-3xl p-6 border-border bg-card/95 backdrop-blur-2xl">
          {activeDossierOrder && (() => {
            const app = resolveApplicant(activeDossierOrder);
            return (
              <div className="space-y-6">
                <DialogHeader>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      Official AFA Applicant Dossier
                    </span>
                    <Badge variant="outline" className={cn("text-[10px] font-bold uppercase", STATUS_COLORS[activeDossierOrder.status])}>
                      {activeDossierOrder.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <DialogTitle className="text-2xl font-black text-foreground">
                    {app.fullName}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    National ID Registration, SIM Card Linking Details, and Carrier Verification Log.
                  </DialogDescription>
                </DialogHeader>

                {/* Simulated National ID Card Preview Card */}
                <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-950/40 via-teal-950/20 to-background border border-emerald-500/30 relative overflow-hidden shadow-inner">
                  <div className="absolute -right-8 -bottom-8 opacity-10 text-emerald-400 pointer-events-none">
                    <ShieldCheck className="w-48 h-48" />
                  </div>

                  <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-black text-xs">
                        GH
                      </div>
                      <span className="text-[11px] font-black uppercase tracking-wider text-emerald-400">
                        Republic of Ghana • National AFA Registry
                      </span>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-muted-foreground">
                      ID: {activeDossierOrder.id.slice(0, 8).toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground">Ghana Card Number</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-base font-black text-emerald-400 font-mono tracking-wider">
                          {app.ghanaCard}
                        </p>
                        <button
                          onClick={() => copyToClipboard(app.ghanaCard, "Ghana Card Number")}
                          className="text-muted-foreground hover:text-emerald-400 p-1"
                          title="Copy Card"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground">Linked Target Phone</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-base font-black text-foreground font-mono">
                          {app.phone}
                        </p>
                        <button
                          onClick={() => copyToClipboard(app.phone, "Phone Number")}
                          className="text-muted-foreground hover:text-emerald-400 p-1"
                          title="Copy Phone"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground">Date of Birth</p>
                      <p className="text-sm font-bold text-foreground mt-0.5">{app.dob}</p>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground">Occupation / Profession</p>
                      <p className="text-sm font-bold text-foreground mt-0.5">{app.occupation}</p>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground">Place of Residence</p>
                      <p className="text-sm font-bold text-foreground mt-0.5">{app.residence}</p>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground">Applicant Email</p>
                      <p className="text-sm font-bold text-foreground mt-0.5 truncate">{app.email}</p>
                    </div>
                  </div>
                </div>

                {/* Technical / Order Metadata Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-muted/30 p-4 rounded-2xl border border-border text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block">Amount Paid</span>
                    <strong className="text-foreground font-mono">GHS {Number(activeDossierOrder.amount).toFixed(2)}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block">Platform Profit</span>
                    <strong className="text-emerald-400 font-mono">GHS {Number(activeDossierOrder.profit || 0).toFixed(2)}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block">Payment Method</span>
                    <strong className="text-foreground uppercase">{activeDossierOrder.payment_method || "Wallet"}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block">Order Date</span>
                    <span className="text-muted-foreground">{new Date(activeDossierOrder.created_at).toLocaleDateString()}</span>
                  </div>
                </div>

                {activeDossierOrder.failure_reason && (
                  <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold block">Carrier Failure / Rejection Note:</strong>
                      <span>{activeDossierOrder.failure_reason}</span>
                    </div>
                  </div>
                )}

                {/* Modal Action Buttons */}
                <DialogFooter className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const payload = `${app.fullName}\t${app.ghanaCard}\t${app.phone}\t${app.dob}\t${app.occupation}\t${app.residence}\t${app.email}`;
                      copyToClipboard(payload, "Tab-Separated Carrier Payload");
                    }}
                    className="w-full sm:w-auto text-xs font-bold gap-1.5 rounded-xl border-border"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy Carrier Payload
                  </Button>

                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setOrderToEditStatus(activeDossierOrder);
                        setNewOrderStatus(activeDossierOrder.status);
                        setNewStatusReason(activeDossierOrder.failure_reason || "");
                        setActiveDossierOrder(null);
                      }}
                      className="flex-1 sm:flex-initial text-xs font-bold rounded-xl border-border"
                    >
                      Change Status
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleResendSms(activeDossierOrder)}
                      className="flex-1 sm:flex-initial text-xs font-bold rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Send SMS Update
                    </Button>
                  </div>
                </DialogFooter>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Manual Status Changer Modal */}
      <Dialog open={!!orderToEditStatus} onOpenChange={(open) => !open && setOrderToEditStatus(null)}>
        <DialogContent className="max-w-md rounded-3xl p-6 border-border bg-card/95 backdrop-blur-xl">
          <form onSubmit={handleUpdateSingleStatus} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="text-xl font-black text-foreground">
                Update AFA Order Status
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Transition order #{orderToEditStatus?.id.slice(0, 8)} to a new verification state.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div>
                <label className="text-xs font-bold text-foreground block mb-1.5">New Status</label>
                <select
                  value={newOrderStatus}
                  onChange={(e) => setNewOrderStatus(e.target.value)}
                  className="w-full text-xs h-10 bg-background border border-border rounded-xl px-3 text-foreground font-semibold outline-none focus:border-emerald-500"
                  required
                >
                  <option value="fulfilled">Fulfilled (Successfully Linked)</option>
                  <option value="processing">Processing (In Queue with Carrier)</option>
                  <option value="paid">Paid (Pending Registry)</option>
                  <option value="fulfillment_failed">Fulfillment Failed (Declined by Carrier)</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="refunded">Refunded</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-foreground block mb-1.5">
                  Failure Reason or Administrative Note (Optional)
                </label>
                <Input
                  value={newStatusReason}
                  onChange={(e) => setNewStatusReason(e.target.value)}
                  placeholder="e.g. Ghana Card name mismatch, Invalid SIM, etc."
                  className="h-10 text-xs rounded-xl bg-background border-border"
                />
              </div>
            </div>

            <DialogFooter className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOrderToEditStatus(null)}
                className="text-xs font-bold rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updatingSingleStatus}
                className="text-xs font-black uppercase tracking-wider rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white"
              >
                {updatingSingleStatus ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* User Detail Drawer for Agent Inspection */}
      <UserDetailDrawer
        user={selectedUserForDrawer as any}
        onClose={() => setSelectedUserForDrawer(null)}
      />
    </div>
  );
}
