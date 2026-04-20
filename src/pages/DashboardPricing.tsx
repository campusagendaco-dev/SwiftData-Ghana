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
      defaults[network][pkg.size] = (basePrice + 2).toFixed(2);
    }
  }
  return defaults;
};

const getProfileAssignedPrice = (
  agentPrices: Record<string, any> | undefined,
  network: string,
  size: string,
): number | null => {
  if (!agentPrices || typeof agentPrices !== "object") return null;

  const networkCandidates = [
    network,
    network.replace(/\s+/g, ""),
    network === "AT iShare" ? "AirtelTigo" : network,
  ];
  const sizeCandidates = [size, size.replace(/\s+/g, ""), size.toUpperCase()];

  for (const n of networkCandidates) {
    const byNetwork = agentPrices[n] as Record<string, string | number> | undefined;
    if (!byNetwork) continue;
    for (const s of sizeCandidates) {
      const value = Number(byNetwork[s]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }

  return null;
};

const DashboardPricing = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const isSubAgent = Boolean(profile?.is_sub_agent);
  const [prices, setPrices] = useState<AgentPrices>({});
  const [disabledPkgs, setDisabledPkgs] = useState<DisabledPackages>({});
  const [packageBasePrices, setPackageBasePrices] = useState<PackageBasePrices>({});
  const [saving, setSaving] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState("MTN");

  useEffect(() => {
    const loadBasePrices = async () => {
      const pricingContext = await fetchApiPricingContext();
      const nextBasePrices: PackageBasePrices = {};
      for (const [network, pkgs] of Object.entries(basePackages)) {
        nextBasePrices[network] = {};
        for (const pkg of pkgs) {
          nextBasePrices[network][pkg.size] = applyPriceMultiplier(pkg.price, pricingContext.multiplier);
        }
      }

      const { data } = await supabase
        .from("global_package_settings")
        .select("network, package_size, agent_price");

      (data || []).forEach((row: any) => {
        const numericAgentPrice = Number(row?.agent_price);
        if (!Number.isFinite(numericAgentPrice) || numericAgentPrice <= 0) return;
        if (!nextBasePrices[row.network]) nextBasePrices[row.network] = {};
        nextBasePrices[row.network][row.package_size] = applyPriceMultiplier(numericAgentPrice, pricingContext.multiplier);
      });

      // For sub-agents, base prices come from prices assigned by their parent agent.
      if (profile?.is_sub_agent && profile.parent_agent_id) {
        const { data: parentProfile } = await supabase
          .from("profiles")
          .select("sub_agent_prices")
          .eq("user_id", profile.parent_agent_id)
          .maybeSingle();
        const assigned = (parentProfile?.sub_agent_prices || {}) as Record<string, any>;
        for (const [network, pkgs] of Object.entries(basePackages)) {
          for (const pkg of pkgs) {
            const assignedPrice = getProfileAssignedPrice(assigned, network, pkg.size);
            if (assignedPrice && assignedPrice > 0) {
              nextBasePrices[network][pkg.size] = applyPriceMultiplier(assignedPrice, pricingContext.multiplier);
            }
          }
        }
      }

      setPackageBasePrices(nextBasePrices);
    };

    loadBasePrices();
  }, [profile]);

  useEffect(() => {
    const defaults = buildDefaultPrices(packageBasePrices);
    const savedPrices = (profile?.agent_prices || {}) as Record<string, any>;

    for (const [network, pkgs] of Object.entries(basePackages)) {
      for (const pkg of pkgs) {
        const saved = savedPrices?.[network]?.[pkg.size];
        if (saved !== undefined && saved !== null && saved !== "") {
          defaults[network][pkg.size] = String(saved);
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
        if (!Number.isFinite(numericPrice) || numericPrice < basePrice) {
          toast({
            title: "Invalid price",
            description: `${network} ${pkg.size} price (GHS ${Number.isFinite(numericPrice) ? numericPrice.toFixed(2) : "0.00"}) cannot be below base price (GHS ${basePrice.toFixed(2)}).`,
            variant: "destructive",
          });
          return;
        }
      }
    }

    setSaving(true);
    const existingPrices = (profile?.agent_prices || {}) as Record<string, any>;
    const mergedPrices = { ...existingPrices, ...prices };

    const { error } = await supabase
      .from("profiles")
      .update({ agent_prices: mergedPrices, disabled_packages: disabledPkgs } as any)
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Error saving prices", description: error.message, variant: "destructive" });
    } else {
      await refreshProfile();
      toast({
        title: isSubAgent
          ? "Prices saved! Your sub-agent store prices are updated."
          : "Prices saved! Your store has been updated.",
      });
    }

    setSaving(false);
  };

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold">Store Pricing</h1>
        <p className="text-muted-foreground">Set your selling price for each package. Toggle packages on/off for availability.</p>
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
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Your Price</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Profit</th>
              <th className="text-center py-3 px-4 font-medium text-muted-foreground">Available</th>
            </tr>
          </thead>
          <tbody>
            {basePackages[selectedNetwork]?.map((pkg) => {
              const basePrice = getBasePrice(selectedNetwork, pkg.size);
              const profit = getProfit(selectedNetwork, pkg.size);
              const disabled = isDisabled(selectedNetwork, pkg.size);
              return (
                <tr key={pkg.size} className={`border-b border-border/50 ${disabled ? "opacity-50" : ""}`}>
                  <td className="py-3 px-4">
                    <span className="font-medium text-foreground">{pkg.size}</span>
                    <span className="text-xs text-muted-foreground ml-2">{pkg.validity}</span>
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
                        min={basePrice}
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
