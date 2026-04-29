import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { basePackages } from "@/lib/data";
import { getNetworkCardColors } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";
import { invokePublicFunction } from "@/lib/public-function-client";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";
import StoreNavbar from "@/components/StoreNavbar";
import StoreVisitorPopup from "@/components/StoreVisitorPopup";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Zap, Loader2, TrendingUp, ChevronRight, Store, MessageCircle, ShoppingBag,
  ShieldCheck, Phone, X, CreditCard, Gift, Tag, CheckCircle2,
  Smartphone, Package, Clock, ArrowRight,
} from "lucide-react";

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

const networkTabStyles: Record<NetworkName, { active: string; idle: string; accent: string }> = {
  MTN:        { active: "bg-[#FFCC00] text-black border-[#FFCC00]", idle: "border-white/15 text-white/60 hover:border-[#FFCC00]/50 hover:text-white", accent: "#FFCC00" },
  Telecel:    { active: "bg-[#E60000] text-white border-[#E60000]",     idle: "border-white/15 text-white/60 hover:border-[#E60000]/50 hover:text-white",   accent: "#E60000" },
  AirtelTigo: { active: "bg-[#00529B] text-white border-[#00529B]",   idle: "border-white/15 text-white/60 hover:border-[#00529B]/50 hover:text-white",  accent: "#00529B" },
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

  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [selectedNetwork, setSelectedNetwork] = useState<NetworkName>("MTN");
  const [selectedService, setSelectedService] = useState<ServiceType>("data");
  const [selectedPkg, setSelectedPkg] = useState<{ size: string; price: number } | null>(null);
  const [airtimeAmount, setAirtimeAmount] = useState("");
  const [utilityType, setUtilityType] = useState<"ECG" | "GWCL">("ECG");
  const [utilityNumber, setUtilityNumber] = useState("");
  const [utilityAmount, setUtilityAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [buying, setBuying] = useState(false);

  const [globalSettings, setGlobalSettings] = useState<Record<string, GlobalPkgSetting>>({});
  const [parentAssignedPrices, setParentAssignedPrices] = useState<Record<string, Record<string, string | number>>>({});
  const [subAgentBaseFee, setSubAgentBaseFee] = useState<number | null>(null);
  const [priceMultiplier, setPriceMultiplier] = useState(1);

  const phoneInputRef = useRef<HTMLInputElement>(null);
  const promoInputRef = useRef<HTMLInputElement>(null);

  // Promo code state
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
        console.log("Fetching store data for slug:", slug);
        
        const [agentRes, pkgRes, pricingCtx] = await Promise.all([
          supabase
            .from("agent_stores")
            .select("user_id, store_name, full_name, whatsapp_number, support_number, email, whatsapp_group_link, agent_prices, sub_agent_prices, disabled_packages, is_agent, is_sub_agent, agent_approved, sub_agent_approved, parent_agent_id, sub_agent_activation_markup, store_logo_url, store_primary_color")
            .eq("slug", slug)
            .maybeSingle(),
          supabase.from("global_package_settings").select("network, package_size, agent_price, sub_agent_price, public_price, is_unavailable"),
          fetchApiPricingContext().catch(() => ({ source: "primary", multiplier: 1 })),
        ]);

        if (agentRes.error) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        const gsMap: Record<string, GlobalPkgSetting> = {};
        (pkgRes.data || []).forEach((r: any) => { gsMap[`${r.network}-${r.package_size}`] = r; });
        setGlobalSettings(gsMap);
        setPriceMultiplier(pricingCtx.multiplier);

        if (!agentRes.data) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        const rawAgent = agentRes.data as any;
        if (!rawAgent.agent_approved && !rawAgent.sub_agent_approved) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        const profile = agentRes.data as unknown as AgentProfile;
        setAgent(profile);

        if (profile.is_sub_agent && profile.parent_agent_id) {
          const { data: parentProfile } = await supabase
            .from("profiles").select("sub_agent_prices, agent_prices").eq("user_id", profile.parent_agent_id).maybeSingle();
          
          if (parentProfile) {
            const subPrices = (parentProfile.sub_agent_prices || {}) as Record<string, any>;
            const parentSellingPrices = (parentProfile.agent_prices || {}) as Record<string, any>;
            
            // Merge them: Priority to sub_agent_prices
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
    
    const parentAssigned = Number(parentAssignedPrices?.[network]?.[size]);
    const agentOwn = Number(agent.agent_prices?.[network]?.[size]);
    
    if (agent.is_sub_agent) {
      // Use the higher of the parent-assigned price or the sub-agent's own price
      const base = Math.max(
        Number.isFinite(parentAssigned) ? parentAssigned : 0,
        Number.isFinite(agentOwn) ? agentOwn : 0
      );
      if (base > 0) return applyPriceMultiplier(base, priceMultiplier);
    } else {
      if (Number.isFinite(agentOwn) && agentOwn > 0) return applyPriceMultiplier(agentOwn, priceMultiplier);
    }
    
    const gs = globalSettings[`${network}-${size}`];
    let gsBase = Number(gs?.agent_price) > 0 ? Number(gs!.agent_price) : Number(gs?.public_price);
    
    // For sub-agent stores, if no explicit prices set, use sub_agent_price as base
    if (agent.is_sub_agent) {
      const gsSub = Number(gs?.sub_agent_price);
      if (Number.isFinite(gsSub) && gsSub > 0) gsBase = gsSub;
    }
    
    if (Number.isFinite(gsBase) && gsBase > 0) return applyPriceMultiplier(gsBase, priceMultiplier);
    return applyPriceMultiplier(fallbackPrice, priceMultiplier);
  }, [agent, globalSettings, parentAssignedPrices, priceMultiplier]);

  const packages = (basePackages[selectedNetwork] || [])
    .map((pkg) => {
      const gs = globalSettings[`${selectedNetwork}-${pkg.size}`];
      if (gs?.is_unavailable) return null;
      if (agent?.disabled_packages?.[selectedNetwork]?.includes(pkg.size)) return null;
      return { ...pkg, price: resolveDisplayPrice(selectedNetwork, pkg.size, pkg.price) };
    })
    .filter(Boolean) as { size: string; price: number; validity: string; popular?: boolean }[];
  
  const popularBundles = [
    { network: "MTN", size: "1GB", color: "#FFCC00", text: "text-black" },
    { network: "Telecel", size: "10GB", color: "#E60000", text: "text-white" },
    { network: "AirtelTigo", size: "1GB", color: "#00529B", text: "text-white" },
  ].map(p => {
    const basePkg = (basePackages[p.network as NetworkName] || []).find(bp => bp.size === p.size);
    if (!basePkg) return null;
    const price = resolveDisplayPrice(p.network, p.size, basePkg.price);
    const gs = globalSettings[`${p.network}-${p.size}`];
    const disabled = agent?.disabled_packages?.[p.network]?.includes(p.size);
    if (gs?.is_unavailable || disabled) return null;
    return { ...p, price };
  }).filter(Boolean) as { network: string; size: string; price: number; color: string; text: string }[];

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

  const handleCardClick = useCallback((size: string, price: number) => {
    setSelectedPkg((prev) => (prev?.size === size ? null : { size, price }));
    setPromoResult(null); setPromoCode(""); setPromoOpen(false);
    setTimeout(() => phoneInputRef.current?.focus(), 140);
  }, []);

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return;
    if (!isPhoneValid) {
      toast({ title: "Enter your phone number first", description: "We need it to check if you've already used this code.", variant: "destructive" });
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
      toast({ title: "Free data code applied!", description: `Tap Claim Free Data to get your bundle!` });
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
      body: {
        promo_code: promoCode.trim(),
        phone: phoneDigits,
        network: selectedNetwork,
        package_size: selectedPkg.size,
      },
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

  const handlePay = async () => {
    if (!agent) return;
    
    // Validate selection based on service
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
      if (!amt || amt < 1) {
        toast({ title: "Invalid amount", description: "Enter a valid bill amount.", variant: "destructive" });
        return;
      }
      if (!utilityNumber || utilityNumber.length < 5) {
        toast({ title: "Invalid Account Number", description: "Please check your meter/account number.", variant: "destructive" });
        return;
      }
      // Specific ECG validation as requested
      if (utilityType.includes("ECG") && utilityNumber.length < 11) {
        toast({ title: "Invalid Meter Number", description: "ECG Meter numbers are typically 11 digits or more.", variant: "destructive" });
        return;
      }
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
      reference: orderId, 
      network: selectedNetwork, 
      package: packageSize || "", 
      phone: phoneDigits,
      ...(slug ? { slug } : {}),
    });

    const metadata: Record<string, any> = {
      order_id: orderId,
      order_type: orderType,
      network: selectedNetwork,
      package_size: packageSize,
      customer_phone: phoneDigits,
      fee,
      agent_id: agent.user_id,
      payment_source: "agent_store",
      ...(validPromo && !validPromo.is_free ? {
        promo_code: promoCode.trim(),
        promo_id: validPromo.promo_id,
        discount_percentage: validPromo.discount_percentage,
      } : {}),
    };

    if (selectedService === "utility") {
      metadata.bill_type = utilityType;
      metadata.customer_number = utilityNumber;
    }

    const { data: paymentData, error: paymentError } = await invokePublicFunction("initialize-payment", {
      body: {
        email: `${phoneDigits}@customer.data-portal.gh`,
        amount: total,
        reference: orderId,
        callback_url: `${getAppBaseUrl()}/order-status?${callbackParams.toString()}`,
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

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-[#030305] text-white">
        <div className="h-16 border-b border-white/10 flex items-center px-4 bg-white/5">
          <Skeleton className="h-9 w-9 rounded-xl bg-white/10" />
          <Skeleton className="h-4 w-32 ml-3 bg-white/10" />
        </div>
        <div className="py-14 px-4 text-center">
          <Skeleton className="h-10 w-64 mx-auto mb-4 bg-white/10" />
          <Skeleton className="h-4 w-80 mx-auto bg-white/10" />
        </div>
        <div className="px-6 max-w-3xl mx-auto w-full">
          <div className="flex gap-3 mb-10">
            {[1,2,3].map(i => <Skeleton key={i} className="flex-1 h-14 rounded-2xl bg-white/10" />)}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
            {Array.from({length:6}).map((_,i) => <Skeleton key={i} className="h-44 rounded-[2rem] bg-white/10" />)}
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !agent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#030305] text-white px-6">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mx-auto mb-6 border border-white/10 shadow-2xl">
            <Zap className="w-10 h-10 text-white/20" />
          </div>
          <h1 className="text-3xl font-black mb-3">Store Not Found</h1>
          <p className="text-white/40 text-sm mb-8 leading-relaxed">This store doesn't exist or hasn't been activated by an agent yet.</p>
          <Link to="/buy-data" className="w-full inline-flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-300 text-black font-black px-6 py-3.5 rounded-2xl transition-all shadow-xl shadow-amber-400/20">
            Go to Main Store <ChevronRight className="w-5 h-5" />
          </Link>
        </div>
      </div>
    );
  }

  const colors = getNetworkCardColors(selectedNetwork);
  const networkAccent = networkTabStyles[selectedNetwork].accent;

  return (
    <div className="min-h-screen flex flex-col bg-[#030305] text-white selection:bg-amber-400/30">
      <StoreVisitorPopup agentSlug={slug} showSubAgentLink={!agent.is_sub_agent} />

      {/* ── Background Mesh ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 transition-all duration-700">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] rounded-full blur-[140px] transition-all duration-1000" 
          style={{ 
            backgroundColor: agent.store_primary_color ? `${agent.store_primary_color}14` : (
              selectedNetwork === "MTN" ? "#fbbf2414" : 
              selectedNetwork === "Telecel" ? "#dc262614" : "#2563eb14"
            )
          }} 
        />
        <div className={`absolute top-1/4 -left-24 w-[500px] h-[500px] rounded-full blur-[120px] transition-all duration-1000 ${
          selectedNetwork === "MTN" ? "bg-blue-600/4" : "bg-amber-400/4"
        }`} />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-red-600/3 rounded-full blur-[100px]" />
        <div className="absolute inset-0 opacity-[0.015]" 
          style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "60px 60px" }} 
        />
      </div>

      <StoreNavbar
        storeName={agent.store_name}
        agentSlug={slug}
        networkAccent={networkAccent}
        whatsappNumber={agent.whatsapp_number}
        whatsappGroupLink={agent.whatsapp_group_link ?? undefined}
        supportNumber={agent.support_number}
        email={agent.email}
        showSubAgentLink={!agent.is_sub_agent}
        logoUrl={agent.store_logo_url ?? undefined}
      />

      <div className="relative z-10 flex-1">
        {/* ── Hero ── */}
        <section className="pt-20 pb-12 px-4 text-center">
          <div className="container mx-auto max-w-4xl">
            <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-5 py-2.5 mb-8 backdrop-blur-md shadow-2xl">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_15px_rgba(52,211,153,0.6)]" />
              <span className="text-white/60 text-[11px] font-black tracking-[0.2em] uppercase">Premium Data Partner</span>
            </div>
            
            <h1 className="text-4xl sm:text-5xl font-black tracking-tighter mb-6 leading-[0.95] text-white">
              Data, Airtime & <br /> 
              <span className="text-transparent bg-clip-text" style={{ backgroundImage: `linear-gradient(to right, ${agent.store_primary_color || '#fbbf24'}, #fff)` }}>
                Utility Bills
              </span>
            </h1>
            
            <p className="text-white/40 text-lg sm:text-xl max-w-xl mx-auto leading-relaxed mb-10">
              Instant delivery for all networks and utility providers. <strong className="text-white/70">Secure, fast, and 100% reliable.</strong>
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
              <button 
                onClick={() => document.getElementById("packages-section")?.scrollIntoView({ behavior: "smooth" })}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-3 text-black font-black px-10 py-5 rounded-3xl text-base transition-all duration-500 hover:scale-105 active:scale-95 shadow-xl group"
                style={{ backgroundColor: agent.store_primary_color || '#fbbf24' }}
              >
                <ShoppingBag className="w-5 h-5" /> Shop Now
              </button>
              <button 
                onClick={() => document.getElementById("track-section")?.scrollIntoView({ behavior: "smooth" })}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-3 bg-white/5 border border-white/10 hover:border-white/20 text-white font-black px-10 py-5 rounded-3xl text-base transition-all duration-500 hover:scale-105 active:scale-95 backdrop-blur-xl"
              >
                <Clock className="w-5 h-5 text-white/40" /> Track Order
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto">
              {[
                { icon: ShieldCheck, text: "100% Secure", color: "text-emerald-400" },
                { icon: Zap, text: "Instant Delivery", color: "text-amber-400" },
                { icon: Clock, text: "24/7 Available", color: "text-sky-400" },
                { icon: Smartphone, text: "All Networks", color: "text-purple-400" },
              ].map(({ icon: Icon, text, color }) => (
                <div key={text} className="flex flex-col items-center gap-2 p-4 rounded-3xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm">
                  <Icon className={`w-5 h-5 ${color}`} />
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">{text}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Popular Bundles Showcase ── */}
        <section className="pb-24 px-4">
          <div className="container mx-auto max-w-4xl">
            <div className="flex items-center justify-between mb-10">
              <div className="space-y-1 text-left">
                <h2 className="text-3xl font-black text-white">Popular Bundles</h2>
                <p className="text-[10px] text-white/20 font-black uppercase tracking-[0.2em]">Top picks from all networks</p>
              </div>
              <button 
                onClick={() => document.getElementById("packages-section")?.scrollIntoView({ behavior: "smooth" })}
                className="text-[11px] font-black text-amber-400 uppercase tracking-widest hover:text-amber-300 transition-colors"
              >
                View All
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {popularBundles.map((p, i) => (
                  <button 
                    key={i}
                    onClick={() => {
                      setSelectedNetwork(p.network as NetworkName);
                      setSelectedPkg({ size: p.size, price: p.price });
                      document.getElementById("packages-section")?.scrollIntoView({ behavior: "smooth" });
                      setTimeout(() => phoneInputRef.current?.focus(), 500);
                    }}
                    className="group relative p-6 rounded-[2.5rem] text-left transition-all duration-500 hover:scale-105 active:scale-95 shadow-2xl overflow-hidden"
                    style={{ background: p.color }}
                  >
                    <div className="absolute top-5 right-5 w-8 h-8 rounded-xl bg-black/10 flex items-center justify-center transition-transform group-hover:rotate-12">
                      <TrendingUp className={`w-4 h-4 ${p.text}`} />
                    </div>
                    
                    <div className="space-y-0.5 mb-6">
                      <p className={`text-[9px] font-black uppercase tracking-[0.2em] ${p.text} opacity-40`}>{p.network}</p>
                      <p className={`text-3xl font-black tracking-tighter ${p.text}`}>{p.size}</p>
                    </div>

                    <div className={`pt-5 border-t ${p.text === "text-black" ? "border-black/10" : "border-white/10"}`}>
                      <p className={`text-xl font-black ${p.text}`}>₵{p.price.toFixed(2)}</p>
                      <p className={`text-[9px] font-black uppercase tracking-widest ${p.text} opacity-30 mt-1`}>Buy Now</p>
                    </div>
                  </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── Main Content ── */}
        <main id="packages-section" className={`container mx-auto max-w-4xl px-4 py-16 space-y-24 ${selectedPkg || airtimeAmount || (utilityNumber && utilityAmount) ? "pb-64" : "pb-32"}`}>
          
          {/* Service Selection */}
          <div className="flex items-center justify-center gap-2 p-1.5 bg-white/5 border border-white/10 rounded-3xl w-fit mx-auto backdrop-blur-xl">
            {[
              { id: "data", label: "Data Bundles", icon: Package },
              { id: "airtime", label: "Buy Airtime", icon: Smartphone },
              { id: "utility", label: "Utility Bills", icon: Zap },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => { setSelectedService(s.id as ServiceType); setSelectedPkg(null); setAirtimeAmount(""); setUtilityAmount(""); }}
                className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
                  selectedService === s.id ? "bg-amber-400 text-black shadow-lg" : "text-white/40 hover:text-white"
                }`}
              >
                <s.icon className="w-4 h-4" />
                {s.label}
              </button>
            ))}
          </div>
          {/* ── Network Selection Grid (Data & Airtime) ── */}
          {(selectedService === "data" || selectedService === "airtime") && (
            <div className="space-y-8">
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-black text-white">Choose Your Network</h2>
                <p className="text-white/30 text-sm font-bold">MTN, Telecel & AirtelTigo</p>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {NETWORKS.map((n) => {
                  const active = selectedNetwork === n;
                  const accent = networkTabStyles[n].accent;
                  return (
                    <button
                      key={n}
                      onClick={() => { setSelectedNetwork(n); setSelectedPkg(null); }}
                      className={`relative p-6 rounded-[2.2rem] flex flex-col items-center gap-4 transition-all duration-500 overflow-hidden border shadow-2xl ${
                        active 
                          ? "scale-[1.05] z-10 border-white/40" 
                          : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/10"
                      }`}
                      style={active ? { background: accent } : {}}
                    >
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl" 
                        style={{ background: active ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)", border: `1.5px solid rgba(255,255,255,${active ? "0.4" : "0.1"})` }}>
                        <Smartphone className={`w-7 h-7 ${n === "MTN" && active ? "text-black" : "text-white"}`} />
                      </div>
                      <div className="text-center relative z-10">
                        <p className={`text-lg font-black ${n === "MTN" && active ? "text-black" : "text-white"} ${!active && "opacity-40"}`}>{n}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Data Packages ── */}
          {selectedService === "data" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center justify-between px-2">
                <div className="space-y-1">
                  <h3 className="text-2xl font-black text-white">{selectedNetwork} Bundles</h3>
                  <p className="text-[10px] text-white/30 font-black uppercase tracking-[0.2em]">Select your package</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-5">
                {packages.map((pkg) => {
                  const isSelected = selectedPkg?.size === pkg.size;
                  return (
                    <button
                      key={pkg.size}
                      onClick={() => handleCardClick(pkg.size, pkg.price)}
                      className={`relative group rounded-[2.2rem] p-5 sm:p-7 flex flex-col gap-3 text-left transition-all duration-500 overflow-hidden border shadow-2xl ${
                        isSelected 
                          ? "scale-[1.05] z-10 shadow-[0_20px_50px_rgba(0,0,0,0.3)]" 
                          : "hover:scale-[1.02] active:scale-[0.98]"
                      }`}
                      style={{ 
                        background: networkAccent, 
                        borderColor: isSelected ? "white" : "rgba(255,255,255,0.1)",
                        borderWidth: isSelected ? "3px" : "1px"
                      }}
                    >
                      {isSelected && (
                        <div className="absolute top-5 right-5 w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-2xl animate-in zoom-in-50">
                          <CheckCircle2 className="w-5 h-5 text-black" />
                        </div>
                      )}
                      <div className="space-y-0.5">
                        <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${selectedNetwork === "MTN" ? "text-black/40" : "text-white/40"}`}>
                          {selectedNetwork}
                        </span>
                        <p className={`text-4xl font-black tracking-tighter transition-colors ${selectedNetwork === "MTN" ? "text-black" : "text-white"}`}>
                          {pkg.size}
                        </p>
                      </div>
                      <div className={`mt-auto pt-5 flex flex-col gap-1 border-t ${selectedNetwork === "MTN" ? "border-black/10" : "border-white/10"}`}>
                        <p className={`text-2xl font-black transition-colors ${selectedNetwork === "MTN" ? "text-black" : "text-white"}`}>
                          ₵{pkg.price.toFixed(2)}
                        </p>
                        <p className={`text-[10px] font-black uppercase tracking-widest ${selectedNetwork === "MTN" ? "text-black/30" : "text-white/30"}`}>Instant Delivery</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Airtime UI ── */}
          {selectedService === "airtime" && (
            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="max-w-md mx-auto text-center space-y-6">
                <div className="space-y-2">
                  <h3 className="text-3xl font-black text-white">Buy {selectedNetwork} Airtime</h3>
                  <p className="text-white/30 text-sm font-bold">Enter the amount you wish to top up</p>
                </div>
                
                <div className="relative group">
                  <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
                    <span className="text-2xl font-black text-white/20 group-focus-within:text-amber-400 transition-colors">₵</span>
                  </div>
                  <input
                    type="number"
                    value={airtimeAmount}
                    onChange={(e) => setAirtimeAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-white/[0.02] border border-white/10 h-24 pl-14 pr-8 rounded-[2rem] text-4xl font-black text-white placeholder:text-white/5 focus:outline-none focus:border-amber-400/50 transition-all text-center"
                  />
                </div>
                
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {[5, 10, 20, 50, 100].map(amt => (
                    <button
                      key={amt}
                      onClick={() => setAirtimeAmount(amt.toString())}
                      className="px-6 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm font-black hover:bg-white/10 hover:border-white/20 transition-all"
                    >
                      ₵{amt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Utility UI ── */}
          {selectedService === "utility" && (
            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="max-w-md mx-auto space-y-8">
                <div className="text-center space-y-2">
                  <h3 className="text-3xl font-black text-white">Utility Bills</h3>
                  <p className="text-white/30 text-sm font-bold">Select service and enter details</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {[
                    { id: "ECG", label: "Electricity (ECG)", icon: Zap },
                    { id: "GWCL", label: "Water (GWCL)", icon: Gift },
                  ].map(u => (
                    <button
                      key={u.id}
                      onClick={() => setUtilityType(u.id as any)}
                      className={`p-6 rounded-[2rem] border transition-all flex flex-col items-center gap-3 ${
                        utilityType === u.id ? "bg-amber-400 border-amber-400 text-black shadow-xl" : "bg-white/5 border-white/10 text-white/40"
                      }`}
                    >
                      <u.icon className="w-6 h-6" />
                      <span className="text-xs font-black uppercase tracking-widest">{u.label}</span>
                    </button>
                  ))}
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-white/20 ml-2">Customer Number</label>
                    <input
                      type="text"
                      value={utilityNumber}
                      onChange={(e) => setUtilityNumber(e.target.value)}
                      placeholder="Account / Meter Number"
                      className="w-full bg-white/5 border border-white/10 h-16 px-6 rounded-2xl text-white font-black placeholder:text-white/10 focus:outline-none focus:border-amber-400/50"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-white/20 ml-2">Amount to Pay</label>
                    <div className="relative">
                      <span className="absolute left-6 top-1/2 -translate-y-1/2 font-black text-white/20">₵</span>
                      <input
                        type="number"
                        value={utilityAmount}
                        onChange={(e) => setUtilityAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-white/5 border border-white/10 h-16 pl-12 pr-6 rounded-2xl text-white font-black placeholder:text-white/10 focus:outline-none focus:border-amber-400/50"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div id="track-section">
            <PhoneOrderTracker
              title="Track Order Status"
              subtitle="Enter your number to get live delivery updates."
            />
          </div>

          {/* Why Buy From Us Section */}
          <section className="space-y-12">
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-black text-white">Why Choose {agent.store_name}?</h2>
              <p className="text-white/30 text-sm font-bold">The #1 Trusted Data Provider in Ghana</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { icon: ShieldCheck, title: "Guaranteed Delivery", desc: "Your data is always delivered. If there's any issue, we'll fix it or refund you instantly.", color: "bg-emerald-500/10 text-emerald-400" },
                { icon: Zap, title: "Super Fast", desc: "Most orders are delivered within seconds. No more waiting hours for your bundles.", color: "bg-amber-400/10 text-amber-400" },
                { icon: CreditCard, title: "Safe & Secure", desc: "Secure Paystack processing. Your financial data and money are always protected.", color: "bg-blue-500/10 text-blue-400" },
              ].map((f, i) => (
                <div key={i} className="p-8 rounded-[2.5rem] bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] transition-all group">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 transition-transform group-hover:scale-110 ${f.color}`}>
                    <f.icon className="w-7 h-7" />
                  </div>
                  <h4 className="text-xl font-black text-white mb-3">{f.title}</h4>
                  <p className="text-white/30 text-sm leading-relaxed font-medium">{f.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Sub Agent Card */}
          {!agent.is_sub_agent && (
            <section className="relative rounded-[3rem] overflow-hidden border border-white/10 p-1 bg-[#0a0a0c] group shadow-3xl">
              <div className="absolute inset-0 bg-gradient-to-br from-amber-400/[0.03] via-transparent to-blue-500/[0.02]" />
              
              <div className="relative rounded-[2.8rem] bg-black/40 backdrop-blur-3xl p-8 sm:p-12 flex flex-col md:flex-row items-center gap-12 border border-white/[0.04]">
                <div className="flex-1 space-y-6 text-center md:text-left">
                  <div className="inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/20 rounded-full px-5 py-2">
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
                    <span className="text-amber-400 text-[10px] font-black uppercase tracking-[0.2em]">Reseller Opportunity</span>
                  </div>
                  
                  <div className="space-y-4">
                    <h3 className="text-4xl sm:text-5xl font-black leading-[1.1] text-white">
                      Start Your <br /> 
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-200">Own Business</span>
                    </h3>
                    <p className="text-white/40 text-base leading-relaxed max-w-md mx-auto md:mx-0">
                      Open a branded store under <span className="text-white/70 font-black">{agent.store_name}</span> and start earning instant profits today.
                    </p>
                  </div>
                  
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
                    {["🏪 Personalized URL", "⚡ Auto Delivery", "📈 Growth Portal"].map(b => (
                      <div key={b} className="bg-white/[0.04] border border-white/10 px-4 py-2 rounded-2xl text-[10px] font-black text-white/30 uppercase tracking-widest backdrop-blur-md">
                        {b}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="shrink-0 w-full md:w-auto flex flex-col items-center gap-6 p-8 rounded-[2.5rem] bg-white/[0.02] border border-white/[0.06] backdrop-blur-2xl">
                  <div className="text-center">
                    <p className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em] mb-2">Activation Fee</p>
                    {subAgentBaseFee !== null ? (
                      <div className="relative inline-block">
                        <p className="text-5xl font-black text-white leading-none">₵{subAgentBaseFee.toFixed(2)}</p>
                        <div className="absolute -inset-2 bg-amber-400/10 blur-xl -z-10 rounded-full" />
                      </div>
                    ) : (
                      <p className="text-sm text-white/30 italic">Check Dashboard</p>
                    )}
                  </div>
                  
                  <Link
                    to={`/store/${slug}/sub-agent`}
                    className="w-full inline-flex items-center justify-center gap-3 bg-amber-400 hover:bg-amber-300 text-black px-8 py-4 rounded-[1.8rem] font-black text-sm transition-all duration-500 hover:scale-105 active:scale-95 shadow-[0_20px_50px_rgba(245,158,11,0.2)] group"
                  >
                    Get Started <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      <footer className="relative z-10 border-t border-white/[0.06] bg-[#050507] py-16 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 items-start">
            
            {/* Branding */}
            <div className="space-y-4 text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-400 flex items-center justify-center shadow-lg shadow-amber-400/20">
                  <Store className="w-5 h-5 text-black" />
                </div>
                <div className="text-left">
                  <p className="text-base font-black text-white leading-none tracking-tight">{agent.store_name}</p>
                  <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest mt-1">Verified Partner</p>
                </div>
              </div>
              <p className="text-white/30 text-sm leading-relaxed max-w-xs mx-auto md:mx-0">
                Premium digital services provider in Ghana. Instant delivery, non-expiry data, and 24/7 support.
              </p>
            </div>

            {/* Quick Support */}
            <div className="space-y-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-white/20 text-center md:text-left">Support Channels</p>
              <div className="grid grid-cols-1 gap-3">
                {agent.whatsapp_number && (
                  <a href={`https://wa.me/${agent.whatsapp_number.replace(/\D+/g, "")}`} className="group flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/10 transition-all">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <MessageCircle className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div className="text-left">
                      <p className="text-[10px] font-black text-white/20 uppercase tracking-widest">WhatsApp</p>
                      <p className="text-sm font-bold text-white/70 group-hover:text-white transition-colors">Instant Chat</p>
                    </div>
                  </a>
                )}
                {agent.support_number && (
                  <a href={`tel:${agent.support_number.replace(/\D+/g, "")}`} className="group flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/10 transition-all">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Phone className="w-5 h-5 text-blue-400" />
                    </div>
                    <div className="text-left">
                      <p className="text-[10px] font-black text-white/20 uppercase tracking-widest">Hotline</p>
                      <p className="text-sm font-bold text-white/70 group-hover:text-white transition-colors">{agent.support_number}</p>
                    </div>
                  </a>
                )}
              </div>
            </div>

            {/* Platform Info */}
            <div className="space-y-6 text-center md:text-left">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-white/20">Secure Store</p>
              <div className="p-6 rounded-[2.5rem] bg-white/[0.02] border border-white/10">
                <div className="flex items-center gap-4 mb-4 justify-center md:justify-start">
                  <div className="w-10 h-10 rounded-xl bg-amber-400/10 flex items-center justify-center border border-amber-400/20">
                    <ShieldCheck className="w-5 h-5 text-amber-400" />
                  </div>
                  <div className="text-left">
                    <p className="font-black text-sm text-white uppercase tracking-tight">Verified Digital Store</p>
                    <p className="text-[10px] text-white/20 font-black tracking-widest uppercase">Encryption Active</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 justify-center md:justify-start">
                  <Zap className="w-3 h-3 text-emerald-400" />
                  <span className="text-[10px] font-bold text-white/20 uppercase tracking-[0.1em]">Instant Delivery Guaranteed</span>
                </div>
              </div>
            </div>

            {/* Secure checkout callout */}
            <div className="space-y-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-white/20 text-center md:text-left">Secure Checkout</p>
              <div className="p-6 rounded-[2.5rem] bg-white/[0.02] border border-white/10 space-y-4">
                {[
                  { icon: ShieldCheck, text: "Paystack-secured payments",  color: "text-emerald-400" },
                  { icon: Zap,         text: "Data delivered in seconds",   color: "text-amber-400" },
                  { icon: Clock,       text: "24/7 support available",      color: "text-sky-400" },
                ].map(({ icon: Icon, text, color }) => (
                  <div key={text} className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 shrink-0 ${color}`} />
                    <span className="text-white/30 text-xs font-semibold">{text}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>

          <div className="mt-20 pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
            <p className="text-[11px] font-black text-white/10 uppercase tracking-[0.3em]">
              © {new Date().getFullYear()} {agent.store_name} · DIGITAL ECOSYSTEM
            </p>
            <div className="flex items-center gap-6">
              {["Terms", "Privacy", "Security"].map(l => (
                <button key={l} className="text-[11px] font-black text-white/10 hover:text-white/30 uppercase tracking-widest transition-colors">{l}</button>
              ))}
            </div>
          </div>
        </div>
      </footer>

      {/* ── Purchase Bar ── */}
      {((selectedService === "data" && selectedPkg) || 
        (selectedService === "airtime" && Number(airtimeAmount) > 0) || 
        (selectedService === "utility" && utilityNumber && Number(utilityAmount) > 0)) && (
        <div className="fixed bottom-0 left-0 right-0 z-[60] animate-in slide-in-from-bottom-full duration-500">
          {/* Glass background with extra dark overlay */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[40px] border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]" />
          
          <div className="relative container mx-auto max-w-2xl px-4 py-6 sm:py-8 space-y-6">
            
            {/* Header / Summary */}
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-black text-white">
                    {selectedService === "data" ? (
                      <>{selectedNetwork} <span className="text-white/50">{selectedPkg?.size}</span></>
                    ) : selectedService === "airtime" ? (
                      <>{selectedNetwork} <span className="text-white/50">Airtime</span></>
                    ) : (
                      <>{utilityType} <span className="text-white/50">Bill</span></>
                    )}
                  </h3>
                  {isFreePromo && (
                    <span className="bg-emerald-500 text-black text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter">100% Free</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs font-bold">
                  {validPromo && !isFreePromo ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <Tag className="w-3 h-3" /> GH₵{discountedPrice.toFixed(2)}
                      <span className="text-white/20 font-medium ml-1 leading-none line-through">₵{basePrice.toFixed(2)}</span>
                    </span>
                  ) : (
                    <span className="text-white/40">₵{basePrice.toFixed(2)} Base Price</span>
                  )}
                  <span className="w-1 h-1 rounded-full bg-white/10" />
                  <span className="text-white/25">₵{fee.toFixed(2)} Processing</span>
                </div>
              </div>
              <button 
                onClick={() => { setSelectedPkg(null); setAirtimeAmount(""); setUtilityAmount(""); setPhone(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false); }}
                className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/30 hover:text-white transition-all hover:bg-red-500/20 hover:border-red-500/40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Input & Button Container */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative group">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                  <Phone className="w-4 h-4 text-white/20 group-focus-within:text-white transition-colors" />
                </div>
                <input
                  ref={phoneInputRef}
                  type="tel" inputMode="numeric"
                  placeholder="Recipient Number (0XXXXXXXXX)"
                  value={phone} onChange={(e) => setPhone(e.target.value)}
                  maxLength={12}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-2xl pl-11 pr-4 py-4 text-white placeholder-white/20 text-sm focus:outline-none focus:border-white/30 focus:bg-white/[0.06] transition-all"
                />
              </div>

              {isFreePromo ? (
                <button onClick={handleClaimFree} disabled={claiming || !isPhoneValid}
                  className="shrink-0 bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-900/50 text-black font-black px-8 py-4 rounded-2xl text-sm transition-all hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2 shadow-2xl shadow-emerald-500/20">
                  {claiming ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</> : <><Gift className="w-4 h-4" /> Claim Free Data</>}
                </button>
              ) : (
                <button onClick={handlePay} disabled={buying}
                  className="shrink-0 text-black font-black px-8 py-4 rounded-2xl text-sm transition-all hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2 shadow-2xl"
                  style={{ background: networkAccent, boxShadow: `0 10px 30px ${networkAccent}30` }}>
                  {buying ? <><Loader2 className="w-4 h-4 animate-spin" /> Connecting...</> : <><CreditCard className="w-4 h-4" /> Pay GH₵{total.toFixed(2)}</>}
                </button>
              )}
            </div>

            {/* Sub-actions / Hints */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                {phone.length > 0 && !isPhoneValid ? (
                  <p className="text-[11px] font-bold text-red-400 animate-pulse">Enter valid 10-digit Ghana number</p>
                ) : (
                  <p className="text-[11px] font-bold text-white/20 uppercase tracking-widest">Instant Delivery Guaranteed</p>
                )}
              </div>

              {/* Promo section */}
              <div className="flex-1 sm:flex-none flex justify-end">
                {!promoOpen && !validPromo ? (
                  <button onClick={() => { setPromoOpen(true); setTimeout(() => promoInputRef.current?.focus(), 80); }}
                    className="flex items-center gap-1.5 text-xs font-bold text-white/30 hover:text-amber-400 transition-colors py-2 px-3 rounded-lg hover:bg-white/5">
                    <Tag className="w-3.5 h-3.5" /> Have a promo code?
                  </button>
                ) : (
                  <div className="w-full sm:w-[280px] animate-in fade-in slide-in-from-right-4 duration-300">
                    {validPromo ? (
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-black border backdrop-blur-lg ${validPromo.is_free ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-amber-400/10 border-amber-400/20 text-amber-400"}`}>
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span className="uppercase">{validPromo.code} Applied!</span>
                        <button onClick={() => { setPromoResult(null); setPromoCode(""); setPromoOpen(true); }} className="ml-auto text-white/20 hover:text-white transition-colors"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          ref={promoInputRef}
                          type="text"
                          placeholder="PROMO CODE"
                          value={promoCode}
                          onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoResult(null); }}
                          autoComplete="off"
                          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-white/20 text-[11px] font-black tracking-widest focus:outline-none focus:border-amber-400/30 transition-all uppercase"
                        />
                        <button onClick={handleApplyPromo} disabled={promoValidating || !promoCode.trim()}
                          className="px-4 py-2 rounded-xl text-[11px] font-black bg-amber-400 text-black hover:bg-amber-300 disabled:opacity-40 transition-colors">
                          {promoValidating ? <Loader2 className="w-3 h-3 animate-spin" /> : "Apply"}
                        </button>
                        <button onClick={() => { setPromoOpen(false); setPromoCode(""); setPromoResult(null); }}
                          className="p-2 text-white/30 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
                      </div>
                    )}
                    {promoResult && !promoResult.valid && (
                      <p className="text-[10px] font-bold text-red-400 mt-1.5 ml-1">{promoResult.error || "Invalid code"}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Floating Support ── */}
      {/* ── Success Overlay ── */}
      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-in fade-in duration-500">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-3xl" />
          <div className="relative max-w-sm w-full bg-white/[0.03] border border-white/10 rounded-[3rem] p-10 text-center space-y-8 animate-in zoom-in-95 duration-300">
            <div className="relative mx-auto w-24 h-24">
              <div className="absolute inset-0 bg-emerald-500 rounded-full blur-2xl opacity-20 animate-pulse" />
              <div className="relative w-full h-full rounded-full bg-emerald-500 flex items-center justify-center shadow-[0_0_50px_rgba(16,185,129,0.3)]">
                <CheckCircle2 className="w-12 h-12 text-white" />
              </div>
            </div>
            
            <div className="space-y-3">
              <h2 className="text-4xl font-black tracking-tighter text-white">Success!</h2>
              <p className="text-white/40 text-sm font-medium leading-relaxed">
                Your <strong className="text-emerald-400">{selectedPkg?.size} {selectedNetwork}</strong> bundle has been sent successfully. Check your phone in a few seconds!
              </p>
            </div>

            <div className="pt-4">
              <button 
                onClick={() => { setShowSuccessOverlay(false); setSelectedPkg(null); setPhone(""); setPromoCode(""); setPromoResult(null); setPromoOpen(false); }}
                className="w-full bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black py-4 rounded-2xl transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {agent.whatsapp_number && (
        <a 
          href={`https://wa.me/${agent.whatsapp_number.replace(/\D+/g, "")}`}
          target="_blank" rel="noopener noreferrer"
          className="fixed bottom-6 right-6 z-[100] group"
        >
          <div className="absolute inset-0 bg-emerald-500 rounded-full blur-xl opacity-20 group-hover:opacity-40 transition-opacity animate-pulse" />
          <div className="relative w-14 h-14 rounded-2xl bg-[#25D366] flex items-center justify-center text-white shadow-2xl transition-all duration-500 group-hover:scale-110 group-hover:-rotate-6 group-active:scale-95">
            <MessageCircle className="w-7 h-7 fill-white/20" />
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full flex items-center justify-center">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
            </div>
          </div>
          {/* Tooltip */}
          <div className="absolute right-full mr-4 top-1/2 -translate-y-1/2 px-4 py-2 rounded-xl bg-white text-black text-xs font-black whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-2xl translate-x-4 group-hover:translate-x-0">
            Chat with {agent.store_name}
          </div>
        </a>
      )}
    </div>
  );
};

export default AgentStore;
