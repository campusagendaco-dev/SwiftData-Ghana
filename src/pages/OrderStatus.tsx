import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, XCircle, Loader2, ShieldCheck, Zap,
  Activity, Copy, Check, RefreshCw, ArrowLeft,
  Search, SignalHigh, Server,
  Clock, Package, ReceiptText, Store,
  Share2, Sparkles, Cpu, Terminal, RotateCcw,
  MessageCircle, Headphones, ChevronDown, ChevronUp, ChevronRight, Radio
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
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";
import { translateFailureReason, isBeneficiaryFailure } from "@/lib/failure-reasons";
import { getCachedOrderLookup, saveCachedOrderLookup } from "@/lib/offline-cache";

type OrderStatusType = "pending" | "paid" | "processing" | "fulfilled" | "fulfillment_failed" | "error" | "not_paid" | "refunded";

const STEPS = [
  { key: "Payment", label: "Confirmed", sub: "Verified", icon: ShieldCheck, color: "#10B981" },
  { key: "Dispatch", label: "Broadcasting", sub: "Carrier Uplink", icon: Zap, color: "#F59E0B" },
  { key: "Complete", label: "Delivered", sub: "SIM Credited", icon: CheckCircle2, color: "#10B981" },
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

function getStatusMeta(status: OrderStatusType, failed: boolean, network?: string, message?: string, isBeneficiary?: boolean, orderType?: string) {
  // Fulfilled orders take absolute highest precedence — bundle has delivered
  if (status === "fulfilled") {
    return {
      color: "#10B981",
      glow: "rgba(16,185,129,0.24)",
      label: "Bundle Delivered",
      sub: "Data allocation confirmed and credited to recipient SIM.",
      badge: "Delivered",
      accentBorder: "border-emerald-500/35",
      accentBg: "from-emerald-500/15 via-emerald-950/20 to-transparent"
    };
  }
  // Refunded orders take second precedence — funds returned
  if (status === "refunded") {
    const isMomo = message?.toLowerCase().includes("momo") || message?.toLowerCase().includes("paystack") || message?.toLowerCase().includes("mobile money");
    return {
      color: "#A855F7",
      glow: "rgba(168,85,247,0.25)",
      label: isMomo ? "Refunded to Mobile Money 💰" : "Order Refunded 💰",
      sub: message || "Your order was refunded. Funds have been returned safely.",
      badge: "Refunded",
      accentBorder: "border-purple-500/35",
      accentBg: "from-purple-500/15 via-purple-950/20 to-transparent"
    };
  }
  // Actively processing orders
  if (status === "processing") {
    return {
      color: "#F59E0B",
      glow: "rgba(245,158,11,0.22)",
      label: "Transmitting Data Bundle",
      sub: translateFailureReason(message, network, orderType) || "Direct carrier uplink active — dispatching bundle payload to SIM.",
      badge: "Processing",
      accentBorder: "border-amber-500/30",
      accentBg: "from-amber-500/12 via-amber-950/15 to-transparent"
    };
  }
  // Beneficiary queue ONLY applies when order has failed delivery or is explicitly in beneficiary state
  if ((isBeneficiary || isBeneficiaryFailure(status, message, network, orderType)) && (failed || status === "fulfillment_failed")) {
    return { 
      color: "#F59E0B", 
      glow: "rgba(245,158,11,0.25)", 
      label: "Queued for Whitelist Approval ⏳", 
      sub: "Recipient line is queued for carrier whitelist verification. Delivery proceeds automatically once approved.", 
      badge: "In Queue",
      accentBorder: "border-amber-500/35",
      accentBg: "from-amber-500/15 via-amber-950/20 to-transparent"
    };
  }
  if (failed || status === "fulfillment_failed") {
    return {
      color: "#EF4444",
      glow: "rgba(239,68,68,0.25)",
      label: "Delivery Interrupted",
      sub: translateFailureReason(message, network, orderType) || "Carrier gateway reported an issue. Use an action below to re-dispatch or resolve.",
      badge: "Attention",
      accentBorder: "border-red-500/35",
      accentBg: "from-red-500/15 via-red-950/20 to-transparent"
    };
  }
  if (status === "paid") {
    return {
      color: "#10B981",
      glow: "rgba(16,185,129,0.22)",
      label: "Payment Confirmed",
      sub: "Payment verified. Assigning priority carrier fulfillment slot.",
      badge: "Confirmed",
      accentBorder: "border-emerald-500/30",
      accentBg: "from-emerald-500/12 via-emerald-950/15 to-transparent"
    };
  }
  if (status === "not_paid") {
    return {
      color: "#FBBF24",
      glow: "rgba(251,191,36,0.20)",
      label: "Payment Not Confirmed",
      sub: translateFailureReason(message, network, orderType) || "We couldn't find a completed payment for this reference yet.",
      badge: "Awaiting",
      accentBorder: "border-amber-500/30",
      accentBg: "from-amber-500/10 via-slate-950 to-transparent"
    };
  }
  if (status === "error") {
    return {
      color: "#EF4444",
      glow: "rgba(239,68,68,0.20)",
      label: "Verification Error",
      sub: translateFailureReason(message, network, orderType) || "There was a problem verifying your payment.",
      badge: "Error",
      accentBorder: "border-red-500/30",
      accentBg: "from-red-500/12 via-red-950/15 to-transparent"
    };
  }
  if (status === "pending" && (network === "MTN Mash Up" || network?.toLowerCase()?.includes("mash"))) {
    return {
      color: "#8B5CF6",
      glow: "rgba(139,92,246,0.22)",
      label: "Paid & Queued",
      sub: translateFailureReason(message, network, orderType) || "Your payment is confirmed. MTN Mash Up bundle is queued for fulfillment.",
      badge: "Queued",
      accentBorder: "border-purple-500/30",
      accentBg: "from-purple-500/12 via-purple-950/15 to-transparent"
    };
  }
  return {
    color: "#F59E0B",
    glow: "rgba(245,158,11,0.20)",
    label: "Awaiting Payment",
    sub: translateFailureReason(message, network, orderType) || "Waiting for Mobile Money or checkout authorization.",
    badge: "Pending",
    accentBorder: "border-amber-500/30",
    accentBg: "from-amber-500/10 via-slate-950 to-transparent"
  };
}

const OrderStatus = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference") || searchParams.get("trxref") || searchParams.get("ref") || searchParams.get("id") || searchParams.get("order_id") || "";
  
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
  const [copiedRef, setCopiedRef] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const redirectedRef = useRef(false);
  const hasPlayedSoundRef = useRef(false);
  const [resolvedOrderId, setResolvedOrderId] = useState<string | null>(null);
  const [isClaimingRefund, setIsClaimingRefund] = useState(false);
  const [isExpediting, setIsExpediting] = useState(false);
  const [supportPhone, setSupportPhone] = useState<string>("0598170947");

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
  const [confirmRefund, setConfirmRefund] = useState(false);
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
    const fetchSupportSettings = async () => {
      try {
        const { data } = await supabase
          .from("public_system_settings")
          .select("customer_service_number")
          .eq("id", 1)
          .maybeSingle();
        if (data?.customer_service_number) {
          setSupportPhone(String(data.customer_service_number).trim());
        }
      } catch (err) {
        console.error("Error loading support phone:", err);
      }
    };
    fetchSupportSettings();
  }, []);

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
          .select("store_name, store_logo_url, store_primary_color, slug, custom_domain, whatsapp_number, support_number");
        
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
            custom_domain: storeData.custom_domain,
            whatsapp_number: storeData.whatsapp_number,
            support_number: storeData.support_number
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

  const orderNet = String(network || orderData?.network || "").toUpperCase();
  const isMtnOrder = orderNet.includes("MTN") || orderNet.includes("YELLO");
  const isDataOrder = !orderData?.order_type || orderData.order_type === "data" || orderData.order_type === "sme";
  const isKorbaOrder = String(orderData?.provider_id || "").toLowerCase().includes("korba") ||
                       orderData?.metadata?.category === "korba" ||
                       orderData?.metadata?.package_category === "korba";

  const isBeneficiaryOrder = isMtnOrder && isDataOrder && !isKorbaOrder &&
    (orderStatus === "fulfillment_failed" || failed) &&
    orderStatus !== "fulfilled" &&
    orderStatus !== "refunded" &&
    orderStatus !== "processing" && (
      orderData?.metadata?.in_beneficiary_queue === true ||
      orderData?.metadata?.guest_refund_eligible === true ||
      isBeneficiaryFailure(orderStatus, statusMessage || orderData?.failure_reason, network || orderData?.network, orderData?.order_type)
    );

  const hasEnteredProvider = Boolean(
    (orderData?.provider_order_id &&
      orderData.provider_order_id !== "" &&
      orderData.provider_order_id !== "failed_api_call" &&
      orderData.provider_order_id !== "timeout") ||
    (orderData?.provider_id &&
      orderData?.provider_order_id !== "failed_api_call" &&
      orderData?.provider_order_id !== "timeout") ||
    orderStatus === "processing"
  );

  const meta = getStatusMeta(orderStatus, failed && !isBeneficiaryOrder, network || orderData?.network, statusMessage || orderData?.failure_reason, isBeneficiaryOrder);

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

  // Hydrate cached order status immediately for offline / 0ms startup
  useEffect(() => {
    if (!reference) return;
    const cached = getCachedOrderLookup(reference);
    if (cached) {
      if (cached.orderData) setOrderData(cached.orderData);
      if (cached.orderNetwork) setOrderNetwork(cached.orderNetwork);
      if (cached.orderPackageSize) setOrderPackageSize(cached.orderPackageSize);
      if (cached.orderPhone) setOrderPhone(cached.orderPhone);
      if (cached.orderType) setOrderType(cached.orderType);
      if (cached.orderStatus) setOrderStatus(cached.orderStatus);
      if (cached.statusMessage) setStatusMessage(cached.statusMessage);
      if (typeof cached.failed === "boolean") setFailed(cached.failed);
    }
  }, [reference]);

  // Persist order status to local offline cache whenever it updates
  useEffect(() => {
    if (!reference || (!orderData && orderStatus === "pending")) return;
    saveCachedOrderLookup(reference, {
      orderData,
      orderNetwork,
      orderPackageSize,
      orderPhone,
      orderType,
      orderStatus,
      statusMessage,
      failed,
    });
  }, [reference, orderData, orderNetwork, orderPackageSize, orderPhone, orderType, orderStatus, statusMessage, failed]);

  // --- SINGLE ORDER LOGIC ---
  const pollStatus = useCallback(async (force = false) => {
    if (!reference || redirectedRef.current || inFlightRef.current) return;
    if (typeof window !== "undefined" && !window.navigator.onLine) return;
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
          if (data.network) setOrderNetwork(data.network);
          if (data.package_size) setOrderPackageSize(data.package_size);
          if (data.customer_phone) setOrderPhone(data.customer_phone);
          if (data.order_type) setOrderType(data.order_type);
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
        const orderIdOrRef = resolvedOrderId || reference;

        // 1. Try checking live carrier status from check-order-status edge function
        let checked = false;
        try {
          const { data: checkData, error: checkErr } = await supabase.functions.invoke("check-order-status", {
            body: { order_id: orderIdOrRef },
          });

          if (!checkErr && checkData && checkData.success) {
            checked = true;
            if (checkData.order) {
              setOrderData(checkData.order);
              if (checkData.order.network) setOrderNetwork(checkData.order.network);
              if (checkData.order.package_size) setOrderPackageSize(checkData.order.package_size);
              if (checkData.order.customer_phone) setOrderPhone(checkData.order.customer_phone);
              if (checkData.order.order_type) setOrderType(checkData.order.order_type);
            }
            handleStatusUpdate(checkData.order?.status, checkData.order?.carrier_status || checkData.message);

            if (checkData.sms_sent) {
              toast.success("Live delivery status checked! An SMS update was sent to your phone with our WhatsApp channel & support details.");
            }

            if (checkData.order?.status === "fulfilled" || checkData.order?.status === "fulfillment_failed" || checkData.order?.status === "error") {
              redirectedRef.current = true;
            }
          }
        } catch (cErr) {
          console.warn("[OrderStatus] check-order-status fallback:", cErr);
        }

        if (checked) {
          setIsRefreshing(false);
          return;
        }

        // 2. Fallback to verify-payment for initial checkout confirmation
        const { data, error } = await supabase.functions.invoke("verify-payment", {
          body: { reference: orderIdOrRef, force: true },
        });

        if (error) {
          const isRateLimit = error.status === 429 || String(error.message).includes("429") || String(error.message).includes("slow down");
          if (isRateLimit) {
            console.warn("[OrderStatus] verify-payment 429 rate limited. Relying on DB status RPC polling.");
            return;
          }
          const isNotFound = error.status === 404 || String(error.message).includes("404");
          if (isNotFound) {
            console.warn("[OrderStatus] verify-payment returned 404. Order not found yet or awaiting creation.");
            return;
          }
          throw error;
        }
        if (!data) throw new Error("Failed to fetch status");
        if (data.order) {
          setOrderData(data.order);
          if (data.order.network) setOrderNetwork(data.order.network);
          if (data.order.package_size) setOrderPackageSize(data.order.package_size);
          if (data.order.customer_phone) setOrderPhone(data.order.customer_phone);
          if (data.order.order_type) setOrderType(data.order.order_type);
        }
        handleStatusUpdate(data.status, data.message || data.reason || data.error);
        
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

  const getCleanWhatsAppPhone = () => {
    const raw = storeInfo?.whatsapp_number || storeInfo?.support_number || supportPhone || "0598170947";
    const digits = String(raw).replace(/\D+/g, "");
    if (digits.startsWith("233")) return digits;
    if (digits.startsWith("0")) return `233${digits.slice(1)}`;
    if (digits.length === 9) return `233${digits}`;
    return digits || "233598170947";
  };

  const getWhatsAppMessage = () => {
    const activeRef = (orderData?.id || resolvedOrderId || reference || "").toUpperCase();
    const activeNetwork = network || orderNetwork || orderData?.network || "Data Bundle";
    const activePkg = packageSize || orderPackageSize || orderData?.package_size || "";
    const activePhone = phoneParam || orderPhone || orderData?.customer_phone || "";
    const activeStatus = orderStatus ? orderStatus.toUpperCase() : "PENDING";
    const orderAmt = orderData?.amount ? `GH₵ ${Number(orderData.amount).toFixed(2)}` : "";

    const lines = [
      `👋 Hello ${storeName} Support,`,
      `I need urgent assistance with my data order:`,
      `• Ref: ${activeRef}`,
      ...(activePhone ? [`• Recipient: ${activePhone}`] : []),
      ...(activeNetwork ? [`• Network: ${activeNetwork}`] : []),
      ...(activePkg ? [`• Package: ${activePkg}`] : []),
      ...(orderAmt ? [`• Amount: ${orderAmt}`] : []),
      `• Status: ${activeStatus}`,
      `Please help me verify or expedite this order. Thank you!`
    ];
    return lines.join("\n");
  };

  const getWhatsAppUrl = (customText?: string) => {
    const cleanPhone = getCleanWhatsAppPhone();
    const text = encodeURIComponent(customText || getWhatsAppMessage());
    return `https://wa.me/${cleanPhone}?text=${text}`;
  };

  const handleWhatsAppSupport = () => {
    window.open(getWhatsAppUrl(), "_blank", "noopener,noreferrer");
  };

  const handleCopyRef = () => {
    navigator.clipboard.writeText(reference);
    setCopiedRef(true);
    toast.success("Order reference copied!");
    setTimeout(() => setCopiedRef(false), 2000);
  };

  const handleCopyPhone = () => {
    const targetPhone = phoneParam || orderPhone || orderData?.customer_phone;
    if (!targetPhone) return;
    navigator.clipboard.writeText(targetPhone);
    setCopiedPhone(true);
    toast.success("Recipient number copied!");
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  const handleCopyTrackingLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    toast.success("Order tracking link copied to clipboard!");
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleShareWhatsApp = () => {
    const trackingUrl = window.location.href;
    const refCode = (resolvedOrderId || reference || "").slice(0, 14).toUpperCase();
    const pkg = packageSize || "Data Bundle";
    const net = network || "Ghana Telecom";
    const targetPhone = phoneParam || orderPhone || "";
    const msg = `📦 *${storeName} Order Tracking*\n\n` +
      `• *Ref:* ${refCode}\n` +
      `• *Network:* ${net}\n` +
      `• *Package:* ${pkg}\n` +
      (targetPhone ? `• *Recipient:* ${targetPhone}\n` : "") +
      `• *Status:* ${meta.label}\n\n` +
      `🔗 Track Live Order Delivery Here:\n${trackingUrl}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  };

  const handleExpediteDelivery = async () => {
    const targetId = orderData?.id || resolvedOrderId || reference;
    if (!targetId) return;

    if (orderStatus === "fulfilled") {
      toast.success("Order has already been delivered successfully!");
      return;
    }

    setIsExpediting(true);
    toast.info("⚡ Syncing live status & priority carrier dispatch...");

    try {
      const { data, error } = await supabase.functions.invoke("verify-payment", {
        body: {
          reference: targetId,
          orderId: targetId,
          force: true,
          action: "retry_order"
        }
      });

      if (error) {
        toast.error(error.message || "Failed to expedite order. Please contact support.");
      } else if (data?.status === "fulfilled") {
        toast.success("🎉 Data bundle delivered successfully!");
        setOrderStatus("fulfilled");
        if (data.order) setOrderData(data.order);
        if (!hasPlayedSoundRef.current) {
          hasPlayedSoundRef.current = true;
          playSuccessSound();
        }
      } else {
        toast.success("⚡ Carrier priority sync complete! Delivery is actively transmitting.");
        if (data?.status) handleStatusUpdate(data.status, data.message || data.reason);
      }
      await pollStatus(true);
    } catch (e: any) {
      console.error("Expedite delivery error:", e);
      toast.error("Gateway busy. Click 'WhatsApp Support' for instant live help.");
    } finally {
      setIsExpediting(false);
    }
  };

  const handleInstantRefund = async () => {
    const targetId = orderData?.id || resolvedOrderId || reference;
    if (!targetId) return;

    const currentDbStatus = String((orderData as any)?.status || orderStatus);
    if (currentDbStatus === "fulfilled" || currentDbStatus === "completed") {
      toast.error("Order has already been delivered. It cannot be refunded.");
      return;
    }
    if (currentDbStatus === "refunded") {
      toast.error("Order has already been refunded.");
      return;
    }

    // If order is in processing, check if eligible via /order-refund (verify-and-refund) first
    if (hasEnteredProvider && currentDbStatus === "processing") {
      setIsClaimingRefund(true);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session) {
          const { data: refundRes, error: refundErr } = await supabase.functions.invoke("verify-and-refund", {
            body: { reference: targetId, mode: "refund_only" }
          });
          if (!refundErr && refundRes?.success) {
            toast.success(refundRes.message || "Refund credited to your wallet!");
            setOrderStatus("refunded");
            await pollStatus(true);
            return;
          }
        }
        toast.info("This order has entered the carrier network gateway. Delivery is 100% guaranteed once in provider transmission.");
      } catch {
        toast.info("This order has entered the carrier network gateway. Delivery is 100% guaranteed.");
      } finally {
        setIsClaimingRefund(false);
      }
      return;
    }

    if (hasEnteredProvider) {
      toast.info("This order has already entered the carrier network provider gateway. Delivery is 100% guaranteed, so it cannot be refunded.");
      return;
    }

    const amt = Number(orderData?.amount || 0);
    const amtStr = amt > 0 ? `GH₵ ${amt.toFixed(2)}` : "your payment";
    const confirmed = window.confirm(`Request an immediate refund of ${amtStr} to your Mobile Money account?`);
    if (!confirmed) return;

    setIsClaimingRefund(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-payment", {
        body: { action: "guest_refund", order_id: targetId, reason: "Customer requested instant refund on Order Status page" }
      });
      if (error) {
        let msg = error.message;
        try {
          if ((error as any).context?.json) {
            const errJson = await (error as any).context.json();
            if (errJson?.error) msg = errJson.error;
          }
        } catch {
          // ignore
        }
        toast.error(msg || "Failed to process refund. Please contact WhatsApp support.");
      } else if (data?.refunded) {
        toast.success(`Refund Completed! ${amtStr} sent to Mobile Money via Paystack.`);
        setOrderStatus("refunded");
        setOrderData((prev: any) => ({
          ...prev,
          status: "refunded",
          refund_amount: prev?.amount || amt,
          metadata: { 
            ...(prev?.metadata || {}), 
            guest_refund_gateway: "paystack",
            guest_refund_status: "completed",
            guest_refund_id: data?.refundId
          }
        }));
      } else if (data?.error?.includes("processing") || data?.error?.includes("carrier network") || data?.has_entered_provider) {
        toast.info(data.error || "Your bundle has already been dispatched to the carrier network! Delivery is guaranteed.");
      } else {
        toast.error(data?.error || "Refund queued for manual payout by support team.");
        setOrderData((prev: any) => ({
          ...prev,
          metadata: {
            ...(prev?.metadata || {}),
            guest_refund_status: "needs_manual_payout",
            guest_refund_error: data?.error
          }
        }));
      }
    } catch (e: any) {
      toast.error(e?.message || "An error occurred while requesting your refund.");
    } finally {
      setIsClaimingRefund(false);
    }
  };

  const renderFloatingSupport = () => (
    <a
      href={getWhatsAppUrl()}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with WhatsApp Support"
      className="fixed bottom-3.5 right-3.5 sm:bottom-5 sm:right-5 z-40 flex items-center gap-2 p-3 sm:px-4 sm:py-3 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_8px_24px_rgba(5,150,105,0.45)] border border-emerald-400/40 transition-all hover:scale-105 active:scale-95 group backdrop-blur-md"
      title="Need assistance? Chat with WhatsApp Support"
    >
      <div className="relative">
        <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5 text-white fill-white/20" />
        <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-emerald-300 border-2 border-emerald-600 absolute -top-0.5 -right-0.5 sm:-top-1 sm:-right-1 animate-pulse" />
      </div>
      <span className="text-xs font-black uppercase tracking-wider hidden sm:inline">
        Live Support
      </span>
    </a>
  );

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
      `Status    : ${isBeneficiaryOrder ? "⏳ IN QUEUE (WHITELIST VERIFICATION)" : (failed || orderStatus === "fulfillment_failed") ? "❌ FAILED" : orderStatus === "fulfilled" ? "✅ DELIVERED" : "⏳ PROCESSING"}`,
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
    const safeEstMins = Math.min(Math.max(Number(estMinutes) || 4, 2), 15);
    const totalSecs = safeEstMins * 60;
    const remaining = totalSecs - elapsedSeconds;
    if (remaining <= 0) return "Arriving momentarily ⚡";
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  };

  const getProgressPercentage = () => {
    if (orderStatus === "fulfilled" || orderStatus === "error") return 100;
    if (orderStatus === "refunded") return 100;
    if (orderStatus === "fulfillment_failed") {
      if (isBeneficiaryOrder) return 65;
      return 100;
    }
    if (orderStatus === "not_paid") return 0;
    const safeEstMins = Math.min(Math.max(Number(estMinutes) || 4, 2), 15);
    const totalSecs = safeEstMins * 60;
    const elapsed = Math.min(totalSecs - 2, elapsedSeconds);
    return Math.max(22, Math.round((elapsed / totalSecs) * 94));
  };

  const getTerminalLogs = () => {
    if (!createdAt) return [];
    
    const baseTime = new Date(createdAt);
    const formatTime = (secondsOffset: number) => {
      const t = new Date(baseTime.getTime() + secondsOffset * 1000);
      return t.toLocaleTimeString("en-GH", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    };

    const logs: Array<{ time: string; text: string; status: "success" | "info" | "warn" }> = [];
    
    logs.push({ time: formatTime(0), text: "📡 Connecting to secure carrier gateway...", status: "info" });

    if (elapsedSeconds >= 5) {
      logs.push({ time: formatTime(5), text: "🔑 Authenticating API credentials...", status: "info" });
    }

    if (elapsedSeconds >= 12) {
      logs.push({ time: formatTime(12), text: `🔍 Validating recipient SIM status on ${network || "MTN"} HLR...`, status: "info" });
    }

    if (elapsedSeconds >= 25) {
      logs.push({ time: formatTime(25), text: `⚡ Broadcasting ${packageSize || "data"} allocation payload...`, status: "info" });
    }

    if (elapsedSeconds >= 45) {
      logs.push({ time: formatTime(45), text: "⏳ Awaiting carrier network callback...", status: "warn" });
    }

    if (orderStatus === "fulfilled") {
      const dTimeStr = new Date().toLocaleTimeString("en-GH", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      logs.push({ time: dTimeStr, text: "🟢 Network callback verified. Data delivered successfully!", status: "success" });
    } else if (orderStatus === "fulfillment_failed") {
      const dTimeStr = new Date().toLocaleTimeString("en-GH", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const r = (statusMessage || "").toLowerCase();
      const net = (orderNetwork || "").toUpperCase();
      const isMtn = !net || net.includes("MTN");
      const isBen = isMtn && (r.includes("beneficiary") || r.includes("whitelist") || r.includes("not added") || r.includes("not on") || r.includes("unregistered") || r.includes("not registered"));
      if (isBen) {
        logs.push({ time: dTimeStr, text: "⏳ Number queued for MTN Whitelist Verification. Bundle will deliver automatically after approval!", status: "warn" });
      } else {
        logs.push({ time: dTimeStr, text: `🔴 Delivery interrupted: ${statusMessage || "Carrier gateway response pending"}`, status: "warn" });
      }
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
          const rawMins = Number(data.display.lastOrderDurationMinutes);
          const safeMins = (rawMins >= 1 && rawMins <= 15) ? rawMins : 4;
          setEstMinutes(safeMins);
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && ["pending", "awaiting_payment", "not_paid"].includes(orderStatus)) {
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
    const activeStep =
      orderStatus === "fulfilled"
        ? 3
        : isBeneficiaryOrder
        ? 2
        : orderStatus === "processing"
        ? 2
        : ["paid", "pending"].includes(orderStatus)
        ? 1
        : 0;

    const terminalLogs = getTerminalLogs();
    const latestLog = terminalLogs.length > 0 ? terminalLogs[terminalLogs.length - 1] : null;
    const displayNetwork = network || orderData?.network || "MTN";
    const displayPackage = packageSize || orderData?.package_size || "Bundle";
    const displayPhone = phoneParam || orderPhone || orderData?.customer_phone || "—";
    const displayAmount = orderData?.amount ? `GH₵${Number(orderData.amount).toFixed(2)}` : null;

    const isActive = ["pending", "paid", "processing"].includes(orderStatus) && !failed;
    const isDelivered = orderStatus === "fulfilled";
    const isRefunded = orderStatus === "refunded";
    const isFailed = (failed || orderStatus === "fulfillment_failed" || orderStatus === "error") && !isBeneficiaryOrder;
    const canRefund = !isDelivered && !isRefunded && !isBeneficiaryOrder && !hasEnteredProvider && (isFailed || ["paid", "processing"].includes(orderStatus));
    const tone = isDelivered
      ? { ring: "bg-emerald-500", soft: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" }
      : isRefunded
      ? { ring: "bg-violet-500", soft: "bg-violet-500/10 text-violet-600 dark:text-violet-400", bar: "bg-violet-500" }
      : isFailed
      ? { ring: "bg-rose-500", soft: "bg-rose-500/10 text-rose-600 dark:text-rose-400", bar: "bg-rose-500" }
      : { ring: "bg-amber-500", soft: "bg-amber-500/10 text-amber-700 dark:text-amber-400", bar: "bg-amber-500" };
    const StatusIcon = isDelivered ? CheckCircle2 : isRefunded ? RotateCcw : isFailed ? XCircle : isBeneficiaryOrder ? Clock : Loader2;
    const createdLabel = createdAt ? new Date(createdAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
    const steps = [
      { label: "Paid", done: activeStep >= 1 || isDelivered, current: activeStep <= 1 && isActive },
      { label: isBeneficiaryOrder ? "In carrier queue" : "Sent to network", done: activeStep >= 2 || isDelivered, current: activeStep === 2 && isActive },
      { label: isFailed ? "Not delivered" : "Delivered", done: isDelivered, current: false, failed: isFailed },
    ];
    const surface = "rounded-2xl border border-border/70 bg-card/90 backdrop-blur-xl dark:border-white/[0.08] dark:bg-black/40";
    const secondaryBtn = "h-11 rounded-xl border border-input bg-background text-[13px] font-semibold text-foreground hover:bg-muted transition inline-flex items-center justify-center gap-1.5";

    return (
      <div className="min-h-[100dvh] text-foreground px-3 sm:px-6 pt-20 sm:pt-24 pb-16 relative">
        <SEO
          title={`Track Order Status — ${storeName}`}
          description={`Track the real-time delivery status of your data bundle purchase on ${storeName}.`}
          keywords="track data order Ghana, order status, data delivery status"
          canonical={`https://${brandDomain}/order-status?reference=${reference}`}
        />

        <div className="mx-auto w-full max-w-[460px] space-y-3">
          {/* Top bar */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate(isStoreRoute && storeInfo?.slug ? `/store/${storeInfo.slug}` : "/")}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-border/70 bg-card/80 text-[13px] font-semibold text-foreground hover:bg-muted"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="truncate max-w-[170px]">{storeName}</span>
            </button>
            <button
              type="button"
              onClick={() => pollStatus(true)}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-border/70 bg-card/80 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
              aria-label="Refresh status"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
              {isRefreshing ? "Checking…" : "Refresh"}
            </button>
          </div>

          {/* Status card */}
          <section aria-live="polite" className={cn(surface, "overflow-hidden")}>
            <div className="px-5 pt-6 pb-5 text-center">
              <div className="relative mx-auto h-16 w-16">
                {isActive && <span className={cn("absolute inset-0 rounded-full opacity-25 animate-ping", tone.ring)} style={{ animationDuration: "2.2s" }} />}
                <span className={cn("absolute inset-0 rounded-full flex items-center justify-center text-white shadow-lg", tone.ring)}>
                  <StatusIcon className={cn("h-8 w-8", StatusIcon === Loader2 && "animate-spin")} />
                </span>
              </div>
              <h1 className="mt-4 text-[22px] font-bold tracking-[-0.02em] leading-tight">{meta.label}</h1>
              <p className="mt-1 text-[13.5px] text-muted-foreground max-w-[340px] mx-auto">{meta.sub}</p>
              {createdAt && isActive && (
                <p className={cn("mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold", tone.soft)}>
                  <Clock className="h-3.5 w-3.5" />
                  {getRemainingTimeStr().includes("Arriving") ? getRemainingTimeStr() : `Expected in about ${getRemainingTimeStr()}`}
                </p>
              )}
            </div>

            {/* Timeline */}
            <ol className="mx-5 mb-5 grid grid-cols-3 gap-2" aria-label="Delivery progress">
              {steps.map((s) => (
                <li key={s.label} className="flex flex-col gap-1.5">
                  <span className={cn("h-1.5 rounded-full transition-colors duration-500", s.failed ? "bg-rose-500" : s.done ? tone.bar : s.current ? cn(tone.bar, "opacity-50 animate-pulse") : "bg-muted dark:bg-white/[0.08]")} />
                  <span className={cn("text-[11.5px] leading-tight", s.done || s.current || s.failed ? "font-semibold text-foreground" : "text-muted-foreground")}>{s.label}</span>
                </li>
              ))}
            </ol>

            {/* Details */}
            <dl className="mx-5 mb-5 rounded-xl bg-muted/50 dark:bg-white/[0.04] divide-y divide-border/60 dark:divide-white/[0.06] text-[13px]">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-muted-foreground">Bundle</dt>
                <dd className="font-semibold text-right">{displayNetwork.replace(" Bundle", "")} · {displayPackage}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-muted-foreground">Recipient</dt>
                <dd>
                  <button type="button" onClick={handleCopyPhone} className="inline-flex items-center gap-1.5 font-semibold tabular-nums" title="Copy number">
                    {displayPhone}
                    {copiedPhone ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                </dd>
              </div>
              {displayAmount && (
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="text-muted-foreground">Paid</dt>
                  <dd className="font-semibold tabular-nums">{displayAmount}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-muted-foreground">Reference</dt>
                <dd>
                  <button type="button" onClick={handleCopyRef} className="inline-flex items-center gap-1.5 font-mono text-[12.5px] font-semibold" title="Copy reference" aria-label="Copy order reference">
                    {reference.slice(0, 14).toUpperCase()}
                    {copiedRef ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                </dd>
              </div>
              {createdLabel && (
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="text-muted-foreground">Ordered</dt>
                  <dd className="font-semibold">{createdLabel}</dd>
                </div>
              )}
            </dl>

            {/* Prepaid meter token (ECG / utility) */}
            {isDelivered &&
              ((statusMessage && /token/i.test(statusMessage)) || Boolean((orderData as any)?.metadata?.prepaid_token)) &&
              (() => {
                const rawToken = (orderData as any)?.metadata?.prepaid_token || statusMessage?.replace(/^.*(?:Token|token):?/i, "").trim();
                if (!rawToken) return null;
                return (
                  <div className="mx-5 mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-4 text-center">
                    <p className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">Your meter token</p>
                    <div className="mt-2 flex items-center justify-center gap-2">
                      <span className="font-mono text-[18px] font-bold tracking-wider">{rawToken}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(rawToken);
                          toast.success("Token copied");
                        }}
                        className="h-8 w-8 rounded-lg bg-background border border-border flex items-center justify-center"
                        aria-label="Copy meter token"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-1.5 text-[12px] text-muted-foreground">Type this code into your prepaid meter to load the electricity.</p>
                  </div>
                );
              })()}

            {/* MTN whitelist queue */}
            {isBeneficiaryOrder && (
              <div className="mx-5 mb-5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-4">
                <p className="text-[13.5px] font-semibold flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" /> Waiting for MTN to approve this number
                </p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  <span className="font-semibold text-foreground tabular-nums">{displayPhone}</span> is in MTN’s approval queue. Your bundle will be sent automatically once it’s approved.
                </p>
                <div className="mt-3 grid gap-2">
                  <button
                    onClick={() => navigate(`/submit-numbers?phone=${encodeURIComponent(phoneParam || orderPhone || "")}`)}
                    className="h-11 rounded-xl bg-amber-500 text-slate-950 text-[13.5px] font-semibold inline-flex items-center justify-center gap-1.5 hover:brightness-105"
                  >
                    <Zap className="h-4 w-4" /> Speed up: verify this number
                  </button>
                  {(orderData as any)?.metadata?.guest_refund_status === "needs_manual_payout" ? (
                    <a
                      href={getWhatsAppUrl(`Hello SwiftData support, my refund request for order ${resolvedOrderId || reference} is pending manual payout. Please assist me.`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={secondaryBtn}
                    >
                      <MessageCircle className="h-4 w-4" /> Refund under review, chat with us
                    </a>
                  ) : confirmRefund ? (
                    <div className="rounded-xl border border-border bg-background p-3">
                      <p className="text-[12.5px]">Cancel this order and refund your Mobile Money?</p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button onClick={() => { setConfirmRefund(false); handleInstantRefund(); }} disabled={isClaimingRefund} className="h-9 rounded-lg bg-foreground text-background text-[12.5px] font-semibold disabled:opacity-60">
                          {isClaimingRefund ? "Requesting…" : "Yes, refund me"}
                        </button>
                        <button onClick={() => setConfirmRefund(false)} className="h-9 rounded-lg border border-border text-[12.5px] font-semibold">Keep waiting</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmRefund(true)} className={secondaryBtn}>
                      <RotateCcw className="h-4 w-4" /> Request a refund instead
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Refund outcomes */}
            {isRefunded && (orderData as any)?.metadata?.guest_refund_gateway === "paystack" && (orderData as any)?.metadata?.guest_refund_status === "completed" && (
              <div className="mx-5 mb-5 rounded-xl border border-violet-500/30 bg-violet-500/[0.07] p-4">
                <p className="text-[13.5px] font-semibold">Refund sent to your Mobile Money</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  <span className="font-semibold text-foreground">GH₵{Number((orderData as any)?.refund_amount || (orderData as any)?.amount || 0).toFixed(2)}</span> was refunded via Paystack.
                  {(orderData as any)?.metadata?.guest_refund_id ? <> Refund ID: <span className="font-mono">{(orderData as any).metadata.guest_refund_id}</span></> : null}
                </p>
              </div>
            )}
            {(orderData as any)?.metadata?.guest_refund_status === "needs_manual_payout" && !isRefunded && !isBeneficiaryOrder && (
              <div className="mx-5 mb-5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-4">
                <p className="text-[13.5px] font-semibold">Refund is being reviewed</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  Our team will pay <span className="font-semibold text-foreground">GH₵{Number((orderData as any)?.amount || 0).toFixed(2)}</span> back to your Mobile Money.
                </p>
                <a
                  href={getWhatsAppUrl(`Hello SwiftData support, my order ${resolvedOrderId || reference} is pending manual refund payout. Please assist me.`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 h-10 w-full rounded-xl bg-emerald-600 text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-emerald-500"
                >
                  <MessageCircle className="h-4 w-4" /> Chat with support
                </a>
              </div>
            )}
            {isRefunded && (orderData as any)?.metadata?.guest_refund_gateway !== "paystack" && (
              <div className="mx-5 mb-5 rounded-xl border border-sky-500/30 bg-sky-500/[0.07] p-4">
                <p className="text-[13.5px] font-semibold">Refunded to your wallet</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  <span className="font-semibold text-foreground">GH₵{Number((orderData as any)?.refund_amount || (orderData as any)?.amount || 0).toFixed(2)}</span> is back in your SwiftData wallet.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="px-5 pb-5 space-y-2">
              {isActive && (
                <button
                  onClick={handleExpediteDelivery}
                  disabled={isExpediting}
                  className="w-full h-12 rounded-xl bg-primary text-primary-foreground text-[14.5px] font-semibold inline-flex items-center justify-center gap-2 shadow-sm hover:brightness-105 disabled:opacity-60"
                >
                  {isExpediting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  {isExpediting ? "Checking with the network…" : "Check & push delivery"}
                </button>
              )}
              {isDelivered && (
                <button
                  onClick={() => navigate(isStoreRoute && storeInfo?.slug ? `/store/${storeInfo.slug}` : "/")}
                  className="w-full h-12 rounded-xl bg-primary text-primary-foreground text-[14.5px] font-semibold inline-flex items-center justify-center gap-2 shadow-sm hover:brightness-105"
                >
                  Buy again
                </button>
              )}

              {canRefund &&
                (confirmRefund ? (
                  <div className="rounded-xl border border-border bg-background p-3">
                    <p className="text-[12.5px]">Cancel this order and refund your Mobile Money? This can’t be undone.</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button onClick={() => { setConfirmRefund(false); handleInstantRefund(); }} disabled={isClaimingRefund} className="h-9 rounded-lg bg-foreground text-background text-[12.5px] font-semibold disabled:opacity-60">
                        {isClaimingRefund ? "Requesting…" : "Yes, refund me"}
                      </button>
                      <button onClick={() => setConfirmRefund(false)} className="h-9 rounded-lg border border-border text-[12.5px] font-semibold">Keep order</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setConfirmRefund(true)} disabled={isClaimingRefund} className={cn(secondaryBtn, "w-full")}>
                    {isClaimingRefund ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Get a refund
                  </button>
                ))}

              {!isDelivered && !isRefunded && !isBeneficiaryOrder && hasEnteredProvider && (
                <p className="text-center text-[12px] text-muted-foreground flex items-center justify-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Your order is with the network. If it fails, you’ll be refunded.
                </p>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button onClick={handleWhatsAppSupport} className={secondaryBtn}>
                  <MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp help
                </button>
                <button onClick={() => setShowReceipt(true)} className={secondaryBtn}>
                  <ReceiptText className="h-4 w-4" /> Receipt
                </button>
                <button onClick={handleShareWhatsApp} className={secondaryBtn}>
                  <Share2 className="h-4 w-4" /> Share
                </button>
                <button onClick={handleCopyTrackingLink} className={secondaryBtn}>
                  {copiedLink ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />} {copiedLink ? "Copied" : "Copy link"}
                </button>
              </div>
            </div>

            {isActive && (
              <div className="px-5 pb-5">
                <PushNotificationPrompt variant="inline" title="Get a delivery alert" description="We’ll ping your lock screen the moment it arrives." buttonText="Alert me" />
              </div>
            )}

            {/* Technical details */}
            {createdAt && terminalLogs.length > 0 && (
              <div className="border-t border-border/60 dark:border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setShowTelemetry((prev) => !prev)}
                  className="w-full px-5 py-3 flex items-center justify-between text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
                  aria-expanded={showTelemetry}
                >
                  Technical details
                  {showTelemetry ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                <AnimatePresence initial={false}>
                  {showTelemetry && (
                    <motion.ol
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="px-5 pb-4 space-y-1.5 max-h-[180px] overflow-y-auto font-mono text-[11.5px]"
                    >
                      {terminalLogs.map((log, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-muted-foreground shrink-0">{log.time}</span>
                          <span className={cn(log.status === "success" && "text-emerald-600 dark:text-emerald-400", log.status === "warn" && "text-amber-600 dark:text-amber-400")}>{log.text}</span>
                        </li>
                      ))}
                    </motion.ol>
                  )}
                </AnimatePresence>
              </div>
            )}
          </section>

          <button
            type="button"
            onClick={() => navigate(isStoreRoute && storeInfo?.slug ? `/store/${storeInfo.slug}/order-status` : "/order-status")}
            className="mx-auto flex items-center gap-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
          >
            Track another order <ChevronRight className="h-4 w-4" />
          </button>

          {/* Receipt Modal (Portal to document.body) */}
          {createPortal(
            <AnimatePresence>
              {showReceipt && (
                <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
                  <motion.div 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }} 
                    exit={{ opacity: 0 }}
                    onClick={() => setShowReceipt(false)}
                    className="fixed inset-0 bg-black/90 backdrop-blur-xl" 
                  />
                  <motion.div 
                    role="dialog"
                    aria-modal="true"
                    aria-label="Digital E-Receipt"
                    initial={{ opacity: 0, scale: 0.95, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 15 }}
                    className="relative w-full max-w-sm bg-[#090a10] border border-amber-500/30 rounded-3xl overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.95)] z-10"
                  >
                    <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-yellow-400 to-emerald-500" />

                    <div className="p-5 sm:p-6 space-y-5">
                      <div className="flex justify-between items-center pb-1">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-500/15 border border-amber-500/35">
                            <ReceiptText className="w-4 h-4 text-amber-400" />
                          </div>
                          <div>
                            <span className="text-xs font-black uppercase tracking-widest text-white block">Digital E-Receipt</span>
                            <span className="text-[10px] text-slate-400 font-mono">Official Transaction Record</span>
                          </div>
                        </div>
                        <button 
                          onClick={() => setShowReceipt(false)} 
                          aria-label="Close digital receipt"
                          className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition-colors cursor-pointer"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Receipt Canvas Box (Captured by html2canvas) */}
                      <div ref={receiptRef} className="bg-[#0e0f17] border border-slate-800 rounded-2xl p-5 space-y-4 font-mono shadow-inner text-slate-100">
                        <div className="text-center pb-3.5 border-b border-dashed border-slate-700/80 space-y-1">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-5 h-5 rounded-md bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                              <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                            </div>
                            <p className="text-xs font-black text-white uppercase tracking-wider">{storeName}</p>
                          </div>
                          <p className="text-[10px] text-slate-400 font-mono">{new Date().toLocaleString()}</p>
                        </div>
                        
                        <div className="space-y-2.5 text-[11px]">
                          <div className="flex justify-between items-center">
                            <span className="text-slate-400 uppercase text-[10px] tracking-wider">Reference</span>
                            <span className="text-amber-400 font-bold font-mono text-[10px] bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 max-w-[165px] truncate">
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
                              displayNetwork.includes("MTN") && "bg-amber-500/20 text-amber-300 border border-amber-500/30",
                              displayNetwork.includes("Telecel") && "bg-red-500/20 text-red-300 border border-red-500/30",
                              displayNetwork.includes("Airtel") && "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                            )}>
                              {displayNetwork}
                            </span>
                          </div>

                          <div className="flex justify-between items-center">
                            <span className="text-slate-400 uppercase text-[10px] tracking-wider">Plan / Size</span>
                            <span className="text-white font-bold">{displayPackage}</span>
                          </div>

                          <div className="flex justify-between items-center">
                            <span className="text-slate-400 uppercase text-[10px] tracking-wider">Recipient</span>
                            <span className="text-emerald-400 font-mono font-bold tracking-wider">{displayPhone}</span>
                          </div>

                          {displayAmount && (
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400 uppercase text-[10px] tracking-wider">Amount</span>
                              <span className="text-white font-black">{displayAmount}</span>
                            </div>
                          )}

                          {statusMessage && statusMessage.startsWith("Token:") && (
                            <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                              <span className="text-emerald-400 uppercase text-[10px] font-bold">Meter Token</span>
                              <span className="text-emerald-300 font-black font-mono bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                                {statusMessage.replace("Token:", "").trim()}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="pt-3 border-t border-dashed border-slate-700/80 flex justify-between items-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Order Status</span>
                          <div className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                            (String(orderStatus) === "fulfilled" || String(orderStatus) === "processing" || String(orderStatus) === "paid") && "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
                            (String(orderStatus) === "pending" || String(orderStatus) === "awaiting_payment" || String(orderStatus) === "not_paid") && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                            (String(orderStatus) === "failed" || String(orderStatus) === "fulfillment_failed" || String(orderStatus) === "error") && "bg-red-500/15 text-red-400 border border-red-500/30",
                            String(orderStatus) === "refunded" && "bg-purple-500/15 text-purple-300 border border-purple-500/30"
                          )}>
                            <ShieldCheck className="w-3.5 h-3.5" />
                            {orderStatus}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <button 
                          onClick={copyReceipt}
                          className="h-11 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-amber-400 font-extrabold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Copy Text
                        </button>
                        <button 
                          onClick={downloadReceipt}
                          disabled={isDownloading}
                          className="h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/35 hover:bg-emerald-500/25 text-emerald-300 font-extrabold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                        >
                          {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
                          Save Image
                        </button>
                      </div>
                    </div>
                    
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

        {/* Floating WhatsApp Support Button */}
        {renderFloatingSupport()}
      </div>
    );
  }

  // --- RENDER GLOBAL SYSTEM TRACKER OR STORE LOOKUP ---
  const RECENT_KEY = "swift_recent_lookups_v1";
  let recentLookups: string[] = [];
  try {
    recentLookups = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter((x: unknown) => typeof x === "string").slice(0, 4);
  } catch {
    recentLookups = [];
  }
  const rememberLookup = (value: string) => {
    const v = value.trim();
    if (!v) return;
    try {
      const next = [v, ...recentLookups.filter((x) => x !== v)].slice(0, 4);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  const stats = trackerData?.data?.stats;
  const liveSummary = trackerData?.data?.lastDelivered?.summary || trackerData?.data?.checkingNow?.summary;

  return (
    <div className="min-h-[100dvh] text-foreground px-4 sm:px-6 pt-20 sm:pt-24 pb-20 relative">
      <SEO
        title={`Track Your Order — ${storeName}`}
        description={`Track the delivery status of your data bundle, airtime or bill payment on ${storeName}.`}
        keywords="track data order Ghana, order status, data delivery status"
        canonical={`https://${brandDomain}/order-status`}
      />

      <div className="mx-auto w-full max-w-[460px] space-y-4">
        <div className="text-center">
          {isStoreRoute ? (
            <span className="mx-auto mb-3 h-14 w-14 rounded-2xl overflow-hidden border border-border bg-card flex items-center justify-center">
              {brandLogoUrl ? <img src={brandLogoUrl} alt={storeName} className="h-full w-full object-contain" /> : <Store className="h-7 w-7" style={{ color: brandColor }} />}
            </span>
          ) : null}
          <h1 className="text-[26px] font-bold tracking-[-0.02em] leading-tight">Track your order</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">{isStoreRoute ? storeName : "Data, airtime, bills and AFA"}: see where your order is.</p>
        </div>

        <section className="rounded-2xl border border-border/70 bg-card/90 backdrop-blur-xl p-4 sm:p-5 dark:border-white/[0.08] dark:bg-black/40">
          <form
            onSubmit={(e) => {
              rememberLookup(searchPhone);
              handleSearch(e);
            }}
          >
            <label htmlFor="track-input" className="text-[13px] font-semibold">
              Phone number or order reference
            </label>
            <div className="mt-2 flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute z-10 left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  id="track-input"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  value={searchPhone}
                  onChange={(e) => setSearchPhone(e.target.value)}
                  placeholder="e.g. 024 123 4567"
                  className="h-12 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-[15px] tabular-nums placeholder:text-muted-foreground/60 outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                />
              </div>
              <button
                type="submit"
                className="h-12 px-5 rounded-xl text-[14px] font-semibold shadow-sm hover:brightness-105 shrink-0"
                style={{ backgroundColor: brandColor, color: "#111" }}
              >
                Track
              </button>
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">Use the number the bundle was sent to, or the reference on your receipt.</p>
          </form>

          {recentLookups.length > 0 && (
            <div className="mt-4">
              <p className="text-[11.5px] font-semibold text-muted-foreground">Recent</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {recentLookups.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setSearchPhone(v)}
                    className="h-8 px-3 rounded-full border border-border bg-background text-[12.5px] font-medium tabular-nums hover:bg-muted"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border/70 bg-card/90 backdrop-blur-xl p-4 sm:p-5 dark:border-white/[0.08] dark:bg-black/40" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Delivery status right now</h2>
              <p className="text-[12px] text-muted-foreground">Updated {lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
            </span>
          </div>
          {loadingTracker && !trackerData ? (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  { k: "Delivered", v: stats?.delivered, c: "text-emerald-600 dark:text-emerald-400" },
                  { k: "On the way", v: stats?.pending, c: "text-amber-600 dark:text-amber-400" },
                  { k: "Retrying", v: stats?.failed, c: "text-rose-600 dark:text-rose-400" },
                ].map((s) => (
                  <div key={s.k} className="rounded-xl bg-muted/50 py-3 dark:bg-white/[0.04]">
                    <dd className={cn("text-[18px] font-bold tabular-nums", s.c)}>{typeof s.v === "number" ? s.v : "—"}</dd>
                    <dt className="text-[11px] text-muted-foreground">{s.k}</dt>
                  </div>
                ))}
              </dl>
              {liveSummary && <p className="mt-3 text-[12.5px] text-muted-foreground flex items-start gap-1.5"><ShieldCheck className="h-3.5 w-3.5 mt-0.5 text-emerald-500 shrink-0" />{liveSummary}</p>}
            </>
          )}
        </section>

        {isStoreRoute && (
          <button
            onClick={() => navigate(activeDomain ? "/" : storeInfo?.slug ? `/store/${storeInfo.slug}` : "/")}
            className="mx-auto flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to {storeName}
          </button>
        )}
      </div>

      {renderFloatingSupport()}
    </div>
  );
};

export default OrderStatus;
