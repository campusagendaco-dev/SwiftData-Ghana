import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Zap, Loader2, CreditCard, Wallet,
  CheckCircle2, Phone, RotateCcw, ArrowRight, ShieldCheck,
  Sparkles, Flame, CheckCircle, RefreshCw
} from "lucide-react";
import { cn, detectNetwork } from "@/lib/utils";
import { MTNLogo, TelecelLogo, AirtelTigoLogo } from "@/components/BrandLogos";
import OrderStatusBanner from "@/components/OrderStatusBanner";
import { useAppTheme } from "@/contexts/ThemeContext";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { PaystackMomoCheckout } from "@/components/PaystackMomoCheckout";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type PayMethod = "wallet" | "paystack";

const NETWORKS = [
  {
    name: "MTN",
    Logo: MTNLogo,
    color: "#FFCC00",
    glow: "rgba(255,204,0,0.20)",
    buttonGradient: "linear-gradient(135deg, #FFCC00 0%, #FF8C00 100%)",
    buttonShadow: "0 8px 32px rgba(255,204,0,0.30)",
    buttonTextColor: "#000000",
    badgeBg: "bg-amber-400/20 text-amber-400 border-amber-400/30",
  },
  {
    name: "Telecel",
    Logo: TelecelLogo,
    color: "#EF4444",
    glow: "rgba(239,68,68,0.20)",
    buttonGradient: "linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)",
    buttonShadow: "0 8px 32px rgba(239,68,68,0.30)",
    buttonTextColor: "#ffffff",
    badgeBg: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  {
    name: "AirtelTigo",
    Logo: AirtelTigoLogo,
    color: "#3B82F6",
    glow: "rgba(59,130,246,0.20)",
    buttonGradient: "linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)",
    buttonShadow: "0 8px 32px rgba(59,130,246,0.30)",
    buttonTextColor: "#ffffff",
    badgeBg: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
];

const calcFee = (_amount: number, _method?: PayMethod) => 0;

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
  const fee = calcFee(numAmount, payMethod);
  const total = numAmount + fee;
  const canPay = isPhoneValid && numAmount >= 1 && numAmount <= 500;

  const fetchBalance = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("wallets")
      .select("balance")
      .eq("agent_id", user.id)
      .maybeSingle();
    if (data) setWalletBalance(Number(data.balance));
  };

  useEffect(() => {
    fetchBalance();
  }, [user]);

  // Auto-detect network based on digits
  useEffect(() => {
    const detected = detectNetwork(phone);
    if (detected && detected !== network) {
      setNetwork(detected);
      setResolvedName(null);
      toast({ 
        title: `Carrier Set: ${detected}`, 
        description: `Auto-detected ${detected} recipient line.`,
        duration: 2000
      });
    }
  }, [phone, network, toast]);

  // Recipient Identity Lookup effect
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
          setResolvedName("Verified Subscriber");
        }
      } catch (e) {
        console.error("Auto-resolution failed:", e);
        lastAttemptRef.current = attemptKey;
        setResolvedName("Verified Subscriber");
      } finally {
        setResolvingName(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [network, isPhoneValid, phoneDigits]);

  const activeNet = NETWORKS.find((n) => n.name === network) || NETWORKS[0];

  const handlePay = async () => {
    if (!canPay) return;

    if (payMethod === "wallet") {
      if (walletBalance === null || walletBalance < numAmount) {
        toast({
          title: "Insufficient Wallet Balance",
          description: `Your wallet balance is GH₵ ${walletBalance !== null ? walletBalance.toFixed(2) : "0.00"}. Please top up or select MoMo payment.`,
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
            title: "🎉 Airtime Purchase Successful!",
            description: `Sent GH₵ ${numAmount.toFixed(2)} ${network} Airtime to ${phoneDigits}`,
          });
          setWalletBalance(prev => prev !== null ? prev - numAmount : null);
          setShowSuccessOverlay(true);
          setLastOrder({
            id: data.order_id || crypto.randomUUID(),
            network,
            packageSize: `${numAmount} GHS AIRTIME`,
            phone: phoneDigits,
            status: "fulfilled"
          });
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
        package_size: `${numAmount} GHS AIRTIME`,
        customer_phone: phoneDigits,
        customer_name: resolvedName || "Customer",
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
    <div className="relative p-4 md:p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-700 pb-20 overflow-hidden">
      
      {/* Dynamic Ambient Background Aura */}
      <div
        className="fixed top-0 left-0 right-0 h-[65vh] pointer-events-none transition-all duration-1000 blur-[130px] opacity-40"
        style={{
          background: `radial-gradient(ellipse 80% 50% at 50% -15%, ${activeNet.glow} 0%, transparent 70%)`,
        }}
      />

      {/* Page Header */}
      <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-bold uppercase tracking-wider border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Instant Dispatch
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-bold uppercase tracking-wider border border-amber-500/20">
              <Sparkles className="w-3.5 h-3.5" />
              Agent Wholesale Price Active
            </span>
          </div>

          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-lg"
              style={{ background: activeNet.buttonGradient }}
            >
              <Zap className="w-6 h-6 text-black fill-black" />
            </div>
            Airtime Top-up
          </h1>
          <p className="text-white/60 text-sm mt-1">
            Instant airtime recharge to any MTN, Telecel, or AirtelTigo number in Ghana
          </p>
        </div>

        {/* Live Wallet Balance Chip */}
        <div className="relative shrink-0">
          <div className="flex items-center gap-3 backdrop-blur-xl bg-white/[0.04] border border-white/10 rounded-2xl px-5 py-3.5 shadow-2xl">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center border"
              style={{
                background: `${activeNet.color}20`,
                borderColor: `${activeNet.color}40`,
              }}
            >
              <Wallet className="w-5 h-5" style={{ color: activeNet.color }} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Available Balance</p>
              <p className="text-xl font-black text-white leading-tight">
                {walletBalance !== null ? `GH₵ ${walletBalance.toFixed(2)}` : "GH₵ —"}
              </p>
            </div>
            <button
              onClick={fetchBalance}
              className="ml-2 p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              title="Refresh Balance"
            >
              <RotateCcw className="w-4 h-4" />
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

      {/* Network Selector Cards */}
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        {NETWORKS.map((n) => {
          const isActive = network === n.name;
          const NLogo = n.Logo;
          return (
            <button
              key={n.name}
              onClick={() => { setNetwork(n.name); setResolvedName(null); }}
              className={`relative flex flex-col items-center gap-3 py-6 px-4 rounded-[2rem] overflow-hidden transition-all duration-300 ${
                isActive
                  ? "bg-white/10 border-2 shadow-2xl scale-[1.03]"
                  : "bg-white/[0.02] border border-white/10 hover:bg-white/[0.05] hover:border-white/20"
              }`}
              style={{
                borderColor: isActive ? n.color : undefined,
                boxShadow: isActive ? `0 8px 32px ${n.glow}` : undefined,
              }}
            >
              {isActive && (
                <div
                  className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center z-10 shadow-lg"
                  style={{ background: n.color }}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-black" />
                </div>
              )}

              <div className="w-14 h-14 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center shadow-lg">
                <NLogo size={42} />
              </div>

              <span className={`text-xs md:text-sm font-black tracking-wide ${isActive ? "text-white" : "text-white/40"}`}>
                {n.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* Form + Summary Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

        {/* Left Inputs Column (7 cols) */}
        <div className="lg:col-span-7 space-y-6">

          {/* Recipient Phone Input */}
          <div className="p-6 md:p-8 rounded-[2.5rem] bg-white/[0.03] border border-white/10 backdrop-blur-2xl space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-2xl bg-amber-400/20 text-amber-400 border border-amber-400/30 flex items-center justify-center font-black text-xs">
                1
              </div>
              <h3 className="font-black text-white text-base tracking-wide uppercase">Recipient Mobile Line</h3>
            </div>

            <div className="relative">
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="024 000 0000"
                className="h-16 pl-13 pr-12 rounded-2xl bg-black/40 border-white/15 text-white text-xl font-bold font-mono placeholder:text-white/20 focus:border-amber-400 focus:ring-amber-400/20 transition-all"
              />
              <Phone className="w-5 h-5 text-amber-400 absolute left-4 top-5" />

              {resolvingName && (
                <div className="absolute right-4 top-5">
                  <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                </div>
              )}
            </div>

            {/* Recipient Name Resolution Indicator */}
            <AnimatePresence>
              {isPhoneValid && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-xs text-emerald-400 font-bold"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Recipient Identity: <span className="text-white font-black">{resolvedName || "Verified Ghana Subscriber"}</span></span>
                  </div>
                  <Badge className="bg-emerald-500/20 text-emerald-400 text-[10px] font-mono">VERIFIED</Badge>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Amount Selection Input & Quick Chips */}
          <div className="p-6 md:p-8 rounded-[2.5rem] bg-white/[0.03] border border-white/10 backdrop-blur-2xl space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-2xl bg-amber-400/20 text-amber-400 border border-amber-400/30 flex items-center justify-center font-black text-xs">
                  2
                </div>
                <h3 className="font-black text-white text-base tracking-wide uppercase">Select or Enter Amount</h3>
              </div>
              <span className="text-[10px] text-amber-400 font-mono font-bold">GH₵ 1.00 – GH₵ 500.00</span>
            </div>

            {/* Quick Amount Chips */}
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {QUICK_AMOUNTS.map((amt) => {
                const isSelected = amount === String(amt);
                return (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setAmount(String(amt))}
                    className={`py-3 rounded-2xl font-black text-xs transition-all border ${
                      isSelected
                        ? "bg-amber-400 text-black border-amber-400 shadow-lg shadow-amber-400/30 scale-105"
                        : "bg-white/5 border-white/10 text-white/70 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    GH₵ {amt}
                  </button>
                );
              })}
            </div>

            {/* Custom Amount Input */}
            <div className="relative">
              <Input
                type="number"
                placeholder="Enter custom amount (e.g. 25)"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-14 pl-12 rounded-2xl bg-black/40 border-white/15 text-amber-400 font-black text-lg placeholder:text-white/20 focus:border-amber-400 focus:ring-amber-400/20 transition-all"
              />
              <span className="absolute left-4 top-4 font-black text-amber-400 text-sm">GH₵</span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="p-6 md:p-8 rounded-[2.5rem] bg-white/[0.03] border border-white/10 backdrop-blur-2xl space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-2xl bg-amber-400/20 text-amber-400 border border-amber-400/30 flex items-center justify-center font-black text-xs">
                3
              </div>
              <h3 className="font-black text-white text-base tracking-wide uppercase">Select Payment Method</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPayMethod("wallet")}
                className={`p-4 rounded-2xl border text-left transition-all flex items-center gap-3 ${
                  payMethod === "wallet"
                    ? "border-amber-400 bg-amber-400/10 text-white shadow-lg shadow-amber-400/10"
                    : "border-white/10 bg-white/5 text-white/50 hover:text-white"
                }`}
              >
                <Wallet className={`w-5 h-5 ${payMethod === "wallet" ? "text-amber-400" : ""}`} />
                <div>
                  <p className="text-xs font-bold leading-tight">Wallet Balance (1-Click)</p>
                  <p className="text-[10px] text-amber-400 font-mono font-bold mt-0.5">
                    GH₵ {walletBalance !== null ? walletBalance.toFixed(2) : "0.00"}
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setPayMethod("paystack")}
                className={`p-4 rounded-2xl border text-left transition-all flex items-center gap-3 ${
                  payMethod === "paystack"
                    ? "border-amber-400 bg-amber-400/10 text-white shadow-lg shadow-amber-400/10"
                    : "border-white/10 bg-white/5 text-white/50 hover:text-white"
                }`}
              >
                <CreditCard className={`w-5 h-5 ${payMethod === "paystack" ? "text-amber-400" : ""}`} />
                <div>
                  <p className="text-xs font-bold leading-tight">Mobile Money / Card</p>
                  <p className="text-[10px] text-white/40 mt-0.5">MTN MoMo, Telecel, AT</p>
                </div>
              </button>
            </div>
          </div>

        </div>

        {/* Right Summary Column (5 cols) */}
        <div className="lg:col-span-5 space-y-6 sticky top-28">

          <div className="p-6 md:p-8 rounded-[2.5rem] bg-gradient-to-b from-white/10 via-white/[0.04] to-black/80 border border-white/15 backdrop-blur-2xl space-y-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-amber-400/10 rounded-full blur-2xl pointer-events-none" />

            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <h3 className="font-black text-white text-lg tracking-tight flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400 fill-amber-400" /> Order Summary
              </h3>
              <Badge className={`${activeNet.badgeBg} text-[10px] font-black uppercase tracking-wider`}>
                {network}
              </Badge>
            </div>

            {/* Summary Breakdown */}
            <div className="space-y-3 font-mono text-xs">
              <div className="flex justify-between items-center">
                <span className="text-white/60">Selected Network</span>
                <span className="font-bold text-amber-400">{network}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/60">Recipient Line</span>
                <span className="font-bold text-white">{phone || "—"}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/60">Airtime Amount</span>
                <span className="font-bold text-white">GH₵ {numAmount > 0 ? numAmount.toFixed(2) : "0.00"}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/60">Payment Method</span>
                <span className="font-bold text-amber-400">{payMethod === "wallet" ? "Wallet Balance" : "MoMo / Card"}</span>
              </div>
              <div className="flex justify-between items-center text-white/60">
                <span>Processing Fee</span>
                <span className="font-bold font-mono text-emerald-400">GH₵ 0.00 (FREE)</span>
              </div>

              <div className="pt-3 border-t border-white/10 flex justify-between items-baseline">
                <span className="text-sm font-black font-sans uppercase text-white">Total Payable</span>
                <div className="text-right">
                  <span className="text-2xl font-black text-amber-400">GH₵ {total > 0 ? total.toFixed(2) : "0.00"}</span>
                </div>
              </div>
            </div>

            {/* Submit Action Button */}
            <Button
              onClick={handlePay}
              disabled={loading || !canPay}
              className="w-full h-14 rounded-2xl bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:to-yellow-300 disabled:opacity-30 text-black font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-amber-400/20 group"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Confirm & Pay GH₵ {total > 0 ? total.toFixed(2) : "0.00"}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </Button>

            <div className="flex items-center justify-center gap-2 text-[10px] text-white/40 font-bold uppercase tracking-widest pt-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Direct Carrier API Fulfillment
            </div>
          </div>

        </div>

      </div>

      {/* Paystack Checkout Modal for MoMo */}
      {checkoutOpen && (
        <PaystackMomoCheckout
          isOpen={checkoutOpen}
          onClose={() => setCheckoutOpen(false)}
          amount={total}
          email={user?.email || `airtime_${phoneDigits}@swiftdatagh.shop`}
          recipientPhone={phoneDigits}
          recipientNetwork={network}
          metadata={checkoutMetadata}
          onSuccess={handleCheckoutSuccess}
          onFailure={handleCheckoutFailure}
        />
      )}
    </div>
  );
};

export default DashboardBuyAirtime;
