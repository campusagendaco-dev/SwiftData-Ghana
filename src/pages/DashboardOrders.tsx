import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";
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
import { Link } from "react-router-dom";
import WhatsAppReceiptModal from "@/components/WhatsAppReceiptModal";

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

function isBeneficiaryFailure(order: Pick<Order, "status" | "failure_reason">): boolean {
  if (order.status !== "fulfillment_failed") return false;
  const reason = (order.failure_reason || "").toLowerCase();
  return reason.includes("beneficiary") || reason.includes("not added");
}

const networkBadgeStyles: Record<string, { bg: string; text: string; border: string }> = {
  MTN:        { bg: "bg-amber-500/15",  text: "text-amber-400", border: "border-amber-500/30" },
  Telecel:    { bg: "bg-red-500/15",    text: "text-red-400",   border: "border-red-500/30" },
  AirtelTigo: { bg: "bg-blue-500/15",   text: "text-blue-400",  border: "border-blue-500/30" },
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
        label: "Purchase Successful",
        shortLabel: "Success ✓",
        icon: CheckCircle2,
        dot: "bg-emerald-500",
        badge: "bg-emerald-500/15 border-emerald-500/30 text-emerald-400",
        text: "text-emerald-400",
      };
    case "refunded":
      return {
        label: "Refunded to Wallet",
        shortLabel: "Refunded ↺",
        icon: RotateCcw,
        dot: "bg-purple-500",
        badge: "bg-purple-500/15 border-purple-500/30 text-purple-400",
        text: "text-purple-400",
      };
    case "fulfillment_failed":
      return {
        label: "Delivery Failed",
        shortLabel: "Delivery Failed",
        icon: XCircle,
        dot: "bg-rose-500",
        badge: "bg-rose-500/15 border-rose-500/30 text-rose-400",
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
        badge: "bg-sky-500/15 border-sky-500/30 text-sky-400",
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
          badge: "bg-sky-500/15 border-sky-500/30 text-sky-400",
          text: "text-sky-400",
          spinning: true,
        };
      }
      return {
        label: "Awaiting Checkout",
        shortLabel: "Verifying...",
        icon: Loader2,
        dot: "bg-amber-400",
        badge: "bg-amber-500/15 border-amber-500/30 text-amber-400",
        text: "text-amber-400",
        spinning: true,
      };
    default:
      return {
        label: "Pending",
        shortLabel: "Pending",
        icon: Clock,
        dot: "bg-amber-400",
        badge: "bg-amber-500/15 border-amber-500/30 text-amber-400",
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedOrderForReceipt, setSelectedOrderForReceipt] = useState<any | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
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

    if (!confirm(`Are you sure you want to refund GH₵ ${Number(order.amount).toFixed(2)} for order ${order.id.slice(0, 8)} to your wallet balance?`)) {
      return;
    }

    setRefundingId(order.id);
    try {
      let isRefunded = false;
      let statusMessage = "";

      try {
        const { data: edgeData, error: edgeErr } = await supabase.functions.invoke("verify-and-refund", {
          body: { order_id: order.id }
        });
        if (!edgeErr && edgeData?.success) {
          isRefunded = true;
          statusMessage = edgeData.message || `GH₵ ${Number(order.amount).toFixed(2)} credited to your wallet balance.`;
        } else if (!edgeErr && edgeData?.error) {
          toast({ title: "Refund Blocked by Server", description: edgeData.error, variant: "destructive" });
          setRefundingId(null);
          return;
        }
      } catch (e) {
        console.warn("[Refund] Edge function invoke error, falling back to direct server RPC...", e);
      }

      if (!isRefunded) {
        const { data: rpcData, error: rpcErr } = await (supabase.rpc as any)("refund_failed_order", { p_order_id: order.id });
        if (rpcErr || !rpcData) {
          toast({ title: "Refund Blocked", description: rpcErr?.message || "Order is ineligible for refund.", variant: "destructive" });
          setRefundingId(null);
          return;
        }
        isRefunded = true;
        statusMessage = `GH₵ ${Number(order.amount).toFixed(2)} credited to your wallet balance.`;
      }

      if (isRefunded) {
        toast({
          title: "Order Refunded Successfully!",
          description: statusMessage,
        });
        setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: "refunded" } : o)));

        supabase.functions.invoke("send-order-sms", {
          body: {
            action: "refund",
            phone: order.customer_phone,
            order_id: order.id,
            amount: order.amount,
            agent_id: user.id
          }
        }).catch(console.error);
      }
    } catch (err: any) {
      console.error("Refund error:", err);
      toast({ title: "Refund Error", description: err.message || "Failed to execute refund", variant: "destructive" });
    } finally {
      setRefundingId(null);
    }
  };

  const fetchOrders = useCallback(async (isLoadMore = false) => {
    if (!user) return;
    if (!isLoadMore) {
      setLoading(true);
      setPage(0);
    }

    const currentPage = isLoadMore ? page + 1 : 0;
    const from = currentPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const candidateAgentIds = Array.from(new Set([
      user.id,
      profile?.user_id,
      profile?.id,
    ].filter(Boolean) as string[]));

    let q = supabase
      .from("orders")
      .select("*", { count: "exact" })
      .in("agent_id", candidateAgentIds)
      .in("status", ["pending", "paid", "processing", "fulfilled", "fulfillment_failed", "awaiting_payment", "refunded"])
      .order("created_at", { ascending: false })
      .range(from, to);

    if (filter !== "all") {
      if (filter === "data" || filter === "airtime" || filter === "utility") {
        q = q.eq("order_type", filter);
      } else {
        q = q.eq("status", filter);
      }
    }

    if (search.trim()) {
      const term = sanitizeSearchTerm(search);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term);
      if (isUuid) {
        q = q.eq("id", term);
      } else {
        q = q.or(`customer_phone.ilike.%${term}%,network.ilike.%${term}%,package_size.ilike.%${term}%`);
      }
    }

    const { data, count } = await q;

    if (data) {
      setOrders(prev => isLoadMore ? [...prev, ...data] : data);
      setHasMore(count ? (from + data.length < count) : data.length === PAGE_SIZE);
      if (isLoadMore) setPage(currentPage);
    }

    setLoading(false);
  }, [filter, search, page, profile?.id, profile?.user_id, user]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchOrders(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [filter, search, user, profile?.id, fetchOrders]);

  // Live realtime updates for all current orders
  useEffect(() => {
    if (!user) return;
    const channelId = `dash_orders_live_${user.id}_${Math.random().toString(36).substring(7)}`;
    const ch = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders" },
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
        { event: "INSERT", schema: "public", table: "orders" },
        (payload: any) => {
          const created = payload.new;
          if (!created?.id) return;
          if (created.agent_id === user.id) {
            setOrders((prev) => [created, ...prev]);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [user]);

  // Manual retry for a single order
  const retryOrder = useCallback(async (orderId: string) => {
    setRetryingIds((prev) => new Set(prev).add(orderId));
    try {
      await invokePublicFunctionAsUser("verify-payment", { body: { reference: orderId } });
      await fetchOrders();
    } catch {
      // silent — real-time will handle the update
    } finally {
      setRetryingIds((prev) => { const n = new Set(prev); n.delete(orderId); return n; });
    }
  }, [fetchOrders]);

  // Auto-retry pending/paid orders sequentially every 45s with rate-limit protection
  useEffect(() => {
    if (!user) return;
    let isCancelled = false;

    const runAutoRetry = async () => {
      const stuck = orders.filter(
        (o) => o.status === "pending" || o.status === "paid"
      );
      if (stuck.length === 0) return;

      for (const o of stuck) {
        if (isCancelled) break;
        const attempts = retryCountRef.current[o.id] ?? 0;
        if (attempts >= 5) continue;
        retryCountRef.current[o.id] = attempts + 1;
        try {
          const res = await invokePublicFunctionAsUser("verify-payment", { body: { reference: o.id } });
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
    const statusLabel =
      order.status === "fulfilled" ? "✅ Delivered" :
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
    const statusLabel =
      order.status === "fulfilled" ? "Delivered" :
      order.status === "fulfillment_failed" ? "Failed" :
      order.status === "paid" || order.status === "processing" ? "Processing" : "Pending";
    const statusColor =
      order.status === "fulfilled" ? "#16a34a" :
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

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header Hero Section ── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900/90 via-slate-900/60 to-amber-950/20 p-6 sm:p-8 border border-white/10 backdrop-blur-2xl shadow-2xl">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-1/3 -mb-16 w-60 h-60 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-amber-400 animate-pulse" /> Live Order Stream
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Realtime Synchronized
              </span>
            </div>
            <h1 className="font-display text-2xl sm:text-4xl font-black tracking-tight text-white flex items-center gap-3">
              Transactions & Orders
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-xl leading-relaxed">
              Track live data deliveries, airtime top-ups, utility payments, and profits. Failed non-beneficiary numbers auto-queue for approval.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link to="/dashboard/submit-numbers">
              <Button
                size="sm"
                className="gap-2 h-10 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-950/30 border border-amber-400/40"
              >
                <ShieldCheck className="w-4 h-4" /> Submit Numbers
              </Button>
            </Link>

            <Link to="/dashboard/refunded-orders">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 h-10 rounded-xl border-white/10 bg-white/5 hover:bg-white/10 text-white text-xs font-bold backdrop-blur-sm"
              >
                <RotateCcw className="w-3.5 h-3.5 text-purple-400" /> Refunded Orders
              </Button>
            </Link>

            <Button
              variant="outline"
              size="sm"
              className="gap-2 h-10 rounded-xl border-white/10 bg-white/5 hover:bg-white/10 text-white text-xs font-bold backdrop-blur-sm"
              onClick={() => fetchOrders(false)}
              disabled={loading}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* ── Summary Performance KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-1 mb-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="text-[10px] font-extrabold text-emerald-400 uppercase tracking-widest bg-emerald-500/20 px-2 py-0.5 rounded-full">Success</span>
          </div>
          {loading ? <Skeleton className="h-7 w-12 mb-1" /> : (
            <p className="font-black text-2xl text-emerald-400">{stats.delivered}</p>
          )}
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mt-0.5">Delivered Orders</p>
        </div>

        <div className="rounded-2xl bg-sky-500/10 border border-sky-500/20 p-4 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-1 mb-2">
            <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
            <span className="text-[10px] font-extrabold text-sky-400 uppercase tracking-widest bg-sky-500/20 px-2 py-0.5 rounded-full">Live</span>
          </div>
          {loading ? <Skeleton className="h-7 w-12 mb-1" /> : (
            <p className="font-black text-2xl text-sky-400">{stats.processing}</p>
          )}
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mt-0.5">Processing Orders</p>
        </div>

        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-1 mb-2">
            <TrendingUp className="w-4 h-4 text-amber-400" />
            <span className="text-[10px] font-extrabold text-amber-400 uppercase tracking-widest bg-amber-500/20 px-2 py-0.5 rounded-full">Volume</span>
          </div>
          {loading ? <Skeleton className="h-7 w-20 mb-1" /> : (
            <p className="font-black text-2xl text-amber-400">GH₵{stats.totalSales.toFixed(2)}</p>
          )}
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mt-0.5">Total Sales Volume</p>
        </div>

        <div className="rounded-2xl bg-purple-500/10 border border-purple-500/20 p-4 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-1 mb-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span className="text-[10px] font-extrabold text-purple-400 uppercase tracking-widest bg-purple-500/20 px-2 py-0.5 rounded-full">Profit</span>
          </div>
          {loading ? <Skeleton className="h-7 w-20 mb-1" /> : (
            <p className="font-black text-2xl text-purple-400">GH₵{stats.totalProfit.toFixed(2)}</p>
          )}
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mt-0.5">Your Profit Earned</p>
        </div>
      </div>

      {/* ── Search & Filter Controls ── */}
      <div className="glass-card-neo rounded-2xl sm:rounded-3xl p-4 border border-white/10 backdrop-blur-2xl">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search recipient phone, network, size..."
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

          {/* Filter dropdown */}
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-xs h-10 bg-background/80 border border-border rounded-xl px-3 py-2 text-foreground font-bold outline-none focus:border-amber-500/50 min-w-[160px]"
            >
              <option value="all">All Orders</option>
              <option value="data">Data Bundles</option>
              <option value="airtime">Airtime</option>
              <option value="utility">Utility Bills</option>
              <option value="processing">Processing</option>
              <option value="fulfilled">Delivered</option>
              <option value="refunded">Refunded Orders</option>
              <option value="fulfillment_failed">Delivery Failed</option>
            </select>

            {(search || filter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSearch(""); setFilter("all"); }}
                className="text-xs text-amber-400 hover:text-amber-300 gap-1 h-10 px-3 rounded-xl font-bold shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reset
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Transaction Order List ── */}
      <div className="glass-card-neo rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
        <div className="px-6 py-4 border-b border-border/80 flex items-center justify-between bg-muted/40 backdrop-blur-md">
          <p className="font-extrabold text-sm text-foreground">
            {loading ? "Loading transactions…" : `${orders.length} Transaction Record${orders.length !== 1 ? "s" : ""}`}
          </p>
          <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live Sync
          </span>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 rounded-2xl bg-secondary/40 animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="py-20 text-center p-8">
            <ClipboardList className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-foreground font-bold text-base">No orders found</p>
            <p className="text-muted-foreground text-xs mt-1">No transaction records matched your search filters.</p>
          </div>
        ) : (
          <div className="p-4 sm:p-5 space-y-3">
            {orders.map((order) => {
              const ds = getDisplayStatus(order.status, order.order_type, order.network);
              const isBeneficiary = isBeneficiaryFailure(order);
              const effectiveDs: DisplayStatus = isBeneficiary
                ? {
                    label: "Whitelisted — In Queue for Retry",
                    shortLabel: "In Queue",
                    icon: Clock,
                    dot: "bg-emerald-500",
                    badge: "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 font-extrabold",
                    text: "text-emerald-400",
                  }
                : ds;

              const netStyle = networkBadgeStyles[order.network || ""] || { bg: "bg-slate-500/15", text: "text-slate-300", border: "border-slate-500/30" };
              const { date, time } = fmt(order.created_at);
              const isWalletTopup = order.order_type === "wallet_topup";
              const isAirtime = order.order_type === "airtime";
              const isUtility = order.order_type === "utility";
              const isExpanded = expandedId === order.id;

              const timelineSteps = [
                { label: "Order Created", done: true, time: fmt(order.created_at).time },
                { label: "Payment Confirmed", done: ["paid","processing","fulfilled","fulfillment_failed"].includes(order.status) },
                { 
                  label: isUtility ? "Processing Bill" : isAirtime ? "Sending Airtime" : "Delivering Data", 
                  done: ["processing","fulfilled","fulfillment_failed"].includes(order.status), 
                  spinning: order.status === "processing" || order.status === "paid" 
                },
                {
                  label: order.status === "fulfillment_failed" ? "Failed" : "Success",
                  done: order.status === "fulfilled" || order.status === "fulfillment_failed",
                  failed: order.status === "fulfillment_failed",
                  time: (order.status === "fulfilled" || order.status === "fulfillment_failed") && order.updated_at
                    ? fmt(order.updated_at).time : undefined,
                },
              ];

              const isStuck = (order.status === "pending" && order.network === "MTN Mash Up") 
                ? false 
                : ["pending", "paid", "processing", "fulfillment_failed", "awaiting_payment"].includes(order.status);
              const isRetrying = retryingIds.has(order.id);
              const retryCount = retryCountRef.current[order.id] ?? 0;

              return (
                <div key={order.id} className="rounded-2xl border border-white/10 overflow-hidden transition-all bg-card/60 hover:bg-card/90">
                  {/* Action Banner for pending/failed status */}
                  {isStuck && (
                    <div className={`flex items-center justify-between px-4 py-2 border-b ${order.status === "fulfillment_failed" ? "bg-rose-500/10 border-rose-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
                      <span className={`flex items-center gap-1.5 text-xs font-bold ${order.status === "fulfillment_failed" ? "text-rose-400" : "text-amber-400"}`}>
                        {order.status === "fulfillment_failed" ? (
                          <><XCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" /> Delivery Failed &mdash; Click Retry</>
                        ) : order.status === "paid" || order.status === "processing" ? (
                          <><Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-sky-400" /> Delivering Order…</>
                        ) : (
                          <>Awaiting Checkout…</>
                        )}
                        {retryCount > 0 && <span className="opacity-75 font-mono text-[10px]">(Attempt #{retryCount})</span>}
                      </span>
                      <button
                        onClick={() => retryOrder(order.id)}
                        disabled={isRetrying}
                        className={`text-xs font-extrabold px-3 py-1 rounded-lg transition-all border disabled:opacity-50 ${
                          order.status === "fulfillment_failed" 
                            ? "text-rose-400 hover:text-rose-300 bg-rose-500/20 border-rose-500/30"
                            : "text-amber-400 hover:text-amber-300 bg-amber-500/20 border-amber-500/30"
                        }`}
                      >
                        {isRetrying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : order.status === "fulfillment_failed" ? "Retry Fulfillment" : "Check Status"}
                      </button>
                    </div>
                  )}

                  {/* Main row */}
                  <button
                    className="w-full flex items-center gap-3.5 p-4 text-left transition-colors hover:bg-white/5"
                    onClick={() => setExpandedId(isExpanded ? null : order.id)}
                  >
                    {/* Icon Badge */}
                    {isWalletTopup ? (
                      <div className="bg-emerald-500/15 border border-emerald-500/30 rounded-xl p-2.5 text-center shrink-0 w-12 h-12 flex flex-col items-center justify-center">
                        <Wallet className="w-5 h-5 text-emerald-400" />
                      </div>
                    ) : isAirtime ? (
                      <div className={`${netStyle.bg} ${netStyle.border} border rounded-xl p-2 text-center shrink-0 w-12 h-12 flex flex-col items-center justify-center`}>
                        <Smartphone className={`w-5 h-5 ${netStyle.text}`} />
                      </div>
                    ) : isUtility ? (
                      <div className="bg-purple-500/15 border border-purple-500/30 rounded-xl p-2 text-center shrink-0 w-12 h-12 flex flex-col items-center justify-center">
                        <Zap className="w-5 h-5 text-purple-400" />
                      </div>
                    ) : (
                      <div className={`${netStyle.bg} ${netStyle.border} border rounded-xl px-2 py-1.5 text-center shrink-0 w-12 h-12 flex flex-col items-center justify-center`}>
                        <p className={`font-black text-[10px] leading-none ${netStyle.text}`}>{order.network || "—"}</p>
                        <p className="font-black text-xs leading-tight mt-0.5 text-foreground">{order.package_size || "—"}</p>
                      </div>
                    )}

                    {/* Information */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-sm text-foreground">
                          {isWalletTopup ? "Wallet Top-up" : 
                           isAirtime ? `${order.network} Airtime` : 
                           isUtility ? `${order.package_size}` : 
                           `${order.network} ${order.package_size}`}
                        </span>
                        {!isWalletTopup && (
                          <Badge className={`text-[10px] px-2.5 py-0.5 rounded-full border ${effectiveDs.badge}`}>
                            <effectiveDs.icon className={`w-3 h-3 shrink-0 ${effectiveDs.spinning ? "animate-spin" : ""}`} />
                            {effectiveDs.shortLabel}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 font-mono">
                        {order.customer_phone || "—"} &nbsp;·&nbsp; {date} at {time}
                      </p>
                    </div>

                    {/* Pricing & Profit */}
                    <div className="text-right shrink-0 flex items-center gap-3">
                      <div>
                        <p className="font-mono font-black text-base text-foreground">GH₵{Number(order.amount).toFixed(2)}</p>
                        {(order.status === "fulfilled" || order.status === "completed") &&
                        ((order.order_type === "api" ? 0 : Number(order.profit)) > 0 || Number(order.parent_profit) > 0) && (
                          <div className="flex items-center justify-end gap-1 mt-0.5">
                            <span className="text-xs text-emerald-400 font-extrabold">
                              +GH₵{((order.order_type === "api" ? 0 : Number(order.profit)) + Number(order.parent_profit || 0)).toFixed(2)}
                            </span>
                          </div>
                        )}
                      </div>
                      <ChevronDown className={`w-4 h-4 transition-transform text-muted-foreground ${isExpanded ? "rotate-180" : ""}`} />
                    </div>
                  </button>

                  {/* Expanded Order Panel */}
                  {isExpanded && (
                    <div className="px-5 pb-5 pt-3 border-t border-white/10 bg-black/20 space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        {[
                          { icon: Receipt, label: "Order ID", value: order.id.slice(0, 8).toUpperCase() },
                          { icon: Phone, label: "Recipient Phone", value: order.customer_phone || "—" },
                          { icon: Package, label: "Service", value: isWalletTopup ? "Wallet Topup" : isAirtime ? `${order.network} Airtime` : isUtility ? order.package_size : `${order.network} ${order.package_size}` },
                          { icon: Calendar, label: "Date & Time", value: `${date} ${time}` },
                        ].map(({ icon: Icon, label, value }) => (
                          <div key={label} className="rounded-xl border border-white/10 bg-card/80 p-3">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Icon className="w-3.5 h-3.5 text-amber-400" />
                              <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{label}</span>
                            </div>
                            <p className="text-xs font-bold text-foreground truncate">{value}</p>
                          </div>
                        ))}
                      </div>

                      {/* Action buttons */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <button
                          onClick={() => copyReceipt(order)}
                          className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold border transition-all bg-white/5 border-white/10 text-white hover:bg-white/10"
                        >
                          {copiedId === order.id ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy Text Receipt</>}
                        </button>
                        <button
                          onClick={() => downloadReceiptPDF(order)}
                          className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold border transition-all bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
                        >
                          <Download className="w-3.5 h-3.5" /> Print / Download PDF
                        </button>

                        {order.status === "fulfilled" && order.customer_phone && (
                          <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedOrderForReceipt({ ...order, store_name: profile?.store_name })}
                              className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black border transition-all bg-emerald-600 hover:bg-emerald-500 text-white shadow-md active:scale-95"
                            >
                              <MessageCircle className="w-4 h-4 fill-white" />
                              📲 Send WhatsApp Receipt
                            </button>

                            <a
                              href={`sms:${order.customer_phone.replace(/\D+/g, "")}?body=${encodeURIComponent(
                                `Hi! Your ${order.network || ""} ${order.package_size || "bundle"} order from SwiftData Ghana is delivered! Need a refill? Order again at https://swiftdatagh.shop`
                              )}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-extrabold border transition-all bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 active:scale-95 shadow-sm"
                            >
                              <Send className="w-3.5 h-3.5" />
                              💬 Refill Nudge SMS
                            </a>
                          </div>
                        )}

                        {order.status !== "fulfilled" && order.status !== "refunded" && (
                          <button
                            onClick={() => handleRefundOrder(order)}
                            disabled={refundingId === order.id}
                            className="col-span-2 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-extrabold border transition-all bg-purple-500/15 border-purple-500/30 text-purple-300 hover:bg-purple-500/25 active:scale-95 shadow-sm"
                          >
                            {refundingId === order.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                            Refund GH₵{Number(order.amount).toFixed(2)} to Wallet Balance
                          </button>
                        )}
                      </div>

                      {/* Stepper Timeline */}
                      {!isWalletTopup && (
                        <div className="pt-2">
                          <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-3">Order Status Stepper</p>
                          <div className="flex items-start gap-0">
                            {timelineSteps.map((step, i) => (
                              <div key={step.label} className="flex-1 flex flex-col items-center">
                                <div className="flex items-center w-full">
                                  <div className={`flex-1 h-0.5 ${i === 0 ? "invisible" : step.done ? "bg-amber-400/60" : "bg-white/10"}`} />
                                  <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                                    step.failed
                                      ? "border-rose-500 bg-rose-500/20 text-rose-400"
                                      : step.done
                                      ? "border-amber-400 bg-amber-500/20 text-amber-400"
                                      : "border-white/10 bg-white/5 text-muted-foreground"
                                  }`}>
                                    {step.failed ? (
                                      <XCircle className="w-3.5 h-3.5" />
                                    ) : step.spinning ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : step.done ? (
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                    ) : (
                                      <div className="w-2 h-2 rounded-full bg-white/20" />
                                    )}
                                  </div>
                                  <div className={`flex-1 h-0.5 ${i === timelineSteps.length - 1 ? "invisible" : step.done && !step.failed && i < timelineSteps.length - 1 && timelineSteps[i + 1]?.done ? "bg-amber-400/60" : "bg-white/10"}`} />
                                </div>
                                <p className={`text-[10px] font-bold text-center mt-1.5 px-1 leading-tight ${step.failed ? "text-rose-400" : step.done ? "text-foreground" : "text-muted-foreground/40"}`}>
                                  {step.label}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {hasMore && (
              <div className="pt-4 flex justify-center border-t border-white/10 mt-4">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => fetchOrders(true)} 
                  disabled={loading}
                  className="rounded-xl px-8 font-bold text-xs h-10 border-white/10"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ChevronDown className="w-4 h-4 mr-2" />}
                  Load More Transactions
                </Button>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground text-center pt-2">
              Showing {orders.length} order{orders.length !== 1 ? "s" : ""} &middot; Realtime Connected
            </p>
          </div>
        )}
      </div>

      {/* WhatsApp Proof of Delivery Receipt Modal */}
      <WhatsAppReceiptModal
        order={selectedOrderForReceipt}
        isOpen={!!selectedOrderForReceipt}
        onClose={() => setSelectedOrderForReceipt(null)}
      />
    </div>
  );
};

export default DashboardOrders;
