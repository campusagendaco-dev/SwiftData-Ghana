import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { basePackages, networks } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

type AgentPrices = Record<string, Record<string, string>>;
type DisabledPackages = Record<string, string[]>;

const DashboardPricing = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [prices, setPrices] = useState<AgentPrices>({});
  const [disabledPkgs, setDisabledPkgs] = useState<DisabledPackages>({});
  const [saving, setSaving] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState("MTN");

  useEffect(() => {
    if (profile?.agent_prices && Object.keys(profile.agent_prices).length > 0) {
      setPrices(profile.agent_prices);
    } else {
      const defaults: AgentPrices = {};
      for (const [network, pkgs] of Object.entries(basePackages)) {
        defaults[network] = {};
        for (const pkg of pkgs) {
          defaults[network][pkg.size] = (pkg.price + 2).toFixed(2);
        }
      }
      setPrices(defaults);
    }
    // Load disabled packages
    if ((profile as any)?.disabled_packages) {
      setDisabledPkgs((profile as any).disabled_packages);
    }
  }, [profile]);

  const getPrice = (network: string, size: string) => prices[network]?.[size] || "";
  const setPrice = (network: string, size: string, value: string) => {
    setPrices((prev) => ({ ...prev, [network]: { ...prev[network], [size]: value } }));
  };

  const isDisabled = (network: string, size: string) => disabledPkgs[network]?.includes(size) || false;
  const toggleDisabled = (network: string, size: string) => {
    setDisabledPkgs((prev) => {
      const list = prev[network] || [];
      if (list.includes(size)) {
        return { ...prev, [network]: list.filter((s) => s !== size) };
      } else {
        return { ...prev, [network]: [...list, size] };
      }
    });
  };

  const getProfit = (network: string, size: string) => {
    const basePrice = basePackages[network]?.find((p) => p.size === size)?.price || 0;
    const agentPrice = parseFloat(getPrice(network, size)) || 0;
    return agentPrice - basePrice;
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    for (const [network, pkgs] of Object.entries(basePackages)) {
      for (const pkg of pkgs) {
        const agentPrice = parseFloat(prices[network]?.[pkg.size] || "0");
        if (agentPrice < pkg.price) {
          toast({
            title: "Invalid price",
            description: `${network} ${pkg.size} price (GH₵${agentPrice.toFixed(2)}) cannot be below base price (GH₵${pkg.price.toFixed(2)})`,
            variant: "destructive",
          });
          setSaving(false);
          return;
        }
      }
    }

    const { error } = await supabase
      .from("profiles")
      .update({ agent_prices: prices, disabled_packages: disabledPkgs } as any)
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Error saving prices", description: error.message, variant: "destructive" });
    } else {
      await refreshProfile();
      toast({ title: "Prices saved! Your store has been updated." });
    }
    setSaving(false);
  };

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold">Store Pricing</h1>
        <p className="text-muted-foreground">Set your selling price for each package. Toggle packages on/off for availability.</p>
      </div>

      {/* Network tabs */}
      <div className="flex gap-2 mb-6">
        {networks.map((n) => (
          <button
            key={n.name}
            onClick={() => setSelectedNetwork(n.name)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedNetwork === n.name
                ? "bg-primary/10 text-primary border border-primary/20"
                : "bg-card border border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {n.name}
          </button>
        ))}
      </div>

      {/* Package pricing table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Package</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Base Price</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Your Price</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Profit</th>
              <th className="text-center py-3 px-4 font-medium text-muted-foreground">Available</th>
            </tr>
          </thead>
          <tbody>
            {basePackages[selectedNetwork]?.map((pkg) => {
              const profit = getProfit(selectedNetwork, pkg.size);
              const disabled = isDisabled(selectedNetwork, pkg.size);
              return (
                <tr key={pkg.size} className={`border-b border-border/50 ${disabled ? "opacity-50" : ""}`}>
                  <td className="py-3 px-4">
                    <span className="font-medium text-foreground">{pkg.size}</span>
                    <span className="text-xs text-muted-foreground ml-2">{pkg.validity}</span>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">GH₵ {pkg.price.toFixed(2)}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground text-xs">GH₵</span>
                      <Input
                        value={getPrice(selectedNetwork, pkg.size)}
                        onChange={(e) => setPrice(selectedNetwork, pkg.size, e.target.value)}
                        className="w-24 h-8 text-center bg-secondary text-sm"
                        type="number" step="0.50" min={pkg.price}
                      />
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`font-medium ${profit > 0 ? "text-primary" : profit < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {profit >= 0 ? "+" : ""}GH₵ {profit.toFixed(2)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <Switch
                      checked={!disabled}
                      onCheckedChange={() => toggleDisabled(selectedNetwork, pkg.size)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save All Prices"}
      </Button>
    </div>
  );
};

export default DashboardPricing;
