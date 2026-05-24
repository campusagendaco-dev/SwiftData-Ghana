import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { X, Loader2, ArrowLeft, Store, Save, Smartphone, Settings, Users, Tags, ClipboardList, Wallet, Zap, Menu, Upload, Globe, AlignLeft, Palette, User } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { ChunkErrorBoundary } from "./ChunkErrorBoundary";

// Import Dashboard Components
import DashboardPricing from "@/pages/DashboardPricing";
import DashboardCustomerPricing from "@/pages/DashboardCustomerPricing";
import DashboardSubAgentPricing from "@/pages/DashboardSubAgentPricing";
import DashboardSubAgents from "@/pages/DashboardSubAgents";
import DashboardOrders from "@/pages/DashboardOrders";
import DashboardWithdraw from "@/pages/DashboardWithdraw";
import DashboardDeveloperAPI from "@/pages/DashboardDeveloperAPI";

interface StoreManagementOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  currentStoreName: string;
  currentWhatsapp: string;
  currentSupport: string;
  accentColor: string;
  onSuccess: () => void;
}

const TABS = [
  { id: "settings", label: "Store Profile", icon: Settings },
  { id: "pricing", label: "Guest Pricing", icon: Tags },
  { id: "customer_pricing", label: "Customer Pricing", icon: User },
  { id: "subagents", label: "Sub-Agents", icon: Users },
  { id: "transactions", label: "Transactions", icon: ClipboardList },
  { id: "withdrawals", label: "Withdrawals", icon: Wallet },
  { id: "developer", label: "Developer API", icon: Zap },
];

