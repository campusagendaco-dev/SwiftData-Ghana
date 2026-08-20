import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Zap, Loader2, CreditCard, Wallet,
  CheckCircle2, Phone, RotateCcw, ArrowRight, ShieldCheck,
  Sparkles,
} from "lucide-react";
import { cn, detectNetwork } from "@/lib/utils";
import { MTNLogo, TelecelLogo, AirtelTigoLogo } from "@/components/BrandLogos";
import OrderStatusBanner from "@/components/OrderStatusBanner";
import { useAppTheme } from "@/contexts/ThemeContext";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { PaystackMomoCheckout } from "@/components/PaystackMomoCheckout";
import { motion, AnimatePresence } from "framer-motion";

type PayMethod = "wallet" | "paystack";

const NETWORKS = [
  {
    name: "MTN",
    Logo: MTNLogo,
    color: "#FFCC00",
    glow: "rgba(255,204,0,0.18)",
    buttonGradient: "linear-gradient(135deg, #FFCC00 0%, #FF8C00 100%)",
    buttonShadow: "0 8px 32px rgba(255,204,0,0.30)",
    buttonTextColor: "#000000",
  },
  {
    name: "Telecel",
    Logo: TelecelLogo,
    color: "#EF4444",
    glow: "rgba(239,68,68,0.18)",
    buttonGradient: "linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)",
    buttonShadow: "0 8px 32px rgba(239,68,68,0.30)",
    buttonTextColor: "#ffffff",
  },
  {
    name: "AirtelTigo",
    Logo: AirtelTigoLogo,
    color: "#3B82F6",
    glow: "rgba(59,130,246,0.18)",
    buttonGradient: "linear-gradient(135deg, #3B82F6 0%, #6366F1 100%)",
    buttonShadow: "0 8px 32px rgba(59,130,246,0.30)",
    buttonTextColor: "#ffffff",
  },
];

const QUICK_AMOUNTS = [2, 5, 10, 20, 50, 100];
const calcFee = (amount: number) => 0;

