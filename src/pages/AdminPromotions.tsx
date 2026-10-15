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
  Download, Copy, CheckCircle, Flame, Sparkles, Clock, Eye, Smartphone, Send,
  Search, Check, Phone, Layers, Percent, Tag, ArrowUpRight, ShieldCheck, DollarSign,
  TrendingDown, Info
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog";
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

  // Global packages & smart picker state
  const [globalPackages, setGlobalPackages] = useState<any[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [packageSearch, setPackageSearch] = useState("");
  const [customPackageMode, setCustomPackageMode] = useState(false);
  const [selectedDiscountPercent, setSelectedDiscountPercent] = useState<number | null>(20);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  const [newPromoPopup, setNewPromoPopup] = useState({
    title: "⚡ Flash MTN Mash Up Deal!",
    description: "Get 4.5gb + 1800 Mins Voice & Data Combo at a huge promotional discount!",
    network: "MTN Mash Up",
    package_size: "4.5gb + 1800 Mins",
    original_price: "35.00",
    promo_price: "28.00",
    badge_text: "🔥 20% OFF",
    theme_color: "amber",
    target_audience: "all",
    expires_hours: "24",
    max_claims: "100",
    per_user_limit: "1",
    send_sms: true,
    sender_id: "swiftupdate",
  });

  const fetchGlobalPackages = useCallback(async () => {
    setLoadingPackages(true);
    const { data, error } = await supabase
      .from("global_package_settings")
      .select("id, network, package_size, public_price, agent_price, cost_price, is_unavailable")
      .order("agent_price", { ascending: true });

    if (!error && data) {
      setGlobalPackages(data);
    }
    setLoadingPackages(false);
  }, []);

  const handleNetworkSelect = (net: string) => {
    const available = globalPackages.filter(p => p.network === net);
    const defaultPkg = available.find(p => !p.is_unavailable) || available[0];
    const origPrice = defaultPkg ? Number(defaultPkg.public_price || defaultPkg.agent_price || 0) : 25;
    const discount = selectedDiscountPercent || 20;
    const promo = origPrice > 0 ? Math.max(1, Math.round(origPrice * (1 - discount / 100) * 100) / 100) : 18;
    const isMashup = net === "MTN Mash Up";

    setNewPromoPopup(prev => ({
      ...prev,
      network: net,
      package_size: defaultPkg ? defaultPkg.package_size : (isMashup ? "4.5gb + 1800 Mins" : "5GB"),
      original_price: origPrice.toFixed(2),
      promo_price: promo.toFixed(2),
      badge_text: `🔥 ${discount}% OFF`,
      title: isMashup ? "⚡ Flash MTN Mash Up Deal!" : `⚡ Flash ${net} Data Deal!`,
      description: isMashup
        ? `Get ${defaultPkg?.package_size || "4.5gb + 1800 Mins"} Voice & Data Combo for only GH₵ ${promo.toFixed(2)}!`
        : `Get high-speed ${net} ${defaultPkg?.package_size || "5GB"} data for only GH₵ ${promo.toFixed(2)}!`
    }));
  };

  const handlePackageSelect = (pkg: any) => {
    const origPrice = Number(pkg.public_price || pkg.agent_price || 0);
    const discount = selectedDiscountPercent || 20;
    const promo = origPrice > 0 ? Math.max(1, Math.round(origPrice * (1 - discount / 100) * 100) / 100) : 18;
    const isMashup = newPromoPopup.network === "MTN Mash Up";

    setNewPromoPopup(prev => ({
      ...prev,
      package_size: pkg.package_size,
      original_price: origPrice.toFixed(2),
      promo_price: promo.toFixed(2),
      badge_text: `🔥 ${discount}% OFF`,
      title: isMashup ? "⚡ Flash MTN Mash Up Deal!" : `⚡ Flash ${newPromoPopup.network} Data Deal!`,
      description: isMashup
        ? `Get ${pkg.package_size} Voice & Data Combo for only GH₵ ${promo.toFixed(2)}!`
        : `Get ${pkg.package_size} high-speed data for only GH₵ ${promo.toFixed(2)}!`
    }));
  };

  const handleDiscountSelect = (pct: number) => {
    setSelectedDiscountPercent(pct);
    const orig = parseFloat(newPromoPopup.original_price) || 0;
    if (orig > 0) {
      const promo = Math.max(1, Math.round(orig * (1 - pct / 100) * 100) / 100);
      const isMashup = newPromoPopup.network === "MTN Mash Up";
      setNewPromoPopup(prev => ({
        ...prev,
        promo_price: promo.toFixed(2),
        badge_text: `🔥 ${pct}% OFF`,
        description: isMashup
          ? `Get ${prev.package_size} Voice & Data Combo for only GH₵ ${promo.toFixed(2)}!`
          : `Get ${prev.package_size} high-speed data for only GH₵ ${promo.toFixed(2)}!`
      }));
    }
  };

  const parsePackageDetails = (name: string, network: string) => {
    const raw = String(name || "").trim();
    const isMashup = network === "MTN Mash Up" || raw.toLowerCase().includes("mash") || raw.toLowerCase().includes("mins");
    
    if (isMashup) {
      if (raw.includes("+")) {
        const parts = raw.split("+");
        const dataStr = parts[0]?.trim() || "";
        const minsStr = parts[1]?.replace(/mins/i, "").trim() || "";
        return {
          isCombo: true,
          dataLabel: dataStr.toUpperCase(),
          minutesLabel: `${minsStr} Mins Voice`,
          subText: "Voice + Data Combo",
          badgeColor: "bg-purple-500/20 text-purple-300 border-purple-500/30"
        };
      }
      if (raw.toLowerCase().includes("only")) {
        return {
          isCombo: false,
          dataLabel: raw.replace(/only/i, "").trim().toUpperCase(),
          minutesLabel: null,
          subText: "Pure Data",
          badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/30"
        };
      }
    }
    return {
      isCombo: false,
      dataLabel: raw,
      minutesLabel: null,
      subText: "High-Speed Data",
      badgeColor: "bg-blue-500/20 text-blue-300 border-blue-500/30"
    };
  };

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
    fetchGlobalPackages();
  }, [fetchPromos, fetchFreeDataSettings, fetchDataPromoPopups, fetchGlobalPackages]);

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
      <div className="rounded-2xl overflow-hidden border border-amber-500/20 bg-gradient-to-b from-amber-500/5 via-black/40 to-transparent shadow-2xl">
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent border-b border-white/5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 p-0.5 shadow-lg shadow-amber-500/20">
              <div className="w-full h-full bg-black/60 rounded-[14px] flex items-center justify-center">
                <Flame className="w-6 h-6 text-amber-400 animate-pulse" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-black text-white text-xl tracking-tight">
                  Data Traffic Promo Studio
                </h2>
                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px] font-bold px-2 py-0.5">
                  LIVE PACKAGES SYNCED
                </Badge>
              </div>
              <p className="text-xs text-white/60 mt-0.5">
                Select real data & voice mashup packages directly from the catalog. Configured deals appear as interactive 1-click buy popups.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                fetchGlobalPackages();
                fetchDataPromoPopups();
                toast({ title: "Packages & Promo deals refreshed from database" });
              }}
              className="border-white/10 text-white/70 hover:text-white bg-white/5 rounded-xl text-xs gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh Packages ({globalPackages.length})
            </Button>
          </div>
        </div>

        <div className="p-6 space-y-8">
          {/* Main 2-Column Studio: Left = Builder, Right = Live Preview */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            {/* Left: Package Picker & Campaign Form (7 Cols on XL) */}
            <div className="xl:col-span-7 rounded-2xl bg-white/[0.02] border border-white/5 p-6 space-y-6">
              {/* Step 1: Select Network */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-xs font-bold text-white/80 uppercase tracking-wider flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px]">1</span>
                    Select Network / Product
                  </Label>
                  <span className="text-[11px] text-white/40">
                    {globalPackages.filter(p => p.network === newPromoPopup.network).length} packages available
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    { id: "MTN Mash Up", label: "MTN Mash Up", sub: "Voice + Data", icon: Flame, color: "text-amber-400" },
                    { id: "MTN", label: "MTN Data", sub: "Pure Data", icon: Zap, color: "text-yellow-400" },
                    { id: "Telecel", label: "Telecel", sub: "Data Bundle", icon: Smartphone, color: "text-red-400" },
                    { id: "AirtelTigo", label: "AirtelTigo", sub: "AT Big Time", icon: Wifi, color: "text-blue-400" },
                  ].map((net) => {
                    const isSelected = newPromoPopup.network === net.id;
                    const pkgCount = globalPackages.filter(p => p.network === net.id).length;
                    const NetIcon = net.icon;
                    return (
                      <button
                        key={net.id}
                        type="button"
                        onClick={() => handleNetworkSelect(net.id)}
                        className={`p-3 rounded-xl border text-left transition-all relative overflow-hidden flex flex-col justify-between ${
                          isSelected
                            ? "bg-amber-500/15 border-amber-500/60 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/50"
                            : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isSelected ? "bg-amber-500/30" : "bg-white/5"}`}>
                            <NetIcon className={`w-4 h-4 ${isSelected ? "text-amber-300" : net.color}`} />
                          </div>
                          {isSelected && (
                            <Badge className="bg-amber-400 text-black text-[9px] font-black px-1.5 py-0 h-4">
                              ACTIVE
                            </Badge>
                          )}
                        </div>
                        <div>
                          <p className="font-bold text-white text-xs leading-tight">{net.label}</p>
                          <p className="text-[10px] text-white/50 mt-0.5">{pkgCount} packages</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Choose Live Package from Catalog */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-xs font-bold text-white/80 uppercase tracking-wider flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px]">2</span>
                    Pick Package from {newPromoPopup.network} Catalog
                  </Label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCustomPackageMode(!customPackageMode)}
                      className="text-[11px] text-amber-400/90 hover:text-amber-300 underline font-medium"
                    >
                      {customPackageMode ? "← Choose from Catalog" : "Enter Custom Size"}
                    </button>
                  </div>
                </div>

                {customPackageMode ? (
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
                    <p className="text-xs text-white/60">
                      Specify custom package text manually (e.g. <code className="text-amber-300">4.5gb + 1800 Mins</code> or <code className="text-amber-300">10GB</code>):
                    </p>
                    <Input
                      placeholder="e.g. 4.5gb + 1800 Mins"
                      value={newPromoPopup.package_size}
                      onChange={(e) => setNewPromoPopup(prev => ({ ...prev, package_size: e.target.value }))}
                      className="bg-black/40 border-white/10 text-white font-bold rounded-xl"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Search Bar for packages */}
                    <div className="relative">
                      <Search className="w-4 h-4 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
                      <Input
                        placeholder={`Search ${newPromoPopup.network} packages (e.g. 4.5gb, 1800 Mins, 10gb)...`}
                        value={packageSearch}
                        onChange={(e) => setPackageSearch(e.target.value)}
                        className="bg-black/40 border-white/10 pl-9 text-xs text-white rounded-xl placeholder:text-white/30 h-9"
                      />
                      {packageSearch && (
                        <button
                          type="button"
                          onClick={() => setPackageSearch("")}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/40 hover:text-white"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {/* Packages Grid */}
                    {loadingPackages ? (
                      <div className="flex items-center justify-center py-10 bg-black/20 rounded-xl border border-white/5">
                        <Loader2 className="w-5 h-5 animate-spin text-amber-400 mr-2" />
                        <span className="text-xs text-white/60">Loading live packages...</span>
                      </div>
                    ) : (
                      (() => {
                        const networkPkgs = globalPackages.filter(p => p.network === newPromoPopup.network);
                        const filtered = networkPkgs.filter(p =>
                          !packageSearch || p.package_size.toLowerCase().includes(packageSearch.toLowerCase())
                        );

                        if (filtered.length === 0) {
                          return (
                            <div className="py-8 px-4 text-center rounded-xl bg-white/5 border border-dashed border-white/10">
                              <p className="text-xs text-white/50 mb-2">No packages match "{packageSearch}".</p>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setPackageSearch("")}
                                className="text-xs border-white/10 text-white/70"
                              >
                                View All {networkPkgs.length} Packages
                              </Button>
                            </div>
                          );
                        }

                        return (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-[300px] overflow-y-auto pr-1">
                            {filtered.map((pkg) => {
                              const details = parsePackageDetails(pkg.package_size, newPromoPopup.network);
                              const isSelected = newPromoPopup.package_size === pkg.package_size;
                              const origPrice = Number(pkg.public_price || pkg.agent_price || 0);
                              const costPrice = Number(pkg.cost_price || 0);

                              return (
                                <button
                                  key={pkg.id}
                                  type="button"
                                  onClick={() => handlePackageSelect(pkg)}
                                  className={`p-3 rounded-xl border text-left transition-all relative flex flex-col justify-between group ${
                                    isSelected
                                      ? "bg-gradient-to-br from-amber-500/20 to-orange-500/10 border-amber-400/80 shadow-md shadow-amber-500/10 ring-1 ring-amber-400/60"
                                      : "bg-white/[0.03] border-white/10 hover:bg-white/[0.08] hover:border-white/20"
                                  }`}
                                >
                                  <div>
                                    <div className="flex items-start justify-between gap-1.5 mb-1.5">
                                      <span className="font-black text-white text-sm tracking-tight group-hover:text-amber-300 transition-colors">
                                        {details.dataLabel}
                                      </span>
                                      {isSelected ? (
                                        <div className="w-5 h-5 rounded-full bg-amber-400 text-black flex items-center justify-center shrink-0">
                                          <Check className="w-3 h-3 stroke-[3]" />
                                        </div>
                                      ) : (
                                        <div className="w-5 h-5 rounded-full bg-white/5 border border-white/10 shrink-0 group-hover:border-white/30" />
                                      )}
                                    </div>

                                    {details.minutesLabel ? (
                                      <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[10px] font-bold mb-2">
                                        <Phone className="w-2.5 h-2.5" />
                                        <span>{details.minutesLabel}</span>
                                      </div>
                                    ) : (
                                      <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/5 text-white/50 text-[10px] mb-2">
                                        <span>{details.subText}</span>
                                      </div>
                                    )}
                                  </div>

                                  <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px]">
                                    <div>
                                      <span className="text-white/40 block text-[9px] uppercase font-bold">Standard</span>
                                      <span className="font-black text-white">GH₵ {origPrice.toFixed(2)}</span>
                                    </div>
                                    {costPrice > 0 && (
                                      <div className="text-right">
                                        <span className="text-white/40 block text-[9px] uppercase font-bold">Cost</span>
                                        <span className="text-white/60 font-mono">GH₵ {costPrice.toFixed(2)}</span>
                                      </div>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()
                    )}
                  </div>
                )}
              </div>

              {/* Step 3: Smart Pricing Studio & Discount Presets */}
              <div className="p-4 rounded-2xl bg-black/30 border border-white/5 space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-white/80 uppercase tracking-wider flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px]">3</span>
                    Pricing & Discount Studio
                  </Label>
                  <span className="text-[11px] text-amber-400 font-bold">
                    Target: {newPromoPopup.package_size}
                  </span>
                </div>

                {/* Quick Discount Presets */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-white/50">Quick Discount Presets:</span>
                    {selectedDiscountPercent && (
                      <span className="text-[11px] text-amber-300 font-bold">
                        Applied: {selectedDiscountPercent}% OFF
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {[10, 15, 20, 25, 30, 40].map((pct) => {
                      const isActive = selectedDiscountPercent === pct;
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => handleDiscountSelect(pct)}
                          className={`py-1.5 px-2 rounded-lg text-xs font-black transition-all ${
                            isActive
                              ? "bg-gradient-to-r from-amber-400 to-orange-400 text-black shadow-md shadow-amber-500/20 scale-[1.02]"
                              : "bg-white/5 hover:bg-white/10 text-white/80 border border-white/10"
                          }`}
                        >
                          {pct}% OFF
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Price Input Fields */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-[11px] text-white/60 mb-1 block">Regular Catalog Price (GH₵)</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-white/40">GH₵</span>
                      <Input
                        type="number"
                        step="0.5"
                        placeholder="25.00"
                        value={newPromoPopup.original_price}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewPromoPopup(prev => ({ ...prev, original_price: val }));
                          setSelectedDiscountPercent(null);
                        }}
                        className="bg-black/40 border-white/10 text-white rounded-xl text-xs pl-11 font-mono font-bold"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-[11px] text-amber-400 font-bold mb-1 block">Promo Deal Price (GH₵) *</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-amber-400 font-bold">GH₵</span>
                      <Input
                        type="number"
                        step="0.5"
                        placeholder="18.00"
                        value={newPromoPopup.promo_price}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewPromoPopup(prev => ({ ...prev, promo_price: val }));
                          setSelectedDiscountPercent(null);
                        }}
                        className="bg-amber-500/10 border-amber-500/40 text-amber-300 rounded-xl text-xs pl-11 font-mono font-black"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-[11px] text-white/60 mb-1 block">Badge Tag Text</Label>
                    <Input
                      placeholder="e.g. 🔥 20% OFF"
                      value={newPromoPopup.badge_text}
                      onChange={(e) => setNewPromoPopup(prev => ({ ...prev, badge_text: e.target.value }))}
                      className="bg-black/40 border-white/10 text-white rounded-xl text-xs font-bold"
                    />
                  </div>
                </div>

                {/* Profit Margin & Safety Intelligence Callout */}
                {(() => {
                  const selPkg = globalPackages.find(
                    p => p.network === newPromoPopup.network && p.package_size === newPromoPopup.package_size
                  );
                  const cost = selPkg ? Number(selPkg.cost_price || 0) : 0;
                  const promo = parseFloat(newPromoPopup.promo_price) || 0;
                  const orig = parseFloat(newPromoPopup.original_price) || 0;
                  const margin = promo - cost;
                  const isLoss = cost > 0 && promo < cost;
                  const discountPct = orig > 0 && promo < orig ? Math.round(((orig - promo) / orig) * 100) : 0;

                  return (
                    <div className={`p-3 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-3 ${
                      isLoss
                        ? "bg-red-500/10 border-red-500/30 text-red-300"
                        : cost > 0
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                        : "bg-white/5 border-white/10 text-white/60"
                    }`}>
                      <div className="flex items-center gap-2">
                        {isLoss ? (
                          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                        ) : (
                          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                        )}
                        <div>
                          {isLoss ? (
                            <span>
                              <strong>Warning:</strong> Promo price is below provider cost (GH₵ {cost.toFixed(2)}). Loss of <strong>-GH₵ {Math.abs(margin).toFixed(2)}</strong> per order!
                            </span>
                          ) : cost > 0 ? (
                            <span>
                              <strong>Healthy Margin:</strong> Cost GH₵ {cost.toFixed(2)} &bull; Net Profit: <strong>+GH₵ {margin.toFixed(2)}</strong> per order ({Math.round((margin / (promo || 1)) * 100)}% margin)
                            </span>
                          ) : (
                            <span>Set your promo price to offer a deal that drives conversions while preserving margin.</span>
                          )}
                        </div>
                      </div>

                      {discountPct > 0 && (
                        <Badge className="bg-amber-400/20 text-amber-300 border-amber-400/30 text-[10px] font-bold">
                          {discountPct}% Customer Discount
                        </Badge>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Step 4: Headline, Description & Audience */}
              <div className="space-y-4">
                <Label className="text-xs font-bold text-white/80 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px]">4</span>
                  Promo Copy & Audience Settings
                </Label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-white/60 mb-1.5 block">Headline / Modal Title</Label>
                    <Input
                      placeholder="e.g. ⚡ Flash MTN Mash Up Deal!"
                      value={newPromoPopup.title}
                      onChange={(e) => setNewPromoPopup(prev => ({ ...prev, title: e.target.value }))}
                      className="bg-white/5 border-white/10 text-white rounded-xl text-xs font-bold"
                    />
                  </div>

                  <div>
                    <Label className="text-xs text-white/60 mb-1.5 block">Subtitle / Promotional Description</Label>
                    <Input
                      placeholder="e.g. Get 4.5gb + 1800 Mins Voice & Data Combo at a huge discount!"
                      value={newPromoPopup.description}
                      onChange={(e) => setNewPromoPopup(prev => ({ ...prev, description: e.target.value }))}
                      className="bg-white/5 border-white/10 text-white rounded-xl text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-[11px] text-white/60 mb-1 block">Expiry (Hours from now)</Label>
                    <Input
                      type="number"
                      placeholder="24"
                      value={newPromoPopup.expires_hours}
                      onChange={(e) => setNewPromoPopup(prev => ({ ...prev, expires_hours: e.target.value }))}
                      className="bg-white/5 border-white/10 text-white rounded-xl text-xs"
                    />
                  </div>

                  <div>
                    <Label className="text-[11px] text-white/60 mb-1 block">Max Claims (0 = Unlimited)</Label>
                    <Input
                      type="number"
                      placeholder="100"
                      value={newPromoPopup.max_claims}
                      onChange={(e) => setNewPromoPopup(prev => ({ ...prev, max_claims: e.target.value }))}
                      className="bg-white/5 border-white/10 text-white rounded-xl text-xs"
                    />
                  </div>

                  <div>
                    <Label className="text-[11px] text-white/60 mb-1 block">Target Audience</Label>
                    <select
                      value={newPromoPopup.target_audience}
                      onChange={(e) => setNewPromoPopup(prev => ({ ...prev, target_audience: e.target.value }))}
                      className="w-full bg-black/40 border border-white/10 text-white rounded-xl h-10 px-3 text-xs"
                    >
                      <option value="all">All Users (Public + Agents)</option>
                      <option value="agents">Reseller Agents Only</option>
                      <option value="customers">Direct End Buyers Only</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Step 5: SMS Broadcast Switch & Sender ID */}
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5" /> Trigger SMS Broadcast on Publish
                    </p>
                    <p className="text-[10px] text-white/50 mt-0.5">Sends automated promotional SMS blast via Hubtel gateway</p>
                  </div>
                  <Switch
                    checked={newPromoPopup.send_sms}
                    onCheckedChange={(v) => setNewPromoPopup(prev => ({ ...prev, send_sms: v }))}
                    className="data-[state=checked]:bg-amber-400"
                  />
                </div>

                {newPromoPopup.send_sms && (
                  <div>
                    <Label className="text-[10px] text-white/60 mb-1 block">Hubtel Sender ID</Label>
                    <Input
                      placeholder="swiftupdate"
                      value={newPromoPopup.sender_id}
                      onChange={(e) => setNewPromoPopup(prev => ({ ...prev, sender_id: e.target.value }))}
                      className="bg-white/5 border-amber-500/40 text-amber-300 rounded-xl text-xs font-mono font-bold h-9"
                    />
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={handleCreateDataPromoPopup}
                  disabled={creatingDataPromo}
                  className="flex-1 bg-gradient-to-r from-amber-400 via-yellow-400 to-orange-400 hover:from-amber-300 hover:to-orange-300 text-black font-black rounded-xl h-12 text-sm uppercase tracking-wider shadow-lg shadow-amber-500/20"
                >
                  {creatingDataPromo ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Flame className="w-4 h-4 mr-2" />}
                  Launch Promo Deal Live {newPromoPopup.send_sms ? "& Broadcast SMS" : ""}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPreviewModalOpen(true)}
                  className="border-white/10 bg-white/5 hover:bg-white/10 text-white rounded-xl h-12 text-xs font-bold px-4"
                >
                  <Eye className="w-4 h-4 mr-1.5 text-amber-400" />
                  Preview Modal
                </Button>
              </div>
            </div>

            {/* Right: Live Interactive Card & Customer View Preview (5 Cols on XL) */}
            <div className="xl:col-span-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white/60 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Live Deal Preview (What Users See)
                </span>
                <Badge className="bg-green-500/20 text-green-300 border-green-500/30 text-[10px]">
                  INTERACTIVE
                </Badge>
              </div>

              {/* Styled Preview Card mimicking DataPromoPopupModal */}
              {(() => {
                const pkgDetails = parsePackageDetails(newPromoPopup.package_size, newPromoPopup.network);
                const orig = parseFloat(newPromoPopup.original_price) || 0;
                const promo = parseFloat(newPromoPopup.promo_price) || 0;
                const savings = orig > promo ? orig - promo : 0;
                const isMashup = newPromoPopup.network === "MTN Mash Up";

                return (
                  <div className="rounded-3xl border border-amber-500/30 bg-gradient-to-b from-stone-950 via-zinc-900 to-black p-6 relative overflow-hidden shadow-2xl flex flex-col justify-between">
                    {/* Background Glow */}
                    <div className="absolute top-0 right-0 w-48 h-48 bg-amber-400/10 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />

                    <div>
                      {/* Top Bar: Network Tag & Countdown */}
                      <div className="flex items-center justify-between mb-4 relative z-10">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-gradient-to-r from-amber-400 to-yellow-500 text-black font-black text-xs px-2.5 py-0.5">
                            {newPromoPopup.network}
                          </Badge>
                          {newPromoPopup.badge_text && (
                            <Badge className="bg-red-500/20 text-red-300 border-red-500/40 text-[10px] font-bold">
                              {newPromoPopup.badge_text}
                            </Badge>
                          )}
                        </div>

                        <span className="text-[11px] text-amber-300 font-mono font-bold flex items-center gap-1 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                          <Clock className="w-3 h-3" />
                          {newPromoPopup.expires_hours ? `${newPromoPopup.expires_hours}h 00m left` : "Active Deal"}
                        </span>
                      </div>

                      {/* Title & Description */}
                      <h3 className="font-black text-white text-xl leading-snug mb-1 relative z-10">
                        {newPromoPopup.title || "Flash Data Promo Deal"}
                      </h3>
                      <p className="text-xs text-white/60 mb-5 relative z-10 leading-relaxed">
                        {newPromoPopup.description || "Grab this limited-time package before it sells out!"}
                      </p>

                      {/* Package Breakdown Box */}
                      <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 space-y-3 relative z-10 backdrop-blur-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                            Package Bundle
                          </span>
                          {pkgDetails.minutesLabel ? (
                            <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-[10px] font-bold flex items-center gap-1">
                              <Phone className="w-2.5 h-2.5" /> {pkgDetails.minutesLabel}
                            </Badge>
                          ) : (
                            <Badge className="bg-white/10 text-white/70 text-[10px]">
                              Pure High-Speed Data
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-baseline justify-between">
                          <div>
                            <span className="text-3xl font-black text-white tracking-tight">
                              {pkgDetails.dataLabel}
                            </span>
                            {isMashup && (
                              <p className="text-[11px] text-amber-300 font-medium mt-0.5">
                                Official MTN Mash Up Voice & Data
                              </p>
                            )}
                          </div>

                          <div className="text-right">
                            {orig > promo && (
                              <p className="text-xs line-through text-white/40 font-mono">
                                GH₵ {orig.toFixed(2)}
                              </p>
                            )}
                            <p className="text-2xl font-black text-amber-400 font-mono">
                              GH₵ {promo.toFixed(2)}
                            </p>
                          </div>
                        </div>

                        {savings > 0 && (
                          <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px]">
                            <span className="text-emerald-400 font-bold flex items-center gap-1">
                              <Sparkles className="w-3 h-3" /> Save GH₵ {savings.toFixed(2)}
                            </span>
                            <span className="text-white/40">
                              Instant direct fulfillment
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Target audience & claim allowance indicator */}
                      <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-white/50">
                        <div className="p-2 rounded-xl bg-white/[0.02] border border-white/5">
                          <span className="text-white/40 block text-[9px] uppercase font-bold">Audience</span>
                          <span className="text-white font-medium capitalize">{newPromoPopup.target_audience}</span>
                        </div>
                        <div className="p-2 rounded-xl bg-white/[0.02] border border-white/5">
                          <span className="text-white/40 block text-[9px] uppercase font-bold">Max Pool</span>
                          <span className="text-white font-medium">
                            {parseInt(newPromoPopup.max_claims) > 0 ? `${newPromoPopup.max_claims} Claims` : "Unlimited"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom CTA Simulator */}
                    <div className="mt-6 pt-4 border-t border-white/10 space-y-2">
                      <Button
                        type="button"
                        onClick={() => setPreviewModalOpen(true)}
                        className="w-full bg-gradient-to-r from-amber-400 to-yellow-400 text-black font-black rounded-xl h-11 text-xs uppercase tracking-wider hover:from-amber-300 hover:to-yellow-300 shadow-md shadow-amber-500/20"
                      >
                        <Eye className="w-4 h-4 mr-1.5" /> Test Pop-Up In Full Modal
                      </Button>
                      <p className="text-[10px] text-white/40 text-center">
                        Customers can purchase via Wallet or Mobile Money directly on the homepage
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Active Promo Popups Manager */}
          <div className="space-y-4 pt-4 border-t border-white/5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Eye className="w-4 h-4 text-amber-400" /> Existing Promo Deals ({dataPromoPopups.length})
              </h3>
              <span className="text-xs text-white/40">
                Popups are automatically served to eligible visitors on the storefront
              </span>
            </div>

            {loadingDataPromoPopups ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
              </div>
            ) : dataPromoPopups.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-white/10 rounded-2xl bg-white/[0.01]">
                <Flame className="w-8 h-8 text-amber-400/40 mx-auto mb-2" />
                <p className="text-sm font-bold text-white/70">No active promo popups created yet</p>
                <p className="text-xs text-white/40 mt-1 max-w-sm mx-auto">
                  Pick a package above, set a discount price, and click Launch Promo Deal to start driving sales.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {dataPromoPopups.map((p) => {
                  const details = parsePackageDetails(p.package_size, p.network);
                  const isExpired = p.expires_at && new Date(p.expires_at) < new Date();
                  const isMashup = p.network === "MTN Mash Up";

                  return (
                    <div
                      key={p.id}
                      className={`p-5 rounded-2xl border transition-all flex flex-col justify-between ${
                        p.is_active && !isExpired
                          ? "bg-white/[0.03] border-white/10 hover:border-white/20 shadow-lg"
                          : "bg-black/40 border-white/5 opacity-70"
                      }`}
                    >
                      <div>
                        {/* Top row */}
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <Badge className={`${
                            isMashup
                              ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                              : "bg-white/10 text-white/80 border-white/15"
                          } text-[10px] font-bold`}>
                            {p.network}
                          </Badge>
                          <div className="flex items-center gap-1.5">
                            {p.badge_text && (
                              <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-[9px] font-bold">
                                {p.badge_text}
                              </Badge>
                            )}
                            <Badge className={
                              !p.is_active
                                ? "bg-white/10 text-white/40 text-[9px]"
                                : isExpired
                                ? "bg-amber-500/20 text-amber-400 text-[9px]"
                                : "bg-emerald-500/20 text-emerald-300 text-[9px] font-bold"
                            }>
                              {!p.is_active ? "PAUSED" : isExpired ? "EXPIRED" : "LIVE"}
                            </Badge>
                          </div>
                        </div>

                        {/* Title & Package */}
                        <h4 className="font-bold text-white text-sm mb-1 leading-snug">{p.title}</h4>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="font-black text-amber-300 text-sm">{details.dataLabel}</span>
                          {details.minutesLabel && (
                            <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-[9px]">
                              {details.minutesLabel}
                            </Badge>
                          )}
                          <span className="text-white/40 text-xs">@</span>
                          <span className="font-mono font-bold text-white text-xs">
                            GH₵ {Number(p.promo_price).toFixed(2)}
                          </span>
                        </div>

                        {/* Claims progress bar */}
                        <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 space-y-1.5 mb-4">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-white/50">Claims Progress:</span>
                            <span className="font-bold text-white">
                              {p.claimed_count || 0} {p.max_claims > 0 ? `/ ${p.max_claims}` : "Claims (Unlimited)"}
                            </span>
                          </div>
                          {p.max_claims > 0 && (
                            <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                              <div
                                className="bg-gradient-to-r from-amber-400 to-orange-400 h-full rounded-full transition-all"
                                style={{ width: `${Math.min(100, ((p.claimed_count || 0) / p.max_claims) * 100)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="pt-3 border-t border-white/5 flex flex-wrap items-center justify-between gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleTriggerPromoSMS(p)}
                          className="text-[11px] border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 rounded-xl h-8 gap-1 font-bold"
                          title="Send SMS announcement using Sender ID swiftupdate"
                        >
                          <Send className="w-3 h-3" /> SMS (swiftupdate)
                        </Button>

                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleToggleDataPromoPopup(p.id, p.is_active)}
                            className="text-xs text-white/60 hover:text-white h-8 px-2"
                          >
                            {p.is_active ? "Pause" : "Enable"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleResetDataPromoPopupClaims(p.id)}
                            className="text-amber-400 hover:text-amber-300 h-8 px-2"
                            title="Reset claims counter to 0"
                          >
                            <RefreshCw className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteDataPromoPopup(p.id)}
                            className="text-red-400 hover:text-red-300 h-8 px-2"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Dialog Preview of Customer Modal ── */}
      <Dialog open={previewModalOpen} onOpenChange={setPreviewModalOpen}>
        <DialogContent className="max-w-md bg-stone-950 border border-amber-500/40 text-white p-0 overflow-hidden rounded-3xl shadow-2xl">
          <div className="relative">
            {/* Header Banner */}
            <div className="p-6 bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-black">
              <div className="flex items-center justify-between mb-2">
                <Badge className="bg-black text-amber-400 font-black text-xs px-2.5 py-0.5">
                  {newPromoPopup.network}
                </Badge>
                <span className="text-xs font-mono font-bold bg-black/20 px-2 py-0.5 rounded-full">
                  ⏱️ {newPromoPopup.expires_hours ? `${newPromoPopup.expires_hours} Hours Left` : "Limited Time"}
                </span>
              </div>
              <h3 className="font-black text-xl leading-tight">
                {newPromoPopup.title || "Special Promo Deal"}
              </h3>
              <p className="text-xs font-medium text-black/80 mt-1">
                {newPromoPopup.description || "Exclusive promotional package deal."}
              </p>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              {/* Package Details */}
              {(() => {
                const details = parsePackageDetails(newPromoPopup.package_size, newPromoPopup.network);
                const orig = parseFloat(newPromoPopup.original_price) || 0;
                const promo = parseFloat(newPromoPopup.promo_price) || 0;

                return (
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between">
                    <div>
                      <span className="text-2xl font-black text-white">{details.dataLabel}</span>
                      {details.minutesLabel ? (
                        <div className="flex items-center gap-1 text-xs text-purple-300 font-bold mt-0.5">
                          <Phone className="w-3 h-3" /> {details.minutesLabel}
                        </div>
                      ) : (
                        <p className="text-xs text-white/50 mt-0.5">Pure High-Speed Data</p>
                      )}
                    </div>
                    <div className="text-right">
                      {orig > promo && (
                        <p className="text-xs line-through text-white/40 font-mono">GH₵ {orig.toFixed(2)}</p>
                      )}
                      <p className="text-2xl font-black text-amber-400 font-mono">GH₵ {promo.toFixed(2)}</p>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-2">
                <Label className="text-xs text-white/60">Customer Phone Number (Simulation)</Label>
                <Input
                  disabled
                  placeholder="024 XXX XXXX"
                  className="bg-white/5 border-white/10 text-white rounded-xl text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-center font-bold text-amber-300">
                  ⚡ Mobile Money
                </div>
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center text-white/60">
                  👛 Swift Wallet
                </div>
              </div>

              <Button
                disabled
                className="w-full bg-gradient-to-r from-amber-400 to-yellow-400 text-black font-black rounded-xl h-11 uppercase"
              >
                Buy Now for GH₵ {parseFloat(newPromoPopup.promo_price || "0").toFixed(2)}
              </Button>

              <div className="text-center pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPreviewModalOpen(false)}
                  className="text-xs text-white/40 hover:text-white"
                >
                  Close Preview
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
