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
  { icon: Users, title: "Approval-Based Access", desc: "Only approved reseller accounts can go live and accept sales." },
  { icon: Layers, title: "Full Dashboard", desc: "Track orders, profits, and manage your reseller business in one place." },
];

const steps = [
  "Create or sign in to your DataHive account",
  "Click Request Approval",
  "Pay GHS 50 approval fee and contact support on WhatsApp",
  "Wait for admin approval",
  "Complete your reseller store setup",
  "Set your prices and share your store link",
  "Earn profit on every successful data purchase without wallet pre-funding",
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
            title: "Approval Pending",
            description: "Your reseller access request is pending. You can continue after admin approval.",
            label: "View Status",
          }
      : {
          type: "action" as const,
          title: "Request Reseller Access",
          description: "Submit your reseller access request. Admin approval is required before setup.",
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
    toast({ title: "Request submitted", description: "Wait for admin approval before reseller setup." });
    navigate("/agent/pending");
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="container mx-auto max-w-4xl">
        <div className="text-center mb-16">
          <h1 className="font-display text-3xl md:text-5xl font-bold mb-4">
            Become a <span className="text-gradient">QuickData Reseller</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Start your own data reselling business. Approved resellers can set their own prices, run a branded store, and earn from each order.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
          {benefits.map((b) => (
            <div key={b.title} className="flex gap-4 p-6 rounded-xl border border-border bg-card">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <b.icon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-display font-semibold mb-1">{b.title}</h3>
                <p className="text-sm text-muted-foreground">{b.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-16">
          <h2 className="font-display text-2xl font-bold text-center mb-8">How It Works</h2>
          <div className="space-y-4 max-w-lg mx-auto">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-foreground">{step}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 md:p-10 max-w-lg mx-auto glow-yellow text-center">
          <h2 className="font-display text-2xl font-bold mb-4">{cta.title}</h2>
          <p className="text-muted-foreground mb-6">{cta.description}</p>
          {cta.type === "link" ? (
            <Button size="lg" asChild>
              <Link to={cta.to}>
                {cta.label} <ArrowRight className="ml-2 w-4 h-4" />
              </Link>
            </Button>
          ) : (
            <Button size="lg" onClick={handleRequestApproval} disabled={submitting}>
              {submitting ? "Submitting..." : cta.label} <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentProgram;
