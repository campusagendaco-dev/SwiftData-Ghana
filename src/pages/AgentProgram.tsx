import { useState, useEffect } from "react";
import { ArrowRight, CheckCircle, Users, Globe, TrendingUp, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="min-h-screen pt-12 md:pt-24 pb-16 px-4">
      <SEO 
        title="Become a Data Reseller Agent — Start Your Business"
        description="Launch your own data reselling business in Ghana. Unlock wholesale prices for MTN, Telecel & AirtelTigo and get your own branded store."
        keywords="resell data in ghana, start data business, data reseller Ghana, wholesale MTN data, agent program Ghana, cheap internet bundles ghana"
        canonical="https://swiftdatagh.shop/agent-program"
      />
      <div className="container mx-auto max-w-4xl">
        <div className="text-center mb-10 md:mb-16">
          <h1 className="font-display text-3xl md:text-5xl font-black mb-4">
            Become a <span className="text-gradient">SwiftData Reseller</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            {isPromoActive 
              ? `Start your own data reselling business today. Secure a 100% FREE agent slot (normally GHS ${activationFee}), set your own prices, run your own store, and earn instantly!` 
              : `Start your own data reselling business. Pay GHS ${activationFee} for activation, set your own prices, run a branded store, and earn from each order after a quick manual review.`
            }
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 mb-10 md:mb-16">
          {benefits(isPromoActive ? 0 : activationFee).map((b) => (
            <div key={b.title} className="flex gap-4 p-6 rounded-2xl glass-card hover:border-primary/30 transition-all">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <b.icon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-display font-bold mb-1">{b.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {b.desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-10 md:mb-16">
          <h2 className="font-display text-2xl font-black text-center mb-8">How It Works</h2>
          <div className="space-y-4 max-w-lg mx-auto">
            {steps(isPromoActive ? 0 : activationFee).map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-primary">{i + 1}</span>
                </div>
                <p className="text-foreground">
                  {step}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className={`glass-card rounded-3xl p-8 md:p-10 max-w-lg mx-auto text-center ${isPromoActive ? "glow-green border-green-500/30 border-2 relative overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500" : "glow-yellow"}`}>
          {isPromoActive && (
            <div className="absolute top-0 right-0 left-0 bg-green-500/10 text-green-400 py-1 text-xs font-bold uppercase tracking-wider border-b border-green-500/20">
              🔥 Limited Promo Spot Available
            </div>
          )}
          <div className={isPromoActive ? "mt-4" : ""}>
            <h2 className={`font-display text-2xl font-black mb-4 ${isPromoActive ? "text-green-400" : ""}`}>{cta.title}</h2>
            <p className="text-muted-foreground mb-6">{cta.description}</p>
            {cta.type === "link" ? (
              <Button size="lg" className={`rounded-xl px-8 ${isPromoActive ? "bg-green-500 hover:bg-green-600 text-white font-bold border-0 shadow-lg shadow-green-500/20" : ""}`} asChild>
                <Link to={cta.to}>
                  {cta.label} <ArrowRight className="ml-2 w-4 h-4" />
                </Link>
              </Button>
            ) : (
              <Button size="lg" className={`rounded-xl px-8 ${isPromoActive ? "bg-green-500 hover:bg-green-600 text-white font-bold border-0 shadow-lg shadow-green-500/20 animate-pulse hover:animate-none" : ""}`} onClick={handleRequestApproval} disabled={submitting}>
                {submitting ? "Claiming Slot..." : cta.label} <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
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
