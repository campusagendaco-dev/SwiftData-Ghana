import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { playSuccessSound } from "@/lib/sound";

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

function getStatusMeta(status: OrderStatusType, failed: boolean, network?: string, message?: string) {
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
  if (status === "pending" && (network === "MTN Mash Up" || network?.toLowerCase()?.includes("mash"))) {
    return { color: "#8B5CF6", glow: "rgba(139,92,246,0.12)", label: "Paid & Processing", sub: message || "Your payment is confirmed. MTN Mash Up bundle is queued for manual processing.", badge: "Queued" };
  }
  return { color: "#D97706", glow: "rgba(217,119,6,0.10)", label: "Awaiting Payment", sub: message || "We are waiting for your checkout authorization on Paystack.", badge: "Pending" };
}

const OrderStatus = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference") || searchParams.get("trxref") || "";
  
  const [orderNetwork, setOrderNetwork] = useState<string>("");
  const [orderPackageSize, setOrderPackageSize] = useState<string>("");
  const [orderPhone, setOrderPhone] = useState<string>("");
  const [orderType, setOrderType] = useState<string>("");

  const network = searchParams.get("network") || orderNetwork || "";
  const packageSize = searchParams.get("package") || orderPackageSize || "";
  const phoneParam = searchParams.get("phone") || orderPhone || "";

  // State for single order tracking
  const [orderStatus, setOrderStatus] = useState<OrderStatusType>("pending");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [failed, setFailed] = useState(false);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const redirectedRef = useRef(false);
  const hasPlayedSoundRef = useRef(false);
  const [resolvedOrderId, setResolvedOrderId] = useState<string | null>(null);

  // State for realtime console tracking
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [estMinutes, setEstMinutes] = useState<number>(2);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  // State for global system tracking (from DeliveryTracker)
  const [trackerData, setTrackerData] = useState<TrackerData | null>(null);
  const [loadingTracker, setLoadingTracker] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [searchPhone, setSearchPhone] = useState("");
  const [showReceipt, setShowReceipt] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);

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

  const meta = getStatusMeta(orderStatus, failed, network, statusMessage);

  // --- SINGLE ORDER LOGIC ---
  const pollStatus = async (force = false) => {
    if (!reference || redirectedRef.current) return;
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-payment", {
        body: { reference: resolvedOrderId || reference, force },
      });
      if (error || !data) throw error || new Error("Failed to fetch status");
      handleStatusUpdate(data.status, data.message || data.error);
      
      // Stop polling if we reached a terminal state
      if (data.status === "fulfilled" || data.status === "fulfillment_failed" || data.status === "error") {
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
      if (!hasPlayedSoundRef.current) {
        hasPlayedSoundRef.current = true;
        playSuccessSound();
      }
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

  const getRemainingTimeStr = () => {
    const totalSecs = estMinutes * 60;
    const remaining = Math.max(0, totalSecs - elapsedSeconds);
    if (remaining === 0) return "Fulfilling shortly...";
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    return `${m}m ${s}s`;
  };

  const getProgressPercentage = () => {
    if (orderStatus === "fulfilled" || orderStatus === "fulfillment_failed" || orderStatus === "error") return 100;
    if (orderStatus === "not_paid") return 0;
    const totalSecs = estMinutes * 60;
    const elapsed = Math.min(totalSecs - 2, elapsedSeconds);
    return Math.max(15, Math.round((elapsed / totalSecs) * 95));
  };

  const getTerminalLogs = () => {
    if (!createdAt) return [];
    
    const baseTime = new Date(createdAt);
    const formatTime = (secondsOffset: number) => {
      const t = new Date(baseTime.getTime() + secondsOffset * 1000);
      return t.toLocaleTimeString("en-GH", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    };

    const logs: Array<{ time: string; text: string; status: "success" | "info" | "warn" }> = [];
    
    // 0s Offset
    logs.push({ time: formatTime(0), text: "📡 Connecting to secure carrier gateway...", status: "info" });

    // 5s Offset
    if (elapsedSeconds >= 5) {
      logs.push({ time: formatTime(5), text: "🔑 Authenticating API credentials...", status: "info" });
    }

    // 12s Offset
    if (elapsedSeconds >= 12) {
      logs.push({ time: formatTime(12), text: `🔍 Validating recipient SIM status on ${network || "MTN"} HLR...`, status: "info" });
    }

    // 25s Offset
    if (elapsedSeconds >= 25) {
      logs.push({ time: formatTime(25), text: `⚡ Broadcasting ${packageSize || "data"} allocation payload...`, status: "info" });
    }

    // 45s Offset
    if (elapsedSeconds >= 45) {
      logs.push({ time: formatTime(45), text: "⏳ Awaiting carrier network callback...", status: "warn" });
    }

    // Success or failure status
    if (orderStatus === "fulfilled") {
      const dTimeStr = new Date().toLocaleTimeString("en-GH", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      logs.push({ time: dTimeStr, text: "🟢 Network callback verified. Data delivered successfully!", status: "success" });
    } else if (orderStatus === "fulfillment_failed") {
      const dTimeStr = new Date().toLocaleTimeString("en-GH", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      logs.push({ time: dTimeStr, text: `🔴 Delivery failed: ${statusMessage || "Rejected by carrier"}`, status: "warn" });
    }

    return logs;
  };

  useEffect(() => {
    if (!reference) return;
    const fetchOrderDetails = async () => {
      try {
        let query = supabase
          .from("orders")
          .select("id, created_at, status, network, package_size, customer_phone, order_type, failure_reason");
        
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference);
        if (isUuid) {
          query = query.or(`id.eq.${reference},metadata->>client_reference.eq.${reference}`);
        } else {
          query = query.eq("metadata->>client_reference", reference);
        }

        const { data, error } = await query.maybeSingle();
        if (data && !error) {
          setResolvedOrderId(data.id);
          setCreatedAt(data.created_at);
          if (data.network) setOrderNetwork(data.network);
          if (data.package_size) setOrderPackageSize(data.package_size);
          if (data.customer_phone) setOrderPhone(data.customer_phone);
          if (data.order_type) setOrderType(data.order_type);
          handleStatusUpdate(data.status as OrderStatusType, data.failure_reason);
        }
      } catch (err) {
        console.error("Error fetching initial order details:", err);
      }
    };
    fetchOrderDetails();
  }, [reference]);

  useEffect(() => {
    const fetchEstSpeed = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("delivery-speed");
        if (data && data.success && data.display?.lastOrderDurationMinutes) {
          setEstMinutes(data.display.lastOrderDurationMinutes);
        }
      } catch (err) {
        console.error("Error fetching est speed:", err);
      }
    };
    fetchEstSpeed();
  }, []);

  useEffect(() => {
    if (!createdAt || !["pending", "paid", "processing"].includes(orderStatus)) {
      return;
    }
    const updateElapsed = () => {
      const placed = new Date(createdAt).getTime();
      const diff = Math.max(0, Math.floor((Date.now() - placed) / 1000));
      setElapsedSeconds(diff);
    };
    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [createdAt, orderStatus]);

  useEffect(() => {
    if (!reference) return;
    
    const activeRef = resolvedOrderId || reference;
    pollStatus(true);
    
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeRef);
    let channel: any = null;
    
    if (isUuid) {
      channel = supabase.channel(`order_status_${activeRef}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${activeRef}` }, (payload) => {
          if (payload.new.status) handleStatusUpdate(payload.new.status as OrderStatusType, payload.new.message || payload.new.failure_reason);
        }).subscribe();
    }
    
    const interval = setInterval(() => pollStatus(false), 5000);
    return () => { 
      if (channel) supabase.removeChannel(channel); 
      clearInterval(interval); 
    };
  }, [reference, resolvedOrderId]);

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
                {orderStatus === "fulfilled" ? (
                  <div className="relative w-32 h-32">
                    <div className="absolute inset-0 bg-emerald-500 rounded-full blur-3xl opacity-10 animate-pulse" />
                    <svg className="w-full h-full drop-shadow-[0_8px_24px_rgba(16,185,129,0.2)] animate-bounce-subtle relative z-10" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Phone Body */}
                      <rect x="55" y="25" width="90" height="150" rx="16" fill="url(#phoneGradTracker)" stroke="rgba(255,255,255,0.15)" strokeWidth="2"/>
                      {/* Phone Screen */}
                      <rect x="62" y="32" width="76" height="136" rx="10" fill="#0A0A0C"/>
                      {/* Phone Notch */}
                      <rect x="90" y="35" width="20" height="4" rx="2" fill="rgba(255,255,255,0.2)"/>
                      
                      {/* Decorative waves */}
                      <path d="M 65 100 Q 100 85 135 100" stroke="rgba(16,185,129,0.3)" strokeWidth="2" fill="none"/>
                      
                      {/* Success Badge */}
                      <circle cx="100" cy="90" r="32" fill="url(#badgeGradTracker)" />
                      <circle cx="100" cy="90" r="26" fill="#0A0A0C"/>
                      
                      {/* Success Checkmark */}
                      <path d="M 90 90 L 97 97 L 112 82" stroke="#10B981" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                      
                      {/* Sparkles */}
                      <path d="M 45 60 L 48 65 L 53 66 L 49 70 L 50 75 L 45 72 L 40 75 L 41 70 L 37 66 L 42 65 Z" fill="#ffd43b" opacity="0.8"/>
                      <circle cx="145" cy="55" r="4" fill="#0ea5e9"/>
                      
                      <defs>
                        <linearGradient id="phoneGradTracker" x1="55" y1="25" x2="145" y2="175" gradientUnits="userSpaceOnUse">
                          <stop stopColor="rgba(255,255,255,0.08)"/>
                          <stop offset="1" stopColor="rgba(255,255,255,0.02)"/>
                        </linearGradient>
                        <linearGradient id="badgeGradTracker" x1="68" y1="58" x2="132" y2="122" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#10B981"/>
                          <stop offset="1" stopColor="#059669"/>
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                ) : (
                  <>
                    <div className="absolute inset-0 blur-xl opacity-20 animate-pulse" style={{ backgroundColor: meta.color }} />
                    <div className="relative w-10 h-10 rounded-2xl border border-white/5 flex items-center justify-center bg-white/[0.03]">
                      {failed ? <XCircle className="w-5 h-5 text-red-400" /> : <div className="w-4 h-4 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />}
                    </div>
                  </>
                )}
              </div>
              <h2 className="text-lg font-bold text-white tracking-tight mb-1">{meta.label}</h2>
              <p className="text-[10px] text-white/30 font-medium max-w-[200px]">{meta.sub}</p>
              {createdAt && ["pending", "paid", "processing"].includes(orderStatus) && (
                <div className="mt-3.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/20 text-[11px] font-black uppercase tracking-wider backdrop-blur-md transition-all duration-300">
                  <span className="relative flex h-2 w-2 mr-0.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <Clock className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                  <span>Est. delivery: ~{getRemainingTimeStr()}</span>
                </div>
              )}
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
                <div className="absolute inset-y-0 left-0 transition-all duration-1000 ease-out" style={{ width: `${getProgressPercentage()}%`, backgroundColor: meta.color }} />
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

            {/* Prepaid Token Display */}
            {orderStatus === "fulfilled" && statusMessage && statusMessage.startsWith("Token:") && (
              <div className="mx-8 mb-6 p-5 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 text-center space-y-2.5 animate-in zoom-in-95 duration-300">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500/60">Your Prepaid Token</p>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xl font-black tracking-wider text-white font-mono">
                    {statusMessage.replace("Token:", "").trim()}
                  </span>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(statusMessage.replace("Token:", "").trim());
                      toast.success("Token copied!");
                    }}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 active:scale-95 transition-all"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[8px] text-white/30 font-medium">Input this token into your prepaid meter to credit it.</p>
              </div>
            )}

            {/* Real-time Gateway Terminal */}
            {createdAt && (orderStatus === "paid" || orderStatus === "processing" || orderStatus === "pending" || orderStatus === "fulfilled" || orderStatus === "fulfillment_failed") && (
              <div className="mx-8 mb-6 p-4 rounded-2xl bg-black/60 border border-white/5 font-mono text-[9px] space-y-1.5 max-h-[140px] overflow-y-auto select-none">
                <div className="text-white/20 text-[8px] uppercase tracking-wider mb-1 flex items-center justify-between">
                  <span>Connection Logs</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                {getTerminalLogs().map((log, i) => (
                  <div key={i} className="flex gap-2 leading-relaxed">
                    <span className="text-white/20">{log.time}</span>
                    <span className={cn(
                      log.status === "success" && "text-emerald-400",
                      log.status === "warn" && "text-amber-400",
                      log.status === "info" && "text-white/60"
                    )}>{log.text}</span>
                  </div>
                ))}
              </div>
            )}
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
            <button onClick={() => pollStatus(true)} disabled={isRefreshing || orderStatus === "fulfilled"} className="w-12 h-12 rounded-[1.2rem] bg-white/5 border border-white/5 flex items-center justify-center transition-all active:scale-95 disabled:opacity-20">
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
                          <span className="text-white/60">{orderType === "utility" ? "Bill Payment" : "Data Bundle"}</span>
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
                        {statusMessage && statusMessage.startsWith("Token:") && (
                          <div className="flex justify-between text-[11px] pt-2 border-t border-white/5">
                            <span className="text-emerald-500/70 uppercase">Token</span>
                            <span className="text-emerald-400 font-bold font-mono">{statusMessage.replace("Token:", "").trim()}</span>
                          </div>
                        )}
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
        <style>{`
          @keyframes bounce-subtle {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-6px); }
          }
          .animate-bounce-subtle {
            animation: bounce-subtle 3s infinite ease-in-out;
          }
        `}</style>
      </div>
    </div>
  );
};

export default OrderStatus;
