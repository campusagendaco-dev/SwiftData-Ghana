import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Zap, Loader2, AlertTriangle, X, CreditCard } from "lucide-react";
import { basePackages, getPublicPrice } from "@/lib/data";
import { getNetworkCardColors } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";
import { invokePublicFunction } from "@/lib/public-function-client";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppTheme } from "@/contexts/ThemeContext";

type NetworkName = "MTN" | "Telecel" | "AirtelTigo";
const NETWORKS: NetworkName[] = ["MTN", "Telecel", "AirtelTigo"];
const PAYSTACK_FEE_RATE = 0.03;
const PAYSTACK_FEE_CAP = 100;
const calcFee = (amount: number) => Math.min(amount * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP);

interface GlobalPkgSetting {
  network: string;
  package_size: string;
  public_price: number | null;
  is_unavailable: boolean;
}

const networkTabStyles: Record<NetworkName, { active: string; idle: string }> = {
  MTN: { active: "bg-amber-400 text-black border-amber-400", idle: "border-border hover:border-amber-400/50" },
  Telecel: { active: "bg-red-600 text-white border-red-600", idle: "border-border hover:border-red-400/50" },
  AirtelTigo: { active: "bg-blue-600 text-white border-blue-600", idle: "border-border hover:border-blue-400/50" },
};

