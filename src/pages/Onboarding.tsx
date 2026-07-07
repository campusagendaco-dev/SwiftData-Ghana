import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { generateSlug } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, ShieldCheck, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const Onboarding = () => {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [accountType, setAccountType] = useState<"reseller" | "agent">("reseller");
  const [form, setForm] = useState({
    store_name: "",
    whatsapp_number: "",
    support_number: "",
    email: "",
    full_name: "",
    whatsapp_group_link: "",
    momo_number: "",
    momo_network: "",
    momo_account_name: "",
  });

  const update = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const isAgentMode = accountType === "agent";

    if (isAgentMode) {
      if (!form.store_name.trim() || !form.whatsapp_number.trim() || !form.support_number.trim() || !form.full_name.trim() || !form.momo_number.trim() || !form.momo_network.trim() || !form.momo_account_name.trim()) {
        toast({ title: "Please fill in all required fields", variant: "destructive" });
        return;
      }
    } else {
      if (!form.full_name.trim() || !form.whatsapp_number.trim() || !form.momo_number.trim() || !form.momo_network.trim() || !form.momo_account_name.trim()) {
        toast({ title: "Please fill in all required fields", variant: "destructive" });
        return;
      }
    }

    setLoading(true);
    const slug = isAgentMode ? generateSlug(form.store_name) : null;
    const { error } = await supabase
      .from("profiles")
      .update({
        store_name: isAgentMode ? form.store_name.trim() : null,
        whatsapp_number: form.whatsapp_number.trim(),
        support_number: isAgentMode ? form.support_number.trim() : form.whatsapp_number.trim(),
        email: form.email.trim() || user.email || "",
        full_name: form.full_name.trim(),
        whatsapp_group_link: isAgentMode ? (form.whatsapp_group_link.trim() || null) : null,
        momo_number: form.momo_number.trim(),
        momo_network: form.momo_network.trim(),
        momo_account_name: form.momo_account_name.trim(),
        slug,
        is_agent: true,
        onboarding_complete: true,
        // agent_approved stays false — admin must approve
      })
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Error saving details", description: error.message, variant: "destructive" });
    } else {
      if (isAgentMode) {
        // Direct insertion to reseller_stores so storefront exists immediately
        try {
          await supabase
            .from("reseller_stores")
            .insert({
              user_id: user.id,
              store_name: form.store_name.trim(),
              slug,
              store_primary_color: "#fbbf24",
            });
        } catch (e) {
          console.error("[Onboarding] Error creating reseller store:", e);
        }
      }

      await refreshProfile();
      
      let activationFee = 50;
      try {
        const { data: settings } = await supabase.from("system_settings").select("agent_activation_fee").eq("id", 1).maybeSingle();
        if (settings?.agent_activation_fee) {
          activationFee = Number(settings.agent_activation_fee);
        }
      } catch (e) { /* ignore error */ }

      toast({ title: "Details saved!", description: `Now pay GHS ${activationFee} and contact admin on WhatsApp for reseller approval.` });
      navigate("/agent/pending");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen pt-24 pb-16 px-4 flex items-center justify-center">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-[#162316] flex items-center justify-center shadow-lg">
              <span className="text-white font-black text-[11px] text-center leading-tight">SWIFT<br/>DATA</span>
            </div>
          </div>
          <h1 className="font-display text-2xl font-bold mb-2">Reseller Account Setup</h1>
          <p className="text-muted-foreground text-sm">
            Select your preferred partner tier and enter your billing details.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 glow-yellow">
          <div className="grid grid-cols-2 gap-4 mb-6">
            <button
              type="button"
              onClick={() => setAccountType("reseller")}
              className={`p-4 rounded-xl border text-left transition-all outline-none ${
                accountType === "reseller"
                  ? "bg-amber-400/10 border-amber-400 text-white shadow-[0_0_15px_rgba(251,191,36,0.1)]"
                  : "bg-white/3 border-white/5 text-white/60 hover:border-white/10"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className={`w-4 h-4 ${accountType === "reseller" ? "text-amber-400" : "text-white/30"}`} />
                <span className="font-bold text-xs uppercase tracking-wider">Reseller</span>
              </div>
              <p className="text-[10px] leading-relaxed text-white/40">Wholesale pricing on your personal account. No storefront website.</p>
            </button>

            <button
              type="button"
              onClick={() => setAccountType("agent")}
              className={`p-4 rounded-xl border text-left transition-all outline-none ${
                accountType === "agent"
                  ? "bg-amber-400/10 border-amber-400 text-white shadow-[0_0_15px_rgba(251,191,36,0.1)]"
                  : "bg-white/3 border-white/5 text-white/60 hover:border-white/10"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Globe className={`w-4 h-4 ${accountType === "agent" ? "text-amber-400" : "text-white/30"}`} />
                <span className="font-bold text-xs uppercase tracking-wider">Agent Store</span>
              </div>
              <p className="text-[10px] leading-relaxed text-white/40">Get your own branded storefront website and custom domain.</p>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="full_name">Full Name *</Label>
              <Input
                id="full_name"
                value={form.full_name}
                onChange={(e) => update("full_name", e.target.value)}
                placeholder="Kwame Asante"
                className="mt-1 bg-secondary"
                required
              />
            </div>
            
            {accountType === "agent" && (
              <div>
                <Label htmlFor="store_name">Store Name *</Label>
                <Input
                  id="store_name"
                  value={form.store_name}
                  onChange={(e) => update("store_name", e.target.value)}
                  placeholder="Kwame's Data Hub"
                  className="mt-1 bg-secondary"
                  required
                />
              </div>
            )}

            <div>
              <Label htmlFor="onboard_email">Email Address</Label>
              <Input
                id="onboard_email"
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                placeholder="kwame@example.com"
                className="mt-1 bg-secondary"
              />
            </div>
            <div>
              <Label htmlFor="whatsapp_number">WhatsApp Number *</Label>
              <Input
                id="whatsapp_number"
                value={form.whatsapp_number}
                onChange={(e) => update("whatsapp_number", e.target.value)}
                placeholder="024 XXX XXXX"
                className="mt-1 bg-secondary"
                required
              />
            </div>

            {accountType === "agent" && (
              <div>
                <Label htmlFor="support_number">Customer Support Number *</Label>
                <Input
                  id="support_number"
                  value={form.support_number}
                  onChange={(e) => update("support_number", e.target.value)}
                  placeholder="020 XXX XXXX"
                  className="mt-1 bg-secondary"
                  required
                />
              </div>
            )}

            <div>
              <Label htmlFor="momo_account_name">MoMo Account Name *</Label>
              <Input
                id="momo_account_name"
                value={form.momo_account_name}
                onChange={(e) => update("momo_account_name", e.target.value)}
                placeholder="Kwame Asante"
                className="mt-1 bg-secondary"
                required
              />
            </div>
            <div>
              <Label htmlFor="momo_number">MoMo Number *</Label>
              <Input
                id="momo_number"
                value={form.momo_number}
                onChange={(e) => update("momo_number", e.target.value)}
                placeholder="024 XXX XXXX"
                className="mt-1 bg-secondary"
                required
              />
            </div>
            <div>
              <Label htmlFor="momo_network">MoMo Network *</Label>
              <select
                id="momo_network"
                value={form.momo_network}
                onChange={(e) => update("momo_network", e.target.value)}
                className="w-full mt-1 bg-[#1a1a24] border border-input rounded-md px-3 py-2 text-sm text-white"
                required
              >
                <option value="">Select network</option>
                <option value="MTN">MTN</option>
                <option value="Telecel">Telecel</option>
                <option value="AirtelTigo">AirtelTigo</option>
              </select>
            </div>

            {accountType === "agent" && (
              <div>
                <Label htmlFor="whatsapp_group_link">WhatsApp Group/Channel Link (optional)</Label>
                <Input
                  id="whatsapp_group_link"
                  value={form.whatsapp_group_link}
                  onChange={(e) => update("whatsapp_group_link", e.target.value)}
                  placeholder="https://chat.whatsapp.com/..."
                  className="mt-1 bg-secondary"
                />
              </div>
            )}

            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? "Setting up..." : accountType === "agent" ? "Create Storefront & Continue" : "Complete Registration"}
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
