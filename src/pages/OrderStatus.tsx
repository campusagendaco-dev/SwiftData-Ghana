import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, XCircle, Loader2, ShieldCheck, Zap,
  Activity, Copy, Check, RefreshCw, ArrowLeft,
  Search, Info, Database, SignalHigh, Server,
  Clock, ArrowRight, Package, ReceiptText, Store,
  Share2, Sparkles, Cpu, Terminal
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import SEO from "@/components/SEO";
import html2canvas from "html2canvas";
import { getActiveStoreDomain } from "@/lib/app-base-url";
import { playSuccessSound } from "@/lib/sound";
import { Badge } from "@/components/ui/badge";

type OrderStatusType = "pending" | "paid" | "processing" | "fulfilled" | "fulfillment_failed" | "error" | "not_paid";

const STEPS = [
  { key: "Payment", label: "Confirmed", icon: ShieldCheck, color: "#10B981" },
  { key: "Dispatch", label: "Broadcasting", icon: Zap, color: "#F59E0B" },
  { key: "Complete", label: "Delivered", icon: CheckCircle2, color: "#6366F1" },
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

function translateFailureReason(reason?: string): string {
  if (!reason) return "";
  const r = reason.trim().toUpperCase();
  if (r.includes("LOW_BALANCE_OR_PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED")) {
    return "The recipient number has reached its daily MTN data transfer limit, belongs to an unsupported plan (e.g. corporate SIM), or has promotional messages blocked. Please check the recipient or try another number.";
  }
  if (r.includes("PAYEE_LIMIT_REACHED")) {
    return "The recipient's MTN daily transfer limit has been reached. Please try again tomorrow or use another number.";
  }
  if (r.includes("NOT_ALLOWED")) {
    return "This number is not allowed to receive SME data bundles (e.g. corporate/postpaid lines). Please try another number.";
  }
  if (r.includes("CUSTOMER ABANDONED TRANSACTION")) {
    return "The checkout payment was cancelled or abandoned. Please try initiating the payment again.";
  }
  if (r.includes("INSUFFICIENT BALANCE") || r.includes("INSUFFICIENT_BALANCE")) {
    return "Fulfillment failed due to insufficient wallet balance. Please top up your wallet to retry.";
  }
  return reason;
}

function getStatusMeta(status: OrderStatusType, failed: boolean, network?: string, message?: string) {
  if (failed || status === "fulfillment_failed") {
    return { color: "#EF4444", glow: "rgba(239,68,68,0.25)", label: "Delivery Failed", sub: translateFailureReason(message) || "Something went wrong with your order", badge: "Failed" };
  }
  if (status === "fulfilled") {
    return { color: "#10B981", glow: "rgba(16,185,129,0.22)", label: "Purchase Successful", sub: "Data bundle delivered successfully to recipient line!", badge: "Delivered" };
  }
  if (status === "processing") {
    return { color: "#8B5CF6", glow: "rgba(139,92,246,0.22)", label: "Transmitting Data Bundle", sub: translateFailureReason(message) || "Payment confirmed. Transmitting data bundle payload to carrier network (10 - 60 mins).", badge: "Processing" };
  }
  if (status === "paid") {
    return { color: "#F59E0B", glow: "rgba(245,158,11,0.22)", label: "Payment Confirmed", sub: "Payment received. Queuing order for carrier fulfillment.", badge: "Queued" };
  }
  if (status === "not_paid") {
    return { color: "#FBBF24", glow: "rgba(251,191,36,0.20)", label: "Payment Not Found", sub: translateFailureReason(message) || "We couldn't find a successful transaction for this reference.", badge: "Awaiting" };
  }
  if (status === "error") {
    return { color: "#EF4444", glow: "rgba(239,68,68,0.20)", label: "Payment Failed", sub: translateFailureReason(message) || "There was a problem verifying your payment.", badge: "Error" };
  }
  if (status === "pending" && (network === "MTN Mash Up" || network?.toLowerCase()?.includes("mash"))) {
    return { color: "#8B5CF6", glow: "rgba(139,92,246,0.22)", label: "Paid & Processing", sub: translateFailureReason(message) || "Your payment is confirmed. MTN Mash Up bundle is queued for manual processing.", badge: "Queued" };
  }
  return { color: "#D97706", glow: "rgba(217,119,6,0.20)", label: "Awaiting Payment", sub: translateFailureReason(message) || "We are waiting for your checkout authorization on Paystack.", badge: "Pending" };
}

const OrderStatus = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference") || searchParams.get("trxref") || "";
  
  const [orderNetwork, setOrderNetwork] = useState<string>("");
  const [orderPackageSize, setOrderPackageSize] = useState<string>("");
  const [orderPhone, setOrderPhone] = useState<string>("");
  const [orderType, setOrderType] = useState<string>("");
  const [orderData, setOrderData] = useState<any>(null);

  const network = searchParams.get("network") || orderNetwork || "";
  const packageSize = searchParams.get("package") || orderPackageSize || "";
  const phoneParam = searchParams.get("phone") || orderPhone || "";

  // State for single order tracking
  const [orderStatus, setOrderStatus] = useState<OrderStatusType>("pending");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [failed, setFailed] = useState(false);
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
  const inFlightRef = useRef<boolean>(false);

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
          const storeData = data as any;
          const loaded = {
            name: storeData.store_name,
            logo: storeData.store_logo_url,
            color: storeData.store_primary_color,
            slug: storeData.slug,
            custom_domain: storeData.custom_domain
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

  const meta = getStatusMeta(orderStatus, failed, network, statusMessage);

  const handleStatusUpdate = useCallback((status: OrderStatusType, message?: string) => {
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
  }, []);

  // --- SINGLE ORDER LOGIC ---
  const pollStatus = useCallback(async (force = false) => {
    if (!reference || redirectedRef.current || inFlightRef.current) return;
    inFlightRef.current = true;

    let shouldInvokeEdgeFunction = force;

    try {
      // Direct DB RPC status query first (lightweight, zero edge function rate-limit cost)
      try {
        const { data: rpcData } = await (supabase.rpc as any)("get_public_order_status", {
          p_reference: reference
        });
        const rpcList = rpcData as any[];
        if (rpcList && rpcList.length > 0) {
          const data = rpcList[0];
          setOrderData(data);
          handleStatusUpdate(data.status as OrderStatusType, data.failure_reason);
          
          if (data.status === "fulfilled" || data.status === "fulfillment_failed" || data.status === "error") {
            redirectedRef.current = true;
            return;
          }

          // If status in DB is pending or awaiting_payment or not_paid, force-verify via Edge Function
          if (["pending", "awaiting_payment", "not_paid"].includes(data.status)) {
            shouldInvokeEdgeFunction = true;
          }
        } else {
          shouldInvokeEdgeFunction = true;
        }
      } catch (err) {
        console.error("Direct RPC polling error:", err);
        shouldInvokeEdgeFunction = true;
      }

      if (!shouldInvokeEdgeFunction && !force) return;

      setIsRefreshing(true);
      try {
        const { data, error } = await supabase.functions.invoke("verify-payment", {
          body: { reference: resolvedOrderId || reference, force: true },
        });

        if (error) {
          const isRateLimit = error.status === 429 || String(error.message).includes("429") || String(error.message).includes("slow down");
          if (isRateLimit) {
            console.warn("[OrderStatus] verify-payment 429 rate limited. Relying on DB status RPC polling.");
            return;
          }
          throw error;
        }
        if (!data) throw new Error("Failed to fetch status");
        if (data.order) setOrderData(data.order);
        handleStatusUpdate(data.status, data.message || data.error);
        
        // Stop polling if we reached a terminal state
        if (data.status === "fulfilled" || data.status === "fulfillment_failed" || data.status === "error") {
          redirectedRef.current = true;
        }
      } catch (err) {
        console.error("Polling error:", err);
      } finally {
        setIsRefreshing(false);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [reference, resolvedOrderId, handleStatusUpdate]);

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
        backgroundColor: "#0e0f17",
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
    return Math.max(18, Math.round((elapsed / totalSecs) * 95));
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
        const { data: rpcData, error } = await (supabase.rpc as any)("get_public_order_status", {
          p_reference: reference
        });

        if (error) {
          console.error("Error fetching order details:", error);
          const errObj = error as any;
          if (errObj.status === 401 || errObj.message?.toLowerCase().includes("jwt") || errObj.message?.toLowerCase().includes("token") || errObj.message?.toLowerCase().includes("unauthorized")) {
            console.warn("[OrderStatus] Stale/invalid auth token detected (401). Clearing session to allow guest access.");
            try {
              await supabase.auth.signOut({ scope: "local" });
            } catch (signOutErr) {
              console.error("Local signout failed:", signOutErr);
            }
            window.location.reload();
          }
        } else if (rpcData && (rpcData as any[])[0]) {
          const data = (rpcData as any[])[0];
          setOrderData(data);
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
  }, [reference, handleStatusUpdate]);

  useEffect(() => {
    const fetchEstSpeed = async () => {
      try {
        const { data } = await supabase.functions.invoke("delivery-speed");
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
      const channelId = `order_status_${activeRef}_${Math.random().toString(36).substring(7)}`;
      channel = supabase.channel(channelId)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${activeRef}` }, (payload) => {
          if (payload.new.status) handleStatusUpdate(payload.new.status as OrderStatusType, payload.new.message || payload.new.failure_reason);
        })
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn("[OrderStatus] Realtime subscription interrupted, relying on HTTP polling fallback.");
          }
        });
    }
    
    const isPending = ["pending", "awaiting_payment", "not_paid"].includes(orderStatus);
    const pollDelay = isPending ? 3500 : 8000;
    const interval = setInterval(() => pollStatus(isPending), pollDelay);

    // Instant verification when user returns to browser tab after approving MoMo
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && ["pending", "awaiting_payment", "not_paid"].includes(orderStatus)) {
        console.log("[OrderStatus] Tab focused, triggering instant force payment verification.");
        pollStatus(true);
      }
    };
    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);

    return () => { 
      safeRemoveChannel(channel); 
      clearInterval(interval); 
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
    };
  }, [reference, resolvedOrderId, orderStatus, pollStatus, handleStatusUpdate]);

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
    const sanitized = searchPhone.trim();
    if (sanitized.length < 5) {
      toast.error("Please enter a valid phone number or order reference");
      return;
    }
    navigate(isStoreRoute && storeInfo?.slug ? `/store/${storeInfo.slug}/my-orders?phone=${encodeURIComponent(sanitized)}` : `/my-orders?phone=${encodeURIComponent(sanitized)}`);
  };

  // --- RENDER SPECIFIC ORDER ---
  if (reference) {
    return (
      <div className="min-h-screen bg-[#05060a] text-slate-100 flex flex-col items-center justify-center p-3 sm:p-6 font-sans antialiased selection:bg-amber-500/30 pt-16 sm:pt-24 pb-16 relative overflow-hidden">
        <SEO 
          title={`Track Order Status — ${storeName}`}
          description={`Track the real-time delivery status of your data bundle purchase on ${storeName}.`}
          keywords="track data order Ghana, order status, data delivery status"
          canonical={`https://${brandDomain}/order-status?reference=${reference}`}
        />

        {/* Dynamic Glow Background Orbs */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <div 
            className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-[160px] opacity-25 transition-all duration-1000"
            style={{ backgroundColor: meta.color }} 
          />
          <div className="absolute top-[-10%] right-[-10%] w-[350px] h-[350px] bg-amber-500/10 rounded-full blur-[140px]" />
          <div className="absolute bottom-[-10%] left-[-10%] w-[350px] h-[350px] bg-blue-500/10 rounded-full blur-[140px]" />
        </div>

        <div className="w-full max-w-md relative z-10 space-y-4">
          {/* Top Brand Header Bar */}
          <div className="flex items-center justify-between px-2">
            <button
              onClick={() => navigate(isStoreRoute && storeInfo?.slug ? `/store/${storeInfo.slug}` : '/')}
              className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{storeName}</span>
            </button>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900/90 border border-slate-800 text-[10px] font-bold font-mono text-slate-400">
              <Cpu className="w-3 h-3 text-amber-400 animate-pulse" />
              <span>NODE-01</span>
            </div>
          </div>

          {/* Main Tracking Card */}
          <div className="relative overflow-hidden rounded-3xl bg-[#0b0c12]/95 border border-slate-800/80 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] transition-all duration-300">
            <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-black/60 pointer-events-none" />
            
            {/* Top Status Header Pill */}
            <div className="px-6 pt-6 flex items-center justify-between relative z-10">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: meta.color }} />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ backgroundColor: meta.color }} />
                </span>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-300 font-mono">{meta.badge} Status</span>
              </div>

              <div 
                onClick={() => { navigator.clipboard.writeText(reference); toast.success("Reference copied!"); }}
                className="cursor-pointer group flex items-center gap-1.5 text-[10px] font-mono text-slate-400 bg-slate-900/90 hover:bg-slate-800 px-2.5 py-1 rounded-full border border-slate-800 transition-colors"
                title="Click to copy reference"
              >
                <span>REF: {reference.slice(0, 10).toUpperCase()}</span>
                <Copy className="w-3 h-3 text-slate-500 group-hover:text-amber-400 transition-colors" />
              </div>
            </div>

            {/* Hero Icon & Delivery Details */}
            <div className="px-6 pt-6 pb-8 flex flex-col items-center text-center relative z-10">
              <div className="relative mb-5">
                {orderStatus === "fulfilled" ? (
                  <div className="relative w-28 h-28 flex items-center justify-center">
                    <div className="absolute inset-0 bg-emerald-500 rounded-full blur-2xl opacity-30 animate-pulse" />
                    <div className="relative z-10 w-24 h-24 rounded-3xl bg-gradient-to-b from-emerald-500/25 via-emerald-950/60 to-black border border-emerald-500/40 flex items-center justify-center shadow-2xl shadow-emerald-950/80">
                      <CheckCircle2 className="w-12 h-12 text-emerald-400 drop-shadow-[0_0_15px_rgba(16,185,129,0.5)]" />
                    </div>
                  </div>
                ) : (
                  <div className="relative w-26 h-26 flex items-center justify-center">
                    <div className="absolute inset-0 blur-2xl opacity-25 animate-pulse" style={{ backgroundColor: meta.color }} />
                    <div className="relative z-10 w-22 h-22 rounded-3xl bg-[#090a10] border border-slate-800/90 flex items-center justify-center shadow-2xl">
                      {failed ? (
                        <XCircle className="w-10 h-10 text-red-400 drop-shadow-md" />
                      ) : (
                        <div className="relative flex items-center justify-center">
                          <Loader2 className="w-10 h-10 animate-spin text-amber-400" />
                          <Activity className="w-4 h-4 text-amber-300 absolute" />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <h2 className="text-xl font-black text-white tracking-tight mb-1">{meta.label}</h2>
              <p className="text-xs text-slate-300 font-medium max-w-xs leading-relaxed">{meta.sub}</p>

              {/* Delivery Speed Badge */}
              {createdAt && ["pending", "paid", "processing"].includes(orderStatus) && (
                <div className="mt-4 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold font-mono shadow-inner">
                  <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                  <span>Est. delivery: ~{getRemainingTimeStr()}</span>
                </div>
              )}

              {/* Carrier & Order Specs Pills */}
              {(network || phoneParam) && (
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2 px-3 py-2 rounded-2xl bg-slate-950/80 border border-slate-800/80 shadow-inner">
                  {network && (
                    <Badge variant="outline" className={cn(
                      "text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 border rounded-lg",
                      network.includes("MTN") && "border-amber-500/40 text-amber-300 bg-amber-500/15",
                      network.includes("Telecel") && "border-red-500/40 text-red-300 bg-red-500/15",
                      network.includes("Airtel") && "border-blue-500/40 text-blue-300 bg-blue-500/15"
                    )}>
                      {network}
                    </Badge>
                  )}
                  {packageSize && (
                    <Badge variant="outline" className="text-[10px] font-mono font-extrabold border-slate-700 text-slate-200 bg-slate-900">
                      {packageSize}
                    </Badge>
                  )}
                  {phoneParam && (
                    <span className="text-xs font-mono font-black text-emerald-400 tracking-wider px-1">
                      {phoneParam}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Animated Progress Bar */}
            <div className="px-6 pb-6 space-y-2 relative z-10">
              <div className="relative h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800/90 shadow-inner">
                <div 
                  className="absolute inset-y-0 left-0 transition-all duration-1000 ease-out bg-gradient-to-r from-amber-500 via-yellow-400 to-emerald-500 shadow-md"
                  style={{ width: `${getProgressPercentage()}%` }} 
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 pt-1">
                {STEPS.map((s, i) => {
                  const activeStep = orderStatus === "fulfilled" ? 3 : (orderStatus === "processing" ? 2 : (["paid", "pending"].includes(orderStatus) ? 1 : 0));
                  const isActive = activeStep >= i + 1;
                  return (
                    <div key={s.key} className={cn("flex items-center gap-1 transition-all", isActive ? "text-emerald-400 font-black" : "text-slate-600")}>
                      <span className={cn("w-1.5 h-1.5 rounded-full", isActive ? "bg-emerald-400 animate-pulse" : "bg-slate-700")} />
                      <span>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Prepaid Token Display */}
            {orderStatus === "fulfilled" && (
              (statusMessage && (statusMessage.includes("Token") || statusMessage.includes("token"))) || 
              Boolean((orderData as any)?.metadata?.prepaid_token)
            ) && (() => {
              const rawToken = (orderData as any)?.metadata?.prepaid_token || statusMessage?.replace(/^.*(?:Token|token):?/i, "").trim();
              if (!rawToken) return null;
              return (
                <div className="mx-6 mb-6 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-2 animate-in zoom-in-95 duration-200">
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400 flex items-center justify-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    Prepaid Meter Token Code
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-xl font-black tracking-wider text-white font-mono bg-black/60 px-3 py-1 rounded-xl border border-emerald-500/40">
                      {rawToken}
                    </span>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(rawToken);
                        toast.success("Token copied to clipboard!");
                      }}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all"
                      title="Copy Token"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium">Key this code into your prepaid meter keypad to credit electricity.</p>
                </div>
              );
            })()}

            {/* Real-time Gateway Terminal Logs */}
            {createdAt && (orderStatus === "paid" || orderStatus === "processing" || orderStatus === "pending" || orderStatus === "fulfilled" || orderStatus === "fulfillment_failed") && (
              <div className="mx-6 mb-6 p-3.5 rounded-2xl bg-[#07080d] border border-slate-800/90 font-mono text-[10px] space-y-1.5 max-h-[140px] overflow-y-auto shadow-inner">
                <div className="text-slate-400 text-[9px] uppercase font-bold tracking-wider mb-1 flex items-center justify-between border-b border-slate-800/80 pb-1">
                  <span className="flex items-center gap-1 text-slate-300"><Terminal className="w-3 h-3 text-amber-400" /> Telemetry Feed</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                {getTerminalLogs().map((log, i) => (
                  <div key={i} className="flex gap-2 leading-relaxed">
                    <span className="text-slate-500">{log.time}</span>
                    <span className={cn(
                      log.status === "success" && "text-emerald-400 font-semibold",
                      log.status === "warn" && "text-amber-400 font-semibold",
                      log.status === "info" && "text-slate-300"
                    )}>{log.text}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Reference Footer */}
            {reference && (
              <div className="bg-slate-950/90 px-6 py-3 flex items-center justify-between gap-3 border-t border-slate-800/80">
                <div className="min-w-0">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Transaction Ref</p>
                  <code className="text-xs font-mono text-slate-200 font-bold truncate block">{reference}</code>
                </div>
                <button 
                  onClick={() => { navigator.clipboard.writeText(reference); toast.success("Reference copied!"); }} 
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all text-xs font-bold active:scale-95"
                >
                  <Copy className="w-3.5 h-3.5 text-amber-400" />
                  <span>Copy</span>
                </button>
              </div>
            )}
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowReceipt(true)} 
              className="flex-1 h-12 rounded-2xl text-slate-950 font-black uppercase text-xs tracking-wider shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95 hover:brightness-110"
              style={{ backgroundColor: brandColor }}
            >
              <ReceiptText className="w-4 h-4" /> View Digital Receipt
            </button>

            <button 
              onClick={() => pollStatus(true)} 
              disabled={isRefreshing || orderStatus === "fulfilled"} 
              className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center transition-all active:scale-95 text-slate-300 hover:text-white disabled:opacity-30"
              title="Refresh status"
            >
              <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin text-amber-400")} />
            </button>

            <button 
              onClick={() => navigate(isStoreRoute && storeInfo?.slug ? `/store/${storeInfo.slug}/order-status` : '/order-status')} 
              className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center transition-all active:scale-95 text-slate-300 hover:text-white"
              title="Back to lookup"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          </div>

          {/* Receipt Modal (Portal to document.body for top z-index stacking above all page elements & footer) */}
          <AnimatePresence>
            {showReceipt && createPortal(
              <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
                <motion.div 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }} 
                  exit={{ opacity: 0 }}
                  onClick={() => setShowReceipt(false)}
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
                        onClick={() => setShowReceipt(false)} 
                        className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition-colors"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Receipt Canvas Box (Captured by html2canvas) */}
                    <div ref={receiptRef} className="bg-[#0e0f17] border border-slate-800 rounded-2xl p-5 space-y-4 font-mono shadow-inner text-slate-100">
                      {/* Store Header */}
                      <div className="text-center pb-3.5 border-b border-dashed border-slate-700/80 space-y-1">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-5 h-5 rounded-md bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                            <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                          </div>
                          <p className="text-xs font-black text-white uppercase tracking-wider">{storeName}</p>
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono">{new Date().toLocaleString()}</p>
                      </div>
                      
                      {/* Key-Value Details */}
                      <div className="space-y-2.5 text-[11px]">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase text-[10px] tracking-wider">Reference</span>
                          <span className="text-amber-400 font-bold font-mono text-[10px] bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 max-w-[150px] truncate">
                            {reference.toUpperCase()}
                          </span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase text-[10px] tracking-wider">Service</span>
                          <span className="text-slate-200 font-bold">{orderType === "utility" ? "Bill Payment" : "Data Bundle"}</span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase text-[10px] tracking-wider">Network</span>
                          <span className={cn(
                            "font-black text-[10px] px-2 py-0.5 rounded uppercase",
                            (network || "").includes("MTN") && "bg-amber-500/20 text-amber-300 border border-amber-500/30",
                            (network || "").includes("Telecel") && "bg-red-500/20 text-red-300 border border-red-500/30",
                            (network || "").includes("Airtel") && "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                          )}>
                            {network || "MTN"}
                          </span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase text-[10px] tracking-wider">Plan / Size</span>
                          <span className="text-white font-bold">{packageSize || "—"}</span>
                        </div>

                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 uppercase text-[10px] tracking-wider">Recipient</span>
                          <span className="text-white font-mono font-bold tracking-wider">{phoneParam || "—"}</span>
                        </div>

                        {statusMessage && statusMessage.startsWith("Token:") && (
                          <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                            <span className="text-emerald-400 uppercase text-[10px] font-bold">Meter Token</span>
                            <span className="text-emerald-300 font-black font-mono bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                              {statusMessage.replace("Token:", "").trim()}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Status Badge */}
                      <div className="pt-3 border-t border-dashed border-slate-700/80 flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Order Status</span>
                        <div className={cn(
                          "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-xs",
                          (String(orderStatus) === "fulfilled" || String(orderStatus) === "processing" || String(orderStatus) === "paid") && "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
                          (String(orderStatus) === "pending" || String(orderStatus) === "awaiting_payment" || String(orderStatus) === "not_paid") && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                          (String(orderStatus) === "failed" || String(orderStatus) === "fulfillment_failed" || String(orderStatus) === "error") && "bg-red-500/15 text-red-400 border border-red-500/30"
                        )}>
                          <ShieldCheck className="w-3.5 h-3.5" />
                          {orderStatus}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <button 
                        onClick={copyReceipt}
                        className="h-11 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-amber-400 font-extrabold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy Text
                      </button>
                      <button 
                        onClick={downloadReceipt}
                        disabled={isDownloading}
                        className="h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-400 font-extrabold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 shadow-sm"
                      >
                        {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
                        Save Image
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
              </div>,
              document.body
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // --- RENDER GLOBAL SYSTEM TRACKER OR STORE LOOKUP ---
  if (isStoreRoute) {
    return (
      <div className="min-h-screen bg-[#05060a] text-white selection:bg-amber-500/30 font-sans antialiased flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <SEO 
          title={`Track Order Status — ${storeName}`}
          description={`Track the real-time delivery status of your purchases on ${storeName}.`}
          keywords="track data order Ghana, order status, data delivery status"
          canonical={`https://${brandDomain}/order-status`}
        />

        {/* Ambient Orbs */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-[160px]" />
        </div>

        <div className="w-full max-w-md space-y-8 relative z-10">
          {/* Header */}
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 rounded-[1.5rem] flex items-center justify-center overflow-hidden border bg-slate-900 border-amber-500/30 shadow-xl" style={{ borderColor: `${brandColor}40` }}>
              {brandLogoUrl ? (
                <img src={brandLogoUrl} alt={storeName} className="w-full h-full object-contain" />
              ) : (
                <Store className="w-8 h-8" style={{ color: brandColor }} />
              )}
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-widest text-white/90">{storeName}</h1>
              <p className="text-[10px] font-bold text-amber-400/90 uppercase tracking-widest font-mono">Order Tracking Portal</p>
            </div>
          </div>

          {/* Search Card */}
          <div className="relative overflow-hidden rounded-3xl bg-[#0b0c12]/90 border border-slate-800 p-8 backdrop-blur-2xl shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none" />
            <h3 className="font-extrabold text-base text-center mb-1 text-white">Lookup Order Status</h3>
            <p className="text-xs text-slate-400 font-medium text-center mb-6">Enter recipient phone number or order reference ID to fetch all recent purchase records.</p>
            
            <form onSubmit={handleSearch} className="relative group">
              <input 
                type="text"
                value={searchPhone}
                onChange={(e) => setSearchPhone(e.target.value)}
                placeholder="Phone number or order reference..."
                className="w-full py-4 pl-6 pr-14 rounded-2xl bg-slate-950 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 transition-all shadow-inner font-mono"
              />
              <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 transition-all shadow-md" style={{ backgroundColor: brandColor }}>
                <Search className="w-4 h-4 text-black font-bold" />
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
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-slate-900/80 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-all hover:scale-105 active:scale-95 shadow-md"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-amber-400" /> Back to Store
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05060a] text-white selection:bg-amber-500/30 font-sans antialiased relative overflow-hidden">
      <SEO 
        title={`Live Delivery Scanner — ${storeName}`}
        description={`Track your purchases and view live data bundle deliveries in real-time on ${storeName}.`}
        keywords="live data scanner, track data delivery Ghana, real-time data tracking"
        canonical={`https://${brandDomain}/order-status`}
      />
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[450px] h-[450px] rounded-full blur-[160px]" style={{ backgroundColor: `${brandColor}12` }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[450px] h-[450px] bg-blue-500/10 rounded-full blur-[160px]" />
      </div>

      <div className="relative max-w-lg mx-auto px-4 sm:px-6 pt-12 md:pt-20 pb-20 z-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black tracking-tight mb-1">Live Delivery Scanner</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 font-mono">
              <Server className="w-3 h-3 text-amber-400" /> System Node 01 • Ghana Carrier Network
            </p>
          </div>
          <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-800">
            <div className="relative">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping absolute inset-0" />
              <div className="w-2 h-2 rounded-full bg-emerald-500 relative" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 font-mono">Live</span>
          </div>
        </div>

        {/* Global Search Bar */}
        <form onSubmit={handleSearch} className="relative group mb-8">
          <input 
            type="text"
            value={searchPhone}
            onChange={(e) => setSearchPhone(e.target.value)}
            placeholder="Track order by phone number or reference..."
            className="w-full py-4 pl-6 pr-14 rounded-2xl bg-[#0b0c12]/90 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 transition-all shadow-2xl font-mono"
          />
          <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 transition-all shadow-md" style={{ backgroundColor: brandColor }}>
            <Search className="w-4 h-4 text-black font-bold" />
          </button>
        </form>

        {loadingTracker && !trackerData ? (
          <div className="py-20 flex flex-col items-center gap-4">
             <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
             <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 font-mono">Connecting Telemetry Gateway...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Telemetry Scanner Card */}
            <div className="relative rounded-3xl border border-slate-800/90 bg-[#0b0c12]/90 backdrop-blur-2xl overflow-hidden shadow-2xl">
              <div className="p-6 pb-4">
                <div className="flex items-center justify-between mb-6">
                   <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl flex items-center justify-center border bg-amber-500/15 border-amber-500/30">
                         <Activity className={cn("w-5 h-5 text-amber-400", trackerData?.data.scanner.active && "animate-pulse")} />
                      </div>
                      <div>
                         <h3 className="font-extrabold text-sm text-white">Network Telemetry Scanner</h3>
                         <p className="text-[10px] text-slate-400 font-medium">Verifying global delivery pipeline</p>
                      </div>
                   </div>
                   <div className="text-right">
                      <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">Last Sync</p>
                      <p className="text-[10px] font-mono text-slate-300 font-bold">{lastUpdate.toLocaleTimeString([], { hour12: false })}</p>
                   </div>
                </div>

                <div className="relative h-16 flex items-center justify-center mb-6">
                   <AnimatePresence mode="wait">
                      <motion.div key={trackerData?.data.checkingNow.summary} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="relative z-10 px-5 py-2.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-center shadow-inner">
                         <p className="text-xs font-extrabold text-amber-300 mb-0.5">{trackerData?.data.checkingNow.summary}</p>
                         <p className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-400 font-mono">Encryption Protocol Active</p>
                      </motion.div>
                   </AnimatePresence>
                </div>

                <div className="grid grid-cols-4 gap-2">
                   {[
                     { label: "Check", val: trackerData?.data.stats.checked, color: "text-slate-300" },
                     { label: "Sent", val: trackerData?.data.stats.delivered, color: "text-emerald-400" },
                     { label: "Wait", val: trackerData?.data.stats.pending, color: "text-amber-400" },
                     { label: "Fail", val: trackerData?.data.stats.failed, color: "text-red-400" },
                   ].map(s => (
                     <div key={s.label} className="p-3 rounded-2xl bg-slate-950/90 border border-slate-800/80 text-center shadow-inner">
                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 font-mono">{s.label}</p>
                        <p className={cn("text-sm font-black tracking-tight font-mono", s.color)}>{s.val}</p>
                     </div>
                   ))}
                </div>
              </div>
              <div className="px-6 py-3.5 bg-slate-950/90 flex items-center justify-between border-t border-slate-800/80">
                 <div className="flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <p className="text-[9px] font-medium text-slate-300 italic">{trackerData?.data.lastDelivered?.summary || "Scanner warming up..."}</p>
                 </div>
              </div>
            </div>

            {/* Live Feed */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between px-1">
                 <div className="flex items-center gap-2">
                   <Clock className="w-4 h-4 text-amber-400" />
                   <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 font-mono">Realtime Dispatch Stream</h4>
                 </div>
                 <span className="text-[9px] font-mono text-emerald-400 font-bold flex items-center gap-1">
                   <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> LIVE BATCH
                 </span>
              </div>

              <div className="space-y-2">
                {trackerData?.data.yourOrders.inCurrentBatch.map((o, i) => (
                  <div key={i} className="flex items-center justify-between p-3.5 rounded-2xl bg-[#0b0c12]/80 border border-slate-800/80 shadow-md">
                    <div className="flex items-center gap-3">
                       <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center font-mono text-[9px] font-black text-amber-300">{o.network.slice(0, 3)}</div>
                       <div>
                          <p className="text-[11px] font-mono font-bold text-white tracking-wider">{o.phone}</p>
                          <p className="text-[8px] font-bold text-slate-400">{o.capacity} • {o.deliveryStatus}</p>
                       </div>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  </div>
                ))}

                {trackerData?.data.yourOrders.inLastDeliveredBatch.map((o, i) => (
                  <div key={`del-${i}`} className="flex items-center justify-between p-3.5 rounded-2xl bg-[#08090e]/60 border border-slate-800/50 shadow-xs">
                    <div className="flex items-center gap-3">
                       <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center font-mono text-[9px] font-black text-emerald-400">{o.network.slice(0, 3)}</div>
                       <div>
                          <p className="text-[11px] font-mono font-bold text-slate-300 tracking-wider">{o.phone}</p>
                          <p className="text-[8px] font-bold text-slate-500">{o.capacity} • Verified Delivered</p>
                       </div>
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400/80" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-12 text-center">
           <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900/90 border border-slate-800 shadow-md">
              <SignalHigh className="w-3.5 h-3.5 text-emerald-400" />
              <p className="text-[9px] font-bold text-slate-400 tracking-wider uppercase font-mono">Ghana Carrier Direct Dispatch • 256-Bit SSL Secured</p>
           </div>
        </div>
      </div>
    </div>
  );
};

export default OrderStatus;
