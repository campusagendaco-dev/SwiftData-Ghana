import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Ticket, Plus, Loader2, Trash2, Zap, AlertTriangle,
  Gift, Wifi, ToggleLeft, ToggleRight, RefreshCw, Users
} from "lucide-react";

interface PromoCode {
  id: string;
  code: string;
  discount_percentage: number;
  max_uses: number;
  current_uses: number;
  is_active: boolean;
  created_at: string;
}

interface FreeDataSettings {
  free_data_enabled: boolean;
  free_data_network: string;
  free_data_package_size: string;
  free_data_max_claims: number;
  free_data_claims_count: number;
}

const NETWORKS = ["MTN", "Telecel", "AirtelTigo"];
const NETWORK_COLORS: Record<string, string> = { MTN: "#FFC107", Telecel: "#E53935", AirtelTigo: "#6366f1" };

const AdminPromotions = () => {
  const { toast } = useToast();

  // Promo codes state
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [promoTableMissing, setPromoTableMissing] = useState(false);
  const [promoLoading, setPromoLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [code, setCode] = useState("");
  const [discount, setDiscount] = useState("10");
  const [maxUses, setMaxUses] = useState("100");

  // Free data campaign state
  const [freeData, setFreeData] = useState<FreeDataSettings>({
    free_data_enabled: false,
    free_data_network: "MTN",
    free_data_package_size: "1GB",
    free_data_max_claims: 100,
    free_data_claims_count: 0,
  });
  const [freeDataMissing, setFreeDataMissing] = useState(false);
  const [savingFreeData, setSavingFreeData] = useState(false);
  const [claimCount, setClaimCount] = useState(0);

  const fetchPromos = useCallback(async () => {
    setPromoLoading(true);
    const { data, error } = await (supabase as any)
      .from("promo_codes")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("promo_codes") || msg.includes("relation") || msg.includes("schema cache")) {
        setPromoTableMissing(true);
      } else {
        toast({ title: "Error fetching promo codes", description: error.message, variant: "destructive" });
      }
    } else {
      setPromos((data as PromoCode[]) || []);
      setPromoTableMissing(false);
    }
    setPromoLoading(false);
  }, [toast]);

  const fetchFreeDataSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from("system_settings")
      .select("free_data_enabled, free_data_network, free_data_package_size, free_data_max_claims, free_data_claims_count")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("could not find") || msg.includes("does not exist") || msg.includes("schema cache")) {
        setFreeDataMissing(true);
      }
      return;
    }

    if (data) {
      setFreeDataMissing(false);
      setFreeData({
        free_data_enabled: Boolean((data as any).free_data_enabled),
        free_data_network: String((data as any).free_data_network || "MTN"),
        free_data_package_size: String((data as any).free_data_package_size || "1GB"),
        free_data_max_claims: Number((data as any).free_data_max_claims || 100),
        free_data_claims_count: Number((data as any).free_data_claims_count || 0),
      });
    }

    // Count actual claims from orders table
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("order_type" as any, "free_data_claim");
    setClaimCount(count || 0);
  }, []);

  useEffect(() => {
    fetchPromos();
    fetchFreeDataSettings();
  }, [fetchPromos, fetchFreeDataSettings]);

  const handleSaveFreeData = async () => {
    setSavingFreeData(true);
    const { error } = await supabase
      .from("system_settings")
      .update({
        free_data_enabled: freeData.free_data_enabled,
        free_data_network: freeData.free_data_network,
        free_data_package_size: freeData.free_data_package_size,
        free_data_max_claims: freeData.free_data_max_claims,
      } as any)
      .eq("id", 1);

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("could not find") || msg.includes("schema cache")) {
        setFreeDataMissing(true);
        toast({ title: "Migration required", description: "Run: npx supabase db push to apply migrations.", variant: "destructive" });
      } else {
        toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      }
    } else {
      toast({ title: freeData.free_data_enabled ? "Free Data Campaign is LIVE!" : "Campaign paused" });
    }
    setSavingFreeData(false);
  };

  const handleGenerate = async () => {
    if (!code.trim()) { toast({ title: "Code is required", variant: "destructive" }); return; }
    const pct = parseFloat(discount);
    if (isNaN(pct) || pct <= 0 || pct > 100) { toast({ title: "Invalid discount %", variant: "destructive" }); return; }
    const max = parseInt(maxUses);
    if (isNaN(max) || max < 1) { toast({ title: "Invalid max uses", variant: "destructive" }); return; }

    setGenerating(true);
    const { error } = await (supabase as any).from("promo_codes").insert({
      code: code.trim().toUpperCase(),
      discount_percentage: pct,
      max_uses: max,
      is_active: true,
    });

    if (error) {
      toast({ title: "Failed to create code", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Promo code created!" });
      setCode(""); setDiscount("10"); setMaxUses("100");
      fetchPromos();
    }
    setGenerating(false);
  };

  const handleToggleActive = async (id: string, current: boolean) => {
    await (supabase as any).from("promo_codes").update({ is_active: !current }).eq("id", id);
    fetchPromos();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this promo code?")) return;
    await (supabase as any).from("promo_codes").delete().eq("id", id);
    fetchPromos();
  };

  return (
    <div className="space-y-8 pb-10">
      <div className="border-b border-white/5 pb-6">
        <h1 className="font-display text-3xl font-black tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
          Promotions & Campaigns
        </h1>
        <p className="text-sm text-white/50 mt-1">Manage discount codes and run free data campaigns for customers.</p>
      </div>

      {/* ── Free Data Campaign ── */}
      <div className="rounded-2xl overflow-hidden border border-white/5">
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-green-500/10 to-emerald-500/5 border-b border-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                <Gift className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <h2 className="font-bold text-white text-lg">Free Data Campaign</h2>
                <p className="text-xs text-white/40">Let customers claim a free data bundle — toggle on/off instantly.</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {freeData.free_data_enabled ? (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> LIVE
                </Badge>
              ) : (
                <Badge variant="outline" className="text-white/40 border-white/10">OFF</Badge>
              )}
              <Switch
                checked={freeData.free_data_enabled}
                onCheckedChange={(v) => setFreeData(prev => ({ ...prev, free_data_enabled: v }))}
                className="data-[state=checked]:bg-green-500"
              />
            </div>
          </div>
        </div>

        <div className="p-6 bg-white/[0.01] space-y-5">
          {freeDataMissing && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-400">Migration Required</p>
                <p className="text-xs text-white/60 mt-0.5">
                  The free_data columns are missing. Run <code className="bg-white/10 px-1 rounded text-white/80">npx supabase db push</code> then refresh.
                </p>
              </div>
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-white/5 border border-white/5 p-3 text-center">
              <p className="text-xs text-white/40 mb-1">Claims</p>
              <p className="font-black text-xl text-white">{claimCount}</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/5 p-3 text-center">
              <p className="text-xs text-white/40 mb-1">Max Claims</p>
              <p className="font-black text-xl text-white">{freeData.free_data_max_claims}</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/5 p-3 text-center">
              <p className="text-xs text-white/40 mb-1">Network</p>
              <p className="font-black text-base" style={{ color: NETWORK_COLORS[freeData.free_data_network] || "#fff" }}>
                {freeData.free_data_network}
              </p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/5 p-3 text-center">
              <p className="text-xs text-white/40 mb-1">Bundle</p>
              <p className="font-black text-xl text-green-400">{freeData.free_data_package_size}</p>
            </div>
          </div>

          {/* Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2 block">Network</Label>
              <div className="flex gap-2">
                {NETWORKS.map(net => (
                  <button
                    key={net}
                    onClick={() => setFreeData(prev => ({ ...prev, free_data_network: net }))}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                      freeData.free_data_network === net
                        ? "border-2 text-white"
                        : "border border-white/10 text-white/40 hover:text-white/60"
                    }`}
                    style={freeData.free_data_network === net ? { borderColor: NETWORK_COLORS[net], background: `${NETWORK_COLORS[net]}20` } : {}}
                  >
                    {net}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2 block">Package Size</Label>
              <Input
                value={freeData.free_data_package_size}
                onChange={(e) => setFreeData(prev => ({ ...prev, free_data_package_size: e.target.value }))}
                placeholder="e.g. 500MB, 1GB"
                className="bg-white/5 border-white/10 text-white rounded-xl focus:border-green-400/40"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2 block">Max Claims</Label>
              <Input
                type="number"
                value={freeData.free_data_max_claims}
                onChange={(e) => setFreeData(prev => ({ ...prev, free_data_max_claims: parseInt(e.target.value) || 100 }))}
                className="bg-white/5 border-white/10 text-white rounded-xl focus:border-green-400/40"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSaveFreeData}
              disabled={savingFreeData || freeDataMissing}
              className={`font-bold rounded-xl ${freeData.free_data_enabled ? "bg-green-500 hover:bg-green-400 text-black" : "bg-white/10 hover:bg-white/20 text-white"}`}
            >
              {savingFreeData ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : freeData.free_data_enabled ? <ToggleRight className="w-4 h-4 mr-2" /> : <ToggleLeft className="w-4 h-4 mr-2" />}
              {freeData.free_data_enabled ? "Campaign is LIVE — Save Changes" : "Save (Campaign is OFF)"}
            </Button>
            <Button variant="ghost" size="sm" onClick={fetchFreeDataSettings} className="text-white/40 hover:text-white">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Promo Codes ── */}
      <div>
        <div className="flex items-center gap-2 mb-5">
          <Ticket className="w-5 h-5 text-amber-400" />
          <h2 className="font-bold text-white text-lg">Discount Promo Codes</h2>
        </div>

        {promoTableMissing ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="font-bold text-amber-400 mb-1">Database Table Not Found</h3>
                <p className="text-sm text-white/60 mb-4">
                  The <code className="bg-white/10 px-1 rounded text-white/80">promo_codes</code> table hasn't been created yet. Run the pending migrations to enable this feature.
                </p>
                <div className="bg-black/40 rounded-xl p-4 border border-white/10 font-mono text-xs text-green-400">
                  npx supabase db push
                </div>
                <p className="text-xs text-white/40 mt-3">
                  After running the command, refresh this page. The promo_codes, support_tickets, and audit_logs tables will all be created.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <div className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
                <div className="p-4 border-b border-white/5 bg-white/[0.01]">
                  <h3 className="font-bold text-white">Active Codes</h3>
                  <p className="text-xs text-white/40 mt-0.5">Click a code to disable or delete it.</p>
                </div>
                <div className="p-4">
                  {promoLoading ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-white/30" /></div>
                  ) : promos.length === 0 ? (
                    <div className="flex flex-col items-center py-10 text-center">
                      <Ticket className="w-10 h-10 text-white/10 mb-3" />
                      <p className="text-sm text-white/40">No promo codes yet. Create one on the right.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {promos.map((promo) => (
                        <div key={promo.id} className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-mono font-black text-lg text-amber-400">{promo.code}</p>
                              <Badge variant={promo.is_active ? "default" : "secondary"}
                                className={promo.is_active ? "bg-green-500/20 text-green-400 text-[10px]" : "text-[10px] text-white/30"}>
                                {promo.is_active ? "Active" : "Disabled"}
                              </Badge>
                            </div>
                            <p className="text-xs text-white/40">
                              {promo.discount_percentage}% off · {promo.current_uses}/{promo.max_uses} used
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline"
                              onClick={() => handleToggleActive(promo.id, promo.is_active)}
                              className="text-xs border-white/10 text-white/60 hover:text-white rounded-xl">
                              {promo.is_active ? "Disable" : "Enable"}
                            </Button>
                            <Button size="sm" variant="ghost"
                              onClick={() => handleDelete(promo.id)}
                              className="text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div>
              <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-5 space-y-4 sticky top-6">
                <h3 className="font-bold text-white flex items-center gap-2">
                  <Plus className="w-4 h-4 text-amber-400" /> New Code
                </h3>
                <div>
                  <Label className="text-xs text-white/50 mb-1.5 block">Code</Label>
                  <Input placeholder="e.g. FLASH20" className="uppercase font-mono bg-white/5 border-white/10 text-white rounded-xl focus:border-amber-400/40"
                    value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
                </div>
                <div>
                  <Label className="text-xs text-white/50 mb-1.5 block">Discount %</Label>
                  <Input type="number" placeholder="10" className="bg-white/5 border-white/10 text-white rounded-xl focus:border-amber-400/40"
                    value={discount} onChange={(e) => setDiscount(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-white/50 mb-1.5 block">Max Uses</Label>
                  <Input type="number" placeholder="100" className="bg-white/5 border-white/10 text-white rounded-xl focus:border-amber-400/40"
                    value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
                </div>
                <Button className="w-full bg-amber-400 text-black font-bold hover:bg-amber-300 rounded-xl" onClick={handleGenerate} disabled={generating || !code}>
                  {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                  Generate Code
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPromotions;