const StoreManagementOverlay = ({
  isOpen,
  onClose,
  agentId,
  currentStoreName,
  currentWhatsapp,
  currentSupport,
  accentColor = "#f59e0b",
  onSuccess
}: StoreManagementOverlayProps) => {
  const { toast } = useToast();
  const { profile } = useAuth();
  
  const [activeTab, setActiveTab] = useState("settings");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const [storeName, setStoreName] = useState(currentStoreName || "");
  const [whatsapp, setWhatsapp] = useState(currentWhatsapp || "");
  const [support, setSupport] = useState(currentSupport || "");
  
  // New advanced features
  const [logoUrl, setLogoUrl] = useState(profile?.store_logo_url || "");
  const [bannerUrl, setBannerUrl] = useState(profile?.store_banner_url || "");
  const [description, setDescription] = useState(profile?.store_description || "");
  const [primaryColor, setPrimaryColor] = useState(profile?.store_primary_color || "#f59e0b");
  const [customDomain, setCustomDomain] = useState(profile?.custom_domain || "");
  const [whatsappGroup, setWhatsappGroup] = useState(profile?.whatsapp_group_link || "");

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStoreName(currentStoreName || "");
      setWhatsapp(currentWhatsapp || "");
      setSupport(currentSupport || "");
      
      setLogoUrl(profile?.store_logo_url || "");
      setBannerUrl(profile?.store_banner_url || "");
      setDescription(profile?.store_description || "");
      setPrimaryColor(profile?.store_primary_color || "#f59e0b");
      setCustomDomain(profile?.custom_domain || "");
      setWhatsappGroup(profile?.whatsapp_group_link || "");
      
      setActiveTab("settings");
    }
  }, [isOpen, currentStoreName, currentWhatsapp, currentSupport, profile]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => { document.body.style.overflow = "unset"; };
  }, [isOpen]);

  const handleLogoUpload = async (file: File) => {
    const MAX_MB = 5;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast({ title: `Image too large - max ${MAX_MB}MB`, variant: "destructive" });
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast({ title: "Only image files are allowed", variant: "destructive" });
      return;
    }
    setUploadingLogo(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `store-logos/${profile?.user_id}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("site-assets")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("site-assets").getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      toast({ title: "Logo uploaded!" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleBannerUpload = async (file: File) => {
    const MAX_MB = 10;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast({ title: `Image too large - max ${MAX_MB}MB`, variant: "destructive" });
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast({ title: "Only image files are allowed", variant: "destructive" });
      return;
    }
    setUploadingBanner(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `store-banners/${profile?.user_id}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("site-assets")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("site-assets").getPublicUrl(path);
      setBannerUrl(data.publicUrl);
      toast({ title: "Banner uploaded!" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeName.trim()) {
      toast({ title: "Store name required", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          store_name: storeName.trim(),
          whatsapp_number: whatsapp.trim() || null,
          support_number: support.trim() || null,
          store_logo_url: logoUrl || null,
          store_banner_url: bannerUrl || null,
          store_description: description.trim() || null,
          store_primary_color: primaryColor,
          custom_domain: customDomain.trim() || null,
          whatsapp_group_link: whatsappGroup.trim() || null
        })
        .eq("user_id", agentId);

      if (error) throw error;

      toast({ title: "Store settings saved!", description: "Your storefront has been updated." });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[300] flex bg-[#050508] text-white overflow-hidden">
        
        {/* Mobile Overlay Backdrop for Sidebar */}
        {isSidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar Navigation */}
        <div className={`fixed md:relative z-50 h-full w-64 bg-[#0a0a0f] border-r border-white/5 flex flex-col transition-transform duration-300 ${isSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
          <div className="h-16 border-b border-white/5 flex items-center px-4 shrink-0 justify-between">
            <span className="font-black tracking-widest text-sm uppercase flex items-center gap-2">
              <Store className="w-4 h-4" style={{ color: accentColor }} /> 
              Control Panel
            </span>
            <button className="md:hidden p-1 text-white/50 hover:text-white" onClick={() => setIsSidebarOpen(false)}>
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
            <ChunkErrorBoundary>
              {TABS.map((tab) => {
                // Hide sub-agents if the user is a sub-agent themselves
                if (tab.id === "subagents" && profile?.is_sub_agent) return null;
                
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setIsSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold ${
                      isActive 
                        ? "bg-white/10 text-white" 
                        : "text-white/40 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? "" : "opacity-60"}`} style={{ color: isActive ? accentColor : undefined }} />
                    {tab.label}
                  </button>
                );
              })}
            </ChunkErrorBoundary>
          </div>
          
          <div className="p-4 border-t border-white/5">
            <button 
              onClick={onClose}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all font-bold text-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Exit Control Panel
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          
          {/* Mobile Header */}
          <div className="md:hidden h-16 border-b border-white/5 flex items-center px-4 bg-[#0a0a0f] shrink-0 sticky top-0 z-30">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 -ml-2 text-white/70 hover:text-white"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="font-black text-sm uppercase tracking-widest ml-2 flex-1">
              {TABS.find(t => t.id === activeTab)?.label}
            </span>
            <button 
              onClick={onClose}
              className="p-2 -mr-2 text-white/50 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="min-h-full pb-20">
              <ChunkErrorBoundary>
                {activeTab === "settings" && (
                  <div 
                    className="max-w-md mx-auto mt-8 md:mt-12 p-5 animate-in fade-in slide-in-from-bottom-4 duration-300"
                  >
                    <div className="mb-8">
                      <h2 className="text-2xl font-black mb-1">Store Profile</h2>
                      <p className="text-sm text-white/50 font-semibold">Update your public storefront details instantly.</p>
                    </div>

                    <form onSubmit={handleSaveSettings} className="space-y-5">
                      {/* Store Name */}
                      <div>
                        <label className="block text-[11px] font-black uppercase text-white/40 mb-2 tracking-widest">Store Name</label>
                        <div className="relative">
                          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                            <Store className="w-5 h-5" />
                          </div>
                          <input
                            type="text" required placeholder="e.g. My Data Hub"
                            value={storeName} onChange={(e) => setStoreName(e.target.value)}
                            className="w-full h-14 rounded-2xl bg-white/5 border border-white/10 pl-11 pr-4 text-base font-bold text-white focus:outline-none focus:border-white/30 transition-colors"
                          />
                        </div>
                      </div>

                      {/* WhatsApp */}
                      <div>
                        <label className="block text-[11px] font-black uppercase text-white/40 mb-2 tracking-widest">WhatsApp Number (For floating chat)</label>
                        <div className="relative">
                          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500/50">
                            <Smartphone className="w-5 h-5" />
                          </div>
                          <input
                            type="tel" placeholder="054 123 4567"
                            value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)}
                            className="w-full h-14 rounded-2xl bg-white/5 border border-white/10 pl-11 pr-4 text-base font-bold text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
                          />
                        </div>
                      </div>

                      {/* Support */}
                      <div>
                        <label className="block text-[11px] font-black uppercase text-white/40 mb-2 tracking-widest">General Support Number</label>
                        <div className="relative">
                          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                            <Smartphone className="w-5 h-5" />
                          </div>
                          <input
                            type="tel" placeholder="024 000 0000"
                            value={support} onChange={(e) => setSupport(e.target.value)}
                            className="w-full h-14 rounded-2xl bg-white/5 border border-white/10 pl-11 pr-4 text-base font-bold text-white focus:outline-none focus:border-white/30 transition-colors"
                          />
                        </div>
                      </div>
                      {/* Brand Customizations - Logo & Banner */}
                      <div className="pt-4 border-t border-white/10 space-y-5">
                        <h3 className="text-sm font-bold flex items-center gap-2"><Palette className="w-4 h-4 text-amber-500"/> Brand Assets</h3>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[11px] font-black uppercase text-white/40 mb-2 tracking-widest">Store Logo</label>
                            <input type="file" ref={logoInputRef} accept="image/*" className="hidden" onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleLogoUpload(file);
                              e.target.value = "";
                            }} />
                            {logoUrl ? (
                              <div className="flex items-center gap-3">
                                <div className="w-14 h-14 rounded-2xl border border-white/10 overflow-hidden bg-white flex items-center justify-center shrink-0">
                                  <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
                                </div>
                                <div className="flex flex-col gap-2 flex-1">
                                  <button type="button" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} className="flex items-center justify-center gap-2 h-8 px-3 rounded-xl text-xs font-bold text-amber-400 border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20 transition-all disabled:opacity-50">
                                    {uploadingLogo ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                    {uploadingLogo ? "Uploading..." : "Replace"}
                                  </button>
                                  <button type="button" onClick={() => setLogoUrl("")} className="flex items-center justify-center gap-2 h-8 px-3 rounded-xl text-xs font-bold text-white/40 border border-white/8 bg-white/4 hover:bg-white/8 transition-all">
                                    <X className="w-3 h-3" /> Remove
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} className="w-full h-20 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all disabled:opacity-50" style={{ borderColor: "rgba(255,255,255,0.12)", background: "#1a1a24" }}>
                                {uploadingLogo ? <Loader2 className="w-5 h-5 text-amber-400 animate-spin" /> : <Upload className="w-4 h-4 text-amber-400" />}
                                <span className="text-[10px] font-bold text-white/50">{uploadingLogo ? "Uploading..." : "Upload Logo"}</span>
                              </button>
                            )}
                          </div>

                          <div>
                            <label className="block text-[11px] font-black uppercase text-white/40 mb-2 tracking-widest">Store Banner</label>
                            <input type="file" ref={bannerInputRef} accept="image/*" className="hidden" onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleBannerUpload(file);
                              e.target.value = "";
                            }} />
                            {bannerUrl ? (
                              <div className="flex flex-col gap-2">
                                <div className="w-full h-14 rounded-2xl border border-white/10 overflow-hidden bg-[#1a1a24] flex items-center justify-center relative">
                                  <img src={bannerUrl} alt="Banner" className="w-full h-full object-cover" />
                                </div>
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => bannerInputRef.current?.click()} disabled={uploadingBanner} className="flex-1 flex items-center justify-center gap-2 h-8 rounded-xl text-xs font-bold text-amber-400 border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20 transition-all disabled:opacity-50">
                                    {uploadingBanner ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} Replace
                                  </button>
                                  <button type="button" onClick={() => setBannerUrl("")} className="flex-1 flex items-center justify-center gap-2 h-8 rounded-xl text-xs font-bold text-white/40 border border-white/8 bg-white/4 hover:bg-white/8 transition-all">
                                    <X className="w-3 h-3" /> Remove
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" onClick={() => bannerInputRef.current?.click()} disabled={uploadingBanner} className="w-full h-20 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all disabled:opacity-50" style={{ borderColor: "rgba(255,255,255,0.12)", background: "#1a1a24" }}>
                                {uploadingBanner ? <Loader2 className="w-5 h-5 text-amber-400 animate-spin" /> : <Upload className="w-4 h-4 text-amber-400" />}
                                <span className="text-[10px] font-bold text-white/50">{uploadingBanner ? "Uploading..." : "Upload Banner"}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-black uppercase text-white/40 mb-2 tracking-widest">Store Description</label>
                          <div className="relative">
                            <div className="absolute left-4 top-4 text-white/30">
                              <AlignLeft className="w-5 h-5" />
                            </div>
                            <textarea
                              placeholder="Briefly describe what your store offers..."
                              value={description} onChange={(e) => setDescription(e.target.value)}
                              className="w-full h-24 rounded-2xl bg-white/5 border border-white/10 pl-11 pr-4 pt-4 text-sm font-bold text-white focus:outline-none focus:border-white/30 transition-colors resize-none"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-black uppercase text-white/40 mb-2 tracking-widest">Primary Brand Color</label>
                          <div className="flex items-center gap-3">
                            <input 
                              type="color" 
                              value={primaryColor} 
                              onChange={(e) => setPrimaryColor(e.target.value)}
                              className="w-14 h-14 rounded-2xl cursor-pointer bg-transparent border-0 p-0" 
                            />
                            <div className="flex-1 h-14 rounded-2xl bg-white/5 border border-white/10 px-4 flex items-center">
                              <span className="text-sm font-bold font-mono text-white/70">{primaryColor}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Advanced Settings */}
                      <div className="pt-4 border-t border-white/10 space-y-5">
                        <h3 className="text-sm font-bold flex items-center gap-2"><Globe className="w-4 h-4 text-blue-400"/> Customization & Domain</h3>
                        
                        <div>
                          <label className="block text-[11px] font-black uppercase text-white/40 mb-2 tracking-widest">Custom Domain (Whitelabel)</label>
                          <div className="relative">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                              <Globe className="w-5 h-5" />
                            </div>
                            <input
                              type="text" placeholder="e.g. data.mybrand.com"
                              value={customDomain} onChange={(e) => setCustomDomain(e.target.value)}
                              className="w-full h-14 rounded-2xl bg-white/5 border border-white/10 pl-11 pr-4 text-base font-bold text-white focus:outline-none focus:border-white/30 transition-colors"
                            />
                          </div>
                          <p className="text-[10px] text-white/30 mt-2 font-bold uppercase tracking-wider">Point your custom domain via CNAME to setup.swiftdatagh.shop</p>
                        </div>
                        
                        <div>
                          <label className="block text-[11px] font-black uppercase text-white/40 mb-2 tracking-widest">WhatsApp Group Link</label>
                          <div className="relative">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                              <Users className="w-5 h-5" />
                            </div>
                            <input
                              type="url" placeholder="https://chat.whatsapp.com/..."
                              value={whatsappGroup} onChange={(e) => setWhatsappGroup(e.target.value)}
                              className="w-full h-14 rounded-2xl bg-white/5 border border-white/10 pl-11 pr-4 text-base font-bold text-white focus:outline-none focus:border-white/30 transition-colors"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="pt-4">
                        <button 
                          type="submit"
                          disabled={saving}
                          className="w-full h-14 flex items-center justify-center gap-2 rounded-2xl text-black font-black text-sm uppercase tracking-wider transition-all active:scale-[0.98] disabled:opacity-50"
                          style={{ backgroundColor: accentColor, boxShadow: `0 8px 24px -8px ${accentColor}80` }}
                        >
                          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-4 h-4" /> Save Store Profile</>}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {activeTab === "pricing" && (
                  <div className="animate-in fade-in duration-300">
                    <DashboardPricing />
                    {!profile?.is_sub_agent && (
                      <div className="mt-8 pt-8 border-t border-white/5">
                        <div className="p-6 md:p-8 max-w-4xl mx-auto pb-0">
                          <h2 className="font-display text-2xl font-bold">Sub-Agent Pricing</h2>
                          <p className="text-muted-foreground mt-1 mb-6">Configure the base costs you provide to your recruited sub-agents.</p>
                        </div>
                        <DashboardSubAgentPricing />
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "customer_pricing" && (
                  <div className="animate-in fade-in duration-300">
                    <DashboardCustomerPricing />
                  </div>
                )}

                {activeTab === "subagents" && !profile?.is_sub_agent && (
                  <div className="animate-in fade-in duration-300">
                    <DashboardSubAgents />
                  </div>
                )}

                {activeTab === "transactions" && (
                  <div className="animate-in fade-in duration-300">
                    <DashboardOrders />
                  </div>
                )}

                {activeTab === "withdrawals" && (
                  <div className="animate-in fade-in duration-300">
                    <DashboardWithdraw />
                  </div>
                )}

                {activeTab === "developer" && (
                  <div className="animate-in fade-in duration-300">
                    <DashboardDeveloperAPI />
                  </div>
                )}
              </ChunkErrorBoundary>
            </div>
          </div>
        </div>

      </div>
    </>
  );
};

export default StoreManagementOverlay;
