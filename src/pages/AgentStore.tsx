import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { basePackages } from "@/lib/data";
import { getNetworkCardColors } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { getAppBaseUrl, getActiveStoreDomain } from "@/lib/app-base-url";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";
import { invokePublicFunction, invokePublicFunctionAsUser } from "@/lib/public-function-client";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";
import StoreNavbar from "@/components/StoreNavbar";
import StoreVisitorPopup from "@/components/StoreVisitorPopup";
import { TraditionalBackground } from "@/components/TraditionalBackground";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Zap, Loader2, Store, MessageCircle,
  ShieldCheck, Phone, X, CreditCard, Gift, Tag, CheckCircle2,
  Smartphone, Package, Clock, ArrowRight, Wifi, Star,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import StoreAuth from "@/components/StoreAuth";
import { playSuccessSound } from "@/lib/sound";

interface PromoResult {
  valid: boolean;
  promo_id?: string;
  code?: string;
  discount_percentage?: number;
  is_free?: boolean;
  error?: string;
}

type NetworkName = "MTN" | "Telecel" | "AirtelTigo";
type ServiceType = "data" | "airtime" | "utility";
const NETWORKS: NetworkName[] = ["MTN", "Telecel", "AirtelTigo"];
const PAYSTACK_FEE_RATE = 0.03;
const calcFee = (amount: number) => Math.min(amount * PAYSTACK_FEE_RATE, 100);

const NETWORK_CONFIG: Record<NetworkName, { color: string; bg: string; textClass: string; borderClass: string; light: string }> = {
  MTN:        { color: "#FFCC00", bg: "bg-[#FFCC00]", textClass: "text-black", borderClass: "border-[#FFCC00]", light: "#FFCC0020" },
  Telecel:    { color: "#E60000", bg: "bg-[#E60000]", textClass: "text-white", borderClass: "border-[#E60000]", light: "#E6000020" },
  AirtelTigo: { color: "#00529B", bg: "bg-[#00529B]", textClass: "text-white", borderClass: "border-[#00529B]", light: "#00529B20" },
};

interface AgentProfile {
  user_id: string;
  store_name: string;
  full_name: string;
  whatsapp_number: string;
  support_number: string;
  email: string;
  whatsapp_group_link: string | null;
  agent_prices: Record<string, Record<string, string | number>>;
  disabled_packages: Record<string, string[]>;
  is_sub_agent: boolean;
  parent_agent_id: string | null;
  sub_agent_activation_markup: number | null;
  store_logo_url: string | null;
  store_primary_color: string | null;
}

interface GlobalPkgSetting {
  network: string;
  package_size: string;
  agent_price: number | null;
  sub_agent_price: number | null;
  public_price: number | null;
  is_unavailable: boolean;
}

