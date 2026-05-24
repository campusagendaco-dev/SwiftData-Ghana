import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, XCircle, Loader2, ShieldCheck, Zap,
  Activity, Copy, Check, RefreshCw, ArrowLeft,
  Search, Info, Database, SignalHigh, Server,
  Clock, ArrowRight, Package, ReceiptText, Store
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAppTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import SEO from "@/components/SEO";
import html2canvas from "html2canvas";
import { getActiveStoreDomain } from "@/lib/app-base-url";

type OrderStatusType = "pending" | "paid" | "processing" | "fulfilled" | "fulfillment_failed" | "error" | "not_paid";

const STEPS = [
  { key: "confirmed", icon: ShieldCheck, color: "#10B981" },
  { key: "delivering", icon: Zap, color: "#F59E0B" },
  { key: "done", icon: CheckCircle2, color: "#6366F1" },
];

interface TrackerData {
  status: string;
  data: {
    message: string;
    scanner: { active: boolean; waiting: boolean; waitSeconds: number };
    stats: { checked: number; delivered: number; partial: number; pending: number; failed: number };
    lastDelivered: { trackingId: string; summary: string } | null;
    checkingNow: { summary: string };
    yourOrders: {
      inCurrentBatch: Array<{ phone: string; network: string; capacity: string; deliveryStatus: string }>;
      inLastDeliveredBatch: Array<{ phone: string; network: string; capacity: string; deliveryStatus: string }>;
    }
  }
}

function getStatusMeta(status: OrderStatusType, failed: boolean, message?: string) {
  if (failed || status === "fulfillment_failed") {
    return { color: "#EF4444", glow: "rgba(239,68,68,0.15)", label: "Delivery Failed", sub: message || "Something went wrong with your order", badge: "Failed" };
  }
  if (status === "fulfilled") {
    return { color: "#10B981", glow: "rgba(16,185,129,0.12)", label: "Purchase Successful", sub: "Order proceed. Will be delivered between 10min to 60min.", badge: "Success" };
  }
  if (status === "processing") {
    return { color: "#8B5CF6", glow: "rgba(139,92,246,0.12)", label: "Tracking Order", sub: message || "Order is being transmitted to network", badge: "Live" };
  }
  if (status === "paid") {
    return { color: "#F59E0B", glow: "rgba(245,158,11,0.12)", label: "Tracking Order", sub: "Preparing your order for fulfillment", badge: "Queued" };
  }
  if (status === "not_paid") {
    return { color: "#FBBF24", glow: "rgba(251,191,36,0.10)", label: "Payment Not Found", sub: message || "We couldn't find a successful transaction for this reference.", badge: "Awaiting" };
  }
  if (status === "error") {
    return { color: "#EF4444", glow: "rgba(239,68,68,0.10)", label: "Payment Failed", sub: message || "There was a problem verifying your payment.", badge: "Error" };
  }
  return { color: "#D97706", glow: "rgba(217,119,6,0.10)", label: "Awaiting Payment", sub: message || "We are waiting for your checkout authorization on Paystack.", badge: "Pending" };
}

