import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { basePackages, networks } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";

type AgentPrices = Record<string, Record<string, string>>;
type DisabledPackages = Record<string, string[]>;
type PackageBasePrices = Record<string, Record<string, number>>;

const buildDefaultPrices = (packageBasePrices: PackageBasePrices): AgentPrices => {
  const defaults: AgentPrices = {};
  for (const [network, pkgs] of Object.entries(basePackages)) {
    defaults[network] = {};
    for (const pkg of pkgs) {
      const basePrice = packageBasePrices[network]?.[pkg.size] ?? pkg.price;
      // Default to the same margin as guest pricing if possible, otherwise default base+2
      defaults[network][pkg.size] = (basePrice + 2).toFixed(2);
    }
  }
  return defaults;
};

const DashboardCustomerPricing = () => {
  const { user, profile, refreshProfile, isAdmin } = useAuth();
  const { toast } = useToast();
  const [selectedNetwork, setSelectedNetwork] = useState(networks[0].name);
  const [prices, setPrices] = useState<AgentPrices>({});
  const [disabledPkgs, setDisabledPkgs] = useState<DisabledPackages>({});
  const [saving, setSaving] = useState(false);
  const [isSubAgent, setIsSubAgent] = useState(false);

  const [packageBasePrices, setPackageBasePrices] = useState<PackageBasePrices>({});
  const [globallyUnavailable, setGloballyUnavailable] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setIsSubAgent(profile?.is_sub_agent === true);
  }, [profile]);

  useEffect(() => {
    const loadApiPricing = async () => {
      const ctx = await fetchApiPricingContext(profile?.parent_agent_id);
      
      const newBases: PackageBasePrices = {};
      const newOffline: Record<string, string[]> = {};

      for (const [net, pkgs] of Object.entries(basePackages)) {
        newBases[net] = {};
        for (const pkg of pkgs) {
          const applied = applyPriceMultiplier(pkg, net, ctx);
          newBases[net][pkg.size] = applied.price;
          
          if (!applied.isAvailable) {
            if (!newOffline[net]) newOffline[net] = [];
            newOffline[net].push(pkg.size);
          }
        }
      }
      setPackageBasePrices(newBases);
      setGloballyUnavailable(newOffline);
    };
    loadApiPricing();
  }, [profile?.parent_agent_id]);

  useEffect(() => {
    const defaults = buildDefaultPrices(packageBasePrices);
    
    // We try to default to the existing guest 'agent_prices' if registered_user_prices is empty
    const fallbackPrices = (profile?.agent_prices || {}) as Record<string, any>;
    const savedPrices = (profile?.registered_user_prices || {}) as Record<string, any>;

    for (const [network, pkgs] of Object.entries(basePackages)) {
      for (const pkg of pkgs) {
        const saved = savedPrices?.[network]?.[pkg.size];
        if (saved !== undefined && saved !== null && saved !== "") {
          defaults[network][pkg.size] = String(saved);
        } else {
          // Fallback to guest pricing so it's not a shock
          const fallback = fallbackPrices?.[network]?.[pkg.size];
          if (fallback !== undefined && fallback !== null && fallback !== "") {
            defaults[network][pkg.size] = String(fallback);
          }
        }
      }
    }

    setPrices(defaults);

    if ((profile as any)?.disabled_packages) {
      setDisabledPkgs((profile as any).disabled_packages);
    } else {
      setDisabledPkgs({});
    }
  }, [profile, packageBasePrices]);

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
      }
      return { ...prev, [network]: [...list, size] };
    });
  };

  const getBasePrice = (network: string, size: string) =>
    packageBasePrices[network]?.[size] ?? basePackages[network]?.find((p) => p.size === size)?.price ?? 0;

  const getProfit = (network: string, size: string) => {
    const basePrice = getBasePrice(network, size);
    const agentPrice = parseFloat(getPrice(network, size)) || 0;
    return agentPrice - basePrice;
  };

  const handleSave = async () => {
    if (!user) return;

    for (const [network, pkgs] of Object.entries(basePackages)) {
      for (const pkg of pkgs) {
        const numericPrice = Number(prices?.[network]?.[pkg.size]);
        const basePrice = getBasePrice(network, pkg.size);
        if (!isAdmin && (!Number.isFinite(numericPrice) || numericPrice < basePrice)) {
          toast({
            title: "Price Too Low",
            description: `${network} ${pkg.size}: Your selling price (GHS ${Number.isFinite(numericPrice) ? numericPrice.toFixed(2) : "0.00"}) is below your base cost (GHS ${basePrice.toFixed(2)}). Please increase it to save.`,
            variant: "destructive",
          });
          return;
        }
      }
    }

    setSaving(true);
    const existingPrices = (profile?.registered_user_prices || {}) as Record<string, any>;
    const mergedPrices = { ...existingPrices, ...prices };

    const { error } = await supabase
      .from("profiles")
      .update({ registered_user_prices: mergedPrices, disabled_packages: disabledPkgs } as any)
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Error saving prices", description: error.message, variant: "destructive" });
    } else {
      await refreshProfile();
      toast({
        title: "Customer prices saved!",
        description: "Registered users will now see these prices when logged into your store.",
      });
    }

    setSaving(false);
  };

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold">Registered Customer Pricing</h1>
        <p className="text-muted-foreground">Set your selling price specifically for users who create an account and log in to your store.</p>
      </div>

      {isSubAgent && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Your parent agent sets your base prices. You can add your own profit above that base.
        </div>
      )}

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

      <div className="bg-card border border-border rounded-xl overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Package</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Base Price</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">User Price</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Profit</th>
              <th className="text-center py-3 px-4 font-medium text-muted-foreground">Available</th>
            </tr>
          </thead>
          <tbody>
            {basePackages[selectedNetwork]?.map((pkg) => {
              const basePrice = getBasePrice(selectedNetwork, pkg.size);
              const profit = getProfit(selectedNetwork, pkg.size);
              const disabled = isDisabled(selectedNetwork, pkg.size);
              const isGloballyOffline = globallyUnavailable[selectedNetwork]?.includes(pkg.size) || false;
              return (
                <tr key={pkg.size} className={`border-b border-border/50 ${(disabled || isGloballyOffline) ? "opacity-50" : ""}`}>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{pkg.size}</span>
                      <span className="text-xs text-muted-foreground">{pkg.validity}</span>
                      {isGloballyOffline && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20 font-bold uppercase tracking-wider animate-pulse">
                          Offline
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">GHS {basePrice.toFixed(2)}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground text-xs">GHS</span>
                      <Input
                        value={getPrice(selectedNetwork, pkg.size)}
                        onChange={(e) => setPrice(selectedNetwork, pkg.size, e.target.value)}
                        className="w-24 h-8 text-center bg-secondary text-sm"
                        type="number"
                        step="0.50"
                        min={isAdmin ? undefined : basePrice}
                        disabled={isGloballyOffline}
                      />
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`font-medium ${profit > 0 ? "text-primary" : profit < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {profit >= 0 ? "+" : ""}GHS {profit.toFixed(2)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <Switch
                      checked={!disabled && !isGloballyOffline}
                      onCheckedChange={() => toggleDisabled(selectedNetwork, pkg.size)}
                      disabled={isGloballyOffline}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save User Prices"}
      </Button>
    </div>
  );
};

export default DashboardCustomerPricing;
