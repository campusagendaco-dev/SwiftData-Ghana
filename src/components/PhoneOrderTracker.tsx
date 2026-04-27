import { useEffect, useMemo, useState, useRef } from "react";
import { Loader2, Search, CheckCircle2, Clock, XCircle, ShieldCheck, AlertTriangle, RefreshCw, Activity, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { cn } from "@/lib/utils";

const LOOKBACK_DAYS = 30;

interface TrackedOrder {
  id: string;
  status: string;
  customer_phone: string | null;
  network: string | null;
  package_size: string | null;
  amount: number;
  created_at: string;
  updated_at: string | null;
}

function normalizePhoneForQuery(phone: string): string[] {
  const digits = phone.replace(/\D+/g, "");
  if (!digits) return [];
  const variants = new Set<string>();
  if (digits.length === 10 && digits.startsWith("0")) {
    variants.add(digits);
    variants.add(`233${digits.slice(1)}`);
  } else if (digits.length === 12 && digits.startsWith("233")) {
    variants.add(digits);
    variants.add(`0${digits.slice(3)}`);
  } else if (digits.length === 9) {
    variants.add(`0${digits}`);
    variants.add(`233${digits}`);
  } else {
    variants.add(digits);
  }
  return Array.from(variants);
}

type StatusKey = "delivered" | "processing" | "failed" | "pending";

interface DisplayStatus {
  key: StatusKey;
  label: string;
  shortLabel: string;
  icon: typeof CheckCircle2;
  color: string;
  bg: string;
  border: string;
  glow: string;
}

function getDisplayStatus(order: TrackedOrder): DisplayStatus {
  if (order.status === "fulfilled") {
    return {
      key: "delivered",
      label: "Delivered Successfully",
      shortLabel: "Delivered",
      icon: CheckCircle2,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
      glow: "shadow-emerald-500/20",
    };
  }
  if (order.status === "fulfillment_failed") {
    return {
      key: "failed",
      label: "Delivery Failed",
      shortLabel: "Failed",
      icon: XCircle,
      color: "text-red-400",
      bg: "bg-red-500/10",
      border: "border-red-500/20",
      glow: "shadow-red-500/20",
    };
  }
  if (order.status === "paid" || order.status === "processing") {
    return {
      key: "processing",
      label: "Processing Delivery",
      shortLabel: "Processing",
      icon: Loader2,
      color: "text-sky-400",
      bg: "bg-sky-500/10",
      border: "border-sky-500/20",
      glow: "shadow-sky-500/20",
    };
  }
  return {
    key: "pending",
    label: "Awaiting Payment",
    shortLabel: "Pending",
    icon: Clock,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    glow: "shadow-amber-500/20",
  };
}

const networkColors: Record<string, { bg: string; text: string; accent: string }> = {
  MTN:        { bg: "bg-amber-400",  text: "text-black", accent: "border-amber-400/30" },
  Telecel:    { bg: "bg-red-600",    text: "text-white", accent: "border-red-600/30" },
  AirtelTigo: { bg: "bg-blue-600",   text: "text-white", accent: "border-blue-600/30" },
};

function fmt(dateStr: string) {
  const d = new Date(dateStr);
  return {
    date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    time: d.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
}

interface PhoneOrderTrackerProps {
  title?: string;
  subtitle?: string;
  className?: string;
  defaultPhone?: string;
}

const PhoneOrderTracker = ({
  title = "Track Your Order",
  subtitle = "Instant real-time tracking for your data bundles.",
  className = "",
  defaultPhone,
}: PhoneOrderTrackerProps) => {
  const [phone, setPhone] = useState(defaultPhone || "");
  const [orders, setOrders] = useState<TrackedOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const { user } = useAuth();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const isPhoneValid = useMemo(() => {
    const d = phone.replace(/\D+/g, "");
    return d.length >= 9 && d.length <= 15;
  }, [phone]);

  const fetchOrders = async (phoneValue: string): Promise<TrackedOrder[]> => {
    const variants = normalizePhoneForQuery(phoneValue);
    if (!variants.length) return [];

    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);

    const { data, error: qErr } = await supabase
      .from("orders")
      .select("id, status, customer_phone, network, package_size, amount, created_at, updated_at, order_type")
      .in("customer_phone", variants)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(50);

    if (qErr) throw qErr;
    return (data || []) as TrackedOrder[];
  };

  const subscribeToOrders = (orderIds: string[]) => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    if (!orderIds.length) return;

    const ch = supabase
      .channel(`tracker-orders-${Date.now()}`)
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
      .subscribe();

    channelRef.current = ch;
  };

  useEffect(() => () => { if (channelRef.current) supabase.removeChannel(channelRef.current); }, []);

  useEffect(() => {
    if (defaultPhone && isPhoneValid) {
      handleTrack();
    }
  }, [defaultPhone]);

  const handleTrack = async () => {
    if (!isPhoneValid) return;
    setError("");
    setLoading(true);
    setSearched(true);

    try {
      const found = await fetchOrders(phone);
      setOrders(found);
      subscribeToOrders(found.map((o) => o.id));
      if (!found.length) setError(`No recent orders found for this number.`);
    } catch {
      setError("Unable to sync with network. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!searched || !phone) return;
    setRefreshing(true);
    try {
      const found = await fetchOrders(phone);
      setOrders(found);
    } catch { /* ignore */ }
    finally { setRefreshing(false); }
  };

  const handleRetry = async (orderId: string) => {
    setRetryingIds((prev) => new Set(prev).add(orderId));
    try {
      await invokePublicFunctionAsUser("verify-payment", { body: { reference: orderId } });
      // Realtime listener will update the status, but let's refresh too
      await handleRefresh();
    } catch {
      // ignore
    } finally {
      setRetryingIds((prev) => { const n = new Set(prev); n.delete(orderId); return n; });
    }
  };

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === "Enter" && isPhoneValid) handleTrack(); };

  return (
    <div className={`relative group ${className}`}>
      {/* Premium Glow Effect */}
      <div className="absolute -inset-1 bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-amber-500/10 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      
      <div className="relative rounded-3xl border border-white/8 bg-[#0A0A0C]/80 backdrop-blur-xl overflow-hidden shadow-2xl">
        {/* Header Strip */}
        <div className="p-6 border-b border-white/5 bg-white/[0.02]">
            <div className="flex items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
              <div className="flex items-center gap-2.5 sm:gap-3.5">
                <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0 shadow-lg shadow-amber-400/5">
                  <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="font-black text-base sm:text-lg tracking-tight text-white">{title}</h3>
                  <p className="text-[10px] sm:text-xs font-medium text-white/40">{subtitle}</p>
                </div>
              </div>
            {searched && orders.length > 0 && (
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-white/40 hover:text-white"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Recipient Phone Number"
                className="h-12 pl-10 bg-white/[0.03] border-white/10 text-white placeholder:text-white/20 rounded-2xl focus-visible:ring-amber-400/30 transition-all"
                type="tel"
              />
            </div>
            <Button 
              onClick={handleTrack} 
              disabled={!isPhoneValid || loading} 
              className="h-12 px-8 rounded-2xl bg-amber-400 hover:bg-amber-300 text-black font-black transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
              <span className="ml-2">Track Now</span>
            </Button>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="mx-6 mt-6 relative overflow-hidden rounded-2xl border border-red-500/20 bg-red-500/[0.03] p-4 animate-in fade-in slide-in-from-top-2 duration-500">
            <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-red-500" />
              </div>
              <div>
                <p className="text-[10px] font-black text-red-400 uppercase tracking-[0.2em] mb-0.5">Sync Error</p>
                <p className="text-xs text-white/40 font-medium">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        <div className="p-4 sm:p-6">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 rounded-2xl bg-white/[0.02] border border-white/5 animate-pulse" />
              ))}
            </div>
          ) : orders.length > 0 ? (
            <div className="space-y-3">
              {orders.map((order) => {
                const ds = getDisplayStatus(order);
                const nc = networkColors[order.network || ""] || { bg: "bg-white/5", text: "text-white", accent: "border-white/10" };
                const { date, time } = fmt(order.created_at);
                const isSpinning = ds.key === "processing";

                return (
                  <div
                    key={order.id}
                    className="group/card flex items-center gap-4 rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:bg-white/[0.04] hover:border-white/10"
                  >
                    {/* Network Badge */}
                    <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl ${nc.bg} ${nc.text} flex flex-col items-center justify-center shrink-0 shadow-xl shadow-black/20`}>
                      <span className="text-[8px] sm:text-[10px] font-black uppercase opacity-60 leading-none">{order.network}</span>
                      <span className="text-xs sm:text-sm font-black mt-0.5 leading-none">{order.package_size}</span>
                    </div>

                    {/* Order Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-1">
                        <span className="font-bold text-[13px] sm:text-sm text-white/90 truncate">
                          {order.order_type === "airtime" ? "Airtime" : order.order_type === "utility" ? "Utility" : `${order.network} Bundle`}
                        </span>
                        <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${ds.bg} ${ds.border} ${ds.color} text-[9px] sm:text-[10px] font-bold w-fit`}>
                          <ds.icon className={`w-2.5 h-2.5 sm:w-3 sm:h-3 ${isSpinning ? "animate-spin" : ""}`} />
                          {ds.shortLabel}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-white/30 font-medium">
                        <span>{date}</span>
                        <span className="w-0.5 h-0.5 rounded-full bg-white/10" />
                        <span>{time}</span>
                      </div>
                    </div>

                    {/* Pricing & Final Status */}
                    <div className="text-right shrink-0">
                      <p className="text-sm sm:text-base font-black text-white leading-none mb-2">
                        <span className="text-[9px] sm:text-[10px] text-white/40 font-bold mr-0.5 sm:mr-1">GHS</span>
                        {Number(order.amount).toFixed(2)}
                      </p>
                      
                      {order.status === "pending" || order.status === "paid" || (user && order.status === "fulfillment_failed") ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRetry(order.id); }}
                          disabled={retryingIds.has(order.id)}
                          className={cn(
                            "flex items-center gap-1.5 ml-auto px-2 py-1 rounded-lg border text-[9px] font-black uppercase tracking-wider transition-all",
                            order.status === "fulfillment_failed" 
                              ? "text-red-400 border-red-500/20 bg-red-500/10 hover:bg-red-500/20"
                              : "text-amber-400 border-amber-500/20 bg-amber-500/10 hover:bg-amber-400/20"
                          )}
                        >
                          {retryingIds.has(order.id) ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-2.5 h-2.5" />
                          )}
                          {order.status === "fulfillment_failed" ? "Retry" : "Check Status"}
                        </button>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5 opacity-60 group-hover/card:opacity-100 transition-opacity">
                          <span className={`w-1.5 h-1.5 rounded-full bg-current ${ds.color} ${isSpinning ? "animate-pulse" : ""}`} />
                          <span className={`text-[9px] font-black uppercase tracking-wider ${ds.color}`}>{ds.key}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              
              <div className="pt-4 flex items-center justify-center gap-2 text-[10px] font-bold text-white/10 uppercase tracking-[0.2em]">
                <ShieldCheck className="w-3 h-3" />
                Live Real-time Feed
              </div>
            </div>
          ) : searched ? (
            <div className="py-12 text-center text-white/20">
              <Zap className="w-12 h-12 mx-auto mb-4 opacity-10" />
              <p className="font-bold text-white/40">No Records Found</p>
              <p className="text-xs">No orders detected for this number in the last 30 days.</p>
            </div>
          ) : (
            <div className="py-16 text-center">
              <div className="w-16 h-16 rounded-3xl bg-amber-400/5 border border-amber-400/10 flex items-center justify-center mx-auto mb-6">
                <Search className="w-6 h-6 text-amber-400/30" />
              </div>
              <p className="text-sm font-black text-white/40">Enter number to begin tracking</p>
              <p className="text-[11px] text-white/20 mt-1 max-w-[200px] mx-auto uppercase tracking-tighter">Instant history retrieval</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PhoneOrderTracker;
