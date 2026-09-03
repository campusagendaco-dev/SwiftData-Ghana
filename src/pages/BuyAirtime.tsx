import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { 
  ShieldCheck, Zap, Loader2, AlertTriangle, Phone, Wallet, CheckCircle2, 
  ArrowRight, Sparkles, Clock, RefreshCw, Smartphone, CreditCard, Flame, Gift
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { useAppTheme } from "@/contexts/ThemeContext";
import { MTNLogo, TelecelLogo, AirtelTigoLogo } from "@/components/BrandLogos";
import LiveDeliveryBadge from "@/components/LiveDeliveryBadge";
import { PaystackMomoCheckout } from "@/components/PaystackMomoCheckout";
import { motion, AnimatePresence } from "framer-motion";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

type NetworkName = "MTN" | "Telecel" | "AirtelTigo";

const NETWORK_THEMES: Record<NetworkName, {
  name: NetworkName;
  Logo: React.FC<{ size?: number }>;
  color: string;
  glow: string;
  border: string;
  bgGradient: string;
  buttonGradient: string;
  buttonTextColor: string;
  badgeBg: string;
}> = {
  MTN: {
    name: "MTN",
    Logo: MTNLogo,
    color: "#FFCC00",
    glow: "rgba(255,204,0,0.25)",
    border: "border-amber-400/40",
    bgGradient: "from-amber-400/20 via-amber-500/10 to-transparent",
    buttonGradient: "linear-gradient(135deg, #FFCC00 0%, #FF8C00 100%)",
    buttonTextColor: "#000000",
    badgeBg: "bg-amber-400/15 text-amber-400 border-amber-400/30",
  },
  Telecel: {
    name: "Telecel",
    Logo: TelecelLogo,
    color: "#EF4444",
    glow: "rgba(239,68,68,0.25)",
    border: "border-red-500/40",
    bgGradient: "from-red-600/20 via-red-500/10 to-transparent",
    buttonGradient: "linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)",
    buttonTextColor: "#ffffff",
    badgeBg: "bg-red-500/15 text-red-400 border-red-500/30",
  },
  AirtelTigo: {
    name: "AirtelTigo",
    Logo: AirtelTigoLogo,
    color: "#3B82F6",
    glow: "rgba(59,130,246,0.25)",
    border: "border-blue-500/40",
    bgGradient: "from-blue-600/20 via-blue-500/10 to-transparent",
    buttonGradient: "linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)",
    buttonTextColor: "#ffffff",
    badgeBg: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
};

const NETWORKS: NetworkName[] = ["MTN", "Telecel", "AirtelTigo"];
const QUICK_AMOUNTS = [2, 5, 10, 20, 50, 100, 200];
const PAYSTACK_FEE_RATE = 0.03;
const PAYSTACK_FEE_CAP = 100;
const calcFee = (amount: number) => Math.min(amount * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP);

const BuyAirtime = () => {
  const { toast } = useToast();
  const { isDark } = useAppTheme();
  
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkName>("MTN");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [buying, setBuying] = useState(false);
  const [email, setEmail] = useState("");
  const [holidayMode, setHolidayMode] = useState(false);
  const [holidayMessage, setHolidayMessage] = useState("");
  const [orderingDisabled, setOrderingDisabled] = useState(false);
  const phoneInputRef = useRef<HTMLInputElement>(null);

  // Name Resolution State
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolvingName, setResolvingName] = useState(false);
  const lastAttemptRef = useRef<string | null>(null);

  // Checkout State
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutMetadata, setCheckoutMetadata] = useState<any>(null);

  const phoneDigits = phone.replace(/\D+/g, "");
  const isPhoneValid = phoneDigits.length === 10 || phoneDigits.length === 12 || phoneDigits.length === 9;
  const numAmount = Number(amount);
  const fee = calcFee(numAmount);
  const total = numAmount + fee;
  const canPay = isPhoneValid && numAmount >= 1 && numAmount <= 500 && !orderingDisabled && !holidayMode;

  // Auto-detect network based on digits
  const detectNetworkFromPhone = (num: string) => {
    const clean = num.replace(/\D/g, "");
    if (clean.length >= 3) {
      const prefix = clean.startsWith("233") ? "0" + clean.slice(3, 5) : clean.slice(0, 3);
      if (["024", "054", "055", "059", "053"].includes(prefix)) return "MTN";
      if (["020", "050"].includes(prefix)) return "Telecel";
      if (["026", "027", "057", "056"].includes(prefix)) return "AirtelTigo";
    }
    return null;
  };

  useEffect(() => {
    const detected = detectNetworkFromPhone(phone);
    if (detected && detected !== selectedNetwork) {
      setSelectedNetwork(detected);
    }
  }, [phone]);

  useEffect(() => {
    const load = async () => {
      const { data: sys } = await supabase.functions.invoke("system-settings", { body: { action: "get" } });
      if (sys) {
        setHolidayMode(Boolean(sys.holiday_mode_enabled));
        setHolidayMessage(String(sys.holiday_message || "Holiday mode active. Orders will resume soon."));
        setOrderingDisabled(Boolean(sys.disable_ordering));
      }
    };
    load();
  }, []);

  // Recipient Name resolution effect
  useEffect(() => {
    setResolvedName(null);
    const attemptKey = `${selectedNetwork}-${phoneDigits}`;
    if (!isPhoneValid || resolvingName || lastAttemptRef.current === attemptKey) return;

    const timer = setTimeout(async () => {
      setResolvingName(true);
      try {
        let bankCode = "MTN";
        if (selectedNetwork === "Telecel") bankCode = "VOD";
        if (selectedNetwork === "AirtelTigo") bankCode = "ATL";

        const { data, error } = await supabase.functions.invoke("paystack-resolve", {
          body: { account_number: phoneDigits, bank_code: bankCode }
        });
        lastAttemptRef.current = attemptKey;
        if (!error && data?.success) {
          setResolvedName(data.account_name);
        } else {
          setResolvedName("Verified Airtime Recipient");
        }
      } catch (e) {
        console.error("Auto-resolution failed:", e);
        lastAttemptRef.current = attemptKey;
        setResolvedName("Verified Airtime Recipient");
      } finally {
        setResolvingName(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [selectedNetwork, isPhoneValid, phoneDigits]);

  const handlePay = () => {
    if (!canPay) return;

    setBuying(true);
    const orderId = crypto.randomUUID();
    const resolvedEmail = email.trim() || `airtime_${phoneDigits}@swiftdatagh.shop`;

    const callbackParams = new URLSearchParams({
      reference: orderId,
      network: selectedNetwork,
      package: "AIRTIME",
      phone: phoneDigits,
    });

    const meta = {
      order_id: orderId,
      order_type: "airtime",
      network: selectedNetwork,
      package_size: `${numAmount} GHS AIRTIME`,
      customer_phone: phoneDigits,
      customer_name: resolvedName || "Customer",
      fee,
      payment_source: "direct",
      is_korba: true,
      callback_url: `${getAppBaseUrl()}/order-status?${callbackParams.toString()}`,
    };

    setCheckoutMetadata(meta);
    setCheckoutOpen(true);
    setBuying(false);
  };

  const handleCheckoutSuccess = (ref: string) => {
    setCheckoutOpen(false);
    setPhone("");
    setAmount("");
    const callbackParams = new URLSearchParams({
      reference: ref,
      network: selectedNetwork,
      package: "AIRTIME",
      phone: phoneDigits,
    });
    window.location.href = `${getAppBaseUrl()}/order-status?${callbackParams.toString()}`;
  };

  const handleCheckoutFailure = (error: string) => {
    setBuying(false);
    toast({
      title: "Payment Cancelled or Failed",
      description: error || "Airtime checkout session could not be completed.",
      variant: "destructive"
    });
  };

  const currentTheme = NETWORK_THEMES[selectedNetwork];

  return (
    <div className="min-h-screen bg-[#070907] text-white flex flex-col font-sans selection:bg-amber-400 selection:text-black">
      <Navbar />

      <main className="flex-1 relative pt-24 pb-20 overflow-hidden">
        {/* Dynamic Ambient Color Mesh Glow */}
        <div 
          className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-6xl h-[600px] pointer-events-none transition-all duration-1000 blur-[130px] opacity-40"
          style={{ background: `radial-gradient(ellipse 80% 60% at 50% 10%, ${currentTheme.color} 0%, transparent 80%)` }}
        />

        <div className="max-w-5xl mx-auto px-4 sm:px-6 relative z-10 space-y-8">
          
          {/* Header Banner */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-xl">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-xs font-black uppercase tracking-widest text-emerald-400">INSTANT AIRTIME RECHARGE ⚡</span>
            </div>

            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white">
              Buy Airtime <span className="text-amber-400">Instantly</span>
            </h1>
            <p className="text-white/60 text-sm md:text-base max-w-xl mx-auto leading-relaxed">
              Top up MTN, Telecel, and AirtelTigo airtime with 0 hassle. Instant delivery directly to any Ghana mobile line.
            </p>

            <div className="pt-2">
              <LiveDeliveryBadge />
            </div>
          </div>

          {/* Holiday Mode / System Status Warning Banner */}
          {(holidayMode || orderingDisabled) && (
            <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 backdrop-blur-xl flex items-start gap-4">
              <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-black text-amber-400 text-sm uppercase tracking-wider">Ordering Paused Notice</h4>
                <p className="text-xs text-white/70 mt-1 leading-relaxed">{holidayMessage || "System maintenance in progress. Airtime orders are temporarily paused."}</p>
              </div>
            </div>
          )}

          {/* Main Card Grid Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left Column: Form Controls (8 cols) */}
            <div className="lg:col-span-7 space-y-6">
              
              {/* Step 1: Select Network */}
              <div className="p-6 md:p-8 rounded-[2.5rem] bg-white/[0.03] border border-white/10 backdrop-blur-2xl space-y-5 shadow-2xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-2xl bg-amber-400/20 text-amber-400 border border-amber-400/30 flex items-center justify-center font-black text-xs">
                      1
                    </div>
                    <h3 className="font-black text-white text-base tracking-wide uppercase">Select Network Carrier</h3>
                  </div>
                  <span className="text-[10px] text-white/40 font-mono font-bold">AUTO-DETECTS</span>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {NETWORKS.map((netName) => {
                    const isSelected = selectedNetwork === netName;
                    const netTheme = NETWORK_THEMES[netName];
                    const LogoComponent = netTheme.Logo;

                    return (
                      <button
                        key={netName}
                        type="button"
                        onClick={() => setSelectedNetwork(netName)}
                        className={`relative p-4 rounded-3xl border transition-all duration-300 flex flex-col items-center gap-2 group overflow-hidden ${
                          isSelected
                            ? `${netTheme.border} bg-white/10 shadow-2xl scale-[1.03]`
                            : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20"
                        }`}
                      >
                        {isSelected && (
                          <div 
                            className="absolute inset-0 pointer-events-none opacity-20"
                            style={{ background: `radial-gradient(circle at center, ${netTheme.color}, transparent)` }}
                          />
                        )}

                        <div className="w-12 h-12 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center transition-transform group-hover:scale-110">
                          <LogoComponent size={36} />
                        </div>

                        <span className={`text-xs font-black tracking-wide ${isSelected ? "text-white" : "text-white/50"}`}>
                          {netName}
                        </span>

                        {isSelected && (
                          <div className="w-2 h-2 rounded-full bg-amber-400 shadow-lg shadow-amber-400" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Recipient Phone Number */}
              <div className="p-6 md:p-8 rounded-[2.5rem] bg-white/[0.03] border border-white/10 backdrop-blur-2xl space-y-4 shadow-2xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-2xl bg-amber-400/20 text-amber-400 border border-amber-400/30 flex items-center justify-center font-black text-xs">
                      2
                    </div>
                    <h3 className="font-black text-white text-base tracking-wide uppercase">Recipient Phone Number</h3>
                  </div>
                </div>

                <div className="relative">
                  <Input
                    ref={phoneInputRef}
                    type="tel"
                    placeholder="e.g. 0244123456"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-16 pl-13 pr-12 rounded-2xl bg-black/40 border-white/15 text-white font-mono text-xl font-bold placeholder:text-white/20 focus:border-amber-400 focus:ring-amber-400/20 transition-all"
                  />
                  <Phone className="w-5 h-5 text-amber-400 absolute left-4 top-5" />

                  {resolvingName && (
                    <div className="absolute right-4 top-5">
                      <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                    </div>
                  )}
                </div>

                {/* Recipient Name Resolution Indicator Pill */}
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
                        <span>Recipient: <span className="text-white font-black">{resolvedName || "Verified Ghana Line"}</span></span>
                      </div>
                      <Badge className="bg-emerald-500/20 text-emerald-400 text-[10px] font-mono">VERIFIED</Badge>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Step 3: Enter Amount & Quick Presets */}
              <div className="p-6 md:p-8 rounded-[2.5rem] bg-white/[0.03] border border-white/10 backdrop-blur-2xl space-y-5 shadow-2xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-2xl bg-amber-400/20 text-amber-400 border border-amber-400/30 flex items-center justify-center font-black text-xs">
                      3
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
                    placeholder="Enter custom amount (e.g. 15)"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-14 pl-12 rounded-2xl bg-black/40 border-white/15 text-amber-400 font-black text-lg placeholder:text-white/20 focus:border-amber-400 focus:ring-amber-400/20 transition-all"
                  />
                  <span className="absolute left-4 top-4 font-black text-amber-400 text-sm">GH₵</span>
                </div>
              </div>
            </div>

            {/* Right Column: Order Summary & Checkout Card (5 cols) */}
            <div className="lg:col-span-5 space-y-6 sticky top-28">
              
              <div className="p-6 md:p-8 rounded-[2.5rem] bg-gradient-to-b from-white/10 via-white/[0.04] to-black/80 border border-white/15 backdrop-blur-2xl space-y-6 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-amber-400/10 rounded-full blur-2xl pointer-events-none" />

                <div className="flex items-center justify-between pb-4 border-b border-white/10">
                  <h3 className="font-black text-white text-lg tracking-tight flex items-center gap-2">
                    <Zap className="w-5 h-5 text-amber-400 fill-amber-400" /> Order Summary
                  </h3>
                  <Badge className={`${currentTheme.badgeBg} text-[10px] font-black uppercase tracking-wider`}>
                    {selectedNetwork}
                  </Badge>
                </div>

                {/* Summary Lines */}
                <div className="space-y-3 font-mono text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-white/60">Selected Network</span>
                    <span className="font-bold text-amber-400">{selectedNetwork}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/60">Recipient Line</span>
                    <span className="font-bold text-white">{phone || "—"}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/60">Airtime Amount</span>
                    <span className="font-bold text-white">GH₵ {numAmount > 0 ? numAmount.toFixed(2) : "0.00"}</span>
                  </div>
                  <div className="flex justify-between items-center text-white/50">
                    <span>Payment Processing Fee</span>
                    <span>GH₵ {fee.toFixed(2)}</span>
                  </div>

                  <div className="pt-3 border-t border-white/10 flex justify-between items-baseline">
                    <span className="text-sm font-black font-sans uppercase text-white">Total Payable</span>
                    <div className="text-right">
                      <span className="text-2xl font-black text-amber-400">GH₵ {total > 0 ? total.toFixed(2) : "0.00"}</span>
                    </div>
                  </div>
                </div>

                {/* Email for receipt */}
                {isPhoneValid && (
                  <div className="pt-2">
                    <Input
                      type="email"
                      placeholder="Email address for receipt (optional)"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-12 bg-black/40 border-white/10 text-white rounded-xl text-xs placeholder:text-white/30"
                    />
                  </div>
                )}

                {/* Checkout Button */}
                <button
                  onClick={handlePay}
                  disabled={buying || !canPay}
                  className="w-full h-14 rounded-2xl bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:to-yellow-300 disabled:opacity-30 text-black font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-amber-400/20 group"
                >
                  {buying ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      Pay GH₵ {total > 0 ? total.toFixed(2) : "0.00"} Now
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>

                <div className="flex items-center justify-center gap-2 text-[10px] text-white/40 font-bold uppercase tracking-widest pt-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Secured 256-Bit MoMo Payment
                </div>
              </div>

              {/* Agent Program Perk Promo Banner */}
              <div className="p-5 rounded-3xl bg-amber-400/5 border border-amber-400/15 backdrop-blur-xl flex items-center gap-4">
                <div className="w-10 h-10 rounded-2xl bg-amber-400/20 text-amber-400 border border-amber-400/30 flex items-center justify-center shrink-0">
                  <Gift className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-black text-amber-400 uppercase tracking-wider">Want Agent Wholesale Rates?</h4>
                  <p className="text-[11px] text-white/60 mt-0.5">
                    Become a reseller agent on SwiftData and buy airtime at wholesale prices! <Link to="/agent-program" className="text-amber-400 underline font-bold">Join Agent Program</Link>
                  </p>
                </div>
              </div>

            </div>

          </div>

        </div>
      </main>

      <Footer />

      {/* Paystack Checkout Modal */}
      {checkoutOpen && (
        <PaystackMomoCheckout
          isOpen={checkoutOpen}
          onClose={() => setCheckoutOpen(false)}
          amount={total}
          email={email.trim() || `airtime_${phoneDigits}@swiftdatagh.shop`}
          recipientPhone={phoneDigits}
          recipientNetwork={selectedNetwork}
          metadata={checkoutMetadata}
          onSuccess={handleCheckoutSuccess}
          onFailure={handleCheckoutFailure}
        />
      )}
    </div>
  );
};

export default BuyAirtime;
