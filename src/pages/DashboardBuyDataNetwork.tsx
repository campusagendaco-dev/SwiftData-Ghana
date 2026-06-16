import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { invokePublicFunction, invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, Loader2, CreditCard, X, RefreshCw, ArrowRight, Tag, CheckCircle2, Gift, Users2, ShieldCheck, WifiOff, Zap } from "lucide-react";
import { basePackages, getPublicPrice } from "@/lib/data";
import { getNetworkCardColors, detectNetwork } from "@/lib/utils";
import OrderStatusBanner from "@/components/OrderStatusBanner";
import { OfflineQueueWidget } from "@/components/OfflineQueueWidget";
import { playSuccessSound } from "@/lib/sound";
import { PaystackMomoCheckout } from "@/components/PaystackMomoCheckout";
import LastMtnOrderWidget from "@/components/LastMtnOrderWidget";

type NetworkName = "MTN" | "MTN Mash Up" | "Telecel" | "AirtelTigo";
type PayMethod = "wallet" | "paystack";

interface PromoResult {
  valid: boolean;
  promo_id?: string;
  code?: string;
  discount_percentage?: number;
  is_free?: boolean;
  error?: string;
}

const NETWORKS: NetworkName[] = ["MTN", "MTN Mash Up", "Telecel", "AirtelTigo"];

const networkRouteMap: Record<NetworkName, string> = {
  MTN: "mtn",
  "MTN Mash Up": "mtn-mash-up",
  Telecel: "telecel",
  AirtelTigo: "airteltigo",
};

const networkTabStyles: Record<NetworkName, { active: string; idle: string }> = {
  MTN: { active: "bg-amber-400 text-black border-amber-400", idle: "border-border hover:border-amber-400/50" },
  "MTN Mash Up": { active: "bg-amber-500 text-black border-amber-500", idle: "border-border hover:border-amber-500/50" },
  Telecel: { active: "bg-red-600 text-white border-red-600", idle: "border-border hover:border-red-400/50" },
  AirtelTigo: { active: "bg-blue-600 text-white border-blue-600", idle: "border-border hover:border-blue-400/50" },
};

const PAYSTACK_FEE_RATE = 0.03;
const PAYSTACK_FEE_CAP = 100;
const calcPaystackFee = (amount: number) => Math.min(amount * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP);

interface GlobalPackageSetting {
  network: string;
  package_size: string;
  public_price: number | null;
  agent_price: number | null;
  sub_agent_price: number | null;
  is_unavailable: boolean;
}

const normalizePackageSize = (size: string) => size.replace(/\s+/g, "").toUpperCase();

