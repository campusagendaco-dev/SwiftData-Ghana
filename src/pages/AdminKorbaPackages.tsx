import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Loader2, RefreshCw, Search, Plus, Save, Trash2, Edit2, Play, Pause,
  Database, Info, AlertTriangle, ShieldCheck, CheckCircle2, ChevronRight,
  Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface KorbaBundle {
  name: string;
  product_id: string;
  amount: string;
  validity: string;
  network: string;
  category?: string;
}

interface ImportedPackage {
  id: string;
  network: string;
  package_size: string;
  cost_price: number | null;
  agent_price: number | null;
  sub_agent_price: number | null;
  public_price: number | null;
  api_price: number | null;
  is_unavailable: boolean;
  updated_at: string;
  external_id?: string;
}

const KORBA_PROVIDER_ID = "1177b72a-a2d7-462d-9366-9dde6e83ccd7";

const parseCapacityGb = (size: string) => {
  const cleaned = size.replace(/\s+/g, "").toUpperCase();
  if (cleaned.includes("MB")) {
    const match = cleaned.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) / 1024 : 0;
  }
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
};

const AdminKorbaPackages = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchingApi, setFetchingApi] = useState(false);

  // States
  const [importedPkgs, setImportedPkgs] = useState<ImportedPackage[]>([]);
  const [fetchedBundles, setFetchedBundles] = useState<KorbaBundle[]>([]);
  const [activeTab, setActiveTab] = useState("MTN");
  const [searchQuery, setSearchQuery] = useState("");

  // Dialog states for Import / Map
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [selectedBundle, setSelectedBundle] = useState<KorbaBundle | null>(null);
  const [targetPackageSize, setTargetPackageSize] = useState("");
  const [isNewPackageSize, setIsNewPackageSize] = useState(false);
  const [newSizeName, setNewSizeName] = useState("");
  
  // Custom prices for importing
  const [costPrice, setCostPrice] = useState("");
  const [agentPrice, setAgentPrice] = useState("");
  const [subAgentPrice, setSubAgentPrice] = useState("");
  const [publicPrice, setPublicPrice] = useState("");
  const [apiPrice, setApiPrice] = useState("");

  // Dialog state for Edit
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingPkg, setEditingPkg] = useState<ImportedPackage | null>(null);

  // Dialog state for Creating a new standard package directly
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newPkgNetwork, setNewPkgNetwork] = useState("MTN");
  const [newPkgSize, setNewPkgSize] = useState("");

  // Fetch standard packages and provider mappings
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch package settings under standard networks
      const { data: pkgs, error: pkgsErr } = await supabase
        .from("global_package_settings")
        .select("*")
        .in("network", ["MTN", "Telecel", "AirtelTigo", "MTN Mash Up"]);
      if (pkgsErr) throw pkgsErr;

      // 2. Fetch provider package mappings for Korba provider
      const { data: mappings, error: mapsErr } = await supabase
        .from("provider_packages")
        .select("package_name, network, external_id")
        .eq("provider_id", KORBA_PROVIDER_ID);
      if (mapsErr) throw mapsErr;

      // Merge mappings to packages
      const merged: ImportedPackage[] = (pkgs || []).map((p: any) => {
        const match = (mappings || []).find(
          (m) => m.package_name === p.package_size && m.network === p.network
        );
        return {
          ...p,
          external_id: match?.external_id
        };
      });

      setImportedPkgs(merged);
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Load Failed",
        description: e.message || "Failed to load packages from DB",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Fetch bundles from Korba API
  const syncFromKorbaApi = async () => {
    setFetchingApi(true);
    try {
      const { data, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "get_korba_packages" }
      });
      if (error) throw error;
      if (data?.success) {
        const rawBundles = data.bundles || [];
        const flattened: KorbaBundle[] = [];
        
        rawBundles.forEach((item: any) => {
          if (item.bundles && Array.isArray(item.bundles)) {
            // This is an MTN category group!
            item.bundles.forEach((subBundle: any) => {
              flattened.push({
                name: subBundle.name,
                product_id: subBundle.product_id,
                amount: subBundle.amount,
                validity: subBundle.validity || "Non-expiry",
                network: item.network || "MTN",
                category: item.name || "Data Bundles"
              });
            });
          } else {
            // This is a Telecel or AirtelTigo flat bundle!
            flattened.push({
              name: item.name,
              product_id: item.product_id || item.bundle_id,
              amount: item.amount,
              validity: item.validity || "Non-expiry",
              network: item.network,
              category: item.category || "General"
            });
          }
        });

        setFetchedBundles(flattened);
        toast({
          title: "Fetched Bundles",
          description: `Successfully fetched and flattened ${flattened.length} packages from Korba API.`
        });
      } else {
        throw new Error(data?.error || "Failed to fetch bundles");
      }
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Fetch Failed",
        description: e.message || "Could not retrieve bundles from Korba gateway",
        variant: "destructive"
      });
    } finally {
      setFetchingApi(false);
    }
  };

  // Open import / map dialog for a bundle
  const handleOpenImport = (bundle: KorbaBundle) => {
    setSelectedBundle(bundle);
    setCostPrice(bundle.amount);
    
    // Auto-calculate suggested markups
    const base = parseFloat(bundle.amount);
    setAgentPrice(base.toFixed(2));
    setSubAgentPrice(base.toFixed(2));
    setPublicPrice((base * 1.12).toFixed(2));
    setApiPrice(base.toFixed(2));

    // Find options for target package sizes in current network
    if (bundle.category === "Airtime") {
      setIsNewPackageSize(true);
      setNewSizeName(bundle.name);
      setTargetPackageSize("");
    } else {
      const networkPkgs = importedPkgs.filter(p => p.network === activeTab || (activeTab === "MTN" && p.network === "MTN Mash Up"));
      if (networkPkgs.length > 0) {
        setTargetPackageSize(networkPkgs[0].package_size);
        setIsNewPackageSize(false);
      } else {
        setIsNewPackageSize(true);
        setTargetPackageSize("");
      }
      setNewSizeName("");
    }
    
    setShowImportDialog(true);
  };

  // Save imported / mapped package
  const handleSaveImport = async () => {
    if (!selectedBundle) return;
    setSaving(true);

    const costVal = costPrice ? parseFloat(costPrice) : parseFloat(selectedBundle.amount);
    const agentVal = agentPrice ? parseFloat(agentPrice) : costVal;
    const subAgentVal = subAgentPrice ? parseFloat(subAgentPrice) : costVal;
    const publicVal = publicPrice ? parseFloat(publicPrice) : Number((costVal * 1.12).toFixed(2));
    const apiVal = apiPrice ? parseFloat(apiPrice) : costVal;

    let providerNetwork = "MTN";
    if (selectedBundle.network.includes("Telecel") || selectedBundle.network.includes("Vodafone")) {
      providerNetwork = "Telecel";
    } else if (selectedBundle.network.includes("Airtel") || selectedBundle.network.includes("Tigo")) {
      providerNetwork = "AirtelTigo";
    }

    const standardSize = isNewPackageSize ? newSizeName.trim() : targetPackageSize;

    if (!standardSize) {
      toast({
        title: "Validation Error",
        description: "Please specify a target standard package size.",
        variant: "destructive"
      });
      setSaving(false);
      return;
    }

    try {
      // 1. If it's a new package size, insert into global_package_settings first
      if (isNewPackageSize) {
        const { error: globalInsertErr } = await supabase
          .from("global_package_settings")
          .upsert({
            network: providerNetwork,
            package_size: standardSize,
            cost_price: costVal,
            agent_price: agentVal,
            sub_agent_price: subAgentVal,
            public_price: publicVal,
            api_price: apiVal,
            is_unavailable: false,
            updated_at: new Date().toISOString()
          }, { onConflict: "network,package_size" });

        if (globalInsertErr) throw globalInsertErr;
      } else {
        // Update existing global settings prices
        const { error: globalUpdateErr } = await supabase
          .from("global_package_settings")
          .update({
            cost_price: costVal,
            agent_price: agentVal,
            sub_agent_price: subAgentVal,
            public_price: publicVal,
            api_price: apiVal,
            updated_at: new Date().toISOString()
          })
          .eq("network", providerNetwork)
          .eq("package_size", standardSize);

        if (globalUpdateErr) throw globalUpdateErr;
      }

      // 2. Create/Update mapping in provider_packages
      const { error: mappingErr } = await supabase
        .from("provider_packages")
        .upsert({
          provider_id: KORBA_PROVIDER_ID,
          network: providerNetwork,
          package_name: standardSize,
          cost_price: costVal,
          external_id: selectedBundle.product_id,
          capacity_gb: parseCapacityGb(standardSize),
          is_active: true,
          raw_data: {
            category: (selectedBundle as any).category || "General",
            validity: selectedBundle.validity,
            amount: selectedBundle.amount,
            product_id: selectedBundle.product_id,
            name: selectedBundle.name
          }
        }, { onConflict: "provider_id,network,package_name" });

      if (mappingErr) throw mappingErr;

      toast({
        title: "Package Mapped",
        description: `Successfully mapped Korba bundle "${selectedBundle.name}" to standard package "${standardSize}" under ${providerNetwork}.`
      });

      setShowImportDialog(false);
      setSelectedBundle(null);
      await loadData();
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Mapping Failed",
        description: e.message || "Failed to save configuration",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  // Open edit dialog
  const handleOpenEdit = (pkg: ImportedPackage) => {
    setEditingPkg(pkg);
    setCostPrice(pkg.cost_price?.toString() || "");
    setAgentPrice(pkg.agent_price?.toString() || "");
    setSubAgentPrice(pkg.sub_agent_price?.toString() || "");
    setPublicPrice(pkg.public_price?.toString() || "");
    setApiPrice(pkg.api_price?.toString() || "");
    setShowEditDialog(true);
  };

  // Save edits
  const handleSaveEdit = async () => {
    if (!editingPkg) return;
    setSaving(true);

    const costVal = costPrice ? parseFloat(costPrice) : null;
    const agentVal = agentPrice ? parseFloat(agentPrice) : null;
    const subAgentVal = subAgentPrice ? parseFloat(subAgentPrice) : null;
    const publicVal = publicPrice ? parseFloat(publicPrice) : null;
    const apiVal = apiPrice ? parseFloat(apiPrice) : null;

    try {
      // 1. Update global_package_settings
      const { error: globalErr } = await supabase
        .from("global_package_settings")
        .update({
          cost_price: costVal,
          agent_price: agentVal,
          sub_agent_price: subAgentVal,
          public_price: publicVal,
          api_price: apiVal,
          updated_at: new Date().toISOString()
        })
        .eq("network", editingPkg.network)
        .eq("package_size", editingPkg.package_size);

      if (globalErr) throw globalErr;

      // 2. Update provider_packages cost_price
      if (editingPkg.external_id) {
        const { error: mappingErr } = await supabase
          .from("provider_packages")
          .update({
            cost_price: costVal || 0,
            updated_at: new Date().toISOString()
          })
          .eq("provider_id", KORBA_PROVIDER_ID)
          .eq("network", editingPkg.network)
          .eq("package_name", editingPkg.package_size);

        if (mappingErr) {
          console.warn("Failed to update mapping cost:", mappingErr);
        }
      }

      toast({
        title: "Package Updated",
        description: `Successfully updated configuration for "${editingPkg.package_size}".`
      });

      setShowEditDialog(false);
      setEditingPkg(null);
      await loadData();
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Update Failed",
        description: e.message || "Failed to save edits",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  // Unmap standard package from Korba
  const handleUnmapPackage = async (pkg: ImportedPackage) => {
    if (!window.confirm(`Are you sure you want to unmap "${pkg.package_size}" from Korba? This will remove the Korba mapping but keep the standard package details.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from("provider_packages")
        .delete()
        .eq("provider_id", KORBA_PROVIDER_ID)
        .eq("network", pkg.network)
        .eq("package_name", pkg.package_size);

      if (error) throw error;

      toast({
        title: "Unmapped",
        description: `Successfully unmapped "${pkg.package_size}" from Korba.`
      });

      await loadData();
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Unmap Failed",
        description: e.message,
        variant: "destructive"
      });
    }
  };

  // Delete standard package config completely
  const handleDeletePackage = async (pkg: ImportedPackage) => {
    if (!window.confirm(`Are you sure you want to delete standard package "${pkg.package_size}" under ${pkg.network}? This will remove it from all gateways and storefronts.`)) {
      return;
    }

    try {
      // 1. Delete mapping
      await supabase
        .from("provider_packages")
        .delete()
        .eq("provider_id", KORBA_PROVIDER_ID)
        .eq("network", pkg.network)
        .eq("package_name", pkg.package_size);

      // 2. Delete settings
      const { error } = await supabase
        .from("global_package_settings")
        .delete()
        .eq("network", pkg.network)
        .eq("package_size", pkg.package_size);

      if (error) throw error;

      toast({
        title: "Deleted",
        description: "Standard package configuration removed successfully."
      });

      await loadData();
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Delete Failed",
        description: e.message,
        variant: "destructive"
      });
    }
  };

  // Toggle availability
  const handleToggleUnavailable = async (pkg: ImportedPackage, checked: boolean) => {
    try {
      const { error } = await supabase
        .from("global_package_settings")
        .update({
          is_unavailable: !checked,
          updated_at: new Date().toISOString()
        })
        .eq("network", pkg.network)
        .eq("package_size", pkg.package_size);

      if (error) throw error;

      setImportedPkgs(prev => 
        prev.map(p => 
          p.network === pkg.network && p.package_size === pkg.package_size 
            ? { ...p, is_unavailable: !checked } 
            : p
        )
      );

      toast({
        title: checked ? "Package Activated" : "Package Put On Hold",
        description: checked ? `${pkg.package_size} is now visible for purchase.` : `${pkg.package_size} is hidden.`
      });
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Toggle Failed",
        description: e.message,
        variant: "destructive"
      });
    }
  };

  // Create standard package directly
  const handleCreateStandardPkg = async () => {
    if (!newPkgSize.trim()) {
      toast({ title: "Validation Error", description: "Package size name is required", variant: "destructive" });
      return;
    }
    setSaving(true);

    const costVal = costPrice ? parseFloat(costPrice) : 0;
    const agentVal = agentPrice ? parseFloat(agentPrice) : 0;
    const subAgentVal = subAgentPrice ? parseFloat(subAgentPrice) : 0;
    const publicVal = publicPrice ? parseFloat(publicPrice) : 0;
    const apiVal = apiPrice ? parseFloat(apiPrice) : 0;

    try {
      const { error } = await supabase
        .from("global_package_settings")
        .insert({
          network: newPkgNetwork,
          package_size: newPkgSize.trim(),
          cost_price: costVal,
          agent_price: agentVal,
          sub_agent_price: subAgentVal,
          public_price: publicVal,
          api_price: apiVal,
          is_unavailable: false,
        });

      if (error) throw error;

      toast({
        title: "Created Standard Package",
        description: `Successfully created standard package "${newPkgSize.trim()}" for ${newPkgNetwork}.`
      });

      setShowCreateDialog(false);
      setNewPkgSize("");
      setCostPrice("");
      setAgentPrice("");
      setSubAgentPrice("");
      setPublicPrice("");
      setApiPrice("");
      await loadData();
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Creation Failed",
        description: e.message || "Failed to create package size",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    loadData();
    syncFromKorbaApi();
  }, [loadData]);

  // Filters
  const filteredImported = importedPkgs.filter(p => {
    const matchesNet = p.network === activeTab || (activeTab === "MTN" && p.network === "MTN Mash Up");
    const matchesSearch = p.package_size.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (p.external_id || "").toLowerCase().includes(searchQuery.toLowerCase());
    return matchesNet && matchesSearch;
  });

  const filteredFetched = fetchedBundles.filter(b => {
    // Map Korba API network to active tab
    const apiNet = b.network.toUpperCase();
    const tabNet = activeTab.toUpperCase();
    const isMatch = apiNet.includes(tabNet) || (tabNet === "TELECEL" && apiNet.includes("VODAFONE"));
    
    // Make sure it isn't already mapped
    const isAlreadyMapped = importedPkgs.some(
      (p) => (p.network === activeTab || (activeTab === "MTN" && p.network === "MTN Mash Up")) && 
             p.package_size === b.name && 
             p.external_id === b.product_id
    );

    const matchesSearch = b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (b.product_id || "").toLowerCase().includes(searchQuery.toLowerCase());

    return isMatch && !isAlreadyMapped && matchesSearch;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-purple-500/10 rounded-2xl flex items-center justify-center border border-purple-500/20">
              <Database className="w-6 h-6 text-purple-600 dark:text-purple-500" />
            </div>
            <h1 className="text-3xl font-black tracking-tighter text-foreground uppercase">Korba Package Management</h1>
          </div>
          <p className="text-muted-foreground text-sm font-medium">
            Map standard packages to the dynamic bundles retrieved from the Korba Partner exchange.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button 
            variant="outline"
            onClick={() => {
              setNewPkgNetwork(activeTab);
              setNewPkgSize("");
              setCostPrice("");
              setAgentPrice("");
              setSubAgentPrice("");
              setPublicPrice("");
              setApiPrice("");
              setShowCreateDialog(true);
            }}
            className="flex items-center gap-2 rounded-xl transition-all font-bold text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Standard Package
          </Button>
          <Button 
            variant="outline"
            onClick={syncFromKorbaApi}
            disabled={fetchingApi}
            className="flex items-center gap-2 rounded-xl transition-all font-bold text-xs"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", fetchingApi && "animate-spin")} />
            Sync from Korba API
          </Button>
          <Button 
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl transition-all font-bold text-xs"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Refresh DB
          </Button>
        </div>
      </div>

      {/* Info Warning */}
      <div className="bg-purple-500/5 border border-purple-500/15 rounded-2xl p-4 flex gap-3 text-xs leading-relaxed text-purple-600 dark:text-purple-400">
        <Info className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold uppercase tracking-wider mb-0.5">Unified Network Namespaces</p>
          <p>
            Korba packages are now merged into standard networks (<code className="font-mono bg-purple-500/10 px-1 rounded font-bold">MTN</code>, <code className="font-mono bg-purple-500/10 px-1 rounded font-bold">Telecel</code>, <code className="font-mono bg-purple-500/10 px-1 rounded font-bold">AirtelTigo</code>).
            Map available bundles from the Korba API Catalog on the right to standard sizes on the left.
            This ensures unified pricing setups and a seamless purchasing experience on the storefront.
          </p>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="MTN" onValueChange={setActiveTab} className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <TabsList className="bg-muted p-1 rounded-xl">
            <TabsTrigger value="MTN" className="rounded-lg font-bold text-xs">MTN</TabsTrigger>
            <TabsTrigger value="Telecel" className="rounded-lg font-bold text-xs">Telecel / Vodafone</TabsTrigger>
            <TabsTrigger value="AirtelTigo" className="rounded-lg font-bold text-xs">AirtelTigo</TabsTrigger>
          </TabsList>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search packages..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 w-full rounded-xl text-xs bg-background border-border"
            />
          </div>
        </div>

        {/* Dynamic content rendering */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Standard Packages list */}
          <Card className="lg:col-span-2 border-border shadow-sm">
            <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold">Standard Packages ({filteredImported.length})</CardTitle>
                <CardDescription className="text-xs">
                  Active storefront packages for {activeTab}. Mapped packages will route requests to Korba.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                  <p className="text-sm font-semibold text-muted-foreground">Loading settings...</p>
                </div>
              ) : filteredImported.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                  <Database className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <h4 className="text-sm font-bold text-foreground">No Packages Configured</h4>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    There are no standard packages configured for this network. Click Create Standard Package or select a bundle from the API Catalog.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 font-bold text-muted-foreground uppercase tracking-wider">
                        <th className="p-3">Package Size / Status</th>
                        <th className="p-3 text-right">Cost</th>
                        <th className="p-3 text-right">Agent</th>
                        <th className="p-3 text-right">Sub-Agent</th>
                        <th className="p-3 text-right">Public</th>
                        <th className="p-3 text-right">API</th>
                        <th className="p-3 text-center">Status</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredImported.map((pkg) => (
                        <tr key={pkg.id} className={cn("hover:bg-muted/10 transition-colors", pkg.is_unavailable && "opacity-60 bg-red-500/[0.02]")}>
                          <td className="p-3 space-y-1">
                            <span className="font-bold text-foreground block">{pkg.package_size}</span>
                            {pkg.external_id ? (
                              <span className="font-mono text-[9px] text-emerald-600 dark:text-emerald-400 block font-bold">Mapped Code: {pkg.external_id}</span>
                            ) : (
                              <span className="font-mono text-[9px] text-amber-500 block font-bold">Not Mapped</span>
                            )}
                          </td>
                          <td className="p-3 text-right font-semibold text-muted-foreground">₵{(pkg.cost_price || 0).toFixed(2)}</td>
                          <td className="p-3 text-right font-bold text-foreground">₵{(pkg.agent_price || 0).toFixed(2)}</td>
                          <td className="p-3 text-right font-bold text-purple-600 dark:text-purple-400">₵{(pkg.sub_agent_price || 0).toFixed(2)}</td>
                          <td className="p-3 text-right font-bold text-blue-600 dark:text-blue-400">₵{(pkg.public_price || 0).toFixed(2)}</td>
                          <td className="p-3 text-right font-bold text-amber-600 dark:text-amber-500">₵{(pkg.api_price || 0).toFixed(2)}</td>
                          <td className="p-3 text-center">
                            <Switch 
                              checked={!pkg.is_unavailable} 
                              onCheckedChange={(checked) => handleToggleUnavailable(pkg, checked)}
                              className="scale-75 data-[state=checked]:bg-emerald-500"
                            />
                          </td>
                          <td className="p-3 text-right space-x-1">
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              onClick={() => handleOpenEdit(pkg)} 
                              className="w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground"
                              title="Edit Prices"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            {pkg.external_id ? (
                              <Button 
                                size="icon" 
                                variant="ghost" 
                                onClick={() => handleUnmapPackage(pkg)} 
                                className="w-8 h-8 rounded-lg text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
                                title="Unmap from Korba"
                              >
                                <Pause className="w-3.5 h-3.5" />
                              </Button>
                            ) : (
                              <Button 
                                size="icon" 
                                variant="ghost" 
                                onClick={() => handleDeletePackage(pkg)} 
                                className="w-8 h-8 rounded-lg text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                title="Delete Standard Package"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Fetchable Korba API list */}
          <Card className="lg:col-span-1 border-border shadow-sm self-start">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-base font-bold flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-purple-500 animate-pulse" />
                Korba API Catalog ({filteredFetched.length})
              </CardTitle>
              <CardDescription className="text-xs">
                Available bundles on the dynamic API. Map them to standard package sizes.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 max-h-[500px] overflow-y-auto">
              {fetchingApi ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                  <p className="text-xs font-semibold text-muted-foreground">Querying Korba...</p>
                </div>
              ) : filteredFetched.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4 text-muted-foreground">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500/30 mb-2" />
                  <p className="text-xs font-semibold">All Catalog Bundles Mapped</p>
                  <p className="text-[10px] mt-0.5">No unconfigured bundles found.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredFetched.map((b, i) => (
                    <div key={i} className="p-3.5 flex items-center justify-between hover:bg-muted/10 transition-colors">
                      <div className="space-y-1 min-w-0 pr-2">
                        <span className="font-bold text-xs text-foreground block truncate" title={b.name}>{b.name}</span>
                        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground font-mono">
                          <span>₵{Number(b.amount).toFixed(2)}</span>
                          <span>•</span>
                          <span className="truncate">{b.product_id}</span>
                        </div>
                      </div>
                      <Button 
                        size="sm" 
                        onClick={() => handleOpenImport(b)}
                        className="h-7 px-2.5 rounded-lg text-[10px] font-bold gap-1 shrink-0"
                      >
                        <Plus className="w-3 h-3" />
                        Map
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </Tabs>

      {/* Dialog for Import / Map */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Map Korba Bundle</DialogTitle>
            <DialogDescription className="text-xs">
              Link this dynamic API bundle to a standard storefront package size.
            </DialogDescription>
          </DialogHeader>
          
          {selectedBundle && (
            <div className="grid gap-4 py-3 text-xs">
              <div className="bg-muted p-2.5 rounded-xl border border-border space-y-1">
                <span className="font-bold text-foreground block">{selectedBundle.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground block">
                  API Cost: GHS {Number(selectedBundle.amount).toFixed(2)} | Product ID: {selectedBundle.product_id}
                </span>
              </div>

              <div className="grid grid-cols-4 items-start gap-3">
                <Label className="text-right font-semibold pt-1">Standard Pkg</Label>
                <div className="col-span-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="isNewPkgSize" 
                      checked={isNewPackageSize}
                      onChange={(e) => setIsNewPackageSize(e.target.checked)}
                      className="rounded border-input text-purple-600 focus:ring-purple-500 h-3.5 w-3.5"
                    />
                    <label htmlFor="isNewPkgSize" className="font-bold text-[11px] text-muted-foreground cursor-pointer select-none">
                      Create new package size name
                    </label>
                  </div>
                  
                  {isNewPackageSize ? (
                    <Input 
                      placeholder="e.g. 1.5GB"
                      value={newSizeName}
                      onChange={(e) => setNewSizeName(e.target.value)}
                      className="h-9 text-xs"
                    />
                  ) : importedPkgs.filter(p => p.network === activeTab || (activeTab === "MTN" && p.network === "MTN Mash Up")).length === 0 ? (
                    <p className="text-[10px] text-amber-500 font-medium">No standard package sizes exist. Please check 'Create new package size name' above.</p>
                  ) : (
                    <select
                      value={targetPackageSize}
                      onChange={(e) => setTargetPackageSize(e.target.value)}
                      className="h-9 text-xs border border-input bg-background rounded-md px-2 w-full focus:outline-none focus:ring-1 focus:ring-purple-500"
                    >
                      {importedPkgs
                        .filter(p => p.network === activeTab || (activeTab === "MTN" && p.network === "MTN Mash Up"))
                        .map(p => (
                          <option key={p.id} value={p.package_size}>{p.package_size} ({p.network})</option>
                        ))
                      }
                    </select>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-4 items-center gap-3">
                <Label className="text-right font-semibold">Cost (₵)</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={costPrice} 
                  onChange={(e) => setCostPrice(e.target.value)}
                  className="col-span-3 h-9 text-xs" 
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-3">
                <Label className="text-right font-semibold">Agent (₵)</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={agentPrice} 
                  onChange={(e) => setAgentPrice(e.target.value)}
                  className="col-span-3 h-9 text-xs" 
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-3">
                <Label className="text-right font-semibold">Sub-Agent (₵)</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={subAgentPrice} 
                  onChange={(e) => setSubAgentPrice(e.target.value)}
                  className="col-span-3 h-9 text-xs bg-purple-500/5 border-purple-500/20 text-purple-600 dark:text-purple-400" 
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-3">
                <Label className="text-right font-semibold">Public (₵)</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={publicPrice} 
                  onChange={(e) => setPublicPrice(e.target.value)}
                  className="col-span-3 h-9 text-xs bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400" 
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-3">
                <Label className="text-right font-semibold">API (₵)</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={apiPrice} 
                  onChange={(e) => setApiPrice(e.target.value)}
                  className="col-span-3 h-9 text-xs bg-amber-400/5 border-amber-400/20 text-amber-600 dark:text-amber-500" 
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowImportDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveImport} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Save Mapping
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog for Edit */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Edit Package Configuration</DialogTitle>
            <DialogDescription className="text-xs">
              Modify pricing rates for this package size.
            </DialogDescription>
          </DialogHeader>
          
          {editingPkg && (
            <div className="grid gap-4 py-3 text-xs">
              <div className="bg-muted p-2.5 rounded-xl border border-border space-y-1">
                <span className="font-bold text-foreground block">{editingPkg.package_size}</span>
                <span className="font-mono text-[10px] text-muted-foreground block">
                  Network: {editingPkg.network} | Product ID: {editingPkg.external_id || "Not Mapped"}
                </span>
              </div>

              <div className="grid grid-cols-4 items-center gap-3">
                <Label className="text-right font-semibold">Cost (₵)</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={costPrice} 
                  onChange={(e) => setCostPrice(e.target.value)}
                  className="col-span-3 h-9 text-xs" 
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-3">
                <Label className="text-right font-semibold">Agent (₵)</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={agentPrice} 
                  onChange={(e) => setAgentPrice(e.target.value)}
                  className="col-span-3 h-9 text-xs" 
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-3">
                <Label className="text-right font-semibold">Sub-Agent (₵)</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={subAgentPrice} 
                  onChange={(e) => setSubAgentPrice(e.target.value)}
                  className="col-span-3 h-9 text-xs bg-purple-500/5 border-purple-500/20 text-purple-600 dark:text-purple-400" 
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-3">
                <Label className="text-right font-semibold">Public (₵)</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={publicPrice} 
                  onChange={(e) => setPublicPrice(e.target.value)}
                  className="col-span-3 h-9 text-xs bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400" 
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-3">
                <Label className="text-right font-semibold">API (₵)</Label>
                <Input 
                  type="number" 
                  step="0.01"
                  value={apiPrice} 
                  onChange={(e) => setApiPrice(e.target.value)}
                  className="col-span-3 h-9 text-xs bg-amber-400/5 border-amber-400/20 text-amber-600 dark:text-amber-500" 
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveEdit} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog for Creating Standard Package directly */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Create Standard Package</DialogTitle>
            <DialogDescription className="text-xs">
              Add a new standard package size to the database.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-3 text-xs">
            <div className="grid grid-cols-4 items-center gap-3">
              <Label className="text-right font-semibold">Network</Label>
              <select
                value={newPkgNetwork}
                onChange={(e) => setNewPkgNetwork(e.target.value)}
                className="col-span-3 h-9 text-xs border border-input bg-background rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-purple-500"
              >
                <option value="MTN">MTN</option>
                <option value="Telecel">Telecel / Vodafone</option>
                <option value="AirtelTigo">AirtelTigo</option>
                <option value="MTN Mash Up">MTN Mash Up</option>
              </select>
            </div>

            <div className="grid grid-cols-4 items-center gap-3">
              <Label className="text-right font-semibold">Size</Label>
              <Input 
                placeholder="e.g. 1GB, 2.5GB"
                value={newPkgSize} 
                onChange={(e) => setNewPkgSize(e.target.value)}
                className="col-span-3 h-9 text-xs" 
              />
            </div>
            
            <div className="grid grid-cols-4 items-center gap-3">
              <Label className="text-right font-semibold">Cost (₵)</Label>
              <Input 
                type="number" 
                step="0.01"
                value={costPrice} 
                onChange={(e) => setCostPrice(e.target.value)}
                className="col-span-3 h-9 text-xs" 
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-3">
              <Label className="text-right font-semibold">Agent (₵)</Label>
              <Input 
                type="number" 
                step="0.01"
                value={agentPrice} 
                onChange={(e) => setAgentPrice(e.target.value)}
                className="col-span-3 h-9 text-xs" 
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-3">
              <Label className="text-right font-semibold">Sub-Agent (₵)</Label>
              <Input 
                type="number" 
                step="0.01"
                value={subAgentPrice} 
                onChange={(e) => setSubAgentPrice(e.target.value)}
                className="col-span-3 h-9 text-xs bg-purple-500/5 border-purple-500/20 text-purple-600 dark:text-purple-400" 
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-3">
              <Label className="text-right font-semibold">Public (₵)</Label>
              <Input 
                type="number" 
                step="0.01"
                value={publicPrice} 
                onChange={(e) => setPublicPrice(e.target.value)}
                className="col-span-3 h-9 text-xs bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400" 
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-3">
              <Label className="text-right font-semibold">API (₵)</Label>
              <Input 
                type="number" 
                step="0.01"
                value={apiPrice} 
                onChange={(e) => setApiPrice(e.target.value)}
                className="col-span-3 h-9 text-xs bg-amber-400/5 border-amber-400/20 text-amber-600 dark:text-amber-500" 
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreateStandardPkg} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Create & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminKorbaPackages;