const OrderStatus = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference") || searchParams.get("trxref") || "";
  const network = searchParams.get("network") || "";
  const packageSize = searchParams.get("package") || "";
  const phoneParam = searchParams.get("phone") || "";

  // State for single order tracking
  const [orderStatus, setOrderStatus] = useState<OrderStatusType>("pending");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [failed, setFailed] = useState(false);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const redirectedRef = useRef(false);

  // State for global system tracking (from DeliveryTracker)
  const [trackerData, setTrackerData] = useState<TrackerData | null>(null);
  const [loadingTracker, setLoadingTracker] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [searchPhone, setSearchPhone] = useState("");
  const [showReceipt, setShowReceipt] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);

  const storeParam = searchParams.get("store") || "";
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
          query = query.eq("custom_domain", lookupDomain);
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
  }, [storeParam, activeDomain]);

  const storeName = isStoreRoute && storeInfo?.name ? storeInfo.name : "SwiftData Ghana";
  const brandLogoUrl = isStoreRoute ? storeInfo?.logo : "/logo.png";
  const brandColor = isStoreRoute ? (storeInfo?.color || "#f59e0b") : "#f59e0b";
  const brandDomain = isStoreRoute ? (activeDomain || (storeInfo?.custom_domain) || window.location.host) : "swiftdatagh.shop";

  const meta = getStatusMeta(orderStatus, failed, statusMessage);

  // --- SINGLE ORDER LOGIC ---
  const pollStatus = async () => {
    if (!reference || redirectedRef.current) return;
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-payment", {
        body: { reference },
      });
      if (error || !data) throw error || new Error("Failed to fetch status");
      handleStatusUpdate(data.status, data.message || data.error);
      
      // Stop polling if we reached a terminal state
      if (data.status === "fulfilled" || data.status === "fulfillment_failed") {
        redirectedRef.current = true; // reuse this ref as a 'stop polling' flag
      }
    } catch (err) {
      console.error("Polling error:", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleStatusUpdate = (status: OrderStatusType, message?: string) => {
    setOrderStatus(status);
    if (message) setStatusMessage(message);
    if (status === "fulfillment_failed") {
      setFailed(true);
      return;
    }
    if (status === "fulfilled") {  
      return;
    }
  };

  const copyReceipt = () => {
    const now = new Date().toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" });
    const lines = [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `    ${storeName} — Receipt`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `Ref       : ${reference.slice(0, 12).toUpperCase()}`,
      `Date      : ${now}`,
      "─────────────────────────────────",
      ...(network ? [`Network   : ${network}`] : []),
      ...(packageSize ? [`Package   : ${packageSize}`] : []),
      ...(phoneParam ? [`Recipient : ${phoneParam}`] : []),
      `Status    : ✅ ${orderStatus.toUpperCase()}`,
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

  const downloadReceipt = async () => {
    if (!receiptRef.current) return;
    setIsDownloading(true);
    try {
      const canvas = await html2canvas(receiptRef.current, {
        backgroundColor: "#0F0F12",
        scale: 2,
        logging: false,
        useCORS: true
      });
      const link = document.createElement("a");
      link.download = `${storeName.replace(/\s+/g, "-")}-Receipt-${reference.slice(0, 8)}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast.success("Receipt saved to your device!");
    } catch (err) {
      console.error("Download error:", err);
      toast.error("Could not save receipt image. Try copying text instead.");
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    if (!reference) return;
    pollStatus();
    const channel = supabase.channel(`order_status_${reference}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${reference}` }, (payload) => {
        if (payload.new.status) handleStatusUpdate(payload.new.status as OrderStatusType, payload.new.message || payload.new.failure_reason);
      }).subscribe();
    const interval = setInterval(pollStatus, 15000);
    return () => { supabase.removeChannel(channel); clearInterval(interval); };
  }, [reference]);

  // --- GLOBAL TRACKER LOGIC ---
  const fetchTrackerData = async () => {
    try {
      const { data: res, error } = await supabase.functions.invoke("delivery-tracker");
      if (error) throw error;
      setTrackerData(res);
      setLastUpdate(new Date());
    } catch (err) {
      console.error("Tracker fetch error:", err);
    } finally {
      setLoadingTracker(false);
    }
  };

  useEffect(() => {
    if (reference) return;
    fetchTrackerData();
    const interval = setInterval(fetchTrackerData, 10000);
    return () => clearInterval(interval);
  }, [reference]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchPhone) return;
    const sanitized = searchPhone.replace(/\D+/g, "");
    if (sanitized.length < 9) {
      toast.error("Please enter a valid phone number");
      return;
    }
    navigate(isStoreRoute && storeInfo?.slug ? `/store/${storeInfo.slug}/my-orders?phone=${sanitized}` : `/my-orders?phone=${sanitized}`);
  };

  const step = orderStatus === "fulfilled" ? 3 : orderStatus === "processing" ? 2 : orderStatus === "paid" ? 1 : 0;

  // --- RENDER SPECIFIC ORDER ---
  if (reference) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 font-sans antialiased">
        <SEO 
          title={`Track Order Status — ${storeName}`}
          description={`Track the real-time delivery status of your data bundle purchase on ${storeName}.`}
          keywords="track data order Ghana, order status, data delivery status"
          canonical={`https://${brandDomain}/order-status?reference=${reference}`}
        />
        <div className="w-full max-w-[340px]">
          <div className="relative overflow-hidden rounded-[2.5rem] bg-white/[0.03] border border-white/10 backdrop-blur-3xl shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
            <div className="px-8 pt-8 flex justify-center">
              <div className="px-3 py-1 rounded-full bg-white/[0.05] border border-white/5 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: meta.color }} />
                <span className="text-[9px] font-black uppercase tracking-widest text-white/40">{meta.badge}</span>
              </div>
            </div>
            <div className="px-8 pt-8 pb-10 flex flex-col items-center text-center">
              <div className="relative mb-6">
                <div className="absolute inset-0 blur-xl opacity-20 animate-pulse" style={{ backgroundColor: meta.color }} />
                <div className="relative w-10 h-10 rounded-2xl border border-white/5 flex items-center justify-center bg-white/[0.03]">
                  {orderStatus === "fulfilled" ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : failed ? <XCircle className="w-5 h-5 text-red-400" /> : <div className="w-4 h-4 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />}
                </div>
              </div>
              <h2 className="text-lg font-bold text-white tracking-tight mb-1">{meta.label}</h2>
              <p className="text-[10px] text-white/30 font-medium max-w-[200px]">{meta.sub}</p>
              {(network || phoneParam) && (
                <div className="mt-6 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.02] border border-white/5">
                  <span className="text-[9px] font-bold text-white/40 uppercase tracking-tighter">{network}</span>
                  <span className="text-[9px] font-bold text-white/20">{packageSize}</span>
                  <span className="text-[9px] font-mono text-white/20">{phoneParam}</span>
                </div>
              )}
            </div>
            <div className="px-10 pb-8">
              <div className="relative h-[1.5px] bg-white/5 rounded-full overflow-hidden">
                <div className="absolute inset-y-0 left-0 transition-all duration-1000 ease-out" style={{ width: `${Math.max(15, (step / 3) * 100)}%`, backgroundColor: meta.color }} />
              </div>
              <div className="flex justify-between mt-3">
                {STEPS.map((s, i) => {
                  const isActive = step >= i + 1;
                  return (
                    <div key={s.key} className="flex flex-col items-center gap-1.5">
                      <div className={cn("w-1.5 h-1.5 rounded-full transition-all duration-700", isActive ? "scale-110 shadow-[0_0_8px_rgba(255,255,255,0.2)]" : "bg-white/5")} style={{ backgroundColor: isActive ? s.color : undefined }} />
                      <span className={cn("text-[7px] font-bold uppercase tracking-tighter", isActive ? "text-white/40" : "text-white/10")}>{s.key}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {reference && (
              <div className="bg-white/[0.01] px-6 py-4 flex items-center justify-between gap-3 border-t border-white/5">
                <div className="min-w-0">
                   <p className="text-[8px] font-bold text-white/10 uppercase tracking-widest mb-0.5">Reference</p>
                   <code className="text-[10px] font-mono text-white/20 truncate block">{reference}</code>
                </div>
                <button onClick={() => { navigator.clipboard.writeText(reference); toast.success("Copied"); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-all">
                  <Copy className="w-3 h-3 text-white/30" />
                  <span className="text-[9px] font-bold text-white/30 uppercase">Copy</span>
                </button>
              </div>
            )}
          </div>
          <div className="mt-6 flex gap-2">
            <button 
              onClick={() => setShowReceipt(true)} 
              disabled={orderStatus !== "fulfilled" && orderStatus !== "paid" && orderStatus !== "processing"}
              className="flex-1 h-12 rounded-[1.2rem] text-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-20 font-black uppercase text-[10px] tracking-widest shadow-lg"
              style={{ backgroundColor: brandColor, boxShadow: `0 10px 15px -3px ${brandColor}33` }}
            >
              <ReceiptText className="w-4 h-4" />
              View Receipt
            </button>
            <button onClick={pollStatus} disabled={isRefreshing || orderStatus === "fulfilled"} className="w-12 h-12 rounded-[1.2rem] bg-white/5 border border-white/5 flex items-center justify-center transition-all active:scale-95 disabled:opacity-20">
              <RefreshCw className={cn("w-3.5 h-3.5 text-white/20", isRefreshing && "animate-spin")} />
            </button>
            <button onClick={() => navigate(isStoreRoute && storeInfo?.slug ? `/store/${storeInfo.slug}/order-status` : '/order-status')} className="w-12 h-12 rounded-[1.2rem] bg-white/5 border border-white/5 flex items-center justify-center">
              <ArrowLeft className="w-4 h-4 text-white/20" />
            </button>
          </div>

          {/* Receipt Modal */}
          <AnimatePresence>
            {showReceipt && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                <motion.div 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }} 
                  exit={{ opacity: 0 }}
                  onClick={() => setShowReceipt(false)}
                  className="absolute inset-0 bg-black/80 backdrop-blur-sm" 
                />
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  className="relative w-full max-w-sm bg-[#0F0F12] border border-white/10 rounded-[2.5rem] overflow-hidden shadow-3xl"
                >
                  <div className="p-8 space-y-6">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: brandColor }}>
                          <CheckCircle2 className="w-5 h-5 text-black" />
                        </div>
                        <span className="text-xs font-black uppercase tracking-widest text-white/90">E-Receipt</span>
                      </div>
                      <button onClick={() => setShowReceipt(false)} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-colors">
                        <XCircle className="w-5 h-5" />
                      </button>
                    </div>

                    <div ref={receiptRef} className="bg-[#0F0F12] border border-white/5 rounded-3xl p-6 space-y-4 font-mono">
                      <div className="text-center pb-4 border-b border-dashed border-white/10">
                        <p className="text-sm font-black text-white mb-1 uppercase tracking-widest">{storeName}</p>
                        <p className="text-[10px] text-white/30">{new Date().toLocaleString()}</p>
                      </div>
                      
                      <div className="space-y-3">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-white/20 uppercase">Reference</span>
                          <span className="text-white/60 truncate max-w-[120px]">{reference.toUpperCase()}</span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-white/20 uppercase">Service</span>
                          <span className="text-white/60">Data Bundle</span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-white/20 uppercase">Network</span>
                          <span className="text-white/60">{network || "MTN"}</span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-white/20 uppercase">Plan</span>
                          <span className="text-white/60">{packageSize || "—"}</span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-white/20 uppercase">Recipient</span>
                          <span className="text-white/60">{phoneParam || "—"}</span>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-dashed border-white/10 flex justify-between items-center">
                        <span className="text-[10px] font-black text-white/40 uppercase">Status</span>
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-black uppercase">
                          <ShieldCheck className="w-3 h-3" />
                          {orderStatus}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        onClick={copyReceipt}
                        className="h-12 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/60 font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-95"
                      >
                        <Copy className="w-4 h-4" />
                        Copy Text
                      </button>
                      <button 
                        onClick={downloadReceipt}
                        disabled={isDownloading}
                        className="h-12 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/60 font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                      >
                        {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                        Save Image
                      </button>
                    </div>
                  </div>
                  
                  <div className="border-t border-white/5 py-3 text-center" style={{ backgroundColor: `${brandColor}1a` }}>
                    <p className="text-[8px] font-black uppercase tracking-[0.3em]" style={{ color: brandColor }}>Verified Transaction</p>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // --- RENDER GLOBAL SYSTEM TRACKER OR STORE LOOKUP ---
  if (isStoreRoute) {
    return (
      <div className="min-h-screen bg-[#050505] text-white selection:bg-amber-500/30 font-sans antialiased flex flex-col items-center justify-center p-6">
        <SEO 
          title={`Track Order Status — ${storeName}`}
          description={`Track the real-time delivery status of your purchases on ${storeName}.`}
          keywords="track data order Ghana, order status, data delivery status"
          canonical={`https://${brandDomain}/order-status`}
        />
        <div className="w-full max-w-md space-y-8">
          {/* Header */}
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 rounded-[1.5rem] flex items-center justify-center overflow-hidden border bg-white/5" style={{ borderColor: `${brandColor}40` }}>
              {brandLogoUrl ? (
                <img src={brandLogoUrl} alt={storeName} className="w-full h-full object-contain" />
              ) : (
                <Store className="w-8 h-8" style={{ color: brandColor }} />
              )}
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-widest text-white/90">{storeName}</h1>
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Order Tracking Portal</p>
            </div>
          </div>

          {/* Search Card */}
          <div className="relative overflow-hidden rounded-[2.5rem] bg-white/[0.03] border border-white/10 p-8 backdrop-blur-3xl shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
            <h3 className="font-bold text-base text-center mb-1">Lookup Order Status</h3>
            <p className="text-[10px] text-white/30 font-medium text-center mb-6">Enter your phone number to fetch all recent purchase records.</p>
            
            <form onSubmit={handleSearch} className="relative group">
              <input 
                type="tel"
                value={searchPhone}
                onChange={(e) => setSearchPhone(e.target.value)}
                placeholder="Enter recipient phone number..."
                className="w-full py-4 pl-6 pr-14 rounded-[2rem] bg-white/[0.03] border border-white/10 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-primary/50 transition-all shadow-2xl"
              />
              <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition-all" style={{ backgroundColor: brandColor, boxShadow: `0 10px 15px -3px ${brandColor}33` }}>
                <Search className="w-4 h-4 text-black" />
              </button>
            </form>
          </div>

          {/* Back Action */}
          <div className="flex justify-center">
            <button 
              onClick={() => {
                if (activeDomain) {
                  navigate("/");
                } else if (storeInfo?.slug) {
                  navigate(`/store/${storeInfo.slug}`);
                } else {
                  navigate("/");
                }
              }}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white/5 border border-white/5 text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white transition-all hover:scale-105 active:scale-95"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Store
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-amber-500/30 font-sans antialiased">
      <SEO 
        title={`Live Delivery Scanner — ${storeName}`}
        description={`Track your purchases and view live data bundle deliveries in real-time on ${storeName}.`}
        keywords="live data scanner, track data delivery Ghana, real-time data tracking"
        canonical={`https://${brandDomain}/order-status`}
      />
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full blur-[120px]" style={{ backgroundColor: `${brandColor}0d` }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/5 rounded-full blur-[120px]" />
      </div>

      <div className="relative max-w-lg mx-auto px-6 pt-12 md:pt-24 pb-20">
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-2xl font-black tracking-tight mb-1">Live Scanner</h1>
            <p className="text-[10px] font-medium text-white/30 uppercase tracking-widest flex items-center gap-2">
              <Server className="w-3 h-3" /> System Node 01 • Ghana
            </p>
          </div>
          <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-white/[0.03] border border-white/10">
            <div className="relative">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping absolute inset-0" />
              <div className="w-2 h-2 rounded-full bg-emerald-500 relative" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Live Status</span>
          </div>
        </div>

        {/* Global Search Bar */}
        <form onSubmit={handleSearch} className="relative group mb-6 md:mb-10">
          <input 
            type="tel"
            value={searchPhone}
            onChange={(e) => setSearchPhone(e.target.value)}
            placeholder="Track your orders by phone number..."
            className="w-full py-4 px-6 rounded-[2rem] bg-white/[0.03] border border-white/10 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-primary/50 transition-all shadow-2xl"
          />
          <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 transition-all" style={{ backgroundColor: brandColor, boxShadow: `0 10px 15px -3px ${brandColor}33` }}>
            <Search className="w-4 h-4 text-black" />
          </button>
        </form>

        {loadingTracker && !trackerData ? (
          <div className="py-20 flex flex-col items-center gap-4">
             <Loader2 className="w-8 h-8 animate-spin" style={{ color: brandColor }} />
             <p className="text-[10px] font-black uppercase tracking-widest text-white/20">Syncing with Node...</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Scanner Card */}
            <div className="relative rounded-[2.5rem] border border-white/10 bg-[#0A0A0C]/80 backdrop-blur-3xl overflow-hidden shadow-2xl">
              <div className="p-8 pb-4">
                <div className="flex items-center justify-between mb-8">
                   <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center border" style={{ backgroundColor: `${brandColor}1a`, borderColor: `${brandColor}33` }}>
                         <Activity className={cn("w-6 h-6", trackerData?.data.scanner.active && "animate-pulse")} style={{ color: brandColor }} />
                      </div>
                      <div>
                         <h3 className="font-bold text-base">Network Scanner</h3>
                         <p className="text-[10px] text-white/40 font-medium">Verifying global delivery states</p>
                      </div>
                   </div>
                   <div className="text-right">
                      <p className="text-[10px] font-bold text-white/20 uppercase tracking-tighter">Last Sync</p>
                      <p className="text-[10px] font-mono text-white/40">{lastUpdate.toLocaleTimeString([], { hour12: false })}</p>
                   </div>
                </div>

                <div className="relative h-20 flex items-center justify-center mb-8">
                   <AnimatePresence mode="wait">
                      <motion.div key={trackerData?.data.checkingNow.summary} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="relative z-10 px-6 py-3 rounded-2xl bg-white/[0.03] border border-white/10 text-center">
                         <p className="text-xs font-bold text-amber-400/80 mb-1">{trackerData?.data.checkingNow.summary}</p>
                         <p className="text-[8px] font-black uppercase tracking-[0.2em] text-white/20">Encryption Protocol Active</p>
                      </motion.div>
                   </AnimatePresence>
                </div>

                <div className="grid grid-cols-4 gap-2">
                   {[
                     { label: "Check", val: trackerData?.data.stats.checked, color: "text-white/40" },
                     { label: "Sent", val: trackerData?.data.stats.delivered, color: "text-emerald-400" },
                     { label: "Wait", val: trackerData?.data.stats.pending, color: "text-amber-400" },
                     { label: "Fail", val: trackerData?.data.stats.failed, color: "text-red-400" },
                   ].map(s => (
                     <div key={s.label} className="p-3 rounded-2xl bg-white/[0.02] border border-white/5 text-center">
                        <p className="text-[8px] font-black uppercase tracking-widest text-white/20 mb-1">{s.label}</p>
                        <p className={cn("text-sm font-black tracking-tight", s.color)}>{s.val}</p>
                     </div>
                   ))}
                </div>
              </div>
              <div className="px-8 py-4 bg-white/[0.02] flex items-center justify-between border-t border-white/5">
                 <div className="flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                    <p className="text-[9px] font-medium text-white/40 italic">{trackerData?.data.lastDelivered?.summary || "Scanner warming up..."}</p>
                 </div>
              </div>
            </div>

            {/* Live Feed */}
            <div className="space-y-6">
              <div className="flex items-center gap-2 px-2">
                 <Clock className="w-4 h-4" style={{ color: brandColor }} />
                 <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Realtime Dispatch Feed</h4>
              </div>
              <div className="space-y-2">
                {trackerData?.data.yourOrders.inCurrentBatch.map((o, i) => (
                  <div key={i} className="flex items-center justify-between p-4 rounded-3xl bg-white/[0.02] border border-white/5">
                    <div className="flex items-center gap-4">
                       <div className="w-9 h-9 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-center font-mono text-[9px] text-white/40">{o.network.slice(0, 3)}</div>
                       <div>
                          <p className="text-[11px] font-mono font-bold text-white tracking-widest">{o.phone}</p>
                          <p className="text-[8px] font-medium text-white/20">{o.capacity} • {o.deliveryStatus}</p>
                       </div>
                    </div>
                    <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: brandColor }} />
                  </div>
                ))}
                {trackerData?.data.yourOrders.inLastDeliveredBatch.map((o, i) => (
                  <div key={`del-${i}`} className="flex items-center justify-between p-4 rounded-3xl bg-white/[0.01] border border-white/5">
                    <div className="flex items-center gap-4">
                       <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center font-mono text-[9px] text-emerald-500/60">{o.network.slice(0, 3)}</div>
                       <div>
                          <p className="text-[11px] font-mono font-bold text-white/40 tracking-widest">{o.phone}</p>
                          <p className="text-[8px] font-medium text-white/10">{o.capacity} • Verified</p>
                       </div>
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500/40" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-16 text-center">
           <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.03] border border-white/5">
              <SignalHigh className="w-3 h-3 text-white/20" />
              <p className="text-[9px] font-medium text-white/20 tracking-wider">Secure Realtime Delivery Network</p>
           </div>
        </div>
      </div>
    </div>
  );
};

export default OrderStatus;
