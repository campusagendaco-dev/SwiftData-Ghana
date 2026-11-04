import { useState, useEffect } from "react";
import { ArrowRight, Users, Globe, TrendingUp, Layers, Sparkles, Wallet, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { invokePublicFunction } from "@/lib/public-function-client";
import SEO from "@/components/SEO";
import { PaystackMomoCheckout } from "@/components/PaystackMomoCheckout";

const benefits = (fee: number) => [
  { icon: TrendingUp, title: "Set Your Own Profit", desc: "Set your reseller prices above our wholesale base and keep the margin." },
  { icon: Globe, title: "Your Own Website", desc: "Get a branded reseller website to sell data under your name." },
  { icon: Users, title: fee === 0 ? "Free Instant Activation" : "Manual Approval", desc: fee === 0 ? "Activate 100% free today and skip the normal platform setup fee." : `Pay GHS ${fee} and get approved by our team — usually within 1-2 hours.` },
  { icon: Layers, title: "Full Dashboard", desc: "Track orders, profits, and manage your reseller business in one place." },
];

const steps = (fee: number) => [
  "Create or sign in to your SwiftData account",
  "Click the Request Approval / Claim Promo button below",
  fee === 0 ? "Claim your free activation slot instantly (No payment required)" : `Pay GHS ${fee} activation fee via Paystack (MoMo or Card)`,
  fee === 0 ? "Your account is immediately approved" : "Your account is reviewed and approved after payment",
  "Complete your reseller store setup",
  "Set your prices and share your store link",
  "Earn profit on every successful data purchase",
];

const AgentProgram = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [activationFee, setActivationFee] = useState(50);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutReference, setCheckoutReference] = useState("");
  const [promoEnabled, setPromoEnabled] = useState(false);
  const [promoLimit, setPromoLimit] = useState(10);
  const [promoClaimed, setPromoClaimed] = useState(0);
  const [packages, setPackages] = useState<{ network: string; package_size: string; agent_price: number; public_price: number }[]>([]);
  const [packagesLoaded, setPackagesLoaded] = useState(false);
  const [calcNetwork, setCalcNetwork] = useState("MTN");
  const [calcBundle, setCalcBundle] = useState("");
  const [calcPerDay, setCalcPerDay] = useState(10);

  useEffect(() => {
    supabase
      .from("global_package_settings")
      .select("network, package_size, agent_price, public_price")
      .eq("is_unavailable", false)
      .ilike("package_size", "%GB")
      .then(({ data }) => {
        if (Array.isArray(data)) setPackages(data as any);
        setPackagesLoaded(true);
      });
  }, []);

  useEffect(() => {
    supabase
      .from("public_system_settings")
      .select("agent_activation_fee, free_agent_promo_enabled, free_agent_promo_limit, free_agent_promo_claimed")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          if (data.agent_activation_fee) setActivationFee(Number(data.agent_activation_fee));
          setPromoEnabled(Boolean(data.free_agent_promo_enabled));
          setPromoLimit(Number(data.free_agent_promo_limit || 10));
          setPromoClaimed(Number(data.free_agent_promo_claimed || 0));
        }
      });
  }, []);

  const isPromoActive = promoEnabled && promoClaimed < promoLimit;
  const remainingSlots = Math.max(0, promoLimit - promoClaimed);

  const cta = !user
    ? {
        type: "link" as const,
        to: "/login",
        title: isPromoActive ? "🎁 Claim Free Agent Slot" : "Login to Continue",
        description: isPromoActive 
          ? `Sign in now to secure 1 of ${remainingSlots} free reseller slots remaining!` 
          : "Please sign in first, then request reseller approval.",
        label: isPromoActive ? "Login & Secure Slot" : "Login and Continue",
      }
    : profile?.is_agent && profile?.agent_approved
      ? profile?.onboarding_complete
        ? {
            type: "link" as const,
            to: "/dashboard",
            title: "You Are Already a Reseller",
            description: "Your reseller account is approved and active. Open your dashboard.",
            label: "Open Dashboard",
          }
        : {
            type: "link" as const,
            to: "/onboarding",
            title: "Approval Granted",
            description: "You are approved. Complete your reseller setup to go live.",
            label: "Continue Setup",
          }
      : isPromoActive
        ? {
            type: "action" as const,
            title: "🎁 Free Reseller Promo Active!",
            description: `Congratulations! You are eligible to activate 100% FREE. Only ${remainingSlots} spots remaining before returning to GHS ${activationFee}!`,
            label: "Secure My Free Agent Slot",
          }
        : profile?.is_agent
          ? {
              type: "link" as const,
              to: "/agent/pending",
              title: "Complete Activation",
              description: `Pay GHS ${activationFee} to activate your reseller account instantly.`,
              label: "Pay & Request Approval",
            }
          : {
              type: "action" as const,
              title: "Become a Reseller",
              description: `Submit your request and pay GHS ${activationFee} to activate your reseller account.`,
              label: "Request Approval",
            };

  const handleRequestApproval = async () => {
    if (!user || !profile) {
      navigate("/login");
      return;
    }

    setSubmitting(true);

    // ATOMIC PROMOTION CLAIM FORK
    if (isPromoActive) {
      const { data, error } = await supabase.rpc("claim_free_agent_promo");
      const res = data as any;

      if (error || !res?.success) {
        toast({
          title: "Promotion full or unavailable",
          description: error?.message || res?.error || "Failed to secure free slot. Reverting to normal payment.",
          variant: "destructive"
        });
        setSubmitting(false);
        // Force reload simple window state to pick up standard Pricing if limit expired
        setTimeout(() => window.location.reload(), 1500);
        return;
      }

      toast({
        title: "🎉 Free Promo Activated!",
        description: "Congratulations! You secured a free agent slot. Set up your store details next!",
      });
      
      await refreshProfile();
      navigate("/onboarding");
      setSubmitting(false);
      return;
    }

    // NORMAL PAID ACTIVATION FORK
    const { error } = await supabase
      .from("profiles")
      .update({ is_agent: true })
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Request failed", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    await refreshProfile();
    
    const orderId = crypto.randomUUID();
    setCheckoutReference(orderId);
    setCheckoutOpen(true);
    setSubmitting(false);
  };

  const handleCheckoutSuccess = async (ref: string) => {
    setCheckoutOpen(false);
    toast({
      title: "Payment successful!",
      description: "Your activation payment has been received. Redirecting to pending page...",
    });
    navigate(`/agent/pending?reference=${ref}`);
  };

  const handleCheckoutFailure = (err: string) => {
    setCheckoutOpen(false);
    toast({
      title: "Payment failed",
      description: err || "The payment could not be completed.",
      variant: "destructive",
    });
  };

  const paystackFee = Math.min(activationFee * 0.03, 100);
  const totalDue = parseFloat((activationFee + paystackFee).toFixed(2));

  // Earnings calculator: real agent vs public prices, normal GB bundles only.
  const calcBundles = (packages || [])
    .filter((p) => p.network === calcNetwork)
    .map((p) => ({ ...p, margin: Number(p.public_price) - Number(p.agent_price) }))
    .filter((p) => /^\d+(\.\d+)?\s*GB$/i.test(String(p.package_size).trim()) && p.margin > 0 && p.margin <= Number(p.public_price) * 0.3)
    .sort((a, b) => parseFloat(a.package_size) - parseFloat(b.package_size));
  const selected = calcBundles.find((b) => b.package_size === calcBundle) || calcBundles[Math.min(1, calcBundles.length - 1)];
  const perSale = selected ? selected.margin : 0;
  const perDay = perSale * calcPerDay;
  const perMonth = perDay * 30;
  const ced = (n: number) => `GH₵${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const ctaButton = (extra = "") =>
    cta.type === "link" ? (
      <Link
        to={cta.to}
        className={`inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl bg-primary text-primary-foreground text-[15px] font-semibold shadow-sm hover:brightness-105 ${extra}`}
      >
        {cta.label} <ArrowRight className="h-4 w-4" />
      </Link>
    ) : (
      <button
        type="button"
        onClick={handleRequestApproval}
        disabled={submitting}
        className={`inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl bg-primary text-primary-foreground text-[15px] font-semibold shadow-sm hover:brightness-105 disabled:opacity-60 ${extra}`}
      >
        {submitting ? "Please wait…" : cta.label} <ArrowRight className="h-4 w-4" />
      </button>
    );

  const card = "rounded-2xl border border-border/70 bg-card/90 backdrop-blur-xl dark:border-white/[0.08] dark:bg-black/40";

  return (
    <div className="min-h-screen pt-20 md:pt-28 pb-20 px-4 text-foreground">
      <SEO
        title="Become a Data Reseller Agent Ghana | Start Data Business — SwiftData"
        description="Launch your own data reselling business in Ghana. Unlock wholesale prices for MTN, Telecel & AirtelTigo and get your own branded Paystack store."
        keywords="resell data in ghana, start data business, data reseller Ghana, wholesale MTN data, agent program Ghana, cheap internet bundles ghana, swiftdata agent"
        canonical="https://swiftdatagh.com/agent-program"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: "SwiftData Ghana Agent Reseller Program",
          serviceType: "Telecom Data Reseller Franchise",
          description: "Start your own data reselling business in Ghana with wholesale data prices and a branded store.",
          provider: { "@type": "Organization", name: "SwiftData Ghana", url: "https://swiftdatagh.com" },
          areaServed: { "@type": "Country", name: "Ghana" },
        }}
      />

      <div className="mx-auto max-w-5xl space-y-10 md:space-y-14">
        {/* Hero */}
        <section className="text-center max-w-2xl mx-auto">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold ${
              isPromoActive ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-primary/10 text-primary"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {isPromoActive ? `Free activation · ${remainingSlots} of ${promoLimit} slots left` : `One-time activation · GH₵${activationFee}`}
          </span>
          <h1 className="mt-4 text-[32px] md:text-[48px] font-bold tracking-[-0.03em] leading-[1.05]">
            Start your own <span className="text-primary">data business</span> today
          </h1>
          <p className="mt-4 text-[16px] md:text-[17px] text-muted-foreground">
            Buy MTN, Telecel and AirtelTigo data at agent prices, sell from your own store link, and keep the profit on every sale.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            {ctaButton("w-full sm:w-auto")}
            <a href="#earnings" className="inline-flex items-center justify-center h-12 px-6 rounded-xl border border-border bg-card/80 text-[15px] font-semibold hover:bg-muted w-full sm:w-auto">
              See what you could earn
            </a>
          </div>
          <p className="mt-3 text-[12.5px] text-muted-foreground">{cta.description}</p>
        </section>

        {/* Earnings calculator */}
        <section id="earnings" className={`${card} p-5 md:p-8 scroll-mt-24`}>
          <div className="grid gap-6 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="text-[22px] md:text-[26px] font-bold tracking-[-0.02em]">What could you earn?</h2>
              <p className="mt-1 text-[14px] text-muted-foreground">Pick a bundle and how many you’d sell a day. Uses today’s agent and public prices.</p>

              <div className="mt-5 inline-flex rounded-xl bg-muted p-1" role="tablist" aria-label="Network">
                {["MTN", "Telecel", "AirtelTigo"].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="tab"
                    aria-selected={calcNetwork === n}
                    onClick={() => {
                      setCalcNetwork(n);
                      setCalcBundle("");
                    }}
                    className={`h-9 px-4 rounded-lg text-[13px] font-semibold transition-colors ${calcNetwork === n ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>

              {calcBundles.length > 0 ? (
                <>
                  <label className="mt-5 block text-[13px] font-semibold" htmlFor="calc-bundle">Bundle</label>
                  <select
                    id="calc-bundle"
                    value={selected?.package_size || ""}
                    onChange={(e) => setCalcBundle(e.target.value)}
                    className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px]"
                  >
                    {calcBundles.map((b) => (
                      <option key={b.package_size} value={b.package_size}>
                        {b.package_size}: you pay {ced(Number(b.agent_price))}, sells for {ced(Number(b.public_price))}
                      </option>
                    ))}
                  </select>

                  <div className="mt-5 flex items-center justify-between">
                    <label className="text-[13px] font-semibold" htmlFor="calc-per-day">Sales per day</label>
                    <span className="text-[14px] font-semibold tabular-nums">{calcPerDay}</span>
                  </div>
                  <input
                    id="calc-per-day"
                    type="range"
                    min={1}
                    max={100}
                    value={calcPerDay}
                    onChange={(e) => setCalcPerDay(Number(e.target.value))}
                    className="mt-2 w-full accent-[hsl(var(--primary))]"
                  />
                </>
              ) : (
                <p className="mt-5 text-[13px] text-muted-foreground">{packagesLoaded ? "Prices for this network aren’t available right now." : "Loading today’s prices…"}</p>
              )}
            </div>

            <div className="rounded-2xl bg-foreground text-background p-6 md:p-7">
              <p className="text-[13px] opacity-70">Estimated profit</p>
              <p className="mt-1 text-[40px] md:text-[48px] font-bold tracking-[-0.03em] leading-none tabular-nums">{ced(perMonth)}</p>
              <p className="mt-1 text-[13px] opacity-70">a month</p>
              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-background/15 pt-4 text-[13px]">
                <div>
                  <dt className="opacity-70">Per sale</dt>
                  <dd className="text-[17px] font-semibold tabular-nums">{ced(perSale)}</dd>
                </div>
                <div>
                  <dt className="opacity-70">Per day</dt>
                  <dd className="text-[17px] font-semibold tabular-nums">{ced(perDay)}</dd>
                </div>
              </dl>
              <p className="mt-4 text-[11.5px] opacity-60">If you sell at SwiftData’s public price. You set your own prices, so you can earn more.</p>
            </div>
          </div>
        </section>

        {/* What you get */}
        <section>
          <h2 className="text-center text-[22px] md:text-[26px] font-bold tracking-[-0.02em]">Everything you need to sell</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: TrendingUp, t: "Agent prices", d: "Buy every bundle below the public price and keep the difference." },
              { icon: Globe, t: "Your own store link", d: "A branded online shop your customers can buy from any time, even while you sleep." },
              { icon: Wallet, t: "Wallet & withdrawals", d: "Top up once, sell instantly, and cash out your profit to Mobile Money." },
              { icon: Layers, t: "Full dashboard", d: "Track every order, profit and customer in one place, live." },
              { icon: Users, t: "Sub-agents", d: "Bring in your own resellers and earn on their sales too." },
              { icon: ShieldCheck, t: "Support that answers", d: "WhatsApp help and automatic refunds if a delivery fails." },
            ].map((b) => (
              <div key={b.t} className={`${card} p-5`}>
                <span className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <b.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-3 text-[15px] font-semibold">{b.t}</h3>
                <p className="mt-1 text-[13.5px] text-muted-foreground">{b.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works + price */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className={`${card} p-6`}>
            <h2 className="text-[20px] font-bold tracking-[-0.02em]">How it works</h2>
            <ol className="mt-5 space-y-5">
              {[
                { t: user ? "You’re signed in" : "Sign in or create an account", d: "It takes a minute with your phone number or email." },
                { t: isPromoActive ? "Claim your free slot" : `Pay the one-time GH₵${activationFee} fee`, d: isPromoActive ? "No payment needed while slots last." : "Mobile Money or card. Approval usually takes 1–2 hours." },
                { t: "Set up your store and start selling", d: "Choose your prices, share your link, earn on every order." },
              ].map((s, i) => (
                <li key={s.t} className="flex gap-3">
                  <span className="h-7 w-7 shrink-0 rounded-full bg-primary text-primary-foreground text-[13px] font-bold flex items-center justify-center">{i + 1}</span>
                  <div>
                    <p className="text-[15px] font-semibold">{s.t}</p>
                    <p className="text-[13px] text-muted-foreground">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className={`${card} p-6 flex flex-col ${isPromoActive ? "ring-2 ring-emerald-500/40" : ""}`}>
            <h2 className="text-[20px] font-bold tracking-[-0.02em]">{cta.title.replace(/^🎁\s*/, "")}</h2>
            {isPromoActive ? (
              <p className="mt-2 text-[14px] text-muted-foreground">
                Activation is <span className="font-semibold text-foreground">free</span> right now (normally GH₵{activationFee}). {remainingSlots} slot{remainingSlots === 1 ? "" : "s"} left.
              </p>
            ) : (
              <dl className="mt-4 space-y-2 text-[14px]">
                <div className="flex justify-between"><dt className="text-muted-foreground">Activation fee</dt><dd className="tabular-nums">{ced(activationFee)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Paystack fee (3%)</dt><dd className="tabular-nums">{ced(paystackFee)}</dd></div>
                <div className="flex justify-between border-t border-border pt-2 font-semibold"><dt>Total, paid once</dt><dd className="tabular-nums">{ced(totalDue)}</dd></div>
              </dl>
            )}
            <p className="mt-3 text-[12.5px] text-muted-foreground">{cta.description}</p>
            <div className="mt-auto pt-5">{ctaButton("w-full")}</div>
          </div>
        </section>

        {/* FAQ */}
        <section className="max-w-3xl mx-auto">
          <h2 className="text-center text-[22px] font-bold tracking-[-0.02em]">Questions</h2>
          <div className="mt-5 space-y-2">
            {[
              { q: "How fast is approval?", a: isPromoActive ? "Free-slot activations are instant. You go straight to store setup." : "Usually within 1–2 hours after your payment is confirmed. You’ll get a notification when you’re approved." },
              { q: "Do I need to keep money in a wallet?", a: "You top up your SwiftData wallet and orders are paid from it, so your customers get their bundles instantly. Customers can also pay you directly through your store link." },
              { q: "Who sets the selling price?", a: "You do. Agent prices are your cost, and anything you charge above that is your profit." },
              { q: "What if a delivery fails?", a: "Failed orders are retried automatically, and refunded to your wallet if they can’t be delivered." },
              { q: "Can I join under another agent instead?", a: "Yes. Ask that agent for their store’s sub-agent link. Sub-agents buy at the price their agent sets." },
            ].map((f) => (
              <details key={f.q} className={`${card} group px-5 py-4`}>
                <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[15px] font-semibold">
                  {f.q}
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
                </summary>
                <p className="mt-2 text-[14px] text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>

      <PaystackMomoCheckout
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        amount={parseFloat((activationFee + Math.min(activationFee * 0.03, 100)).toFixed(2))}
        email={profile?.email || user?.email || ""}
        recipientPhone={""}
        recipientNetwork={""}
        metadata={{
          order_id: checkoutReference,
          order_type: "agent_activation",
          agent_id: user?.id,
          base_amount: activationFee,
          paystack_fee: Math.min(activationFee * 0.03, 100),
        }}
        onSuccess={handleCheckoutSuccess}
        onFailure={handleCheckoutFailure}
      />
    </div>
  );
};

export default AgentProgram;
