import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { basePackages, networks } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";
import { Terminal } from "lucide-react";

type AgentPrices = Record<string, Record<string, string>>;
type DisabledPackages = Record<string, string[]>;
type PackageBasePrices = Record<string, Record<string, number>>;

const buildDefaultPrices = (packageBasePrices: PackageBasePrices): AgentPrices => {
  const defaults: AgentPrices = {};
  const allNetworks = new Set([...Object.keys(basePackages), ...Object.keys(packageBasePrices)]);
  
  for (const network of allNetworks) {
    defaults[network] = {};
    const cleanNetwork = network.replace("Korba ", "");
    const pkgs = basePackages[cleanNetwork] || [];
    for (const pkg of pkgs) {
      const basePrice = packageBasePrices[network]?.[pkg.size] ?? packageBasePrices[cleanNetwork]?.[pkg.size] ?? pkg.price;
      defaults[network][pkg.size] = (basePrice + 2).toFixed(2);
    }

    const customPrices = packageBasePrices[network] || {};
    const baseSizes = new Set(pkgs.map(p => p.size.replace(/\s+/g, "").toUpperCase()));
    for (const [size, basePrice] of Object.entries(customPrices)) {
      const normSize = size.replace(/\s+/g, "").toUpperCase();
      if (!baseSizes.has(normSize)) {
        defaults[network][size] = (basePrice + 2).toFixed(2);
      }
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
  const { user, profile, refreshProfile, isAdmin } = useAuth();
  const { toast } = useToast();
  const isSubAgent = Boolean(profile?.is_sub_agent);
  const [prices, setPrices] = useState<AgentPrices>({});
  const [disabledPkgs, setDisabledPkgs] = useState<DisabledPackages>({});
  const [packageBasePrices, setPackageBasePrices] = useState<PackageBasePrices>({});
  const [globallyUnavailable, setGloballyUnavailable] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState("MTN");
  const [activeGateway, setActiveGateway] = useState<string>("paystack");

  useEffect(() => {
    const loadBasePrices = async () => {
      const pricingContext = await fetchApiPricingContext();
      const nextBasePrices: PackageBasePrices = {};
      for (const [net, pkgs] of Object.entries(basePackages)) {
        nextBasePrices[net] = {};
        const multiplier = pricingContext.multipliers[net] || 1;
        for (const pkg of pkgs) {
          nextBasePrices[net][pkg.size] = applyPriceMultiplier(pkg.price, multiplier);
        }
      }

      const [{ data }, { data: sysSettings }] = await Promise.all([
        supabase
          .from("global_package_settings")
          .select("network, package_size, agent_price, sub_agent_price, cost_price, api_price, is_unavailable"),
        supabase
          .from("system_settings")
          .select("active_payment_gateway")
          .eq("id", 1)
          .maybeSingle(),
      ]);

      if (sysSettings?.active_payment_gateway) {
        setActiveGateway(sysSettings.active_payment_gateway);
      }

      const nextUnavailable: Record<string, string[]> = {};
      (data || []).forEach((row: any) => {
        if (row.is_unavailable) {
          if (!nextUnavailable[row.network]) nextUnavailable[row.network] = [];
          nextUnavailable[row.network].push(row.package_size);
        }
        const numericAgentPrice = Number(row?.agent_price);
        const numericSubAgentPrice = Number(row?.sub_agent_price);
        const numericCostPrice = Number(row?.cost_price);
        const numericApiPrice = Number(row?.api_price);
        
        // For admins, the base price is the cost_price
        // For API users, the base price is the api_price if set, falling back to agent_price
        // For sub-agents, we default to the sub_agent_price if available
        // For normal agents, we use agent_price
        let priceToUse = isAdmin && Number.isFinite(numericCostPrice) && numericCostPrice > 0
          ? numericCostPrice
          : profile?.api_access_enabled
            ? (Number.isFinite(numericApiPrice) && numericApiPrice > 0 ? numericApiPrice : numericAgentPrice)
            : (profile?.is_sub_agent && Number.isFinite(numericSubAgentPrice) && numericSubAgentPrice > 0)
              ? numericSubAgentPrice
              : numericAgentPrice;

        if (profile?.api_access_enabled) {
          const customApiPrice = getProfileAssignedPrice(
            profile?.api_custom_prices as Record<string, any> | undefined,
            row.network,
            row.package_size
          );
          if (customApiPrice && customApiPrice > 0) {
            priceToUse = customApiPrice;
          }
        }

        if (!Number.isFinite(priceToUse) || priceToUse <= 0) return;
        if (!nextBasePrices[row.network]) nextBasePrices[row.network] = {};
        const multiplier = pricingContext.multipliers[row.network] || 1;
        nextBasePrices[row.network][row.package_size] = applyPriceMultiplier(priceToUse, multiplier);
      });

      // For sub-agents, base prices come from the parent agent's assigned wholesale
      // prices (sub_agent_prices). If the parent hasn't configured those yet, fall
      // back to the parent's own published selling prices (agent_prices) so the
      // sub-agent is never shown the same floor as a standalone agent.
      if (profile?.is_sub_agent && profile.parent_agent_id) {
        const { data: parentProfile } = await supabase
          .from("profiles")
          .select("sub_agent_prices, agent_prices")
          .eq("user_id", profile.parent_agent_id)
          .maybeSingle();

        if (parentProfile) {
          const subPrices = (parentProfile.sub_agent_prices || {}) as Record<string, any>;
          const parentSellingPrices = (parentProfile.agent_prices || {}) as Record<string, any>;

          for (const network of Object.keys(nextBasePrices)) {
            for (const size of Object.keys(nextBasePrices[network])) {
              const assignedSubPrice = getProfileAssignedPrice(subPrices, network, size);
              const parentSellingPrice = getProfileAssignedPrice(parentSellingPrices, network, size);
              
              const assignedPrice = assignedSubPrice || parentSellingPrice;

              if (assignedPrice && assignedPrice > 0) {
                nextBasePrices[network][size] = applyPriceMultiplier(assignedPrice, pricingContext.multiplier);
              }
            }
          }
        }
      }

      setGloballyUnavailable(nextUnavailable);
      setPackageBasePrices(nextBasePrices);
    };

    loadBasePrices();
  }, [profile, isAdmin]);

  useEffect(() => {
    const defaults = buildDefaultPrices(packageBasePrices);
    const savedPrices = (profile?.agent_prices || {}) as Record<string, any>;

    const allNetworks = new Set([...Object.keys(basePackages), ...Object.keys(packageBasePrices)]);
    for (const network of allNetworks) {
      const pkgs = basePackages[network] || [];
      for (const pkg of pkgs) {
        const saved = savedPrices?.[network]?.[pkg.size];
        if (saved !== undefined && saved !== null && saved !== "") {
          if (!defaults[network]) defaults[network] = {};
          defaults[network][pkg.size] = String(saved);
        }
      }

      const customPrices = packageBasePrices[network] || {};
      const baseSizes = new Set(pkgs.map(p => p.size.replace(/\s+/g, "").toUpperCase()));
      for (const size of Object.keys(customPrices)) {
        const normSize = size.replace(/\s+/g, "").toUpperCase();
        if (!baseSizes.has(normSize)) {
          const saved = savedPrices?.[network]?.[size];
          if (saved !== undefined && saved !== null && saved !== "") {
            if (!defaults[network]) defaults[network] = {};
            defaults[network][size] = String(saved);
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

  const getBasePrice = (network: string, size: string) => {
    const cleanNetwork = network.replace("Korba ", "");
    return packageBasePrices[network]?.[size] ?? packageBasePrices[cleanNetwork]?.[size] ?? basePackages[cleanNetwork]?.find((p) => p.size === size)?.price ?? 0;
  };

  const getProfit = (network: string, size: string) => {
    const basePrice = getBasePrice(network, size);
    const agentPrice = parseFloat(getPrice(network, size)) || 0;
    return agentPrice - basePrice;
  };

  const handleSave = async () => {
    if (!user) return;

    for (const network of Object.keys(prices)) {
      for (const size of Object.keys(prices[network])) {
        const numericPrice = Number(prices?.[network]?.[size]);
        const basePrice = getBasePrice(network, size);
        if (!isAdmin && (!Number.isFinite(numericPrice) || numericPrice < basePrice)) {
          toast({
            title: "Price Too Low",
            description: `${network} ${size}: Your selling price (GH₵ ${Number.isFinite(numericPrice) ? numericPrice.toFixed(2) : "0.00"}) is below your base cost (GH₵ ${basePrice.toFixed(2)}). Please increase it to save.`,
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
        title: profile?.api_access_enabled
          ? "Prices saved! Your API partner selling prices are updated."
          : isSubAgent
            ? "Prices saved! Your sub-agent store prices are updated."
            : "Prices saved! Your store has been updated.",
      });
    }

    setSaving(false);
  };

  const networkPackages = useMemo(() => {
    const isKorba = activeGateway === "korba";
    const dbNetwork = isKorba ? `Korba ${selectedNetwork}` : selectedNetwork;
    const list: { size: string; price: number; validity: string }[] = [];

    list.push(...(basePackages[selectedNetwork] || []));

    const baseSizes = new Set(list.map(pkg => pkg.size.replace(/\s+/g, "").toUpperCase()));

    const customPrices = packageBasePrices[dbNetwork] || {};
    for (const size of Object.keys(customPrices)) {
      const normSize = size.replace(/\s+/g, "").toUpperCase();
      if (!baseSizes.has(normSize)) {
        list.push({
          size: size,
          price: customPrices[size],
          validity: selectedNetwork.includes("Mash Up") ? "MTN Mash Up" : "Non-expiry"
        });
      }
    }
    list.sort((a, b) => a.price - b.price);
    return list;
  }, [basePackages, selectedNetwork, packageBasePrices, activeGateway]);

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold">
          {profile?.api_access_enabled ? "API Pricing" : "Store Pricing"}
        </h1>
        <p className="text-muted-foreground">
          {profile?.api_access_enabled
            ? "Set your custom selling price for each package. These prices will be active on your account above your wholesale API cost."
            : "Set your selling price for each package. Toggle packages on/off for availability."}
        </p>
      </div>

      {profile?.api_access_enabled && (
        <div className="mb-6 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm text-cyan-400 flex items-start gap-3 shadow-[0_0_15px_rgba(6,182,212,0.05)]">
          <Terminal className="w-5 h-5 mt-0.5 text-cyan-400 flex-shrink-0" />
          <div className="flex-1">
            <h4 className="font-bold mb-1 text-cyan-300">API Partner Mode Active</h4>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Your base rates are configured using wholesale developer API pricing. Setting selling prices here adjusts your margin limits above these base rates for manual portal purchases.
            </p>
          </div>
        </div>
      )}

      {isSubAgent && !profile?.api_access_enabled && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Your parent agent sets your base prices. You can add your own profit above that base.
        </div>
      )}

      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-none whitespace-nowrap -mx-4 px-4 sm:mx-0 sm:px-0">
        {networks.filter(n => !(activeGateway === "korba" && n.name === "MTN Mash Up")).map((n) => (
          <button
            key={n.name}
            onClick={() => setSelectedNetwork(n.name)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0 ${
              selectedNetwork === n.name
                ? "bg-primary/10 text-primary border border-primary/20"
                : "bg-card border border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {n.name}
          </button>
        ))}
      </div>

      {/* Mobile Card Layout (visible on screens smaller than lg) */}
      <div className="lg:hidden space-y-4 mb-6">
        {networkPackages.map((pkg) => {
          const currentNetworkKey = activeGateway === "korba" ? `Korba ${selectedNetwork}` : selectedNetwork;
          const basePrice = getBasePrice(currentNetworkKey, pkg.size);
          const profit = getProfit(currentNetworkKey, pkg.size);
          const disabled = isDisabled(currentNetworkKey, pkg.size);
          const isGloballyOffline = globallyUnavailable[currentNetworkKey]?.includes(pkg.size) || false;

          return (
            <div
              key={pkg.size}
              className={`p-4 bg-card border border-border rounded-xl shadow-sm transition-all duration-200 ${
                (disabled || isGloballyOffline) ? "opacity-60 bg-muted/20" : "hover:border-primary/20"
              }`}
            >
              {/* Card Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base text-foreground">{pkg.size}</span>
                  <span className="text-xs px-2 py-0.5 rounded-md bg-secondary text-muted-foreground font-medium">
                    {pkg.validity}
                  </span>
                  {isGloballyOffline && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20 font-bold uppercase tracking-wider animate-pulse">
                      Offline
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Available</span>
                  <Switch
                    checked={!disabled && !isGloballyOffline}
                    onCheckedChange={() => toggleDisabled(currentNetworkKey, pkg.size)}
                    disabled={isGloballyOffline}
                    className="scale-90"
                  />
                </div>
              </div>

              {/* Card Body - Grid */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">
                    {profile?.api_access_enabled ? "Your API Cost" : "Base Price"}
                  </span>
                  <span className="font-semibold text-foreground">
                    GHS {basePrice.toFixed(2)}
                  </span>
                </div>
                
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Profit Margin</span>
                  <span className={`font-bold ${profit > 0 ? "text-primary" : profit < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {profit >= 0 ? "+" : ""}GHS {profit.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Input row */}
              <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-foreground">Your Selling Price</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground text-xs font-semibold">GHS</span>
                  <Input
                    value={getPrice(currentNetworkKey, pkg.size)}
                    onChange={(e) => setPrice(currentNetworkKey, pkg.size, e.target.value)}
                    className="w-28 h-9 text-center bg-secondary font-bold text-sm border-border focus-visible:ring-primary/20"
                    type="number"
                    step="0.50"
                    min={isAdmin ? undefined : basePrice}
                    disabled={isGloballyOffline}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop Table View (hidden on mobile and tablet) */}
      <div className="hidden lg:block bg-card border border-border rounded-xl overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Package</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">
                {profile?.api_access_enabled ? "Your API Cost" : "Base Price"}
              </th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Your Price</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Profit</th>
              <th className="text-center py-3 px-4 font-medium text-muted-foreground">Available</th>
            </tr>
          </thead>
          <tbody>
            {networkPackages.map((pkg) => {
              const currentNetworkKey = activeGateway === "korba" ? `Korba ${selectedNetwork}` : selectedNetwork;
              const basePrice = getBasePrice(currentNetworkKey, pkg.size);
              const profit = getProfit(currentNetworkKey, pkg.size);
              const disabled = isDisabled(currentNetworkKey, pkg.size);
              const isGloballyOffline = globallyUnavailable[currentNetworkKey]?.includes(pkg.size) || false;
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
                        value={getPrice(currentNetworkKey, pkg.size)}
                        onChange={(e) => setPrice(currentNetworkKey, pkg.size, e.target.value)}
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
                      onCheckedChange={() => toggleDisabled(currentNetworkKey, pkg.size)}
                      disabled={isGloballyOffline}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save All Prices"}
      </Button>
    </div>
  );
};

export default DashboardPricing;
