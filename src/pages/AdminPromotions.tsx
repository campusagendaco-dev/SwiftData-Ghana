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
  Gift, Wifi, ToggleLeft, ToggleRight, RefreshCw, Users,
  Download, Copy, CheckCircle, Flame, Sparkles, Clock, Eye, Smartphone, Send
} from "lucide-react";
import { logAudit } from "@/utils/auditLogger";
import { useAuth } from "@/hooks/useAuth";

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
  const { user: currentUser } = useAuth();

  // Promo codes state
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [promoTableMissing, setPromoTableMissing] = useState(false);
  const [promoLoading, setPromoLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [code, setCode] = useState("");
  const [discount, setDiscount] = useState("100");
  const [maxUses, setMaxUses] = useState("1");
  const [bulkCount, setBulkCount] = useState("1");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Free data campaign state
  const [freeData, setFreeData] = useState<FreeDataSettings>({
    free_data_enabled: false,
    free_data_network: "MTN",
    free_data_package_size: "1GB",
    free_data_max_claims: 100,
    free_data_claims_count: 0,
  });
  
  // Free agent promo campaign state
  const [freeAgentPromo, setFreeAgentPromo] = useState({
    free_agent_promo_enabled: false,
    free_agent_promo_limit: 10,
    free_agent_promo_claimed: 0,
  });
  const [savingFreeAgentPromo, setSavingFreeAgentPromo] = useState(false);

  const [freeDataMissing, setFreeDataMissing] = useState(false);
  const [savingFreeData, setSavingFreeData] = useState(false);
  const [claimCount, setClaimCount] = useState(0);
  const [totalFreeDataCost, setTotalFreeDataCost] = useState(0);

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
      .select("free_data_enabled, free_data_network, free_data_package_size, free_data_max_claims, free_data_claims_count, free_agent_promo_enabled, free_agent_promo_limit, free_agent_promo_claimed")
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
      
      setFreeAgentPromo({
        free_agent_promo_enabled: Boolean((data as any).free_agent_promo_enabled),
        free_agent_promo_limit: Number((data as any).free_agent_promo_limit || 10),
        free_agent_promo_claimed: Number((data as any).free_agent_promo_claimed || 0),
      });
    }

    // Count actual claims from orders table
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("order_type" as any, "free_data_claim");
    setClaimCount(count || 0);

    const { data: sumData } = await supabase
      .from("orders")
      .select("discount_amount")
      .eq("order_type" as any, "free_data_claim");
    
    const cost = sumData ? sumData.reduce((acc, row) => acc + (Number(row.discount_amount) || 0), 0) : 0;
    setTotalFreeDataCost(cost);
  }, []);

  // Data Traffic Promo Popups state
  const [dataPromoPopups, setDataPromoPopups] = useState<any[]>([]);
  const [loadingDataPromoPopups, setLoadingDataPromoPopups] = useState(false);
  const [creatingDataPromo, setCreatingDataPromo] = useState(false);

  const [newPromoPopup, setNewPromoPopup] = useState({
    title: "⚡ Swift Data Traffic Deal!",
    description: "Get high-speed data at an unbeatable promotional price!",
    network: "MTN",
    package_size: "5GB",
    original_price: "25.00",
    promo_price: "18.00",
    badge_text: "🔥 28% OFF",
    theme_color: "amber",
    target_audience: "all",
    expires_hours: "24",
    max_claims: "100",
    per_user_limit: "1",
    send_sms: true,
    sender_id: "swiftupdate",
  });

  const fetchDataPromoPopups = useCallback(async () => {
    setLoadingDataPromoPopups(true);
    const { data, error } = await supabase
      .from("data_promo_popups")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setDataPromoPopups(data);
    }
    setLoadingDataPromoPopups(false);
  }, []);

  const handleCreateDataPromoPopup = async () => {
    if (!newPromoPopup.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }

    const origPrice = parseFloat(newPromoPopup.original_price);
    const promoPrice = parseFloat(newPromoPopup.promo_price);

    if (isNaN(promoPrice) || promoPrice <= 0) {
      toast({ title: "Invalid promo price", variant: "destructive" });
      return;
    }

    setCreatingDataPromo(true);

    let expiresAt: string | null = null;
    if (newPromoPopup.expires_hours && parseFloat(newPromoPopup.expires_hours) > 0) {
      const hours = parseFloat(newPromoPopup.expires_hours);
      expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    }

    const { error } = await supabase
      .from("data_promo_popups")
      .insert({
        title: newPromoPopup.title.trim(),
        description: newPromoPopup.description.trim() || null,
        network: newPromoPopup.network,
        package_size: newPromoPopup.package_size.trim(),
        original_price: isNaN(origPrice) ? promoPrice : origPrice,
        promo_price: promoPrice,
        badge_text: newPromoPopup.badge_text.trim() || null,
        theme_color: newPromoPopup.theme_color,
        target_audience: newPromoPopup.target_audience,
        expires_at: expiresAt,
        max_claims: parseInt(newPromoPopup.max_claims) || 0,
        per_user_limit: parseInt(newPromoPopup.per_user_limit) || 1,
        is_active: true,
      });

    if (error) {
      toast({ title: "Failed to create promo popup", description: error.message, variant: "destructive" });
    } else {
      if (currentUser) {
        await logAudit(currentUser.id, "create_data_promo_popup", { title: newPromoPopup.title, network: newPromoPopup.network, package_size: newPromoPopup.package_size, promo_price: promoPrice });
      }
      toast({ title: "Data Traffic Promo Popup created & LIVE!" });

      // Send SMS broadcast with Sender ID swiftupdate if enabled
      if (newPromoPopup.send_sms) {
        const discountPct = isNaN(origPrice) || origPrice <= promoPrice
          ? 0
          : Math.round(((origPrice - promoPrice) / origPrice) * 100);

        const smsTarget = newPromoPopup.target_audience === "agents"
          ? "agents"
          : newPromoPopup.target_audience === "customers"
          ? "users"
          : "all";

        const smsMessage = `${newPromoPopup.title.trim()}\n${newPromoPopup.description.trim() || `Special ${newPromoPopup.network} ${newPromoPopup.package_size} bundle deal!`}\nOnly GH₵ ${promoPrice.toFixed(2)}${discountPct > 0 ? ` (Save ${discountPct}%)` : ""}.\nBuy on Pop-up now: https://swiftdatagh.shop`;

        supabase.functions.invoke("admin-send-sms", {
          body: {
            target_type: smsTarget,
            message: smsMessage,
            sender_id: newPromoPopup.sender_id.trim() || "swiftupdate"
          }
        }).then(({ error: smsErr }) => {
          if (smsErr) {
            console.error("SMS Broadcast trigger error:", smsErr);
          } else {
            toast({ title: "📢 SMS Broadcast Triggered!", description: `Sender ID: ${newPromoPopup.sender_id || 'swiftupdate'}` });
          }
        }).catch(err => console.error("SMS Trigger failed:", err));
      }

      fetchDataPromoPopups();
    }
    setCreatingDataPromo(false);
  };

  const handleTriggerPromoSMS = async (promo: any) => {
    if (!confirm(`Trigger SMS announcement to users for "${promo.title}" using Sender ID: swiftupdate?`)) return;

    const promoPrice = Number(promo.promo_price) || 0;
    const smsTarget = promo.target_audience === "agents"
      ? "agents"
      : promo.target_audience === "customers"
      ? "users"
      : "all";

    const smsMessage = `${promo.title}\n${promo.description || `Special ${promo.network} ${promo.package_size} bundle deal!`}\nOnly GH₵ ${promoPrice.toFixed(2)}.\nBuy on Pop-up now: https://swiftdatagh.shop`;

    try {
      const { error } = await supabase.functions.invoke("admin-send-sms", {
        body: {
          target_type: smsTarget,
          message: smsMessage,
          sender_id: "swiftupdate"
        }
      });

      if (error) throw error;
      toast({ title: "📢 Promo SMS Broadcast Dispatched!", description: "Sender ID: swiftupdate" });
    } catch (err: any) {
      toast({ title: "Failed to dispatch SMS", description: err.message, variant: "destructive" });
    }
  };

  const handleToggleDataPromoPopup = async (id: string, current: boolean) => {
    await supabase.from("data_promo_popups").update({ is_active: !current }).eq("id", id);
    if (currentUser) {
      await logAudit(currentUser.id, "toggle_data_promo_popup", { id, is_active: !current });
    }
    fetchDataPromoPopups();
  };

  const handleDeleteDataPromoPopup = async (id: string) => {
    if (!confirm("Are you sure you want to delete this promo popup deal?")) return;
    await supabase.from("data_promo_popups").delete().eq("id", id);
    if (currentUser) {
      await logAudit(currentUser.id, "delete_data_promo_popup", { id });
    }
    fetchDataPromoPopups();
  };

  const handleResetDataPromoPopupClaims = async (id: string) => {
    if (!confirm("Reset claim counter to 0 for this promo deal?")) return;
    await supabase.from("data_promo_popups").update({ claimed_count: 0 }).eq("id", id);
    fetchDataPromoPopups();
    toast({ title: "Claim counter reset to 0!" });
  };

  useEffect(() => {
    fetchPromos();
    fetchFreeDataSettings();
    fetchDataPromoPopups();
  }, [fetchPromos, fetchFreeDataSettings, fetchDataPromoPopups]);

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
      if (currentUser) {
        await logAudit(currentUser.id, "update_free_data_settings", { enabled: freeData.free_data_enabled, network: freeData.free_data_network });
      }
      toast({ title: freeData.free_data_enabled ? "Free Data Campaign is LIVE!" : "Campaign paused" });
    }
    setSavingFreeData(false);
  };

  const handleResetFreeDataClaims = async () => {
    if (!confirm("Are you absolutely sure you want to reset the Free Data Campaign claims to 0? This will archive existing claims.")) return;
    
    setSavingFreeData(true);
    const { error } = await supabase
      .from("orders")
      .update({ order_type: "free_data_claim_archived" } as any)
      .eq("order_type" as any, "free_data_claim");

    if (error) {
      toast({ title: "Failed to reset claims", description: error.message, variant: "destructive" });
    } else {
      if (currentUser) {
        await logAudit(currentUser.id, "reset_free_data_claims", {});
      }
      setClaimCount(0);
      toast({ title: "Free Data Campaign claims reset to 0!" });
      setTotalFreeDataCost(0);
    }
    setSavingFreeData(false);
  };

  const handleSaveFreeAgentPromo = async () => {
    setSavingFreeAgentPromo(true);
    const { error } = await supabase
      .from("system_settings")
      .update({
        free_agent_promo_enabled: freeAgentPromo.free_agent_promo_enabled,
        free_agent_promo_limit: freeAgentPromo.free_agent_promo_limit,
      } as any)
      .eq("id", 1);

    if (error) {
      toast({ title: "Failed to save settings", description: error.message, variant: "destructive" });
    } else {
      if (currentUser) {
        await logAudit(currentUser.id, "update_free_agent_promo", { 
          enabled: freeAgentPromo.free_agent_promo_enabled, 
          limit: freeAgentPromo.free_agent_promo_limit 
        });
      }
      toast({ title: freeAgentPromo.free_agent_promo_enabled ? "Free Agent Promotion is LIVE!" : "Settings updated successfully" });
    }
    setSavingFreeAgentPromo(false);
  };

  const handleResetFreeAgentPromoClaims = async () => {
    if (!confirm("Are you absolutely sure you want to reset the claimed free agent promo counter to 0?")) return;
    
    setSavingFreeAgentPromo(true);
    const { error } = await supabase
      .from("system_settings")
      .update({ free_agent_promo_claimed: 0 } as any)
      .eq("id", 1);

    if (error) {
      toast({ title: "Failed to reset counter", description: error.message, variant: "destructive" });
    } else {
      setFreeAgentPromo(prev => ({ ...prev, free_agent_promo_claimed: 0 }));
      toast({ title: "Claims counter reset successfully!" });
    }
    setSavingFreeAgentPromo(false);
  };

  const handleCopy = (codeToCopy: string) => {
    navigator.clipboard.writeText(codeToCopy);
    setCopiedCode(codeToCopy);
    setTimeout(() => setCopiedCode(null), 2000);
    toast({ title: "Copied to clipboard!" });
  };

  const handleExportCSV = () => {
    if (promos.length === 0) {
      toast({ title: "No promo codes to export", variant: "destructive" });
      return;
    }
    
    const csvContent = promos.map(p => p.code).join("\n");
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `promo_codes_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDeleteAllCodes = async () => {
    if (!confirm("Are you ABSOLUTELY sure you want to delete EVERY SINGLE promo code? This cannot be undone.")) return;
    await (supabase as any).from("promo_codes").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (currentUser) {
      await logAudit(currentUser.id, "delete_all_promo_codes", {});
    }
    fetchPromos();
    toast({ title: "All promo codes deleted!" });
  };

  const handleGenerate = async () => {
    if (!code.trim()) { toast({ title: "Code/Prefix is required", variant: "destructive" }); return; }
    const pct = parseFloat(discount);
    if (isNaN(pct) || pct <= 0 || pct > 100) { toast({ title: "Invalid discount %", variant: "destructive" }); return; }
    const max = parseInt(maxUses);
    if (isNaN(max) || max < 1) { toast({ title: "Invalid max uses", variant: "destructive" }); return; }
    const count = parseInt(bulkCount);
    if (isNaN(count) || count < 1 || count > 500) { toast({ title: "Count must be between 1 and 500", variant: "destructive" }); return; }

    setGenerating(true);
    
    const codesToCreate = [];
    if (count === 1) {
      codesToCreate.push({
        code: code.trim().toUpperCase(),
        discount_percentage: pct,
        max_uses: max,
        is_active: true,
      });
    } else {
      const prefix = code.trim().toUpperCase();
      for (let i = 0; i < count; i++) {
        // Generate random 5-char alphanumeric suffix
        const suffix = Math.random().toString(36).substring(2, 7).toUpperCase();
        codesToCreate.push({
          code: `${prefix}${suffix}`,
          discount_percentage: pct,
          max_uses: max,
          is_active: true,
        });
      }
    }

    const { error } = await (supabase as any).from("promo_codes").insert(codesToCreate);

    if (error) {
      toast({ title: "Failed to create code(s)", description: error.message, variant: "destructive" });
    } else {
      if (currentUser) {
        await logAudit(currentUser.id, "generate_promo_codes", { count, prefix: count > 1 ? code : null, discount: pct });
      }
      toast({ title: `${count} Promo code(s) created!` });
      setCode(""); setDiscount("100"); setMaxUses("1"); setBulkCount("1");
      fetchPromos();
    }
    setGenerating(false);
  };

  const handleToggleActive = async (id: string, current: boolean) => {
    await (supabase as any).from("promo_codes").update({ is_active: !current }).eq("id", id);
    if (currentUser) {
      await logAudit(currentUser.id, "toggle_promo_code", { promo_id: id, active: !current });
    }
    fetchPromos();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this promo code?")) return;
    await (supabase as any).from("promo_codes").delete().eq("id", id);
    if (currentUser) {
      await logAudit(currentUser.id, "delete_promo_code", { promo_id: id });
    }
    fetchPromos();
  };

  const handleResetPromoUses = async (id: string, code: string) => {
    if (!confirm(`Are you sure you want to reset all claims for ${code}? This will set uses back to 0 and allow people who already claimed it to claim it again.`)) return;
    
    const { error } = await supabase.rpc("reset_promo_claims", { p_promo_id: id });
    if (error) {
      toast({ title: "Failed to reset claims", description: error.message, variant: "destructive" });
    } else {
      if (currentUser) {
        await logAudit(currentUser.id, "reset_promo_claims", { promo_id: id, code });
      }
      toast({ title: `Claims reset for ${code}!` });
      fetchPromos();
    }
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
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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
            <div className="rounded-xl bg-white/5 border border-white/5 p-3 text-center">
              <p className="text-xs text-white/40 mb-1">Total Cost</p>
              <p className="font-black text-xl text-red-400">GH₵{totalFreeDataCost.toFixed(2)}</p>
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
            <Button variant="ghost" size="sm" onClick={fetchFreeDataSettings} className="text-white/40 hover:text-white" title="Refresh count">
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button 
              variant="outline" 
              onClick={handleResetFreeDataClaims}
              className="border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 text-amber-400 font-bold rounded-xl h-10 gap-2 ml-auto"
            >
              <RefreshCw className="w-4 h-4" /> Reset Claims to 0
            </Button>
          </div>
        </div>
      </div>

      {/* ── Free Agent Promotion Campaign ── */}
      <div className="rounded-2xl overflow-hidden border border-white/5">
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-blue-500/10 to-cyan-500/5 border-b border-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="font-bold text-white text-lg">Free Reseller Agent Promo</h2>
                <p className="text-xs text-white/40">Offer 100% free agent activations until capacity fills up.</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {freeAgentPromo.free_agent_promo_enabled && freeAgentPromo.free_agent_promo_claimed < freeAgentPromo.free_agent_promo_limit ? (
                <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" /> LIVE
                </Badge>
              ) : freeAgentPromo.free_agent_promo_enabled ? (
                <Badge variant="outline" className="text-amber-400 border-amber-400/20 bg-amber-400/5">FULL</Badge>
              ) : (
                <Badge variant="outline" className="text-white/40 border-white/10">OFF</Badge>
              )}
              <Switch
                checked={freeAgentPromo.free_agent_promo_enabled}
                onCheckedChange={(v) => setFreeAgentPromo(prev => ({ ...prev, free_agent_promo_enabled: v }))}
                className="data-[state=checked]:bg-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="p-6 bg-white/[0.01] space-y-5">
          {/* Stats row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-white/5 border border-white/5 p-4 text-center">
              <p className="text-xs text-white/40 mb-1">Successfully Claimed</p>
              <p className="font-black text-2xl text-blue-400">{freeAgentPromo.free_agent_promo_claimed}</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/5 p-4 text-center">
              <p className="text-xs text-white/40 mb-1">Available Capacity</p>
              <p className="font-black text-2xl text-white">{freeAgentPromo.free_agent_promo_limit}</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/5 p-4 text-center">
              <p className="text-xs text-white/40 mb-1">Spots Left</p>
              <p className={`font-black text-2xl ${Math.max(0, freeAgentPromo.free_agent_promo_limit - freeAgentPromo.free_agent_promo_claimed) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {Math.max(0, freeAgentPromo.free_agent_promo_limit - freeAgentPromo.free_agent_promo_claimed)}
              </p>
            </div>
          </div>

          {/* Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div>
              <Label className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2 block">Set Free Spots Capacity (e.g., 10)</Label>
              <Input
                type="number"
                min={1}
                value={freeAgentPromo.free_agent_promo_limit}
                onChange={(e) => setFreeAgentPromo(prev => ({ ...prev, free_agent_promo_limit: Math.max(1, parseInt(e.target.value) || 1) }))}
                className="bg-white/5 border-white/10 text-white rounded-xl focus:border-blue-400/40 h-11"
              />
            </div>
            <div>
              <Button 
                variant="outline" 
                onClick={handleResetFreeAgentPromoClaims}
                className="w-full border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-400 font-bold rounded-xl h-11 gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Reset Claim Counter back to 0
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSaveFreeAgentPromo}
              disabled={savingFreeAgentPromo || freeDataMissing}
              className={`font-bold rounded-xl px-6 ${freeAgentPromo.free_agent_promo_enabled ? "bg-blue-500 hover:bg-blue-400 text-white" : "bg-white/10 hover:bg-white/20 text-white"}`}
            >
              {savingFreeAgentPromo ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : freeAgentPromo.free_agent_promo_enabled ? <ToggleRight className="w-4 h-4 mr-2" /> : <ToggleLeft className="w-4 h-4 mr-2" />}
              {freeAgentPromo.free_agent_promo_enabled ? "Save Campaign Changes" : "Save (Campaign is OFF)"}
            </Button>
            <Button variant="ghost" size="sm" onClick={fetchFreeDataSettings} className="text-white/40 hover:text-white">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Data Traffic Promo Popups ── */}
      <div className="rounded-2xl overflow-hidden border border-amber-500/20 bg-gradient-to-b from-amber-500/5 to-transparent">
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-transparent border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <Flame className="w-5 h-5 text-amber-400 animate-pulse" />
            </div>
            <div>
              <h2 className="font-bold text-white text-lg flex items-center gap-2">
                Data Traffic Promo Popups <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">NEW</Badge>
              </h2>
              <p className="text-xs text-white/50">Create interactive promo pop-up deals where users can purchase data directly inside the modal.</p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={fetchDataPromoPopups} className="text-white/40 hover:text-white">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Create Form */}
            <div className="lg:col-span-2 rounded-2xl bg-white/[0.02] border border-white/5 p-5 space-y-4">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Plus className="w-4 h-4 text-amber-400" /> Create New Promo Deal Popup
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-white/60 mb-1.5 block">Headline / Title</Label>
                  <Input
                    placeholder="e.g. ⚡ Flash Weekend Data Deal!"
                    value={newPromoPopup.title}
                    onChange={(e) => setNewPromoPopup(prev => ({ ...prev, title: e.target.value }))}
                    className="bg-white/5 border-white/10 text-white rounded-xl text-sm"
                  />
                </div>

                <div>
                  <Label className="text-xs text-white/60 mb-1.5 block">Subtitle / Description</Label>
                  <Input
                    placeholder="e.g. Get 5GB High-Speed MTN Data for only GH₵ 18.00!"
                    value={newPromoPopup.description}
                    onChange={(e) => setNewPromoPopup(prev => ({ ...prev, description: e.target.value }))}
                    className="bg-white/5 border-white/10 text-white rounded-xl text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <Label className="text-xs text-white/60 mb-1.5 block">Network</Label>
                  <select
                    value={newPromoPopup.network}
                    onChange={(e) => setNewPromoPopup(prev => ({ ...prev, network: e.target.value }))}
                    className="w-full bg-black/40 border border-white/10 text-white rounded-xl h-10 px-3 text-xs font-bold"
                  >
                    <option value="MTN">MTN</option>
                    <option value="Telecel">Telecel</option>
                    <option value="AirtelTigo">AirtelTigo</option>
                    <option value="MTN Mash Up">MTN Mash Up</option>
                  </select>
                </div>

                <div>
                  <Label className="text-xs text-white/60 mb-1.5 block">Package Size</Label>
                  <Input
                    placeholder="e.g. 5GB"
                    value={newPromoPopup.package_size}
                    onChange={(e) => setNewPromoPopup(prev => ({ ...prev, package_size: e.target.value }))}
                    className="bg-white/5 border-white/10 text-white rounded-xl text-xs font-bold"
                  />
                </div>

                <div>
                  <Label className="text-xs text-white/60 mb-1.5 block">Regular Price (GH₵)</Label>
                  <Input
                    type="number"
                    placeholder="25.00"
                    value={newPromoPopup.original_price}
                    onChange={(e) => setNewPromoPopup(prev => ({ ...prev, original_price: e.target.value }))}
                    className="bg-white/5 border-white/10 text-white rounded-xl text-xs"
                  />
                </div>

                <div>
                  <Label className="text-xs text-white/60 mb-1.5 block">Promo Price (GH₵)</Label>
                  <Input
                    type="number"
                    placeholder="18.00"
                    value={newPromoPopup.promo_price}
                    onChange={(e) => setNewPromoPopup(prev => ({ ...prev, promo_price: e.target.value }))}
                    className="bg-white/5 border-white/10 rounded-xl text-xs font-bold text-amber-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <Label className="text-xs text-white/60 mb-1.5 block">Badge Tag</Label>
                  <Input
                    placeholder="e.g. 🔥 28% OFF"
                    value={newPromoPopup.badge_text}
                    onChange={(e) => setNewPromoPopup(prev => ({ ...prev, badge_text: e.target.value }))}
                    className="bg-white/5 border-white/10 text-white rounded-xl text-xs"
                  />
                </div>

                <div>
                  <Label className="text-xs text-white/60 mb-1.5 block">Expiry (Hours from now)</Label>
                  <Input
                    type="number"
                    placeholder="24"
                    value={newPromoPopup.expires_hours}
                    onChange={(e) => setNewPromoPopup(prev => ({ ...prev, expires_hours: e.target.value }))}
                    className="bg-white/5 border-white/10 text-white rounded-xl text-xs"
                  />
                </div>

                <div>
                  <Label className="text-xs text-white/60 mb-1.5 block">Max Claims (0 = Unlimited)</Label>
                  <Input
                    type="number"
                    placeholder="100"
                    value={newPromoPopup.max_claims}
                    onChange={(e) => setNewPromoPopup(prev => ({ ...prev, max_claims: e.target.value }))}
                    className="bg-white/5 border-white/10 text-white rounded-xl text-xs"
                  />
                </div>

                <div>
                  <Label className="text-xs text-white/60 mb-1.5 block">Target Audience</Label>
                  <select
                    value={newPromoPopup.target_audience}
                    onChange={(e) => setNewPromoPopup(prev => ({ ...prev, target_audience: e.target.value }))}
                    className="w-full bg-black/40 border border-white/10 text-white rounded-xl h-10 px-3 text-xs"
                  >
                    <option value="all">All Users</option>
                    <option value="agents">Reseller Agents Only</option>
                    <option value="customers">Direct Buyers Only</option>
                  </select>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5" /> Trigger SMS Broadcast on Publish
                    </p>
                    <p className="text-[10px] text-white/50">Sends SMS announcement to target users</p>
                  </div>
                  <Switch
                    checked={newPromoPopup.send_sms}
                    onCheckedChange={(v) => setNewPromoPopup(prev => ({ ...prev, send_sms: v }))}
                    className="data-[state=checked]:bg-amber-400"
                  />
                </div>

                {newPromoPopup.send_sms && (
                  <div>
                    <Label className="text-[10px] text-white/60 mb-1 block">Sender ID</Label>
                    <Input
                      placeholder="swiftupdate"
                      value={newPromoPopup.sender_id}
                      onChange={(e) => setNewPromoPopup(prev => ({ ...prev, sender_id: e.target.value }))}
                      className="bg-white/5 border-amber-500/30 text-amber-400 rounded-xl text-xs font-mono font-bold h-9"
                    />
                  </div>
                )}
              </div>

              <Button
                onClick={handleCreateDataPromoPopup}
                disabled={creatingDataPromo}
                className="w-full bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-300 hover:to-orange-300 text-black font-black rounded-xl h-11 text-sm uppercase tracking-wider shadow-lg shadow-amber-500/20"
              >
                {creatingDataPromo ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Flame className="w-4 h-4 mr-2" />}
                Launch Promo Popup Deal LIVE & Send SMS
              </Button>
            </div>

            {/* Live Card Preview */}
            <div className="rounded-2xl bg-black/40 border border-amber-500/30 p-5 relative overflow-hidden flex flex-col justify-between">
              <div className="absolute top-0 right-0 w-40 h-40 bg-amber-400/10 rounded-full blur-2xl pointer-events-none" />
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs px-2.5 py-0.5">
                    {newPromoPopup.network}
                  </Badge>
                  <span className="text-[10px] text-amber-400 font-mono font-bold flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {newPromoPopup.expires_hours ? `${newPromoPopup.expires_hours}h left` : "No Expiry"}
                  </span>
                </div>

                <h4 className="font-black text-white text-lg leading-tight mb-1">{newPromoPopup.title || "Flash Data Deal"}</h4>
                <p className="text-xs text-white/60 mb-4">{newPromoPopup.description || "Special package promotion"}</p>

                <div className="bg-white/5 rounded-xl p-3 border border-white/10 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-white/40 uppercase font-black">Deal Bundle</p>
                    <p className="text-xl font-black text-white">{newPromoPopup.package_size || "5GB"}</p>
                  </div>
                  <div className="text-right">
                    {parseFloat(newPromoPopup.original_price) > parseFloat(newPromoPopup.promo_price) && (
                      <p className="text-[10px] line-through text-white/40">GH₵ {parseFloat(newPromoPopup.original_price).toFixed(2)}</p>
                    )}
                    <p className="text-xl font-black text-amber-400">GH₵ {parseFloat(newPromoPopup.promo_price || "0").toFixed(2)}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-white/5 text-center">
                <p className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Pop-up Direct 1-Click Purchase Active</p>
              </div>
            </div>
          </div>

          {/* Active Promo Popups List */}
          <div className="space-y-3">
            <h3 className="font-bold text-white text-sm flex items-center gap-2">
              <Eye className="w-4 h-4 text-amber-400" /> Existing Promo Popups ({dataPromoPopups.length})
            </h3>

            {loadingDataPromoPopups ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-white/30" /></div>
            ) : dataPromoPopups.length === 0 ? (
              <p className="text-xs text-white/40 text-center py-6 border border-dashed border-white/10 rounded-xl">No active promo popups created yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {dataPromoPopups.map((p) => (
                  <div key={p.id} className="p-4 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-white text-sm">{p.title}</span>
                        <Badge className={p.is_active ? "bg-green-500/20 text-green-400 text-[10px]" : "bg-white/10 text-white/40 text-[10px]"}>
                          {p.is_active ? "LIVE" : "PAUSED"}
                        </Badge>
                      </div>
                      <p className="text-xs text-white/50">
                        {p.network} {p.package_size} @ <span className="text-amber-400 font-bold">GH₵ {Number(p.promo_price).toFixed(2)}</span>
                      </p>
                      <p className="text-[10px] text-white/40 mt-1">
                        Claims: {p.claimed_count} {p.max_claims > 0 ? `/ ${p.max_claims}` : "(Unlimited)"}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTriggerPromoSMS(p)}
                        className="text-xs border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded-xl h-8 gap-1 font-bold"
                        title="Send SMS announcement using Sender ID swiftupdate"
                      >
                        <Send className="w-3.5 h-3.5" /> SMS (swiftupdate)
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleDataPromoPopup(p.id, p.is_active)}
                        className="text-xs border-white/10 text-white/60 hover:text-white rounded-xl h-8"
                      >
                        {p.is_active ? "Pause" : "Enable"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleResetDataPromoPopupClaims(p.id)}
                        className="text-amber-400 hover:text-amber-300 h-8"
                        title="Reset claims counter to 0"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteDataPromoPopup(p.id)}
                        className="text-red-400 hover:text-red-300 h-8"
                      >
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
                <div className="p-4 border-b border-white/5 bg-white/[0.01] flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-white">Active Codes</h3>
                    <p className="text-xs text-white/40 mt-0.5">Click a code to disable or delete it.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={promos.length === 0} className="text-xs border-white/10 text-white/60 hover:text-white rounded-xl">
                      <Download className="w-4 h-4 mr-2" /> Export CSV
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleDeleteAllCodes} disabled={promos.length === 0} className="text-xs border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-xl">
                      <Trash2 className="w-4 h-4 mr-2" /> Delete All
                    </Button>
                  </div>
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
                              <button onClick={() => handleCopy(promo.code)} className="text-white/30 hover:text-amber-400 transition-colors p-1" title="Copy Code">
                                {copiedCode === promo.code ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                              </button>
                              <Badge variant={!promo.is_active || promo.current_uses >= promo.max_uses ? "secondary" : "default"}
                                className={
                                  !promo.is_active ? "text-[10px] text-white/30 bg-white/5" 
                                  : promo.current_uses >= promo.max_uses ? "bg-red-500/20 text-red-400 text-[10px]"
                                  : "bg-green-500/20 text-green-400 text-[10px]"
                                }>
                                {!promo.is_active ? "Disabled" : promo.current_uses >= promo.max_uses ? "Fully Used" : "Active"}
                              </Badge>
                            </div>
                            <p className="text-xs text-white/40">
                              {promo.discount_percentage}% off · {promo.current_uses}/{promo.max_uses} used {promo.max_uses === 1 && "(Single Use)"}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline"
                              onClick={() => handleToggleActive(promo.id, promo.is_active)}
                              className="text-xs border-white/10 text-white/60 hover:text-white rounded-xl">
                              {promo.is_active ? "Disable" : "Enable"}
                            </Button>
                            <Button size="sm" variant="outline"
                              onClick={() => handleResetPromoUses(promo.id, promo.code)}
                              className="text-xs border-amber-500/20 bg-amber-500/5 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded-xl"
                              title="Reset all claims and uses to 0">
                              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Reset
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
                  <div className="flex justify-between items-center mb-1.5">
                    <Label className="text-xs text-white/50 block">Code (or Prefix)</Label>
                    <button 
                      onClick={() => setCode(Math.random().toString(36).substring(2, 10).toUpperCase())}
                      className="text-[10px] text-amber-400 hover:text-amber-300 font-bold bg-amber-400/10 px-2 py-0.5 rounded flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> Regenerate Random
                    </button>
                  </div>
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
                <div>
                  <Label className="text-xs text-white/50 mb-1.5 block">How Many Codes?</Label>
                  <Input type="number" placeholder="1" className="bg-white/5 border-white/10 text-white rounded-xl focus:border-amber-400/40"
                    value={bulkCount} onChange={(e) => setBulkCount(e.target.value)} min="1" max="500" />
                  <p className="text-[10px] text-white/30 mt-1">If &gt; 1, the Code above becomes a prefix.</p>
                </div>
                <Button className="w-full bg-amber-400 text-black font-bold hover:bg-amber-300 rounded-xl" onClick={handleGenerate} disabled={generating || !code}>
                  {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                  Generate Code{parseInt(bulkCount) > 1 ? "s" : ""}
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