const BuyData = () => {
  const { toast } = useToast();
  const { theme } = useAppTheme();
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkName>("MTN");
  const [selectedPkg, setSelectedPkg] = useState<{ size: string; price: number } | null>(null);
  const [phone, setPhone] = useState("");
  const [buying, setBuying] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<Record<string, GlobalPkgSetting>>({});
  const [pkgLoading, setPkgLoading] = useState(true);
  const [holidayMode, setHolidayMode] = useState(false);
  const [holidayMessage, setHolidayMessage] = useState("");
  const [orderingDisabled, setOrderingDisabled] = useState(false);
  const [priceMultiplier, setPriceMultiplier] = useState(1);
  const phoneInputRef = useRef<HTMLInputElement>(null);

  const phoneDigits = phone.replace(/\D+/g, "");
  const isPhoneValid = phoneDigits.length === 10 || phoneDigits.length === 12 || phoneDigits.length === 9;

  useEffect(() => {
    const load = async () => {
      setPkgLoading(true);
      const [{ data }, { data: sys }, pricingCtx] = await Promise.all([
        supabase.from("global_package_settings").select("network, package_size, public_price, is_unavailable"),
        supabase.functions.invoke("system-settings", { body: { action: "get" } }),
        fetchApiPricingContext(),
      ]);
      const map: Record<string, GlobalPkgSetting> = {};
      (data || []).forEach((r: any) => { map[`${r.network}-${r.package_size}`] = r; });
      setGlobalSettings(map);
      if (sys) {
        setHolidayMode(Boolean(sys.holiday_mode_enabled));
        setHolidayMessage(String(sys.holiday_message || "Holiday mode active. Orders will resume soon."));
        setOrderingDisabled(Boolean(sys.disable_ordering));
      }
      setPriceMultiplier(pricingCtx.multiplier);
      setPkgLoading(false);
    };
    load();
  }, []);

  useEffect(() => { setSelectedPkg(null); setPhone(""); }, [selectedNetwork]);

  const packages = (basePackages[selectedNetwork] || [])
    .map((pkg) => {
      const gs = globalSettings[`${selectedNetwork}-${pkg.size}`];
      if (gs?.is_unavailable) return null;
      const base = gs?.public_price ?? getPublicPrice(pkg.price);
      return { ...pkg, price: applyPriceMultiplier(base, priceMultiplier) };
    })
    .filter(Boolean) as { size: string; price: number; validity: string; popular?: boolean }[];

  const fee = selectedPkg ? calcFee(selectedPkg.price) : 0;
  const total = selectedPkg ? parseFloat((selectedPkg.price + fee).toFixed(2)) : 0;

  const handleCardClick = useCallback((size: string, price: number) => {
    setSelectedPkg((prev) => (prev?.size === size ? null : { size, price }));
    setTimeout(() => phoneInputRef.current?.focus(), 120);
  }, []);

  const handlePay = async () => {
    if (!selectedPkg) return;
    if (!isPhoneValid) {
      toast({ title: "Enter a valid phone number first", variant: "destructive" });
      phoneInputRef.current?.focus();
      return;
    }
    if (orderingDisabled) {
      toast({ title: "Ordering disabled", description: holidayMessage, variant: "destructive" });
      return;
    }
    setBuying(true);
    const orderId = crypto.randomUUID();
    const callbackParams = new URLSearchParams({
      reference: orderId,
      network: selectedNetwork,
      package: selectedPkg.size,
      phone: phoneDigits,
    });

    const { data: paymentData, error: paymentError } = await invokePublicFunction("initialize-payment", {
      body: {
        email: `${phoneDigits}@customer.swiftdata.gh`,
        amount: total,
        reference: orderId,
        callback_url: `${getAppBaseUrl()}/order-status?${callbackParams.toString()}`,
        metadata: {
          order_id: orderId,
          order_type: "data",
          network: selectedNetwork,
          package_size: selectedPkg.size,
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

  const colors = getNetworkCardColors(selectedNetwork);

  return (
    <div className={`min-h-screen pt-20 transition-all duration-300 ${selectedPkg ? "pb-44" : "pb-24 sm:pb-20"}`}>
      {/* Hero header */}
      <div className="text-white py-10 px-4 mb-6" style={{ background: theme.heroHex }}>
        <div className="container mx-auto max-w-5xl">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <span className="text-amber-400 text-xs font-semibold uppercase tracking-widest">No Account Needed</span>
          </div>
          <h1 className="font-display text-3xl md:text-5xl font-black mb-2">Buy Data Bundles</h1>
          <p className="text-white/60 text-sm md:text-base max-w-lg">
            Pick a network, tap a bundle &amp; pay instantly with card or mobile money.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4 text-xs text-white/45">
            <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-green-400" /> Secured by Paystack</span>
            <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" /> Instant delivery</span>
            <span className="flex items-center gap-1.5">📦 Non-expiry bundles</span>
          </div>
        </div>
      </div>

      <div className="container mx-auto max-w-5xl px-4">
        {/* Warning bar */}
        <div
          className="mb-5 rounded-lg px-4 py-2.5 flex items-center gap-2 text-xs font-medium"
          style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "rgb(252,165,165)" }}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Delivery times vary &bull; No refunds for wrong numbers &bull;{" "}
          <Link to="/order-status" className="underline underline-offset-2">Track order</Link>
        </div>

        {holidayMode && (
          <div className="mb-5 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-700 dark:text-yellow-300">
            {holidayMessage}
          </div>
        )}

        {/* Network tabs */}
        <div className="flex gap-2 sm:gap-3 mb-5 sm:mb-6">
          {NETWORKS.map((n) => (
            <button
              key={n}
              onClick={() => setSelectedNetwork(n)}
              className={`flex-1 py-3 sm:py-3.5 rounded-xl border-2 text-sm font-bold transition-all ${
                selectedNetwork === n ? networkTabStyles[n].active : networkTabStyles[n].idle
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Package grid */}
        {pkgLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[140px] rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {packages.map((pkg) => {
              const isSelected = selectedPkg?.size === pkg.size;
              return (
                <button
                  key={pkg.size}
                  onClick={() => handleCardClick(pkg.size, pkg.price)}
                  className={`${colors.card} rounded-2xl p-4 sm:p-5 flex flex-col gap-2.5 border-2 text-left transition-all duration-200 relative ${
                    isSelected
                      ? "border-white/80 shadow-2xl scale-[1.04]"
                      : "border-transparent hover:border-white/30 hover:scale-[1.02]"
                  }`}
                >
                  {/* Selected indicator */}
                  {isSelected && (
                    <span className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white flex items-center justify-center shadow">
                      <span className="w-2.5 h-2.5 rounded-full bg-black" />
                    </span>
                  )}
                  {pkg.popular && !isSelected && (
                    <span className="absolute top-2 right-2 text-[9px] font-black bg-black/25 text-white px-1.5 py-0.5 rounded">
                      HOT
                    </span>
                  )}
                  <span className={`${colors.label} text-[11px] font-bold uppercase tracking-wide`}>{selectedNetwork}</span>
                  <p className={`${colors.size} text-3xl sm:text-4xl font-black leading-none`}>{pkg.size}</p>
                  <div className="flex items-end justify-between mt-auto pt-1">
                    <p className={`${colors.size} text-sm sm:text-base font-black`}>₵{pkg.price.toFixed(2)}</p>
                    <p className={`${colors.label} text-[10px] font-medium`}>No Expiry</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Footer promo */}
        <div className="mt-10 rounded-2xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p className="font-semibold text-sm mb-0.5">Want cheaper bundle prices?</p>
            <p className="text-muted-foreground text-xs">Agents unlock wholesale rates + their own Paystack-powered store.</p>
          </div>
          <Link
            to="/login"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Sign in or create account
          </Link>
        </div>
      </div>

      {/* ── Sticky Purchase Bar ── */}
      {selectedPkg && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10"
          style={{
            background: "rgba(8, 8, 18, 0.97)",
            backdropFilter: "blur(28px)",
            WebkitBackdropFilter: "blur(28px)",
          }}
        >
          <div className="container mx-auto max-w-5xl px-4 pt-3 pb-4 sm:pb-5">
            {/* Package summary + dismiss */}
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white font-black text-base">{selectedNetwork} {selectedPkg.size}</span>
                <span className="text-white/30">·</span>
                <span className="text-white/55 text-xs">
                  GH₵ {selectedPkg.price.toFixed(2)} + GH₵ {fee.toFixed(2)} Paystack fee
                </span>
                <span className="text-white/30">·</span>
                <span className="font-bold text-sm" style={{ color: `hsl(${theme.primary})` }}>
                  Total GH₵ {total.toFixed(2)}
                </span>
              </div>
              <button
                onClick={() => { setSelectedPkg(null); setPhone(""); }}
                className="text-white/35 hover:text-white/80 transition-colors p-1.5 rounded-lg hover:bg-white/10 ml-2 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Phone + Pay row */}
            <div className="flex gap-2 sm:gap-3">
              <input
                ref={phoneInputRef}
                type="tel"
                inputMode="numeric"
                placeholder="Recipient number (0XXXXXXXXX)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={12}
                className="flex-1 min-w-0 border border-white/15 rounded-xl px-4 py-3 text-white placeholder-white/30 text-sm focus:outline-none focus:border-white/45 transition-colors"
                style={{ background: "rgba(255,255,255,0.07)" }}
              />
              <button
                onClick={handlePay}
                disabled={buying}
                className="shrink-0 font-black px-5 py-3 rounded-xl text-sm transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center gap-1.5 whitespace-nowrap"
                style={{ background: `hsl(${theme.primary})`, color: "#000" }}
              >
                {buying ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing...</>
                ) : (
                  <><CreditCard className="w-3.5 h-3.5" /> Pay GH₵ {total.toFixed(2)}</>
                )}
              </button>
            </div>

            {/* Validation hint */}
            {phone.length > 0 && !isPhoneValid ? (
              <p className="text-xs text-red-400 mt-1.5">Enter a valid 10-digit Ghana number</p>
            ) : phone.length === 0 ? (
              <p className="text-[11px] text-white/35 mt-1.5">Enter the recipient's phone number then tap Pay</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default BuyData;
