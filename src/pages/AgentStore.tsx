import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { basePackages, networks } from "@/lib/data";
import NetworkCard from "@/components/NetworkCard";
import DataPackageCard from "@/components/DataPackageCard";
import AfaOrderForm from "@/components/AfaOrderForm";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { Menu, X, Users, Shield, Zap, AlertTriangle } from "lucide-react";
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

  useEffect(() => {
    const fetchAgent = async () => {
      const [agentRes, packageSettingsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, store_name, full_name, whatsapp_number, support_number, email, whatsapp_group_link, agent_prices, disabled_packages")
          .eq("slug", slug)
          .eq("is_agent", true)
          .eq("onboarding_complete", true)
          .eq("agent_approved", true)
          .maybeSingle(),
        supabase
          .from("global_package_settings")
          .select("network, package_size, agent_price, public_price, is_unavailable"),
      ]);

      // Global settings
      const gsMap: Record<string, GlobalPkgSetting> = {};
      (packageSettingsRes.data || []).forEach((r: any) => { gsMap[`${r.network}-${r.package_size}`] = r; });
      setGlobalSettings(gsMap);
      const numericAfa = Number((gsMap["AFA-BUNDLE"] as any)?.agent_price ?? (gsMap["AFA-BUNDLE"] as any)?.public_price);
      if (Number.isFinite(numericAfa) && numericAfa >= 0) {
        setGlobalAfaPrice(numericAfa);
      }

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
          <h1 className="font-display text-3xl font-bold mb-2">Store Not Found</h1>
          <p className="text-muted-foreground">This store doesn't exist or isn't active.</p>
        </div>
      </div>
    );
  }

  const agentPrices = agent.agent_prices || {};
  const disabledPackages: Record<string, string[]> = agent.disabled_packages || {};

  const isPackageDisabled = (network: string, size: string) => {
    // Check global unavailability first
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
    const profit = agentPrice - basePrice;
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
        email: `${phone.replace(/\s/g, "")}@customer.quickdata.gh`,
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
          base_price: basePrice,
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
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto max-w-3xl flex items-center justify-between px-4 h-16">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <h1 className="font-display text-lg font-bold text-foreground truncate">
              {agent.store_name}
            </h1>
          </div>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 rounded-lg hover:bg-secondary transition-colors"
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
          <h2 className="font-display text-2xl md:text-3xl font-bold mb-2 animate-fade-in" style={{ animationDelay: "0.05s" }}>
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
          {/* Network selector */}
          <div className="mb-8">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Choose Network</p>
            <div className="grid grid-cols-3 gap-3">
              {networks.map((n) => (
                <NetworkCard
                  key={n.name}
                  name={n.name}
                  color={n.color}
                  selected={selected === n.name}
                  onClick={() => { setSelected(n.name); setSelectedPkg(null); setPhone(""); }}
                />
              ))}
            </div>
          </div>

          {/* Packages */}
          <div className="mb-14">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 rounded-full bg-primary" />
              <h2 className="font-display text-xl font-semibold">{selected} Bundles</h2>
            </div>
            <div className="space-y-3">
              {basePackages[selected]?.map((pkg) => {
                const disabled = isPackageDisabled(selected, pkg.size);
                const key = `${selected}-${pkg.size}`;
                const { fee, total } = getTotal(selected, pkg.size, pkg.price);
                return (
                  <div key={pkg.size} className={disabled ? "opacity-50 pointer-events-none" : ""}>
                    {disabled && (
                      <div className="text-xs text-destructive font-medium mb-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Currently unavailable
                      </div>
                    )}
                    <DataPackageCard
                      size={pkg.size}
                      price={getAgentPrice(selected, pkg.size, pkg.price)}
                      validity={pkg.validity}
                      popular={pkg.popular}
                      isSelected={selectedPkg === key}
                      phone={selectedPkg === key ? phone : ""}
                      onPhoneChange={(val) => setPhone(val)}
                      isPhoneValid={isPhoneValid}
                      fee={selectedPkg === key ? fee : undefined}
                      total={selectedPkg === key ? total : undefined}
                      buying={buyingPkg === key}
                      onSelect={() => handleSelectPackage(selected, pkg.size)}
                      onBuy={() => handleBuyClick(selected, pkg.size, pkg.price)}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* AFA section */}
          {afaPrice && (
            <div id="afa-section" className="pt-8">
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 md:p-8">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-5 h-5 text-primary" />
                  <h2 className="font-display text-xl font-semibold">AFA Bundle Registration</h2>
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
        </div>
      </main>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Recipient Number</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to purchase data for:
              <span className="block text-foreground font-bold text-lg mt-2">{phone}</span>
              <span className="block mt-2">Please make sure this is the correct number before proceeding.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmBuy}>
              Buy Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Footer */}
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
                <Zap className="w-3 h-3 text-primary" /> DataHive Ghana
              </span>
            </div>
            <div className="text-xs text-muted-foreground/60">
              Developed by OB CodeLab
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AgentStore;
