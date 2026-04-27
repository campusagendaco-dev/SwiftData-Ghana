import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Zap, Loader2, AlertTriangle, Phone, Wallet, CheckCircle2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { invokePublicFunction } from "@/lib/public-function-client";
import { useAppTheme } from "@/contexts/ThemeContext";
import { MTNLogo, TelecelLogo, AirtelTigoLogo } from "@/components/BrandLogos";

const NETWORK_GLASS_ACTIVE: Record<string, Record<string, string>> = {
  MTN: {
    background: "linear-gradient(135deg, rgba(251,191,36,0.92) 0%, rgba(245,158,11,0.88) 100%)",
    boxShadow: "0 4px 18px rgba(251,191,36,0.38), inset 0 1px 0 rgba(255,255,255,0.35)",
    color: "#000",
  },
  Telecel: {
    background: "linear-gradient(135deg, rgba(220,38,38,0.9) 0%, rgba(185,28,28,0.86) 100%)",
    boxShadow: "0 4px 18px rgba(220,38,38,0.32), inset 0 1px 0 rgba(255,255,255,0.18)",
    color: "#fff",
  },
  AirtelTigo: {
    background: "linear-gradient(135deg, rgba(37,99,235,0.9) 0%, rgba(29,78,216,0.86) 100%)",
    boxShadow: "0 4px 18px rgba(37,99,235,0.32), inset 0 1px 0 rgba(255,255,255,0.18)",
    color: "#fff",
  },
};

type NetworkName = "MTN" | "Telecel" | "AirtelTigo";
const NETWORKS: NetworkName[] = ["MTN", "Telecel", "AirtelTigo"];
const QUICK_AMOUNTS = [2, 5, 10, 20, 50, 100];
const PAYSTACK_FEE_RATE = 0.03;
const PAYSTACK_FEE_CAP = 100;
const calcFee = (amount: number) => Math.min(amount * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP);

