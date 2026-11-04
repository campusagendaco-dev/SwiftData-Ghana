import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, Package, Clock, CheckCircle2, 
  XCircle, Loader2, ArrowLeft, RefreshCw,
  Activity, ExternalLink, ShieldCheck, Zap, ArrowRight, ReceiptText, AlertTriangle,
  Copy
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getActiveStoreDomain } from "@/lib/app-base-url";
import { translateFailureReason } from "@/lib/failure-reasons";

interface Order {
  id: string;
  agent_id: string;
  customer_phone: string;
  customer_name?: string;
  network: string;
  package_size: string;
  amount: number;
  status: string;
  created_at: string;
  order_type: string;
  failure_reason?: string;
}

const MyOrders = () => {
  const [searchParams] = useSearchParams();
  const phoneParam = searchParams.get("phone") || "";
  const navigate = useNavigate();
  
  const [phone, setPhone] = useState(phoneParam);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showReceipt, setShowReceipt] = useState<Order | null>(null);
  const [orderFilter, setOrderFilter] = useState<"all" | "delivered" | "progress" | "failed" | "refunded">("all");

  const { slug: routeSlug } = useParams<{ slug?: string }>();
  const storeParam = searchParams.get("store") || searchParams.get("slug") || routeSlug || "";
  const activeDomain = getActiveStoreDomain();
  const isStoreRoute = !!activeDomain || !!storeParam || window.location.pathname.startsWith("/store/");

  // Load cached store tenant information
  const [storeInfo, setStoreInfo] = useState<any>(() => {
    try {
      const saved = localStorage.getItem("current_store_tenant");
      const parsed = saved ? JSON.parse(saved) : null;
      if (storeParam && parsed?.slug === storeParam) {
        return parsed;
      }
      if (activeDomain && parsed?.custom_domain === activeDomain) {
        return parsed;
      }
      return parsed;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const loadStoreDetails = async () => {
      if (storeInfo && (storeInfo.slug === storeParam || (activeDomain && storeInfo.custom_domain === activeDomain))) {
        return;
      }

      const lookupSlug = storeParam;
      const lookupDomain = activeDomain;

      if (!lookupSlug && !lookupDomain) return;

      try {
        let query = supabase
          .from("agent_stores")
          .select("store_name, store_logo_url, store_primary_color, slug, custom_domain");
        
        if (lookupSlug) {
          query = query.eq("slug", lookupSlug);
        } else if (lookupDomain) {
          query = query.ilike("custom_domain", lookupDomain);
        }

        const { data, error } = await query.maybeSingle();
        if (data && !error) {
          const loaded = {
            name: data.store_name,
            logo: data.store_logo_url,
            color: data.store_primary_color,
            slug: data.slug,
            custom_domain: data.custom_domain
          };
          setStoreInfo(loaded);
          localStorage.setItem("current_store_tenant", JSON.stringify(loaded));
        }
      } catch (err) {
        console.error("Error loading store brand:", err);
      }
    };

    loadStoreDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeParam, activeDomain]);

  const storeName = isStoreRoute && storeInfo?.name ? storeInfo.name : "SwiftData Ghana";
  const brandLogoUrl = isStoreRoute ? storeInfo?.logo : "/logo.png";
  const brandColor = isStoreRoute ? (storeInfo?.color || "#f59e0b") : "#f59e0b";
  const brandDomain = isStoreRoute ? (activeDomain || (storeInfo?.custom_domain) || window.location.host) : "swiftdatagh.shop";

  const handleDispute = async (order: Order) => {
    const reason = prompt("Please describe the issue (e.g., Data not received):");
    if (!reason) return;

    try {
      toast.loading("Awakening AI Judge...");
      const { error } = await supabase
        .from("order_disputes")
        .insert({
          order_id: order.id,
          user_id: order.agent_id,
          reason: reason,
          status: 'pending'
        });

      if (error) throw error;
      toast.success("AI Judge activated. Investigation underway.");
    } catch (err: any) {
      toast.error("Failed to trigger AI Judge: " + err.message);
    }
  };

  const fetchOrders = async (targetPhone: string) => {
    if (!targetPhone) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("list-orders", {
        body: { phone: targetPhone },
      });

      if (error || !data) throw error || new Error("Failed to fetch orders");
      setOrders(data.orders || []);
    } catch (err) {
      console.error("Fetch orders error:", err);
      toast.error("Could not load orders. Please try again.");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const copyReceipt = (order: Order) => {
    const now = new Date(order.created_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" });
    const lines = [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `    ${storeName} — Receipt`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `Ref       : ${order.id.slice(0, 12).toUpperCase()}`,
      `Date      : ${now}`,
      "─────────────────────────────────",
      `Network   : ${order.network}`,
      `Package   : ${order.package_size}`,
      `Recipient : ${order.customer_phone}`,
      `Status    : ${isBeneficiaryOrder(order) ? "⏳ IN QUEUE (WHITELIST VERIFICATION)" : order.status === "fulfilled" ? "✅ DELIVERED" : order.status === "fulfillment_failed" ? "❌ FAILED" : "⏳ PROCESSING"}`,
      "─────────────────────────────────",
      `  ${brandDomain}`,

      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ];
    const text = lines.join("\n");
    
    if (navigator.share) {
      navigator.share({
        title: `${storeName} Receipt`,
        text: text,
      }).catch(() => {
        navigator.clipboard.writeText(text);
        toast.success("Receipt copied to clipboard!");
      });
    } else {
      navigator.clipboard.writeText(text);
      toast.success("Receipt copied to clipboard!");
    }
  };

  useEffect(() => {
    if (phoneParam) {
      fetchOrders(phoneParam);
    }
  }, [phoneParam]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    if (isStoreRoute && storeInfo?.slug) {
      navigate(`/store/${storeInfo.slug}/my-orders?phone=${phone}`);
    } else {
      navigate(`/my-orders?phone=${phone}`);
    }
  };

  const isBeneficiaryOrder = (order: Order): boolean => {
    if (order.status !== "fulfillment_failed") return false;
    const net = String(order.network || "").toUpperCase();
    const isMtn = net.includes("MTN") || net.includes("YELLO");
    const isData = !order.order_type || order.order_type === "data" || order.order_type === "sme";
    if (!isMtn || !isData) return false;

    const r = (order.failure_reason || "").toLowerCase();
    return (
      r.includes("beneficiary") ||
      r.includes("whitelist") ||
      r.includes("not added") ||
      r.includes("not on") ||
      r.includes("unregistered") ||
      r.includes("not registered")
    );
  };

  const getStatusBadge = (order: Order) => {
    if (isBeneficiaryOrder(order)) {
      return { label: "In Queue ⏳", className: "text-amber-400 bg-amber-400/15 border border-amber-400/30 font-bold" };
    }
    switch (order.status) {
      case 'fulfilled': return { label: 'Delivered ✓', className: 'text-emerald-400 bg-emerald-400/10 border border-emerald-400/20' };
      case 'processing': return { label: 'Processing ⏳', className: 'text-sky-400 bg-sky-400/10 border border-sky-400/20' };
      case 'paid': return { label: 'Paid', className: 'text-blue-400 bg-blue-400/10 border border-blue-400/20' };
      case 'refunded': return { label: 'Refunded ↺', className: 'text-purple-400 bg-purple-400/10 border border-purple-400/20' };
      case 'fulfillment_failed': 
      case 'error': return { label: 'Delivery Failed', className: 'text-red-400 bg-red-400/10 border border-red-400/20' };
      default: return { label: order.status, className: 'text-white/40 bg-white/5 border border-white/5' };
    }
  };

  const bucketOf = (order: Order) =>
    isBeneficiaryOrder(order)
      ? "progress"
      : order.status === "fulfilled"
      ? "delivered"
      : order.status === "fulfillment_failed" || order.status === "error"
      ? "failed"
      : order.status === "refunded"
      ? "refunded"
      : "progress";
  const counts = orders.reduce(
    (acc, o) => {
      acc[bucketOf(o)] = (acc[bucketOf(o)] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const shown = orderFilter === "all" ? orders : orders.filter((o) => bucketOf(o) === orderFilter);
  const statusPill = (order: Order) => {
    const b = bucketOf(order);
    if (isBeneficiaryOrder(order)) return { label: "Waiting for MTN", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" };
    if (b === "delivered") return { label: "Delivered", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" };
    if (b === "failed") return { label: "Failed", cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400" };
    if (b === "refunded") return { label: "Refunded", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-400" };
    return { label: order.status === "paid" ? "Paid · queued" : "On the way", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400" };
  };
  const goTo = (order: Order) =>
    navigate(isStoreRoute && storeInfo?.slug ? `/store/${storeInfo.slug}/order-status?reference=${order.id}` : `/order-status?reference=${order.id}`);

  return (
    <div className="min-h-[100dvh] text-foreground px-4 sm:px-6 pt-20 sm:pt-24 pb-24">
      <div className="mx-auto w-full max-w-[480px] space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (activeDomain) navigate("/");
              else if (storeInfo?.slug) navigate(`/store/${storeInfo.slug}`);
              else navigate("/");
            }}
            aria-label="Back"
            className="h-10 w-10 shrink-0 rounded-xl border border-border/70 bg-card/80 flex items-center justify-center hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold tracking-[-0.02em] leading-tight">My orders</h1>
            <p className="text-[12.5px] text-muted-foreground truncate">{storeName} · no account needed</p>
          </div>
        </div>

        <form onSubmit={handleSearch} className="flex gap-2">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute z-10 left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number the bundle was sent to"
              aria-label="Phone number"
              className="h-12 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-[15px] tabular-nums placeholder:text-muted-foreground/60 outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
            />
          </label>
          <button type="submit" className="h-12 px-5 rounded-xl text-[14px] font-semibold shadow-sm hover:brightness-105 shrink-0" style={{ backgroundColor: brandColor, color: "#111" }}>
            Search
          </button>
        </form>

        {orders.length > 0 && (
          <div className="-mx-4 px-4 overflow-x-auto no-scrollbar">
            <div className="inline-flex gap-1.5 min-w-max" role="tablist" aria-label="Filter orders">
              {([
                ["all", "All", orders.length],
                ["delivered", "Delivered", counts.delivered || 0],
                ["progress", "In progress", counts.progress || 0],
                ["failed", "Failed", counts.failed || 0],
                ["refunded", "Refunded", counts.refunded || 0],
              ] as const)
                .filter(([id, , n]) => id === "all" || n > 0)
                .map(([id, label, n]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={orderFilter === id}
                    onClick={() => setOrderFilter(id)}
                    className={cn(
                      "h-8 px-3 rounded-full text-[12.5px] font-semibold border transition-colors",
                      orderFilter === id ? "bg-foreground text-background border-foreground" : "bg-card border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label} <span className="tabular-nums opacity-70">{n}</span>
                  </button>
                ))}
            </div>
          </div>
        )}

        <div className="space-y-2.5">
          {loading ? (
            [0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />)
          ) : shown.length > 0 ? (
            shown.map((order) => {
              const pill = statusPill(order);
              return (
                <article
                  key={order.id}
                  onClick={() => goTo(order)}
                  className="rounded-2xl border border-border/70 bg-card/90 p-4 cursor-pointer hover:border-foreground/20 transition-colors dark:border-white/[0.08] dark:bg-black/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold leading-snug">
                        {order.package_size || "Bundle"} <span className="font-normal text-muted-foreground">· {order.network}</span>
                      </p>
                      <p className="text-[12px] text-muted-foreground">
                        {new Date(order.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        {order.amount ? ` · GH₵${Number(order.amount).toFixed(2)}` : ""}
                      </p>
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold", pill.cls)}>{pill.label}</span>
                  </div>

                  {isBeneficiaryOrder(order) && (
                    <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-amber-500/[0.08] px-3 py-2">
                      <p className="text-[12px] text-foreground">MTN needs to approve this number first.</p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/submit-numbers?phone=${encodeURIComponent(order.customer_phone || "")}`);
                        }}
                        className="shrink-0 h-8 px-3 rounded-lg bg-amber-500 text-slate-950 text-[12px] font-semibold"
                      >
                        Verify number
                      </button>
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReceipt(order);
                      }}
                      className="h-9 px-3 rounded-lg border border-border bg-background text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-muted"
                    >
                      <ReceiptText className="h-4 w-4" /> Receipt
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDispute(order);
                      }}
                      className="h-9 px-3 rounded-lg border border-border bg-background text-[12.5px] font-semibold text-muted-foreground inline-flex items-center gap-1.5 hover:text-foreground hover:bg-muted"
                    >
                      <AlertTriangle className="h-4 w-4" /> Report a problem
                    </button>
                    <span className="ml-auto inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-muted-foreground">
                      Details <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </article>
              );
            })
          ) : phoneParam ? (
            <div className="rounded-2xl border border-border/70 bg-card/90 py-12 px-6 text-center dark:border-white/[0.08] dark:bg-black/40">
              <span className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Search className="h-5 w-5 text-muted-foreground" />
              </span>
              <p className="mt-3 text-[15px] font-semibold">No orders for this number</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Check the number, or search with the reference on your receipt from the Track order page.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-border/70 bg-card/90 py-12 px-6 text-center dark:border-white/[0.08] dark:bg-black/40">
              <span className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Activity className="h-5 w-5 text-muted-foreground" />
              </span>
              <p className="mt-3 text-[15px] font-semibold">Find your orders</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Enter the phone number your bundles were sent to.</p>
            </div>
          )}
        </div>

        {orders.length > 0 && (
          <button
            onClick={() => {
              setIsRefreshing(true);
              fetchOrders(phoneParam);
            }}
            className="w-full h-12 rounded-xl border border-border bg-card text-[13.5px] font-semibold inline-flex items-center justify-center gap-2 hover:bg-muted"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} /> Refresh statuses
          </button>
        )}

        {/* Receipt Modal (Portal to document.body for top z-index stacking above all page elements & footer) */}
        {createPortal(
          <AnimatePresence>
            {showReceipt && (
              <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
                <motion.div 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }} 
                  exit={{ opacity: 0 }}
                  onClick={() => setShowReceipt(null)}
                  className="fixed inset-0 bg-black/95 backdrop-blur-xl" 
                />
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 15 }}
                  className="relative w-full max-w-sm bg-[#090a0f] border border-amber-500/30 rounded-3xl overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.95)] z-10"
                >
                  {/* Top Bar Accent */}
                  <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500" />

                  <div className="p-5 sm:p-6 space-y-5">
                    {/* Header */}
                    <div className="flex justify-between items-center pb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-amber-500/20 border border-amber-500/40">
                          <ReceiptText className="w-4 h-4 text-amber-400" />
                        </div>
                        <div>
                          <span className="text-xs font-black uppercase tracking-widest text-white block">Digital E-Receipt</span>
                          <span className="text-[9px] text-slate-400 font-mono">Verified Order</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => setShowReceipt(null)} 
                        className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition-colors"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Receipt Canvas Box */}
                    <div className="bg-[#0e0f17] border border-slate-800 rounded-2xl p-5 space-y-4 font-mono shadow-inner text-slate-100">
                      {/* Store Header */}
                      <div className="text-center pb-3.5 border-b border-dashed border-slate-700/80 space-y-1">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-5 h-5 rounded-md bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                            <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                          </div>
                          <p className="text-xs font-black text-white uppercase tracking-wider">{storeName}</p>
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono">{new Date(showReceipt.created_at).toLocaleString()}</p>
                      </div>
                      
                      {/* Key-Value Details */}
                      <div className="space-y-2.5 text-[11px]">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase text-[10px] tracking-wider">Reference</span>
                          <span className="text-amber-400 font-bold font-mono text-[10px] bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 max-w-[150px] truncate">
                            {showReceipt.id.toUpperCase()}
                          </span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase text-[10px] tracking-wider">Service</span>
                          <span className="text-slate-200 font-bold">{showReceipt.order_type || "Data Bundle"}</span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase text-[10px] tracking-wider">Network</span>
                          <span className={cn(
                            "font-black text-[10px] px-2 py-0.5 rounded uppercase",
                            (showReceipt.network || "").includes("MTN") && "bg-amber-500/20 text-amber-300 border border-amber-500/30",
                            (showReceipt.network || "").includes("Telecel") && "bg-red-500/20 text-red-300 border border-red-500/30",
                            (showReceipt.network || "").includes("Airtel") && "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                          )}>
                            {showReceipt.network || "MTN"}
                          </span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase text-[10px] tracking-wider">Plan / Size</span>
                          <span className="text-white font-bold">{showReceipt.package_size || "—"}</span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase text-[10px] tracking-wider">Recipient</span>
                          <span className="text-white font-mono font-bold tracking-wider">{showReceipt.customer_phone}</span>
                        </div>
                      </div>

                      {/* Status Badge */}
                      {(() => {
                        const reason = (showReceipt.failure_reason || "").toLowerCase();
                        const net = (showReceipt.network || "").toUpperCase();
                        const isMtn = !net || net.includes("MTN");
                        const isBen = isMtn && (showReceipt.status === "fulfillment_failed" || showReceipt.status === "failed") && (
                          reason.includes("beneficiary") || reason.includes("whitelist") || reason.includes("not added") || reason.includes("not on") || reason.includes("unregistered") || reason.includes("not registered")
                        );
                        return (
                          <div className="pt-3 border-t border-dashed border-slate-700/80 space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Order Status</span>
                              <div className={cn(
                                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-xs",
                                (showReceipt.status === "fulfilled" || showReceipt.status === "processing" || showReceipt.status === "paid") && "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
                                isBen && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                                !isBen && (showReceipt.status === "pending" || showReceipt.status === "awaiting_payment" || showReceipt.status === "not_paid") && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                                !isBen && (showReceipt.status === "failed" || showReceipt.status === "fulfillment_failed" || showReceipt.status === "error") && "bg-red-500/15 text-red-400 border border-red-500/30"
                              )}>
                                <ShieldCheck className="w-3.5 h-3.5" />
                                {isBen ? "In Queue for Verification ⏳" : showReceipt.status}
                              </div>
                            </div>
                            {showReceipt.failure_reason && (showReceipt.status === "failed" || showReceipt.status === "fulfillment_failed") && (
                              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs leading-relaxed break-words font-medium text-left">
                                <span className="font-bold text-red-400 block mb-0.5">⚠️ Carrier Reason:</span>
                                {translateFailureReason(showReceipt.failure_reason, showReceipt.network, showReceipt.order_type)}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <button 
                        onClick={() => copyReceipt(showReceipt)}
                        className="h-11 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-amber-400 font-extrabold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy Text
                      </button>
                      <button 
                        onClick={() => window.print()}
                        className="h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-400 font-extrabold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm"
                      >
                        <Package className="w-3.5 h-3.5" />
                        Print PDF
                      </button>
                    </div>
                  </div>
                  
                  {/* Card Footer */}
                  <div className="border-t border-white/10 py-2.5 text-center bg-black/60">
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-amber-400/90 flex items-center justify-center gap-1.5">
                      <ShieldCheck className="w-3 h-3 text-emerald-400" />
                      VERIFIED TRANSACTION • 256-BIT ENCRYPTED
                    </p>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}
      </div>
    </div>
  );
};

export default MyOrders;
