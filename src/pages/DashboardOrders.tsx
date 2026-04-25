import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, RefreshCw, CheckCircle2, XCircle, Clock, Loader2, Wallet, ChevronDown, Phone, Package, Calendar, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";

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

function getDisplayStatus(status: string): DisplayStatus {
  switch (status) {
    case "fulfilled":
      return {
        label: "Delivered Successfully",
        shortLabel: "Delivered ✓",
        icon: CheckCircle2,
        dot: "bg-green-500",
        badge: "bg-green-500/12 border-green-500/25 text-green-600 dark:text-green-400",
        text: "text-green-600 dark:text-green-400",
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
        label: "Delivering Data",
        shortLabel: "Processing",
        icon: Loader2,
        dot: "bg-blue-500",
        badge: "bg-blue-500/10 border-blue-500/25 text-blue-600 dark:text-blue-400",
        text: "text-blue-600 dark:text-blue-400",
        spinning: true,
      };
    case "pending":
      return {
        label: "Verifying Payment",
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
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const retryCountRef = useRef<Record<string, number>>({});

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const candidateAgentIds = Array.from(new Set([
      user.id,
      profile?.user_id,
      profile?.id,
    ].filter(Boolean) as string[]));

    let query = supabase
      .from("orders")
      .select("*")
      .in("agent_id", candidateAgentIds)
      .in("status", ["pending", "paid", "processing", "fulfilled", "fulfillment_failed"])
      .order("created_at", { ascending: false })
      .limit(200);

    if (filter !== "all") {
      query = filter === "data"
        ? query.eq("order_type", filter)
        : query.eq("status", filter);
    }

    const { data } = await query;
    setOrders(data || []);
    setLoading(false);
  }, [filter, profile?.id, profile?.user_id, user]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

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

  // Auto-retry pending/paid orders every 30 s (max 10 attempts per order)
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      setOrders((current) => {
        const stuck = current.filter(
          (o) => o.status === "pending" || o.status === "paid"
        );
        for (const o of stuck) {
          const attempts = retryCountRef.current[o.id] ?? 0;
          if (attempts >= 10) continue;
          retryCountRef.current[o.id] = attempts + 1;
          invokePublicFunctionAsUser("verify-payment", { body: { reference: o.id } }).catch(() => {});
        }
        return current;
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, [user]);

  const stats = orders.reduce(
    (acc, o) => {
      if (o.status === "fulfilled") acc.delivered += 1;
      else if (o.status === "fulfillment_failed") acc.failed += 1;
      else if (o.status === "paid" || o.status === "processing") acc.processing += 1;
      const isData = o.order_type === "data";
      acc.totalSales += Number(o.amount);
      acc.totalProfit += Number(o.profit) + Number(o.parent_profit || 0);
      if (isData) acc.dataOrders += 1;
      return acc;
    },
    { delivered: 0, failed: 0, processing: 0, totalSales: 0, totalProfit: 0, dataOrders: 0 }
  );

  return (
    <div className="p-6 md:p-8 max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold flex items-center gap-2">
            <ClipboardList className="w-7 h-7 text-primary" /> Transactions
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Live delivery status for all your orders &mdash; updates instantly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40 h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Orders</SelectItem>
              <SelectItem value="data">Data Only</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="fulfilled">Delivered</SelectItem>
              <SelectItem value="fulfillment_failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={fetchOrders} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl bg-green-500/8 border border-green-500/20 px-4 py-3 text-center">
          {loading ? <Skeleton className="h-7 w-10 mx-auto mb-1" /> : (
            <p className="font-black text-2xl text-green-600 dark:text-green-400">{stats.delivered}</p>
          )}
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Delivered</p>
        </div>
        <div className="rounded-xl bg-blue-500/8 border border-blue-500/20 px-4 py-3 text-center">
          {loading ? <Skeleton className="h-7 w-10 mx-auto mb-1" /> : (
            <p className="font-black text-2xl text-blue-600 dark:text-blue-400">{stats.processing}</p>
          )}
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Processing</p>
        </div>
        <div className="rounded-xl bg-card border border-border px-4 py-3 text-center">
          {loading ? <Skeleton className="h-7 w-24 mx-auto mb-1" /> : (
            <p className="font-black text-xl text-primary">GH₵ {stats.totalSales.toFixed(2)}</p>
          )}
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total Sales</p>
        </div>
        <div className="rounded-xl bg-card border border-border px-4 py-3 text-center">
          {loading ? <Skeleton className="h-7 w-24 mx-auto mb-1" /> : (
            <p className="font-black text-xl text-primary">GH₵ {stats.totalProfit.toFixed(2)}</p>
          )}
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total Profit</p>
        </div>
      </div>

      {/* Order cards */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <p className="font-semibold text-sm">
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
              const ds = getDisplayStatus(order.status);
              const nc = networkColors[order.network || ""] || { bg: "bg-secondary", text: "text-foreground" };
              const { date, time } = fmt(order.created_at);
              const isWalletTopup = order.order_type === "wallet_topup";
              const isExpanded = expandedId === order.id;

              // Build timeline steps
              const timelineSteps = [
                { label: "Order Created", done: true, time: fmt(order.created_at).time },
                { label: "Payment Confirmed", done: ["paid","processing","fulfilled","fulfillment_failed"].includes(order.status) },
                { label: "Delivering Data", done: ["processing","fulfilled","fulfillment_failed"].includes(order.status), spinning: order.status === "processing" || order.status === "paid" },
                {
                  label: order.status === "fulfillment_failed" ? "Delivery Failed" : "Delivered",
                  done: order.status === "fulfilled" || order.status === "fulfillment_failed",
                  failed: order.status === "fulfillment_failed",
                  time: (order.status === "fulfilled" || order.status === "fulfillment_failed") && order.updated_at
                    ? fmt(order.updated_at).time : undefined,
                },
              ];

              const isPendingOrPaid = order.status === "pending" || order.status === "paid";
              const isRetrying = retryingIds.has(order.id);
              const retryCount = retryCountRef.current[order.id] ?? 0;

              return (
                <div key={order.id} className="rounded-xl border border-border bg-secondary/30 overflow-hidden">
                  {/* Pending payment notice bar */}
                  {isPendingOrPaid && (
                    <div className="flex items-center justify-between px-3 py-2 bg-amber-400/8 border-b border-amber-400/15">
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {order.status === "paid" ? "Payment received — delivering data…" : "Awaiting payment confirmation…"}
                        {retryCount > 0 && <span className="text-amber-400/60 ml-1">(check #{retryCount})</span>}
                      </span>
                      <button
                        onClick={() => retryOrder(order.id)}
                        disabled={isRetrying}
                        className="text-[10px] font-bold text-amber-400 hover:text-amber-300 bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/20 px-2 py-1 rounded-lg transition-all disabled:opacity-50"
                      >
                        {isRetrying ? <Loader2 className="w-3 h-3 animate-spin" /> : "Check Now"}
                      </button>
                    </div>
                  )}
                  {/* Main row — clickable */}
                  <button
                    className="w-full flex items-center gap-3 p-3 hover:bg-secondary/60 transition-colors text-left"
                    onClick={() => setExpandedId(isExpanded ? null : order.id)}
                  >
                    {/* Network badge / Wallet icon */}
                    {isWalletTopup ? (
                      <div className="bg-primary/15 rounded-lg px-2.5 py-1.5 text-center shrink-0 w-[52px]">
                        <Wallet className="w-5 h-5 text-primary mx-auto" />
                        <p className="text-[10px] text-primary font-bold mt-0.5 leading-none">Topup</p>
                      </div>
                    ) : (
                      <div className={`${nc.bg} ${nc.text} rounded-lg px-2.5 py-1.5 text-center shrink-0`}>
                        <p className="font-black text-[10px] leading-none">{order.network || "—"}</p>
                        <p className="font-black text-base leading-tight mt-0.5">{order.package_size || "—"}</p>
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-sm">
                          {isWalletTopup ? "Wallet Topup" : `${order.network} ${order.package_size}`}
                        </span>
                        {!isWalletTopup && (
                          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${ds.badge}`}>
                            <ds.icon className={`w-3 h-3 shrink-0 ${ds.spinning ? "animate-spin" : ""}`} />
                            {ds.shortLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {order.customer_phone || "—"} &nbsp;·&nbsp; {date} &nbsp;·&nbsp; {time}
                      </p>
                    </div>

                    {/* Amount + profit + chevron */}
                    <div className="text-right shrink-0 flex items-center gap-2">
                      <div>
                        <p className="font-bold text-sm">GH₵ {Number(order.amount).toFixed(2)}</p>
                        {(Number(order.profit) > 0 || Number(order.parent_profit) > 0) && (
                          <div className="flex items-center justify-end gap-1 mt-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${ds.dot} ${ds.spinning ? "animate-pulse" : ""}`} />
                            <span className="text-[11px] text-primary font-semibold">
                              +GH₵ {(Number(order.profit) + Number(order.parent_profit || 0)).toFixed(2)}
                            </span>
                          </div>
                        )}
                      </div>
                      <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", isExpanded && "rotate-180")} />
                    </div>
                  </button>

                  {/* Expanded timeline */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-border/50 bg-secondary/20 animate-in slide-in-from-top-1 duration-150">
                      {/* Order details row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 mt-3">
                        {[
                          { icon: Receipt, label: "Order ID", value: order.id.slice(0, 8).toUpperCase() },
                          { icon: Phone, label: "Recipient", value: order.customer_phone || "—" },
                          { icon: Package, label: "Package", value: isWalletTopup ? "Wallet Topup" : `${order.network} ${order.package_size}` },
                          { icon: Calendar, label: "Date", value: date },
                        ].map(({ icon: Icon, label, value }) => (
                          <div key={label} className="rounded-xl bg-secondary/40 border border-border/50 px-3 py-2.5">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Icon className="w-3 h-3 text-muted-foreground/60" />
                              <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/60">{label}</span>
                            </div>
                            <p className="text-xs font-bold text-foreground truncate">{value}</p>
                          </div>
                        ))}
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

            <p className="text-[10px] text-muted-foreground text-center pt-1">
              Showing {orders.length} order{orders.length !== 1 ? "s" : ""} &middot; Updates live
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardOrders;
