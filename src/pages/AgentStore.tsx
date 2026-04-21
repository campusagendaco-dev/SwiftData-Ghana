import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { basePackages } from "@/lib/data";
import { getNetworkCardColors } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";
import { invokePublicFunction } from "@/lib/public-function-client";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";
import {
  Zap, ChevronDown, ChevronUp, Loader2, Users, TrendingUp,
  ChevronRight, ShieldCheck, Phone,
} from "lucide-react";

type NetworkName = "MTN" | "Telecel" | "AirtelTigo";
const NETWORKS: NetworkName[] = ["MTN", "Telecel", "AirtelTigo"];

const networkTabStyles: Record<NetworkName, { active: string; idle: string }> = {
  MTN: { active: "bg-amber-400 text-black border-amber-400", idle: "border-border hover:border-amber-400/50" },
  Telecel: { active: "bg-red-600 text-white border-red-600", idle: "border-border hover:border-red-400/50" },
  AirtelTigo: { active: "bg-blue-600 text-white border-blue-600", idle: "border-border hover:border-blue-400/50" },
};

function useColsPerRow(): number {
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const update = () => setCols(window.innerWidth < 640 ? 2 : 3);
    update();
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);
  return cols;
}

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
}

interface GlobalPkgSetting {
  network: string;
  package_size: string;
  agent_price: number | null;
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
  const [selectedPkg, setSelectedPkg] = useState<{ size: string; price: number } | null>(null);
  const [phone, setPhone] = useState("");
  const [buying, setBuying] = useState(false);

  const [globalSettings, setGlobalSettings] = useState<Record<string, GlobalPkgSetting>>({});
  // Parent's sub_agent_prices — used as cost base for sub-agents
  const [parentAssignedPrices, setParentAssignedPrices] = useState<Record<string, Record<string, string | number>>>({});
  const [subAgentBaseFee, setSubAgentBaseFee] = useState<number | null>(null);
  const [priceMultiplier, setPriceMultiplier] = useState(1);

