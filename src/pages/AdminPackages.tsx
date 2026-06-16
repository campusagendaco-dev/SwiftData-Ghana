import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { basePackages, networks } from "@/lib/data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, DatabaseZap, Plus, FileDown, Edit, Trash2 } from "lucide-react";
import { fetchApiPricingContext } from "@/lib/api-source-pricing";
import { logAudit } from "@/utils/auditLogger";
import { useAuth } from "@/hooks/useAuth";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

async function getValidSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session;
  const { data: { session: refreshed } } = await supabase.auth.refreshSession();
  return refreshed;
}

interface PackageSetting {
  network: string;
  package_size: string;
  cost_price: number | null;
  agent_price: number | null;
  public_price: number | null;
  api_price: number | null;
  sub_agent_price: number | null;
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

  // States for adding custom package
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newNet, setNewNet] = useState("MTN");
  const [newSize, setNewSize] = useState("");
  const [voiceMins, setVoiceMins] = useState("");
  const [newCost, setNewCost] = useState("");
  const [newAgent, setNewAgent] = useState("");
  const [newSubAgent, setNewSubAgent] = useState("");
  const [newPublic, setNewPublic] = useState("");
  const [newApi, setNewApi] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [externalId, setExternalId] = useState("");

  // States for editing custom package
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingPackage, setEditingPackage] = useState<PackageSetting | null>(null);
  const [editSize, setEditSize] = useState("");
  const [editVoiceMins, setEditVoiceMins] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editAgent, setEditAgent] = useState("");
  const [editSubAgent, setEditSubAgent] = useState("");
  const [editPublic, setEditPublic] = useState("");
  const [editApi, setEditApi] = useState("");
  const [editProvider, setEditProvider] = useState("");
  const [editExternalId, setEditExternalId] = useState("");
  const [editIsUnavailable, setEditIsUnavailable] = useState(false);
  const [loadingMapping, setLoadingMapping] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      await fetchApiPricingContext();

      const [settingsRes, providersRes] = await Promise.all([
        supabase
          .from("global_package_settings")
          .select("network, package_size, cost_price, agent_price, sub_agent_price, public_price, api_price, is_unavailable"),
        supabase
          .from("providers")
          .select("id, name")
      ]);

      const map: Record<string, PackageSetting> = {};
      (settingsRes.data || []).forEach((r: any) => {
        map[`${r.network}-${r.package_size}`] = r;
      });
      setSettings(map);
      setProviders(providersRes.data || []);

      setLoading(false);
    };
    fetch();
  }, []);

  const handleAddPackage = async () => {
    if (!newSize) {
      toast({ title: "Validation Error", description: "Package size/name is required.", variant: "destructive" });
      return;
    }

    const finalSize = voiceMins ? `${newSize} + ${voiceMins} Mins` : newSize;
    
    const key = `${newNet}-${finalSize}`;
    if (settings[key]) {
      toast({ title: "Validation Error", description: "This package size already exists for this network.", variant: "destructive" });
      return;
    }

    const costVal = newCost ? parseFloat(newCost) : null;
    const agentVal = newAgent ? parseFloat(newAgent) : null;
    const subAgentVal = newSubAgent ? parseFloat(newSubAgent) : null;
    const publicVal = newPublic ? parseFloat(newPublic) : null;
    const apiVal = newApi ? parseFloat(newApi) : null;

    const getCapacityGb = (size: string) => {
      const match = size.match(/^([0-9.]+)/);
      return match ? parseFloat(match[1]) : 0;
    };

    // 1. If provider and external_id are specified, save mapping in database first
    if (selectedProvider && externalId) {
      const { error: providerError } = await supabase
        .from("provider_packages")
        .upsert({
          provider_id: selectedProvider,
          network: newNet === "MTN Mash Up" ? "MTN" : newNet, // Map to provider network key
          package_name: finalSize,
          cost_price: costVal || 0,
          external_id: externalId,
          capacity_gb: getCapacityGb(newSize),
          is_active: true
        }, { onConflict: "provider_id,network,package_name" });

      if (providerError) {
        toast({ title: "Provider Mapping Failed", description: providerError.message, variant: "destructive" });
        return;
      }
    }

    // 2. Add to global_package_settings
    const newPkg: PackageSetting = {
      network: newNet,
      package_size: finalSize,
      cost_price: costVal,
      agent_price: agentVal,
      sub_agent_price: subAgentVal,
      public_price: publicVal,
      api_price: apiVal,
      is_unavailable: false
    };

    const session = await getValidSession();
    if (!session) {
      toast({ title: "Session expired", description: "Please sign in again.", variant: "destructive" });
      return;
    }

    const { data: resData, error: resError } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "save_package_settings", packages: [newPkg] },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (resError || resData?.error) {
      toast({ title: "Creation Failed", description: resData?.error || resError?.message, variant: "destructive" });
      return;
    }

    // Update state to include new package
    setSettings(prev => ({ ...prev, [key]: newPkg }));
    
    // Clear form state
    setNewSize("");
    setNewCost("");
    setNewAgent("");
    setNewSubAgent("");
    setNewPublic("");
    setNewApi("");
    setSelectedProvider("");
    setExternalId("");
    setVoiceMins("");
    setShowAddDialog(false);

    toast({ title: "Success", description: "Custom package created successfully!" });
  };

  const handleOpenEditDialog = async (pkg: PackageSetting) => {
    setEditingPackage(pkg);
    
    // Parse name and voice minutes if they are structured like "1.2GB + 50 Mins"
    let sizePart = pkg.package_size;
    let voicePart = "";
    if (pkg.package_size.includes(" + ")) {
      const parts = pkg.package_size.split(" + ");
      sizePart = parts[0];
      const match = parts[1].match(/^(\d+)/);
      voicePart = match ? match[1] : "";
    }
    setEditSize(sizePart);
    setEditVoiceMins(voicePart);
    setEditCost(pkg.cost_price?.toString() || "");
    setEditAgent(pkg.agent_price?.toString() || "");
    setEditSubAgent(pkg.sub_agent_price?.toString() || "");
    setEditPublic(pkg.public_price?.toString() || "");
    setEditApi(pkg.api_price?.toString() || "");
    setEditIsUnavailable(pkg.is_unavailable);
    
    setEditProvider("");
    setEditExternalId("");
    setLoadingMapping(true);
    setShowEditDialog(true);
    
    try {
      const { data, error } = await supabase
        .from("provider_packages")
        .select("provider_id, external_id")
        .eq("package_name", pkg.package_size)
        .in("network", [pkg.network, pkg.network === "MTN Mash Up" ? "MTN" : pkg.network])
        .maybeSingle();
      
      if (data) {
        setEditProvider(data.provider_id || "");
        setEditExternalId(data.external_id || "");
      }
    } catch (err) {
      console.error("Error fetching provider mapping:", err);
    } finally {
      setLoadingMapping(false);
    }
  };

  const handleSaveEditPackage = async () => {
    if (!editingPackage) return;
    if (!editSize) {
      toast({ title: "Validation Error", description: "Package size/name is required.", variant: "destructive" });
      return;
    }

    const finalSize = editVoiceMins ? `${editSize} + ${editVoiceMins} Mins` : editSize;
    const oldSize = editingPackage.package_size;
    const network = editingPackage.network;

    // Validate if renaming to an existing package name (different from current)
    if (finalSize !== oldSize) {
      const key = `${network}-${finalSize}`;
      if (settings[key]) {
        toast({ title: "Validation Error", description: "A package with this name already exists for this network.", variant: "destructive" });
        return;
      }
    }

    const costVal = editCost ? parseFloat(editCost) : null;
    const agentVal = editAgent ? parseFloat(editAgent) : null;
    const subAgentVal = editSubAgent ? parseFloat(editSubAgent) : null;
    const publicVal = editPublic ? parseFloat(editPublic) : null;
    const apiVal = editApi ? parseFloat(editApi) : null;

    setSaving(true);
    try {
      // 1. Update global_package_settings. If package_size changed, update the primary key.
      const { error: globalErr } = await supabase
        .from("global_package_settings")
        .update({
          package_size: finalSize,
          cost_price: costVal,
          agent_price: agentVal,
          sub_agent_price: subAgentVal,
          public_price: publicVal,
          api_price: apiVal,
          is_unavailable: editIsUnavailable,
          updated_at: new Date().toISOString()
        })
        .eq("network", network)
        .eq("package_size", oldSize);

      if (globalErr) {
        toast({ title: "Update Failed", description: globalErr.message, variant: "destructive" });
        setSaving(false);
        return;
      }

      // 2. Manage Provider Mapping in provider_packages
      // Delete old mapping if there was one
      const mappedNet = network === "MTN Mash Up" ? "MTN" : network;
      await supabase
        .from("provider_packages")
        .delete()
        .eq("package_name", oldSize)
        .eq("network", mappedNet);

      // Upsert new mapping if selected details are specified
      if (editProvider && editExternalId) {
        const getCapacityGb = (size: string) => {
          const match = size.match(/^([0-9.]+)/);
          return match ? parseFloat(match[1]) : 0;
        };

        const { error: providerErr } = await supabase
          .from("provider_packages")
          .upsert({
            provider_id: editProvider,
            network: mappedNet,
            package_name: finalSize,
            cost_price: costVal || 0,
            external_id: editExternalId,
            capacity_gb: getCapacityGb(editSize),
            is_active: true
          }, { onConflict: "provider_id,network,package_name" });

        if (providerErr) {
          toast({ title: "Provider Mapping Failed", description: providerErr.message, variant: "destructive" });
        }
      }

      // 3. Update local state
      setSettings(prev => {
        const next = { ...prev };
        delete next[`${network}-${oldSize}`];
        next[`${network}-${finalSize}`] = {
          network,
          package_size: finalSize,
          cost_price: costVal,
          agent_price: agentVal,
          sub_agent_price: subAgentVal,
          public_price: publicVal,
          api_price: apiVal,
          is_unavailable: editIsUnavailable
        };
        return next;
      });

      setShowEditDialog(false);
      setEditingPackage(null);
      toast({ title: "Success", description: "Package updated successfully!" });
    } catch (e: any) {
      toast({ title: "Update Failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePackage = async (network: string, size: string) => {
    if (!window.confirm(`Are you sure you want to delete the package "${size}" from ${network}?`)) {
      return;
    }

    try {
      // 1. Delete from provider_packages
      const mappedNet = network === "MTN Mash Up" ? "MTN" : network;
      const { error: provErr } = await supabase
        .from("provider_packages")
        .delete()
        .eq("package_name", size)
        .eq("network", mappedNet);

      if (provErr) {
        console.error("Error deleting provider mapping:", provErr);
      }

      // 2. Delete from global_package_settings
      const { error: globalErr } = await supabase
        .from("global_package_settings")
        .delete()
        .eq("network", network)
        .eq("package_size", size);

      if (globalErr) {
        toast({ title: "Delete Failed", description: globalErr.message, variant: "destructive" });
        return;
      }

      // 3. Update state
      setSettings(prev => {
        const next = { ...prev };
        delete next[`${network}-${size}`];
        return next;
      });

      toast({ title: "Success", description: "Package deleted successfully!" });
    } catch (e: any) {
      toast({ title: "Delete Failed", description: e.message, variant: "destructive" });
    }
  };

  const exportMashUpPackages = async () => {
    try {
      const { data: mappings, error: mapError } = await supabase
        .from("provider_packages")
        .select("package_name, external_id, provider_id, network");

      if (mapError) {
        toast({ title: "Export Failed", description: mapError.message, variant: "destructive" });
        return;
      }

      const mashUpKeys = Object.keys(settings).filter(k => k.startsWith("MTN Mash Up-"));
      
      if (mashUpKeys.length === 0) {
        toast({ title: "No Packages", description: "No MTN Mash Up packages found to export.", variant: "destructive" });
        return;
      }

      const headers = [
        "Network",
        "Package Size",
        "Voice Minutes",
        "Cost Price",
        "Agent Price",
        "Sub-Agent Price",
        "Public Price",
        "API Price",
        "Provider",
        "Provider Package ID"
      ];

      const rows = mashUpKeys.map(key => {
        const pkg = settings[key];
        const size = pkg.package_size;
        
        const voiceMatch = size.match(/\+\s*(\d+)\s*(?:Mins|Min)/i);
        const voiceMinsValue = voiceMatch ? voiceMatch[1] : "";
        const cleanSize = size.split("+")[0].trim();

        const mapping = (mappings || []).find(m => 
          m.package_name === size && 
          (m.network === "MTN Mash Up" || m.network === "MTN")
        );

        const providerName = mapping?.provider_id 
          ? (providers.find(p => p.id === mapping.provider_id)?.name || mapping.provider_id)
          : "";

        return [
          pkg.network,
          cleanSize,
          voiceMinsValue ? `${voiceMinsValue} Mins` : "-",
          pkg.cost_price?.toFixed(2) || "0.00",
          pkg.agent_price?.toFixed(2) || "0.00",
          pkg.sub_agent_price?.toFixed(2) || "0.00",
          pkg.public_price?.toFixed(2) || "0.00",
          pkg.api_price?.toFixed(2) || "0.00",
          providerName,
          mapping?.external_id || ""
        ];
      });

      const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `mtn_mash_up_packages_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({ title: "Success", description: "MTN Mash Up packages exported successfully!" });
    } catch (e: any) {
      toast({ title: "Export Error", description: e.message, variant: "destructive" });
    }
  };

  const getSetting = (network: string, size: string): PackageSetting => {
    const key = `${network}-${size}`;
    return settings[key] || { network, package_size: size, cost_price: null, agent_price: null, sub_agent_price: null, public_price: null, api_price: null, is_unavailable: false };
  };

  const updateSetting = (network: string, size: string, field: keyof PackageSetting, value: any) => {
    const key = `${network}-${size}`;
    const current = getSetting(network, size);
    setSettings((prev) => ({ ...prev, [key]: { ...current, [field]: value } }));
  };

  const seedDefaultPrices = async () => {
    setSeeding(true);
    const session = await getValidSession();
    if (!session) {
      toast({ title: "Session expired", description: "Please sign in again.", variant: "destructive" });
      setSeeding(false);
      return;
    }

    const upserts: PackageSetting[] = [];
    for (const n of networks) {
      for (const pkg of basePackages[n.name] || []) {
        upserts.push({
          network: n.name,
          package_size: pkg.size,
          cost_price: pkg.price,
          agent_price: pkg.price,
          sub_agent_price: pkg.price,
          public_price: parseFloat((pkg.price * 1.12).toFixed(2)),
          api_price: pkg.price,
          is_unavailable: false,
        });
      }
    }

    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "save_package_settings", packages: upserts },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (error || data?.error) {
      toast({ title: "Seed failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
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

    for (const key of Object.keys(settings)) {
      const s = settings[key];
      if (s.public_price !== null && s.public_price < 0) {
        toast({
          title: "Invalid public price",
          description: `${s.network} ${s.package_size} public price cannot be negative.`,
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
      if (s.agent_price !== null && s.agent_price < 0) {
        toast({
          title: "Invalid agent price",
          description: `${s.network} ${s.package_size} agent price cannot be negative.`,
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
      if (s.api_price !== null && s.api_price < 0) {
        toast({
          title: "Invalid API price",
          description: `${s.network} ${s.package_size} API price cannot be negative.`,
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
      if (s.sub_agent_price !== null && s.sub_agent_price < 0) {
        toast({
          title: "Invalid sub-agent price",
          description: `${s.network} ${s.package_size} sub-agent price cannot be negative.`,
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
    }
    const session = await getValidSession();
    if (!session) {
      toast({ title: "Session expired", description: "Please sign in again.", variant: "destructive" });
      setSaving(false);
      return;
    }

    const upserts = Object.values(settings).map((s) => ({
      network: s.network,
      package_size: s.package_size,
      cost_price: s.cost_price,
      agent_price: s.agent_price,
      sub_agent_price: s.sub_agent_price,
      public_price: s.public_price,
      api_price: s.api_price,
      is_unavailable: s.is_unavailable,
    }));

    if (upserts.length > 0) {
      const { data, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "save_package_settings", packages: upserts },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error || data?.error) {
        toast({ title: "Save failed", description: data?.error || error?.message, variant: "destructive" });
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
          cost_price: null,
          agent_price: null,
          sub_agent_price: null,
          public_price: null,
          api_price: null,
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
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button variant="secondary" className="gap-2 bg-purple-500/10 border border-purple-500/20 text-purple-600 hover:bg-purple-500/20 dark:text-purple-400">
                <Plus className="w-4 h-4" />
                Add Custom Package
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] overflow-y-auto max-h-[90vh]">
              <DialogHeader>
                <DialogTitle>Add Custom Package</DialogTitle>
                <DialogDescription>
                  Create a custom package and map it to a provider.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="network" className="text-right text-xs">Network</Label>
                  <select
                    id="network"
                    value={newNet}
                    onChange={(e) => setNewNet(e.target.value)}
                    className="col-span-3 h-8 bg-background border border-border text-foreground rounded-md px-2 text-xs focus:outline-none"
                  >
                    {networks.map(n => <option key={n.name} value={n.name}>{n.name}</option>)}
                    <option value="AFA">AFA Registration</option>
                  </select>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="size" className="text-right text-xs">Size/Name</Label>
                  <Input
                    id="size"
                    placeholder="e.g. 1.2GB"
                    value={newSize}
                    onChange={(e) => setNewSize(e.target.value)}
                    className="col-span-3 h-8 bg-background border-border text-xs"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="voiceMins" className="text-right text-xs">Voice Mins</Label>
                  <Input
                    id="voiceMins"
                    type="number"
                    placeholder="e.g. 50 (optional)"
                    value={voiceMins}
                    onChange={(e) => setVoiceMins(e.target.value)}
                    className="col-span-3 h-8 bg-background border-border text-xs"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="cost" className="text-right text-xs">Cost (₵)</Label>
                  <Input
                    id="cost"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newCost}
                    onChange={(e) => setNewCost(e.target.value)}
                    className="col-span-3 h-8 bg-background border-border text-xs"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="agent" className="text-right text-xs">Agent (₵)</Label>
                  <Input
                    id="agent"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newAgent}
                    onChange={(e) => setNewAgent(e.target.value)}
                    className="col-span-3 h-8 bg-background border-border text-xs"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="subagent" className="text-right text-xs">Sub-Agent (₵)</Label>
                  <Input
                    id="subagent"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newSubAgent}
                    onChange={(e) => setNewSubAgent(e.target.value)}
                    className="col-span-3 h-8 bg-background border-border text-xs"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="public" className="text-right text-xs">Public (₵)</Label>
                  <Input
                    id="public"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newPublic}
                    onChange={(e) => setNewPublic(e.target.value)}
                    className="col-span-3 h-8 bg-background border-border text-xs"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="api" className="text-right text-xs">API Price (₵)</Label>
                  <Input
                    id="api"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newApi}
                    onChange={(e) => setNewApi(e.target.value)}
                    className="col-span-3 h-8 bg-background border-border text-xs"
                  />
                </div>
                <div className="border-t border-border my-2 pt-2 col-span-4 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Provider Mapping (Optional)
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="provider" className="text-right text-xs">Provider</Label>
                  <select
                    id="provider"
                    value={selectedProvider}
                    onChange={(e) => setSelectedProvider(e.target.value)}
                    className="col-span-3 h-8 bg-background border border-border text-foreground rounded-md px-2 text-xs focus:outline-none"
                  >
                    <option value="">Select Provider...</option>
                    {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="extId" className="text-right text-xs">External ID</Label>
                  <Input
                    id="extId"
                    placeholder="e.g. mashup_1200"
                    value={externalId}
                    onChange={(e) => setExternalId(e.target.value)}
                    className="col-span-3 h-8 bg-background border-border text-xs"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddDialog(false)} size="sm">Cancel</Button>
                <Button onClick={handleAddPackage} size="sm">Add Package</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
            <DialogContent className="sm:max-w-[425px] overflow-y-auto max-h-[90vh]">
              <DialogHeader>
                <DialogTitle>Edit Custom Package</DialogTitle>
                <DialogDescription>
                  Modify details and provider mapping for this package.
                </DialogDescription>
              </DialogHeader>
              {loadingMapping ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right text-xs">Network</Label>
                    <div className="col-span-3 text-xs font-semibold bg-muted px-2 py-1.5 rounded-md border text-muted-foreground">
                      {editingPackage?.network}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="editSize" className="text-right text-xs">Size/Name</Label>
                    <Input
                      id="editSize"
                      placeholder="e.g. 1.2GB"
                      value={editSize}
                      onChange={(e) => setEditSize(e.target.value)}
                      className="col-span-3 h-8 bg-background border-border text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="editVoiceMins" className="text-right text-xs">Voice Mins</Label>
                    <Input
                      id="editVoiceMins"
                      type="number"
                      placeholder="e.g. 50 (optional)"
                      value={editVoiceMins}
                      onChange={(e) => setEditVoiceMins(e.target.value)}
                      className="col-span-3 h-8 bg-background border-border text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="editCost" className="text-right text-xs">Cost (₵)</Label>
                    <Input
                      id="editCost"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={editCost}
                      onChange={(e) => setEditCost(e.target.value)}
                      className="col-span-3 h-8 bg-background border-border text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="editAgent" className="text-right text-xs">Agent (₵)</Label>
                    <Input
                      id="editAgent"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={editAgent}
                      onChange={(e) => setEditAgent(e.target.value)}
                      className="col-span-3 h-8 bg-background border-border text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="editSubagent" className="text-right text-xs">Sub-Agent (₵)</Label>
                    <Input
                      id="editSubagent"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={editSubAgent}
                      onChange={(e) => setEditSubAgent(e.target.value)}
                      className="col-span-3 h-8 bg-background border-border text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="editPublic" className="text-right text-xs">Public (₵)</Label>
                    <Input
                      id="editPublic"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={editPublic}
                      onChange={(e) => setEditPublic(e.target.value)}
                      className="col-span-3 h-8 bg-background border-border text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="editApi" className="text-right text-xs">API Price (₵)</Label>
                    <Input
                      id="editApi"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={editApi}
                      onChange={(e) => setEditApi(e.target.value)}
                      className="col-span-3 h-8 bg-background border-border text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="editIsUnavailable" className="text-right text-xs">Unavailable</Label>
                    <div className="col-span-3 flex items-center h-8">
                      <Switch
                        id="editIsUnavailable"
                        checked={editIsUnavailable}
                        onCheckedChange={setEditIsUnavailable}
                        className="scale-75 data-[state=checked]:bg-red-500"
                      />
                    </div>
                  </div>
                  <div className="border-t border-border my-2 pt-2 col-span-4 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Provider Mapping (Optional)
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="editProvider" className="text-right text-xs">Provider</Label>
                    <select
                      id="editProvider"
                      value={editProvider}
                      onChange={(e) => setEditProvider(e.target.value)}
                      className="col-span-3 h-8 bg-background border border-border text-foreground rounded-md px-2 text-xs focus:outline-none"
                    >
                      <option value="">Select Provider...</option>
                      {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="editExtId" className="text-right text-xs">External ID</Label>
                    <Input
                      id="editExtId"
                      placeholder="e.g. mashup_1200"
                      value={editExternalId}
                      onChange={(e) => setEditExternalId(e.target.value)}
                      className="col-span-3 h-8 bg-background border-border text-xs"
                    />
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowEditDialog(false)} size="sm">Cancel</Button>
                <Button onClick={handleSaveEditPackage} size="sm" disabled={saving}>
                  {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={exportMashUpPackages} className="gap-2 border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20">
            <FileDown className="w-4 h-4" />
            Export Mash Up
          </Button>
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
          <TabsTrigger value="AFA">AFA Registration</TabsTrigger>
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
                    <div className="col-span-1">Cost (₵)</div>
                    <div className="col-span-2">Agent (₵)</div>
                    <div className="col-span-2">Sub-Agent (₵)</div>
                    <div className="col-span-2">Public (₵)</div>
                    <div className="col-span-1">API (₵)</div>
                    <div className="col-span-1 text-center">Active</div>
                    <div className="col-span-1 text-center">Actions</div>
                  </div>

                  {(() => {
                    const baseList = [...(basePackages[n.name] || [])];
                    const baseSizes = new Set(baseList.map(b => b.size.replace(/\s+/g, "").toUpperCase()));
                    
                    Object.keys(settings).forEach(key => {
                      const prefix = `${n.name}-`;
                      if (key.startsWith(prefix)) {
                        const size = settings[key].package_size;
                        const normSize = size.replace(/\s+/g, "").toUpperCase();
                        if (!baseSizes.has(normSize)) {
                          baseList.push({
                            size: size,
                            price: settings[key].cost_price || 0,
                            validity: n.name.includes("Mash Up") ? "MTN Mash Up" : "Non-expiry"
                          });
                        }
                      }
                    });

                    baseList.sort((a, b) => {
                      const sA = getSetting(n.name, a.size);
                      const sB = getSetting(n.name, b.size);
                      const priceA = sA.cost_price ?? a.price;
                      const priceB = sB.cost_price ?? b.price;
                      return priceA - priceB;
                    });

                    return baseList.map((pkg) => {
                      const s = getSetting(n.name, pkg.size);
                      const isCustom = !baseSizes.has(pkg.size.replace(/\s+/g, "").toUpperCase());
                      return (
                      <div key={pkg.size} className={`flex flex-col md:grid md:grid-cols-12 gap-3 items-start md:items-center p-3 md:p-2 rounded-xl border shadow-sm ${s.is_unavailable ? "bg-red-500/[0.05] border-red-500/20 opacity-60" : "bg-card border-border"}`}>
                        {/* Package Info */}
                        <div className="flex items-center justify-between w-full md:col-span-2">
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-foreground">
                              {n.name === "MTN Mash Up" && pkg.size === "4GB" ? "MTN Mash Up (4GB)" : pkg.size}
                            </span>
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Default: ₵{pkg.price.toFixed(0)}</span>
                          </div>
                          <div className="md:hidden flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">Active</span>
                            <Switch
                              checked={!s.is_unavailable}
                              onCheckedChange={(checked) => updateSetting(n.name, pkg.size, "is_unavailable", !checked)}
                              className="scale-75 data-[state=checked]:bg-amber-500"
                            />
                          </div>
                        </div>

                        {/* Cost Price */}
                        <div className="w-full md:col-span-1 space-y-1">
                          <label className="md:hidden text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Cost Price (₵)</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={pkg.price.toFixed(2)}
                              value={s.cost_price ?? ""}
                              onChange={(e) => updateSetting(n.name, pkg.size, "cost_price", e.target.value ? parseFloat(e.target.value) : null)}
                              className="h-9 md:h-8 text-sm rounded-lg md:rounded-md"
                            />
                          </div>
                        </div>

                        {/* Agent Price */}
                        <div className="w-full md:col-span-2 space-y-1">
                          <label className="md:hidden text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Agent Price (₵)</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={(s.cost_price || pkg.price).toFixed(2)}
                              value={s.agent_price ?? ""}
                              onChange={(e) => updateSetting(n.name, pkg.size, "agent_price", e.target.value ? parseFloat(e.target.value) : null)}
                              className="h-9 md:h-8 text-sm rounded-lg md:rounded-md focus:border-amber-500/30"
                            />
                          </div>
                        </div>

                        {/* Sub-Agent Price */}
                        <div className="w-full md:col-span-2 space-y-1">
                          <label className="md:hidden text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Sub-Agent Price (₵)</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={(s.agent_price || s.cost_price || pkg.price).toFixed(2)}
                              value={s.sub_agent_price ?? ""}
                              onChange={(e) => updateSetting(n.name, pkg.size, "sub_agent_price", e.target.value ? parseFloat(e.target.value) : null)}
                              className="h-9 md:h-8 text-sm bg-purple-500/5 border-purple-500/20 text-purple-600 dark:text-purple-400 rounded-lg md:rounded-md focus:border-purple-400/40"
                            />
                          </div>
                        </div>

                        {/* User Price */}
                        <div className="w-full md:col-span-2 space-y-1">
                          <label className="md:hidden text-[10px] text-muted-foreground uppercase font-bold tracking-widest">User Price (₵)</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={((s.cost_price || pkg.price) * 1.12).toFixed(2)}
                              value={s.public_price ?? ""}
                              onChange={(e) => updateSetting(n.name, pkg.size, "public_price", e.target.value ? parseFloat(e.target.value) : null)}
                              className="h-9 md:h-8 text-sm rounded-lg md:rounded-md focus:border-blue-500/30"
                            />
                          </div>
                        </div>

                        {/* API Price */}
                        <div className="w-full md:col-span-1 space-y-1">
                          <label className="md:hidden text-[10px] text-muted-foreground uppercase font-bold tracking-widest">API Price (₵)</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={(s.cost_price || pkg.price).toFixed(2)}
                              value={s.api_price ?? ""}
                              onChange={(e) => updateSetting(n.name, pkg.size, "api_price", e.target.value ? parseFloat(e.target.value) : null)}
                              className="h-9 md:h-8 text-sm bg-amber-400/5 border-amber-400/20 text-amber-600 dark:text-amber-500 rounded-lg md:rounded-md focus:border-amber-500/40"
                            />
                          </div>
                        </div>

                        {/* Switch (Desktop) */}
                        <div className="hidden md:flex col-span-1 justify-center items-center">
                          <Switch
                            checked={!s.is_unavailable}
                            onCheckedChange={(checked) => updateSetting(n.name, pkg.size, "is_unavailable", !checked)}
                            className="scale-75 data-[state=checked]:bg-amber-400"
                          />
                        </div>

                        {/* Actions */}
                        <div className="w-full md:col-span-1 flex items-center justify-end md:justify-center gap-1">
                          {isCustom ? (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => handleOpenEditDialog(s)}
                                className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-950/30"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeletePackage(n.name, pkg.size)}
                                className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/30"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">Base</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                })()}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ))}

        <TabsContent value="AFA">
          <Card>
            <CardHeader>
              <CardTitle>AFA Registration Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Manage wholesale and public pricing for AFA member registrations.
                </p>

                <div className="space-y-3">
                  {/* Desktop Header */}
                  <div className="hidden md:grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-2">
                    <div className="col-span-2">Package</div>
                    <div className="col-span-2">Cost (₵)</div>
                    <div className="col-span-2">Agent (₵)</div>
                    <div className="col-span-2">Sub-Agent (₵)</div>
                    <div className="col-span-2">Public (₵)</div>
                    <div className="col-span-2">API (₵)</div>
                    <div className="col-span-1 text-center">Active</div>
                  </div>

                  {(() => {
                    const s = getSetting("AFA", "BUNDLE");
                    return (
                      <div className={`flex flex-col md:grid md:grid-cols-12 gap-3 items-start md:items-center p-3 md:p-2 rounded-xl border shadow-sm ${s.is_unavailable ? "bg-red-500/[0.05] border-red-500/20 opacity-60" : "bg-card border-border"}`}>
                        {/* Package Info */}
                        <div className="flex items-center justify-between w-full md:col-span-2">
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-foreground">AFA Registration</span>
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Default: ₵15.00</span>
                          </div>
                          <div className="md:hidden flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">Active</span>
                            <Switch
                              checked={!s.is_unavailable}
                              onCheckedChange={(checked) => updateSetting("AFA", "BUNDLE", "is_unavailable", !checked)}
                              className="scale-75 data-[state=checked]:bg-amber-500"
                            />
                          </div>
                        </div>

                        {/* Cost Price */}
                        <div className="w-full md:col-span-2 space-y-1">
                          <label className="md:hidden text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Cost Price (₵)</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="15.00"
                              value={s.cost_price ?? ""}
                              onChange={(e) => updateSetting("AFA", "BUNDLE", "cost_price", e.target.value ? parseFloat(e.target.value) : null)}
                              className="h-9 md:h-8 text-sm rounded-lg md:rounded-md"
                            />
                          </div>
                        </div>

                        {/* Agent Price */}
                        <div className="w-full md:col-span-2 space-y-1">
                          <label className="md:hidden text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Agent Price (₵)</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="15.00"
                              value={s.agent_price ?? ""}
                              onChange={(e) => updateSetting("AFA", "BUNDLE", "agent_price", e.target.value ? parseFloat(e.target.value) : null)}
                              className="h-9 md:h-8 text-sm rounded-lg md:rounded-md focus:border-amber-500/30"
                            />
                          </div>
                        </div>

                        {/* Sub-Agent Price */}
                        <div className="w-full md:col-span-2 space-y-1">
                          <label className="md:hidden text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Sub-Agent Price (₵)</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="15.00"
                              value={s.sub_agent_price ?? ""}
                              onChange={(e) => updateSetting("AFA", "BUNDLE", "sub_agent_price", e.target.value ? parseFloat(e.target.value) : null)}
                              className="h-9 md:h-8 text-sm bg-purple-500/5 border-purple-500/20 text-purple-600 dark:text-purple-400 rounded-lg md:rounded-md focus:border-purple-400/40"
                            />
                          </div>
                        </div>

                        {/* User Price */}
                        <div className="w-full md:col-span-2 space-y-1">
                          <label className="md:hidden text-[10px] text-muted-foreground uppercase font-bold tracking-widest">User Price (₵)</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="15.00"
                              value={s.public_price ?? ""}
                              onChange={(e) => updateSetting("AFA", "BUNDLE", "public_price", e.target.value ? parseFloat(e.target.value) : null)}
                              className="h-9 md:h-8 text-sm rounded-lg md:rounded-md focus:border-blue-500/30"
                            />
                          </div>
                        </div>

                        {/* API Price */}
                        <div className="w-full md:col-span-2 space-y-1">
                          <label className="md:hidden text-[10px] text-muted-foreground uppercase font-bold tracking-widest">API Price (₵)</label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="15.00"
                              value={s.api_price ?? ""}
                              onChange={(e) => updateSetting("AFA", "BUNDLE", "api_price", e.target.value ? parseFloat(e.target.value) : null)}
                              className="h-9 md:h-8 text-sm bg-amber-400/5 border-amber-400/20 text-amber-600 dark:text-amber-500 rounded-lg md:rounded-md focus:border-amber-500/40"
                            />
                          </div>
                        </div>

                        {/* Switch (Desktop) */}
                        <div className="hidden md:flex col-span-1 justify-center items-center">
                          <Switch
                            checked={!s.is_unavailable}
                            onCheckedChange={(checked) => updateSetting("AFA", "BUNDLE", "is_unavailable", !checked)}
                            className="scale-75 data-[state=checked]:bg-amber-400"
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminPackages;