const BuyAirtime = () => {
  const { toast } = useToast();
  const { theme, isDark } = useAppTheme();
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkName>("MTN");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [buying, setBuying] = useState(false);
  const [email, setEmail] = useState("");
  const [holidayMode, setHolidayMode] = useState(false);
  const [holidayMessage, setHolidayMessage] = useState("");
  const [orderingDisabled, setOrderingDisabled] = useState(false);
  const phoneInputRef = useRef<HTMLInputElement>(null);

  const phoneDigits = phone.replace(/\D+/g, "");
  const isPhoneValid = phoneDigits.length === 10 || phoneDigits.length === 12 || phoneDigits.length === 9;
  const numAmount = Number(amount);
  const canPay = isPhoneValid && numAmount >= 1;

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

  const fee = canPay ? calcFee(numAmount) : 0;
  const total = canPay ? parseFloat((numAmount + fee).toFixed(2)) : 0;

  const handlePay = async () => {
    if (!canPay) return;
    if (orderingDisabled) {
      toast({ title: "Ordering disabled", description: holidayMessage, variant: "destructive" });
      return;
    }
    setBuying(true);
    const orderId = crypto.randomUUID();
    const callbackParams = new URLSearchParams({
      reference: orderId,
      network: selectedNetwork,
      package: `${numAmount} Airtime`,
      phone: phoneDigits,
    });

    const { data: paymentData, error: paymentError } = await invokePublicFunction("initialize-payment", {
      body: {
        email: email.trim() || `${phoneDigits}@swiftdata-anon.gh`,
        amount: total,
        reference: orderId,
        callback_url: `${getAppBaseUrl()}/order-status?${callbackParams.toString()}`,
        metadata: {
          order_id: orderId,
          order_type: "airtime",
          network: selectedNetwork,
          package_size: `${numAmount} Airtime`,
          amount: numAmount,
          customer_phone: phoneDigits,
          fee,
          payment_source: "direct",
        },
      },
    });

    if (paymentError || !paymentData?.authorization_url) {
      const description = paymentData?.error || await getFunctionErrorMessage(paymentError, "Could not initialize payment.");
      toast({ title: "Payment failed", description, variant: "destructive" });
      setBuying(false);
      return;
    }
    window.location.href = paymentData.authorization_url;
  };

  const getNetworkLogo = (net: NetworkName) => {
    if (net === "MTN") return <MTNLogo size={44} />;
    if (net === "Telecel") return <TelecelLogo size={44} />;
    return <AirtelTigoLogo size={44} />;
  };

  return (
    <div className="min-h-screen pt-20 transition-all duration-300 pb-24 relative overflow-hidden">
      
      {/* ── Coming Soon Overlay ── */}
      <div className="absolute inset-0 z-[100] flex items-center justify-center p-6 bg-[#030703]/60 backdrop-blur-md">
        <div className="max-w-sm w-full bg-[#0A0A0C] border border-white/10 rounded-[3rem] p-10 text-center space-y-8 shadow-3xl animate-in zoom-in-95 duration-500">
          <div className="relative mx-auto w-24 h-24">
            <div className="absolute inset-0 bg-amber-400 rounded-full blur-2xl opacity-20 animate-pulse" />
            <div className="relative w-full h-full rounded-full bg-amber-400 flex items-center justify-center shadow-[0_0_50px_rgba(251,191,36,0.3)]">
              <Sparkles className="w-12 h-12 text-black" />
            </div>
          </div>
          
          <div className="space-y-3">
            <h2 className="text-4xl font-black tracking-tighter text-white uppercase">Coming Soon</h2>
            <p className="text-white/40 text-sm font-medium leading-relaxed">
              Airtime purchase for guest users is coming soon. In the meantime, you can buy Data Bundles instantly!
            </p>
          </div>

          <div className="pt-4 flex flex-col gap-3">
            <Link 
              to="/buy-data"
              className="w-full bg-amber-400 text-black font-black py-4 rounded-2xl transition-all uppercase tracking-widest text-xs shadow-lg shadow-amber-400/20"
            >
              Buy Data Instead
            </Link>
            <button 
              onClick={() => window.history.back()}
              className="w-full bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black py-4 rounded-2xl transition-all uppercase tracking-widest text-xs"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>

      {/* Hero header */}
      <div className="text-white py-10 px-4 mb-6" style={{ background: theme.heroHex }}>
        <div className="container mx-auto max-w-5xl">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <span className="text-amber-400 text-xs font-semibold uppercase tracking-widest">No Account Needed</span>
          </div>
          <h1 className="font-display text-3xl md:text-5xl font-black mb-2">Buy Airtime Top-up</h1>
          <p className="text-white/60 text-sm md:text-base max-w-lg">
            Send airtime to any network instantly. Enter a number, pick an amount & pay safely.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4 text-xs text-white/45">
            <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-green-400" /> Secured by Paystack</span>
            <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" /> Instant delivery</span>
            <span className="flex items-center gap-1.5">🇬🇭 Supporting all GH Networks</span>
          </div>
        </div>
      </div>

      <div className="container mx-auto max-w-5xl px-4">
        {/* Warning bar */}
        <div
          className="mb-8 rounded-lg px-4 py-2.5 flex items-center gap-2 text-xs font-medium"
          style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "rgb(252,165,165)" }}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          No refunds for wrong numbers &bull;{" "}
          <Link to="/order-status" className="underline underline-offset-2">Track order</Link>
        </div>

        {holidayMode && (
          <div className="mb-8 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-700 dark:text-yellow-300">
            {holidayMessage}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-8">
          {/* Main Form */}
          <div className="space-y-8">
            {/* Network Selector */}
            <div className="space-y-4">
              <h2 className="text-sm font-black uppercase tracking-widest text-white/40">1. Select Network</h2>
              <div
                className="flex gap-2 p-1.5 rounded-2xl"
                style={{
                  background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                  border: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.07)",
                }}
              >
                {NETWORKS.map((n) => {
                  const active = selectedNetwork === n;
                  return (
                    <button
                      key={n}
                      onClick={() => setSelectedNetwork(n)}
                      className="flex-1 flex flex-col items-center gap-2 py-4 rounded-xl transition-all duration-300 relative overflow-hidden"
                      style={
                        active
                          ? NETWORK_GLASS_ACTIVE[n]
                          : {
                              color: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)",
                              background: "transparent",
                            }
                      }
                    >
                      {getNetworkLogo(n)}
                      <span className="text-xs font-black uppercase tracking-tighter">{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Phone Number */}
            <div className="space-y-4">
              <h2 className="text-sm font-black uppercase tracking-widest text-white/40">2. Recipient Number</h2>
              <div className="relative group">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none text-white/20 group-focus-within:text-amber-400 transition-colors">
                  <Phone className="w-5 h-5" />
                </div>
                <input
                  ref={phoneInputRef}
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="024 000 0000"
                  className="w-full h-16 pl-14 pr-14 rounded-2xl text-xl font-bold transition-all duration-300"
                  style={{
                    background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                    border: isPhoneValid ? "2px solid #10B981" : "2px solid rgba(255,255,255,0.08)",
                    color: isDark ? "white" : "black",
                  }}
                />
                {isPhoneValid && (
                  <div className="absolute right-5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  </div>
                )}
              </div>
            </div>

            {/* Amount */}
            <div className="space-y-4">
              <h2 className="text-sm font-black uppercase tracking-widest text-white/40">3. Select Amount</h2>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {QUICK_AMOUNTS.map((q) => (
                  <button
                    key={q}
                    onClick={() => setAmount(String(q))}
                    className="py-3 rounded-xl text-sm font-black transition-all duration-200"
                    style={
                      amount === String(q)
                        ? {
                            background: "rgba(251,191,36,0.15)",
                            border: "1px solid rgba(251,191,36,0.3)",
                            color: "#FBBF24",
                          }
                        : {
                            background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            color: isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.4)",
                          }
                    }
                  >
                    ₵{q}
                  </button>
                ))}
              </div>
              <div className="relative group">
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-3xl font-black pointer-events-none text-white/10 group-focus-within:text-amber-400/50 transition-colors">
                  ₵
                </div>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full h-20 pl-16 pr-6 rounded-2xl text-4xl font-black transition-all duration-300"
                  style={{
                    background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                    border: numAmount > 0 ? "2px solid #FBBF24" : "2px solid rgba(255,255,255,0.08)",
                    color: isDark ? "white" : "black",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Checkout Card */}
          <div className="space-y-4 h-fit sticky top-24">
            <div
              className="rounded-3xl border border-white/10 overflow-hidden"
              style={{ background: isDark ? "rgba(255,255,255,0.01)" : "rgba(0,0,0,0.01)" }}
            >
              <div className="p-6 border-b border-white/5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">Summary</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${canPay ? "bg-amber-400" : "bg-white/10"}`} />
                    <span className="text-[10px] font-black uppercase tracking-wider text-white/30">{canPay ? "Valid" : "Wait"}</span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                    {getNetworkLogo(selectedNetwork)}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-tighter">Top-up Amount</p>
                    <p className="text-3xl font-black">₵{numAmount > 0 ? numAmount.toFixed(2) : "0.00"}</p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-white/30">Network</span>
                    <span className="font-bold text-amber-400">{selectedNetwork}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-white/30">Recipient</span>
                    <span className="font-bold text-white">{phone || "—"}</span>
                  </div>
                  <div className="flex justify-between text-xs pt-3 border-t border-white/5">
                    <span className="text-white/30">Subtotal</span>
                    <span className="font-bold text-white">₵{numAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-white/30">Platform Fee</span>
                    <span className="font-bold text-white">₵{fee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg pt-3 border-t border-white/5 font-black">
                    <span className="text-white/40">Total</span>
                    <span className="text-amber-400">₵{total.toFixed(2)}</span>
                  </div>
                </div>

                {isPhoneValid && (
                  <input
                    type="email"
                    placeholder="Email for receipt (optional)"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-all"
                  />
                )}

                <button
                  onClick={handlePay}
                  disabled={buying || !canPay}
                  className="w-full h-14 rounded-2xl bg-amber-400 hover:bg-amber-300 disabled:opacity-50 disabled:scale-100 text-black font-black flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-amber-400/20 group"
                >
                  {buying ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      Pay ₵{total.toFixed(2)}
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>

                <div className="flex items-center justify-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.15em] text-white/20">
                  <ShieldCheck className="w-3 h-3 text-emerald-500" />
                  Secured by Paystack
                </div>
              </div>
            </div>

            {/* Perks */}
            <div className="p-4 rounded-2xl bg-amber-400/5 border border-amber-400/10 space-y-2">
              <div className="flex items-center gap-2 text-amber-400">
                <Wallet className="w-3.5 h-3.5" />
                <span className="text-[10px] font-black uppercase tracking-widest">Reseller Perk</span>
              </div>
              <p className="text-[10px] text-white/30 leading-relaxed">
                Registered agents get wholesale prices and earn commission on every sale. <Link to="/agent-program" className="text-amber-400 hover:underline">Learn more</Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BuyAirtime;