const AgentStore = () => {
  const { slug } = useParams<{ slug: string }>();
  const { toast } = useToast();
  const { profile, refreshProfile, signOut } = useAuth();
  const [searchParams] = useSearchParams();

  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [greeting, setGreeting] = useState("Welcome");

  useEffect(() => {
    const hrs = new Date().getHours();
    if (hrs < 12) setGreeting("Good Morning 🌅");
    else if (hrs < 18) setGreeting("Good Afternoon ☀️");
    else setGreeting("Good Evening 🌃");
  }, []);

  const [selectedNetwork, setSelectedNetwork] = useState<NetworkName>("MTN");
  const [selectedService, setSelectedService] = useState<ServiceType>("data");
  const [selectedPkg, setSelectedPkg] = useState<{ size: string; price: number } | null>(null);
  const [airtimeAmount, setAirtimeAmount] = useState("");
  const [utilityType, setUtilityType] = useState<"ECG" | "GWCL">("ECG");
  const [utilityNumber, setUtilityNumber] = useState("");
  const [utilityAmount, setUtilityAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [buying, setBuying] = useState(false);

  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("auth") === "login") {
      setAuthOpen(true);
    }
  }, [searchParams]);
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositPhone, setDepositPhone] = useState("");
  const [depositTxRef, setDepositTxRef] = useState("");
  const [submittingDeposit, setSubmittingDeposit] = useState(false);
  const [payMethod, setPayMethod] = useState<"wallet" | "paystack">("paystack");

  const isCustomerLoggedIn = Boolean(
    profile && 
    (profile.parent_agent_id === agent?.user_id || profile.user_id === agent?.user_id)
  );
  const customerBalance = profile?.balance ?? 0;
  const customerName = profile?.full_name || profile?.email || "Store Customer";

  // Automatically link visiting users with no parent agent to the visited store
  useEffect(() => {
    if (profile && !profile.parent_agent_id && agent?.user_id && profile.user_id !== agent.user_id) {
      const linkAccount = async () => {
        await supabase
          .from("profiles")
          .update({ parent_agent_id: agent.user_id })
          .eq("user_id", profile.user_id);
        refreshProfile();
      };
      linkAccount();
    }
  }, [profile, agent?.user_id]);

  // Dynamically update document title and favicon to match storefront branding
  useEffect(() => {
    if (agent?.store_name) {
      document.title = `${agent.store_name} | Buy Cheap Data Bundles Ghana`;
      
      if (agent.store_logo_url) {
        let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
        if (!link) {
          link = document.createElement('link');
          link.rel = 'icon';
          document.getElementsByTagName('head')[0].appendChild(link);
        }
        link.href = agent.store_logo_url;
      }
    }
  }, [agent]);

  const handleWalletBuy = async () => {
    if (!isPhoneValid) {
      toast({ title: "Invalid phone number", description: "Use a valid Ghana number.", variant: "destructive" });
      return;
    }
    setBuying(true);
    const startTime = Date.now();
    const orderId = crypto.randomUUID();
    
    try {
      const { data, error } = await invokePublicFunctionAsUser("wallet-buy-data", {
        body: {
          network: selectedNetwork,
          package_size: selectedPkg!.size,
          customer_phone: phone,
          amount: selectedPkg!.price,
          reference: orderId,
        },
      });

      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, 100 - elapsedTime);
      if (remainingTime > 0) await new Promise(resolve => setTimeout(resolve, remainingTime));

      if (error || data?.error) {
        const description = data?.error || await getFunctionErrorMessage(error, "Could not complete purchase.");
        toast({ title: "Purchase failed", description, variant: "destructive" });
        setBuying(false);
        return;
      }

      playSuccessSound();
      toast({ title: "Purchase successful!", description: "Order proceed. Will be delivered between 10min to 60min.", variant: "default" });
      refreshProfile();
      setShowSuccessOverlay(true);
      setPhone("");
      setSelectedPkg(null);
    } catch (err) {
      console.error("Wallet buy error:", err);
    } finally {
      setBuying(false);
    }
  };

  const handleManualDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !agent) return;

    const requestedAmount = Number(depositAmount);
    if (!Number.isFinite(requestedAmount) || requestedAmount < 1) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (!depositPhone.trim()) {
      toast({ title: "Enter your MoMo sender number", variant: "destructive" });
      return;
    }
    if (!depositTxRef.trim()) {
      toast({ title: "Enter the transaction reference", variant: "destructive" });
      return;
    }

    setSubmittingDeposit(true);
    try {
      const { error } = await supabase.from("store_deposits").insert({
        agent_id: agent.user_id,
        customer_id: profile.user_id,
        amount: requestedAmount,
        sender_number: depositPhone.trim(),
        transaction_reference: depositTxRef.trim(),
        status: "pending",
      });

      if (error) throw error;

      toast({
        title: "✅ Deposit Request Sent",
        description: `Your deposit of GHS ${requestedAmount.toFixed(2)} is pending approval from your agent.`,
      });
      setDepositOpen(false);
      setDepositAmount("");
      setDepositPhone("");
      setDepositTxRef("");
    } catch (err: any) {
      toast({ title: "Deposit failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmittingDeposit(false);
    }
  };


  const verifiedRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    if (reference && !verifiedRef.current) {
      verifiedRef.current = true;
      invokePublicFunctionAsUser("verify-payment", { body: { reference } })
        .then(async (res) => {
          const status = res.data?.status;
          if (status === "fulfilled" || res.data?.success) {
            toast({ title: "Success!", description: "Your store wallet balance has been credited." });
          } else {
            toast({ title: "Payment Received", description: "Updating your balance shortly." });
          }
          refreshProfile();
          let retries = 3;
          const poll = setInterval(async () => {
            refreshProfile();
            retries--;
            if (retries <= 0) clearInterval(poll);
          }, 2500);
          window.history.replaceState({}, "", window.location.pathname);
        })
        .catch(() => {
          toast({ title: "Deposit complete", description: "Refreshing your balance..." });
          refreshProfile();
          window.history.replaceState({}, "", window.location.pathname);
        });
    }
  }, [refreshProfile, toast]);

  const [globalSettings, setGlobalSettings] = useState<Record<string, GlobalPkgSetting>>({});
  const [parentAssignedPrices, setParentAssignedPrices] = useState<Record<string, Record<string, string | number>>>({});
  const [subAgentBaseFee, setSubAgentBaseFee] = useState<number | null>(null);
  const [priceMultipliers, setPriceMultipliers] = useState<Record<string, number>>({ MTN: 1, Telecel: 1, AirtelTigo: 1 });

  const phoneInputRef = useRef<HTMLInputElement>(null);
  const promoInputRef = useRef<HTMLInputElement>(null);
  const purchasePanelRef = useRef<HTMLDivElement>(null);

  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoValidating, setPromoValidating] = useState(false);
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);

  const phoneDigits = phone.replace(/\D+/g, "");
  const isPhoneValid = phoneDigits.length === 10 || phoneDigits.length === 12 || phoneDigits.length === 9;

  useEffect(() => {
    const fetchStore = async () => {
      try {
        setLoading(true);
        const activeDomain = getActiveStoreDomain();
        let storeQuery = supabase
          .from("agent_stores")
          .select("user_id, store_name, full_name, whatsapp_number, support_number, email, whatsapp_group_link, agent_prices, sub_agent_prices, disabled_packages, is_agent, is_sub_agent, agent_approved, sub_agent_approved, parent_agent_id, sub_agent_activation_markup, store_logo_url, store_primary_color, slug, custom_domain");

        if (slug) {
          storeQuery = storeQuery.eq("slug", slug);
        } else if (activeDomain) {
          storeQuery = storeQuery.eq("custom_domain", activeDomain);
        } else {
          setNotFound(true);
          setLoading(false);
          return;
        }

        const [agentRes, pkgRes, pricingCtx] = await Promise.all([
          storeQuery.maybeSingle(),
          supabase.from("global_package_settings").select("network, package_size, agent_price, sub_agent_price, public_price, is_unavailable"),
          fetchApiPricingContext().catch(() => ({ source: "primary", multipliers: { MTN: 1, Telecel: 1, AirtelTigo: 1 }, multiplier: 1 })),
        ]);

        if (agentRes.error) { setNotFound(true); setLoading(false); return; }

        const gsMap: Record<string, GlobalPkgSetting> = {};
        (pkgRes.data || []).forEach((r: any) => { 
          const normSize = r.package_size.replace(/\s+/g, "").toUpperCase();
          gsMap[`${r.network}-${normSize}`] = r; 
        });
        setGlobalSettings(gsMap);
        setPriceMultipliers(pricingCtx.multipliers || { MTN: 1, Telecel: 1, AirtelTigo: 1 });

        if (!agentRes.data) { setNotFound(true); setLoading(false); return; }

        const profile = agentRes.data as unknown as AgentProfile;
        setAgent(profile);

        const tenantData = {
          name: profile.store_name,
          logo: profile.store_logo_url,
          color: profile.store_primary_color,
          slug: (profile as any).slug || slug,
          custom_domain: (profile as any).custom_domain
        };
        localStorage.setItem("current_store_tenant", JSON.stringify(tenantData));

        const storeSlug = slug || (profile as any).slug;
        if (storeSlug) {
          localStorage.setItem(`store_loading_${storeSlug}`, JSON.stringify({
            name: profile.store_name,
            logo: profile.store_logo_url,
            color: profile.store_primary_color
          }));
        }
        const storeDomain = activeDomain || (profile as any).custom_domain;
        if (storeDomain) {
          localStorage.setItem(`store_loading_${storeDomain}`, JSON.stringify({
            name: profile.store_name,
            logo: profile.store_logo_url,
            color: profile.store_primary_color
          }));
        }

        if (profile.is_sub_agent && profile.parent_agent_id) {
          const { data: parentProfile } = await supabase
            .from("profiles").select("sub_agent_prices, agent_prices").eq("user_id", profile.parent_agent_id).maybeSingle();
          if (parentProfile) {
            const subPrices = (parentProfile.sub_agent_prices || {}) as Record<string, any>;
            const parentSellingPrices = (parentProfile.agent_prices || {}) as Record<string, any>;
            const merged: Record<string, Record<string, string | number>> = {};
            for (const [network, pkgs] of Object.entries(basePackages)) {
              merged[network] = {};
              for (const pkg of pkgs) {
                const subPrice = Number(subPrices[network]?.[pkg.size]);
                const sellingPrice = Number(parentSellingPrices[network]?.[pkg.size]);
                merged[network][pkg.size] = (Number.isFinite(subPrice) && subPrice > 0) ? subPrice : sellingPrice;
              }
            }
            setParentAssignedPrices(merged);
          }
        }

        const fee = Number(profile.sub_agent_activation_markup ?? 0);
        if (Number.isFinite(fee) && fee > 0) setSubAgentBaseFee(fee);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetchStore();
  }, [slug]);

  const resolveDisplayPrice = useCallback((network: string, size: string, fallbackPrice: number): number => {
    if (!agent) return fallbackPrice;
    const multiplier = priceMultipliers[network] || 1;
    const parentAssigned = Number(parentAssignedPrices?.[network]?.[size]);
    const agentOwn = Number(agent.agent_prices?.[network]?.[size]);
    if (agent.is_sub_agent) {
      const base = Math.max(
        Number.isFinite(parentAssigned) ? parentAssigned : 0,
        Number.isFinite(agentOwn) ? agentOwn : 0
      );
      if (base > 0) return applyPriceMultiplier(base, multiplier);
    } else {
      if (Number.isFinite(agentOwn) && agentOwn > 0) return applyPriceMultiplier(agentOwn, multiplier);
    }
    const gs = globalSettings[`${network}-${size}`];
    let gsBase = Number(gs?.agent_price) > 0 ? Number(gs!.agent_price) : Number(gs?.public_price);
    if (agent.is_sub_agent) {
      const gsSub = Number(gs?.sub_agent_price);
      if (Number.isFinite(gsSub) && gsSub > 0) gsBase = gsSub;
    }
    if (Number.isFinite(gsBase) && gsBase > 0) return applyPriceMultiplier(gsBase, multiplier);
    return applyPriceMultiplier(fallbackPrice, multiplier);
  }, [agent, globalSettings, parentAssignedPrices, priceMultipliers]);

  const packages = (basePackages[selectedNetwork] || [])
    .map((pkg) => {
      const normSize = pkg.size.replace(/\s+/g, "").toUpperCase();
      const gs = globalSettings[`${selectedNetwork}-${normSize}`];
      if (gs?.is_unavailable) return null;
      if (agent?.disabled_packages?.[selectedNetwork]?.includes(pkg.size)) return null;
      return { ...pkg, price: resolveDisplayPrice(selectedNetwork, pkg.size, pkg.price) };
    })
    .filter(Boolean) as { size: string; price: number; validity: string; popular?: boolean }[];

  const validPromo = promoResult?.valid ? promoResult : null;
  const discountPct = validPromo?.discount_percentage ?? 0;
  const isFreePromo = validPromo?.is_free === true;

  const basePrice = selectedService === "data"
    ? (selectedPkg?.price || 0)
    : selectedService === "airtime"
    ? Number(airtimeAmount) || 0
    : Number(utilityAmount) || 0;

  const discountedPrice = isFreePromo ? 0 : parseFloat((basePrice * (1 - discountPct / 100)).toFixed(2));
  const fee = isFreePromo ? 0 : (basePrice > 0 ? calcFee(discountedPrice) : 0);
  const total = basePrice > 0 ? parseFloat((discountedPrice + fee).toFixed(2)) : 0;

  const accentColor = agent?.store_primary_color || "#FFCC00";
  const netConf = NETWORK_CONFIG[selectedNetwork];

  const handleCardClick = useCallback((size: string, price: number) => {
    const isDeselect = selectedPkg?.size === size;
    setSelectedPkg(isDeselect ? null : { size, price });
    setPromoResult(null); setPromoCode(""); setPromoOpen(false);
    if (!isDeselect) {
      setTimeout(() => {
        purchasePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        phoneInputRef.current?.focus();
      }, 120);
    }
  }, [selectedPkg]);

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return;
    if (!isPhoneValid) {
      toast({ title: "Enter your phone number first", variant: "destructive" });
      phoneInputRef.current?.focus();
      return;
    }
    setPromoValidating(true);
    setPromoResult(null);
    const { data, error } = await invokePublicFunction("validate-promo", {
      body: { code: promoCode.trim(), phone: phoneDigits },
    });
    setPromoValidating(false);
    if (error || !data) { setPromoResult({ valid: false, error: "Could not validate code." }); return; }
    setPromoResult(data as PromoResult);
    if (data.valid && data.is_free) {
      toast({ title: "Free data code applied!", description: "Tap Claim Free Data to get your bundle!" });
    } else if (data.valid) {
      toast({ title: `${data.discount_percentage}% off applied!` });
    }
  };

  const handleClaimFree = async () => {
    if (!selectedPkg || !validPromo?.is_free || !agent) return;
    if (!isPhoneValid) {
      toast({ title: "Enter a valid phone number first", variant: "destructive" });
      phoneInputRef.current?.focus();
      return;
    }
    setClaiming(true);
    const { data, error } = await invokePublicFunction("claim-free-data", {
      body: { promo_code: promoCode.trim(), phone: phoneDigits, network: selectedNetwork, package_size: selectedPkg.size },
    });
    setClaiming(false);
    if (error || !data) {
      toast({ title: "Claim failed", description: "Could not process your free data claim.", variant: "destructive" });
      return;
    }
    if (data.success) {
      setShowSuccessOverlay(true);
      setTimeout(() => {
        setShowSuccessOverlay(false);
        setSelectedPkg(null); setPhone(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false);
      }, 5000);
    } else {
      toast({ title: "Claim failed", description: data.error || "Delivery failed. Contact support.", variant: "destructive" });
      setPromoResult(null); setPromoCode("");
    }
  };

  const handlePaystackBuy = async () => {
    if (!agent) return;
    if (selectedService === "data" && !selectedPkg) return;
    if (selectedService === "airtime") {
      const amt = Number(airtimeAmount);
      if (!amt || amt < 1) {
        toast({ title: "Invalid amount", description: "Minimum airtime purchase is GHS 1.00", variant: "destructive" });
        return;
      }
    }
    if (selectedService === "utility") {
      const amt = Number(utilityAmount);
      if (!amt || amt < 1) { toast({ title: "Invalid amount", description: "Enter a valid bill amount.", variant: "destructive" }); return; }
      if (!utilityNumber || utilityNumber.length < 5) { toast({ title: "Invalid Account Number", description: "Please check your meter/account number.", variant: "destructive" }); return; }
      if (utilityType.includes("ECG") && utilityNumber.length < 11) { toast({ title: "Invalid Meter Number", description: "ECG Meter numbers are typically 11 digits or more.", variant: "destructive" }); return; }
    }
    if (!isPhoneValid) {
      toast({ title: "Enter a valid phone number first", variant: "destructive" });
      phoneInputRef.current?.focus();
      return;
    }
    setBuying(true);
    const orderId = crypto.randomUUID();
    const orderType = selectedService === "utility" ? "utility" : selectedService === "airtime" ? "airtime" : "data";
    const packageSize = selectedService === "data" ? selectedPkg?.size : selectedService === "airtime" ? `${airtimeAmount} GHS Airtime` : `${utilityType} Bill`;
    const callbackParams = new URLSearchParams({
      reference: orderId, network: selectedNetwork, package: packageSize || "", phone: phoneDigits,
      ...(slug ? { slug } : {}),
    });
    const metadata: Record<string, any> = {
      order_id: orderId, order_type: orderType, network: selectedNetwork, package_size: packageSize,
      customer_phone: phoneDigits, fee, agent_id: agent.user_id, payment_source: "agent_store",
      ...(validPromo && !validPromo.is_free ? { promo_code: promoCode.trim(), promo_id: validPromo.promo_id, discount_percentage: validPromo.discount_percentage } : {}),
    };
    if (selectedService === "utility") { metadata.bill_type = utilityType; metadata.customer_number = utilityNumber; }
    const { data: paymentData, error: paymentError } = await invokePublicFunction("initialize-payment", {
      body: {
        email: `${phoneDigits}@customer.data-portal.gh`, amount: total, reference: orderId,
        callback_url: slug
          ? `${window.location.origin}/store/${slug}/order-status?${callbackParams.toString()}`
          : `${window.location.origin}/order-status?${callbackParams.toString()}`,
        metadata,
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

  const handlePay = async () => {
    if (isCustomerLoggedIn && payMethod === "wallet") {
      await handleWalletBuy();
    } else {
      await handlePaystackBuy();
    }
  };

  // ── Inline purchase panel (inserted row-by-row below the selected package) ──
  const renderPurchasePanel = () => (
    <div
      ref={purchasePanelRef}
      className="animate-in fade-in slide-in-from-top-1 duration-300 rounded-3xl overflow-hidden border border-white/10"
      style={{ background: "#111116" }}
    >
      {/* Connector notch */}
      <div className="flex px-4 pt-3 pb-0">
        <div
          className="w-1 rounded-full mr-3 shrink-0"
          style={{ backgroundColor: netConf.color, minHeight: "100%", alignSelf: "stretch" }}
        />
        <div className="flex-1 flex items-center justify-between">
          <div>
            <p className="text-sm font-black text-white leading-tight flex items-center gap-2">
              {selectedService === "data"
                ? `${selectedNetwork} · ${selectedPkg?.size}`
                : selectedService === "airtime"
                ? `${selectedNetwork} Airtime`
                : `${utilityType} Bill`}
              {isFreePromo && (
                <span className="text-[9px] bg-emerald-500 text-black font-black px-1.5 py-0.5 rounded-full">FREE</span>
              )}
            </p>
            <p className="text-xs font-bold mt-0.5 text-white/40">
              {validPromo && !isFreePromo ? (
                <><span className="text-emerald-400">₵{discountedPrice.toFixed(2)}</span> <span className="line-through opacity-40">₵{basePrice.toFixed(2)}</span></>
              ) : (
                `₵${basePrice.toFixed(2)}`
              )}
              {fee > 0 && ` · ₵${fee.toFixed(2)} fee`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Deselect package"
            onClick={() => { setSelectedPkg(null); setAirtimeAmount(""); setUtilityAmount(""); setPhone(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false); }}
            className="w-7 h-7 rounded-xl bg-white/5 flex items-center justify-center text-white/30 hover:text-white transition-all ml-3 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 my-3 border-t border-white/6" />

      {/* Phone + Pay */}
      <div className="px-4 pb-4 space-y-3">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25 pointer-events-none z-10" />
            <input
              ref={phoneInputRef}
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Recipient number  0XX XXX XXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={12}
              className="w-full h-12 rounded-2xl pl-10 pr-3 text-sm font-bold text-white placeholder:text-white/25 focus:outline-none transition-all border"
              style={{
                background: "#1c1c24",
                borderColor: isPhoneValid ? `${netConf.color}60` : "rgba(255,255,255,0.08)",
                WebkitTextFillColor: "white",
              }}
            />
          </div>

          {isFreePromo ? (
            <button
              type="button"
              onClick={handleClaimFree}
              disabled={claiming || !isPhoneValid}
              className="shrink-0 h-12 px-4 rounded-2xl bg-emerald-500 text-black font-black text-sm disabled:opacity-40 flex items-center gap-2 active:scale-95 transition-all"
            >
              {claiming ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Gift className="w-4 h-4" />Claim</>}
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePay}
              disabled={buying || (isCustomerLoggedIn && payMethod === "wallet" && customerBalance < total)}
              className="shrink-0 h-12 px-4 rounded-2xl font-black text-sm flex items-center gap-2 active:scale-95 transition-all whitespace-nowrap"
              style={{
                backgroundColor: netConf.color,
                color: netConf.textClass === "text-black" ? "#000" : "#fff",
                opacity: (!isPhoneValid || buying || (isCustomerLoggedIn && payMethod === "wallet" && customerBalance < total)) ? 0.5 : 1,
                boxShadow: (isPhoneValid && !(isCustomerLoggedIn && payMethod === "wallet" && customerBalance < total)) ? `0 6px 20px ${netConf.color}40` : "none",
              }}
            >
              {buying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isCustomerLoggedIn && payMethod === "wallet" ? (
                <><CreditCard className="w-4 h-4" />Wallet Pay ₵{total.toFixed(2)}</>
              ) : (
                <><CreditCard className="w-4 h-4" />Pay ₵{total.toFixed(2)}</>
              )}
            </button>
          )}
        </div>

        {/* Payment Method Selector for Storefront Customer */}
        {isCustomerLoggedIn && !isFreePromo && (
          <div className="pt-1 pb-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-2">Select Payment Method</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPayMethod("wallet")}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  payMethod === "wallet"
                    ? "border-amber-400 bg-amber-400/10"
                    : "border-white/8 hover:border-white/20 bg-white/4"
                }`}
              >
                <p className="text-[10px] font-black text-white">Wallet Balance</p>
                <p className="text-[9px] text-white/50 font-bold mt-0.5 font-mono">₵{customerBalance.toFixed(2)}</p>
              </button>

              <button
                type="button"
                onClick={() => setPayMethod("paystack")}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  payMethod === "paystack"
                    ? "border-amber-400 bg-amber-400/10"
                    : "border-white/8 hover:border-white/20 bg-white/4"
                }`}
              >
                <p className="text-[10px] font-black text-white">Card / MoMo</p>
                <p className="text-[9px] text-white/50 font-bold mt-0.5">Pay online instant</p>
              </button>
            </div>
          </div>
        )}

        {/* Wallet insufficient warning */}
        {isCustomerLoggedIn && payMethod === "wallet" && !isFreePromo && customerBalance < total && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[10px] font-bold text-amber-500 flex items-center gap-2.5 uppercase tracking-tight">
            <CreditCard className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">Insufficient wallet balance. Top up or use Card.</span>
            <button
              type="button"
              onClick={() => setDepositOpen(true)}
              className="bg-amber-500 text-black px-2.5 py-1 rounded-lg text-[9px] font-black hover:bg-amber-400 transition-colors shrink-0"
            >
              DEPOSIT
            </button>
          </div>
        )}

        {/* Phone validation */}
        {phone.length > 0 && !isPhoneValid && (
          <p className="text-[11px] font-bold text-red-400 px-1 animate-in fade-in duration-150">
            Enter a valid 10-digit Ghana number
          </p>
        )}

        {/* Promo code */}
        <div>
          {!promoOpen && !validPromo ? (
            <button
              type="button"
              onClick={() => { setPromoOpen(true); setTimeout(() => promoInputRef.current?.focus(), 80); }}
              className="flex items-center gap-1.5 text-[11px] font-bold text-white/25 hover:text-amber-400 transition-colors"
            >
              <Tag className="w-3 h-3" /> Have a promo code?
            </button>
          ) : validPromo ? (
            <div className={`inline-flex items-center gap-2 text-[11px] font-black px-3 py-1.5 rounded-xl border ${validPromo.is_free ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-amber-400/10 border-amber-400/20 text-amber-400"}`}>
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              {validPromo.code}{validPromo.is_free ? " — Free!" : ` — ${validPromo.discount_percentage}% off`}
              <button type="button" aria-label="Remove promo" onClick={() => { setPromoResult(null); setPromoCode(""); setPromoOpen(true); }} className="ml-1 opacity-50 hover:opacity-100">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2 animate-in fade-in duration-200">
              <input
                ref={promoInputRef}
                type="text"
                placeholder="PROMO CODE"
                value={promoCode}
                onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoResult(null); }}
                className="flex-1 h-9 rounded-xl px-3 text-white placeholder:text-white/20 text-[11px] font-black tracking-widest focus:outline-none uppercase border border-white/8"
                style={{ background: "#1c1c24" }}
              />
              <button type="button" onClick={handleApplyPromo} disabled={promoValidating || !promoCode.trim()}
                className="h-9 px-4 rounded-xl bg-amber-400 text-black text-[11px] font-black disabled:opacity-40 active:scale-95 transition-all">
                {promoValidating ? <Loader2 className="w-3 h-3 animate-spin" /> : "Apply"}
              </button>
              <button type="button" aria-label="Close promo" onClick={() => { setPromoOpen(false); setPromoCode(""); setPromoResult(null); }}
                className="h-9 w-9 rounded-xl bg-white/5 text-white/30 hover:text-white flex items-center justify-center">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {promoResult && !promoResult.valid && (
            <p className="text-[10px] font-bold text-red-400 mt-1.5">{promoResult.error || "Invalid promo code"}</p>
          )}
        </div>

        {/* Trust strip */}
        <div className="flex items-center gap-2 pt-1">
          <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
          <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Secured by Paystack · Instant Delivery</span>
        </div>
      </div>
    </div>
  );

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
        <div className="h-14 border-b border-white/8 flex items-center px-4 gap-3 bg-black/40">
          <Skeleton className="h-8 w-8 rounded-xl bg-white/8" />
          <Skeleton className="h-4 w-36 bg-white/8" />
          <div className="ml-auto"><Skeleton className="h-8 w-20 rounded-xl bg-white/8" /></div>
        </div>
        <div className="flex-1 px-4 pt-6 max-w-lg mx-auto w-full space-y-6">
          <Skeleton className="h-28 w-full rounded-3xl bg-white/8" />
          <div className="flex gap-2">
            {[1,2,3].map(i => <Skeleton key={i} className="flex-1 h-11 rounded-2xl bg-white/8" />)}
          </div>
          <div className="flex gap-2">
            {[1,2,3].map(i => <Skeleton key={i} className="flex-1 h-14 rounded-2xl bg-white/8" />)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({length:6}).map((_,i) => <Skeleton key={i} className="h-36 rounded-3xl bg-white/8" />)}
          </div>
        </div>
      </div>
    );
  }

  // ── Not found ──
  if (notFound || !agent) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-6 text-white">
        <TraditionalBackground className="fixed inset-0 z-0 opacity-[0.06]" />
        <div className="relative z-10 text-center max-w-xs">
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-5">
            <Zap className="w-8 h-8 text-white/20" />
          </div>
          <h1 className="text-2xl font-black mb-2">Store Not Found</h1>
          <p className="text-white/40 text-sm mb-6 leading-relaxed">This store doesn't exist or hasn't been activated by an agent yet.</p>
          <Link to="/buy-data" className="inline-flex items-center gap-2 bg-amber-400 text-black font-black px-6 py-3 rounded-2xl text-sm">
            Go to Main Store <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white selection:bg-amber-400/30 flex flex-col">
      {/* Background */}
      <TraditionalBackground className="fixed inset-0 z-0 opacity-[0.07] dark:opacity-[0.12]" />

      {/* Ambient glow */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full blur-[100px] transition-colors duration-1000"
          style={{ backgroundColor: `${accentColor}18` }}
        />
        <div
          className="absolute bottom-0 right-0 w-[300px] h-[300px] rounded-full blur-[80px] transition-colors duration-1000"
          style={{ backgroundColor: `${netConf.color}10` }}
        />
      </div>

      <StoreVisitorPopup
        agentSlug={slug}
        showSubAgentLink={!agent.is_sub_agent}
        storeName={agent.store_name}
        logoUrl={agent.store_logo_url}
        primaryColor={accentColor}
      />

      {/* Navbar */}
      <StoreNavbar
        storeName={agent.store_name}
        agentSlug={slug}
        networkAccent={netConf.color}
        whatsappNumber={agent.whatsapp_number}
        whatsappGroupLink={agent.whatsapp_group_link ?? undefined}
        supportNumber={agent.support_number}
        email={agent.email}
        showSubAgentLink={!agent.is_sub_agent}
        logoUrl={agent.store_logo_url ?? undefined}
        onOpenAuth={() => setAuthOpen(true)}
        customerBalance={customerBalance}
        isCustomerLoggedIn={isCustomerLoggedIn}
        customerName={customerName}
        onSignOut={signOut}
      />

      {/* Main content */}
      <main className="relative z-10 flex-1 max-w-lg mx-auto w-full px-4 pt-4 pb-24">

        {/* ── Unique Storefront Welcome Hero Card ── */}
        <div
          className="rounded-3xl p-6 mb-5 relative overflow-hidden border border-white/8 backdrop-blur-md shadow-2xl"
          style={{ background: `linear-gradient(135deg, ${accentColor}18 0%, ${accentColor}03 100%)` }}
        >
          {/* Ambient Glow Dot */}
          <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl opacity-20 pointer-events-none" style={{ backgroundColor: accentColor }} />
          
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2.5 py-0.5 text-[9px] font-black tracking-wider text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full uppercase">
              {greeting}
            </span>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Active Server</span>
            </div>
          </div>

          <h2 className="text-2xl font-black text-white tracking-tight leading-tight mb-2">
            Instant & Cheap Data Bundles
          </h2>
          <p className="text-white/40 text-xs font-semibold leading-normal mb-5">
            Purchase super-fast internet bundles for MTN, Telecel, and AirtelTigo with no expiry. Secure, direct payments.
          </p>

          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.03] border border-white/6 backdrop-blur-md">
            <div className="flex items-center gap-2.5 min-w-0">
              {agent.store_logo_url ? (
                <img src={agent.store_logo_url} alt="logo" className="w-8 h-8 rounded-xl object-cover border border-white/10 shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-xl flex items-center justify-center border border-white/10 shrink-0" style={{ backgroundColor: `${accentColor}25` }}>
                  <Store className="w-4 h-4" style={{ color: accentColor }} />
                </div>
              )}
              <div className="leading-tight min-w-0">
                <p className="font-black text-xs text-white truncate max-w-[120px]">{agent.store_name}</p>
                <p className="text-[8px] font-black uppercase tracking-widest text-white/30">Verified Partner</p>
              </div>
            </div>
            
            {agent.whatsapp_number && (
              <a
                href={`https://wa.me/${agent.whatsapp_number.replace(/\D+/g, "")}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-[10px] font-black uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/20 active:scale-95 shrink-0"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                Chat Support
              </a>
            )}
          </div>
        </div>

        {/* ── Customer Account Dashboard Card ── */}
        {isCustomerLoggedIn && (
          <div className="bg-white/5 border border-white/8 rounded-3xl p-5 mb-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl opacity-30" style={{ background: accentColor }} />
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] font-black text-white/30 uppercase tracking-widest leading-none">Store Wallet Portal</p>
                <p className="text-white text-base font-black truncate mt-1.5 leading-tight">{customerName}</p>
              </div>
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full text-black uppercase tracking-wider leading-none" style={{ backgroundColor: accentColor }}>Logged In</span>
            </div>
            
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/6">
              <div className="bg-white/4 rounded-2xl p-3">
                <p className="text-[9px] text-white/40 font-bold uppercase leading-none">Your Balance</p>
                <p className="text-lg font-black text-white mt-1.5 leading-none font-mono">GHS {Number(customerBalance).toFixed(2)}</p>
              </div>
              
              <button
                type="button"
                onClick={() => setDepositOpen(true)}
                className="rounded-2xl flex flex-col items-center justify-center gap-1 active:scale-[0.98] transition-all hover:brightness-110 border-0"
                style={{ backgroundColor: accentColor, color: "#000000" }}
              >
                <CreditCard className="w-5 h-5 shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-wider leading-none">Deposit Funds</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Service tabs ── */}
        <div className="flex gap-1.5 p-1 rounded-2xl bg-white/4 border border-white/8 mb-4">
          {[
            { id: "data",    label: "Data",    icon: Wifi },
            { id: "airtime", label: "Airtime", icon: Smartphone },
            { id: "utility", label: "Bills",   icon: Zap },
          ].map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => { setSelectedService(s.id as ServiceType); setSelectedPkg(null); setAirtimeAmount(""); setUtilityAmount(""); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all ${
                selectedService === s.id
                  ? "text-black shadow-md"
                  : "text-white/40 hover:text-white/60"
              }`}
              style={selectedService === s.id ? { backgroundColor: accentColor } : {}}
            >
              <s.icon className="w-3.5 h-3.5" />
              {s.label}
            </button>
          ))}
        </div>

        {/* ── Network tabs (Data & Airtime) ── */}
        {(selectedService === "data" || selectedService === "airtime") && (
          <div className="flex gap-2 mb-4">
            {NETWORKS.map((n) => {
              const nc = NETWORK_CONFIG[n];
              const active = selectedNetwork === n;
              return (
                <button
                  type="button"
                  key={n}
                  onClick={() => { setSelectedNetwork(n); setSelectedPkg(null); }}
                  className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-wide border transition-all ${
                    active ? `${nc.bg} ${nc.textClass} ${nc.borderClass} shadow-lg` : "bg-white/4 border-white/8 text-white/50 hover:text-white/70"
                  }`}
                  style={active ? { boxShadow: `0 8px 24px ${nc.color}30` } : {}}
                >
                  {n}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Data packages grid ── */}
        {selectedService === "data" && (() => {
          // Group packages into rows of 2 so we can inject the panel after the correct row
          const rows: typeof packages[] = [];
          for (let i = 0; i < packages.length; i += 2) rows.push(packages.slice(i, i + 2));
          const selectedRowIdx = selectedPkg
            ? Math.floor(packages.findIndex(p => p.size === selectedPkg.size) / 2)
            : -1;

          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <p className="text-sm font-black text-white/70">{selectedNetwork} Bundles</p>
                <p className="text-[10px] font-bold text-white/25 uppercase tracking-widest">Tap to select</p>
              </div>

              <div className="space-y-3">
                {rows.map((row, rowIdx) => (
                  <div key={rowIdx} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      {row.map((pkg) => {
                        const isSelected = selectedPkg?.size === pkg.size;
                        return (
                          <button
                            type="button"
                            key={pkg.size}
                            onClick={() => handleCardClick(pkg.size, pkg.price)}
                            className={`relative rounded-3xl p-4 text-left transition-all duration-300 border overflow-hidden ${
                              isSelected
                                ? "scale-[1.02] shadow-2xl border-white/30"
                                : "border-white/6 hover:border-white/15 active:scale-[0.97]"
                            }`}
                            style={{
                              background: isSelected
                                ? `linear-gradient(135deg, ${netConf.color}, ${netConf.color}cc)`
                                : `linear-gradient(135deg, ${netConf.color}18, ${netConf.color}08)`,
                              boxShadow: isSelected ? `0 10px 28px ${netConf.color}30` : undefined,
                            }}
                          >
                            {isSelected && (
                              <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-white flex items-center justify-center shadow">
                                <CheckCircle2 className="w-3.5 h-3.5 text-black" />
                              </div>
                            )}
                            {pkg.popular && !isSelected && (
                              <div className="absolute top-3 right-3">
                                <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                              </div>
                            )}
                            <p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${isSelected ? (selectedNetwork === "MTN" ? "text-black/50" : "text-white/50") : "text-white/30"}`}>
                              {selectedNetwork}
                            </p>
                            <p className={`text-3xl font-black tracking-tighter leading-none mb-3 ${isSelected ? (selectedNetwork === "MTN" ? "text-black" : "text-white") : "text-white"}`}>
                              {pkg.size}
                            </p>
                            <div className={`pt-3 border-t ${isSelected ? (selectedNetwork === "MTN" ? "border-black/15" : "border-white/15") : "border-white/8"}`}>
                              <p className={`text-lg font-black ${isSelected ? (selectedNetwork === "MTN" ? "text-black" : "text-white") : "text-white/80"}`}>
                                ₵{pkg.price.toFixed(2)}
                              </p>
                              <p className={`text-[9px] font-bold mt-0.5 ${isSelected ? (selectedNetwork === "MTN" ? "text-black/40" : "text-white/40") : "text-white/25"}`}>
                                Instant delivery
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {/* Panel injected right after the row containing the selected package */}
                    {selectedPkg && rowIdx === selectedRowIdx && renderPurchasePanel()}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── Airtime Coming Soon ── */}
        {selectedService === "airtime" && (
          <div className="rounded-3xl border border-white/8 overflow-hidden" style={{ background: "#111116" }}>
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 border border-white/10"
                style={{ backgroundColor: `${accentColor}18` }}>
                <Smartphone className="w-7 h-7" style={{ color: accentColor }} />
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-400/20 bg-amber-400/8 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Coming Soon</span>
              </div>
              <h3 className="text-lg font-black text-white mb-1">Airtime Top-up</h3>
              <p className="text-sm text-white/30 font-medium leading-relaxed max-w-[220px]">
                Airtime purchase will be available very soon. Check back shortly.
              </p>
            </div>
          </div>
        )}

        {/* ── Utility Coming Soon ── */}
        {selectedService === "utility" && (
          <div className="rounded-3xl border border-white/8 overflow-hidden" style={{ background: "#111116" }}>
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 border border-white/10"
                style={{ backgroundColor: `${accentColor}18` }}>
                <Zap className="w-7 h-7" style={{ color: accentColor }} />
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-400/20 bg-amber-400/8 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Coming Soon</span>
              </div>
              <h3 className="text-lg font-black text-white mb-1">Utility Bills</h3>
              <p className="text-sm text-white/30 font-medium leading-relaxed max-w-[220px]">
                ECG & GWCL bill payments are on the way. We'll notify you when it's live.
              </p>
            </div>
          </div>
        )}

        {/* ── Order Tracker ── */}
        <div className="mt-8" id="track-section">
          <PhoneOrderTracker
            title="Track Your Order"
            subtitle="Enter your number to check delivery status."
          />
        </div>

        {/* ── Sub-agent CTA (for main agents only) ── */}
        {!agent.is_sub_agent && (
          <div
            className="mt-8 rounded-3xl p-5 border border-white/8 relative overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${accentColor}18, transparent)` }}
          >
            <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: accentColor }}>Reseller Opportunity</p>
            <h3 className="text-xl font-black text-white mb-1">Start Your Own Store</h3>
            <p className="text-white/40 text-sm mb-4 leading-relaxed">
              Earn profits reselling under <span className="text-white/60 font-bold">{agent.store_name}</span>.
              {subAgentBaseFee !== null && <> Activation fee: <span className="text-white font-black">₵{subAgentBaseFee.toFixed(2)}</span>.</>}
            </p>
            <Link
              to={`/store/${slug}/sub-agent`}
              className="inline-flex items-center gap-2 font-black text-sm px-5 py-2.5 rounded-2xl text-black transition-all hover:opacity-90 active:scale-95"
              style={{ backgroundColor: accentColor }}
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {/* ── Footer ── */}
        <footer className="mt-10 pt-6 border-t border-white/6 text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ backgroundColor: accentColor }}>
              <Store className="w-3.5 h-3.5 text-black" />
            </div>
            <span className="font-black text-sm text-white">{agent.store_name}</span>
          </div>
          <div className="flex items-center justify-center gap-4">
            {agent.whatsapp_number && (
              <a href={`https://wa.me/${agent.whatsapp_number.replace(/\D+/g, "")}`} className="text-[11px] text-white/30 hover:text-white transition-colors font-bold">WhatsApp</a>
            )}
            {agent.support_number && (
              <a href={`tel:${agent.support_number}`} className="text-[11px] text-white/30 hover:text-white transition-colors font-bold">{agent.support_number}</a>
            )}
          </div>
          <p className="text-[10px] text-white/15 font-bold pt-1">© {new Date().getFullYear()} {agent.store_name} · Secure Payments by Paystack</p>
        </footer>
      </main>


      {/* ── Success overlay ── */}
      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-in fade-in duration-500">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-3xl" />
          <div className="relative max-w-xs w-full bg-white/4 border border-white/10 rounded-3xl p-8 text-center space-y-5 animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center mx-auto shadow-[0_0_40px_rgba(16,185,129,0.4)]">
              <CheckCircle2 className="w-10 h-10 text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-black text-white mb-2">Done!</h2>
              <p className="text-white/40 text-sm leading-relaxed">
                Your <strong className="text-emerald-400">{selectedPkg?.size} {selectedNetwork}</strong> bundle is on its way. Check your phone shortly!
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setShowSuccessOverlay(false); setSelectedPkg(null); setPhone(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false); }}
              className="w-full py-3 rounded-2xl bg-white/6 border border-white/10 text-white font-black text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Store Authentication Modal Overlay ── */}
      <StoreAuth
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        agentId={agent.user_id}
        storeName={agent.store_name}
        primaryColor={accentColor}
      />

      {/* ── Manual MoMo Deposit Modal ── */}
      {depositOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-md" onClick={() => setDepositOpen(false)} />
          <div className="relative max-w-sm w-full bg-[#111116] border border-white/10 rounded-3xl p-6 text-left space-y-5 animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setDepositOpen(false)}
              className="absolute top-4 right-4 text-white/40 hover:text-white/80 p-1"
            >
              <X className="w-4 h-4" />
            </button>

            <div>
              <h3 className="text-lg font-black text-white">Fund Your Wallet</h3>
              <p className="text-[10px] text-white/40 font-bold uppercase mt-0.5 tracking-wider">Send MoMo · Submit Reference · Agent Approves</p>
            </div>

            {/* Step hint */}
            <div className="bg-amber-400/8 border border-amber-400/20 rounded-2xl p-3 space-y-1">
              <p className="text-[10px] font-black text-amber-400 uppercase tracking-wider">How it works</p>
              <ol className="text-[11px] text-white/50 space-y-0.5 list-decimal list-inside">
                <li>Send MoMo to agent: <span className="text-white font-bold">{agent.momo_number || "—"}</span></li>
                <li>Fill in the form below with your details</li>
                <li>Agent confirms and credits your balance</li>
              </ol>
            </div>

            {/* Deposit Form */}
            <form onSubmit={handleManualDeposit} className="space-y-4">
              {/* Amount */}
              <div>
                <label className="block text-[10px] font-black uppercase text-white/40 mb-1.5 tracking-wider">Amount Sent (GHS)</label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-sm font-black">₵</div>
                  <input
                    type="number"
                    required
                    min="1"
                    step="0.01"
                    placeholder="e.g. 50.00"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="w-full h-12 rounded-2xl bg-white/5 border border-white/8 pl-9 pr-4 text-sm font-bold text-white focus:outline-none focus:border-amber-400 transition-colors"
                  />
                </div>
              </div>

              {/* Sender number */}
              <div>
                <label className="block text-[10px] font-black uppercase text-white/40 mb-1.5 tracking-wider">Your MoMo Number</label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. 0244000000"
                  value={depositPhone}
                  onChange={(e) => setDepositPhone(e.target.value)}
                  className="w-full h-12 rounded-2xl bg-white/5 border border-white/8 px-4 text-sm font-bold text-white focus:outline-none focus:border-amber-400 transition-colors"
                />
              </div>

              {/* Transaction reference */}
              <div>
                <label className="block text-[10px] font-black uppercase text-white/40 mb-1.5 tracking-wider">Transaction Reference / ID</label>
                <input
                  type="text"
                  required
                  placeholder="From your MoMo SMS"
                  value={depositTxRef}
                  onChange={(e) => setDepositTxRef(e.target.value)}
                  className="w-full h-12 rounded-2xl bg-white/5 border border-white/8 px-4 text-sm font-bold text-white focus:outline-none focus:border-amber-400 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={submittingDeposit || !depositAmount || !depositPhone || !depositTxRef}
                className="w-full h-12 rounded-2xl font-black text-xs uppercase tracking-widest text-black flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 border-0"
                style={{ backgroundColor: accentColor }}
              >
                {submittingDeposit ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Submit Deposit Request
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Floating WhatsApp ── */}
      {agent.whatsapp_number && (
        <a
          href={`https://wa.me/${agent.whatsapp_number.replace(/\D+/g, "")}`}
          target="_blank" rel="noopener noreferrer"
          aria-label={`Chat with ${agent.store_name} on WhatsApp`}
          className="fixed right-4 bottom-6 z-[100] transition-all duration-300"
        >
          <div className="w-12 h-12 rounded-2xl bg-[#25D366] flex items-center justify-center shadow-xl shadow-emerald-500/30 hover:scale-110 active:scale-95 transition-all">
            <MessageCircle className="w-6 h-6 text-white fill-white/20" />
          </div>
        </a>
      )}

      {/* ── Store Owner Admin Portal Access Button ── */}
      {profile && (profile.user_id === agent?.user_id || profile.is_agent || profile.is_sub_agent) && (
        <Link
          to={profile.user_id === agent?.user_id ? "/dashboard/my-store" : "/dashboard"}
          className="fixed left-4 bottom-6 z-[100] animate-bounce shrink-0 select-none outline-none"
        >
          <div className="flex items-center gap-2 h-12 px-4 rounded-2xl bg-amber-400 text-black shadow-xl shadow-amber-400/25 hover:scale-105 active:scale-95 transition-all font-black text-xs uppercase tracking-widest border border-amber-500/30">
            <Store className="w-5 h-5 shrink-0 animate-pulse" />
            {profile.user_id === agent?.user_id ? "Manage Storefront" : "Reseller Dashboard"}
          </div>
        </Link>
      )}
    </div>
  );
};

export default AgentStore;
