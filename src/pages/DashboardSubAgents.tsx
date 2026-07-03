import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { basePackages, networks } from "@/lib/data";
import { Users2, Settings2, DollarSign, CheckCircle, Clock, Loader2, Save, RefreshCw, ClipboardList, ChevronRight, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";

interface SubAgent {
  user_id: string;
  full_name: string;
  email: string;
  phone: string;
  store_name: string;
  slug: string | null;
  sub_agent_approved: boolean;
  created_at: string;
}

interface GlobalPkgSetting {
  network: string;
  package_size: string;
  agent_price: number | null;
  sub_agent_price: number | null;
}

type Tab = "sub-agents" | "activation-fee" | "pricing" | "transactions";

interface SubAgentOrder {
  id: string;
  agent_id: string;
  network: string | null;
  package_size: string | null;
  customer_phone: string | null;
  amount: number;
  parent_profit: number;
  status: string;
  created_at: string;
  agent_name?: string;
}

const normalizePackageSize = (size: string) => size.replace(/\s+/g, "").toUpperCase();

const DashboardSubAgents = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>("sub-agents");
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalPkgSetting[]>([]);
  const [activationFee, setActivationFee] = useState(0);
  const [savingMarkup, setSavingMarkup] = useState(false);
  const [subAgentPrices, setSubAgentPrices] = useState<Record<string, Record<string, string>>>({});
  const [savingPrices, setSavingPrices] = useState(false);
  const [pushingPrices, setPushingPrices] = useState(false);
  const [subAgentOrders, setSubAgentOrders] = useState<SubAgentOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [orderFilter, setOrderFilter] = useState("all");
  const [loadingSubAgents, setLoadingSubAgents] = useState(true);
  const [selectedNetwork, setSelectedNetwork] = useState(networks[0].name);
  const [priceMultiplier, setPriceMultiplier] = useState(1);
  const [platformBaseFee, setPlatformBaseFee] = useState(50);
  const [expandedBridgeConfig, setExpandedBridgeConfig] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoadingSubAgents(true);

    const [saRes, gsRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("user_id, full_name, email, phone, store_name, slug, sub_agent_approved, created_at, auto_bridge_enabled, auto_bridge_threshold, auto_bridge_amount")
        .eq("parent_agent_id", user.id)
        .order("created_at", { ascending: false }),
      supabase.from("global_package_settings").select("network, package_size, agent_price, sub_agent_price"),
    ]);

    if (saRes.data) setSubAgents(saRes.data as SubAgent[]);
    if (gsRes.data) setGlobalSettings(gsRes.data as GlobalPkgSetting[]);
    setLoadingSubAgents(false);
  }, [user]);

  const fetchSubAgentOrders = useCallback(async () => {
    if (!user) return;
    setLoadingOrders(true);
    // Get all sub-agent user IDs under this parent agent
    const { data: sas } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .eq("parent_agent_id", user.id)
      .eq("sub_agent_approved", true);
    const saIds = (sas ?? []).map((s) => s.user_id);
    const nameMap: Record<string, string> = {};
    (sas ?? []).forEach((s) => { nameMap[s.user_id] = s.full_name; });
    if (saIds.length === 0) { setSubAgentOrders([]); setLoadingOrders(false); return; }
    const { data: orders } = await supabase
      .from("orders")
      .select("id, agent_id, network, package_size, customer_phone, amount, parent_profit, status, created_at")
      .in("agent_id", saIds)
      .order("created_at", { ascending: false })
      .limit(500);
    const enriched = (orders ?? []).map((o: any) => ({ ...o, agent_name: nameMap[o.agent_id] ?? "Unknown" }));
    setSubAgentOrders(enriched as SubAgentOrder[]);
    setLoadingOrders(false);
  }, [user]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    fetchApiPricingContext().then((ctx) => setPriceMultiplier(ctx.multiplier));
    
    // Fetch dynamic sub-agent base fee
    supabase
      .from("system_settings")
      .select("sub_agent_base_fee")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.sub_agent_base_fee) {
          setPlatformBaseFee(Number(data.sub_agent_base_fee));
        }
      });
  }, []);

  const getParentAgentBasePrice = useCallback((network: string, size: string): number | null => {
    const gs = globalSettings.find(
      (s) => (s.network === network || s.network === `Korba ${network}`) && normalizePackageSize(s.package_size) === normalizePackageSize(size),
    );
    const adminSubAgentPrice = Number(gs?.sub_agent_price || 0);
    const adminAgentPrice = Number(gs?.agent_price || 0);
    
    // We show the sub_agent_price as the base for the sub-agent if set, otherwise agent_price
    const priceToUse = (Number.isFinite(adminSubAgentPrice) && adminSubAgentPrice > 0) 
      ? adminSubAgentPrice 
      : adminAgentPrice;

    if (Number.isFinite(priceToUse) && priceToUse > 0) {
      return applyPriceMultiplier(priceToUse, priceMultiplier);
    }
    return null;
  }, [globalSettings, priceMultiplier]);

  // Init local markup + prices from profile
  useEffect(() => {
    if (!profile) return;
    setActivationFee(Math.max(0, Number((profile as any).sub_agent_activation_markup || 0)));
    const stored = (profile as any).sub_agent_prices as Record<string, Record<string, string>> | undefined;
    if (stored && Object.keys(stored).length > 0) {
      setSubAgentPrices(stored);
    } else {
      const defaults: Record<string, Record<string, string>> = {};
      for (const n of networks) {
        defaults[n.name] = {};
        for (const pkg of basePackages[n.name] || []) {
          const base = getParentAgentBasePrice(n.name, pkg.size);
          defaults[n.name][pkg.size] = (base ?? 0).toFixed(2);
        }
      }
      setSubAgentPrices(defaults);
    }
  }, [profile, getParentAgentBasePrice]);

  const handleToggleApproval = async (subAgentId: string, currentStatus: boolean) => {
    if (!user) return;
    const newStatus = !currentStatus;
    
    // Optimistic UI update
    setSubAgents(prev => prev.map(sa => sa.user_id === subAgentId ? { ...sa, sub_agent_approved: newStatus } : sa));
    
    const { error } = await supabase.from("profiles").update({
      sub_agent_approved: newStatus,
      agent_approved: newStatus,
      is_agent: newStatus,
      onboarding_complete: newStatus,
      // If approving, also make sure they have the parent's prices
      ...(newStatus ? { agent_prices: subAgentPrices } : {})
    } as any).eq("user_id", subAgentId);
    
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      fetchAll(); // revert on error
    } else {
      toast({ title: newStatus ? "Sub-Agent Approved" : "Access Revoked" });
    }
  };

  const handleSaveAutoBridge = async (subAgentId: string, enabled: boolean, threshold: number, amount: number) => {
    const { error } = await supabase.from("profiles").update({
      auto_bridge_enabled: enabled,
      auto_bridge_threshold: threshold,
      auto_bridge_amount: amount
    }).eq("user_id", subAgentId);
    
    if (error) {
      toast({ title: "Failed to save settings", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Auto-Bridge settings saved" });
      fetchAll();
    }
  };

  const handleSaveMarkup = async () => {
    if (!user) return;
    setSavingMarkup(true);
    const { error } = await supabase
      .from("profiles")
      .update({ sub_agent_activation_markup: activationFee })
      .eq("user_id", user.id);
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Activation fee saved" });
      await refreshProfile();
    }
    setSavingMarkup(false);
  };

  const handleSavePrices = async () => {
    if (!user) return;
    
    // Validate that no price is below the parent's own base cost
    for (const n of networks) {
      for (const pkg of basePackages[n.name] || []) {
        const parentBasePrice = getParentAgentBasePrice(n.name, pkg.size);
        const setPrice = Number(subAgentPrices[n.name]?.[pkg.size]);
        
        if (parentBasePrice !== null && Number.isFinite(setPrice) && setPrice < parentBasePrice) {
          toast({
            title: "Invalid Price",
            description: `${n.name} ${pkg.size} cannot be below your base cost (GH₵ ${parentBasePrice.toFixed(2)})`,
            variant: "destructive"
          });
          return;
        }
      }
    }

    setSavingPrices(true);
    const { error } = await supabase
      .from("profiles")
      .update({ sub_agent_prices: subAgentPrices })
      .eq("user_id", user.id);
    if (error) {
      toast({ title: "Failed to save prices", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Sub agent prices saved" });
      await refreshProfile();
    }
    setSavingPrices(false);
  };

  const handlePushPrices = async () => {
    if (!user || subAgents.length === 0) return;
    setPushingPrices(true);
    const updates = subAgents
      .filter((sa) => sa.sub_agent_approved)
      .map((sa) =>
        supabase.from("profiles").update({ agent_prices: subAgentPrices }).eq("user_id", sa.user_id)
      );
    const results = await Promise.all(updates);
    const failed = results.filter((r) => r.error).length;
    if (failed > 0) {
      toast({ title: `${failed} update(s) failed`, variant: "destructive" });
    } else {
      toast({ title: "Prices pushed to all sub agents" });
    }
    setPushingPrices(false);
  };

  const totalFee = activationFee;
  const agentShare = Math.max(0, parseFloat((totalFee - platformBaseFee).toFixed(2)));
  const swiftDataShare = parseFloat((totalFee - agentShare).toFixed(2));

  const TABS: { id: Tab; label: string; icon: typeof Users2 }[] = [
    { id: "sub-agents", label: "Sub Agents", icon: Users2 },
    { id: "activation-fee", label: "Activation Fee", icon: DollarSign },
    { id: "pricing", label: "Pricing", icon: Settings2 },
    { id: "transactions", label: "Transactions", icon: ClipboardList },
  ];

  // Fetch sub-agent orders when tab is opened
  useEffect(() => {
    if (tab === "transactions") fetchSubAgentOrders();
  }, [tab, fetchSubAgentOrders]);

  return (
    <div className="p-4 md:p-6 max-w-5xl space-y-6">
      <div>
      <div className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-bold">Sub Agents</h1>
        <Badge className="bg-emerald-500 text-white border-none uppercase font-black px-1.5 animate-pulse text-[10px]">NEW</Badge>
      </div>
        <p className="text-muted-foreground text-sm mt-1">Manage your sub agent network, fees, and pricing.</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Sub Agents", value: subAgents.length },
          { label: "Active", value: subAgents.filter((s) => s.sub_agent_approved).length },
          { label: "Total Commission", value: `GH₵ ${subAgentOrders.filter(o => o.status === "fulfilled").reduce((s, o) => s + (Number(o.parent_profit) || 0), 0).toFixed(2)}` },
          { label: "Your Activation Fee", value: `GH₵ ${totalFee.toFixed(2)}` },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-amber-400 p-3">
            <p className="text-black/70 text-[10px] uppercase font-bold tracking-tight">{s.label}</p>
            <p className="text-black font-black text-xl">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-amber-400 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Sub Agents list */}
      {tab === "sub-agents" && (
        <div>
          {loadingSubAgents ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading...
            </div>
          ) : subAgents.length === 0 ? (
            <div className="text-center py-16">
              <Users2 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-semibold text-foreground mb-1">No sub agents yet</p>
              <p className="text-sm text-muted-foreground">
                Share your signup link:{" "}
                <span className="font-mono text-xs bg-accent px-2 py-0.5 rounded">
                  {window.location.origin}/store/{profile?.slug}/sub-agent
                </span>
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Sub agent signup link:{" "}
                <button
                  className="font-mono text-xs bg-accent px-2 py-0.5 rounded hover:bg-amber-400/20 transition-colors"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/store/${profile?.slug}/sub-agent`);
                    toast({ title: "Link copied!" });
                  }}
                >
                  {window.location.origin}/store/{profile?.slug}/sub-agent
                </button>
              </p>
              {subAgents.map((sa: any) => {
                const isExpanded = expandedBridgeConfig === sa.user_id;
                return (
                <Card key={sa.user_id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="font-semibold text-sm truncate">{sa.full_name || "—"}</p>
                          {sa.sub_agent_approved ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-green-500/10 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full border border-green-500/20">
                              <CheckCircle className="w-2.5 h-2.5" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/20">
                              <Clock className="w-2.5 h-2.5" /> Pending
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{sa.email}</p>
                        {sa.store_name && <p className="text-xs text-muted-foreground">{sa.store_name}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setExpandedBridgeConfig(isExpanded ? null : sa.user_id)}
                            className="text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors border bg-blue-500/10 text-blue-500 border-blue-500/20 hover:bg-blue-500/20 flex items-center gap-1"
                          >
                            <Zap className="w-3 h-3" />
                            Auto-Bridge
                          </button>
                          <button
                            onClick={() => handleToggleApproval(sa.user_id, sa.sub_agent_approved)}
                            className={`text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors border ${
                              sa.sub_agent_approved 
                                ? "bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20" 
                                : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20"
                            }`}
                          >
                            {sa.sub_agent_approved ? "Revoke Access" : "Approve Agent"}
                          </button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-border animate-in slide-in-from-top-2">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-bold flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-500" /> Auto-Bridge Settings</h4>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-muted-foreground">Status</label>
                            <select 
                              className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 text-foreground"
                              defaultValue={sa.auto_bridge_enabled ? "true" : "false"}
                              id={`status-${sa.user_id}`}
                            >
                              <option value="false">Disabled</option>
                              <option value="true">Enabled</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-muted-foreground">Threshold (GHS)</label>
                            <input 
                              type="number" 
                              className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 text-foreground"
                              defaultValue={sa.auto_bridge_threshold}
                              id={`thresh-${sa.user_id}`}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-muted-foreground">Bridge Amount (GHS)</label>
                            <input 
                              type="number" 
                              className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 text-foreground"
                              defaultValue={sa.auto_bridge_amount}
                              id={`amt-${sa.user_id}`}
                            />
                          </div>
                        </div>
                        <div className="mt-3 flex justify-end">
                          <button 
                            className="bg-amber-400 hover:bg-amber-300 text-black text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                            onClick={() => {
                              const enabled = (document.getElementById(`status-${sa.user_id}`) as HTMLSelectElement).value === "true";
                              const threshold = Number((document.getElementById(`thresh-${sa.user_id}`) as HTMLInputElement).value);
                              const amount = Number((document.getElementById(`amt-${sa.user_id}`) as HTMLInputElement).value);
                              handleSaveAutoBridge(sa.user_id, enabled, threshold, amount);
                            }}
                          >
                            Save Settings
                          </button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Activation Fee */}
      {tab === "activation-fee" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sub Agent Activation Fee</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-amber-400/10 border border-amber-400/30 p-3 text-sm">
              <p className="font-medium mb-1">How it works</p>
              <p className="text-muted-foreground text-xs">
                Set the full activation price your sub agents will pay. SwiftData keeps a base fee of GH₵ {platformBaseFee.toFixed(2)} and you receive the remainder on your profit dashboard.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1.5">Your activation price (GH₵)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={activationFee}
                  onChange={(e) => setActivationFee(Math.max(0, Number(e.target.value)))}
                  className="w-full border border-input bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 text-foreground"
                />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Your share</span>
                <span className="font-medium">GH₵ {agentShare.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">SwiftData base fee</span>
                <span className="font-medium">GH₵ {swiftDataShare.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-border pt-3">
                <span>Total sub agent pays</span>
                <span>GH₵ {totalFee.toFixed(2)}</span>
              </div>
            </div>

            <button
              onClick={handleSaveMarkup}
              disabled={savingMarkup}
              className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              {savingMarkup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {savingMarkup ? "Saving..." : "Save Activation Fee"}
            </button>
          </CardContent>
        </Card>
      )}

      {/* Pricing */}
      {tab === "pricing" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">
                Set the prices your sub agents charge their customers. Only admin-set agent package prices are used as base.
                Sub agents then use these assigned prices as their base in their own store pricing page.
              </p>
            </CardContent>
          </Card>

          {/* Network tabs */}
          <div className="flex flex-wrap gap-2">
            {networks.map((n) => (
              <button
                key={n.name}
                onClick={() => setSelectedNetwork(n.name)}
                className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                  selectedNetwork === n.name
                    ? "bg-amber-400 border-amber-400 text-black shadow-sm"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-amber-400"
                }`}
              >
                {n.name}
              </button>
            ))}
          </div>

          {/* Price grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(basePackages[selectedNetwork] || []).map((pkg) => {
              const parentBasePrice = getParentAgentBasePrice(selectedNetwork, pkg.size);
              const hasAdminBase = parentBasePrice !== null;
              const currentVal = subAgentPrices[selectedNetwork]?.[pkg.size] ?? (hasAdminBase ? parentBasePrice.toFixed(2) : "0.00");
              const numericCurrent = Number(currentVal);
              const profit = hasAdminBase
                ? parseFloat((numericCurrent - parentBasePrice).toFixed(2))
                : 0;
              return (
                <div key={pkg.size} className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-sm">{pkg.size}</span>
                      <span className="text-xs text-muted-foreground">
                        admin base: {hasAdminBase ? `GH₵ ${parentBasePrice.toFixed(2)}` : "Not configured"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">GH₵</span>
                      <input
                        type="number"
                        min={hasAdminBase ? parentBasePrice : 0}
                        step={0.01}
                        value={currentVal}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSubAgentPrices((prev) => ({
                            ...prev,
                            [selectedNetwork]: { ...(prev[selectedNetwork] || {}), [pkg.size]: val },
                          }));
                        }}
                        disabled={!hasAdminBase}
                        className="w-24 border border-input bg-background text-foreground rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                      />
                      {hasAdminBase && profit > 0 && (
                        <span className="text-xs text-green-600 font-medium">+GH₵{profit.toFixed(2)}</span>
                      )}
                      {hasAdminBase && profit < 0 && (
                        <span className="text-xs text-red-600 font-bold animate-pulse">Below Cost!</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleSavePrices}
              disabled={savingPrices}
              className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              {savingPrices ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {savingPrices ? "Saving..." : "Save Prices"}
            </button>
          </div>
        </div>
      )}
      {/* Sub-Agent Transactions */}
      {tab === "transactions" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Sub-Agent Transactions</p>
              <p className="text-xs text-muted-foreground mt-0.5">All orders placed by your sub-agents. Your profit per order is shown.</p>
            </div>
            <div className="flex items-center gap-2">
              <select value={orderFilter} onChange={(e) => setOrderFilter(e.target.value)}
                className="text-xs bg-transparent border border-border rounded-lg px-3 py-1.5 text-foreground outline-none">
                <option value="all">All Statuses</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="fulfillment_failed">Failed</option>
                <option value="paid">Processing</option>
              </select>
              <button onClick={fetchSubAgentOrders} className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Profit summary */}
          {subAgentOrders.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Fulfilled Orders", value: subAgentOrders.filter(o => o.status === "fulfilled").length },
                { label: "Fulfilled Volume", value: `₵${subAgentOrders.filter(o => o.status === "fulfilled").reduce((s, o) => s + Number(o.amount), 0).toFixed(2)}` },
                { label: "Total Profit Earned", value: `₵${subAgentOrders.filter(o => o.status === "fulfilled").reduce((s, o) => s + Number(o.parent_profit || 0), 0).toFixed(2)}`, highlight: true },
              ].map((s) => (
                <div key={s.label} className={`rounded-xl p-3 text-center border ${s.highlight ? "bg-amber-400/10 border-amber-400/30" : "bg-card border-border"}`}>
                  <p className={`font-black text-lg ${s.highlight ? "text-amber-400" : "text-foreground"}`}>{s.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {loadingOrders ? (
            <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading transactions...
            </div>
          ) : subAgentOrders.filter(o => orderFilter === "all" || o.status === orderFilter).length === 0 ? (
            <div className="py-12 text-center">
              <ClipboardList className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No transactions found.</p>
            </div>
          ) : (
            <>
              {/* Desktop View */}
              <div className="hidden md:block rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Date</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Sub-Agent</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Phone</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Package</th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Amount</th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Your Profit</th>
                        <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {subAgentOrders
                        .filter(o => orderFilter === "all" || o.status === orderFilter)
                        .map((order) => (
                          <tr key={order.id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(order.created_at).toLocaleDateString("en-GH", { day: "2-digit", month: "short" })}
                            </td>
                            <td className="px-4 py-2.5 text-xs font-medium truncate max-w-[100px]">{order.agent_name}</td>
                            <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground hidden sm:table-cell">{order.customer_phone || "—"}</td>
                            <td className="px-4 py-2.5 text-xs">{order.network} {order.package_size}</td>
                            <td className="px-4 py-2.5 text-xs font-bold text-right">GH₵{Number(order.amount).toFixed(2)}</td>
                            <td className="px-4 py-2.5 text-right">
                              {Number(order.parent_profit) > 0
                                ? <span className="text-xs font-bold text-emerald-500">+GH₵{Number(order.parent_profit).toFixed(2)}</span>
                                : <span className="text-xs text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                order.status === "fulfilled" ? "bg-green-500/10 text-green-500 border-green-500/20"
                                : order.status === "fulfillment_failed" ? "bg-red-500/10 text-red-500 border-red-500/20"
                                : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                              }`}>{order.status.replace(/_/g, " ")}</span>
                            </td>
                          </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile View */}
              <div className="md:hidden space-y-3">
                {subAgentOrders
                  .filter(o => orderFilter === "all" || o.status === orderFilter)
                  .map((order) => (
                    <div key={order.id} className="rounded-xl bg-card border border-border p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-medium text-muted-foreground">{new Date(order.created_at).toLocaleDateString()}</span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                              order.status === "fulfilled" ? "bg-green-500/10 text-green-500 border-green-500/20"
                              : order.status === "fulfillment_failed" ? "bg-red-500/10 text-red-500 border-red-500/20"
                              : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                            }`}>{order.status.replace(/_/g, " ")}</span>
                          </div>
                          <p className="font-bold text-sm truncate">{order.agent_name}</p>
                          <p className="text-xs text-muted-foreground">{order.network} {order.package_size}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-foreground">GH₵{Number(order.amount).toFixed(2)}</p>
                          {Number(order.parent_profit) > 0 && (
                            <span className="text-[10px] font-bold text-emerald-500">+GH₵{Number(order.parent_profit).toFixed(2)} profit</span>
                          )}
                        </div>
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground pt-1 border-t border-border/50">
                        Recipient: {order.customer_phone || "—"}
                      </div>
                    </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default DashboardSubAgents;