  const colsPerRow = useColsPerRow();
  const stripRef = useRef<HTMLDivElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);

  const phoneDigits = phone.replace(/\D+/g, "");
  const isPhoneValid = phoneDigits.length === 10 || phoneDigits.length === 12 || phoneDigits.length === 9;

  useEffect(() => {
    const fetchStore = async () => {
      const [agentRes, pkgRes, pricingCtx] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, store_name, full_name, whatsapp_number, support_number, email, whatsapp_group_link, agent_prices, disabled_packages, is_sub_agent, parent_agent_id, sub_agent_activation_markup")
          .eq("slug", slug)
          .eq("is_agent", true)
          .eq("onboarding_complete", true)
          .eq("agent_approved", true)
          .maybeSingle(),
        supabase
          .from("global_package_settings")
          .select("network, package_size, agent_price, public_price, is_unavailable"),
        fetchApiPricingContext(),
      ]);

      const gsMap: Record<string, GlobalPkgSetting> = {};
      (pkgRes.data || []).forEach((r: any) => { gsMap[`${r.network}-${r.package_size}`] = r; });
      setGlobalSettings(gsMap);
      setPriceMultiplier(pricingCtx.multiplier);

      if (!agentRes.data) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const profile = agentRes.data as AgentProfile;
      setAgent(profile);

      // If sub-agent, fetch parent's assigned prices for this sub-agent
      if (profile.is_sub_agent && profile.parent_agent_id) {
        const { data: parentProfile } = await supabase
          .from("profiles")
          .select("sub_agent_prices")
          .eq("user_id", profile.parent_agent_id)
          .maybeSingle();
        if (parentProfile?.sub_agent_prices) {
          setParentAssignedPrices(parentProfile.sub_agent_prices as Record<string, Record<string, string | number>>);
        }
      }

      const fee = Number(profile.sub_agent_activation_markup ?? 0);
      if (Number.isFinite(fee) && fee > 0) setSubAgentBaseFee(fee);

      setLoading(false);
    };
    fetchStore();
  }, [slug]);

  /* Resolve the price to show customers for a given package */
  const resolveDisplayPrice = useCallback((network: string, size: string, fallbackPrice: number): number => {
    if (!agent) return fallbackPrice;

    const agentOwn = Number(agent.agent_prices?.[network]?.[size]);
    if (Number.isFinite(agentOwn) && agentOwn > 0) {
      return applyPriceMultiplier(agentOwn, priceMultiplier);
    }

    // Sub-agent with no custom price → show parent's assigned price
    const parentAssigned = Number(parentAssignedPrices?.[network]?.[size]);
    if (Number.isFinite(parentAssigned) && parentAssigned > 0) {
      return applyPriceMultiplier(parentAssigned, priceMultiplier);
    }

    // Fallback to admin's agent_price or public_price
    const gs = globalSettings[`${network}-${size}`];
    const gsBase = Number(gs?.agent_price) > 0 ? Number(gs!.agent_price) : Number(gs?.public_price);
    if (Number.isFinite(gsBase) && gsBase > 0) {
      return applyPriceMultiplier(gsBase, priceMultiplier);
    }

    return applyPriceMultiplier(fallbackPrice, priceMultiplier);
  }, [agent, globalSettings, parentAssignedPrices, priceMultiplier]);

  const packages = (basePackages[selectedNetwork] || [])
    .map((pkg) => {
      const gs = globalSettings[`${selectedNetwork}-${pkg.size}`];
      if (gs?.is_unavailable) return null;
      const disabled = agent?.disabled_packages?.[selectedNetwork]?.includes(pkg.size) || false;
      if (disabled) return null;
      return {
        ...pkg,
        price: resolveDisplayPrice(selectedNetwork, pkg.size, pkg.price),
      };
    })
    .filter(Boolean) as { size: string; price: number; validity: string; popular?: boolean }[];

  const rows: typeof packages[] = [];
  for (let i = 0; i < packages.length; i += colsPerRow) {
    rows.push(packages.slice(i, i + colsPerRow));
  }

  const selectedIdx = selectedPkg ? packages.findIndex((p) => p.size === selectedPkg.size) : -1;
  const selectedRow = selectedIdx >= 0 ? Math.floor(selectedIdx / colsPerRow) : -1;

  const PAYSTACK_FEE_RATE = 0.03;
  const fee = selectedPkg ? Math.min(selectedPkg.price * PAYSTACK_FEE_RATE, 100) : 0;
  const total = selectedPkg ? parseFloat((selectedPkg.price + fee).toFixed(2)) : 0;

  const handleCardClick = useCallback((size: string, price: number) => {
    setSelectedPkg((prev) => (prev?.size === size ? null : { size, price }));
    setTimeout(() => stripRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
  }, []);

  const handlePay = async () => {
    if (!selectedPkg || !agent) return;
    if (!isPhoneValid) {
      toast({ title: "Enter a valid phone number first", variant: "destructive" });
      phoneInputRef.current?.focus();
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
          agent_id: agent.user_id,
          payment_source: "agent_store",
          wallet_settlement_mode: "automatic",
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Zap className="w-5 h-5 text-primary animate-pulse" />
          Loading store...
        </div>
      </div>
    );
  }

  if (notFound || !agent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-display text-3xl font-black mb-2">Store Not Found</h1>
          <p className="text-muted-foreground">This store doesn't exist or isn't active.</p>
        </div>
      </div>
    );
  }

  const colors = getNetworkCardColors(selectedNetwork);

  return (
    <div className="min-h-screen flex flex-col bg-background">

      {/* ── Header ─────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/50" style={{ background: "#162316" }}>
        <div className="container mx-auto max-w-3xl flex items-center justify-between px-4 h-16">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" className="w-9 h-9 shrink-0" />
            <div className="leading-tight">
              <p className="text-white font-bold text-sm leading-none">{agent.store_name}</p>
              <p className="text-amber-400 text-[10px] leading-none mt-0.5">Data Reselling Store</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {agent.whatsapp_number && (
              <a
                href={`https://wa.me/${agent.whatsapp_number.replace(/\D+/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 bg-[#25D366] hover:bg-[#1da851] text-white text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
              >
                <svg viewBox="0 0 32 32" width="14" height="14" fill="white"><path d="M16.004 2.667C8.64 2.667 2.667 8.64 2.667 16c0 2.347.614 4.56 1.693 6.48L2.667 29.333l7.04-1.653A13.28 13.28 0 0016.004 29.333C23.36 29.333 29.333 23.36 29.333 16S23.36 2.667 16.004 2.667zm5.84 18.027c-.32-.16-1.893-.933-2.187-1.04-.293-.107-.507-.16-.72.16-.213.32-.827 1.04-.987 1.253-.16.213-.347.24-.667.08-.32-.16-1.36-.507-2.587-1.6-.96-.853-1.6-1.907-1.787-2.227-.187-.32 0-.48.147-.627.133-.133.32-.347.48-.52.16-.173.213-.32.32-.533.107-.213.053-.4-.027-.56-.08-.16-.72-1.733-.987-2.373-.253-.613-.52-.533-.72-.547h-.613c-.213 0-.56.08-.853.4-.293.32-1.12 1.093-1.12 2.667 0 1.573 1.147 3.093 1.307 3.307.16.213 2.267 3.467 5.493 4.853.773.333 1.373.533 1.84.68.773.24 1.48.213 2.027.133.627-.093 1.893-.773 2.16-1.52.267-.747.267-1.387.187-1.52-.08-.133-.293-.213-.613-.373z"/></svg>
                <span className="hidden sm:inline">Contact</span>
              </a>
            )}
            {agent.whatsapp_group_link && (
              <a
                href={agent.whatsapp_group_link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 border border-white/20 text-white/80 hover:text-white hover:border-white/40 text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
              >
                <Users className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Group</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────── */}
      <div style={{ background: "#1a1a2e" }} className="text-white py-8 px-4">
        <div className="container mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/30 rounded-full px-4 py-1.5 mb-3">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-amber-400 text-xs font-semibold">Instant Data Delivery</span>
          </div>
          <h2 className="font-display text-2xl md:text-3xl font-black mb-1">
            {agent.store_name}
          </h2>
          <p className="text-white/55 text-sm">Choose a bundle below and pay securely via Paystack.</p>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 mt-4 text-xs text-white/40">
            <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-green-400" /> Secured by Paystack</span>
            <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" /> Instant delivery</span>
            <span>📦 Non-expiry bundles</span>
          </div>
        </div>
      </div>

      {/* ── Main ───────────────────────────────────── */}
      <main className="flex-1 px-4 py-8">
        <div className="container mx-auto max-w-3xl space-y-8">

          {/* Network tabs */}
          <div className="flex gap-2">
            {NETWORKS.map((n) => (
              <button
                key={n}
                onClick={() => { setSelectedNetwork(n); setSelectedPkg(null); }}
                className={`flex-1 py-3 rounded-xl border-2 text-sm font-bold transition-all ${
                  selectedNetwork === n ? networkTabStyles[n].active : networkTabStyles[n].idle
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          {/* Package grid with inline buy strip */}
          <div className="space-y-0">
            {rows.map((row, rowIdx) => (
              <Fragment key={rowIdx}>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                  {row.map((pkg) => {
                    const isSelected = selectedPkg?.size === pkg.size;
                    return (
                      <button
                        key={pkg.size}
                        onClick={() => handleCardClick(pkg.size, pkg.price)}
                        className={`${colors.card} rounded-2xl p-4 flex flex-col gap-2 border-2 text-left transition-all duration-200 ${
                          isSelected ? "border-white/70 shadow-xl scale-[1.02]" : "border-transparent hover:border-white/25 hover:scale-[1.01]"
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <span className={`${colors.label} text-[11px] font-bold uppercase tracking-wide`}>{selectedNetwork}</span>
                          {isSelected
                            ? <ChevronUp className="w-4 h-4 text-white/70" />
                            : <ChevronDown className={`w-4 h-4 ${colors.label}`} />}
                        </div>
                        <p className={`${colors.size} text-4xl font-black leading-none`}>{pkg.size}</p>
                        <div className="flex items-end justify-between mt-auto">
                          <p className={`${colors.size} text-base font-black`}>₵{pkg.price.toFixed(2)}</p>
                          <p className={`${colors.label} text-[10px] font-medium`}>No Expiry</p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Inline buy strip */}
                {rowIdx === selectedRow && selectedPkg && (
                  <div
                    ref={stripRef}
                    className="buy-strip-enter mb-3 rounded-xl overflow-hidden border border-white/10"
                    style={{ background: "rgba(15,15,30,0.94)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}
                  >
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 p-3.5">
                      <div className={`${colors.card} rounded-lg px-2.5 py-2 shrink-0`}>
                        <span className={`${colors.size} text-xs font-black`}>{selectedNetwork}</span>
                      </div>
                      <div className="shrink-0 hidden sm:block">
                        <span className="text-white font-bold text-sm">{selectedPkg.size}</span>
                        <span className="text-white/40 mx-1.5">—</span>
                        <span className="text-amber-400 font-bold text-sm">GH₵ {selectedPkg.price.toFixed(2)}</span>
                      </div>
                      <input
                        ref={phoneInputRef}
                        type="tel"
                        inputMode="numeric"
                        placeholder="0XXXXXXXXX"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        maxLength={12}
                        className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-white placeholder-white/35 text-sm focus:outline-none focus:border-amber-400/60 border border-white/15 transition-colors"
                        style={{ background: "rgba(255,255,255,0.08)" }}
                      />
                      <button
                        onClick={handlePay}
                        disabled={buying}
                        className="shrink-0 bg-amber-400 hover:bg-amber-300 text-black font-black px-5 py-2.5 rounded-xl text-sm transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center gap-1.5 whitespace-nowrap"
                      >
                        {buying ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing...</> : <>Buy ₵{total.toFixed(2)}</>}
                      </button>
                    </div>
                    {phone.length > 0 && !isPhoneValid && (
                      <p className="text-xs text-red-400 px-4 pb-2.5">Enter a valid 10-digit Ghana number</p>
                    )}
                    {phone.length === 0 && (
                      <p className="text-[11px] text-white/40 px-4 pb-2.5">Enter the recipient phone number to continue</p>
                    )}
                  </div>
                )}
              </Fragment>
            ))}
          </div>

          {/* Order tracker */}
          <PhoneOrderTracker
            title="Track Your Order"
            subtitle="Enter the recipient number to get live delivery updates."
          />

          {/* Sub-agent CTA */}
          {!agent.is_sub_agent && (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-6 md:p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-400/15 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-6 h-6 text-amber-500" />
                </div>
                <div className="flex-1">
                  <h3 className="font-display text-xl font-bold mb-1">Become a Sub Agent</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Get your own data reselling store under <strong>{agent.store_name || agent.full_name}</strong>. Start earning by selling data bundles to your own customers.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                    {[
                      { icon: "🏪", label: "Your Own Store", desc: "Personalised store link" },
                      { icon: "📊", label: "Full Dashboard", desc: "Orders, wallet & pricing" },
                      { icon: "💰", label: "Earn Income", desc: "Set your own margins" },
                    ].map((b) => (
                      <div key={b.label} className="rounded-xl bg-card border border-border p-3">
                        <span className="text-xl">{b.icon}</span>
                        <p className="font-semibold text-sm mt-1">{b.label}</p>
                        <p className="text-xs text-muted-foreground">{b.desc}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {subAgentBaseFee !== null
                      ? <p className="text-sm">Activation fee: <span className="font-bold">GH₵ {subAgentBaseFee.toFixed(2)}</span></p>
                      : <p className="text-sm text-muted-foreground">Contact agent for activation fee.</p>}
                    <a
                      href={`/store/${slug}/sub-agent`}
                      className="inline-flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-colors shrink-0"
                    >
                      Join Now <ChevronRight className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Footer ─────────────────────────────────── */}
      <footer className="border-t border-border bg-card/30 py-6">
        <div className="container mx-auto max-w-3xl px-4 flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center justify-center gap-4">
            {agent.support_number && (
              <a href={`tel:${agent.support_number.replace(/\D+/g, "")}`} className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                <Phone className="w-3.5 h-3.5" /> {agent.support_number}
              </a>
            )}
            {agent.email && (
              <a href={`mailto:${agent.email}`} className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                ✉️ {agent.email}
              </a>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
            Powered by <Zap className="w-3 h-3 text-primary" /> SwiftData Ghana
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AgentStore;
