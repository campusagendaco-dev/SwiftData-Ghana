import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ClipboardList, RefreshCw, CheckCircle2, XCircle, Clock, Loader2,
  Wallet, ChevronDown, Phone, Package, Calendar, Receipt, Copy, Check,
  Smartphone, Zap, Download, Search, RotateCcw, Send, ArrowRight,
  TrendingUp, ShieldCheck, X, Sparkles, Filter, AlertCircle, FileText,
  Activity, ExternalLink, MessageCircle
} from "lucide-react";
import { cn, escapeHtml, sanitizeSearchTerm } from "@/lib/utils";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { Link, useNavigate } from "react-router-dom";
import WhatsAppReceiptModal from "@/components/WhatsAppReceiptModal";
import {
  PageContainer, PageHeader, StatCard, EmptyState, NetworkMark, SkeletonRows,
  surface, btnPrimary, btnSecondary, fmtCedi, fmtInt,
} from "@/components/dashboard/ui";
import { translateFailureReason } from "@/lib/failure-reasons";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Order {
  id: string;
  order_type: string;
  customer_phone: string | null;
  network: string | null;
  package_size: string | null;
  amount: number;
  profit: number;
  parent_profit: number;
  status: string;
  failure_reason: string | null;
  created_at: string;
  updated_at: string | null;
}

function isBeneficiaryFailure(order: Partial<Order> & { metadata?: any }): boolean {
  if (order.metadata?.in_beneficiary_queue === true) return true;
  if (order.status !== "fulfillment_failed") return false;
  const net = String(order.network || "").toUpperCase();
  const isMtn = net.includes("MTN") || net.includes("YELLO");
  const isData = !order.order_type || order.order_type === "data" || order.order_type === "sme";
  if (!isMtn || !isData) return false;

  const reason = (order.failure_reason || "").toLowerCase();
  return (
    reason.includes("beneficiary") ||
    reason.includes("whitelist") ||
    reason.includes("not added") ||
    reason.includes("not on") ||
    reason.includes("unregistered") ||
    reason.includes("not registered")
  );
}

const networkBadgeStyles: Record<string, { bg: string; text: string; border: string }> = {
  MTN:        { bg: "bg-amber-500/15",  text: "text-amber-400", border: "border-amber-500/30" },
  Telecel:    { bg: "bg-red-500/15",    text: "text-red-400",   border: "border-red-500/30" },
  AirtelTigo: { bg: "bg-blue-500/15",   text: "text-blue-400",  border: "border-blue-500/30" },
};

const TONE = {
  emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20",
  violet: "bg-violet-500/10 text-violet-700 dark:text-violet-400 ring-violet-500/20",
  rose: "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/20",
  sky: "bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-sky-500/20",
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20",
};

interface DisplayStatus {
  label: string;
  shortLabel: string;
  icon: typeof CheckCircle2;
  dot: string;
  badge: string;
  text: string;
  spinning?: boolean;
}

function getDisplayStatus(status: string, orderType?: string, network?: string | null): DisplayStatus {
  switch (status) {
    case "fulfilled":
      return {
        label: "Delivered successfully",
        shortLabel: "Delivered",
        icon: CheckCircle2,
        dot: "bg-emerald-500",
        badge: TONE.emerald,
        text: "text-emerald-400",
      };
    case "refunded":
      return {
        label: "Refunded to Wallet",
        shortLabel: "Refunded",
        icon: RotateCcw,
        dot: "bg-purple-500",
        badge: TONE.violet,
        text: "text-purple-400",
      };
    case "fulfillment_failed":
      return {
        label: "Delivery Failed",
        shortLabel: "Failed",
        icon: XCircle,
        dot: "bg-rose-500",
        badge: TONE.rose,
        text: "text-rose-400",
      };
    case "paid":
    case "processing":
      return {
        label: orderType === "utility" ? "Processing Bill" : 
               orderType === "airtime" ? "Sending Airtime" : 
               orderType?.includes("vendor") ? "Processing Transfer" :
               "Delivering Data",
        shortLabel: "Processing",
        icon: Loader2,
        dot: "bg-sky-500",
        badge: TONE.sky,
        text: "text-sky-400",
        spinning: true,
      };
    case "pending":
    case "awaiting_payment":
      if (network === "MTN Mash Up") {
        return {
          label: "Paid & Processing",
          shortLabel: "Processing",
          icon: Loader2,
          dot: "bg-sky-500",
          badge: TONE.sky,
          text: "text-sky-400",
          spinning: true,
        };
      }
      return {
        label: "Awaiting Checkout",
        shortLabel: "Confirming",
        icon: Loader2,
        dot: "bg-amber-400",
        badge: TONE.amber,
        text: "text-amber-400",
        spinning: true,
      };
    default:
      return {
        label: "Pending",
        shortLabel: "Pending",
        icon: Clock,
        dot: "bg-amber-400",
        badge: TONE.amber,
        text: "text-amber-400",
      };
  }
}