const DashboardBuyAirtime = () => {
  const { user, profile } = useAuth();
  const { isDark } = useAppTheme();
  const { toast } = useToast();

  const [network, setNetwork] = useState("MTN");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PayMethod>("wallet");
  const [loading, setLoading] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [lastOrder, setLastOrder] = useState<any>(null);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);

  // Name Resolution State
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolvingName, setResolvingName] = useState(false);
  const lastAttemptRef = useRef<string | null>(null);

  // Paystack Momo Checkout State
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutMetadata, setCheckoutMetadata] = useState<any>(null);

  const phoneDigits = phone.replace(/\D+/g, "");
  const isPhoneValid = phoneDigits.length === 10 || phoneDigits.length === 12 || phoneDigits.length === 9;
  const numAmount = Number(amount);
  const canPay = isPhoneValid && numAmount >= 1 && numAmount <= 200 && resolvedName;

  useEffect(() => {
    const fetchBalance = async () => {
      if (!user) return;
      const { data } = await supabase
        .from("wallets")
        .select("balance")
        .eq("agent_id", user.id)
        .maybeSingle();
      if (data) setWalletBalance(Number(data.balance));
    };
    fetchBalance();
  }, [user]);

  // Auto-detect network
  useEffect(() => {
    const detected = detectNetwork(phone);
    if (detected && detected !== network) {
      setNetwork(detected);
      setResolvedName(null);
      toast({ 
        title: `Network set to ${detected}`, 
        description: `We detected an ${detected} number.`,
        duration: 2000
      });
    }
  }, [phone, network, toast]);

  // Name resolution effect
  useEffect(() => {
    setResolvedName(null);
    const attemptKey = `${network}-${phoneDigits}`;
    if (!isPhoneValid || resolvingName || lastAttemptRef.current === attemptKey) return;

    const timer = setTimeout(async () => {
      setResolvingName(true);
      try {
        let bankCode = "MTN";
        const net = network.toUpperCase();
        if (net.includes("VODA") || net.includes("TELECEL")) bankCode = "VOD";
        if (net.includes("AIRTEL") || net.includes("TIGO") || net.includes("AT")) bankCode = "ATL";

        const { data, error } = await supabase.functions.invoke("paystack-resolve", {
          body: { account_number: phoneDigits, bank_code: bankCode }
        });
        lastAttemptRef.current = attemptKey;
        if (!error && data?.success) {
          setResolvedName(data.account_name);
        } else {
          setResolvedName("Unknown Recipient");
        }
      } catch (e) {
        console.error("Auto-resolution failed:", e);
        lastAttemptRef.current = attemptKey;
        setResolvedName("Recipient");
      } finally {
        setResolvingName(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [network, isPhoneValid, phoneDigits]);

  const activeNet = NETWORKS.find((n) => n.name === network)!;
  const ActiveLogo = activeNet.Logo;

  const handlePay = async () => {
    if (!canPay) return;

    if (payMethod === "wallet") {
      if (walletBalance === null || walletBalance < numAmount) {
        toast({
          title: "Insufficient Balance",
          description: "Your wallet balance is too low for this transaction.",
          variant: "destructive"
        });
        return;
      }

      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("wallet-pay-airtime", {
          body: {
            network,
            customer_phone: phoneDigits,
            amount: numAmount
          }
        });

        if (error) throw error;

        if (data && data.success) {
          toast({
            title: "Success",
            description: "Airtime purchased successfully.",
          });
          setWalletBalance(prev => prev !== null ? prev - numAmount : null);
          setShowSuccessOverlay(true);
          setPhone("");
          setAmount("");
        } else {
          throw new Error(data?.error || "Airtime purchase failed.");
        }
      } catch (e: any) {
        toast({
          title: "Wallet Payment Failed",
          description: e.message || "Failed to process wallet payment.",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    } else {
      // Paystack checkout
      setLoading(true);
      const orderId = crypto.randomUUID();
      const callbackParams = new URLSearchParams({
        reference: orderId,
        network,
        package: "AIRTIME",
        phone: phoneDigits,
      });

      const meta = {
        order_id: orderId,
        order_type: "airtime",
        network,
        package_size: "AIRTIME",
        customer_phone: phoneDigits,
        customer_name: resolvedName,
        fee: calcFee(numAmount),
        payment_source: "direct",
        is_korba: true,
        callback_url: `${getAppBaseUrl()}/order-status?${callbackParams.toString()}`,
      };

      setCheckoutMetadata(meta);
      setCheckoutOpen(true);
      setLoading(false);
    }
  };

  const handleCheckoutSuccess = (ref: string) => {
    setCheckoutOpen(false);
    setPhone("");
    setAmount("");
    
    const callbackParams = new URLSearchParams({
      reference: ref,
      network,
      package: "AIRTIME",
      phone: phoneDigits,
    });
    
    window.location.href = `${getAppBaseUrl()}/order-status?${callbackParams.toString()}`;
  };

  const handleCheckoutFailure = (error: string) => {
    setLoading(false);
    toast({
      title: "Checkout Failed",
      description: error || "Payment session failed.",
      variant: "destructive"
    });
  };

  return (
    <div className="relative p-4 md:p-8 max-w-4xl mx-auto space-y-8 animate-in fade-in duration-700 pb-20 overflow-hidden">
      
      {/* Dynamic ambient glow that shifts with network */}
      <div
        className="fixed top-0 left-0 right-0 h-[65vh] pointer-events-none transition-all duration-1000"
        style={{
          background: `radial-gradient(ellipse 80% 50% at 50% -15%, ${activeNet.glow} 0%, transparent 70%)`,
        }}
      />

      {/* ── Page Header ── */}
      <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-bold uppercase tracking-wider border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Instant Delivery
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-bold uppercase tracking-wider border border-amber-500/20">
              <Sparkles className="w-3 h-3" />
              Agent Rates Active
            </span>
            <span className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border",
              isDark ? "bg-white/[0.04] text-white/40 border-white/[0.08]" : "bg-gray-100 text-gray-400 border-gray-200"
            )}>
              <ShieldCheck className="w-3 h-3" />
              Secured
            </span>
          </div>

          <h1 className={cn("text-3xl md:text-4xl font-black tracking-tight flex items-center gap-3", isDark ? "text-white" : "text-gray-900")}>
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-700"
              style={{ background: activeNet.buttonGradient }}
            >
              <Zap className="w-5 h-5" style={{ color: activeNet.buttonTextColor }} />
            </div>
            Airtime Top-up
          </h1>
          <p className={cn("text-sm mt-1.5 ml-[52px]", isDark ? "text-white/35" : "text-gray-500")}>
            Send airtime to any Ghana number instantly
          </p>
        </div>

        {/* Wallet balance chip */}
        <div className="relative shrink-0">
          <div
            className="absolute -inset-px rounded-2xl opacity-60 transition-all duration-700"
            style={{ background: `linear-gradient(135deg, ${activeNet.color}28, transparent 60%)` }}
          />
          <div className={cn(
            "relative flex items-center gap-3 backdrop-blur-xl border rounded-2xl px-5 py-3.5",
            isDark ? "bg-black/40 border-white/[0.08]" : "bg-white border-gray-200 shadow-sm"
          )}>
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{
                background: `${activeNet.color}15`,
                border: `1px solid ${activeNet.color}28`,
              }}
            >
              <Wallet className="w-4 h-4" style={{ color: activeNet.color }} />
            </div>
            <div>
              <p className={cn("text-[9px] font-bold uppercase tracking-widest", isDark ? "text-white/30" : "text-gray-400")}>Balance</p>
              <p className={cn("text-lg font-black leading-tight", isDark ? "text-white" : "text-gray-900")}>
                {walletBalance !== null ? `₵${walletBalance.toFixed(2)}` : "₵—"}
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className={cn(
                "ml-2 p-1.5 rounded-lg transition-colors",
                isDark ? "hover:bg-white/5 text-white/20 hover:text-white/60" : "hover:bg-gray-100 text-gray-300 hover:text-gray-500"
              )}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {lastOrder && (
        <OrderStatusBanner
          orderId={lastOrder.id}
          network={lastOrder.network}
          packageSize={lastOrder.packageSize}
          customerPhone={lastOrder.phone}
          initialStatus={lastOrder.status}
          onDismiss={() => setLastOrder(null)}
        />
      )}

      {/* ── Network Selector ── */}
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        {NETWORKS.map((n) => {
          const isActive = network === n.name;
          const NLogo = n.Logo;
          return (
            <button
              key={n.name}
              onClick={() => { setNetwork(n.name); setResolvedName(null); }}
              className="relative flex flex-col items-center gap-2.5 py-5 px-3 rounded-3xl overflow-hidden transition-all duration-500"
              style={
                isActive
                  ? {
                      background: isDark ? `linear-gradient(160deg, ${n.color}13 0%, ${n.color}05 100%)` : `linear-gradient(160deg, ${n.color}10 0%, #fff 100%)`,
                      borderWidth: "2px",
                      borderStyle: "solid",
                      borderColor: isDark ? `${n.color}55` : `${n.color}40`,
                      boxShadow: isDark ? `0 8px 36px ${n.glow}` : `0 8px 24px ${n.color}15`,
                      transform: "scale(1.035)",
                    }
                  : {
                      background: isDark ? "rgba(255,255,255,0.018)" : "#fff",
                      borderWidth: "2px",
                      borderStyle: "solid",
                      borderColor: isDark ? "rgba(255,255,255,0.055)" : "rgba(0,0,0,0.05)",
                    }
              }
            >
              {isActive && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: `radial-gradient(ellipse 80% 60% at 50% 120%, ${n.glow} 0%, transparent 70%)`,
                  }}
                />
              )}

              {isActive && (
                <div
                  className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center z-10 animate-in zoom-in duration-300"
                  style={{ background: n.color }}
                >
                  <CheckCircle2 className="w-3 h-3" style={{ color: n.buttonTextColor }} />
                </div>
              )}

              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-500"
                style={
                  isActive
                    ? { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }
                    : { background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }
                }
              >
                <NLogo size={44} />
              </div>

              <span
                className="text-sm font-black transition-colors duration-300"
                style={{ color: isActive ? (isDark ? "#fff" : n.color) : (isDark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.3)") }}
              >
                {n.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Main Form + Summary Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">

        {/* Left: Recipient + Amount */}
        <div className="space-y-4">

          {/* Step 1: Recipient */}
          <div
            className="rounded-3xl p-5 md:p-7 space-y-4 transition-all duration-500"
            style={{
              background: "rgba(255,255,255,0.018)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <div className="flex items-center gap-2.5">
              <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black border", isDark ? "bg-white/[0.05] border-white/[0.08] text-white/50" : "bg-gray-100 border-gray-200 text-gray-400")}>
                1
              </div>
              <h2 className={cn("text-xs font-bold uppercase tracking-[0.15em]", isDark ? "text-white/45" : "text-gray-500")}>
                Recipient Phone
              </h2>
            </div>

            <div className="relative">
              <div className={cn("absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none", isDark ? "text-white/20" : "text-gray-300")}>
                <Phone className="w-5 h-5" />
              </div>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="024 000 0000"
                className={cn("w-full h-16 pl-14 pr-14 rounded-2xl text-xl font-bold placeholder:text-opacity-20 focus:outline-none transition-all duration-300 bg-background border")}
                style={
                  isPhoneValid
                    ? {
                        background: `${activeNet.color}09`,
                        borderColor: activeNet.color,
                      }
                    : {
                        background: "rgba(255,255,255,0.025)",
                        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
                      }
                }
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                {resolvingName && <Loader2 className="w-4 h-4 animate-spin text-amber-500" />}
                {isPhoneValid && resolvedName && (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center animate-in zoom-in duration-300"
                    style={{
                      background: `${activeNet.color}20`,
                      border: `1px solid ${activeNet.color}40`,
                    }}
                  >
                    <CheckCircle2 className="w-4 h-4" style={{ color: activeNet.color }} />
                  </div>
                )}
              </div>
            </div>

            {/* Name Resolution Display */}
            <AnimatePresence>
              {isPhoneValid && resolvedName && (
                <motion.div
                  key="recipient-identity"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3"
                >
                  <div className="w-6 h-6 rounded bg-emerald-500/20 flex items-center justify-center text-emerald-600 font-bold text-xs">
                    {resolvedName.charAt(0)}
                  </div>
                  <div>
                    <p className="text-[8px] font-black uppercase text-emerald-500 leading-none mb-0.5">Recipient Identity</p>
                    <p className="text-xs font-black text-emerald-700 dark:text-emerald-300 uppercase leading-none">{resolvedName}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Step 2: Amount */}
          <div
            className="rounded-3xl p-5 md:p-7 space-y-5 transition-all duration-500"
            style={{
              background: "rgba(255,255,255,0.018)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <div className="flex items-center gap-2.5">
              <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black border", isDark ? "bg-white/[0.05] border-white/[0.08] text-white/50" : "bg-gray-100 border-gray-200 text-gray-400")}>
                2
              </div>
              <h2 className={cn("text-xs font-bold uppercase tracking-[0.15em]", isDark ? "text-white/45" : "text-gray-500")}>
                Airtime Amount
              </h2>
            </div>

            {/* Quick amounts */}
            <div className="flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((q) => (
                <button
                  key={q}
                  onClick={() => setAmount(String(q))}
                  className="px-4 py-2.5 rounded-xl text-sm font-black transition-all duration-200"
                  style={
                    amount === String(q)
                      ? {
                          background: `${activeNet.color}22`,
                          border: `1.5px solid ${activeNet.color}55`,
                          color: activeNet.color,
                          boxShadow: `0 4px 16px ${activeNet.glow}`,
                        }
                      : {
                          background: isDark ? "rgba(255,255,255,0.03)" : "#fff",
                          border: isDark ? "1.5px solid rgba(255,255,255,0.07)" : "1.5px solid rgba(0,0,0,0.08)",
                          color: isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.4)",
                        }
                  }
                >
                  ₵{q}
                </button>
              ))}
            </div>

            {/* Big custom amount input */}
            <div className="relative">
              <div
                className="absolute left-6 top-1/2 -translate-y-1/2 text-4xl font-black pointer-events-none transition-all duration-300 select-none"
                style={{ color: numAmount > 0 ? activeNet.color : (isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)") }}
              >
                ₵
              </div>
              <input
                type="number"
                min="1"
                max="200"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={cn("w-full h-24 pl-16 pr-6 rounded-3xl text-5xl font-black placeholder:text-opacity-20 focus:outline-none transition-all duration-300 bg-background border")}
                style={
                  numAmount > 200
                    ? {
                        background: "rgba(239,68,68,0.08)",
                        borderColor: "#EF4444",
                      }
                    : numAmount > 0
                    ? {
                        background: `${activeNet.color}07`,
                        borderColor: activeNet.color,
                      }
                    : {
                        background: "rgba(255,255,255,0.02)",
                        borderColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                      }
                }
              />
              {numAmount > 200 && (
                <p className="text-xs font-bold text-red-500 mt-2 px-1">
                  ⚠️ Maximum single airtime purchase is GH₵200.00.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right: Live Preview + Pay */}
        <div className="space-y-4 lg:sticky lg:top-24 h-fit">

          {/* Receipt/summary card */}
          <div
            className="rounded-3xl overflow-hidden transition-all duration-700 bg-card border"
            style={{
              borderColor: isDark ? (canPay ? activeNet.color + "35" : "rgba(255,255,255,0.07)") : (canPay ? activeNet.color + "30" : "rgba(0,0,0,0.08)"),
              background: canPay
                ? (isDark ? `linear-gradient(160deg, ${activeNet.color}0D 0%, rgba(10,10,14,0.97) 100%)` : `linear-gradient(160deg, ${activeNet.color}08 0%, #fff 100%)`)
                : "transparent",
              boxShadow: canPay ? (isDark ? `0 24px 80px ${activeNet.glow}` : `0 24px 60px ${activeNet.color}15`) : "none",
            }}
          >
            {/* Preview header */}
            <div className={cn("p-5 border-b", isDark ? "border-white/[0.05]" : "border-gray-100")}>
              <div className="flex items-center justify-between mb-4">
                <span className={cn("text-[9px] font-bold uppercase tracking-[0.2em]", isDark ? "text-white/25" : "text-gray-400")}>
                  Order Preview
                </span>
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full transition-all duration-700"
                    style={{
                      background: canPay ? activeNet.color : (isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"),
                      boxShadow: canPay ? `0 0 8px ${activeNet.glow}` : "none",
                    }}
                  />
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider transition-all duration-700"
                    style={{ color: canPay ? activeNet.color : (isDark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.3)") }}
                  >
                    {canPay ? "Ready" : "Pending"}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center border", isDark ? "bg-white/[0.05] border-white/[0.08]" : "bg-gray-50 border-gray-200 shadow-sm")}>
                  <ActiveLogo size={36} />
                </div>
                <div>
                  <p className={cn("text-xs font-medium", isDark ? "text-white/35" : "text-gray-500")}>{network} Airtime</p>
                  <p
                    className={cn("text-2xl font-black transition-all duration-300", numAmount > 0 ? (isDark ? "text-white" : "text-gray-900") : (isDark ? "text-white/18" : "text-gray-200"))}
                  >
                    ₵{numAmount > 0 ? numAmount.toFixed(2) : "0.00"}
                  </p>
                </div>
              </div>
            </div>

            {/* Order details */}
            <div className="px-5 py-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className={cn("text-xs", isDark ? "text-white/30" : "text-gray-500")}>To</span>
                <span className={cn("text-sm font-bold", phone ? (isDark ? "text-white" : "text-gray-900") : (isDark ? "text-white/20" : "text-gray-300"))}>
                  {phone || "—"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className={cn("text-xs", isDark ? "text-white/30" : "text-gray-500")}>Network</span>
                <span className="text-sm font-bold" style={{ color: activeNet.color }}>
                  {network}
                </span>
              </div>
              <div
                className="flex justify-between items-center pt-3"
                style={{ borderTop: isDark ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(0,0,0,0.05)" }}
              >
                <span className={cn("text-xs", isDark ? "text-white/30" : "text-gray-500")}>Total</span>
                <span className={cn("text-xl font-black", isDark ? "text-white" : "text-gray-900")}>
                  ₵{numAmount > 0 ? numAmount.toFixed(2) : "0.00"}
                </span>
              </div>
            </div>

            {/* Payment method toggle */}
            <div className="px-5 pb-4 space-y-2.5">
              <p className={cn("text-[9px] font-bold uppercase tracking-[0.2em]", isDark ? "text-white/20" : "text-gray-400")}>Pay With</p>
              <div
                className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl"
                style={{
                  background: isDark ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.03)",
                  border: isDark ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(0,0,0,0.05)",
                }}
              >
                {(["wallet", "paystack"] as PayMethod[]).map((method) => (
                  <button
                    key={method}
                    onClick={() => setPayMethod(method)}
                    className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300"
                    style={
                      payMethod === method
                        ? {
                            background: `${activeNet.color}22`,
                            color: activeNet.color,
                            boxShadow: `0 4px 16px ${activeNet.glow}`,
                          }
                        : { color: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.3)" }
                    }
                  >
                    {method === "wallet" ? (
                      <><Wallet className="w-3.5 h-3.5" /> Wallet</>
                    ) : (
                      <><CreditCard className="w-3.5 h-3.5" /> Card/MoMo</>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="px-5 pb-5 space-y-3">
              <button
                onClick={handlePay}
                disabled={loading || !canPay}
                className="relative w-full h-[54px] rounded-2xl font-black text-[15px] flex items-center justify-center gap-2.5 overflow-hidden transition-all duration-300 group"
                style={
                  canPay
                    ? {
                        background: activeNet.buttonGradient,
                        boxShadow: activeNet.buttonShadow,
                        color: activeNet.buttonTextColor,
                      }
                    : {
                        background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                        border: isDark ? "1px solid rgba(255,255,255,0.07)" : "1px solid rgba(0,0,0,0.07)",
                        color: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.2)",
                        cursor: "not-allowed",
                      }
                }
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Confirm Purchase
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
                  </>
                )}
                {canPay && !loading && (
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-shimmer pointer-events-none" />
                )}
              </button>

              <div className={cn("flex items-center justify-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.15em]", isDark ? "text-white/20" : "text-gray-400")}>
                <ShieldCheck className="w-3 h-3" />
                Secured by Paystack / Wallet API
              </div>
            </div>
          </div>

          {/* Agent perk card */}
          <div
            className="rounded-2xl p-4 space-y-1.5"
            style={{
              background: "linear-gradient(135deg, rgba(251,191,36,0.07) 0%, transparent 100%)",
              border: "1px solid rgba(251,191,36,0.10)",
            }}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
                Agent Perk
              </span>
            </div>
            <p className={cn("text-[11px] leading-relaxed", isDark ? "text-white/35" : "text-gray-600")}>
              Earn cashback on every airtime purchase as a registered agent.
            </p>
          </div>
        </div>
      </div>

      <PaystackMomoCheckout
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        amount={numAmount + calcFee(numAmount)} // Include processing fee for paystack payments
        email={profile?.email || ""}
        recipientPhone={phoneDigits}
        recipientNetwork={network}
        metadata={checkoutMetadata}
        onSuccess={handleCheckoutSuccess}
        onFailure={handleCheckoutFailure}
      />

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        .animate-shimmer { animation: shimmer 2.5s infinite; }
      `}</style>

      {/* ── Success Overlay ── */}
      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-in fade-in duration-500">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-3xl" />
          <div className="relative max-w-sm w-full bg-[#0A0A0C] border border-white/10 rounded-[3rem] p-10 text-center space-y-8 animate-in zoom-in-95 duration-300 shadow-3xl">
            <div className="relative mx-auto w-36 h-36">
              <div className="absolute inset-0 bg-emerald-500 rounded-full blur-3xl opacity-10 animate-pulse" />
              <svg className="w-full h-full drop-shadow-[0_8px_24px_rgba(16,185,129,0.2)] animate-bounce-subtle relative z-10" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="55" y="25" width="90" height="150" rx="16" fill="url(#phoneGradOverlay)" stroke="rgba(255,255,255,0.15)" strokeWidth="2"/>
                <rect x="62" y="32" width="76" height="136" rx="10" fill="#0A0A0C"/>
                <rect x="90" y="35" width="20" height="4" rx="2" fill="rgba(255,255,255,0.2)"/>
                <path d="M 65 100 Q 100 85 135 100" stroke="rgba(16,185,129,0.3)" strokeWidth="2" fill="none"/>
                <path d="M 65 120 Q 100 105 135 120" stroke="rgba(16,185,129,0.15)" strokeWidth="2" fill="none"/>
                <circle cx="100" cy="90" r="32" fill="url(#badgeGradOverlay)" />
                <circle cx="100" cy="90" r="26" fill="#0A0A0C"/>
                <path d="M 90 90 L 97 97 L 112 82" stroke="#10B981" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M 45 60 L 48 65 L 53 66 L 49 70 L 50 75 L 45 72 L 40 75 L 41 70 L 37 66 L 42 65 Z" fill="#ffd43b" opacity="0.8"/>
                <path d="M 155 120 L 157 123 L 161 124 L 158 127 L 159 131 L 155 129 L 151 131 L 152 127 L 149 124 L 153 123 Z" fill="#ff9f1c" opacity="0.8"/>
                <circle cx="145" cy="55" r="4" fill="#0ea5e9"/>
                <circle cx="50" cy="130" r="3" fill="#10B981"/>
                <defs>
                  <linearGradient id="phoneGradOverlay" x1="55" y1="25" x2="145" y2="175" gradientUnits="userSpaceOnUse">
                    <stop stopColor="rgba(255,255,255,0.08)"/>
                    <stop offset="1" stopColor="rgba(255,255,255,0.02)"/>
                  </linearGradient>
                  <linearGradient id="badgeGradOverlay" x1="68" y1="58" x2="132" y2="122" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#10B981"/>
                    <stop offset="1" stopColor="#059669"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            
            <div className="space-y-3">
              <h2 className="text-4xl font-black tracking-tighter text-white uppercase">Sent!</h2>
              <p className="text-white/40 text-sm font-medium leading-relaxed">
                Your airtime has been sent successfully. Your balance has been updated.
              </p>
            </div>
 
            <div className="pt-4">
              <button 
                onClick={() => setShowSuccessOverlay(false)}
                className="w-full bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black py-4 rounded-2xl transition-all uppercase tracking-widest text-xs"
              >
                Continue
              </button>
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
      )}
    </div>
  );
};

export default DashboardBuyAirtime;
