import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import AfaOrderForm from "@/components/AfaOrderForm";
import { Shield } from "lucide-react";

const AFA_BASE_PRICE = 12.5;

const DashboardAfa = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [afaPrice, setAfaPrice] = useState(() => {
    const saved = (profile?.agent_prices as Record<string, any>)?.AFA?.price;
    return saved || (AFA_BASE_PRICE + 2).toFixed(2);
  });
  const [saving, setSaving] = useState(false);

  const profit = (parseFloat(afaPrice) || 0) - AFA_BASE_PRICE;

  const handleSavePrice = async () => {
    if (!user) return;
    const price = parseFloat(afaPrice);
    if (price < AFA_BASE_PRICE) {
      toast({ title: "Price cannot be below base price", description: `Minimum: GH₵ ${AFA_BASE_PRICE.toFixed(2)}`, variant: "destructive" });
      return;
    }
    setSaving(true);
    const currentPrices = (profile?.agent_prices || {}) as Record<string, any>;
    const { error } = await supabase
      .from("profiles")
      .update({ agent_prices: { ...currentPrices, AFA: { price: afaPrice } } })
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Error saving", description: error.message, variant: "destructive" });
    } else {
      await refreshProfile();
      toast({ title: "AFA price saved to your store!" });
    }
    setSaving(false);
  };

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold">AFA Bundle</h1>
        <p className="text-muted-foreground">Order AFA bundles or add them to your store for customers to purchase.</p>
      </div>

      {/* Agent pricing section */}
      <div className="bg-card border border-border rounded-xl p-6 mb-8">
        <h2 className="font-display text-lg font-semibold mb-1">Add AFA to Your Store</h2>
        <p className="text-sm text-muted-foreground mb-4">Set your selling price. Customers will see this price on your store.</p>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Base Price</p>
            <p className="text-sm font-medium text-foreground">GH₵ {AFA_BASE_PRICE.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Your Price</p>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">GH₵</span>
              <Input
                value={afaPrice}
                onChange={(e) => setAfaPrice(e.target.value)}
                className="w-24 h-8 text-center bg-secondary text-sm"
                type="number"
                step="0.50"
                min={AFA_BASE_PRICE}
              />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Your Profit</p>
            <p className={`text-sm font-medium ${profit > 0 ? "text-primary" : profit < 0 ? "text-destructive" : "text-muted-foreground"}`}>
              {profit >= 0 ? "+" : ""}GH₵ {profit.toFixed(2)}
            </p>
          </div>
          <Button size="sm" onClick={handleSavePrice} disabled={saving}>
            {saving ? "Saving..." : "Save to Store"}
          </Button>
        </div>
      </div>

      {/* Order AFA for a customer */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-5 h-5 text-primary" />
          <h2 className="font-display text-lg font-semibold">Place AFA Order</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Order an AFA bundle at the base price of GH₵ {AFA_BASE_PRICE.toFixed(2)}.</p>
        <AfaOrderForm
          price={AFA_BASE_PRICE.toFixed(2)}
          agentId={user?.id}
          profit={0}
        />
      </div>
    </div>
  );
};

export default DashboardAfa;