function fmt(dateStr: string) {
  const d = new Date(dateStr);
  return {
    date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
}

const DashboardOrders = () => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { isDark } = useAppTheme();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [confirmRefundId, setConfirmRefundId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedOrderForReceipt, setSelectedOrderForReceipt] = useState<any | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const pageRef = useRef(page);
  pageRef.current = page;
  const PAGE_SIZE = 50;
  const retryCountRef = useRef<Record<string, number>>({});

  const handleRefundOrder = async (order: Order) => {
    if (order.status === "fulfilled") {
      toast({ title: "Cannot Refund", description: "Fulfilled orders cannot be refunded.", variant: "destructive" });
      return;
    }
    if (order.status === "refunded") {
      toast({ title: "Already Refunded", description: "This order has already been refunded to your wallet." });
      return;
    }

    setRefundingId(order.id);
    try {
      let isRefunded = false;
      let statusMessage = "";

      // Refunds & cancellations go through verify-and-refund, which calls DataMart /cancel-order or DataHub /order-refund before paying out.
      const { data: edgeData, error: edgeErr } = await supabase.functions.invoke("verify-and-refund", {
        body: {
          order_id: order.id,
          reference: order.id,
          mode: "cancel",
          reason: "customer changed mind"
        }
      });
      if (!edgeErr && edgeData?.success) {
        isRefunded = true;
        const refundedAmt = Number(edgeData.data?.refundedAmount ?? order.amount).toFixed(2);
        const newBalSuffix = edgeData.data?.newBalance !== undefined
          ? ` New wallet balance: GH₵ ${Number(edgeData.data.newBalance).toFixed(2)}.`
          : "";
        statusMessage = `${edgeData.message || `GH₵ ${refundedAmt} credited to your wallet.`}${newBalSuffix}`;
      } else {
        const description = edgeData?.error || (edgeErr
          ? await getFunctionErrorMessage(edgeErr, "Order is not eligible for refund.")
          : "Order is not eligible for refund.");
        toast({ title: "Refund Not Eligible", description, variant: "destructive" });
        setRefundingId(null);
        return;
      }

      if (isRefunded) {
        toast({
          title: "Order Refunded Successfully!",
          description: statusMessage,
        });
        setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: "refunded" } : o)));
      }
    } catch (err: any) {
      console.error("Refund error:", err);
      toast({ title: "Refund Error", description: err.message || "Failed to execute refund", variant: "destructive" });
    } finally {
      setRefundingId(null);
    }
  };

  const fetchOrders = useCallback(async (isLoadMore = false, isSilent = false) => {
    if (!user?.id || !UUID_REGEX.test(user.id)) {
      setOrders([]);
      setLoading(false);
      return;
    }
    if (!isLoadMore && !isSilent) {
      setLoading(true);
      setPage(0);
    }

    const currentPage = isLoadMore ? pageRef.current + 1 : (isSilent ? pageRef.current : 0);
    const from = isSilent ? 0 : currentPage * PAGE_SIZE;
    const to = isSilent ? (pageRef.current + 1) * PAGE_SIZE - 1 : from + PAGE_SIZE - 1;

    const candidateAgentIds = Array.from(new Set([
      user.id,
      profile?.user_id,
    ].filter((id): id is string => Boolean(id) && UUID_REGEX.test(id))));

    if (candidateAgentIds.length === 0) {
      setOrders([]);
      setLoading(false);
      return;
    }

    let q = supabase
      .from("orders")
      .select("*", { count: "estimated" })
      .in("agent_id", candidateAgentIds)
      .in("status", ["pending", "paid", "processing", "fulfilled", "fulfillment_failed", "awaiting_payment", "refunded"])
      .order("created_at", { ascending: false })
      .range(from, to);

    if (filter !== "all") {
      if (filter === "in_queue") {
        q = q.eq("status", "fulfillment_failed").or("failure_reason.ilike.%beneficiary%,failure_reason.ilike.%not added%,failure_reason.ilike.%whitelist%");
      } else if (filter === "fulfillment_failed") {
        q = q.eq("status", "fulfillment_failed").not("failure_reason", "ilike", "%beneficiary%").not("failure_reason", "ilike", "%not added%").not("failure_reason", "ilike", "%whitelist%");
      } else if (filter === "data" || filter === "airtime" || filter === "utility") {
        q = q.eq("order_type", filter);
      } else {
        q = q.eq("status", filter);
      }
    }

    if (search.trim()) {
      const term = sanitizeSearchTerm(search);
      const isUuid = UUID_REGEX.test(term);
      if (isUuid) {
        q = q.eq("id", term);
      } else {
        q = q.or(`customer_phone.ilike.%${term}%,network.ilike.%${term}%,package_size.ilike.%${term}%`);
      }
    }

    const { data, count, error } = await q;

    if (error) {
      console.warn("[DashboardOrders] Fetch error:", error.message);
      if (!isSilent) setLoading(false);
      return;
    }

    if (data) {
      setOrders(prev => {
        if (isSilent) return data;
        return isLoadMore ? [...prev, ...data] : data;
      });
      setHasMore(count ? ((isSilent ? (pageRef.current + 1) * PAGE_SIZE : from + data.length) < count) : data.length === PAGE_SIZE);
      if (isLoadMore) setPage(currentPage);
    }

    if (!isSilent) {
      setLoading(false);
    }
  }, [filter, search, profile?.user_id, user?.id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchOrders(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchOrders]);

  // Live realtime updates filtered specifically to current agent's orders
  useEffect(() => {
    if (!user?.id || !UUID_REGEX.test(user.id)) return;
    const channelId = `dash_orders_live_${user.id}_${Math.random().toString(36).substring(7)}`;
    const ch = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `agent_id=eq.${user.id}` },
        (payload: any) => {
          const updated = payload.new;
          if (!updated?.id) return;
          setOrders((prev) =>
            prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o))
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `agent_id=eq.${user.id}` },
        (payload: any) => {
          const created = payload.new;
          if (!created?.id) return;
          setOrders((prev) => {
            if (prev.some((o) => o.id === created.id)) return prev;
            return [created, ...prev];
          });
        }
      )
      .subscribe();

    return () => { safeRemoveChannel(ch); };
  }, [user]);

  // Manual retry or status check for a single order
  const checkOrderStatus = useCallback(async (orderId: string) => {
    setRetryingIds((prev) => new Set(prev).add(orderId));
    try {
      const { data, error } = await supabase.functions.invoke("check-order-status", {
        body: { order_id: orderId }
      });

      if (!error && data && data.success) {
        const orderData = data.order;
        const newStatus = orderData?.status;
        const carrierMsg = data.message || orderData?.carrier_status;

        const smsNote = data.sms_sent ? " • SMS update sent to customer" : "";

        toast({
          title: newStatus === "fulfilled" ? "Order Delivered! ✅" : "Live Status Checked 📡",
          description: (carrierMsg || `Order status: ${newStatus}`) + smsNote,
        });

        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, status: newStatus, failure_reason: orderData?.failure_reason } : o))
        );
      } else {
        await invokePublicFunctionAsUser("verify-payment", { body: { reference: orderId, force: true } });
        await fetchOrders(false, true);
      }
    } catch (err: any) {
      toast({
        title: "Status Check",
        description: err.message || "Failed to check status",
        variant: "destructive"
      });
    } finally {
      setRetryingIds((prev) => { const n = new Set(prev); n.delete(orderId); return n; });
    }
  }, [fetchOrders, toast]);

  const retryOrder = checkOrderStatus;

  // Auto-retry pending/paid orders sequentially every 45s with rate-limit protection
  useEffect(() => {
    if (!user) return;
    let isCancelled = false;

    const runAutoRetry = async () => {
      const stuck = orders.filter(
        (o) => o.status === "pending" || o.status === "paid" || o.status === "awaiting_payment"
      );
      if (stuck.length === 0) return;

      for (const o of stuck) {
        if (isCancelled) break;
        const attempts = retryCountRef.current[o.id] ?? 0;
        if (attempts >= 5) continue;
        retryCountRef.current[o.id] = attempts + 1;
        try {
          const res = await invokePublicFunctionAsUser("verify-payment", { body: { reference: o.id, force: true } });
          if (res?.error?.status === 429 || String(res?.error?.message).includes("429")) {
            console.warn("[DashboardOrders] Auto-retry hit 429 rate limit. Pausing batch retry.");
            break; // Pause batch if rate limited!
          }
        } catch (e) {
          console.error("Auto-retry error:", e);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    };

    const interval = setInterval(runAutoRetry, 45_000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [user, orders]);

  const copyReceipt = useCallback((order: Order) => {
    const { date, time } = fmt(order.created_at);
    const isWalletTopup = order.order_type === "wallet_topup";
    const isBeneficiary = isBeneficiaryFailure(order);
    const statusLabel =
      order.status === "fulfilled" ? "✅ Delivered" :
      isBeneficiary ? "⏳ In Queue (Verification)" :
      order.status === "fulfillment_failed" ? "❌ Failed" :
      order.status === "paid" || order.status === "processing" ? "⏳ Processing" :
      "🕐 Pending";

    const lines = [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "    SwiftData Ghana — Receipt",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `Order ID  : ${order.id.slice(0, 8).toUpperCase()}`,
      `Date      : ${date} at ${time}`,
      "─────────────────────────────────",
      isWalletTopup
        ? `Type      : Wallet Top-up`
        : order.order_type === "utility"
        ? `Type      : Utility Bill`
        : order.order_type === "airtime"
        ? `Type      : Airtime`
        : `Network   : ${order.network || "—"}`,
      isWalletTopup
        ? `Amount    : GH₵ ${Number(order.amount).toFixed(2)}`
        : `Package   : ${order.package_size || "—"}`,
      ...(!isWalletTopup ? [`Recipient : ${order.customer_phone || "—"}`] : []),
      `Amount    : GH₵ ${Number(order.amount).toFixed(2)}`,
      `Status    : ${statusLabel}`,
      "─────────────────────────────────",
      "  swiftdatagh.shop",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ];

    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopiedId(order.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  const downloadReceiptPDF = useCallback((order: Order) => {
    const { date, time } = fmt(order.created_at);
    const isWalletTopup = order.order_type === "wallet_topup";
    const isAirtime = order.order_type === "airtime";
    const isUtility = order.order_type === "utility";
    const isBeneficiary = isBeneficiaryFailure(order);
    const statusLabel =
      order.status === "fulfilled" ? "Delivered" :
      isBeneficiary ? "In Queue ⏳" :
      order.status === "fulfillment_failed" ? "Failed" :
      order.status === "paid" || order.status === "processing" ? "Processing" : "Pending";
    const statusColor =
      order.status === "fulfilled" ? "#16a34a" :
      isBeneficiary ? "#f59e0b" :
      order.status === "fulfillment_failed" ? "#dc2626" : "#d97706";

    const serviceLabel = escapeHtml(isWalletTopup ? "Wallet Top-up" :
                        isAirtime ? `${order.network} Airtime` :
                        isUtility ? order.package_size :
                        `${order.network} ${order.package_size}`);
    const safeCustomerPhone = escapeHtml(order.customer_phone || "—");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>SwiftData Receipt</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Helvetica Neue',Arial,sans-serif;background:#f9fafb;display:flex;justify-content:center;padding:40px 16px}
  .card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:400px;width:100%;overflow:hidden}
  .header{background:#030305;padding:28px 28px 20px;text-align:center}
  .logo{font-size:18px;font-weight:900;color:#fbbf24;letter-spacing:-.5px}
  .sub{font-size:11px;color:rgba(255,255,255,.4);margin-top:4px;text-transform:uppercase;letter-spacing:.15em}
  .body{padding:28px}
  .status-chip{display:inline-block;padding:5px 14px;border-radius:999px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;background:${statusColor}18;color:${statusColor};border:1px solid ${statusColor}40;margin-bottom:20px}
  .amount{font-size:38px;font-weight:900;color:#030305;letter-spacing:-1px;margin-bottom:4px}
  .amount-label{font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:.12em;margin-bottom:24px}
  .row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f3f4f6}
  .row:last-child{border-bottom:none}
  .row-label{font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.08em}
  .row-value{font-size:13px;font-weight:700;color:#111827;text-align:right;max-width:55%}
  .footer{background:#f9fafb;border-top:1px solid #f3f4f6;padding:16px 28px;text-align:center;font-size:10px;color:#9ca3af;letter-spacing:.05em}
  .footer strong{color:#fbbf24;font-weight:900}
  @media print{body{background:#fff;padding:0}.card{box-shadow:none;border-radius:0;max-width:100%}}
</style></head><body>
<div class="card">
  <div class="header">
    <div class="logo">SwiftData Ghana</div>
    <div class="sub">Official Transaction Receipt</div>
  </div>
  <div class="body">
    <div class="status-chip">${statusLabel}</div>
    <div class="amount">GH₵ ${Number(order.amount).toFixed(2)}</div>
    <div class="amount-label">Total Paid</div>
    <div class="row"><span class="row-label">Order ID</span><span class="row-value">${order.id.slice(0, 8).toUpperCase()}</span></div>
    <div class="row"><span class="row-label">Service</span><span class="row-value">${serviceLabel || "—"}</span></div>
    ${!isWalletTopup ? `<div class="row"><span class="row-label">Recipient</span><span class="row-value">${safeCustomerPhone}</span></div>` : ""}
    <div class="row"><span class="row-label">Date</span><span class="row-value">${date}</span></div>
    <div class="row"><span class="row-label">Time</span><span class="row-value">${time}</span></div>
    ${order.order_type !== "api" && Number(order.profit) > 0 ? `<div class="row"><span class="row-label">Your Profit</span><span class="row-value" style="color:#16a34a">+GH₵ ${Number(order.profit).toFixed(2)}</span></div>` : ""}
  </div>
  <div class="footer">Powered by <strong>SwiftData Ghana</strong> · swiftdatagh.shop · Secured by Paystack</div>
</div>
<script>window.onload=()=>{window.print();}</script>
</body></html>`;

    const w = window.open("", "_blank", "width=480,height=680");
    if (w) { w.document.write(html); w.document.close(); }
  }, []);

  const stats = orders.reduce(
    (acc, o) => {
      if (o.status === "fulfilled") acc.delivered += 1;
      else if (o.status === "fulfillment_failed") acc.failed += 1;
      else if (o.status === "paid" || o.status === "processing") acc.processing += 1;
      
      if (o.status === "fulfilled" && ["data", "airtime", "utility", "afa", "api"].includes(o.order_type) && Number(o.amount || 0) > 0) {
        acc.totalSales += Number(o.amount);
      }
      if (o.status === "fulfilled" && o.order_type !== "api") {
        acc.totalProfit += Number(o.profit);
      }
      
      return acc;
    },
    { delivered: 0, failed: 0, processing: 0, totalSales: 0, totalProfit: 0 }
  );

  const FILTERS: { id: string; label: string }[] = [
    { id: "all", label: "All" },
    { id: "data", label: "Data" },
    { id: "airtime", label: "Airtime" },
    { id: "utility", label: "Bills" },
    { id: "processing", label: "Processing" },
    { id: "in_queue", label: "In queue" },
    { id: "fulfilled", label: "Delivered" },
    { id: "fulfillment_failed", label: "Failed" },
    { id: "refunded", label: "Refunded" },
  ];

  const dayLabel = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const y = new Date();
    y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  };

  const groups: { label: string; items: Order[] }[] = [];
  for (const o of orders) {
    const label = dayLabel(o.created_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(o);
    else groups.push({ label, items: [o] });
  }

  const exportCsv = () => {
    const head = ["Date", "Order ID", "Type", "Network", "Package", "Recipient", "Amount", "Profit", "Status"];
    const rows = orders.map((o) => [
      new Date(o.created_at).toISOString(),
      o.id,
      o.order_type,
      o.network || "",
      o.package_size || "",
      o.customer_phone || "",
      Number(o.amount || 0).toFixed(2),
      o.order_type === "api" ? "0.00" : Number(o.profit || 0).toFixed(2),
      o.status,
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[head.join(","), ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `swiftdata-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const actionBtn =
    "inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl border border-border bg-card text-foreground text-[13px] font-semibold hover:bg-muted active:scale-[0.98] transition disabled:opacity-50 dark:bg-white/[0.04] dark:border-white/10 dark:hover:bg-white/[0.08]";

  return (
    <PageContainer className="pb-16">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live updates on
          </span>
        }
        title="Transactions"
        description="Every data, airtime and bill order you have placed, updated live as networks deliver."
        actions={
          <>
            <button type="button" onClick={() => fetchOrders(false)} disabled={loading} className={btnSecondary} aria-label="Refresh">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button type="button" onClick={exportCsv} disabled={orders.length === 0} className={btnSecondary}>
              <Download className="h-4 w-4" /> <span className="hidden sm:inline">Export</span> CSV
            </button>
            <Link to="/dashboard/submit-numbers" className={btnPrimary}>
              <ShieldCheck className="h-4 w-4" /> Submit numbers
            </Link>
          </>
        }
      />

      {/* KPIs (for the orders loaded below) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Delivered" value={fmtInt(stats.delivered)} icon={CheckCircle2} loading={loading} hint="In this list" />
        <StatCard label="In progress" value={fmtInt(stats.processing)} icon={Loader2} loading={loading} hint={stats.failed ? `${stats.failed} failed` : "None failed"} />
        <StatCard label="Sales volume" value={fmtCedi(stats.totalSales)} icon={TrendingUp} loading={loading} hint="Delivered orders" />
        <StatCard label="Profit earned" value={fmtCedi(stats.totalProfit)} icon={Sparkles} loading={loading} hint="Delivered orders" />
      </div>

      {/* Search + filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search phone number, network or bundle size"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 pl-10 pr-10 rounded-xl bg-card/85 border-border/70 dark:bg-black/30 dark:border-white/[0.08] text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto no-scrollbar">
          <div className="inline-flex gap-1.5 min-w-max" role="tablist" aria-label="Filter transactions">
            {FILTERS.map((f) => {
              const on = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    "h-9 px-3.5 rounded-full text-[13px] font-semibold border transition whitespace-nowrap",
                    on
                      ? "bg-foreground text-background border-foreground"
                      : "bg-card/85 text-muted-foreground border-border/70 hover:text-foreground dark:bg-black/30 dark:border-white/[0.08]"
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* List */}
      <section className={cn(surface, "overflow-hidden")}>
        <header className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-border/70 dark:border-white/[0.06]">
          <p className="text-sm font-semibold text-foreground">
            {loading ? "Loading…" : `${fmtInt(orders.length)} transaction${orders.length === 1 ? "" : "s"}`}
          </p>
          {(search || filter !== "all") && (
            <button type="button" onClick={() => { setSearch(""); setFilter("all"); }} className="text-xs font-semibold text-primary hover:underline">
              Clear filters
            </button>
          )}
        </header>

        {loading ? (
          <div className="p-4 sm:p-5"><SkeletonRows rows={6} /></div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={search || filter !== "all" ? "No matching transactions" : "No transactions yet"}
            description={search || filter !== "all" ? "Try another search or filter." : "Orders you place will appear here and update live."}
            action={
              search || filter !== "all" ? (
                <button type="button" onClick={() => { setSearch(""); setFilter("all"); }} className={btnSecondary}>Clear filters</button>
              ) : (
                <Link to="/dashboard/buy-data" className={btnPrimary}><Zap className="h-4 w-4" /> Buy data</Link>
              )
            }
          />
        ) : (
          <div>
            {groups.map((g) => (
              <div key={g.label}>
                <p className="sticky top-0 z-[1] px-4 sm:px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/70 backdrop-blur dark:bg-white/[0.03] border-b border-border/60 dark:border-white/[0.05]">
                  {g.label}
                </p>
                <ul className="divide-y divide-border/60 dark:divide-white/[0.05]">
                  {g.items.map((order) => {
                    const isBeneficiary = isBeneficiaryFailure(order);
                    const ds: DisplayStatus = isBeneficiary
                      ? { label: "In queue for number verification", shortLabel: "In queue", icon: Clock, dot: "bg-amber-500", badge: TONE.amber, text: "text-amber-600 dark:text-amber-400" }
                      : getDisplayStatus(order.status, order.order_type, order.network);
                    const { date, time } = fmt(order.created_at);
                    const isWalletTopup = order.order_type === "wallet_topup";
                    const isAirtime = order.order_type === "airtime";
                    const isUtility = order.order_type === "utility";
                    const isExpanded = expandedId === order.id;
                    const isRetrying = retryingIds.has(order.id);
                    const isActiveOrder = ["pending", "paid", "processing", "awaiting_payment"].includes(order.status) && !(order.status === "pending" && order.network === "MTN Mash Up");
                    const isFailed = order.status === "fulfillment_failed" && !isBeneficiary;
                    const earned = (order.order_type === "api" ? 0 : Number(order.profit || 0)) + Number(order.parent_profit || 0);
                    const title = isWalletTopup ? "Wallet top-up" : isAirtime ? `${order.network} airtime` : isUtility ? `${order.package_size || "Bill payment"}` : `${order.network || ""} ${order.package_size || ""}`.trim();

                    const timelineSteps = [
                      { label: "Placed", done: true },
                      { label: "Paid", done: ["paid", "processing", "fulfilled", "fulfillment_failed"].includes(order.status) },
                      { label: isUtility ? "Processing" : isAirtime ? "Sending" : "Delivering", done: ["processing", "fulfilled", "fulfillment_failed"].includes(order.status), spinning: order.status === "processing" || order.status === "paid" },
                      { label: isBeneficiary ? "In queue" : order.status === "fulfillment_failed" ? "Failed" : "Delivered", done: order.status === "fulfilled" || order.status === "fulfillment_failed", failed: isFailed },
                    ];

                    return (
                      <li key={order.id} className={cn(isExpanded && "bg-muted/40 dark:bg-white/[0.025]")}>
                        <button
                          type="button"
                          className="w-full flex items-center gap-3 px-4 sm:px-5 py-3.5 text-left hover:bg-muted/50 dark:hover:bg-white/[0.03] transition-colors"
                          onClick={() => setExpandedId(isExpanded ? null : order.id)}
                          aria-expanded={isExpanded}
                        >
                          {isWalletTopup ? (
                            <span className="h-10 w-10 shrink-0 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"><Wallet className="h-5 w-5" /></span>
                          ) : isUtility ? (
                            <span className="h-10 w-10 shrink-0 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center"><Zap className="h-5 w-5" /></span>
                          ) : (
                            <NetworkMark network={order.network} className="h-10 w-10 rounded-xl text-[11px]" />
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <p className="text-[14px] font-semibold text-foreground truncate">{title}</p>
                              {isAirtime && <Smartphone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                            </div>
                            <p className="text-xs text-muted-foreground truncate mt-0.5 tabular-nums">
                              {order.customer_phone && !isWalletTopup ? `${order.customer_phone} · ` : ""}{time}
                            </p>
                          </div>

                          <div className="text-right shrink-0 space-y-1">
                            <p className="text-[14px] font-semibold tabular-nums text-foreground">GH₵{Number(order.amount).toFixed(2)}</p>
                            {order.status === "fulfilled" && earned > 0 ? (
                              <p className="text-[11px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">+GH₵{earned.toFixed(2)} profit</p>
                            ) : !isWalletTopup ? (
                              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap", ds.badge)}>
                                <ds.icon className={cn("h-3 w-3", ds.spinning && "animate-spin")} />
                                {ds.shortLabel}
                              </span>
                            ) : null}
                          </div>
                          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                        </button>

                        {isExpanded && (
                          <div className="px-4 sm:px-5 pb-5 pt-1 space-y-4">
                            {/* Status line */}
                            <div className={cn("flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 ring-1 ring-inset", ds.badge)}>
                              <span className="inline-flex items-center gap-2 text-[13px] font-semibold min-w-0">
                                <ds.icon className={cn("h-4 w-4 shrink-0", ds.spinning && "animate-spin")} />
                                <span className="truncate">{ds.label}</span>
                              </span>
                              {(isActiveOrder || isFailed || isBeneficiary) && (
                                <button
                                  type="button"
                                  onClick={() => (isBeneficiary ? navigate("/submit-numbers") : checkOrderStatus(order.id))}
                                  disabled={isRetrying}
                                  className="shrink-0 h-8 px-3 rounded-lg bg-background/80 text-foreground text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-background disabled:opacity-60"
                                >
                                  {isRetrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isBeneficiary ? <ShieldCheck className="h-3.5 w-3.5" /> : <Activity className="h-3.5 w-3.5" />}
                                  {isBeneficiary ? "Verify number" : "Check status"}
                                </button>
                              )}
                            </div>

                            {/* Timeline */}
                            {!isWalletTopup && (
                              <ol className="grid grid-cols-4 gap-1" aria-label="Order progress">
                                {timelineSteps.map((step) => (
                                  <li key={step.label} className="flex flex-col gap-1.5">
                                    <span className={cn(
                                      "h-1.5 rounded-full",
                                      step.failed ? "bg-rose-500" : step.done ? "bg-emerald-500" : step.spinning ? "bg-sky-500/60 animate-pulse" : "bg-muted dark:bg-white/10"
                                    )} />
                                    <span className={cn("text-[11px] font-medium", step.failed ? "text-rose-600 dark:text-rose-400" : step.done ? "text-foreground" : "text-muted-foreground")}>{step.label}</span>
                                  </li>
                                ))}
                              </ol>
                            )}

                            {/* Details */}
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                              {[
                                { label: "Order ID", value: order.id.slice(0, 8).toUpperCase(), copy: order.id },
                                { label: "Recipient", value: order.customer_phone || "—", copy: order.customer_phone || undefined },
                                { label: "Service", value: title || "—" },
                                { label: "Date", value: `${date}, ${time}` },
                                { label: "Amount", value: `GH₵${Number(order.amount).toFixed(2)}` },
                                ...(order.status === "fulfilled" && earned > 0 ? [{ label: "Your profit", value: `GH₵${earned.toFixed(2)}` }] : []),
                              ].map((row) => (
                                <div key={row.label} className="min-w-0">
                                  <dt className="text-[11px] text-muted-foreground">{row.label}</dt>
                                  <dd className="mt-0.5 flex items-center gap-1 font-semibold text-foreground min-w-0">
                                    <span className="truncate tabular-nums">{row.value}</span>
                                    {row.copy && (
                                      <button
                                        type="button"
                                        onClick={() => { navigator.clipboard.writeText(row.copy!); toast({ title: "Copied", description: row.value }); }}
                                        className="h-6 w-6 shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
                                        aria-label={`Copy ${row.label}`}
                                      >
                                        <Copy className="h-3 w-3" />
                                      </button>
                                    )}
                                  </dd>
                                </div>
                              ))}
                            </dl>

                            {order.failure_reason && order.status !== "fulfilled" && (
                              <div className="flex gap-2.5 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-3.5 py-3 text-[13px] text-rose-700 dark:text-rose-300">
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                <p className="leading-relaxed break-words">{translateFailureReason(order.failure_reason, order.network, order.order_type)}</p>
                              </div>
                            )}

                            {/* Actions */}
                            <div className="grid grid-cols-2 gap-2">
                              <button type="button" onClick={() => copyReceipt(order)} className={actionBtn}>
                                {copiedId === order.id ? <><Check className="h-4 w-4 text-emerald-500" /> Copied</> : <><Receipt className="h-4 w-4" /> Copy receipt</>}
                              </button>
                              <button type="button" onClick={() => downloadReceiptPDF(order)} className={actionBtn}>
                                <FileText className="h-4 w-4" /> Print / PDF
                              </button>
                              {order.status === "fulfilled" && order.customer_phone && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedOrderForReceipt({ ...order, store_name: profile?.store_name })}
                                    className="inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[13px] font-semibold active:scale-[0.98] transition"
                                  >
                                    <MessageCircle className="h-4 w-4" /> WhatsApp receipt
                                  </button>
                                  <a
                                    href={`sms:${order.customer_phone.replace(/\D+/g, "")}?body=${encodeURIComponent(
                                      `Hi! Your ${order.network || ""} ${order.package_size || "bundle"} order from SwiftData Ghana is delivered! Need a refill? Order again at https://swiftdatagh.shop`
                                    )}`}
                                    className={actionBtn}
                                  >
                                    <Send className="h-4 w-4" /> Refill reminder
                                  </a>
                                </>
                              )}
                            </div>

                            {order.status !== "fulfilled" && order.status !== "refunded" && (
                              confirmRefundId === order.id ? (
                                <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.06] p-3.5 space-y-3">
                                  <p className="text-[13px] text-foreground">
                                    {order.status === "processing" || order.status === "pending" ? "Cancel this order and refund" : "Refund"}{" "}
                                    <span className="font-semibold tabular-nums">GH₵{Number(order.amount).toFixed(2)}</span> to your wallet? If the network has already delivered it, the refund will be declined.
                                  </p>
                                  <div className="grid grid-cols-2 gap-2">
                                    <button type="button" onClick={() => setConfirmRefundId(null)} className={actionBtn}>Keep order</button>
                                    <button
                                      type="button"
                                      onClick={() => { setConfirmRefundId(null); handleRefundOrder(order); }}
                                      className="inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[13px] font-semibold active:scale-[0.98] transition"
                                    >
                                      <RotateCcw className="h-4 w-4" /> Yes, refund
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmRefundId(order.id)}
                                  disabled={refundingId === order.id}
                                  className="w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-xl text-[13px] font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-500/10 transition disabled:opacity-60"
                                >
                                  {refundingId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                                  {order.status === "processing" || order.status === "pending" ? "Cancel order & refund to wallet" : "Refund to wallet"}
                                </button>
                              )
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            <div className="flex flex-col items-center gap-2 px-4 py-5 border-t border-border/70 dark:border-white/[0.06]">
              {hasMore && (
                <button type="button" onClick={() => fetchOrders(true)} disabled={loading} className={btnSecondary}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />} Load more
                </button>
              )}
              <p className="text-[11px] text-muted-foreground">
                Showing {fmtInt(orders.length)} transaction{orders.length === 1 ? "" : "s"} ·{" "}
                <Link to="/dashboard/refunded-orders" className="font-semibold hover:text-foreground">Refunded orders</Link>
              </p>
            </div>
          </div>
        )}
      </section>

      <WhatsAppReceiptModal
        order={selectedOrderForReceipt}
        isOpen={!!selectedOrderForReceipt}
        onClose={() => setSelectedOrderForReceipt(null)}
      />
    </PageContainer>
  );
};

export default DashboardOrders;
