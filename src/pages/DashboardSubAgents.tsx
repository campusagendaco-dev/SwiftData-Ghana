import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { basePackages, networks } from "@/lib/data";
import { Users2, Settings2, DollarSign, CheckCircle, Clock, Loader2, Save, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
}

type Tab = "sub-agents" | "activation-fee" | "pricing";

const DashboardSubAgents = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>("sub-agents");
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalPkgSetting[]>([]);
  const [adminBaseFee, setAdminBaseFee] = useState(80);
  const [markup, setMarkup] = useState(0);
  const [savingMarkup, setSavingMarkup] = useState(false);
  const [subAgentPrices, setSubAgentPrices] = useState<Record<string, Record<string, string>>>({});
  const [savingPrices, setSavingPrices] = useState(false);
  const [pushingPrices, setPushingPrices] = useState(false);
  const [loadingSubAgents, setLoadingSubAgents] = useState(true);
  const [selectedNetwork, setSelectedNetwork] = useState(networks[0].name);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoadingSubAgents(true);

    const [saRes, gsRes, settingsRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("user_id, full_name, email, phone, store_name, slug, sub_agent_approved, created_at")
        .eq("parent_agent_id", user.id)
        .order("created_at", { ascending: false }),
      supabase.from("global_package_settings").select("network, package_size, agent_price"),
      supabase.from("system_settings").select("sub_agent_base_fee").eq("id", 1).maybeSingle(),
    ]);

    if (saRes.data) setSubAgents(saRes.data as SubAgent[]);
    if (gsRes.data) setGlobalSettings(gsRes.data as GlobalPkgSetting[]);
    const fee = Number(settingsRes.data?.sub_agent_base_fee);
    if (Number.isFinite(fee) && fee > 0) setAdminBaseFee(fee);
    setLoadingSubAgents(false);
  }, [user]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Init local markup + prices from profile
  useEffect(() => {
    if (!profile) return;
    setMarkup(Number((profile as any).sub_agent_activation_markup || 0));
    const stored = (profile as any).sub_agent_prices as Record<string, Record<string, string>> | undefined;
    if (stored && Object.keys(stored).length > 0) {
      setSubAgentPrices(stored);
    } else {
      const defaults: Record<string, Record<string, string>> = {};
      for (const n of networks) {
        defaults[n.name] = {};
        for (const pkg of basePackages[n.name] || []) {
          const gs = globalSettings.find((s) => s.network === n.name && s.package_size === pkg.size);
          defaults[n.name][pkg.size] = (gs?.agent_price ?? pkg.price).toFixed(2);
        }
      }
      setSubAgentPrices(defaults);
    }
  }, [profile, globalSettings]);

  const getAdminAgentPrice = (network: string, size: string): number => {
    const gs = globalSettings.find((s) => s.network === network && s.package_size === size);
    if (gs?.agent_price && gs.agent_price > 0) return gs.agent_price;
    const pkg = basePackages[network]?.find((p) => p.size === size);
    return pkg?.price ?? 0;
  };

  const handleSaveMarkup = async () => {
    if (!user) return;
    setSavingMarkup(true);
    const { error } = await supabase
      .from("profiles")
      .update({ sub_agent_activation_markup: markup })
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

  const totalFee = adminBaseFee + markup;

  const TABS: { id: Tab; label: string; icon: typeof Users2 }[] = [
    { id: "sub-agents", label: "Sub Agents", icon: Users2 },
    { id: "activation-fee", label: "Activation Fee", icon: DollarSign },
    { id: "pricing", label: "Pricing", icon: Settings2 },
  ];

  return (
    <div className="p-4 md:p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Sub Agents</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your sub agent network, fees, and pricing.</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Total Sub Agents", value: subAgents.length },
          { label: "Active", value: subAgents.filter((s) => s.sub_agent_approved).length },
          { label: "Your Activation Fee", value: `GH₵ ${totalFee.toFixed(2)}` },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-amber-400 p-3">
            <p className="text-black/70 text-xs">{s.label}</p>
            <p className="text-black font-black text-2xl">{s.value}</p>
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
              {subAgents.map((sa) => (
                <Card key={sa.user_id}>
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-semibold text-sm truncate">{sa.full_name || "—"}</p>
                        {sa.sub_agent_approved ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                            <CheckCircle className="w-3 h-3" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                            <Clock className="w-3 h-3" /> Pending
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{sa.email}</p>
                      {sa.store_name && <p className="text-xs text-muted-foreground">{sa.store_name}</p>}
                    </div>
                    <p className="text-xs text-muted-foreground shrink-0">
                      {new Date(sa.created_at).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              ))}
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
                Admin has set the base activation fee at <strong>GH₵ {adminBaseFee.toFixed(2)}</strong>. You can add your
                own markup on top. The sub agent pays the total, and your markup is credited to your wallet.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Admin base fee</span>
                <span className="font-medium">GH₵ {adminBaseFee.toFixed(2)}</span>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Your markup (GH₵)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={markup}
                  onChange={(e) => setMarkup(Math.max(0, Number(e.target.value)))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 bg-transparent"
                />
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-border pt-3">
                <span>Total sub agent pays</span>
                <span>GH₵ {totalFee.toFixed(2)} + Paystack fee</span>
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
                Set the prices your sub agents charge their customers. Admin agent prices (shown as base) are the
                minimum — your sub agents earn the difference.
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
                    ? "bg-amber-400 border-amber-400 text-black"
                    : "border-gray-300 text-black hover:border-amber-400"
                }`}
              >
                {n.name}
              </button>
            ))}
          </div>

          {/* Price grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(basePackages[selectedNetwork] || []).map((pkg) => {
              const adminPrice = getAdminAgentPrice(selectedNetwork, pkg.size);
              const currentVal = subAgentPrices[selectedNetwork]?.[pkg.size] ?? adminPrice.toFixed(2);
              const profit = parseFloat((Number(currentVal) - adminPrice).toFixed(2));
              return (
                <div key={pkg.size} className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-sm">{pkg.size}</span>
                      <span className="text-xs text-muted-foreground">base: GH₵ {adminPrice.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">GH₵</span>
                      <input
                        type="number"
                        min={adminPrice}
                        step={0.01}
                        value={currentVal}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSubAgentPrices((prev) => ({
                            ...prev,
                            [selectedNetwork]: { ...(prev[selectedNetwork] || {}), [pkg.size]: val },
                          }));
                        }}
                        className="w-24 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-amber-400 bg-transparent"
                      />
                      {profit > 0 && (
                        <span className="text-xs text-green-600 font-medium">+GH₵{profit.toFixed(2)}</span>
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
            {subAgents.filter((s) => s.sub_agent_approved).length > 0 && (
              <button
                onClick={handlePushPrices}
                disabled={pushingPrices}
                className="border border-border hover:bg-accent disabled:opacity-50 text-foreground font-semibold px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2"
              >
                {pushingPrices ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {pushingPrices
                  ? "Pushing..."
                  : `Push to ${subAgents.filter((s) => s.sub_agent_approved).length} Active Sub Agent(s)`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardSubAgents;
