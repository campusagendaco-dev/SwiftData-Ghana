import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { basePackages, networks } from "@/lib/data";
import { getNetworkCardColors } from "@/lib/utils";
import NetworkCard from "@/components/NetworkCard";
import DataPackageCard from "@/components/DataPackageCard";
import AfaOrderForm from "@/components/AfaOrderForm";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { Menu, X, Users, Shield, AlertTriangle, Zap, TrendingUp, ChevronRight } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface AgentProfile {
  user_id: string;
  store_name: string;
  full_name: string;
  whatsapp_number: string;
  support_number: string;
  email: string;
  whatsapp_group_link: string | null;
  agent_prices: Record<string, any>;
  disabled_packages: Record<string, string[]>;
  sub_agent_activation_markup: number | null;
}

interface GlobalPkgSetting {
  network: string;
  package_size: string;
  agent_price: number | null;
  is_unavailable: boolean;
}

const DEFAULT_AFA_PRICE = 12.5;

const AgentStore = () => {
  const RESELLER_STORE_SETTLEMENT_MODE: "automatic" | "manual" = "automatic";
  const { slug } = useParams<{ slug: string }>();
  const { toast } = useToast();
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selected, setSelected] = useState("MTN");
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [buyingPkg, setBuyingPkg] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<{ network: string; size: string; basePrice: number } | null>(null);
  const [globalSettings, setGlobalSettings] = useState<Record<string, GlobalPkgSetting>>({});
  const [globalAfaPrice, setGlobalAfaPrice] = useState(DEFAULT_AFA_PRICE);
  const [subAgentBaseFee, setSubAgentBaseFee] = useState<number | null>(null);

  useEffect(() => {
    const fetchAgent = async () => {
      const [agentRes, packageSettingsRes, settingsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, store_name, full_name, whatsapp_number, support_number, email, whatsapp_group_link, agent_prices, disabled_packages, sub_agent_activation_markup")
          .eq("slug", slug)
          .eq("is_agent", true)
          .eq("onboarding_complete", true)
          .eq("agent_approved", true)
          .maybeSingle(),
        supabase
          .from("global_package_settings")
          .select("network, package_size, agent_price, public_price, is_unavailable"),
        supabase
          .from("system_settings")
          .select("sub_agent_base_fee")
          .eq("id", 1)
          .maybeSingle(),
      ]);

      const gsMap: Record<string, GlobalPkgSetting> = {};
      (packageSettingsRes.data || []).forEach((r: any) => { gsMap[`${r.network}-${r.package_size}`] = r; });
      setGlobalSettings(gsMap);
      const numericAfa = Number((gsMap["AFA-BUNDLE"] as any)?.agent_price ?? (gsMap["AFA-BUNDLE"] as any)?.public_price);
      if (Number.isFinite(numericAfa) && numericAfa >= 0) {
        setGlobalAfaPrice(numericAfa);
      }

      // Sub agent fee (gracefully handle if columns not yet in schema cache)
      try {
        const baseFee = Number(settingsRes.data?.sub_agent_base_fee);
        const agentMarkup = Number((agentRes.data as any)?.sub_agent_activation_markup ?? 0);
        if (Number.isFinite(baseFee) && baseFee > 0) {
          setSubAgentBaseFee(baseFee + (Number.isFinite(agentMarkup) ? agentMarkup : 0));
        }
      } catch (_) { /* ignore if columns not available yet */ }

      if (agentRes.error || !agentRes.data) {
        setNotFound(true);
      } else {
        setAgent(agentRes.data as AgentProfile);
      }
      setLoading(false);
    };
    fetchAgent();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <div className="flex items-center gap-2 animate-fade-in">
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

  const agentPrices = agent.agent_prices || {};
  const disabledPackages: Record<string, string[]> = agent.disabled_packages || {};

  const isPackageDisabled = (network: string, size: string) => {
    const gs = globalSettings[`${network}-${size}`];
    if (gs?.is_unavailable) return true;
    return disabledPackages[network]?.includes(size) || false;
  };

  const getAgentPrice = (network: string, size: string, basePrice: number) => {
    const price = agentPrices[network]?.[size];
    return price || basePrice.toFixed(2);
  };

  const afaPrice = globalAfaPrice.toFixed(2);

  const handleSelectPackage = (network: string, size: string) => {
    if (isPackageDisabled(network, size)) return;
    const key = `${network}-${size}`;
    if (selectedPkg === key) {
      setSelectedPkg(null);
      setPhone("");
    } else {
      setSelectedPkg(key);
      setPhone("");
    }
  };

  const handleBuyClick = (network: string, size: string, basePrice: number) => {
    setPhone("");
    setPendingOrder({ network, size, basePrice });
    setConfirmOpen(true);
  };

  const calculatePaystackFee = (amount: number) => {
    const fee = amount * 0.0195;
    return Math.min(fee, 100);
  };

  const getTotal = (network: string, size: string, basePrice: number) => {
    const agentPrice = parseFloat(getAgentPrice(network, size, basePrice));
    const fee = calculatePaystackFee(agentPrice);
    return { agentPrice, fee, total: parseFloat((agentPrice + fee).toFixed(2)) };
  };

  const handleConfirmBuy = async () => {
    if (!pendingOrder || !agent) return;
    setConfirmOpen(false);

    const { network, size, basePrice } = pendingOrder;
    const key = `${network}-${size}`;
    setBuyingPkg(key);

    const { agentPrice, total, fee } = getTotal(network, size, basePrice);
    // Use admin-configured agent price as cost base if available; fallback to basePackages price
    const costBase = Number(globalSettings[key]?.agent_price) > 0
      ? Number(globalSettings[key].agent_price)
      : basePrice;
    const profit = parseFloat((agentPrice - costBase).toFixed(2));
    const orderId = crypto.randomUUID();

    const { error } = await supabase.from("orders").insert({
      id: orderId,
      agent_id: agent.user_id,
      order_type: "data",
      customer_phone: phone.replace(/\s/g, ""),
      network,
      package_size: size,
      amount: total,
      profit,
    });

    if (error) {
      toast({ title: "Order failed", description: error.message, variant: "destructive" });
      setBuyingPkg(null);
      return;
    }

    const { data: paymentData, error: paymentError } = await supabase.functions.invoke("initialize-payment", {
      body: {
        email: `${phone.replace(/\s/g, "")}@customer.swiftdata.gh`,
        amount: total,
        reference: orderId,
        callback_url: `${getAppBaseUrl()}/order-status?reference=${orderId}`,
        metadata: {
          order_id: orderId,
          order_type: "data",
          network,
          package_size: size,
          customer_phone: phone.replace(/\s/g, ""),
          fee,
          agent_id: agent.user_id,
          base_price: costBase,
          payment_source: "agent_store",
          deduct_agent_wallet: false,
          wallet_settlement_mode: RESELLER_STORE_SETTLEMENT_MODE,
        },
      },
    });

    if (paymentError || !paymentData?.authorization_url) {
      console.error("Payment error:", paymentError, paymentData);
      const description = paymentData?.error || await getFunctionErrorMessage(paymentError, "Could not initialize payment. Please try again.");
      toast({ title: "Payment failed", description, variant: "destructive" });
      setBuyingPkg(null);
      return;
    }

    window.location.href = paymentData.authorization_url;
  };

  const isPhoneValid = phone.replace(/\s/g, "").length === 10;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#162316]">
        <div className="container mx-auto max-w-3xl flex items-center justify-between px-4 h-16">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="SwiftData Ghana" className="w-9 h-9 shrink-0" />
            <h1 className="font-display text-lg font-bold text-white truncate">
              {agent.store_name}
            </h1>
          </div>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-border bg-card px-4 py-3 space-y-1 animate-fade-in">
            {afaPrice && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  document.getElementById("afa-section")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                <Shield className="w-4 h-4 text-primary" />
                AFA Registration
              </button>
            )}
            {agent.whatsapp_group_link && (
              <a
                href={agent.whatsapp_group_link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-foreground hover:bg-accent transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <Users className="w-4 h-4 text-primary" />
                Join WhatsApp Group
              </a>
            )}
            {!agent.whatsapp_group_link && !afaPrice && (
              <p className="text-sm text-muted-foreground px-3 py-2">No links available</p>
            )}
          </div>
        )}
      </header>

      {/* Hero Banner */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(48_100%_50%/0.08),transparent_70%)]" />
        <div className="container mx-auto max-w-3xl px-4 py-10 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1 mb-4 text-xs font-medium text-primary animate-fade-in">
            <Zap className="w-3.5 h-3.5" /> Instant Data Delivery
          </div>
          <h2 className="font-display text-2xl md:text-3xl font-black mb-2 animate-fade-in" style={{ animationDelay: "0.05s" }}>
            Buy Affordable Data <span className="text-gradient">Instantly</span>
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto animate-fade-in" style={{ animationDelay: "0.1s" }}>
            Select your network, choose a bundle, and get data delivered in seconds.
          </p>
        </div>
      </section>

      {/* Main content */}
      <main className="flex-1 px-4 pb-10">
        <div className="container mx-auto max-w-3xl">
          <div className="mb-8">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Choose Network</p>
            <div className="flex flex-wrap gap-2">
              {networks.map((n) => (
                <NetworkCard
                  key={n.name}
                  name={n.name}
                  color={n.color}
                  selected={selected === n.name}
                  onClick={() => { setSelected(n.name); setPhone(""); }}
                />
              ))}
            </div>
          </div>

          <div className="mb-14">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 rounded-full bg-primary" />
              <h2 className="font-display text-xl font-bold">{selected} Bundles</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {basePackages[selected]?.map((pkg) => {
                const disabled = isPackageDisabled(selected, pkg.size);
                const key = `${selected}-${pkg.size}`;
                const agentPriceStr = getAgentPrice(selected, pkg.size, pkg.price);
                return (
                  <div
                    key={pkg.size}
                    className={`${getNetworkCardColors(selected).card} rounded-xl p-3 flex flex-col gap-2 ${disabled ? "opacity-50 pointer-events-none" : ""}`}
                  >
                    <div className="flex justify-between items-start">
                      <span className={`${getNetworkCardColors(selected).label} text-xs font-semibold`}>{selected}</span>
                      <span className={`${getNetworkCardColors(selected).price} text-xs`}>Price</span>
                    </div>
                    <div className="flex justify-between items-end">
                      <span className={`${getNetworkCardColors(selected).size} text-2xl font-black`}>{pkg.size}</span>
                      <span className={`${getNetworkCardColors(selected).size} font-bold text-sm`}>GH&#8373; {agentPriceStr}</span>
                    </div>
                    <button
                      onClick={() => handleBuyClick(selected, pkg.size, pkg.price)}
                      disabled={buyingPkg === key || disabled}
                      className={`w-full ${getNetworkCardColors(selected).btn} disabled:opacity-50 text-sm font-semibold py-1.5 rounded-lg transition-colors`}
                    >
                      {buyingPkg === key ? "Processing..." : "Buy"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {afaPrice && (
            <div id="afa-section" className="pt-8">
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 md:p-8">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-5 h-5 text-primary" />
                  <h2 className="font-display text-xl font-bold">AFA Bundle Registration</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-6">
                  Fill in all required details to order an AFA bundle.
                </p>
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="flex items-center justify-between mb-5">
                    <p className="font-medium text-foreground">AFA Bundle</p>
                    <p className="font-display text-xl font-bold text-primary">GH₵ {afaPrice}</p>
                  </div>
                  <AfaOrderForm
                    price={afaPrice}
                    agentId={agent.user_id}
                    profit={0}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Sub Agent Recruitment Banner */}
          <div className="mt-10 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-400/15 flex items-center justify-center shrink-0">
                <TrendingUp className="w-6 h-6 text-amber-500" />
              </div>
              <div className="flex-1">
                <h2 className="font-display text-xl font-bold mb-1">Become a Sub Agent</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Get your own data reselling store under <strong>{agent.store_name || agent.full_name}</strong>.
                  Start earning by selling data bundles to your own customers.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                  {[
                    { icon: "🏪", label: "Your Own Store", desc: "Personalised store link for your customers" },
                    { icon: "📊", label: "Full Dashboard", desc: "Orders, wallet, pricing — all in one place" },
                    { icon: "💰", label: "Earn Income", desc: "Set your own margins and keep the profit" },
                  ].map((b) => (
                    <div key={b.label} className="rounded-xl bg-card border border-border p-3">
                      <span className="text-xl">{b.icon}</span>
                      <p className="font-semibold text-sm mt-1">{b.label}</p>
                      <p className="text-xs text-muted-foreground">{b.desc}</p>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  {subAgentBaseFee !== null ? (
                    <p className="text-sm">
                      Activation fee:{" "}
                      <span className="font-bold text-foreground">GH&#8373; {subAgentBaseFee.toFixed(2)}</span>
                      <span className="text-xs text-muted-foreground ml-1">+ processing fee</span>
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Contact agent for activation fee.</p>
                  )}
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
        </div>
      </main>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!open) setPhone(""); setConfirmOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enter Recipient Number</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingOrder && `${pendingOrder.network} — ${pendingOrder.size} · GH₵ ${getAgentPrice(pendingOrder.network, pendingOrder.size, pendingOrder.basePrice)}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 px-1">
            <label className="block text-sm font-medium text-foreground mb-1.5">Phone Number</label>
            <input
              type="tel"
              placeholder="e.g. 0241234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={10}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-transparent text-foreground"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPhone("")}>Cancel</AlertDialogCancel>
            <button
              onClick={() => { if (isPhoneValid) handleConfirmBuy(); }}
              disabled={!isPhoneValid}
              className="inline-flex items-center justify-center rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Buy Now
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <footer className="border-t border-border bg-card/30 py-6">
        <div className="container mx-auto max-w-3xl px-4">
          <div className="flex flex-col items-center gap-4 text-sm text-muted-foreground">
            <div className="flex flex-wrap items-center justify-center gap-4">
              {agent.support_number && (
                <a href={`tel:${agent.support_number.replace(/\s/g, "")}`} className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                  📞 {agent.support_number}
                </a>
              )}
              {agent.email && (
                <a href={`mailto:${agent.email}`} className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                  ✉️ {agent.email}
                </a>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
              Powered by
              <span className="inline-flex items-center gap-1 font-semibold text-foreground/50">
                <Zap className="w-3 h-3 text-primary" /> SwiftData Ghana
              </span>
            </div>
            <div className="text-xs text-muted-foreground/60">
              Developed by Scqeel Technologies
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AgentStore;
