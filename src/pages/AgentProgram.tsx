import { ArrowRight, CheckCircle, Users, Globe, TrendingUp, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const benefits = [
  { icon: TrendingUp, title: "Set Your Own Prices", desc: "Add your profit margin on top of our wholesale prices." },
  { icon: Globe, title: "Your Own Website", desc: "Get a branded sub-agent website to sell data under your name." },
  { icon: Users, title: "Manage Sub-Agents", desc: "Recruit sub-agents and earn commissions from their sales." },
  { icon: Layers, title: "Full Dashboard", desc: "Track orders, profits, and manage your business in one place." },
];

const steps = [
  "Create or sign in to your QuickData account",
  "Click Become Agent",
  "Complete your store setup details",
  "Your branded website is created automatically",
  "Set your prices and share your store link",
  "Earn profit on every data purchase through your site",
];

const AgentProgram = () => {
  const { user, profile } = useAuth();

  const cta = !user
    ? {
        to: "/login",
        title: "Login to Continue",
        description: "Please sign in first, then click Become Agent to register as an agent.",
        label: "Login and Continue",
      }
    : profile?.is_agent
      ? profile?.onboarding_complete
        ? profile?.agent_approved
          ? {
              to: "/dashboard",
              title: "You Are Already an Agent",
              description: "Your account is approved. Open your dashboard.",
              label: "Open Dashboard",
            }
          : {
              to: "/agent/pending",
              title: "Approval Pending",
              description: "Your agent registration is complete. Please wait for admin approval.",
              label: "View Status",
            }
        : {
            to: "/onboarding",
            title: "Complete Agent Setup",
            description: "Finish your store details to complete agent registration.",
            label: "Continue Setup",
          }
      : {
          to: "/onboarding",
          title: "Ready to Start?",
          description: "You are logged in. Click below to register as an agent.",
          label: "Become an Agent",
        };

  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="container mx-auto max-w-4xl">
        <div className="text-center mb-16">
          <h1 className="font-display text-3xl md:text-5xl font-bold mb-4">
            Become a <span className="text-gradient">QuickData Agent</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Start your own data reselling business today, completely free. Set your prices, get your own website, and earn daily profits.
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
          <Button size="lg" asChild>
            <Link to={cta.to}>
              {cta.label} <ArrowRight className="ml-2 w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AgentProgram;
