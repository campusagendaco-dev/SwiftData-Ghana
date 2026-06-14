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
  Smartphone, Package, Clock, ArrowRight, Wifi, Star, History
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import StoreAuth from "@/components/StoreAuth";
import StoreDepositFlow from "@/components/StoreDepositFlow";
import StoreTransactionHistory from "@/components/StoreTransactionHistory";
import StoreManagementOverlay from "@/components/StoreManagementOverlay";
import { playSuccessSound } from "@/lib/sound";
import { PaystackMomoCheckout } from "@/components/PaystackMomoCheckout";

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
  sub_agent_prices?: Record<string, Record<string, string | number>>;
  registered_user_prices?: Record<string, Record<string, string | number>>;
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
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutMetadata, setCheckoutMetadata] = useState<any>(null);

  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("auth") === "login") {
      setAuthOpen(true);
    }
  }, [searchParams]);
  const [depositOpen, setDepositOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<"wallet" | "paystack">("paystack");

  const [customerWalletBalance, setCustomerWalletBalance] = useState<number>(0);

  const fetchWalletBalance = useCallback(async () => {
    if (profile?.user_id) {
      const { data } = await supabase.from("wallets").select("balance").eq("agent_id", profile.user_id).maybeSingle();
      if (data) {
        setCustomerWalletBalance(Number(data.balance));
      } else {
        setCustomerWalletBalance(0);
      }
    }
  }, [profile?.user_id]);

  useEffect(() => {
    fetchWalletBalance();
  }, [fetchWalletBalance]);

  const isCustomerLoggedIn = Boolean(
    profile && 
    (profile.parent_agent_id === agent?.user_id || profile.user_id === agent?.user_id)
  );
  const customerBalance = customerWalletBalance;
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
          agent_id: agent?.user_id,
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
          console.error("Payment verification failed");
        });
    }
  }, [refreshProfile, toast]);

  const [parentAssignedPrices, setParentAssignedPrices] = useState<Record<string, Record<string, string | number>>>({});
  const [globalSettings, setGlobalSettings] = useState<Record<string, GlobalPkgSetting>>({});
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
          .select("user_id, store_name, full_name, whatsapp_number, support_number, email, whatsapp_group_link, agent_prices, sub_agent_prices, registered_user_prices, disabled_packages, is_agent, is_sub_agent, agent_approved, sub_agent_approved, parent_agent_id, sub_agent_activation_markup, store_logo_url, store_primary_color, slug, custom_domain");

        if (slug && slug !== "undefined" && slug !== "null") {
          storeQuery = storeQuery.eq("slug", slug);
        } else if (activeDomain) {
          storeQuery = storeQuery.eq("custom_domain", activeDomain);
        } else {
          setNotFound(true);
          setLoading(false);
          return;
        }

        let agentRes;
        let pkgRes;
        let pricingCtx;

        try {
          const [res, pkgResData, pricingCtxData] = await Promise.all([
            storeQuery.maybeSingle(),
            supabase.from("global_package_settings").select("network, package_size, agent_price, sub_agent_price, public_price, is_unavailable"),
            fetchApiPricingContext().catch(() => ({ source: "primary", multipliers: { MTN: 1, Telecel: 1, AirtelTigo: 1 }, multiplier: 1 })),
          ]);
          
          pkgRes = pkgResData;
          pricingCtx = pricingCtxData;

          if (res.error) {
            const errMsg = res.error.message || "";
            const errDet = res.error.details || "";
            if (errMsg.includes("registered_user_prices") || errDet.includes("registered_user_prices")) {
              console.warn("[AgentStore] registered_user_prices column missing in view, retrying without it");
              let fallbackQuery = supabase
                .from("agent_stores")
                .select("user_id, store_name, full_name, whatsapp_number, support_number, email, whatsapp_group_link, agent_prices, sub_agent_prices, disabled_packages, is_agent, is_sub_agent, agent_approved, sub_agent_approved, parent_agent_id, sub_agent_activation_markup, store_logo_url, store_primary_color, slug, custom_domain");
              
              if (slug && slug !== "undefined" && slug !== "null") {
                fallbackQuery = fallbackQuery.eq("slug", slug);
              } else if (activeDomain) {
                fallbackQuery = fallbackQuery.eq("custom_domain", activeDomain);
              }
              
              const fallbackRes = await fallbackQuery.maybeSingle();
              if (fallbackRes.error) {
                setNotFound(true);
                setLoading(false);
                return;
              }
              agentRes = fallbackRes;
            } else {
              setNotFound(true);
              setLoading(false);
              return;
            }
          } else {
            agentRes = res;
          }
        } catch (err) {
          console.error("Error executing store queries:", err);
          setNotFound(true);
          setLoading(false);
          return;
        }

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
            .from("agent_stores").select("sub_agent_prices, agent_prices").eq("user_id", profile.parent_agent_id).maybeSingle();
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
    
    const agentGuestPrice = Number(agent.agent_prices?.[network]?.[size]);
    const agentCustomerPrice = Number((agent as any).registered_user_prices?.[network]?.[size]);
    
    // Use customer pricing if the user is logged in (and is not the owner)
    const isCustomer = profile && profile.user_id !== agent.user_id;
    let activePrice = agentGuestPrice;
    
    if (isCustomer && Number.isFinite(agentCustomerPrice) && agentCustomerPrice > 0) {
      activePrice = agentCustomerPrice;
    }

    if (agent.is_sub_agent) {
      const base = Math.max(
        Number.isFinite(parentAssigned) ? parentAssigned : 0,
        Number.isFinite(activePrice) ? activePrice : 0
      );
      if (base > 0) return applyPriceMultiplier(base, multiplier);
    } else {
      if (Number.isFinite(activePrice) && activePrice > 0) return applyPriceMultiplier(activePrice, multiplier);
    }
    const gs = globalSettings[`${network}-${size}`];
    let gsBase = Number(gs?.agent_price) > 0 ? Number(gs!.agent_price) : Number(gs?.public_price);
    if (agent.is_sub_agent) {
      const gsSub = Number(gs?.sub_agent_price);
      if (Number.isFinite(gsSub) && gsSub > 0) gsBase = gsSub;
    }
    if (Number.isFinite(gsBase) && gsBase > 0) return applyPriceMultiplier(gsBase, multiplier);
    return applyPriceMultiplier(fallbackPrice, multiplier);
  }, [agent, globalSettings, parentAssignedPrices, priceMultipliers, profile]);

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

    const orderId = crypto.randomUUID();
    const orderType = selectedService === "utility" ? "utility" : selectedService === "airtime" ? "airtime" : "data";
    const packageSize = selectedService === "data" ? selectedPkg?.size : selectedService === "airtime" ? `${airtimeAmount} GHS Airtime` : `${utilityType} Bill`;
    const callbackParams = new URLSearchParams({
      reference: orderId, network: selectedNetwork, package: packageSize || "", phone: phoneDigits,
      ...(slug ? { slug } : {}),
    });

    const meta = {
      order_id: orderId,
      order_type: orderType,
      network: selectedNetwork,
      package_size: packageSize,
      customer_phone: phoneDigits,
      fee,
      agent_id: agent.user_id,
      payment_source: "agent_store",
      callback_url: slug
        ? `${window.location.origin}/store/${slug}/order-status?${callbackParams.toString()}`
        : `${window.location.origin}/order-status?${callbackParams.toString()}`,
      ...(validPromo && !validPromo.is_free ? { promo_code: promoCode.trim(), promo_id: validPromo.promo_id, discount_percentage: validPromo.discount_percentage } : {}),
      ...(selectedService === "utility" ? { bill_type: utilityType, customer_number: utilityNumber } : {}),
    };

    setCheckoutMetadata(meta);
    setCheckoutOpen(true);
  };

  const handleCheckoutSuccess = (ref: string) => {
    setCheckoutOpen(false);
    setSelectedPkg(null);
    setPhone("");
    setPromoCode("");
    setPromoResult(null);
    setAirtimeAmount("");
    setUtilityNumber("");
    setUtilityAmount("");
    
    const orderType = selectedService === "utility" ? "utility" : selectedService === "airtime" ? "airtime" : "data";
    const packageSize = selectedService === "data" ? selectedPkg?.size : selectedService === "airtime" ? `${airtimeAmount} GHS Airtime` : `${utilityType} Bill`;
    
    const callbackParams = new URLSearchParams({
      reference: ref,
      network: selectedNetwork,
      package: packageSize || "",
      phone: phoneDigits,
      ...(slug ? { slug } : {}),
    });
    
    window.location.href = slug
      ? `${window.location.origin}/store/${slug}/order-status?${callbackParams.toString()}`
      : `${window.location.origin}/order-status?${callbackParams.toString()}`;
  };

  const handleCheckoutFailure = (error: string) => {
    setBuying(false);
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
      className="animate-in fade-in slide-in-from-top-2 duration-400 rounded-[28px] overflow-hidden border border-white/20 backdrop-blur-2xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] relative z-20"
      style={{ background: "linear-gradient(180deg, rgba(28,28,30,0.85) 0%, rgba(10,10,15,0.95) 100%)" }}
    >
      {/* Inner Highlight for depth */}
      <div className="absolute inset-0 rounded-[28px] pointer-events-none ring-1 ring-inset ring-white/10" />

      {/* Connector notch */}
      <div className="flex px-5 pt-4 pb-2 relative z-10">
        <div
          className="w-1.5 rounded-full mr-4 shrink-0 shadow-[0_0_10px_rgba(255,255,255,0.2)]"
          style={{ backgroundColor: netConf.color, minHeight: "100%", alignSelf: "stretch" }}
        />
        <div className="flex-1 flex items-center justify-between">
          <div>
            <p className="text-base font-black text-white leading-tight flex items-center gap-2 tracking-tight">
              {selectedService === "data"
                ? `${selectedNetwork} · ${selectedPkg?.size}`
                : selectedService === "airtime"
                ? `${selectedNetwork} Airtime`
                : `${utilityType} Bill`}
              {isFreePromo && (
                <span className="text-[10px] bg-emerald-500 text-black font-black px-2 py-0.5 rounded-full shadow-md">FREE</span>
              )}
            </p>
            <p className="text-[13px] font-bold mt-1 text-white/50">
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
            className="w-8 h-8 rounded-[12px] bg-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/20 transition-all ml-3 shrink-0 active:scale-95 shadow-inner border border-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 my-4 border-t border-white/10 relative z-10" />

      {/* Phone + Pay */}
      <div className="px-5 pb-5 space-y-4 relative z-10">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Phone className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors pointer-events-none z-10 ${isPhoneValid ? "text-emerald-400" : "text-white/30"}`} />
            <input
              ref={phoneInputRef}
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Recipient number  0XX XXX XXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={12}
              className="w-full h-14 rounded-[18px] pl-11 pr-4 text-sm font-black text-white placeholder:text-white/30 focus:outline-none transition-all border shadow-inner tracking-wide"
              style={{
                background: "rgba(255,255,255,0.05)",
                borderColor: isPhoneValid ? `${netConf.color}80` : "rgba(255,255,255,0.12)",
                boxShadow: isPhoneValid ? `0 0 0 2px ${netConf.color}20 inset` : "0 2px 4px rgba(0,0,0,0.2) inset",
                WebkitTextFillColor: "white",
              }}
            />
          </div>

          {isFreePromo ? (
            <button
              type="button"
              onClick={handleClaimFree}
              disabled={claiming || !isPhoneValid}
              className="shrink-0 h-14 px-5 rounded-[18px] bg-emerald-500 text-black font-black text-[13px] uppercase tracking-wide disabled:opacity-40 flex items-center gap-2 active:scale-95 transition-all shadow-[0_4px_15px_rgba(16,185,129,0.3)]"
            >
              {claiming ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Gift className="w-4 h-4" />Claim</>}
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePay}
              disabled={buying || (isCustomerLoggedIn && payMethod === "wallet" && customerBalance < total)}
              className="shrink-0 h-14 px-5 rounded-[18px] font-black text-[13px] uppercase tracking-wide flex items-center gap-2 active:scale-[0.96] transition-all whitespace-nowrap"
              style={{
                backgroundColor: netConf.color,
                color: netConf.textClass === "text-black" ? "#000" : "#fff",
                opacity: (!isPhoneValid || buying || (isCustomerLoggedIn && payMethod === "wallet" && customerBalance < total)) ? 0.5 : 1,
                boxShadow: (isPhoneValid && !(isCustomerLoggedIn && payMethod === "wallet" && customerBalance < total)) ? `0 8px 25px ${netConf.color}50` : "none",
                textShadow: netConf.textClass === "text-white" ? "0 2px 4px rgba(0,0,0,0.3)" : "none"
              }}
            >
              {buying ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isCustomerLoggedIn && payMethod === "wallet" ? (
                <><CreditCard className="w-4 h-4" />Pay ₵{total.toFixed(2)}</>
              ) : (
                <><CreditCard className="w-4 h-4 drop-shadow-sm" />Pay ₵{total.toFixed(2)}</>
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
          <p className="text-white/40 text-sm leading-relaxed">This store doesn't exist or hasn't been activated by an agent yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050508] text-white selection:bg-white/30 flex flex-col relative">
      {/* Traditional Pattern Background */}
      <TraditionalBackground className="fixed inset-0 z-0 opacity-20 dark:opacity-20" />

      {/* Dynamic Mesh Gradients */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden opacity-70">
        <div
          className="absolute -top-[20%] -left-[10%] w-[70vw] h-[70vw] rounded-full mix-blend-screen blur-[120px] opacity-40 transition-colors duration-[1500ms]"
          style={{ backgroundColor: accentColor }}
        />
        <div
          className="absolute top-[30%] -right-[20%] w-[60vw] h-[60vw] rounded-full mix-blend-screen blur-[100px] opacity-30 transition-colors duration-[1500ms]"
          style={{ backgroundColor: netConf.color }}
        />
        <div
          className="absolute -bottom-[10%] left-[20%] w-[80vw] h-[50vw] rounded-full mix-blend-screen blur-[120px] opacity-20 transition-colors duration-[1500ms]"
          style={{ backgroundColor: accentColor }}
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
          className="rounded-[32px] p-7 mb-6 relative overflow-hidden border border-white/10 backdrop-blur-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)]"
          style={{ background: `linear-gradient(135deg, ${accentColor}15 0%, rgba(255,255,255,0.02) 100%)` }}
        >
          {/* Ambient Glow Dot */}
          <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-30 pointer-events-none" style={{ backgroundColor: accentColor }} />
          <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full blur-3xl opacity-20 pointer-events-none" style={{ backgroundColor: accentColor }} />
          
          <div className="flex items-center gap-2 mb-4 relative z-10">
            <span className="px-3 py-1 text-[10px] font-black tracking-widest text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full uppercase shadow-inner">
              {greeting}
            </span>
            <div className="flex items-center gap-1.5 px-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Active System</span>
            </div>
          </div>

          <h2 className="text-3xl font-black text-white tracking-tight leading-none mb-3 relative z-10 drop-shadow-md">
            Premium Data <br/> & Connectivity.
          </h2>
          <p className="text-white/60 text-[13px] font-semibold leading-relaxed mb-3 max-w-[280px] relative z-10">
            Purchase ultra-fast internet bundles for MTN, Telecel, and AirtelTigo. Instant fulfillment.
          </p>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/20 text-[11px] font-black uppercase tracking-wider mb-6 relative z-10 backdrop-blur-md">
            <Clock className="w-3.5 h-3.5 text-rose-400" />
            <span>Est. delivery: Less than 10 mins.</span>
          </div>

          <div className="flex items-center justify-between p-4 rounded-[24px] bg-white/[0.05] border border-white/10 backdrop-blur-xl shadow-inner relative z-10">
            <div className="flex items-center gap-3 min-w-0">
              {agent.store_logo_url ? (
                <img src={agent.store_logo_url} alt="logo" className="w-10 h-10 rounded-[14px] object-cover border border-white/20 shrink-0 shadow-lg" />
              ) : (
                <div className="w-10 h-10 rounded-[14px] flex items-center justify-center border border-white/20 shrink-0 shadow-inner" style={{ backgroundColor: `${accentColor}30` }}>
                  <Store className="w-5 h-5" style={{ color: accentColor }} />
                </div>
              )}
              <div className="leading-tight min-w-0">
                <p className="font-black text-sm text-white truncate max-w-[120px] tracking-tight">{agent.store_name}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <ShieldCheck className="w-3 h-3 text-[#25D366]" />
                  <p className="text-[9px] font-black uppercase tracking-widest text-white/50">Verified Partner</p>
                </div>
              </div>
            </div>
            
            {agent.whatsapp_number && (
              <a
                href={`https://wa.me/${agent.whatsapp_number.replace(/\D+/g, "")}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-[14px] bg-[#25D366] hover:bg-[#20bd5a] text-black text-[11px] font-black tracking-wide transition-all shadow-[0_4px_15px_rgba(37,211,102,0.3)] active:scale-95 shrink-0"
              >
                <MessageCircle className="w-4 h-4 fill-black/20" />
                Support
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
              <button onClick={() => setHistoryOpen(true)} className="text-[10px] font-black px-3 py-1.5 rounded-xl text-black uppercase tracking-wider flex items-center gap-1 hover:brightness-110 transition-all active:scale-95" style={{ backgroundColor: accentColor }}>
                <History className="w-3.5 h-3.5" /> History
              </button>
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
        <div className="flex gap-1.5 p-1.5 rounded-[20px] bg-white/[0.03] border border-white/10 mb-6 backdrop-blur-xl shadow-inner relative z-10">
          {[
            { id: "data",    label: "Data",    icon: Wifi },
            { id: "airtime", label: "Airtime", icon: Smartphone },
            { id: "utility", label: "Bills",   icon: Zap },
          ].map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => { setSelectedService(s.id as ServiceType); setSelectedPkg(null); setAirtimeAmount(""); setUtilityAmount(""); }}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-[16px] text-xs font-black uppercase tracking-wide transition-all active:scale-[0.98] ${
                selectedService === s.id
                  ? "text-black shadow-[0_4px_12px_rgba(0,0,0,0.3)] bg-white"
                  : "text-white/40 hover:text-white/70 hover:bg-white/5"
              }`}
              style={selectedService === s.id ? { backgroundColor: accentColor } : {}}
            >
              <s.icon className={`w-4 h-4 ${selectedService === s.id ? "drop-shadow-sm" : ""}`} />
              {s.label}
            </button>
          ))}
        </div>

        {/* ── Network tabs (Data & Airtime) ── */}
        {(selectedService === "data" || selectedService === "airtime") && (
          <div className="flex gap-2.5 mb-6 relative z-10">
            {NETWORKS.map((n) => {
              const nc = NETWORK_CONFIG[n];
              const active = selectedNetwork === n;
              return (
                <button
                  type="button"
                  key={n}
                  onClick={() => { setSelectedNetwork(n); setSelectedPkg(null); }}
                  className={`flex-1 py-3.5 rounded-[18px] text-[11px] font-black uppercase tracking-widest border transition-all active:scale-[0.96] ${
                    active ? `${nc.bg} ${nc.textClass} border-transparent shadow-xl` : "bg-white/[0.03] border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80 backdrop-blur-md shadow-inner"
                  }`}
                  style={active ? { boxShadow: `0 8px 24px ${nc.color}40`, textShadow: nc.textClass === "text-white" ? "0 2px 4px rgba(0,0,0,0.3)" : "none" } : {}}
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
                            className={`relative rounded-[24px] p-5 text-left transition-all duration-300 border overflow-hidden group ${
                              isSelected
                                ? "scale-[1.02] shadow-2xl border-white/40 ring-4"
                                : "border-white/10 bg-white/[0.03] backdrop-blur-xl hover:bg-white/10 hover:border-white/20 hover:shadow-lg active:scale-[0.97]"
                            }`}
                            style={{
                              background: isSelected
                                ? `linear-gradient(145deg, ${netConf.color}, ${netConf.color}dd)`
                                : undefined,
                              boxShadow: isSelected ? `0 12px 30px ${netConf.color}40` : undefined,
                              borderColor: isSelected ? "rgba(255,255,255,0.5)" : undefined,
                              ringColor: isSelected ? `${netConf.color}30` : "transparent"
                            }}
                          >
                            {/* Inner Highlight for depth */}
                            <div className="absolute inset-0 rounded-[24px] pointer-events-none ring-1 ring-inset ring-white/10" />

                            {isSelected && (
                              <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-md animate-in zoom-in-50 duration-200">
                                <CheckCircle2 className="w-4 h-4 text-black drop-shadow-sm" />
                              </div>
                            )}
                            {pkg.popular && !isSelected && (
                              <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-amber-400/10 border border-amber-400/20 flex items-center justify-center backdrop-blur-md">
                                <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                              </div>
                            )}
                            <p className={`text-[10px] font-black uppercase tracking-[0.15em] mb-1.5 ${isSelected ? (selectedNetwork === "MTN" ? "text-black/60" : "text-white/60") : "text-white/40 group-hover:text-white/60"}`}>
                              {selectedNetwork}
                            </p>
                            <p className={`text-[32px] font-black tracking-tighter leading-none mb-4 ${isSelected ? (selectedNetwork === "MTN" ? "text-black" : "text-white") : "text-white"}`}>
                              {pkg.size}
                            </p>
                            <div className={`pt-4 border-t ${isSelected ? (selectedNetwork === "MTN" ? "border-black/20" : "border-white/20") : "border-white/10"}`}>
                              <p className={`text-xl font-black tracking-tight ${isSelected ? (selectedNetwork === "MTN" ? "text-black" : "text-white") : "text-white/90"}`}>
                                ₵{pkg.price.toFixed(2)}
                              </p>
                              <p className={`text-[10px] font-bold mt-1 ${isSelected ? (selectedNetwork === "MTN" ? "text-black/50" : "text-white/50") : "text-white/30"}`}>
                                NO EXPIRY
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
            <div>
              <h2 className="text-3xl font-black text-white mb-2">Done!</h2>
              <p className="text-white/40 text-sm leading-relaxed">
                Your <strong className="text-emerald-400">{selectedPkg?.size} {selectedNetwork}</strong> bundle is on its way. Check your phone shortly!
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setShowSuccessOverlay(false); setSelectedPkg(null); setPhone(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false); }}
              className="w-full py-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black text-xs uppercase tracking-widest transition-all"
            >
              Close
            </button>
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

      {/* ── Store Authentication Modal Overlay ── */}
      <StoreAuth
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        agentId={agent.user_id}
        storeName={agent.store_name}
        primaryColor={accentColor}
      />

      <StoreDepositFlow
        isOpen={depositOpen}
        onClose={() => setDepositOpen(false)}
        agentId={agent.user_id}
        initialPhone={profile?.momo_number || profile?.phone || phone}
        accentColor={accentColor}
        onSuccess={() => {
          refreshProfile();
          fetchWalletBalance();
        }}
      />

      <StoreTransactionHistory
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        customerId={profile?.user_id || ""}
        customerPhone={profile?.momo_number || profile?.phone || phone}
        accentColor={accentColor}
      />

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

      {profile && (profile.user_id === agent?.user_id || profile.is_agent || profile.is_sub_agent) && (
        <button
          onClick={() => {
            if (profile.user_id === agent?.user_id) {
              setManageOpen(true);
            } else {
              window.open("/dashboard", "_blank");
            }
          }}
          className="fixed left-4 bottom-6 z-[100] animate-bounce shrink-0 select-none outline-none"
        >
          <div className="flex items-center gap-2 h-12 px-4 rounded-2xl bg-amber-400 text-black shadow-xl shadow-amber-400/25 hover:scale-105 active:scale-95 transition-all font-black text-xs uppercase tracking-widest border border-amber-500/30">
            <Store className="w-5 h-5 shrink-0 animate-pulse" />
            {profile.user_id === agent?.user_id ? "Manage Storefront" : "Reseller Dashboard"}
          </div>
        </button>
      )}

      {/* ── Inline Store Management Overlay ── */}
      {profile?.user_id === agent?.user_id && (
        <StoreManagementOverlay
          isOpen={manageOpen}
          onClose={() => setManageOpen(false)}
          agentId={agent.user_id}
          currentStoreName={agent.store_name}
          currentWhatsapp={agent.whatsapp_number || ""}
          currentSupport={agent.support_number || ""}
          accentColor={accentColor}
          onSuccess={() => {
            // Can optionally reload or refresh agent data here
            window.location.reload();
          }}
        />
      )}

      <PaystackMomoCheckout
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        amount={total}
        email={profile?.email || ""}
        recipientPhone={phoneDigits}
        recipientNetwork={selectedNetwork}
        metadata={checkoutMetadata}
        onSuccess={handleCheckoutSuccess}
        onFailure={handleCheckoutFailure}
      />
    </div>
  );
};

export default AgentStore;
