import { useState } from "react";
import { ArrowRight, CheckCircle, Users, Globe, TrendingUp, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const benefits = [
  { icon: TrendingUp, title: "Set Your Own Profit", desc: "Set your reseller prices above our wholesale base and keep the margin." },
  { icon: Globe, title: "Your Own Website", desc: "Get a branded reseller website to sell data under your name." },
  { icon: Users, title: "Instant Activation", desc: "Pay GHS 80 and get approved automatically — no waiting." },
  { icon: Layers, title: "Full Dashboard", desc: "Track orders, profits, and manage your reseller business in one place." },
];

const steps = [
  "Create or sign in to your SwiftData account",
  "Click Request Approval below",
  "Pay GHS 80 activation fee via Paystack (MoMo or Card)",
  "Your account is automatically approved after payment",
  "Complete your reseller store setup",
  "Set your prices and share your store link",
  "Earn profit on every successful data purchase",
];

const AgentProgram = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const cta = !user
    ? {
        type: "link" as const,
        to: "/login",
        title: "Login to Continue",
        description: "Please sign in first, then request reseller approval.",
        label: "Login and Continue",
      }
    : profile?.is_agent
      ? profile?.agent_approved
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
        : {
            type: "link" as const,
            to: "/agent/pending",
            title: "Complete Activation",
            description: "Pay GHS 80 to activate your reseller account instantly.",
            label: "Pay & Activate",
          }
      : {
          type: "action" as const,
          title: "Become a Reseller",
          description: "Submit your request and pay GHS 80 to activate your reseller account.",
          label: "Request Approval",
        };

  const handleRequestApproval = async () => {
    if (!user) {
      navigate("/login");
      return;
    }

    setSubmitting(true);
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
    toast({ title: "Request submitted", description: "Proceed to pay GHS 80 for instant activation." });
    navigate("/agent/pending");
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="container mx-auto max-w-4xl">
        <div className="text-center mb-16">
          <h1 className="font-display text-3xl md:text-5xl font-black mb-4">
            Become a <span className="text-gradient">SwiftData Reseller</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Start your own data reselling business. Pay GHS 80 for instant activation, set your own prices, run a branded store, and earn from each order.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
          {benefits.map((b) => (
            <div key={b.title} className="flex gap-4 p-6 rounded-2xl glass-card hover:border-primary/30 transition-all">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <b.icon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-display font-bold mb-1">{b.title}</h3>
                <p className="text-sm text-muted-foreground">{b.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-16">
          <h2 className="font-display text-2xl font-black text-center mb-8">How It Works</h2>
          <div className="space-y-4 max-w-lg mx-auto">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-primary">{i + 1}</span>
                </div>
                <p className="text-foreground">{step}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card rounded-3xl p-8 md:p-10 max-w-lg mx-auto glow-yellow text-center">
          <h2 className="font-display text-2xl font-black mb-4">{cta.title}</h2>
          <p className="text-muted-foreground mb-6">{cta.description}</p>
          {cta.type === "link" ? (
            <Button size="lg" className="rounded-xl px-8" asChild>
              <Link to={cta.to}>
                {cta.label} <ArrowRight className="ml-2 w-4 h-4" />
              </Link>
            </Button>
          ) : (
            <Button size="lg" className="rounded-xl px-8" onClick={handleRequestApproval} disabled={submitting}>
              {submitting ? "Submitting..." : cta.label} <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentProgram;
