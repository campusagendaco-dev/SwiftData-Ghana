import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { basePackages, networks } from "@/lib/data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, DatabaseZap } from "lucide-react";
import { fetchApiPricingContext } from "@/lib/api-source-pricing";
import { logAudit } from "@/utils/auditLogger";
import { useAuth } from "@/hooks/useAuth";

interface PackageSetting {
  network: string;
  package_size: string;
  cost_price: number | null;
  agent_price: number | null;
  public_price: number | null;
  api_price: number | null;
  is_unavailable: boolean;
}

const AdminPackages = () => {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [settings, setSettings] = useState<Record<string, PackageSetting>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [userDiscountPercent, setUserDiscountPercent] = useState("");

  useEffect(() => {
    const fetch = async () => {
      await fetchApiPricingContext();

      const { data } = await supabase
        .from("global_package_settings")
        .select("network, package_size, cost_price, agent_price, public_price, api_price, is_unavailable");

      const map: Record<string, PackageSetting> = {};
      (data || []).forEach((r: any) => {
        map[`${r.network}-${r.package_size}`] = r;
      });
      setSettings(map);

      setLoading(false);
    };
    fetch();
  }, []);

  const getSetting = (network: string, size: string): PackageSetting => {
    const key = `${network}-${size}`;
    return settings[key] || { network, package_size: size, cost_price: null, agent_price: null, public_price: null, api_price: null, is_unavailable: false };
  };

  const updateSetting = (network: string, size: string, field: keyof PackageSetting, value: any) => {
    const key = `${network}-${size}`;
    const current = getSetting(network, size);
    setSettings((prev) => ({ ...prev, [key]: { ...current, [field]: value } }));
  };

  const seedDefaultPrices = async () => {
    setSeeding(true);
    const upserts: PackageSetting[] = [];
    for (const n of networks) {
      for (const pkg of basePackages[n.name] || []) {
        upserts.push({
          network: n.name,
          package_size: pkg.size,
          cost_price: pkg.price,
          agent_price: pkg.price,
          public_price: parseFloat((pkg.price * 1.12).toFixed(2)),
          api_price: pkg.price,
          is_unavailable: false,
        });
      }
    }
    const { error } = await supabase
      .from("global_package_settings")
      .upsert(upserts.map((u) => ({ ...u, updated_at: new Date().toISOString() })), { onConflict: "network,package_size" });

    if (error) {
      toast({ title: "Seed failed", description: error.message, variant: "destructive" });
    } else {
      // Rebuild local state
      const next: Record<string, PackageSetting> = {};
      upserts.forEach((u) => { next[`${u.network}-${u.package_size}`] = u; });
      setSettings((prev) => ({ ...prev, ...next }));
      
      if (currentUser) {
        await logAudit(currentUser.id, "seed_default_prices", { timestamp: new Date().toISOString() });
      }
      
      toast({ title: "Default prices seeded!", description: "All packages populated with base prices. Agent price = base, Public price = base × 1.12." });
    }
    setSeeding(false);
  };

  const handleSave = async () => {
    setSaving(true);

    for (const n of networks) {
      for (const pkg of basePackages[n.name] || []) {
        const s = getSetting(n.name, pkg.size);
        if (s.public_price !== null && s.public_price < 0) {
          toast({
            title: "Invalid public price",
            description: `${n.name} ${pkg.size} public price cannot be negative.`,
            variant: "destructive",
          });
          setSaving(false);
          return;
        }
        if (s.agent_price !== null && s.agent_price < 0) {
          toast({
            title: "Invalid agent price",
            description: `${n.name} ${pkg.size} agent price cannot be negative.`,
            variant: "destructive",
          });
          setSaving(false);
          return;
        }
        if (s.api_price !== null && s.api_price < 0) {
          toast({
            title: "Invalid API price",
            description: `${n.name} ${pkg.size} API price cannot be negative.`,
            variant: "destructive",
          });
          setSaving(false);
          return;
        }
      }
    }
    // Collect all modified settings
    const upserts = Object.values(settings).map((s) => ({
      network: s.network,
      package_size: s.package_size,
      cost_price: s.cost_price,
      agent_price: s.agent_price,
      public_price: s.public_price,
      api_price: s.api_price,
      is_unavailable: s.is_unavailable,
      updated_at: new Date().toISOString(),
    }));

    if (upserts.length > 0) {
      const { error } = await supabase
        .from("global_package_settings")
        .upsert(upserts, { onConflict: "network,package_size" });

      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
    }

    if (currentUser) {
      await logAudit(currentUser.id, "update_package_settings", { count: upserts.length });
    }

    toast({ title: "Package settings saved!" });
    setSaving(false);
  };

  const applyUserDiscount = () => {
    const discount = parseFloat(userDiscountPercent);
    if (isNaN(discount) || discount <= 0 || discount >= 100) {
      toast({
        title: "Invalid discount",
        description: "Enter a percentage between 0 and 100.",
        variant: "destructive",
      });
      return;
    }

    const next = { ...settings };
    networks.forEach((n) => {
      basePackages[n.name]?.forEach((pkg) => {
        const key = `${n.name}-${pkg.size}`;
        const current = next[key] || {
          network: n.name,
          package_size: pkg.size,
          agent_price: null,
          public_price: null,
          is_unavailable: false,
        };
        const reducedUserPrice = parseFloat((pkg.price * (1 - discount / 100)).toFixed(2));
        next[key] = { ...current, public_price: reducedUserPrice };
      });
    });

    setSettings(next);
    toast({
      title: "User prices updated",
      description: `Reduced all user prices by ${discount}% (click Save All Changes to publish).`,
    });
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">Package Management</h1>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={seedDefaultPrices} disabled={seeding || saving} className="gap-2">
            {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <DatabaseZap className="w-4 h-4" />}
            Seed Default Prices
          </Button>
          <Button onClick={handleSave} disabled={saving || seeding} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save All Changes
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Override prices for agents and users (public site). Use <strong>Seed Default Prices</strong> to auto-populate all packages from the base price list, then adjust as needed. Toggle unavailable to hide packages site-wide.
      </p>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border border-border rounded-lg bg-card">
        <div className="flex-1">
          <p className="font-medium">Bulk reduce user prices</p>
          <p className="text-xs text-muted-foreground">
            Apply one discount to all user/public package prices, then save.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min="0.01"
            max="99.99"
            step="0.01"
            value={userDiscountPercent}
            onChange={(e) => setUserDiscountPercent(e.target.value)}
            placeholder="e.g. 5"
            className="w-28 bg-secondary"
          />
          <span className="text-sm text-muted-foreground">%</span>
          <Button type="button" variant="outline" onClick={applyUserDiscount}>
            Apply
          </Button>
        </div>
      </div>

      <Tabs defaultValue="MTN">
        <TabsList>
          {networks.map((n) => (
            <TabsTrigger key={n.name} value={n.name}>{n.name}</TabsTrigger>
          ))}
        </TabsList>

        {networks.map((n) => (
          <TabsContent key={n.name} value={n.name}>
            <Card>
              <CardHeader>
                <CardTitle>{n.name} Packages</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* Desktop Header */}
                  <div className="hidden md:grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-2">
                    <div className="col-span-2">Package</div>
                    <div className="col-span-2">Cost (₵)</div>
                    <div className="col-span-2">Agent (₵)</div>
                    <div className="col-span-2">Public (₵)</div>
                    <div className="col-span-2">API (₵)</div>
                    <div className="col-span-1 text-center">Active</div>
                  </div>

                  {basePackages[n.name]?.map((pkg) => {
                    const s = getSetting(n.name, pkg.size);
                    return (
                      <div key={pkg.size} className={`flex flex-col md:grid md:grid-cols-12 gap-3 items-start md:items-center p-3 md:p-2 rounded-xl border ${s.is_unavailable ? "bg-red-500/[0.02] border-red-500/10 opacity-60" : "bg-white/[0.01] border-white/5"}`}>
                        {/* Package Info */}
                        <div className="flex items-center justify-between w-full md:col-span-2">
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-white">{pkg.size}</span>
                            <span className="text-[10px] text-white/30 uppercase tracking-wider">Default: ₵{pkg.price.toFixed(0)}</span>
                          </div>
                          <div className="md:hidden flex items-center gap-2">
                            <span className="text-[10px] text-white/30">Active</span>
                            <Switch
                              checked={!s.is_unavailable}
                              onCheckedChange={(checked) => updateSetting(n.name, pkg.size, "is_unavailable", !checked)}
                              className="scale-75 data-[state=checked]:bg-amber-400"
                            />
                          </div>
                        </div>

                        {/* Cost Price */}
                        <div className="w-full md:col-span-2 space-y-1">
                          <label className="md:hidden text-[10px] text-white/30 uppercase font-bold tracking-widest">Cost Price (₵)</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={pkg.price.toFixed(2)}
                              value={s.cost_price ?? ""}
                              onChange={(e) => updateSetting(n.name, pkg.size, "cost_price", e.target.value ? parseFloat(e.target.value) : null)}
                              className="h-9 md:h-8 text-sm bg-white/5 border-white/10 rounded-lg md:rounded-md focus:border-red-400/30"
                            />
                          </div>
                        </div>

                        {/* Agent Price */}
                        <div className="w-full md:col-span-2 space-y-1">
                          <label className="md:hidden text-[10px] text-white/30 uppercase font-bold tracking-widest">Agent Price (₵)</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={(s.cost_price || pkg.price).toFixed(2)}
                              value={s.agent_price ?? ""}
                              onChange={(e) => updateSetting(n.name, pkg.size, "agent_price", e.target.value ? parseFloat(e.target.value) : null)}
                              className="h-9 md:h-8 text-sm bg-white/5 border-white/10 rounded-lg md:rounded-md focus:border-amber-400/30"
                            />
                          </div>
                        </div>

                        {/* User Price */}
                        <div className="w-full md:col-span-2 space-y-1">
                          <label className="md:hidden text-[10px] text-white/30 uppercase font-bold tracking-widest">User Price (₵)</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={((s.cost_price || pkg.price) * 1.12).toFixed(2)}
                              value={s.public_price ?? ""}
                              onChange={(e) => updateSetting(n.name, pkg.size, "public_price", e.target.value ? parseFloat(e.target.value) : null)}
                              className="h-9 md:h-8 text-sm bg-white/5 border-white/10 rounded-lg md:rounded-md focus:border-blue-400/30"
                            />
                          </div>
                        </div>

                        {/* API Price */}
                        <div className="w-full md:col-span-2 space-y-1">
                          <label className="md:hidden text-[10px] text-white/30 uppercase font-bold tracking-widest">API Price (₵)</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={(s.cost_price || pkg.price).toFixed(2)}
                              value={s.api_price ?? ""}
                              onChange={(e) => updateSetting(n.name, pkg.size, "api_price", e.target.value ? parseFloat(e.target.value) : null)}
                              className="h-9 md:h-8 text-sm bg-amber-400/5 border-amber-400/20 text-amber-500 rounded-lg md:rounded-md focus:border-amber-400/40"
                            />
                          </div>
                        </div>

                        {/* Switch (Desktop) */}
                        <div className="hidden md:flex col-span-2 justify-center items-center">
                          <Switch
                            checked={!s.is_unavailable}
                            onCheckedChange={(checked) => updateSetting(n.name, pkg.size, "is_unavailable", !checked)}
                            className="scale-75 data-[state=checked]:bg-amber-400"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default AdminPackages;
