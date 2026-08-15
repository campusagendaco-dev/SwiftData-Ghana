import { useState, useEffect } from "react"; // Rebuild Triggered: 2026-05-15
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Users, TrendingUp, ShieldAlert, Globe, Zap, 
  Settings, Lock, Unlock, RefreshCw, AlertTriangle,
  ArrowUpRight, ArrowDownLeft, DollarSign, Activity, Wallet,
  CreditCard, ArrowRightLeft, FileText, CheckCircle2, History, MapPin
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn, sanitizeSearchTerm } from "@/lib/utils";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetDescription,
  SheetTrigger
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const AdminSwiftVendorPro = () => {
  const [vendors, setVendors] = useState<any[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<any | null>(null);
  const [vendorSidebarOpen, setVendorSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingRules, setSavingRules] = useState(false);
  const [systemStats, setSystemStats] = useState({
    totalFloat: 0,
    totalProfit: 0,
    activeVendors: 0,
    failedToday: 0
  });
  
  const [config, setConfig] = useState({
    momoSplit: 50,
    africaMargin: 2.5,
    isFrozen: false
  });

  const [manualSearchQuery, setManualSearchQuery] = useState("");
  const [manualSearchResults, setManualSearchResults] = useState<any[]>([]);
  const [searchingManual, setSearchingManual] = useState(false);

  useEffect(() => {
    fetchVendors();
    fetchLedger();
    fetchSystemRules();
  }, []);

  const fetchSystemRules = async () => {
    try {
      const { data, error } = await supabase
        .from("system_settings")
        .select("sub_agent_base_fee, at_markup_percentage, maintenance_mode")
        .single();
      
      if (error) throw error;
      if (data) {
        setConfig({
          momoSplit: data.sub_agent_base_fee,
          africaMargin: data.at_markup_percentage || 0,
          isFrozen: data.maintenance_mode || false
        });
      }
    } catch (err) {
      console.error("Failed to fetch rules");
    }
  };

  const saveSystemRules = async () => {
    setSavingRules(true);
    try {
      const { error } = await supabase
        .from("system_settings")
        .update({
          sub_agent_base_fee: config.momoSplit,
          at_markup_percentage: config.africaMargin,
          maintenance_mode: config.isFrozen
        })
        .eq("id", 1);
      
      if (error) throw error;
      toast.success("System rules synchronized successfully!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to save system rules");
    } finally {
      setSavingRules(false);
    }
  };

  const handleManualSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualSearchQuery.trim()) return;
    setSearchingManual(true);
    try {
      const s = sanitizeSearchTerm(manualSearchQuery);
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, full_name, email, phone, vendor_status')
        .or(`full_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`)
        .limit(5);
      if (error) throw error;
      setManualSearchResults(data || []);
    } catch (err) {
      console.error(err);
      toast.error("Failed to search agents");
    } finally {
      setSearchingManual(false);
    }
  };

  const handleManualApprove = async (agentId: string) => {
    if (!window.confirm("Are you sure you want to manually upgrade this user to a Momo Swift Vendor?")) return;
    try {
      toast.loading("Upgrading user...", { id: "manual-upgrade" });
      const { error } = await supabase
        .from('profiles')
        .update({ 
          vendor_status: 'active', 
          vendor_rejection_reason: null, 
          vendor_activated_at: new Date().toISOString(),
          is_agent: true 
        })
        .eq('user_id', agentId);
      
      if (error) throw error;
      toast.success("User upgraded to Swift Vendor successfully!", { id: "manual-upgrade" });
      setManualSearchResults([]);
      setManualSearchQuery("");
      fetchVendors();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to upgrade user", { id: "manual-upgrade" });
    }
  };

  const handleEmergencyFreeze = async () => {
    setSavingRules(true);
    const newFrozenState = !config.isFrozen;
    try {
      const { error } = await supabase
        .from("system_settings")
        .update({ maintenance_mode: newFrozenState })
        .eq("id", 1);
      
      if (error) throw error;
      setConfig(prev => ({ ...prev, isFrozen: newFrozenState }));
      toast.success(newFrozenState ? "Network frozen successfully!" : "Network unfrozen successfully!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to update freeze state");
    } finally {
      setSavingRules(false);
    }
  };

  const fetchVendors = async () => {
    setLoading(true);
    try {
      // Fetch all wallets (vendors)
      const { data: wallets, error: wError } = await supabase
        .from("wallets")
        .select(`
          id, 
          balance, 
          agent_id,
          profiles:agent_id(full_name, phone, store_name, terminal_locked, vendor_status, vendor_national_id_url, vendor_national_id_back_url, vendor_business_cert_url, vendor_registration_number, vendor_tin, vendor_kyc_api_response, vendor_kyc_submitted_at, vendor_region, vendor_phone, vendor_email, vendor_digital_address, vendor_latitude, vendor_longitude, vendor_verified_momo_name)
        `);

      if (wError) throw wError;

      // Fetch Today's stats for each vendor
      const today = new Date();
      today.setHours(0,0,0,0);

      const { data: orders } = await supabase
        .from("orders")
        .select("agent_id, amount, profit, parent_profit, status")
        .gte("created_at", today.toISOString());

      const vendorData = wallets.map(w => {
        const vendorOrders = orders?.filter(o => o.agent_id === w.agent_id) || [];
        const successOrders = vendorOrders.filter(o => o.status === "fulfilled");
        
        return {
          ...w,
          business_name: w.profiles?.store_name || "Unknown Business",
          agent_name: w.profiles?.full_name || "Unknown Agent",
          terminal_locked: w.profiles?.terminal_locked || false,
          today_profit: successOrders.reduce((acc, curr) => acc + (Number(curr.profit) + Number(curr.parent_profit || 0)), 0),
          today_count: successOrders.length,
          status: vendorOrders.some(o => o.status === "failed") ? "Warning" : "Healthy",
          vendor_status: w.profiles?.vendor_status || 'inactive',
          kyc_details: {
            national_id: w.profiles?.vendor_national_id_url,
            business_cert: w.profiles?.vendor_business_cert_url,
            reg_number: w.profiles?.vendor_registration_number,
            tin: w.profiles?.vendor_tin,
            api_response: w.profiles?.vendor_kyc_api_response,
            submitted_at: w.profiles?.vendor_kyc_submitted_at,
            national_id_back: w.profiles?.vendor_national_id_back_url,
            region: w.profiles?.vendor_region,
            vendorPhone: w.profiles?.vendor_phone,
            vendorEmail: w.profiles?.vendor_email,
            digitalAddress: w.profiles?.vendor_digital_address,
            latitude: w.profiles?.vendor_latitude,
            longitude: w.profiles?.vendor_longitude,
            verified_momo_name: w.profiles?.vendor_verified_momo_name
          }
        };
      });

      setVendors(vendorData.filter(v => v.vendor_status === 'active'));
      setPendingApprovals(vendorData.filter(v => v.vendor_status === 'pending_approval'));

      
      // Global Stats
      setSystemStats({
        totalFloat: vendorData.reduce((acc, v) => acc + Number(v.balance), 0),
        totalProfit: vendorData.reduce((acc, v) => acc + v.today_profit, 0),
        activeVendors: vendorData.length,
        failedToday: orders?.filter(o => o.status === "failed").length || 0
      });

    } catch (err: any) {
      toast.error("Failed to fetch vendor data");
    } finally {
      setLoading(false);
    }
  };

  const fetchLedger = async () => {
    try {
      const { data: ordersData, error } = await supabase
        .from("orders")
        .select("id, created_at, order_type, amount, status, customer_phone, agent_id")
        .in("order_type", ["vendor_cash_in", "vendor_cash_out", "vendor_bank_transfer"])
        .order("created_at", { ascending: false })
        .limit(100);
      
      if (error) throw error;

      if (ordersData && ordersData.length > 0) {
        const agentIds = [...new Set(ordersData.map(o => o.agent_id))];
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("user_id, full_name, store_name, phone")
          .in("user_id", agentIds);

        const profileMap = new Map(profilesData?.map(p => [p.user_id, p]) || []);

        const enrichedLedger = ordersData.map(o => ({
          ...o,
          profiles: profileMap.get(o.agent_id) || null
        }));
        
        setLedger(enrichedLedger);
      } else {
        setLedger([]);
      }
    } catch (err: any) {
      console.error("Failed to fetch ledger", err);
    }
  };

  const toggleVendorLock = async (agentId: string, currentlyLocked: boolean) => {
    const action = currentlyLocked ? "unlock" : "lock";
    try {
      toast.loading(`${currentlyLocked ? "Unlocking" : "Locking"} terminal...`, { id: "vendor-lock" });
      const { data, error } = await supabase.functions.invoke("admin-vendor-security", {
        body: { agent_id: agentId, action }
      });
      if (error) throw error;
      if (data && data.success) {
        toast.success(data.message, { id: "vendor-lock" });
        fetchVendors(); // Refresh fleet list
      } else {
        toast.error(data?.error || "Failed to update terminal status", { id: "vendor-lock" });
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Connection error", { id: "vendor-lock" });
    }
  };

  const handleReviewVendor = async (agentId: string, action: 'approve' | 'reject') => {
    let reason = null;
    if (action === 'reject') {
      reason = window.prompt("Enter reason for rejection:");
      if (reason === null) return; // cancelled
    }

    try {
      toast.loading(`Processing ${action}...`, { id: "kyc-review" });
      const updates = action === 'approve' 
        ? { vendor_status: 'active', vendor_rejection_reason: null, vendor_activated_at: new Date().toISOString() }
        : { vendor_status: 'rejected', vendor_rejection_reason: reason || 'Information does not match records.' };

      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('user_id', agentId);
        
      if (error) throw error;

      // Send SMS Notification
      const vendorInfo = pendingApprovals.find(v => v.agent_id === agentId);
      if (vendorInfo && vendorInfo.profiles?.phone) {
        const smsMessage = action === 'approve' 
          ? `Congratulations! Your Swift Vendor terminal is fully activated and limits are removed.`
          : `Your Swift Vendor application requires attention. Reason: ${reason || 'Information does not match records.'}`;
        
        await supabase.functions.invoke("admin-send-sms", {
          body: { phone: vendorInfo.profiles.phone, message: smsMessage }
        });
      }

      toast.success(`Vendor ${action}d successfully.`, { id: "kyc-review" });
      fetchVendors();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to update vendor status", { id: "kyc-review" });
    }
  };

  return (
    <div className="relative h-full w-full min-h-[80vh] rounded-[2.5rem] bg-[#0a0a0b] overflow-hidden shadow-[inset_0_0_100px_rgba(0,0,0,0.8)] border border-white/5">
      {/* Ambient Super Pro Background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950/20 via-[#0a0a0b] to-[#0a0a0b] pointer-events-none" />
      <div className="absolute -top-[20%] -right-[10%] w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] opacity-50 pointer-events-none mix-blend-screen" />
      <div className="absolute -bottom-[20%] -left-[10%] w-[800px] h-[600px] bg-emerald-900/10 rounded-full blur-[150px] opacity-40 pointer-events-none mix-blend-screen" />
      
      <div className="relative z-10 p-6 md:p-10 space-y-12 min-h-[80vh] text-white">
        {/* Super Pro Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/5">
          <div className="space-y-2">
            <h1 className="text-4xl md:text-5xl font-black tracking-tighter flex items-center gap-4 uppercase drop-shadow-sm text-white">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/40 blur-xl rounded-full animate-pulse" />
                <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/30 backdrop-blur-xl">
                  <ShieldAlert className="w-7 h-7 text-primary" />
                </div>
              </div>
              Swift Vendor Master
            </h1>
            <p className="text-primary mt-2 font-black tracking-[0.2em] text-[10px] uppercase flex items-center gap-3 ml-[72px]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              Institutional Control Console • v3.0 Pro
            </p>
          </div>
          <div className="flex gap-4">
            <Button variant="outline" className="rounded-full border-white/10 bg-white/5 hover:bg-white/10 hover:text-white font-black gap-2 h-12 px-6 backdrop-blur-md transition-all hover:scale-105" onClick={fetchVendors}>
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              Sync Network
            </Button>
            
            <Sheet>
              <SheetTrigger asChild>
                <Button className="rounded-full bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white border border-indigo-400/50 font-black gap-2 h-12 px-6 shadow-[0_0_20px_rgba(79,70,229,0.3)] transition-all hover:scale-105 relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                  <Settings className="w-4 h-4" />
                  Tactical Rules
                </Button>
              </SheetTrigger>
              <SheetContent className="bg-[#0a0a0b]/95 backdrop-blur-3xl border-white/10 text-white w-full sm:max-w-md shadow-2xl">
                <SheetHeader>
                  <SheetTitle className="text-2xl font-black text-indigo-400 uppercase tracking-tighter flex items-center gap-2">
                    <Zap className="w-6 h-6" /> Tactical Rules
                  </SheetTitle>
                  <SheetDescription className="text-muted-foreground font-medium">Adjust institutional parameters across the entire network.</SheetDescription>
                </SheetHeader>
                
                <div className="space-y-10 mt-12">
                  <div className="space-y-4">
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <Zap className="w-3 h-3 text-indigo-400" />
                      Global MoMo Split (%)
                    </label>
                    <div className="flex items-center gap-4 bg-white/5 p-2 rounded-2xl border border-white/10">
                      <Input 
                        type="number" 
                        value={config.momoSplit} 
                        onChange={(e) => setConfig({...config, momoSplit: Number(e.target.value)})}
                        className="bg-transparent border-none h-12 font-black text-center text-2xl focus-visible:ring-0" 
                      />
                      <span className="text-2xl font-black text-indigo-400 pr-6">%</span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <Globe className="w-3 h-3 text-emerald-400" />
                      Africa Hub Margin (%)
                    </label>
                    <div className="flex items-center gap-4 bg-white/5 p-2 rounded-2xl border border-white/10">
                      <Input 
                        type="number" 
                        value={config.africaMargin} 
                        onChange={(e) => setConfig({...config, africaMargin: Number(e.target.value)})}
                        className="bg-transparent border-none h-12 font-black text-center text-2xl focus-visible:ring-0" 
                      />
                      <span className="text-2xl font-black text-emerald-400 pr-6">%</span>
                    </div>
                  </div>

                  <div className="p-6 rounded-[2rem] bg-gradient-to-br from-red-500/10 to-red-900/10 border border-red-500/20 space-y-6 relative overflow-hidden">
                    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20 pointer-events-none" />
                    <div className="relative z-10 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center border border-red-500/30">
                            <Lock className="w-4 h-4 text-red-500" />
                          </div>
                          <span className="font-black text-sm uppercase tracking-wider text-red-100">Emergency<br/>Freeze</span>
                        </div>
                        <Button 
                          variant={config.isFrozen ? "default" : "outline"}
                          className={cn(
                            "rounded-full font-black h-12 px-6 shadow-xl transition-all", 
                            config.isFrozen ? "bg-red-500 hover:bg-red-600 text-white shadow-red-500/50 animate-pulse" : "border-red-500/30 text-red-400 hover:bg-red-500/20"
                          )}
                          onClick={handleEmergencyFreeze}
                        >
                          {config.isFrozen ? "ACTIVE" : "OFF"}
                        </Button>
                    </div>
                    <p className="relative z-10 text-[10px] font-bold text-red-400/80 leading-relaxed uppercase tracking-widest text-center">
                      Instantly suspends all transactions network-wide.
                    </p>
                  </div>

                  <Button 
                    className="w-full h-16 rounded-full font-black text-lg bg-white text-black hover:bg-white/90 shadow-[0_0_30px_rgba(255,255,255,0.2)] gap-3 transition-all hover:scale-105 mt-8"
                    onClick={saveSystemRules}
                    disabled={savingRules}
                  >
                    {savingRules ? <RefreshCw className="w-5 h-5 animate-spin" /> : <ShieldAlert className="w-5 h-5" />}
                    Synchronize Rules
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Global Pulse Matrix */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[
            { label: "Total Network Float", value: `₵${systemStats.totalFloat.toLocaleString()}`, icon: Wallet, color: "text-primary", bg: "from-primary/20 to-primary/5", border: "border-primary/20", shadow: "shadow-primary/5" },
            { label: "Consolidated Profit", value: `₵${systemStats.totalProfit.toFixed(2)}`, icon: TrendingUp, color: "text-emerald-400", bg: "from-emerald-500/20 to-emerald-500/5", border: "border-emerald-500/20", shadow: "shadow-emerald-500/5" },
            { label: "Active Terminals", value: systemStats.activeVendors, icon: Activity, color: "text-indigo-400", bg: "from-indigo-500/20 to-indigo-500/5", border: "border-indigo-500/20", shadow: "shadow-indigo-500/5" },
            { label: "Network Failures", value: systemStats.failedToday, icon: AlertTriangle, color: "text-red-400", bg: "from-red-500/20 to-red-500/5", border: "border-red-500/20", shadow: "shadow-red-500/5" },
          ].map((stat, i) => (
            <Card key={i} className={cn("border bg-white/5 backdrop-blur-xl shadow-2xl relative overflow-hidden group hover:scale-[1.02] transition-transform duration-300", stat.border)}>
              <div className={cn("absolute inset-0 bg-gradient-to-br opacity-50 pointer-events-none transition-opacity group-hover:opacity-100", stat.bg)} />
              <CardContent className="p-6 flex items-center gap-5 relative z-10">
                <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 bg-black/40 backdrop-blur-md border border-white/5 shadow-inner", stat.shadow)}>
                  <stat.icon className={cn("w-6 h-6 drop-shadow-md", stat.color)} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{stat.label}</p>
                  <p className="text-3xl font-black tracking-tighter text-white drop-shadow-sm">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main Interface Tabs */}
        <Tabs defaultValue="fleet" className="w-full">
          <div className="flex justify-between items-center mb-8">
            <TabsList className="bg-black/40 border border-white/10 rounded-2xl h-14 p-1">
              <TabsTrigger value="fleet" className="rounded-xl font-black text-xs uppercase tracking-widest data-[state=active]:bg-primary data-[state=active]:text-black h-full px-8 transition-all">
                Fleet Operations
              </TabsTrigger>
              <TabsTrigger value="ledger" className="rounded-xl font-black text-xs uppercase tracking-widest data-[state=active]:bg-emerald-500 data-[state=active]:text-black h-full px-8 transition-all">
                Network Ledger
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="fleet" className="mt-0 outline-none animate-in fade-in duration-500">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
              <div className="xl:col-span-2 space-y-8">
                
              {pendingApprovals.length > 0 && (
                <Card className="border border-amber-500/30 bg-amber-500/5 backdrop-blur-xl shadow-[0_0_50px_-12px_rgba(245,158,11,0.15)] relative overflow-hidden rounded-[2rem]">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500/0 via-amber-500 to-amber-500/0 opacity-50" />
                  <CardHeader className="pb-4">
                    <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-3 text-amber-500 drop-shadow-sm">
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.4)]">
                        <ShieldAlert className="w-4 h-4 text-amber-500 animate-pulse" />
                      </div>
                      Pending KYC Approvals ({pendingApprovals.length})
                    </CardTitle>
                    <CardDescription className="font-bold text-amber-500/70 ml-11 uppercase tracking-widest text-[9px]">Requires verification within 24 hours</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 px-6 pb-6">
                    <div className="overflow-x-auto rounded-2xl border border-amber-500/10 bg-black/20 backdrop-blur-sm">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-amber-500/10 bg-amber-500/5">
                            <th className="p-4 text-[9px] font-black uppercase tracking-widest text-amber-500/60">Business Profile</th>
                            <th className="p-4 text-[9px] font-black uppercase tracking-widest text-amber-500/60">Legal Documents</th>
                            <th className="p-4 text-[9px] font-black uppercase tracking-widest text-amber-500/60">Verification Status</th>
                            <th className="p-4 text-[9px] font-black uppercase tracking-widest text-amber-500/60 text-right">Clearance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-500/5">
                          {pendingApprovals.map((v) => (
                            <tr key={v.id} className="hover:bg-amber-500/[0.02] transition-colors">
                              <td className="p-4">
                                <p className="font-black text-sm text-white">{v.business_name}</p>
                                <p className="text-[10px] font-bold text-muted-foreground mt-0.5">{v.agent_name} • {v.kyc_details.vendorPhone || v.profiles?.phone}</p>
                                <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{v.kyc_details.vendorEmail} • {v.kyc_details.region}</p>
                                <span className="inline-flex items-center gap-1 mt-2 text-[9px] font-black uppercase tracking-widest text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                                  <DollarSign className="w-3 h-3" /> Activation Fee Paid
                                </span>
                              </td>
                              <td className="p-4">
                                <div className="flex flex-col gap-2">
                                  {v.kyc_details.national_id && (
                                    <a href={v.kyc_details.national_id} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[10px] font-bold bg-white/5 border border-white/10 px-3 py-1.5 rounded-full hover:bg-white/10 text-white transition-colors w-max">
                                      <ArrowUpRight className="w-3 h-3 text-amber-500" /> ID (Front)
                                    </a>
                                  )}
                                  {v.kyc_details.national_id_back && (
                                    <a href={v.kyc_details.national_id_back} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[10px] font-bold bg-white/5 border border-white/10 px-3 py-1.5 rounded-full hover:bg-white/10 text-white transition-colors w-max">
                                      <ArrowUpRight className="w-3 h-3 text-amber-500" /> ID (Back)
                                    </a>
                                  )}
                                  {v.kyc_details.business_cert && (
                                    <a href={v.kyc_details.business_cert} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[10px] font-bold bg-white/5 border border-white/10 px-3 py-1.5 rounded-full hover:bg-white/10 text-white transition-colors w-max">
                                      <ArrowUpRight className="w-3 h-3 text-amber-500" /> Business Cert
                                    </a>
                                  )}
                                </div>
                              </td>
                              <td className="p-4">
                                <div className="space-y-1.5">
                                  <p className="text-[10px] font-black text-white/70 font-mono bg-black/40 px-2 py-0.5 rounded w-max border border-white/5">REG: {v.kyc_details.reg_number}</p>
                                  <p className="text-[10px] font-black text-white/70 font-mono bg-black/40 px-2 py-0.5 rounded w-max border border-white/5">ID: {v.kyc_details.tin}</p>
                                  {v.kyc_details.digitalAddress && <p className="text-[10px] font-black text-white/70 font-mono bg-black/40 px-2 py-0.5 rounded w-max border border-white/5">GPS: {v.kyc_details.digitalAddress}</p>}
                                </div>
                                {v.kyc_details.api_response?.status === 'verified' && (
                                  <Badge className="bg-emerald-500/10 text-emerald-400 mt-3 border border-emerald-500/20 text-[9px] uppercase font-black px-2 py-0.5">
                                    <ShieldAlert className="w-3 h-3 mr-1" /> Auto-Verified
                                  </Badge>
                                )}
                              </td>
                              <td className="p-4">
                                <div className="flex items-center justify-end gap-3">
                                  <Button size="sm" variant="outline" className="h-9 rounded-full border-red-500/30 text-red-400 hover:bg-red-500 hover:text-white text-xs font-black transition-all hover:shadow-[0_0_15px_rgba(239,68,68,0.4)]" onClick={() => handleReviewVendor(v.agent_id, 'reject')}>Reject</Button>
                                  <Button size="sm" className="h-9 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black transition-all hover:shadow-[0_0_15px_rgba(16,185,129,0.5)] shadow-lg" onClick={() => handleReviewVendor(v.agent_id, 'approve')}>Approve</Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Manual Vendor Enrollment */}
              <Card className="border border-indigo-500/30 bg-indigo-500/5 backdrop-blur-xl shadow-[0_0_50px_-12px_rgba(99,102,241,0.15)] relative overflow-hidden rounded-[2rem]">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500/0 via-indigo-500 to-indigo-500/0 opacity-50" />
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-3 text-indigo-400 drop-shadow-sm">
                    <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/40 shadow-[0_0_15px_rgba(99,102,241,0.4)]">
                      <Users className="w-4 h-4 text-indigo-400" />
                    </div>
                    Manual Vendor Enrollment
                  </CardTitle>
                  <CardDescription className="font-bold text-indigo-400/70 ml-11 uppercase tracking-widest text-[9px]">Force upgrade any user to a Swift Vendor without KYC</CardDescription>
                </CardHeader>
                <CardContent className="p-0 px-6 pb-6 space-y-4">
                  <form onSubmit={handleManualSearch} className="flex items-center gap-3">
                    <Input 
                      placeholder="Search by name, email, or phone number..." 
                      value={manualSearchQuery}
                      onChange={(e) => setManualSearchQuery(e.target.value)}
                      className="bg-black/40 border-indigo-500/20 text-white placeholder:text-muted-foreground focus-visible:ring-indigo-500 rounded-xl h-12"
                    />
                    <Button type="submit" disabled={searchingManual} className="h-12 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-black text-white">
                      {searchingManual ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Search"}
                    </Button>
                  </form>
                  
                  {manualSearchResults.length > 0 && (
                    <div className="bg-black/40 border border-indigo-500/10 rounded-xl overflow-hidden mt-4">
                      <table className="w-full text-left">
                        <tbody className="divide-y divide-indigo-500/10">
                          {manualSearchResults.map((user) => (
                            <tr key={user.user_id} className="hover:bg-indigo-500/5 transition-colors">
                              <td className="p-4">
                                <p className="font-black text-white text-sm">{user.full_name || "Unknown Name"}</p>
                                <p className="text-[10px] text-muted-foreground font-mono">{user.email} • {user.phone}</p>
                              </td>
                              <td className="p-4 text-right">
                                {user.vendor_status === 'active' ? (
                                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Already Vendor</Badge>
                                ) : (
                                  <Button size="sm" onClick={() => handleManualApprove(user.user_id)} className="h-8 bg-indigo-600 hover:bg-indigo-500 text-white font-black rounded-lg text-xs">
                                    Approve as Vendor
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

              {/* Vendor Fleet List */}
              <Card className="border border-white/5 bg-white/[0.02] backdrop-blur-2xl rounded-[2rem] overflow-hidden shadow-2xl">
                <CardHeader className="border-b border-white/5 bg-black/20 pb-6">
                  <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-3 text-white">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30">
                        <Users className="w-4 h-4 text-primary" />
                    </div>
                    Vendor Fleet Operations
                  </CardTitle>
                  <CardDescription className="font-bold text-muted-foreground ml-11 uppercase tracking-widest text-[9px]">Live status and yield of deployed POS terminals</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-black/40 border-b border-white/5">
                          <th className="p-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Terminal Operator</th>
                          <th className="p-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground text-center">Liquidity (Float)</th>
                          <th className="p-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground text-center">Daily Yield</th>
                          <th className="p-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground text-center">Status</th>
                          <th className="p-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground text-right">Access Controls</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {vendors.map((v) => (
                          <tr key={v.id} className="hover:bg-white/[0.03] transition-colors group">
                            <td className="p-5">
                              <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/5 flex items-center justify-center font-black text-primary text-xl border border-primary/20 shadow-inner">
                                  {v.business_name[0]}
                                </div>
                                <div>
                                  <p className="font-black text-sm text-white drop-shadow-sm">{v.business_name}</p>
                                  <p className="text-[10px] font-bold text-muted-foreground mt-0.5">{v.agent_name}</p>
                                  <p className="text-[9px] font-mono text-primary/60 mt-1">{v.profiles?.phone}</p>
                                </div>
                              </div>
                            </td>
                            <td className="p-5 text-center">
                              <p className="font-black text-primary text-lg tracking-tight">₵{Number(v.balance).toFixed(2)}</p>
                            </td>
                            <td className="p-5 text-center">
                              <div className="flex flex-col items-center justify-center">
                                <p className="font-black text-emerald-400 text-base">₵{v.today_profit.toFixed(2)}</p>
                                <span className="bg-white/5 text-muted-foreground px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest mt-1 border border-white/10">
                                  {v.today_count} Trx
                                </span>
                              </div>
                            </td>
                            <td className="p-5 text-center">
                              <div className="flex justify-center">
                                <div className={cn(
                                  "flex items-center gap-1.5 rounded-full border px-3 py-1",
                                  v.status === "Healthy" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-amber-500/20 bg-amber-500/10 text-amber-400"
                                )}>
                                  <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse", v.status === "Healthy" ? "bg-emerald-400" : "bg-amber-400")} />
                                  <span className="text-[9px] font-black uppercase tracking-wider">{v.status}</span>
                                </div>
                              </div>
                            </td>
                            <td className="p-5 text-right">
                              <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-10 rounded-xl border-white/10 bg-white/5 hover:bg-white/10 text-white font-black text-xs gap-2"
                                  onClick={() => { setSelectedVendor(v); setVendorSidebarOpen(true); }}
                                >
                                  <Settings className="w-4 h-4" /> Manage
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Global Rules Panel */}
            <div className="space-y-6">
              <Card className="border border-white/5 bg-white/[0.02] backdrop-blur-2xl rounded-[2rem] overflow-hidden">
                <CardHeader className="bg-indigo-500/5 border-b border-indigo-500/10 pb-5">
                  <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2 text-indigo-400">
                    <Zap className="w-4 h-4" />
                    Global Profit Split Logic
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                  <div className="space-y-5">
                      <div className="space-y-3">
                        <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">MoMo Split (Vendor %)</label>
                        <div className="flex items-center gap-3">
                          <Input 
                            type="number" 
                            value={config.momoSplit} 
                            onChange={(e) => setConfig({...config, momoSplit: Number(e.target.value)})}
                            className="bg-black/40 border border-white/10 font-black h-14 rounded-2xl text-center text-xl focus-visible:ring-indigo-500" 
                          />
                          <span className="font-black text-indigo-400 text-xl">%</span>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Africa Hub Margin</label>
                        <div className="flex items-center gap-3">
                          <Input 
                            type="number" 
                            value={config.africaMargin} 
                            onChange={(e) => setConfig({...config, africaMargin: Number(e.target.value)})}
                            className="bg-black/40 border border-white/10 font-black h-14 rounded-2xl text-center text-xl focus-visible:ring-indigo-500" 
                          />
                          <span className="font-black text-indigo-400 text-xl">%</span>
                        </div>
                      </div>
                      <Button 
                        className="w-full h-14 rounded-2xl font-black bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_20px_rgba(79,70,229,0.3)] transition-all hover:scale-[1.02]"
                        onClick={saveSystemRules}
                        disabled={savingRules}
                      >
                        {savingRules ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Apply Global Rates"}
                      </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-emerald-500/20 bg-emerald-500/5 backdrop-blur-2xl rounded-[2rem] overflow-hidden">
                <CardHeader className="pb-4">
                  <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2 text-emerald-400">
                    <Globe className="w-4 h-4" />
                    Africa Hub Gateway
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-6 pb-6 space-y-4">
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-black/40 border border-white/5">
                      <span className="text-xs font-black tracking-wide">Pan-African Transfers</span>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-emerald-500 font-black text-[9px] uppercase tracking-widest">Online</span>
                      </div>
                  </div>
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-black/40 border border-white/5">
                      <span className="text-xs font-black tracking-wide">Identity Resolution (KYC)</span>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-emerald-500 font-black text-[9px] uppercase tracking-widest">Active</span>
                      </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            </div>
          </TabsContent>

          <TabsContent value="ledger" className="mt-0 outline-none animate-in fade-in duration-500">
            <Card className="border border-white/5 bg-white/[0.02] backdrop-blur-2xl rounded-[2rem] overflow-hidden shadow-2xl">
              <CardHeader className="border-b border-white/5 bg-black/20 pb-6 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-3 text-white">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                        <History className="w-4 h-4 text-emerald-500" />
                    </div>
                    Network Transaction Ledger
                  </CardTitle>
                  <CardDescription className="font-bold text-muted-foreground ml-11 uppercase tracking-widest text-[9px]">Global view of all vendor cash-ins, cash-outs, and transfers.</CardDescription>
                </div>
                <Button variant="outline" className="rounded-full border-white/10 bg-white/5 hover:bg-white/10 font-black gap-2 h-10 px-6 backdrop-blur-md" onClick={fetchLedger}>
                  <RefreshCw className="w-4 h-4" /> Refresh Ledger
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto min-h-[500px]">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-black/40 border-b border-white/5">
                        <th className="p-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Time / Ref ID</th>
                        <th className="p-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Terminal Operator</th>
                        <th className="p-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Tx Type</th>
                        <th className="p-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground text-center">Amount (GHS)</th>
                        <th className="p-5 text-[9px] font-black uppercase tracking-widest text-muted-foreground text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {ledger.length === 0 ? (
                        <tr><td colSpan={5} className="p-10 text-center text-muted-foreground font-bold">No transactions found in ledger.</td></tr>
                      ) : (
                        ledger.map((tx) => (
                          <tr key={tx.id} className="hover:bg-white/[0.03] transition-colors">
                            <td className="p-5">
                              <p className="font-black text-sm text-white">{new Date(tx.created_at).toLocaleDateString("en-GH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                              <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{tx.id.split("-")[0]}</p>
                            </td>
                            <td className="p-5">
                              <p className="font-black text-sm text-white">{tx.profiles?.store_name || "Unknown Business"}</p>
                              <p className="text-[10px] font-bold text-muted-foreground mt-0.5">{tx.profiles?.full_name}</p>
                            </td>
                            <td className="p-5">
                              <div className="flex items-center gap-2">
                                <div className={cn(
                                  "w-8 h-8 rounded-lg flex items-center justify-center border",
                                  tx.order_type === "vendor_cash_in" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                                  tx.order_type === "vendor_cash_out" ? "bg-amber-500/10 border-amber-500/20 text-amber-400" :
                                  "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                                )}>
                                  {tx.order_type === "vendor_cash_in" ? <ArrowDownLeft className="w-4 h-4" /> :
                                   tx.order_type === "vendor_cash_out" ? <ArrowUpRight className="w-4 h-4" /> :
                                   <ArrowRightLeft className="w-4 h-4" />}
                                </div>
                                <div>
                                  <p className="font-black text-xs uppercase tracking-wider text-white/80">
                                    {tx.order_type.replace(/_/g, " ")}
                                  </p>
                                  {tx.customer_phone && <p className="text-[10px] font-mono text-muted-foreground">{tx.customer_phone}</p>}
                                </div>
                              </div>
                            </td>
                            <td className="p-5 text-center">
                              <p className="font-black text-lg tracking-tight text-white">₵{Number(tx.amount).toFixed(2)}</p>
                            </td>
                            <td className="p-5 text-right">
                              <div className="flex justify-end">
                                <Badge className={cn(
                                  "rounded-lg border-none text-[9px] font-black px-2.5 h-6 uppercase tracking-widest",
                                  tx.status === "fulfilled" ? "bg-emerald-500/20 text-emerald-400" : 
                                  tx.status === "pending" || tx.status === "processing" ? "bg-amber-500/20 text-amber-400" :
                                  "bg-red-500/20 text-red-400"
                                )}>
                                  {tx.status}
                                </Badge>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Bank-Standard Vendor Control Panel */}
      <Sheet open={vendorSidebarOpen} onOpenChange={setVendorSidebarOpen}>
        <SheetContent side="right" className="bg-[#0a0a0b]/95 backdrop-blur-3xl border-white/10 text-white w-full sm:max-w-2xl shadow-2xl p-0 overflow-y-auto">
          {selectedVendor && (
            <div className="relative">
              <div className="sticky top-0 z-20 bg-black/40 backdrop-blur-xl border-b border-white/5 p-6 flex items-center justify-between">
                <div>
                  <SheetTitle className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3 text-white">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/5 flex items-center justify-center font-black text-primary text-xl border border-primary/20 shadow-inner">
                      {selectedVendor.business_name[0]}
                    </div>
                    {selectedVendor.business_name}
                  </SheetTitle>
                  <SheetDescription className="font-bold text-muted-foreground mt-1 uppercase tracking-widest text-[10px]">Vendor Control Panel • Terminal ID: {selectedVendor.agent_id.split("-")[0]}</SheetDescription>
                </div>
                <Badge className={cn(
                  "rounded-full border px-4 py-1.5 uppercase font-black tracking-widest text-[10px]",
                  selectedVendor.status === "Healthy" ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-400" : "bg-amber-500/20 border-amber-500/30 text-amber-400"
                )}>
                  {selectedVendor.status}
                </Badge>
              </div>

              <div className="p-6 space-y-8">
                {/* Financial Overview */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-20 h-20 bg-primary/20 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 mb-2"><Wallet className="w-3 h-3 text-primary" /> Current Liquidity</p>
                    <p className="text-3xl font-black tracking-tighter text-white">₵{Number(selectedVendor.balance).toFixed(2)}</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/20 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2 mb-2"><TrendingUp className="w-3 h-3 text-emerald-400" /> Today's Yield</p>
                    <p className="text-3xl font-black tracking-tighter text-white">₵{selectedVendor.today_profit.toFixed(2)}</p>
                    <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mt-1">{selectedVendor.today_count} Trx Processed</p>
                  </div>
                </div>

                {/* Identity Profile */}
                <div className="bg-black/20 border border-white/5 rounded-3xl overflow-hidden">
                  <div className="bg-white/5 border-b border-white/5 px-6 py-4 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-400" />
                    <h3 className="font-black uppercase tracking-widest text-xs text-indigo-400">Identity & Risk Profile</h3>
                  </div>
                  <div className="p-6 grid grid-cols-2 gap-y-6 gap-x-4">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Operator Name</p>
                      <p className="font-bold text-sm text-white">{selectedVendor.agent_name}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Contact Phone</p>
                      <p className="font-mono text-sm text-white">{selectedVendor.kyc_details?.vendorPhone || selectedVendor.profiles?.phone}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Email</p>
                      <p className="font-mono text-sm text-white">{selectedVendor.kyc_details?.vendorEmail || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Region</p>
                      <p className="font-mono text-sm text-white">{selectedVendor.kyc_details?.region || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Registration #</p>
                      <p className="font-mono text-sm text-white/80">{selectedVendor.kyc_details.reg_number}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">ID Number</p>
                      <p className="font-mono text-sm text-white/80">{selectedVendor.kyc_details.tin}</p>
                    </div>
                    <div className="col-span-2 bg-white/5 border border-white/10 p-3 rounded-xl">
                      <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400 mb-1">Paystack Verified MoMo Name</p>
                      <p className="font-mono text-sm text-white font-black">{selectedVendor.kyc_details?.verified_momo_name || "Verification Pending/Failed"}</p>
                    </div>
                    <div className="col-span-2 flex justify-between items-center bg-white/5 border border-white/10 p-3 rounded-xl">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">GPS Capture Location</p>
                        <p className="font-mono text-sm text-white/80">
                          {selectedVendor.kyc_details?.latitude && selectedVendor.kyc_details?.longitude 
                            ? `${selectedVendor.kyc_details.latitude}, ${selectedVendor.kyc_details.longitude}` 
                            : "No GPS Data Captured"}
                        </p>
                      </div>
                      {selectedVendor.kyc_details?.latitude && selectedVendor.kyc_details?.longitude && (
                        <a 
                          href={`https://www.google.com/maps?q=${selectedVendor.kyc_details.latitude},${selectedVendor.kyc_details.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 text-xs font-black bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-black transition-colors px-4 py-2 rounded-lg border border-emerald-500/20"
                        >
                          <MapPin className="w-4 h-4" /> View Map
                        </a>
                      )}
                    </div>
                    <div className="col-span-2">
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Digital Address (GPS)</p>
                      <p className="font-mono text-sm text-white/80">{selectedVendor.kyc_details?.digitalAddress || "N/A"}</p>
                    </div>
                    {selectedVendor.kyc_details.national_id && (
                      <div className="col-span-1">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">ID (Front)</p>
                        <a href={selectedVendor.kyc_details.national_id} target="_blank" rel="noreferrer">
                           <img src={selectedVendor.kyc_details.national_id} alt="ID Front" className="w-full h-24 object-cover rounded-xl border border-white/10 hover:border-primary transition-colors" />
                        </a>
                      </div>
                    )}
                    {selectedVendor.kyc_details.national_id_back && (
                      <div className="col-span-1">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">ID (Back)</p>
                        <a href={selectedVendor.kyc_details.national_id_back} target="_blank" rel="noreferrer">
                           <img src={selectedVendor.kyc_details.national_id_back} alt="ID Back" className="w-full h-24 object-cover rounded-xl border border-white/10 hover:border-primary transition-colors" />
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Mini Ledger */}
                <div className="bg-black/20 border border-white/5 rounded-3xl overflow-hidden">
                  <div className="bg-white/5 border-b border-white/5 px-6 py-4 flex items-center gap-2">
                    <History className="w-4 h-4 text-emerald-400" />
                    <h3 className="font-black uppercase tracking-widest text-xs text-emerald-400">Recent Activity</h3>
                  </div>
                  <div className="p-2">
                    {ledger.filter(tx => tx.agent_id === selectedVendor.agent_id).slice(0, 5).map(tx => (
                      <div key={tx.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center border",
                            tx.order_type === "vendor_cash_in" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                            tx.order_type === "vendor_cash_out" ? "bg-amber-500/10 border-amber-500/20 text-amber-400" :
                            "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                          )}>
                            {tx.order_type === "vendor_cash_in" ? <ArrowDownLeft className="w-4 h-4" /> :
                             tx.order_type === "vendor_cash_out" ? <ArrowUpRight className="w-4 h-4" /> :
                             <ArrowRightLeft className="w-4 h-4" />}
                          </div>
                          <div>
                            <p className="font-black text-[10px] uppercase tracking-wider text-white/90">{tx.order_type.replace(/_/g, " ")}</p>
                            <p className="text-[9px] font-mono text-muted-foreground">{new Date(tx.created_at).toLocaleTimeString()}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-xs text-white">₵{Number(tx.amount).toFixed(2)}</p>
                          <p className={cn("text-[9px] font-black uppercase tracking-widest", tx.status === "fulfilled" ? "text-emerald-400" : "text-amber-400")}>{tx.status}</p>
                        </div>
                      </div>
                    ))}
                    {ledger.filter(tx => tx.agent_id === selectedVendor.agent_id).length === 0 && (
                      <p className="text-center text-xs font-bold text-muted-foreground py-6">No recent transactions.</p>
                    )}
                  </div>
                </div>

                {/* Risk Controls */}
                <div className="bg-red-500/10 border border-red-500/20 rounded-3xl overflow-hidden relative">
                  <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 pointer-events-none" />
                  <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-4 flex items-center gap-2 relative z-10">
                    <ShieldAlert className="w-4 h-4 text-red-500" />
                    <h3 className="font-black uppercase tracking-widest text-xs text-red-400">Security & Risk Controls</h3>
                  </div>
                  <div className="p-6 relative z-10">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-black text-sm text-red-100 uppercase tracking-widest">Account Suspension</p>
                        <p className="text-[10px] font-bold text-red-400/80 mt-1 max-w-[200px] leading-relaxed">Locks the POS terminal and prevents all financial activity.</p>
                      </div>
                      <Button 
                        size="lg"
                        className={cn(
                          "rounded-full font-black px-8 h-12 transition-all shadow-xl gap-2",
                          selectedVendor.terminal_locked 
                          ? "bg-emerald-500 hover:bg-emerald-600 text-black shadow-emerald-500/30" 
                          : "bg-red-500 hover:bg-red-600 text-white shadow-red-500/30"
                        )}
                        onClick={async () => {
                          await toggleVendorLock(selectedVendor.agent_id, selectedVendor.terminal_locked);
                          // Auto close or rely on fetchVendors to update state. 
                          // It's better to update local state immediately for UX.
                          setSelectedVendor({...selectedVendor, terminal_locked: !selectedVendor.terminal_locked});
                        }}
                      >
                        {selectedVendor.terminal_locked ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                        {selectedVendor.terminal_locked ? "UNLOCK TERMINAL" : "LOCK TERMINAL"}
                      </Button>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default AdminSwiftVendorPro;
