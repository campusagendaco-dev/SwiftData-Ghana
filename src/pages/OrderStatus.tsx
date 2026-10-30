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
  MessageCircle, Headphones, ChevronDown, ChevronUp, Radio
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

    return (
      <div className="min-h-screen bg-[#040509] text-slate-100 flex flex-col items-center justify-center p-2.5 sm:p-6 font-sans antialiased selection:bg-amber-500/30 pt-11 sm:pt-20 pb-16 sm:pb-20 relative overflow-hidden">
        <SEO 
          title={`Track Order Status — ${storeName}`}
          description={`Track the real-time delivery status of your data bundle purchase on ${storeName}.`}
          keywords="track data order Ghana, order status, data delivery status"
          canonical={`https://${brandDomain}/order-status?reference=${reference}`}
        />

        {/* Ambient Mesh & Grid Backdrop */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <div 
            className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] sm:w-[540px] h-[380px] sm:h-[540px] rounded-full blur-[140px] sm:blur-[170px] opacity-20 transition-all duration-1000"
            style={{ backgroundColor: meta.color }} 
          />
          <div className="absolute top-[-10%] right-[-10%] w-[260px] sm:w-[360px] h-[260px] sm:h-[360px] bg-amber-500/8 rounded-full blur-[130px]" />
          <div className="absolute bottom-[-10%] left-[-10%] w-[260px] sm:w-[360px] h-[260px] sm:h-[360px] bg-indigo-500/8 rounded-full blur-[130px]" />
        </div>

        <div className="w-full max-w-[420px] sm:max-w-[450px] relative z-10 space-y-2.5 sm:space-y-3.5">
          {/* Top Navigation Bar */}
          <div className="flex items-center justify-between px-1">
            <button
              onClick={() => navigate(isStoreRoute && storeInfo?.slug ? `/store/${storeInfo.slug}` : '/')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-[11px] sm:text-xs font-bold text-slate-300 hover:text-white transition-all active:scale-95 cursor-pointer"
            >
              <ArrowLeft className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400" />
              <span className="truncate max-w-[135px] sm:max-w-[160px]">{storeName}</span>
            </button>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={() => setShowReceipt(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full bg-amber-500/12 hover:bg-amber-500/20 border border-amber-500/30 text-[10px] sm:text-[11px] font-extrabold text-amber-300 transition-all active:scale-95 cursor-pointer"
                title="View Digital E-Receipt"
              >
                <ReceiptText className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400" />
                <span>Receipt</span>
              </button>

              <div className="flex items-center gap-1.5 px-2.5 py-1 sm:py-1.5 rounded-full bg-slate-900/90 border border-slate-800/90 text-[9px] sm:text-[10px] font-bold font-mono text-slate-400">
                <Radio className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-emerald-400 animate-pulse" />
                <span className="hidden xs:inline">UPLINK-01</span>
                <span className="xs:hidden">LIVE</span>
              </div>
            </div>
          </div>

          {/* Primary Command Card */}
          <div
            aria-live="polite"
            className={cn(
              "relative overflow-hidden rounded-[24px] sm:rounded-[28px] bg-[#0a0b12]/95 border backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.85)] transition-all duration-500",
              meta.accentBorder || "border-slate-800/80"
            )}
          >
            {/* Subtle Top Ambient Wash */}
            <div className={cn("absolute inset-x-0 top-0 h-36 sm:h-44 bg-gradient-to-b pointer-events-none", meta.accentBg)} />

            {/* Top Status & Reference Header */}
            <div className="px-3.5 pt-3.5 sm:px-5 sm:pt-5 flex items-center justify-between relative z-10">
              <div className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 py-1 rounded-full bg-black/50 border border-white/[0.07]">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: meta.color }} />
                  <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: meta.color }} />
                </span>
                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.14em] text-slate-200 font-mono">
                  {meta.badge} STATUS
                </span>
              </div>

              <button 
                type="button"
                onClick={handleCopyRef}
                className="cursor-pointer group flex items-center gap-1.5 text-[9px] sm:text-[10px] font-mono text-slate-300 bg-black/50 hover:bg-slate-800/90 px-2.5 py-1 rounded-full border border-white/[0.08] transition-all active:scale-95"
                title="Click to copy order reference"
                aria-label="Copy order reference"
              >
                <span>REF: {reference.slice(0, 10).toUpperCase()}</span>
                {copiedRef ? (
                  <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-slate-500 group-hover:text-amber-400 transition-colors" />
                )}
              </button>
            </div>

            {/* Orbital Status Hero */}
            <div className="px-4 pt-3.5 pb-3 sm:px-5 sm:pt-5 sm:pb-4 flex flex-col items-center text-center relative z-10">
              <div className="relative mb-2.5 sm:mb-3.5 flex items-center justify-center">
                {orderStatus === "fulfilled" ? (
                  <motion.div
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="relative w-16 h-16 sm:w-22 sm:h-22 flex items-center justify-center"
                  >
                    <div className="absolute inset-0 bg-emerald-500 rounded-full blur-xl opacity-30 animate-pulse" />
                    <div className="absolute inset-0.5 rounded-full border border-emerald-400/30 animate-ping opacity-20" />
                    <div className="relative z-10 w-14 h-14 sm:w-18 sm:h-18 rounded-[18px] sm:rounded-[22px] bg-gradient-to-b from-emerald-500/25 via-emerald-950/70 to-[#07080d] border border-emerald-400/45 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.3)]">
                      <CheckCircle2 className="w-7 h-7 sm:w-9 sm:h-9 text-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.6)]" />
                    </div>
                  </motion.div>
                ) : (
                  <div className="relative w-16 h-16 sm:w-22 sm:h-22 flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full blur-xl opacity-25 animate-pulse" style={{ backgroundColor: meta.color }} />
                    {/* Outer Orbital Ring */}
                    <div
                      className="absolute inset-0 rounded-full border border-dashed opacity-35 animate-spin"
                      style={{ borderColor: meta.color, animationDuration: "10s" }}
                    />
                    <div className="relative z-10 w-14 h-14 sm:w-18 sm:h-18 rounded-[18px] sm:rounded-[22px] bg-gradient-to-b from-white/[0.07] to-[#07080d] border border-white/[0.12] flex items-center justify-center shadow-2xl">
                      {isBeneficiaryOrder ? (
                        <Clock className="w-7 h-7 sm:w-8 sm:h-8 text-amber-400 animate-pulse drop-shadow-[0_0_12px_rgba(245,158,11,0.5)]" />
                      ) : orderStatus === "refunded" ? (
                        <RotateCcw className="w-7 h-7 sm:w-8 sm:h-8 text-purple-400 drop-shadow-[0_0_12px_rgba(168,85,247,0.5)]" />
                      ) : failed ? (
                        <XCircle className="w-7 h-7 sm:w-8 sm:h-8 text-red-400 drop-shadow-[0_0_12px_rgba(239,68,68,0.4)]" />
                      ) : (
                        <div className="relative flex items-center justify-center">
                          <Loader2 className="w-8 h-8 sm:w-9 sm:h-9 animate-spin text-amber-400/90" />
                          <Activity className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-300 absolute" />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <h1 className="text-[17px] sm:text-[21px] font-black text-white tracking-tight leading-snug">
                {meta.label}
              </h1>
              <p className="mt-0.5 text-[11px] sm:text-xs text-slate-300/90 font-medium max-w-[290px] sm:max-w-[330px] leading-relaxed">
                {meta.sub}
              </p>

              {/* Live ETA & Instant Sync Pill */}
              {createdAt && ["pending", "paid", "processing"].includes(orderStatus) && (
                <div className="mt-2.5 sm:mt-3 inline-flex items-center gap-1.5 sm:gap-2 pl-3 pr-1.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] sm:text-[11px] font-bold font-mono shadow-inner">
                  <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400 animate-spin" style={{ animationDuration: "4s" }} />
                  <span>
                    {getRemainingTimeStr().includes("Arriving")
                      ? getRemainingTimeStr()
                      : `Est. delivery: ~${getRemainingTimeStr()}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => pollStatus(true)}
                    disabled={isRefreshing}
                    className="ml-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/30 text-[9px] sm:text-[10px] font-black text-amber-200 transition-all cursor-pointer disabled:opacity-50"
                    title="Refresh live carrier status"
                  >
                    <RefreshCw className={cn("w-2.5 h-2.5", isRefreshing && "animate-spin")} />
                    <span>{isRefreshing ? "Syncing" : "Sync"}</span>
                  </button>
                </div>
              )}
            </div>

            {/* 3-Node Visual Pipeline Stepper (Segmented Bridge Architecture — Zero Bleed) */}
            <div className="px-3.5 pb-3 sm:px-5 sm:pb-4 relative z-10">
              {(() => {
                const rawPct = getProgressPercentage();
                const seg1Pct =
                  orderStatus === "fulfilled" || activeStep >= 2
                    ? 100
                    : activeStep === 1
                    ? Math.min(85, Math.max(30, rawPct))
                    : 0;
                const seg2Pct =
                  orderStatus === "fulfilled"
                    ? 100
                    : activeStep >= 2
                    ? Math.min(92, Math.max(24, Math.round(((rawPct - 18) / 77) * 100)))
                    : 0;

                return (
                  <div className="p-3 sm:p-3.5 rounded-2xl bg-gradient-to-b from-[#080a12] to-[#05060b] border border-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] space-y-2.5 sm:space-y-3">
                    {/* Pipeline Top Meta Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full animate-pulse"
                          style={{ backgroundColor: meta.color }}
                        />
                        <span className="text-[8.5px] sm:text-[9px] font-black uppercase tracking-[0.16em] text-slate-400 font-mono">
                          Delivery Pipeline
                        </span>
                      </div>
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-md text-[8.5px] sm:text-[9px] font-mono font-black uppercase tracking-wider border",
                          orderStatus === "fulfilled"
                            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                            : "bg-amber-500/10 text-amber-300 border-amber-500/25"
                        )}
                      >
                        {orderStatus === "fulfilled"
                          ? "100% • Delivered"
                          : `Stage ${Math.max(1, activeStep)}/3 • ${rawPct}%`}
                      </span>
                    </div>

                    {/* Connected Nodes & Segmented Bridges */}
                    <div className="px-1.5 sm:px-2 pt-0.5">
                      <div className="flex items-center">
                        {STEPS.map((s, i) => {
                          const stepNum = i + 1;
                          const isCompleted = activeStep > stepNum || orderStatus === "fulfilled";
                          const isCurrent = activeStep === stepNum && orderStatus !== "fulfilled";
                          const StepIcon = s.icon;

                          return (
                            <div key={s.key} className="contents">
                              {/* Step Icon Node (Solid Dark Core so no track ever bleeds through) */}
                              <div className="relative flex items-center justify-center shrink-0">
                                {isCurrent && (
                                  <span className="absolute -inset-1 rounded-xl sm:rounded-2xl bg-amber-500/20 blur-md animate-pulse pointer-events-none" />
                                )}
                                {isCompleted && (
                                  <span className="absolute -inset-1 rounded-xl sm:rounded-2xl bg-emerald-500/15 blur-sm pointer-events-none" />
                                )}
                                <div
                                  className={cn(
                                    "relative z-10 w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center border transition-all duration-500",
                                    isCompleted
                                      ? "bg-[#071914] border-emerald-400/60 text-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.28)]"
                                      : isCurrent
                                      ? "bg-[#191307] border-amber-400 text-amber-300 ring-3 sm:ring-4 ring-amber-500/15 shadow-[0_0_18px_rgba(245,158,11,0.3)]"
                                      : "bg-[#0b0d16] border-slate-800/90 text-slate-600"
                                  )}
                                >
                                  <StepIcon className={cn("w-3.5 h-3.5 sm:w-4 sm:h-4", isCurrent && "animate-pulse")} />
                                  {isCompleted && (
                                    <span className="absolute -top-1 -right-1 w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full bg-emerald-500 border-2 border-[#06070c] flex items-center justify-center shadow-sm">
                                      <Check className="w-1.5 h-1.5 sm:w-2 sm:h-2 text-slate-950 stroke-[3.5]" />
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Segmented Connector Bridge strictly between nodes */}
                              {i < STEPS.length - 1 && (
                                <div className="flex-1 mx-2 sm:mx-2.5 h-1 sm:h-1.5 rounded-full bg-slate-900 border border-white/[0.05] overflow-hidden relative shadow-inner">
                                  <div
                                    className={cn(
                                      "h-full rounded-full transition-all duration-1000 ease-out relative",
                                      i === 0
                                        ? seg1Pct >= 100
                                          ? "bg-gradient-to-r from-emerald-500 via-emerald-400 to-amber-400 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                                          : "bg-gradient-to-r from-emerald-500 to-amber-400"
                                        : orderStatus === "fulfilled"
                                        ? "bg-gradient-to-r from-emerald-400 to-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                                        : "bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300 shadow-[0_0_10px_rgba(245,158,11,0.45)]"
                                    )}
                                    style={{ width: `${i === 0 ? seg1Pct : seg2Pct}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Step Labels Aligned Under Each Node */}
                      <div className="grid grid-cols-3 gap-1 mt-2">
                        {STEPS.map((s, i) => {
                          const stepNum = i + 1;
                          const isCompleted = activeStep > stepNum || orderStatus === "fulfilled";
                          const isCurrent = activeStep === stepNum && orderStatus !== "fulfilled";
                          const stepLabel = i === 2 && isBeneficiaryOrder ? "In Queue" : s.label;

                          return (
                            <div
                              key={s.key}
                              className={cn(
                                "flex flex-col",
                                i === 0 ? "items-start text-left" : i === 1 ? "items-center text-center" : "items-end text-right"
                              )}
                            >
                              <span
                                className={cn(
                                  "text-[9px] sm:text-[10px] font-black uppercase tracking-wider font-mono leading-tight",
                                  isCompleted
                                    ? "text-emerald-400"
                                    : isCurrent
                                    ? "text-amber-300"
                                    : "text-slate-500"
                                )}
                              >
                                {stepLabel}
                              </span>
                              <span
                                className={cn(
                                  "text-[8px] sm:text-[9px] font-medium mt-0.5 leading-tight",
                                  isCompleted
                                    ? "text-emerald-400/70"
                                    : isCurrent
                                    ? "text-amber-200/75"
                                    : "text-slate-600"
                                )}
                              >
                                {s.sub}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 3-Tile Bento Order Spec Grid */}
            <div className="px-3.5 pb-3 sm:px-5 sm:pb-4 relative z-10">
              <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                {/* Tile 1: Carrier & Plan */}
                <div className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-white/[0.025] border border-white/[0.07] flex flex-col justify-between min-w-0">
                  <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-slate-400 font-mono truncate">
                    Plan & Net
                  </span>
                  <div className="mt-1 sm:mt-1.5 flex items-center gap-1 flex-wrap">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[8.5px] sm:text-[9px] font-black uppercase tracking-wider px-1.5 py-0 border rounded-md leading-4",
                        displayNetwork.toUpperCase().includes("MTN") && "border-amber-500/40 text-amber-300 bg-amber-500/15",
                        displayNetwork.toUpperCase().includes("TELECEL") && "border-red-500/40 text-red-300 bg-red-500/15",
                        (displayNetwork.toUpperCase().includes("AIRTEL") || displayNetwork.toUpperCase().includes("AT")) && "border-blue-500/40 text-blue-300 bg-blue-500/15"
                      )}
                    >
                      {displayNetwork.replace(" Bundle", "")}
                    </Badge>
                    <span className="text-[11px] sm:text-xs font-black text-white font-mono truncate">
                      {displayPackage}
                    </span>
                  </div>
                </div>

                {/* Tile 2: Recipient Phone */}
                <button
                  type="button"
                  onClick={handleCopyPhone}
                  className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-white/[0.025] hover:bg-white/[0.05] border border-white/[0.07] flex flex-col justify-between text-left transition-colors group cursor-pointer min-w-0"
                  title="Click to copy recipient number"
                >
                  <div className="flex items-center justify-between w-full gap-1">
                    <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-slate-400 font-mono truncate">
                      Recipient
                    </span>
                    {copiedPhone ? (
                      <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-emerald-400 shrink-0" />
                    ) : (
                      <Copy className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-slate-500 group-hover:text-emerald-400 transition-colors shrink-0" />
                    )}
                  </div>
                  <span className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs font-mono font-black text-emerald-400 tracking-tight sm:tracking-wide truncate block w-full">
                    {displayPhone}
                  </span>
                </button>

                {/* Tile 3: Verified Amount / Route */}
                <div className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-white/[0.025] border border-white/[0.07] flex flex-col justify-between min-w-0">
                  <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-slate-400 font-mono truncate">
                    {displayAmount ? "Verified Paid" : "Gateway"}
                  </span>
                  <div className="mt-1 sm:mt-1.5 flex items-center justify-between gap-1">
                    <span className="text-[11px] sm:text-xs font-black text-white font-mono truncate">
                      {displayAmount || "Auto-Router"}
                    </span>
                    <ShieldCheck className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400 shrink-0" />
                  </div>
                </div>
              </div>
            </div>

            {/* Prepaid Meter Token Callout (For ECG / Utility Orders) */}
            {orderStatus === "fulfilled" && (
              (statusMessage && (statusMessage.includes("Token") || statusMessage.includes("token"))) || 
              Boolean((orderData as any)?.metadata?.prepaid_token)
            ) && (() => {
              const rawToken = (orderData as any)?.metadata?.prepaid_token || statusMessage?.replace(/^.*(?:Token|token):?/i, "").trim();
              if (!rawToken) return null;
              return (
                <div className="mx-3.5 sm:mx-5 mb-3 sm:mb-4 p-3.5 sm:p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-2 animate-in zoom-in-95 duration-200 relative z-10">
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400 flex items-center justify-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    Prepaid Meter Token Code
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-base sm:text-lg font-black tracking-wider text-white font-mono bg-black/60 px-3 py-1 rounded-xl border border-emerald-500/40">
                      {rawToken}
                    </span>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(rawToken);
                        toast.success("Token copied to clipboard!");
                      }}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all cursor-pointer"
                      title="Copy Token"
                      aria-label="Copy prepaid meter token"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium">Key this code into your prepaid meter keypad to credit electricity.</p>
                </div>
              );
            })()}

            {/* Whitelist In-Queue Callout Card */}
            {isBeneficiaryOrder && (
              <div className="mx-3.5 sm:mx-5 mb-3 sm:mb-4 p-3.5 sm:p-4 rounded-2xl bg-gradient-to-b from-amber-500/15 via-amber-950/20 to-black border border-amber-500/40 text-center space-y-2.5 shadow-lg shadow-amber-950/40 relative z-10">
                <div className="flex items-center justify-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
                  <span className="text-xs font-black uppercase tracking-wider text-amber-300 font-mono">
                    MTN Carrier Whitelist Queue
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-slate-300 font-medium leading-relaxed">
                  Recipient line <span className="text-amber-300 font-bold font-mono">{displayPhone}</span> is queued for carrier beneficiary verification. The bundle will deliver automatically once approved.
                </p>
                <div className="pt-1 flex flex-col gap-2">
                  <button
                    onClick={() => navigate(`/submit-numbers?phone=${encodeURIComponent(phoneParam || orderPhone || "")}`)}
                    className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] sm:text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Zap className="w-4 h-4 fill-slate-950" />
                    Expedite / Verify Number Now 🚀
                  </button>

                  {(orderData as any)?.metadata?.guest_refund_status === "needs_manual_payout" ? (
                    <a
                      href={getWhatsAppUrl(`Hello SwiftData support, my refund request for order ${resolvedOrderId || reference} is pending manual payout. Please assist me.`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-2.5 px-4 rounded-xl bg-amber-600/25 hover:bg-amber-600/40 border border-amber-500/40 text-amber-200 font-black text-[11px] sm:text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 flex items-center justify-center gap-2"
                    >
                      <MessageCircle className="w-4 h-4 text-amber-400 fill-amber-400/20" />
                      Refund Under Review (Chat Support) ⏳
                    </a>
                  ) : (
                    <button
                      onClick={handleInstantRefund}
                      disabled={isClaimingRefund}
                      className="w-full py-2.5 px-4 rounded-xl bg-purple-600/25 hover:bg-purple-600/40 border border-purple-500/40 text-purple-200 font-black text-[11px] sm:text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isClaimingRefund ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4 text-purple-400" />}
                      Request Refund to Mobile Money 💰
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 1. Verified Completed Paystack Mobile Money Refund */}
            {orderStatus === "refunded" && (orderData as any)?.metadata?.guest_refund_gateway === "paystack" && (orderData as any)?.metadata?.guest_refund_status === "completed" && (
              <div className="mx-3.5 sm:mx-5 mb-3 sm:mb-4 p-3.5 sm:p-4 rounded-2xl bg-gradient-to-b from-purple-500/15 via-purple-950/20 to-black border border-purple-500/40 text-center space-y-2 shadow-lg shadow-purple-950/40 relative z-10">
                <div className="flex items-center justify-center gap-2">
                  <RotateCcw className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-black uppercase tracking-wider text-purple-300 font-mono">
                    Refund Sent to Mobile Money 💰
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-slate-300 font-medium leading-relaxed">
                  Your payment of <strong className="text-emerald-400 font-black">GH₵ {Number((orderData as any)?.refund_amount || (orderData as any)?.amount || 0).toFixed(2)}</strong> for <span className="text-amber-300 font-bold font-mono">{displayPhone}</span> has been refunded to your Mobile Money account via Paystack.
                </p>
                {(orderData as any)?.metadata?.guest_refund_id && (
                  <div className="text-[10px] text-purple-300/80 font-mono bg-purple-500/10 py-1 px-3 rounded-lg border border-purple-500/20 inline-block">
                    Paystack Refund ID: <span className="font-bold text-purple-200">{(orderData as any)?.metadata?.guest_refund_id}</span>
                  </div>
                )}
              </div>
            )}

            {/* 2. Refund Under Manual Review */}
            {(orderData as any)?.metadata?.guest_refund_status === "needs_manual_payout" && orderStatus !== "refunded" && (
              <div className="mx-3.5 sm:mx-5 mb-3 sm:mb-4 p-3.5 sm:p-4 rounded-2xl bg-gradient-to-b from-amber-500/15 via-amber-950/20 to-black border border-amber-500/40 text-center space-y-2 shadow-lg shadow-amber-950/40 relative z-10">
                <div className="flex items-center justify-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
                  <span className="text-xs font-black uppercase tracking-wider text-amber-300 font-mono">
                    Refund Request Under Review ⏳
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-slate-300 font-medium leading-relaxed">
                  Your refund request for <strong className="text-amber-300 font-bold">GH₵ {Number((orderData as any)?.amount || 0).toFixed(2)}</strong> is queued for manual Mobile Money payout by our support team.
                </p>
                <a
                  href={getWhatsAppUrl(`Hello SwiftData support, my order ${resolvedOrderId || reference} is pending manual refund payout. Please assist me.`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[11px] sm:text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-4 h-4 fill-white" />
                  Chat Support for Instant Payout 🚀
                </a>
              </div>
            )}

            {/* 3. Refunded to Agent Wallet Balance */}
            {orderStatus === "refunded" && (orderData as any)?.metadata?.guest_refund_gateway !== "paystack" && (
              <div className="mx-3.5 sm:mx-5 mb-3 sm:mb-4 p-3.5 sm:p-4 rounded-2xl bg-gradient-to-b from-blue-500/15 via-blue-950/20 to-black border border-blue-500/40 text-center space-y-2 shadow-lg shadow-blue-950/40 relative z-10">
                <div className="flex items-center justify-center gap-2">
                  <RotateCcw className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-black uppercase tracking-wider text-blue-300 font-mono">
                    Refunded to Wallet Balance 💳
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-slate-300 font-medium leading-relaxed">
                  <strong className="text-emerald-400 font-black">GH₵ {Number((orderData as any)?.refund_amount || (orderData as any)?.amount || 0).toFixed(2)}</strong> has been credited back to your wallet balance.
                </p>
              </div>
            )}

            {/* Unified Smart Action & Resolution Dock */}
            <div className="mx-3.5 mb-3 p-3 sm:mx-5 sm:mb-4 sm:p-4 rounded-2xl bg-gradient-to-b from-white/[0.04] to-[#06070c] border border-white/[0.08] space-y-2.5 sm:space-y-3 relative z-10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <Headphones className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-200 font-mono">
                    {orderStatus === "fulfilled" ? "Order Actions & Receipt" : "Smart Resolution Dock"}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[8.5px] sm:text-[9px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  Agents Online
                </span>
              </div>

              {/* Primary CTA when order is active / not yet delivered */}
              {orderStatus !== "fulfilled" && orderStatus !== "refunded" && (
                <button
                  onClick={handleExpediteDelivery}
                  disabled={isExpediting}
                  className="w-full py-2.5 sm:py-3 px-3.5 sm:px-4 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-500 hover:brightness-110 text-slate-950 font-black text-[11px] sm:text-xs uppercase tracking-wider transition-all shadow-[0_8px_25px_rgba(245,158,11,0.28)] active:scale-[0.98] flex items-center justify-center gap-1.5 sm:gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {isExpediting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin text-slate-950" />
                      <span>Syncing Carrier Gateway...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-slate-950 text-slate-950" />
                      <span>Expedite Delivery / Force Dispatch</span>
                    </>
                  )}
                </button>
              )}

              {/* 2x2 Quick Action Grid */}
              <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                <button
                  onClick={() => setShowReceipt(true)}
                  className="py-2 sm:py-2.5 px-2.5 sm:px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-200 font-bold text-[11px] sm:text-xs flex items-center justify-center gap-1.5 sm:gap-2 transition-all active:scale-95 cursor-pointer"
                >
                  <ReceiptText className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Digital Receipt</span>
                </button>

                <button
                  onClick={handleWhatsAppSupport}
                  className="py-2 sm:py-2.5 px-2.5 sm:px-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-bold text-[11px] sm:text-xs flex items-center justify-center gap-1.5 sm:gap-2 transition-all active:scale-95 cursor-pointer"
                >
                  <MessageCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>WhatsApp Help</span>
                </button>

                <button
                  onClick={handleShareWhatsApp}
                  className="py-2 sm:py-2.5 px-2.5 sm:px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 font-bold text-[11px] sm:text-xs flex items-center justify-center gap-1.5 sm:gap-2 transition-all active:scale-95 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Share Status</span>
                </button>

                <button
                  onClick={handleCopyTrackingLink}
                  className="py-2 sm:py-2.5 px-2.5 sm:px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 font-bold text-[11px] sm:text-xs flex items-center justify-center gap-1.5 sm:gap-2 transition-all active:scale-95 cursor-pointer"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="text-emerald-400">Link Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>Copy Link</span>
                    </>
                  )}
                </button>
              </div>

              {/* Refund or Carrier Gateway Guarantee Strip */}
              {orderStatus !== "fulfilled" && orderStatus !== "refunded" && !isBeneficiaryOrder && (
                <div className="pt-0.5">
                  {!hasEnteredProvider ? (
                    <button
                      onClick={handleInstantRefund}
                      disabled={isClaimingRefund}
                      className="w-full py-2 sm:py-2.5 px-3 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-200 font-bold text-[11px] sm:text-xs uppercase tracking-wider transition-all active:scale-95 flex items-center justify-center gap-1.5 sm:gap-2 disabled:opacity-50 cursor-pointer"
                    >
                      {isClaimingRefund ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-300" />
                          <span>Processing Instant Refund...</span>
                        </>
                      ) : (
                        <>
                          <RotateCcw className="w-3.5 h-3.5 text-purple-400" />
                          <span>Claim Instant Refund to MoMo 💰</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/25 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="text-[9.5px] sm:text-[10px] text-slate-300 font-medium truncate">
                          <strong className="text-emerald-300">Carrier Gateway Locked:</strong> 100% Guaranteed
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => pollStatus(true)}
                        disabled={isRefreshing}
                        className="text-[9.5px] sm:text-[10px] font-mono font-bold text-emerald-400 hover:text-emerald-300 shrink-0 underline cursor-pointer"
                      >
                        {isRefreshing ? "Checking..." : "Verify"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Lock-Screen Delivery Alert Prompt */}
            {orderStatus !== "fulfilled" && orderStatus !== "fulfillment_failed" && (
              <div className="mx-3.5 mb-3 sm:mx-5 sm:mb-4 relative z-10">
                <PushNotificationPrompt 
                  variant="inline"
                  title="Get Lock-Screen Delivery Alerts 🔔"
                  description="Get notified on your lock screen the exact second your bundle delivers."
                  buttonText="Alert Me When Delivered"
                />
              </div>
            )}

            {/* Collapsible Live Carrier Telemetry Drawer */}
            {createdAt && terminalLogs.length > 0 && (
              <div className="mx-3.5 mb-3.5 sm:mx-5 sm:mb-4 rounded-xl sm:rounded-2xl bg-[#05060a] border border-white/[0.07] overflow-hidden relative z-10">
                <button
                  type="button"
                  onClick={() => setShowTelemetry((prev) => !prev)}
                  className="w-full px-3 py-2 sm:px-3.5 sm:py-2.5 flex items-center justify-between gap-2 text-left hover:bg-white/[0.02] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                    <Terminal className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400 shrink-0" />
                    <span className="text-[9px] sm:text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 shrink-0">
                      Telemetry
                    </span>
                    <span className="text-[9.5px] sm:text-[10px] font-mono text-slate-300 truncate">
                      {latestLog?.text}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {showTelemetry ? (
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {showTelemetry && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-slate-800/80 px-3 py-2 sm:px-3.5 sm:py-2.5 font-mono text-[9.5px] sm:text-[10px] space-y-1.5 max-h-[140px] overflow-y-auto"
                    >
                      {terminalLogs.map((log, i) => (
                        <div key={i} className="flex gap-2 leading-relaxed">
                          <span className="text-slate-500 shrink-0">{log.time}</span>
                          <span
                            className={cn(
                              log.status === "success" && "text-emerald-400 font-semibold",
                              log.status === "warn" && "text-amber-400 font-semibold",
                              log.status === "info" && "text-slate-300"
                            )}
                          >
                            {log.text}
                          </span>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Subtle Bottom Security Footer */}
            <div className="bg-black/60 px-3.5 py-2.5 sm:px-5 sm:py-3 flex items-center justify-between border-t border-white/[0.06] relative z-10">
              <div className="flex items-center gap-1.5 text-[9.5px] sm:text-[10px] font-mono text-slate-400">
                <ShieldCheck className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400 shrink-0" />
                <span className="truncate">256-Bit Encrypted Uplink</span>
              </div>
              <button
                type="button"
                onClick={() => navigate(isStoreRoute && storeInfo?.slug ? `/store/${storeInfo.slug}/order-status` : '/order-status')}
                className="text-[9.5px] sm:text-[10px] font-mono font-bold text-amber-400 hover:text-amber-300 transition-colors cursor-pointer shrink-0"
              >
                Lookup Another →
              </button>
            </div>
          </div>

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
  if (isStoreRoute) {
    return (
      <div className="min-h-screen bg-[#040509] text-white selection:bg-amber-500/30 font-sans antialiased flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <SEO 
          title={`Track Order Status — ${storeName}`}
          description={`Track the real-time delivery status of your purchases on ${storeName}.`}
          keywords="track data order Ghana, order status, data delivery status"
          canonical={`https://${brandDomain}/order-status`}
        />

        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-[160px]" />
        </div>

        <div className="w-full max-w-md space-y-8 relative z-10">
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

          <div className="relative overflow-hidden rounded-3xl bg-[#0a0b12]/95 border border-white/[0.08] p-8 backdrop-blur-2xl shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none" />
            <h3 className="font-extrabold text-base text-center mb-1 text-white">Lookup Order Status</h3>
            <p className="text-xs text-slate-400 font-medium text-center mb-6">Enter recipient phone number or order reference ID to fetch all recent purchase records.</p>
            
            <form onSubmit={handleSearch} className="relative group">
              <input 
                type="text"
                value={searchPhone}
                onChange={(e) => setSearchPhone(e.target.value)}
                placeholder="Phone number or order reference..."
                aria-label="Phone number or order reference"
                className="w-full py-4 pl-5 pr-14 rounded-2xl bg-slate-950 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 transition-all shadow-inner font-mono"
              />
              <button type="submit" aria-label="Search order status" className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 transition-all shadow-md cursor-pointer" style={{ backgroundColor: brandColor }}>
                <Search className="w-4 h-4 text-black font-bold" />
              </button>
            </form>
          </div>

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
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-slate-900/80 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-all hover:scale-105 active:scale-95 shadow-md cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-amber-400" /> Back to Store
            </button>
          </div>
        </div>

        {renderFloatingSupport()}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#040509] text-white selection:bg-amber-500/30 font-sans antialiased relative overflow-hidden">
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
            aria-label="Track order by phone number or reference"
            className="w-full py-4 pl-6 pr-14 rounded-2xl bg-[#0a0b12]/90 border border-white/[0.08] text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 transition-all shadow-2xl font-mono"
          />
          <button type="submit" aria-label="Search order status" className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 transition-all shadow-md cursor-pointer" style={{ backgroundColor: brandColor }}>
            <Search className="w-4 h-4 text-black font-bold" />
          </button>
        </form>

        {loadingTracker && !trackerData ? (
          <div aria-live="polite" className="py-20 flex flex-col items-center gap-4">
             <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
             <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 font-mono">Connecting Telemetry Gateway...</p>
          </div>
        ) : (
          <div aria-live="polite" className="space-y-6">
            <div className="relative rounded-3xl border border-white/[0.08] bg-[#0a0b12]/90 backdrop-blur-2xl overflow-hidden shadow-2xl">
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
                  <div key={i} className="flex items-center justify-between p-3.5 rounded-2xl bg-[#0a0b12]/80 border border-slate-800/80 shadow-md">
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

      {renderFloatingSupport()}
    </div>
  );
};

export default OrderStatus;
