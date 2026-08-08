import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ClipboardList, RefreshCw, CheckCircle2, XCircle, Clock, Loader2, Wallet, ChevronDown, Phone, Package, Calendar, Receipt, Copy, Check, Smartphone, Zap, Download, Search, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useToast } from "@/hooks/use-toast";

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
  created_at: string;
  updated_at: string | null;
}

const networkColors: Record<string, { bg: string; text: string }> = {
  MTN:        { bg: "bg-amber-400",  text: "text-black" },
  Telecel:    { bg: "bg-red-600",    text: "text-white" },
  AirtelTigo: { bg: "bg-blue-600",   text: "text-white" },
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
        dot: "bg-green-500",
        badge: "bg-green-500/12 border-green-500/25 text-green-600 dark:text-green-400",
        text: "text-green-600 dark:text-green-400",
      };
    case "refunded":
      return {
        label: "Refunded to Wallet",
        shortLabel: "Refunded ↺",
        icon: RotateCcw,
        dot: "bg-purple-500",
        badge: "bg-purple-500/15 border-purple-500/30 text-purple-600 dark:text-purple-400",
        text: "text-purple-600 dark:text-purple-400",
      };
    case "fulfillment_failed":
      return {
        label: "Delivery Failed",
        shortLabel: "Not Fulfilled",
        icon: XCircle,
        dot: "bg-red-500",
        badge: "bg-red-500/10 border-red-500/25 text-red-600 dark:text-red-400",
        text: "text-red-600 dark:text-red-400",
      };
    case "paid":
    case "processing":
      return {
        label: orderType === "utility" ? "Processing Bill" : 
               orderType === "airtime" ? "Sending Airtime" : 
               orderType?.includes("vendor") ? "Processing Vendor Transfer" :
               "Delivering Data",
        shortLabel: "Processing",
        icon: Loader2,
        dot: "bg-blue-500",
        badge: "bg-blue-500/10 border-blue-500/25 text-blue-600 dark:text-blue-400",
        text: "text-blue-600 dark:text-blue-400",
        spinning: true,
      };
    case "pending":
      if (network === "MTN Mash Up") {
        return {
          label: "Paid & Processing",
          shortLabel: "Processing",
          icon: Loader2,
          dot: "bg-blue-500",
          badge: "bg-blue-500/10 border-blue-500/25 text-blue-600 dark:text-blue-400",
          text: "text-blue-600 dark:text-blue-400",
          spinning: true,
        };
      }
      return {
        label: "Awaiting Checkout",
        shortLabel: "Verifying...",
        icon: Loader2,
        dot: "bg-amber-400",
        badge: "bg-amber-400/10 border-amber-400/25 text-amber-600 dark:text-amber-400",
        text: "text-amber-600 dark:text-amber-400",
        spinning: true,
      };
    case "awaiting_payment":
      return {
        label: "Awaiting Checkout",
        shortLabel: "Verifying...",
        icon: Loader2,
        dot: "bg-amber-400",
        badge: "bg-amber-400/10 border-amber-400/25 text-amber-600 dark:text-amber-400",
        text: "text-amber-600 dark:text-amber-400",
        spinning: true,
      };
    default:
      return {
        label: "Awaiting Payment",
        shortLabel: "Pending",
        icon: Clock,
        dot: "bg-amber-400",
        badge: "bg-amber-400/10 border-amber-400/25 text-amber-600 dark:text-amber-400",
        text: "text-amber-600 dark:text-amber-400",
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

      // 1. Attempt server-side Edge function verification first
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

      // 2. Direct server RPC fallback if Edge function was not reachable
      if (!isRefunded) {
        const { data: rpcData, error: rpcErr } = await supabase.rpc("refund_failed_order", { p_order_id: order.id });
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

        // Send SMS trigger
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
      const term = search.trim();
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
    const ch = supabase
      .channel("dashboard-orders-live")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders" },
        (payload: any) => {
          const updated = payload.new;
          if (!updated?.id) return;
          setOrders((prev) =>
            prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o))
          );
          // Clear retry state once resolved
          if (updated.status !== "pending" && updated.status !== "paid") {
            setRetryingIds((prev) => { const n = new Set(prev); n.delete(updated.id); return n; });
            delete retryCountRef.current[updated.id];
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
      // Status update arrives via realtime channel; just refresh as fallback
      await fetchOrders();
    } catch {
      // silent — real-time will handle the update
    } finally {
      setRetryingIds((prev) => { const n = new Set(prev); n.delete(orderId); return n; });
    }
  }, [fetchOrders]);

  // Auto-retry pending/paid orders sequentially every 30 s (max 10 attempts per order)
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      setOrders((current) => {
        const stuck = current.filter(
          (o) => o.status === "pending" || o.status === "paid"
        );
        
        // Process sequentially outside of the state updater to avoid 429 rate limits
        const processStuck = async () => {
          for (const o of stuck) {
            const attempts = retryCountRef.current[o.id] ?? 0;
            if (attempts >= 10) continue;
            retryCountRef.current[o.id] = attempts + 1;
            try {
              await invokePublicFunctionAsUser("verify-payment", { body: { reference: o.id } });
            } catch (e) {
              console.error("Auto-retry error:", e);
            }
            // Wait 1 second between requests to prevent HTTP 429 Too Many Requests
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        };
        
        processStuck();
        return current;
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, [user]);

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
        : order.order_type === "vendor_cash_in"
        ? `Type      : Vendor Cash-In`
        : order.order_type === "vendor_cash_out"
        ? `Type      : Vendor Cash-Out`
        : order.order_type === "vendor_bank_transfer"
        ? `Type      : Bank Transfer`
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
    const serviceLabel = isWalletTopup ? "Wallet Top-up" : 
                        isAirtime ? `${order.network} Airtime` : 
                        isUtility ? order.package_size : 
                        order.order_type === "vendor_cash_in" ? "Vendor Cash-In" :
                        order.order_type === "vendor_cash_out" ? "Vendor Cash-Out" :
                        order.order_type === "vendor_bank_transfer" ? "Bank Transfer" :
                        `${order.network} ${order.package_size}`;

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
    ${!isWalletTopup ? `<div class="row"><span class="row-label">Recipient</span><span class="row-value">${order.customer_phone || "—"}</span></div>` : ""}
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
      
      // Exclude pending/activation/topups from total sales volume
      if (o.status === "fulfilled" && ["data", "airtime", "utility", "afa", "api"].includes(o.order_type) && Number(o.amount || 0) > 0) {
        acc.totalSales += Number(o.amount);
      }
      // Only count profit on delivered orders; parent_profit is the upstream commission, not this agent's income
      if (o.status === "fulfilled" && o.order_type !== "api") {
        acc.totalProfit += Number(o.profit);
      }
      
      if (o.order_type === "data") acc.dataOrders += 1;
      else if (o.order_type === "airtime") acc.airtimeOrders += 1;
      else if (o.order_type === "utility") acc.utilityOrders += 1;
      
      return acc;
    },
    { delivered: 0, failed: 0, processing: 0, totalSales: 0, totalProfit: 0, dataOrders: 0, airtimeOrders: 0, utilityOrders: 0 }
  );

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-5xl space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className={cn("font-display text-2xl sm:text-3xl font-bold flex items-center gap-2", isDark ? "text-white" : "text-gray-900")}>
            <ClipboardList className="w-6 h-6 sm:w-7 sm:h-7 text-primary" /> Transactions
          </h1>
          <p className={cn("text-sm mt-0.5", isDark ? "text-muted-foreground" : "text-gray-500")}>
            Live delivery status for all your orders &mdash; updates instantly.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-60 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search phone, network, size..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm bg-background border-border"
            />
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-full sm:w-40 h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Orders</SelectItem>
              <SelectItem value="data">Data Bundles</SelectItem>
              <SelectItem value="airtime">Airtime</SelectItem>
              <SelectItem value="utility">Utility Bills</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="fulfilled">Delivered</SelectItem>
              <SelectItem value="refunded">Refunded Orders</SelectItem>
              <SelectItem value="fulfillment_failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => fetchOrders(false)} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl bg-green-500/8 border border-green-500/20 px-3 py-2.5 sm:px-4 sm:py-3 text-center">
          {loading ? <Skeleton className="h-6 w-8 mx-auto mb-1" /> : (
            <p className="font-black text-xl sm:text-2xl text-green-600 dark:text-green-400">{stats.delivered}</p>
          )}
          <p className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-wide">Delivered</p>
        </div>
        <div className="rounded-xl bg-blue-500/8 border border-blue-500/20 px-3 py-2.5 sm:px-4 sm:py-3 text-center">
          {loading ? <Skeleton className="h-6 w-8 mx-auto mb-1" /> : (
            <p className="font-black text-xl sm:text-2xl text-blue-600 dark:text-blue-400">{stats.processing}</p>
          )}
          <p className="text-[10px] sm:text-[11px] text-muted-foreground uppercase tracking-wide">Processing</p>
        </div>
        <div className={cn("rounded-xl border px-3 py-2.5 sm:px-4 sm:py-3 text-center", isDark ? "bg-card border-border" : "bg-white border-gray-200 shadow-sm")}>
          {loading ? <Skeleton className="h-6 w-16 mx-auto mb-1" /> : (
            <p className="font-black text-lg sm:text-xl text-primary truncate">₵{stats.totalSales.toFixed(2)}</p>
          )}
          <p className={cn("text-[10px] sm:text-[11px] uppercase tracking-wide", isDark ? "text-muted-foreground" : "text-gray-500")}>Total Sales</p>
        </div>
        <div className={cn("rounded-xl border px-3 py-2.5 sm:px-4 sm:py-3 text-center", isDark ? "bg-card border-border" : "bg-white border-gray-200 shadow-sm")}>
          {loading ? <Skeleton className="h-6 w-16 mx-auto mb-1" /> : (
            <p className="font-black text-lg sm:text-xl text-primary truncate">₵{stats.totalProfit.toFixed(2)}</p>
          )}
          <p className={cn("text-[10px] sm:text-[11px] uppercase tracking-wide", isDark ? "text-muted-foreground" : "text-gray-500")}>Total Profit</p>
        </div>
      </div>

      {/* Order cards */}
      <div className={cn("rounded-2xl border overflow-hidden", isDark ? "border-border bg-card" : "border-gray-200 bg-white")}>
        <div className={cn("px-5 py-4 border-b flex items-center justify-between", isDark ? "border-border" : "border-gray-100")}>
          <p className={cn("font-semibold text-sm", isDark ? "text-white" : "text-gray-900")}>
            {loading ? "Loading…" : `${orders.length} order${orders.length !== 1 ? "s" : ""}`}
          </p>
          <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Live updates
          </span>
        </div>

        {loading ? (
          <div className="p-5 space-y-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-[72px] rounded-xl bg-secondary/50 animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center">
            <ClipboardList className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No orders found.</p>
          </div>
        ) : (
          <div className="p-5 space-y-2.5">
              {orders.map((order) => {
                const ds = getDisplayStatus(order.status, order.order_type, order.network);
                const nc = networkColors[order.network || ""] || { bg: "bg-secondary", text: "text-foreground" };
                const { date, time } = fmt(order.created_at);
                const isWalletTopup = order.order_type === "wallet_topup";
                const isAirtime = order.order_type === "airtime";
                const isUtility = order.order_type === "utility";
                const isExpanded = expandedId === order.id;
  
                // Build timeline steps
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
                <div key={order.id} className={cn(
                  "rounded-xl border overflow-hidden transition-all",
                  isDark ? "border-border bg-secondary/30" : "bg-gray-50/50 border-gray-100 hover:border-gray-200"
                )}>
                  {/* Pending payment notice bar */}
                  {isStuck && (
                    <div className={cn(
                      "flex items-center justify-between px-3 py-2 border-b transition-colors",
                      order.status === "fulfillment_failed" ? "bg-red-500/8 border-red-500/15" : "bg-amber-400/8 border-amber-400/15"
                    )}>
                      <span className={cn(
                        "flex items-center gap-1.5 text-[10px] sm:text-[11px] font-semibold leading-tight",
                        order.status === "fulfillment_failed" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"
                      )}>
                        {order.status === "fulfillment_failed" ? (
                          <><XCircle className="w-3 h-3 shrink-0" /> Failed &mdash; click retry</>
                        ) : order.status === "paid" || order.status === "processing" ? (
                          <><Loader2 className="w-3 h-3 shrink-0 animate-spin" /> Received &mdash; delivering…</>
                        ) : (
                          <>Awaiting Checkout…</>
                        )}
                        {retryCount > 0 && <span className="opacity-60 ml-0.5">(#{retryCount})</span>}
                      </span>
                      <button
                        onClick={() => retryOrder(order.id)}
                        disabled={isRetrying}
                        className={cn(
                          "text-[10px] font-bold px-2 py-1 rounded-lg transition-all disabled:opacity-50 border",
                          order.status === "fulfillment_failed" 
                            ? "text-red-500 hover:text-red-400 bg-red-500/10 hover:bg-red-500/20 border-red-500/20"
                            : "text-amber-400 hover:text-amber-300 bg-amber-400/10 hover:bg-amber-400/20 border-amber-400/20"
                        )}
                      >
                        {isRetrying ? <Loader2 className="w-3 h-3 animate-spin" /> : order.status === "fulfillment_failed" ? "Retry Fulfillment" : "Check Status"}
                      </button>
                    </div>
                  )}
                  {/* Main row — clickable */}
                  <button
                    className={cn(
                      "w-full flex items-center gap-3 p-3 transition-colors text-left",
                      isDark ? "hover:bg-secondary/60" : "hover:bg-white/80"
                    )}
                    onClick={() => setExpandedId(isExpanded ? null : order.id)}
                  >
                    {/* Network badge / Wallet icon */}
                    {isWalletTopup ? (
                      <div className="bg-primary/15 rounded-lg px-2.5 py-1.5 text-center shrink-0 w-[52px]">
                        <Wallet className="w-5 h-5 text-primary mx-auto" />
                        <p className="text-[10px] text-primary font-bold mt-0.5 leading-none">Topup</p>
                      </div>
                    ) : isAirtime ? (
                      <div className={`${nc.bg} ${nc.text} rounded-lg px-2.5 py-1.5 text-center shrink-0 w-[52px]`}>
                        <Smartphone className="w-5 h-5 mx-auto" />
                        <p className="text-[10px] font-bold mt-0.5 leading-none">Airtime</p>
                      </div>
                    ) : isUtility ? (
                      <div className="bg-purple-500/15 rounded-lg px-2.5 py-1.5 text-center shrink-0 w-[52px]">
                        <Zap className="w-5 h-5 text-purple-500 mx-auto" />
                        <p className="text-[10px] text-purple-500 font-bold mt-0.5 leading-none">Utility</p>
                      </div>
                    ) : order.order_type === "vendor_cash_in" ? (
                      <div className="bg-red-500/15 rounded-lg px-2.5 py-1.5 text-center shrink-0 w-[52px]">
                        <Wallet className="w-5 h-5 text-red-500 mx-auto" />
                        <p className="text-[10px] text-red-500 font-bold mt-0.5 leading-none">Cash-In</p>
                      </div>
                    ) : order.order_type === "vendor_cash_out" ? (
                      <div className="bg-emerald-500/15 rounded-lg px-2.5 py-1.5 text-center shrink-0 w-[52px]">
                        <Wallet className="w-5 h-5 text-emerald-500 mx-auto" />
                        <p className="text-[10px] text-emerald-500 font-bold mt-0.5 leading-none">Cash-Out</p>
                      </div>
                    ) : order.order_type === "vendor_bank_transfer" ? (
                      <div className="bg-blue-500/15 rounded-lg px-2.5 py-1.5 text-center shrink-0 w-[52px]">
                        <Wallet className="w-5 h-5 text-blue-500 mx-auto" />
                        <p className="text-[10px] text-blue-500 font-bold mt-0.5 leading-none">Transfer</p>
                      </div>
                    ) : (
                      <div className={`${nc.bg} ${nc.text} rounded-lg px-2 sm:px-2.5 py-1.5 text-center shrink-0 w-[48px] sm:w-[52px]`}>
                        <p className="font-black text-[9px] sm:text-[10px] leading-none">{order.network || "—"}</p>
                        <p className="font-black text-sm sm:text-base leading-tight mt-0.5">{order.package_size || "—"}</p>
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn("font-bold text-sm", isDark ? "text-white" : "text-gray-900")}>
                          {isWalletTopup ? "Wallet Topup" : 
                           isAirtime ? `${order.network} Airtime` : 
                           isUtility ? `${order.package_size}` : 
                           order.order_type === "vendor_cash_in" ? "Vendor Cash-In" :
                           order.order_type === "vendor_cash_out" ? "Vendor Cash-Out" :
                           order.order_type === "vendor_bank_transfer" ? "Bank Transfer" :
                           `${order.network} ${order.package_size}`}
                        </span>
                        {!isWalletTopup && (
                          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${ds.badge}`}>
                            <ds.icon className={`w-3 h-3 shrink-0 ${ds.spinning ? "animate-spin" : ""}`} />
                            {ds.shortLabel}
                          </span>
                        )}
                      </div>
                      <p className={cn("text-xs mt-0.5", isDark ? "text-muted-foreground" : "text-gray-500")}>
                        {order.customer_phone || "—"} &nbsp;·&nbsp; {date} &nbsp;·&nbsp; {time}
                      </p>
                    </div>

                    {/* Amount + profit + chevron */}
                    <div className="text-right shrink-0 flex items-center gap-2">
                      <div>
                        <p className={cn("font-bold text-sm", isDark ? "text-white" : "text-gray-900")}>GH₵ {Number(order.amount).toFixed(2)}</p>
                        {(order.status === "fulfilled" || order.status === "completed") &&
                        ((order.order_type === "api" ? 0 : Number(order.profit)) > 0 || Number(order.parent_profit) > 0) && (
                          <div className="flex items-center justify-end gap-1 mt-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${ds.dot} ${ds.spinning ? "animate-pulse" : ""}`} />
                            <span className="text-[11px] text-primary font-semibold">
                              +GH₵ {((order.order_type === "api" ? 0 : Number(order.profit)) + Number(order.parent_profit || 0)).toFixed(2)}
                            </span>
                          </div>
                        )}
                      </div>
                      <ChevronDown className={cn("w-4 h-4 transition-transform shrink-0", isDark ? "text-muted-foreground" : "text-gray-400", isExpanded && "rotate-180")} />
                    </div>
                  </button>

                  {/* Expanded timeline */}
                  {isExpanded && (
                    <div className={cn(
                      "px-4 pb-4 pt-1 border-t animate-in slide-in-from-top-1 duration-150",
                      isDark ? "border-border/50 bg-secondary/20" : "border-gray-100 bg-gray-50/30"
                    )}>
                      {/* Order details row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 mt-3">
                        {[
                          { icon: Receipt, label: "Order ID", value: order.id.slice(0, 8).toUpperCase() },
                          { icon: Phone, label: "Recipient", value: order.customer_phone || "—" },
                          { icon: Package, label: "Service", value: isWalletTopup ? "Wallet Topup" :
                                                                  isAirtime ? `${order.network} Airtime` :
                                                                  isUtility ? order.package_size :
                                                                  order.order_type === "vendor_cash_in" ? "Vendor Cash-In" :
                                                                  order.order_type === "vendor_cash_out" ? "Vendor Cash-Out" :
                                                                  order.order_type === "vendor_bank_transfer" ? "Bank Transfer" :
                                                                  `${order.network} ${order.package_size}` },
                          { icon: Calendar, label: "Date", value: date },
                        ].map(({ icon: Icon, label, value }) => (
                          <div key={label} className={cn(
                            "rounded-xl border px-3 py-2.5",
                            isDark ? "bg-secondary/40 border-border/50" : "bg-white border-gray-100 shadow-sm"
                          )}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <Icon className="w-3 h-3 text-muted-foreground/60" />
                              <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/60">{label}</span>
                            </div>
                            <p className={cn("text-xs font-bold truncate", isDark ? "text-foreground" : "text-gray-900")}>{value}</p>
                          </div>
                        ))}
                      </div>

                      {/* Receipt actions */}
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <button
                          onClick={() => copyReceipt(order)}
                          className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border transition-all duration-150"
                          style={
                            copiedId === order.id
                              ? { background: "rgba(34,197,94,0.12)", borderColor: "rgba(34,197,94,0.30)", color: "rgb(74,222,128)" }
                              : {
                                  background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                                  borderColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.08)",
                                  color: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.6)"
                                }
                          }
                        >
                          {copiedId === order.id
                            ? <><Check className="w-3.5 h-3.5" /> Copied!</>
                            : <><Copy className="w-3.5 h-3.5" /> Copy Receipt</>}
                        </button>
                        <button
                          onClick={() => downloadReceiptPDF(order)}
                          className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border transition-all duration-150"
                          style={{
                            background: isDark ? "rgba(251,191,36,0.08)" : "rgba(251,191,36,0.1)",
                            borderColor: isDark ? "rgba(251,191,36,0.25)" : "rgba(251,191,36,0.3)",
                            color: "#d97706"
                          }}
                        >
                          <Download className="w-3.5 h-3.5" /> Download PDF
                        </button>

                        {/* Refund Action Button for Agent */}
                        {order.status !== "fulfilled" && order.status !== "refunded" && (
                          <button
                            onClick={() => handleRefundOrder(order)}
                            disabled={refundingId === order.id}
                            className="col-span-2 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-extrabold border transition-all duration-150 bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 active:scale-95 shadow-sm mt-1"
                          >
                            {refundingId === order.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                            Refund GH₵ {Number(order.amount).toFixed(2)} to Wallet Balance
                          </button>
                        )}
                      </div>

                      {/* Timeline */}
                      {!isWalletTopup && (
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/50 mb-3">Order Timeline</p>
                          <div className="flex items-start gap-0">
                            {timelineSteps.map((step, i) => (
                              <div key={step.label} className="flex-1 flex flex-col items-center">
                                {/* Connector line */}
                                <div className="flex items-center w-full">
                                  <div className={cn("flex-1 h-0.5", i === 0 ? "invisible" : step.done ? "bg-primary/50" : "bg-border")} />
                                  <div className={cn(
                                    "w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                                    step.failed
                                      ? "border-red-500 bg-red-500/10"
                                      : step.done
                                      ? "border-primary bg-primary/15"
                                      : "border-border bg-secondary/40",
                                  )}>
                                    {step.failed ? (
                                      <XCircle className="w-3.5 h-3.5 text-red-500" />
                                    ) : step.spinning ? (
                                      <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                                    ) : step.done ? (
                                      <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                                    ) : (
                                      <div className="w-2 h-2 rounded-full bg-border" />
                                    )}
                                  </div>
                                  <div className={cn("flex-1 h-0.5", i === timelineSteps.length - 1 ? "invisible" : step.done && !step.failed && i < timelineSteps.length - 1 && timelineSteps[i + 1]?.done ? "bg-primary/50" : "bg-border")} />
                                </div>
                                {/* Label */}
                                <p className={cn(
                                  "text-[10px] font-bold text-center mt-1.5 px-1 leading-tight",
                                  step.failed ? "text-red-500" : step.done ? "text-foreground" : "text-muted-foreground/40",
                                )}>
                                  {step.label}
                                </p>
                                {step.time && (
                                  <p className="text-[9px] text-muted-foreground/50 mt-0.5">{step.time}</p>
                                )}
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
              <div className="pt-4 flex justify-center border-t border-border mt-4">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => fetchOrders(true)} 
                  disabled={loading}
                  className="rounded-xl px-8 font-bold"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ChevronDown className="w-4 h-4 mr-2" />}
                  Load More Orders
                </Button>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground text-center pt-3">
              Showing {orders.length} order{orders.length !== 1 ? "s" : ""} &middot; Updates live
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardOrders;