const getAssignedSubAgentPrice = (
  assignedMap: Record<string, Record<string, string | number>> | undefined,
  network: string,
  size: string,
): number | null => {
  if (!assignedMap || typeof assignedMap !== "object") return null;
  const networkCandidates = [network, network.replace(/\s+/g, ""), network === "AT iShare" ? "AirtelTigo" : network];
  const sizeCandidates = [size, size.replace(/\s+/g, ""), size.toUpperCase()];
  for (const n of networkCandidates) {
    const byNetwork = assignedMap[n];
    if (!byNetwork) continue;
    for (const s of sizeCandidates) {
      const value = Number(byNetwork[s]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
};

interface DashboardBuyDataNetworkProps {
  network: NetworkName;
}

const DashboardBuyDataNetwork = ({ network }: DashboardBuyDataNetworkProps) => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [selectedSize, setSelectedSize] = useState("");
  const [phone, setPhone] = useState("");
  const [payMethod, setPayMethod] = useState<PayMethod>("wallet");
  const [buying, setBuying] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<GlobalPackageSetting[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [parentAssignedPrices, setParentAssignedPrices] = useState<Record<string, Record<string, string | number>>>({});
  const [priceMultiplier, setPriceMultiplier] = useState(1);
  const [lastOrder, setLastOrder] = useState<{
    id: string; network: string; packageSize: string; phone: string; status: string;
  } | null>(null);

  // Promo code state
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoValidating, setPromoValidating] = useState(false);
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
  const [claimingFree, setClaimingFree] = useState(false);
  const [savedCustomers, setSavedCustomers] = useState<any[]>([]);
  const [showCustomers, setShowCustomers] = useState(false);
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolvingName, setResolvingName] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutMetadata, setCheckoutMetadata] = useState<any>(null);
  const [activationFee, setActivationFee] = useState(50);

  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);

  const normalizedPhone = useMemo(() => phone.replace(/\D+/g, ""), [phone]);
  const isPhoneValid = useMemo(() => 
    normalizedPhone.length === 10 || normalizedPhone.length === 12 || normalizedPhone.length === 9,
  [normalizedPhone]);

  // Restore phone from navigation state if it exists (for auto-network switching)
  useEffect(() => {
    const navState = window.history.state?.usr;
    if (navState?.phone && !phone) {
      setPhone(navState.phone);
    }
  }, [phone]);

  // Auto-detect network and switch tabs
  useEffect(() => {
    const detected = detectNetwork(phone);
    if (detected) {
      const isMtnMashupCompatible = detected === "MTN" && network === "MTN Mash Up";
      if (detected !== network && !isMtnMashupCompatible) {
        const route = networkRouteMap[detected];
        navigate(`/dashboard/buy-data/${route}`, { 
          replace: true, 
          state: { phone } 
        });
        toast({ 
          title: `Switched to ${detected}`, 
          description: `We detected an ${detected} number and updated the bundles for you.`,
          duration: 2000
        });
      }
    }
  }, [phone, network, navigate, toast]);

  useEffect(() => {
    const loadPricing = async () => {
      const [settingsRes, pricingContext] = await Promise.all([
        supabase.from("global_package_settings").select("network, package_size, public_price, agent_price, sub_agent_price, is_unavailable"),
        fetchApiPricingContext(),
      ]);
      setGlobalSettings((settingsRes.data || []) as GlobalPackageSetting[]);
      setPriceMultiplier(pricingContext.multipliers[network] || 1);
      setSettingsLoading(false);

      if (profile?.is_sub_agent && profile?.parent_agent_id) {
        const { data: parentProfile } = await supabase
          .from("profiles")
          .select("sub_agent_prices")
          .eq("user_id", profile.parent_agent_id)
          .maybeSingle();
        setParentAssignedPrices((parentProfile?.sub_agent_prices || {}) as Record<string, Record<string, string | number>>);
      }

      if (user) {
        const { data } = await supabase.from("saved_customers").select("*").order("name");
        setSavedCustomers(data || []);
      }
    };
    void loadPricing();

    supabase
      .from("system_settings")
      .select("agent_activation_fee")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.agent_activation_fee) {
          setActivationFee(Number(data.agent_activation_fee));
        }
      });
  }, [profile?.is_sub_agent, profile?.parent_agent_id, user]);

  const packages = useMemo(() => {
    const list = [...(basePackages[network] || [])];
    const baseSizes = new Set(list.map(pkg => normalizePackageSize(pkg.size)));

    globalSettings.forEach((gs) => {
      if (gs.network === network) {
        const normSize = normalizePackageSize(gs.package_size);
        if (!baseSizes.has(normSize)) {
          list.push({
            size: gs.package_size,
            price: gs.agent_price || gs.public_price || 0,
            validity: network.includes("Mash Up") ? "MTN Mash Up" : "Non-expiry"
          });
        }
      }
    });

    const mapped = list
      .map((item) => {
        const setting = globalSettings.find(
          (s) => s.network === network && normalizePackageSize(s.package_size) === normalizePackageSize(item.size),
        );
        const assignedFromParent = getAssignedSubAgentPrice(parentAssignedPrices, network, item.size);
        const assignedFromProfile = getAssignedSubAgentPrice(
          profile?.agent_prices as Record<string, Record<string, string | number>> | undefined,
          network,
          item.size,
        );
        const assignedPrice = assignedFromParent || assignedFromProfile;
        const basePublic = Number(setting?.public_price);
        const baseAgent = Number(setting?.agent_price);

        const resolvedBasePrice = (() => {
          // If NOT approved, always use public price
          if (!isPaidAgent) {
            if (Number.isFinite(basePublic) && basePublic > 0) return basePublic;
            return getPublicPrice(item.price);
          }

          // Approved agent/sub-agent pricing logic
          if (assignedPrice && assignedPrice > 0) return assignedPrice;
          
          if (profile?.is_sub_agent) {
            const baseSubAgent = Number(setting?.sub_agent_price);
            if (Number.isFinite(baseSubAgent) && baseSubAgent > 0) return baseSubAgent;
            // Fallback to agent price if subagent price not set
            if (Number.isFinite(baseAgent) && baseAgent > 0) return baseAgent;
            return item.price;
          }

          if (Number.isFinite(baseAgent) && baseAgent > 0) return baseAgent;
          return item.price;
        })();

        return {
          ...item,
          isUnavailable: Boolean(setting?.is_unavailable),
          price: applyPriceMultiplier(resolvedBasePrice, priceMultiplier),
        };
      })
      .filter((item) => !item.isUnavailable);

    mapped.sort((a, b) => a.price - b.price);
    return mapped;
  }, [globalSettings, isPaidAgent, network, parentAssignedPrices, priceMultiplier, profile, basePackages]);

  const refreshBalance = async () => {
    if (!user) return;
    const { data } = await supabase.from("wallets").select("balance").eq("agent_id", user.id).maybeSingle();
    setWalletBalance(Number(data?.balance || 0));
  };

  useEffect(() => { void refreshBalance(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
 
  useEffect(() => {
    const handleSyncComplete = () => {
      void refreshBalance();
    };
    window.addEventListener("offline-sync-complete", handleSyncComplete);
    return () => {
      window.removeEventListener("offline-sync-complete", handleSyncComplete);
    };
  }, []);

  useEffect(() => { 
    setSelectedSize(""); 
    setPhone(""); 
    setPayMethod("wallet"); 
    setPromoResult(null); 
    setPromoCode(""); 
    setPromoOpen(false); 
    setResolvedName(null);
  }, [network]);

  const lastAttemptRef = useRef<string | null>(null);

  // Reset resolved name when phone changes
  useEffect(() => {
    setResolvedName(null);
    lastAttemptRef.current = null;
  }, [phone]);

  // Auto-resolve recipient name
  useEffect(() => {
    if (typeof window !== "undefined" && !window.navigator.onLine) return;

    const attemptKey = `${network}-${normalizedPhone}`;
    if (!isPhoneValid || resolvedName || resolvingName || lastAttemptRef.current === attemptKey) return;

    const timer = setTimeout(async () => {
      setResolvingName(true);
      try {
        let bankCode = "MTN";
        const net = network.toUpperCase();
        if (net.includes("VODA") || net.includes("TELECEL")) bankCode = "VOD";
        if (net.includes("AIRTEL") || net.includes("TIGO") || net.includes("AT")) bankCode = "ATL";

        const { data, error } = await supabase.functions.invoke("paystack-resolve", {
          body: { account_number: normalizedPhone, bank_code: bankCode }
        });
        lastAttemptRef.current = attemptKey;
        if (!error && data?.success) {
          setResolvedName(data.account_name);
        }
      } catch (e) {
        console.error("Auto-resolution failed:", e);
        lastAttemptRef.current = attemptKey;
      } finally {
        setResolvingName(false);
      }
    }, 300); // Faster debounce

    return () => clearTimeout(timer);
  }, [network, isPhoneValid, resolvedName, resolvingName, normalizedPhone]);

  const selectedPackage = packages.find((item) => item.size === selectedSize);
  const cardColors = getNetworkCardColors(network);

  const validPromo = promoResult?.valid ? promoResult : null;
  const isFreePromo = validPromo?.is_free === true;
  
  const basePrice = selectedPackage ? selectedPackage.price : 0;
  // Currently we only support 100% Free promo codes for agents natively without wallet adjustments.
  const displayPrice = isFreePromo ? 0 : basePrice;

  const paystackFee = selectedPackage && !isFreePromo ? calcPaystackFee(basePrice) : 0;
  const paystackTotal = selectedPackage ? parseFloat((displayPrice + paystackFee).toFixed(2)) : 0;

  const validate = (): boolean => {
    if (!selectedPackage) {
      toast({ title: "Select a package first", variant: "destructive" });
      return false;
    }
    if (!phone.trim() || !isPhoneValid) {
      toast({ title: "Invalid phone number", description: "Use a valid Ghana number.", variant: "destructive" });
      return false;
    }
    return true;
  };

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return;
    if (!isPhoneValid) {
      toast({ title: "Enter recipient phone number first", variant: "destructive" });
      return;
    }
    setPromoValidating(true);
    setPromoResult(null);
    const { data, error } = await invokePublicFunction("validate-promo", {
      body: { code: promoCode.trim(), phone: normalizedPhone },
    });
    setPromoValidating(false);
    
    if (error || !data) {
      setPromoResult({ valid: false, error: "Could not validate code. Try again." });
      return;
    }
    
    const result = data as PromoResult;
    setPromoResult(result);
    
    if (result.valid) {
      if (result.is_free) {
        toast({ title: "Free data code applied!", description: `${promoCode.trim().toUpperCase()} is valid.` });
      } else {
        // We warn them that partial discounts might not work properly via wallet yet
        toast({ title: "Code applied", description: "Note: Partial discounts are only supported via Card/MoMo." });
      }
    }
  };

  const handleClaimFree = async () => {
    if (!validate() || !validPromo?.is_free) return;
    
    setClaimingFree(true);
    const { data, error } = await invokePublicFunction("claim-free-data", {
      body: {
        promo_code: promoCode.trim(),
        phone: normalizedPhone,
        network,
        package_size: selectedPackage!.size,
      },
    });
    
    if (error || !data) {
      toast({ title: "Claim failed", description: "Could not process your free data claim.", variant: "destructive" });
      setClaimingFree(false);
      return;
    }
    
    if (data.success) {
      toast({ title: "Free data sent!", description: "The data bundle is on its way." });
      setLastOrder({ id: data.order_id, network, packageSize: selectedPackage!.size, phone, status: "fulfilled" });
      setSelectedSize(""); setPhone(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false);
    } else {
      toast({ title: "Claim failed", description: data.error || "Delivery failed.", variant: "destructive" });
      setPromoResult(null); setPromoCode(""); 
    }
    setClaimingFree(false);
  };

  const handleWalletBuy = async () => {
    if (!validate()) return;
    setBuying(true);

    const startTime = Date.now();
    const orderId = crypto.randomUUID();
    
    try {
      const { data, error } = await invokePublicFunctionAsUser("wallet-buy-data", {
        body: {
          network,
          package_size: selectedPackage!.size,
          customer_phone: phone,
          amount: selectedPackage!.price,
          reference: orderId,
        },
      });

      // Ensure the "Processing" state lasts at least 0.1 seconds for an ultra-fast "swift" experience
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, 100 - elapsedTime);
      if (remainingTime > 0) await new Promise(resolve => setTimeout(resolve, remainingTime));

      if (error || data?.error) {
        const description = data?.error || await getFunctionErrorMessage(error, "Could not complete purchase.");
        toast({ title: "Purchase failed", description, variant: "destructive" });
        setBuying(false);
        return;
      }

      if (data?.queued) {
        toast({
          title: "Order Queued Offline 📶",
          description: "Connection is offline. Your purchase is queued and will automatically sync when online.",
        });
        setPhone("");
        setSelectedSize("");
        setBuying(false);
        return;
      }

      console.log("Wallet buy response data:", data);

      if (typeof data?.order_id === "string" || data?.success) {
        playSuccessSound();
        toast({ title: "Purchase successful!", description: "Order proceed. Will be delivered between 10min to 60min.", variant: "default" });
        if (data?.order_id) {
          setLastOrder({ 
            id: data.order_id, 
            network, 
            packageSize: selectedPackage!.size, 
            phone, 
            status: data?.status || "processing" 
          });
        }
        setShowSuccessOverlay(true);
        // Let overlay stay longer or require manual close if needed, but 5s is fine for now
        setTimeout(() => setShowSuccessOverlay(false), 6000);
      } else {
        // Fallback success if we got here without a explicit error
        playSuccessSound();
        toast({ title: "Order Placed", description: "Check your order history for status." });
        setShowSuccessOverlay(true);
        setTimeout(() => setShowSuccessOverlay(false), 5000);
      }

      setBuying(false);
      setPhone("");
      setSelectedSize("");
      refreshBalance();
    } catch (err) {
      console.error("Wallet buy error:", err);
      setBuying(false);
    }
  };

  const handlePaystackBuy = async () => {
    if (!validate()) return;

    const orderId = crypto.randomUUID();
    const callbackParams = new URLSearchParams({
      reference: orderId,
      network,
      package: selectedPackage!.size,
      phone: normalizedPhone,
    });

    const meta = {
      order_id: orderId,
      order_type: "data",
      network,
      package_size: selectedPackage!.size,
      customer_phone: normalizedPhone,
      fee: paystackFee,
      agent_id: user?.id,
      callback_url: `${getAppBaseUrl()}/order-status?${callbackParams.toString()}`,
      ...(validPromo && !validPromo.is_free ? {
        promo_code: promoCode.trim(),
        promo_id: validPromo.promo_id,
        discount_percentage: validPromo.discount_percentage,
      } : {}),
    };

    setCheckoutMetadata(meta);
    setCheckoutOpen(true);
  };

  const handleCheckoutSuccess = (ref: string) => {
    setCheckoutOpen(false);
    setSelectedSize("");
    setPhone("");
    setPromoCode("");
    setPromoResult(null);
    setPromoOpen(false);
    
    const callbackParams = new URLSearchParams({
      reference: ref,
      network,
      package: selectedPackage?.size || "",
      phone: normalizedPhone,
    });
    
    window.location.href = `${getAppBaseUrl()}/order-status?${callbackParams.toString()}`;
  };

  const handleCheckoutFailure = (error: string) => {
    setBuying(false);
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Buy Data</h1>
          <p className="text-sm text-muted-foreground">
            {isPaidAgent ? "Agent prices applied." : "Sign up as an agent for agent prices."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshBalance}
            className="p-2 rounded-lg border border-border hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            title="Refresh balance"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
            <Wallet className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold">
              {walletBalance !== null ? `GH₵ ${walletBalance.toFixed(2)}` : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Order status banner */}
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

      <OfflineQueueWidget />

      {/* Agent upsell */}
      {!isPaidAgent && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 text-sm">
            Activate your agent access for <span className="font-bold">GHS {activationFee}</span> to unlock agent prices &amp; your own store.
          </div>
          <Button size="sm" onClick={() => navigate("/agent-program")} className="shrink-0 gap-1.5">
            Become an Agent <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Network tabs */}
      <div className="flex gap-2 sm:gap-3">
        {NETWORKS.map((n) => {
          const isActive = n === network;
          return (
            <button
              key={n}
              onClick={() => navigate(`/dashboard/buy-data/${networkRouteMap[n]}`)}
              className={`flex-1 py-2.5 sm:py-3 rounded-xl border-2 text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
                isActive ? networkTabStyles[n].active : networkTabStyles[n].idle
              }`}
            >
              {n === "MTN Mash Up" ? (
                <>
                  <Zap className="w-4 h-4 fill-current" />
                  <span>MTN Mash Up</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-black ${
                    isActive ? "bg-black/20 text-black" : "bg-secondary text-secondary-foreground"
                  }`}>4</span>
                </>
              ) : (
                n
              )}
            </button>
          );
        })}
      </div>

      {/* MTN Live Delivery Speed Widget */}
      {network === "MTN" && (
        <LastMtnOrderWidget variant="card" className="w-full animate-in slide-in-from-top-4 duration-300" />
      )}

      {/* ── Inline Purchase Panel (Swift Payment Layout) ── */}
      {selectedPackage && (
        <div className="rounded-2xl border-2 border-primary/30 bg-card overflow-hidden shadow-2xl animate-in slide-in-from-top-4 duration-300">
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-primary/5">
            <div className="flex items-center gap-2.5">
              <div className={`w-2 h-2 rounded-full animate-pulse ${cardColors.size.replace('text-', 'bg-')}`} />
              <span className="font-bold text-sm">Purchase {network} {selectedPackage.size}</span>
              {isFreePromo ? (
                <span className="bg-green-500/20 text-green-500 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest">FREE CLAIM</span>
              ) : (
                <span className="text-muted-foreground text-xs">— GH₵ {displayPrice.toFixed(2)}</span>
              )}
            </div>
            <button
              onClick={() => { setSelectedSize(""); setPromoResult(null); setPromoCode(""); setPromoOpen(false); }}
              className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-secondary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Phone input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label htmlFor="dash-phone" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recipient Phone Number</Label>
                {savedCustomers.length > 0 && (
                  <button 
                    onClick={() => setShowCustomers(!showCustomers)}
                    className="text-[10px] font-black uppercase text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
                  >
                    <Users2 className="w-3 h-3" />
                    {showCustomers ? "Close Contacts" : "Address Book"}
                  </button>
                )}
              </div>
              
              {showCustomers && savedCustomers.length > 0 && (
                <div className="mt-2 mb-3 max-h-40 overflow-y-auto border border-border rounded-xl divide-y divide-border bg-secondary/20 scrollbar-none">
                  {savedCustomers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setPhone(c.phone);
                        setShowCustomers(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-primary/10 transition-colors text-left"
                    >
                      <div>
                        <p className="text-xs font-bold text-foreground">{c.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{c.phone}</p>
                      </div>
                      <span className="text-[9px] font-black uppercase text-primary/60 px-1.5 py-0.5 rounded border border-primary/20">{c.network}</span>
                    </button>
                  ))}
                </div>
              )}

              <Input
                id="dash-phone"
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={`bg-secondary/30 border-border/50 focus:border-primary/50 transition-all h-11 text-base ${resolvedName ? "border-emerald-500/50 bg-emerald-500/5" : ""}`}
                placeholder="0241234567"
                maxLength={12}
              />
              {isPhoneValid && !resolvedName && (
                typeof window !== "undefined" && window.navigator.onLine ? (
                  <button
                    onClick={async () => {
                      setResolvingName(true);
                      try {
                        let bankCode = "MTN";
                        const net = network.toUpperCase();
                        if (net.includes("VODA") || net.includes("TELECEL")) bankCode = "VOD";
                        if (net.includes("AIRTEL") || net.includes("TIGO") || net.includes("AT")) bankCode = "ATL";

                        const { data, error } = await supabase.functions.invoke("paystack-resolve", {
                          body: { account_number: normalizedPhone, bank_code: bankCode }
                        });
                        if (error || !data?.success) throw new Error(data?.error || "Could not resolve name");
                        setResolvedName(data.account_name);
                      } catch (e: any) {
                        toast({ title: "Verification Failed", description: e.message, variant: "destructive" });
                      } finally {
                        setResolvingName(false);
                      }
                    }}
                    disabled={resolvingName}
                    className="mt-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary/80 transition-colors"
                  >
                    {resolvingName ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                    Verify Recipient Name
                  </button>
                ) : (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-500/85">
                    <WifiOff className="w-3.5 h-3.5" />
                    Verification offline (will queue order without name)
                  </div>
                )
              )}
              {resolvedName && (
                <div className="mt-1.5 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[10px] font-black uppercase tracking-widest animate-in fade-in slide-in-from-top-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Account: {resolvedName}
                </div>
              )}
              {phone.length > 0 && !isPhoneValid && (
                <p className="text-[10px] font-bold text-destructive mt-1.5 uppercase tracking-tight">Invalid Ghana number format</p>
              )}
            </div>

            {/* Promo Code Section */}
            {!promoOpen && !validPromo ? (
              <button onClick={() => setPromoOpen(true)} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors">
                <Tag className="w-3 h-3" /> Have a promo code?
              </button>
            ) : (
              <div className="space-y-2">
                {validPromo ? (
                  <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider border ${validPromo.is_free ? "bg-green-500/10 border-green-500/30 text-green-500" : "bg-amber-500/10 border-amber-500/30 text-amber-500"}`}>
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {validPromo.is_free
                      ? `Code ${validPromo.code}: 100% FREE`
                      : `Code ${validPromo.code}: ${validPromo.discount_percentage}% off`}
                    <button onClick={() => { setPromoResult(null); setPromoCode(""); setPromoOpen(true); }} className="ml-auto opacity-70 hover:opacity-100 p-1">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      placeholder="Enter code"
                      value={promoCode}
                      onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoResult(null); }}
                      className="uppercase font-mono text-sm h-10 bg-secondary/30"
                    />
                    <Button onClick={handleApplyPromo} disabled={promoValidating || !promoCode.trim()} variant="secondary" size="sm" className="font-bold h-10 px-4">
                      {promoValidating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply"}
                    </Button>
                    <Button onClick={() => { setPromoOpen(false); setPromoCode(""); setPromoResult(null); }} variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-muted-foreground">
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                )}
                {promoResult && !promoResult.valid && <p className="text-[10px] font-bold text-destructive pl-1 uppercase">{promoResult.error || "Invalid promo code"}</p>}
              </div>
            )}

            {/* Payment method */}
            {!isFreePromo && (
              <div className="pt-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2.5">Select Payment Method</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setPayMethod("wallet")}
                    className={`p-3 rounded-2xl border-2 text-left transition-all ${
                      payMethod === "wallet"
                        ? "border-primary bg-primary/10 shadow-[0_0_15px_rgba(var(--primary-rgb),0.1)]"
                        : "border-border/50 hover:border-primary/40 bg-secondary/20"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Wallet className={`w-4 h-4 shrink-0 ${payMethod === "wallet" ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="text-xs font-bold">Wallet</span>
                    </div>
                    <p className="text-[10px] font-medium text-muted-foreground">
                      Bal: GH₵ {(walletBalance || 0).toFixed(2)}
                    </p>
                  </button>

                  <button
                    onClick={() => setPayMethod("paystack")}
                    className={`p-3 rounded-2xl border-2 text-left transition-all ${
                      payMethod === "paystack"
                        ? "border-primary bg-primary/10 shadow-[0_0_15px_rgba(var(--primary-rgb),0.1)]"
                        : "border-border/50 hover:border-primary/40 bg-secondary/20"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <CreditCard className={`w-4 h-4 shrink-0 ${payMethod === "paystack" ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="text-xs font-bold text-nowrap">Card / MoMo</span>
                    </div>
                    <p className="text-[10px] font-medium text-muted-foreground">
                      +3% fee
                    </p>
                  </button>
                </div>
              </div>
            )}

            {/* Price breakdown for Paystack */}
            {payMethod === "paystack" && !isFreePromo && (
              <div className="rounded-xl bg-secondary/40 border border-border/50 divide-y divide-border/50 text-[11px] font-medium overflow-hidden">
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground uppercase tracking-tight">Bundle price</span>
                  <span>GH₵ {displayPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground uppercase tracking-tight">Processing fee</span>
                  <span>GH₵ {paystackFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between px-3 py-2.5 bg-primary/5 font-black text-foreground uppercase tracking-wider">
                  <span>Total Payable</span>
                  <span className="text-primary">GH₵ {paystackTotal.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Wallet insufficient warning */}
            {payMethod === "wallet" && !isFreePromo && walletBalance !== null && walletBalance < displayPrice && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[10px] font-bold text-amber-500 flex items-center gap-2.5 uppercase tracking-tight">
                <Wallet className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1">Insufficient wallet balance. Top up or use card.</span>
                <button
                  onClick={() => navigate("/dashboard/wallet")}
                  className="bg-amber-500 text-black px-2 py-1 rounded text-[9px] font-black hover:bg-amber-400 transition-colors"
                >
                  TOP UP
                </button>
              </div>
            )}

            {/* Action button */}
            <div className="pt-2">
              {isFreePromo ? (
                <Button
                  className="w-full gap-2 font-black text-xs py-6 uppercase tracking-[0.2em] bg-green-500 hover:bg-green-600 text-white shadow-lg shadow-green-500/20 rounded-2xl disabled:opacity-40 disabled:grayscale disabled:cursor-not-allowed"
                  onClick={handleClaimFree}
                  disabled={claimingFree || !resolvedName || !selectedPackage}
                >
                  {claimingFree ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Processing Claim...</>
                  ) : (
                    <><Gift className="w-4 h-4" /> Claim Free Data</>
                  )}
                </Button>
              ) : (
                <Button
                  className={`w-full gap-2 font-black text-xs py-6 uppercase tracking-[0.2em] shadow-xl transition-all rounded-2xl disabled:opacity-40 disabled:grayscale disabled:cursor-not-allowed ${
                    payMethod === "wallet" 
                      ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-primary/20" 
                      : "bg-slate-900 text-white dark:bg-white dark:text-black hover:opacity-90 shadow-lg shadow-slate-900/10 dark:shadow-white/10"
                  }`}
                  onClick={payMethod === "wallet" ? handleWalletBuy : handlePaystackBuy}
                  disabled={buying || !resolvedName || !selectedPackage}
                >
                  {buying ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Placing order...</>
                  ) : payMethod === "wallet" ? (
                    <><Wallet className="w-4 h-4" /> Pay GH₵ {displayPrice.toFixed(2)}</>
                  ) : (
                    <><CreditCard className="w-4 h-4" /> Pay GH₵ {paystackTotal.toFixed(2)}</>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Package grid */}
      <div className={selectedPackage ? "opacity-40 grayscale-[0.5] pointer-events-none transition-all duration-500" : ""}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">{network} Available Bundles</p>
          {selectedPackage && (
            <button 
              onClick={() => setSelectedSize("")}
              className="text-[10px] font-black uppercase text-primary animate-pulse"
            >
              ← Back to Quick Select
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {settingsLoading
            ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[120px] rounded-2xl" />)
            : packages.map((item) => {
                const isSelected = selectedSize === item.size;
                return (
                  <button
                    key={item.size}
                    type="button"
                    onClick={() => {
                      setSelectedSize(isSelected ? "" : item.size);
                      setPayMethod("wallet");
                      // Scroll to top of panel if on mobile
                      if (!isSelected) window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className={`${cardColors.card} rounded-2xl p-3.5 sm:p-4 flex flex-col gap-2 border-2 text-left transition-all duration-200 relative ${
                      isSelected
                        ? "border-white shadow-2xl scale-[1.05] z-10"
                        : "border-transparent hover:border-white/20 hover:scale-[1.02] opacity-80 hover:opacity-100"
                    }`}
                  >
                    {isSelected && (
                      <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-xl border border-black/10">
                        <CheckCircle2 className="w-4 h-4 text-black" />
                      </span>
                    )}
                    <span className={`${cardColors.label} text-[10px] font-black uppercase tracking-widest opacity-60`}>{network}</span>
                    <span className={`${cardColors.size} text-3xl font-black leading-none tracking-tighter`}>{item.size}</span>
                    <div className="flex items-end justify-between mt-auto pt-1">
                      <span className={`${cardColors.size} text-base font-black`}>₵{item.price.toFixed(2)}</span>
                      <span className={`${cardColors.label} text-[9px] font-bold uppercase opacity-60`}>{item.validity || "No Expiry"}</span>
                    </div>
                  </button>
                );
              })}
        </div>
      </div>


      {/* ── Success Overlay ── */}
      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-in fade-in duration-500">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-3xl" />
          <div className="relative max-w-sm w-full bg-[#0A0A0C] border border-white/10 rounded-[3rem] p-10 text-center space-y-8 animate-in zoom-in-95 duration-300 shadow-3xl">
            {/* SVG Illustration */}
            <div className="relative mx-auto w-36 h-36">
              <div className="absolute inset-0 bg-emerald-500 rounded-full blur-3xl opacity-10 animate-pulse" />
              <svg className="w-full h-full drop-shadow-[0_8px_24px_rgba(16,185,129,0.2)] animate-bounce-subtle relative z-10" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Phone Body */}
                <rect x="55" y="25" width="90" height="150" rx="16" fill="url(#phoneGradOverlay)" stroke="rgba(255,255,255,0.15)" strokeWidth="2"/>
                {/* Phone Screen */}
                <rect x="62" y="32" width="76" height="136" rx="10" fill="#0A0A0C"/>
                {/* Phone Notch */}
                <rect x="90" y="35" width="20" height="4" rx="2" fill="rgba(255,255,255,0.2)"/>
                
                {/* Decorative Data Waves/Grid */}
                <path d="M 65 100 Q 100 85 135 100" stroke="rgba(16,185,129,0.3)" strokeWidth="2" fill="none"/>
                <path d="M 65 120 Q 100 105 135 120" stroke="rgba(16,185,129,0.15)" strokeWidth="2" fill="none"/>
                
                {/* Success Badge */}
                <circle cx="100" cy="90" r="32" fill="url(#badgeGradOverlay)" />
                <circle cx="100" cy="90" r="26" fill="#0A0A0C"/>
                
                {/* Success Checkmark */}
                <path d="M 90 90 L 97 97 L 112 82" stroke="#10B981" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                
                {/* Sparkles/Stars */}
                <path d="M 45 60 L 48 65 L 53 66 L 49 70 L 50 75 L 45 72 L 40 75 L 41 70 L 37 66 L 42 65 Z" fill="#ffd43b" opacity="0.8"/>
                <path d="M 155 120 L 157 123 L 161 124 L 158 127 L 159 131 L 155 129 L 151 131 L 152 127 L 149 124 L 153 123 Z" fill="#ff9f1c" opacity="0.8"/>
                <circle cx="145" cy="55" r="4" fill="#0ea5e9"/>
                <circle cx="50" cy="130" r="3" fill="#10B981"/>
                
                {/* Gradients */}
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
              <h2 className="text-2xl font-black tracking-tighter text-white uppercase">Purchase Successful</h2>
              <p className="text-white/40 text-sm font-medium leading-relaxed">
                Order proceed. Your bundle will be delivered between 10min to 60min.
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

      <PaystackMomoCheckout
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        amount={paystackTotal}
        email={user?.email || ""}
        recipientPhone={normalizedPhone}
        recipientNetwork={network}
        metadata={checkoutMetadata}
        onSuccess={handleCheckoutSuccess}
        onFailure={handleCheckoutFailure}
      />
    </div>
  );
};

export default DashboardBuyDataNetwork;
