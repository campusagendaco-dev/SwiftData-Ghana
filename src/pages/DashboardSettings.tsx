import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { generateSlug } from "@/lib/data";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Store, User, Phone, Mail, MessageCircle, Link2,
  Palette, Smartphone, CreditCard, Globe, CheckCircle2, Loader2, Upload, X, Plus, Trash2,
  Copy, Edit, XCircle, Check, Search
} from "lucide-react";

const SECTION = ({ icon: Icon, title, description, children }: {
  icon: typeof Store; title: string; description: string; children: React.ReactNode;
}) => (
  <div className="rounded-3xl border border-white/8 overflow-hidden" style={{ background: "#111116" }}>
    <div className="flex items-center gap-3 px-5 py-4 border-b border-white/6">
      <div className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.2)" }}>
        <Icon className="w-4 h-4 text-amber-400" />
      </div>
      <div>
        <p className="text-sm font-black text-white">{title}</p>
        <p className="text-[11px] text-white/40">{description}</p>
      </div>
    </div>
    <div className="p-5 space-y-4">{children}</div>
  </div>
);

const Field = ({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <label className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-white/40">
      {label}
      {required && <span className="text-amber-400">*</span>}
    </label>
    {children}
    {hint && <p className="text-[10px] text-white/30 leading-relaxed">{hint}</p>}
  </div>
);

const StyledInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className="w-full h-11 rounded-2xl px-4 text-sm font-medium text-white border outline-none transition-all focus:border-amber-400/50 placeholder:text-white/20"
    style={{ background: "#1a1a24", borderColor: "rgba(255,255,255,0.08)", ...props.style as React.CSSProperties }}
  />
);

const MOMO_NETWORKS = [
  { id: "MTN", label: "MTN MoMo", color: "#fbbf24" },
  { id: "Telecel", label: "Telecel Cash", color: "#ef4444" },
  { id: "AirtelTigo", label: "AirtelTigo Money", color: "#3b82f6" },
];

const PRESET_COLORS = [
  "#fbbf24", "#f59e0b", "#ef4444", "#ec4899",
  "#8b5cf6", "#6366f1", "#3b82f6", "#06b6d4",
  "#10b981", "#84cc16", "#f97316", "#ffffff",
];

const DashboardSettings = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  
  // Stores states
  const [stores, setStores] = useState<any[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [loadingStores, setLoadingStores] = useState(true);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  // Customers & Deposits states
  const [activeTab, setActiveTab] = useState<"store" | "customers" | "deposits">("store");
  const [customers, setCustomers] = useState<any[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [loadingDeposits, setLoadingDeposits] = useState(false);

  // Manual balance editing state
  const [editingCustomer, setEditingCustomer] = useState<any | null>(null);
  const [newBalance, setNewBalance] = useState("");
  const [savingBalance, setSavingBalance] = useState(false);

  // Action loading states
  const [processingDepositId, setProcessingDepositId] = useState<string | null>(null);

  // Custom Domain Search & Purchase States
  const [agentWalletBalance, setAgentWalletBalance] = useState<number>(0);
  const [searchDomainText, setSearchDomainText] = useState("");
  const [searchingDomain, setSearchingDomain] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [buyingDomain, setBuyingDomain] = useState(false);
  const [buyStep, setBuyStep] = useState<"idle" | "debiting" | "registering" | "activating" | "success" | "error">("idle");
  const [buyError, setBuyError] = useState("");
  const [showDomainModal, setShowDomainModal] = useState(false);
  const [selectedDomainToBuy, setSelectedDomainToBuy] = useState<any | null>(null);

  const fetchAgentWallet = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from("wallets")
        .select("balance")
        .eq("agent_id", user.id)
        .maybeSingle();
      if (data) {
        setAgentWalletBalance(Number(data.balance || 0));
      }
    } catch (e) {
      console.error("Error fetching wallet balance:", e);
    }
  };

  const handleSearchDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchDomainText.trim()) return;

    setSearchingDomain(true);
    setSearchResults([]);
    try {
      const baseName = searchDomainText.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split(".")[0];
      if (!baseName || baseName.length < 3) {
        toast({ title: "Invalid Domain", description: "Domain name must be at least 3 characters.", variant: "destructive" });
        setSearchingDomain(false);
        return;
      }

      const tlds = [".com", ".net", ".org", ".shop", ".xyz"];
      const checkedResults = [];

      for (const extension of tlds) {
        const fullDomain = `${baseName}${extension}`;
        const { data, error } = await supabase.functions.invoke("purchase-custom-domain", {
          body: { action: "check", domain: fullDomain }
        });

        if (!error && data) {
          checkedResults.push(data);
        } else {
          const prices: Record<string, number> = { ".com": 150, ".net": 180, ".org": 195, ".shop": 70, ".xyz": 45 };
          let errorMessage = "Search unavailable";
          if (error && (error as any).context && typeof (error as any).context.json === 'function') {
             try {
               const errData = await (error as any).context.json();
               if (errData?.error) errorMessage = errData.error;
             } catch(e) {}
          }
          
          checkedResults.push({
            domain: fullDomain,
            tld: extension,
            available: false,
            price_ghs: prices[extension] || 150,
            message: errorMessage
          });
        }
      }

      setSearchResults(checkedResults);
    } catch (err: any) {
      console.error("Domain search error:", err);
      toast({ title: "Search failed", description: err.message || "Could not complete lookup.", variant: "destructive" });
    } finally {
      setSearchingDomain(false);
    }
  };

  const handlePurchaseDomain = async () => {
    if (!selectedDomainToBuy || !selectedStoreId) return;

    const { domain, price_ghs } = selectedDomainToBuy;
    if (agentWalletBalance < price_ghs) {
      toast({ 
        title: "Insufficient Balance", 
        description: `You need GHS ${price_ghs.toFixed(2)} but only have GHS ${agentWalletBalance.toFixed(2)}.`, 
        variant: "destructive" 
      });
      return;
    }

    setBuyingDomain(true);
    setBuyError("");
    setBuyStep("debiting");
    
    try {
      await new Promise(r => setTimeout(r, 1000));
      setBuyStep("registering");
      
      const { data, error } = await supabase.functions.invoke("purchase-custom-domain", {
        body: {
          action: "purchase",
          domain_name: domain,
          store_id: selectedStoreId
        }
      });

      let errorMessage = error?.message || data?.error || "Registration failed.";
      if (error && (error as any).context && typeof (error as any).context.json === 'function') {
        try {
          const errorBody = await (error as any).context.json();
          if (errorBody?.error) errorMessage = errorBody.error;
        } catch (e) {
          // ignore
        }
      }

      if (error || !data || !data.success) {
        throw new Error(errorMessage);
      }

      setBuyStep("activating");
      await new Promise(r => setTimeout(r, 1200));

      setBuyStep("success");
      
      update("custom_domain", domain);
      setAgentWalletBalance(prev => prev - price_ghs);
      
      toast({ title: "🎉 Domain Activated!", description: `Successfully bought and connected ${domain}!` });
      await fetchStores();
      
      setTimeout(() => {
        setShowDomainModal(false);
        setBuyStep("idle");
        setSelectedDomainToBuy(null);
        setSearchResults([]);
        setSearchDomainText("");
      }, 2500);

    } catch (err: any) {
      console.error("Purchase error:", err);
      setBuyError(err.message || "Failed to purchase custom domain.");
      setBuyStep("error");
    } finally {
      setBuyingDomain(false);
    }
  };

  const fetchCustomers = async () => {
    if (!user) return;
    setLoadingCustomers(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("parent_agent_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setCustomers(data || []);
    } catch (e: any) {
      console.error("Error loading customers:", e);
      toast({ title: "Error loading customers", description: e.message, variant: "destructive" });
    } finally {
      setLoadingCustomers(false);
    }
  };

  const fetchDeposits = async () => {
    if (!user) return;
    setLoadingDeposits(true);
    try {
      const { data, error } = await supabase
        .from("store_deposits")
        .select(`
          *,
          profiles:customer_id (
            full_name,
            email,
            phone
          )
        `)
        .eq("agent_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setDeposits(data || []);
    } catch (e: any) {
      console.error("Error loading deposits:", e);
      toast({ title: "Error loading deposits", description: e.message, variant: "destructive" });
    } finally {
      setLoadingDeposits(false);
    }
  };

  const handleApproveDeposit = async (id: string) => {
    setProcessingDepositId(id);
    try {
      const { data, error } = await supabase.rpc("approve_store_deposit", { deposit_id: id });
      if (error) throw error;
      
      if (data && !data.success) {
        throw new Error(data.error || "Approval failed.");
      }
      
      toast({ title: "Deposit approved!", description: "Customer wallet has been credited.", variant: "default" });
      fetchDeposits();
    } catch (e: any) {
      toast({ title: "Approval failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessingDepositId(null);
    }
  };

  const handleDeclineDeposit = async (id: string) => {
    setProcessingDepositId(id);
    try {
      const { error } = await supabase
        .from("store_deposits")
        .update({ status: "declined" })
        .eq("id", id);
      if (error) throw error;

      toast({ title: "Deposit declined", description: "Request has been marked as declined.", variant: "default" });
      fetchDeposits();
    } catch (e: any) {
      toast({ title: "Declining failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessingDepositId(null);
    }
  };

  const handleSaveBalance = async () => {
    if (!editingCustomer) return;
    setSavingBalance(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ balance: Number(newBalance) })
        .eq("user_id", editingCustomer.user_id);
      if (error) throw error;

      toast({ title: "Balance updated!", description: `Set ${editingCustomer.full_name || editingCustomer.email}'s balance to ₵${Number(newBalance).toFixed(2)}`, variant: "default" });
      setEditingCustomer(null);
      fetchCustomers();
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingBalance(false);
    }
  };

  useEffect(() => {
    if (activeTab === "customers") {
      fetchCustomers();
    } else if (activeTab === "deposits") {
      fetchDeposits();
    }
  }, [activeTab, user]);

  const [form, setForm] = useState({
    store_name: "",
    full_name: "",
    email: "",
    phone: "",
    whatsapp_number: "",
    support_number: "",
    whatsapp_group_link: "",
    momo_number: "",
    momo_network: "",
    momo_account_name: "",
    store_logo_url: "",
    store_banner_url: "",
    store_description: "",
    store_primary_color: "#fbbf24",
    custom_domain: "",
  });

  // Fetch all reseller stores
  const fetchStores = async () => {
    if (!user) return;
    setLoadingStores(true);
    try {
      const { data, error } = await supabase
        .from("reseller_stores")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      
      if (error) throw error;
      setStores(data || []);
      
      // Default to the first store if not selected
      if (data && data.length > 0 && !selectedStoreId) {
        setSelectedStoreId(data[0].id);
      }
    } catch (e: any) {
      toast({ title: "Error loading stores", description: e.message, variant: "destructive" });
    } finally {
      setLoadingStores(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchStores();
      fetchAgentWallet();
    }
  }, [user]);

  // Sync profile details (Central user details)
  useEffect(() => {
    if (profile) {
      setForm((f) => ({
        ...f,
        full_name: profile.full_name || "",
        email: profile.email || "",
        phone: profile.phone || "",
        whatsapp_number: profile.whatsapp_number || "",
        support_number: profile.support_number || "",
        whatsapp_group_link: profile.whatsapp_group_link || "",
        momo_number: profile.momo_number || "",
        momo_network: profile.momo_network || "",
        momo_account_name: profile.momo_account_name || "",
      }));
    }
  }, [profile]);

  // Sync selected store details
  useEffect(() => {
    if (selectedStoreId && selectedStoreId !== "new") {
      const s = stores.find((x) => x.id === selectedStoreId);
      if (s) {
        setForm((f) => ({
          ...f,
          store_name: s.store_name || "",
          store_logo_url: s.store_logo_url || "",
          store_banner_url: s.store_banner_url || "",
          store_description: s.store_description || "",
          store_primary_color: s.store_primary_color || "#fbbf24",
          custom_domain: s.custom_domain || "",
        }));
      }
    }
  }, [selectedStoreId, stores]);

  const update = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleLogoUpload = async (file: File) => {
    const MAX_MB = 5;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast({ title: `Image too large — max ${MAX_MB}MB`, variant: "destructive" });
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast({ title: "Only image files are allowed", variant: "destructive" });
      return;
    }
    setUploadingLogo(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `store-logos/${user?.id}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("site-assets")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("site-assets").getPublicUrl(path);
      update("store_logo_url", data.publicUrl);
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
      toast({ title: `Image too large — max ${MAX_MB}MB`, variant: "destructive" });
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast({ title: "Only image files are allowed", variant: "destructive" });
      return;
    }
    setUploadingBanner(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `store-banners/${user?.id}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("site-assets")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("site-assets").getPublicUrl(path);
      update("store_banner_url", data.publicUrl);
      toast({ title: "Banner uploaded!" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!newStoreName.trim()) {
      toast({ title: "Please enter a store name", variant: "destructive" });
      return;
    }

    setSaving(true);
    const slug = generateSlug(newStoreName);
    try {
      const { data, error } = await supabase
        .from("reseller_stores")
        .insert({
          user_id: user.id,
          store_name: newStoreName.trim(),
          slug,
          store_primary_color: PRESET_COLORS[0],
        })
        .select()
        .single();

      if (error) throw error;
      
      toast({ title: "Store created successfully!" });
      setNewStoreName("");
      setCreatingNew(false);
      await fetchStores();
      setSelectedStoreId(data.id);
    } catch (e: any) {
      toast({ title: "Error creating store", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStore = async (storeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this store? This cannot be undone.")) return;

    try {
      const { error } = await supabase
        .from("reseller_stores")
        .delete()
        .eq("id", storeId);
      
      if (error) throw error;
      
      toast({ title: "Store deleted successfully!" });
      if (selectedStoreId === storeId) {
        setSelectedStoreId(null);
      }
      await fetchStores();
    } catch (e: any) {
      toast({ title: "Error deleting store", description: e.message, variant: "destructive" });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const required = [
      form.full_name, form.whatsapp_number,
      form.support_number, form.momo_number, form.momo_network, form.momo_account_name,
    ];
    if (required.some((v) => !v.trim())) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    if (selectedStoreId && selectedStoreId !== "new") {
      if (!form.store_name.trim()) {
        toast({ title: "Store name is required", variant: "destructive" });
        return;
      }
    }

    setSaving(true);
    try {
      // 1. Update Profile (Central Details)
      const { error: profileError } = await supabase.from("profiles").update({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        whatsapp_number: form.whatsapp_number.trim(),
        support_number: form.support_number.trim(),
        whatsapp_group_link: form.whatsapp_group_link.trim() || null,
        momo_number: form.momo_number.trim(),
        momo_network: form.momo_network.trim(),
        momo_account_name: form.momo_account_name.trim(),
      }).eq("user_id", user.id);

      if (profileError) throw profileError;

      // 2. Update selected store details
      if (selectedStoreId && selectedStoreId !== "new") {
        const slug = generateSlug(form.store_name);
        const { error: storeError } = await supabase
          .from("reseller_stores")
          .update({
            store_name: form.store_name.trim(),
            store_logo_url: form.store_logo_url,
            store_banner_url: form.store_banner_url,
            store_description: form.store_description.trim() || null,
            store_primary_color: form.store_primary_color,
            custom_domain: form.custom_domain.trim() || null,
            slug,
          })
          .eq("id", selectedStoreId);

        if (storeError) throw storeError;
      }

      await refreshProfile();
      await fetchStores();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      toast({ title: "All settings saved successfully!" });
    } catch (e: any) {
      toast({ title: "Error saving settings", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const activeStore = stores.find((x) => x.id === selectedStoreId);
  const storeUrl = activeStore?.slug ? `${window.location.origin}/store/${activeStore.slug}` : null;
  const previewSlug = form.store_name ? generateSlug(form.store_name) : null;

  return (
    <div className="min-h-screen p-4 md:p-6 pb-24" style={{ background: "#0a0a0f" }}>
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Reseller Stores Manager</h1>
            <p className="text-sm text-white/40 mt-0.5">Configure your wholesale nodes and storefronts.</p>
          </div>
          
          <button
            type="button"
            onClick={() => setCreatingNew(true)}
            className="flex items-center gap-1.5 h-10 px-4 rounded-xl text-xs font-black text-amber-400 border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20 transition-all"
          >
            <Plus className="w-4 h-4" /> Create New Store
          </button>
        </div>

        {/* Create new store slider */}
        {creatingNew && (
          <div className="rounded-3xl p-5 border-2 border-dashed border-amber-400/20 space-y-4" style={{ background: "#111116" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Store className="w-5 h-5 text-amber-400" />
                <p className="text-sm font-black text-white">Create a New Storefront</p>
              </div>
              <button onClick={() => setCreatingNew(false)} className="text-white/40 hover:text-white transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <form onSubmit={handleCreateStore} className="flex gap-2">
              <input
                type="text"
                required
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
                placeholder="e.g. Kwame Wholesale Data"
                className="flex-1 h-11 rounded-2xl px-4 text-sm font-medium text-white border outline-none transition-all focus:border-amber-400/50 placeholder:text-white/20 bg-[#1a1a24]"
                style={{ borderColor: "rgba(255,255,255,0.08)" }}
              />
              <button
                type="submit"
                disabled={saving}
                className="h-11 px-5 rounded-2xl font-black text-xs bg-amber-400 text-black hover:bg-amber-500 transition-all disabled:opacity-50"
              >
                {saving ? "Creating..." : "Build Store"}
              </button>
            </form>
          </div>
        )}

        {/* Store Selector Carousel */}
        {!loadingStores && stores.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Select Active Store to Customize</p>
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
              {stores.map((s) => {
                const isActive = s.id === selectedStoreId;
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedStoreId(s.id);
                      setCreatingNew(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setSelectedStoreId(s.id);
                        setCreatingNew(false);
                      }
                    }}
                    className="flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left min-w-[200px] shrink-0 cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    style={{
                      background: isActive ? `${s.store_primary_color}11` : "#111116",
                      borderColor: isActive ? s.store_primary_color : "rgba(255,255,255,0.08)",
                      boxShadow: isActive ? `0 0 16px ${s.store_primary_color}1a` : "none",
                    }}
                  >
                    <div
                      className="w-10 h-10 rounded-xl overflow-hidden bg-white/5 flex items-center justify-center shrink-0 border"
                      style={{ borderColor: isActive ? s.store_primary_color : "rgba(255,255,255,0.1)" }}
                    >
                      {s.store_logo_url ? (
                        <img src={s.store_logo_url} alt="Logo" className="w-full h-full object-contain" />
                      ) : (
                        <Store className="w-4 h-4 text-white/30" />
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black text-white truncate">{s.store_name}</p>
                      <p className="text-[10px] text-white/40 truncate">/store/{s.slug}</p>
                    </div>

                    {stores.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteStore(s.id, e)}
                        className="text-white/20 hover:text-red-400 p-1 rounded-lg hover:bg-white/5 transition-all shrink-0 cursor-pointer"
                        title="Delete storefront"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Live URL banner for the active store */}
        {storeUrl && (
          <div className="rounded-2xl px-4 py-3 flex items-center gap-3 border border-emerald-500/20" style={{ background: "rgba(16,185,129,0.08)" }}>
            <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400/70 mb-0.5">Live Storefront URL</p>
              <p className="text-xs text-white/70 font-medium truncate">{storeUrl}</p>
            </div>
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          </div>
        )}

        {/* Tab system */}
        <div className="flex gap-2 p-1 rounded-2xl bg-white/4 border border-white/8 mb-4">
          {[
            { id: "store",     label: "Store Settings",     icon: Store },
            { id: "customers", label: "My Customers",       icon: User },
            { id: "deposits",  label: "Momo Deposits",      icon: CreditCard },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                type="button"
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all border-0 ${
                  active
                    ? "bg-amber-400 text-black shadow-md"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "store" && (
          loadingStores ? (
            <div className="h-64 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
              <p className="text-xs font-bold text-white/40">Loading store profiles...</p>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">

            {/* Profile Level Details */}
            <SECTION icon={User} title="Central Reseller Profile" description="Global contact information across all your stores">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Full Name" required>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                    <StyledInput
                      value={form.full_name}
                      onChange={(e) => update("full_name", e.target.value)}
                      placeholder="Kwame Asante"
                      maxLength={100}
                      style={{ paddingLeft: "2.25rem" }}
                    />
                  </div>
                </Field>
                <Field label="Email Address">
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                    <StyledInput
                      type="email"
                      value={form.email}
                      onChange={(e) => update("email", e.target.value)}
                      placeholder="kwame@example.com"
                      maxLength={255}
                      style={{ paddingLeft: "2.25rem" }}
                    />
                  </div>
                </Field>
                <Field label="Phone Number">
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                    <StyledInput
                      value={form.phone}
                      onChange={(e) => update("phone", e.target.value)}
                      placeholder="024 XXX XXXX"
                      maxLength={20}
                      style={{ paddingLeft: "2.25rem" }}
                    />
                  </div>
                </Field>
              </div>
            </SECTION>

            {selectedStoreId && selectedStoreId !== "new" && (
              <>
                {/* Store Branding Specific Details */}
                <SECTION icon={Palette} title="Storefront Customizer" description={`Branding overrides for: ${activeStore?.store_name || "Active Store"}`}>
                  <Field label="Storefront Name" required hint={previewSlug ? `URL slug: /store/${previewSlug}` : "Updates store layout and URL link"}>
                    <div className="relative">
                      <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                      <StyledInput
                        value={form.store_name}
                        onChange={(e) => update("store_name", e.target.value)}
                        placeholder="Kwame's Data Hub"
                        maxLength={100}
                        style={{ paddingLeft: "2.25rem" }}
                      />
                    </div>
                  </Field>

                  <Field label="Store Logo" hint="PNG, JPG or WebP — max 5MB">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      aria-label="Upload store logo"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleLogoUpload(file);
                        e.target.value = "";
                      }}
                    />

                    {form.store_logo_url ? (
                      <div className="flex items-center gap-3">
                        <div className="w-20 h-20 rounded-2xl border border-white/10 overflow-hidden bg-white flex items-center justify-center shrink-0">
                          <img src={form.store_logo_url} alt="Logo" className="w-full h-full object-contain" />
                        </div>
                        <div className="flex flex-col gap-2 flex-1">
                          <button
                            type="button"
                            onClick={() => logoInputRef.current?.click()}
                            disabled={uploadingLogo}
                            className="flex items-center gap-2 h-9 px-4 rounded-xl text-xs font-black text-amber-400 border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20 transition-all disabled:opacity-50"
                          >
                            {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            {uploadingLogo ? "Uploading…" : "Replace Logo"}
                          </button>
                          <button
                            type="button"
                            onClick={() => update("store_logo_url", "")}
                            className="flex items-center gap-2 h-9 px-4 rounded-xl text-xs font-bold text-white/40 border border-white/8 bg-white/4 hover:bg-white/8 transition-all"
                          >
                            <X className="w-3.5 h-3.5" /> Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        disabled={uploadingLogo}
                        className="w-full h-28 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all disabled:opacity-50"
                        style={{ borderColor: "rgba(255,255,255,0.12)", background: "#1a1a24" }}
                      >
                        {uploadingLogo ? (
                          <>
                            <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
                            <span className="text-xs font-bold text-white/40">Uploading…</span>
                          </>
                        ) : (
                          <>
                            <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "rgba(251,191,36,0.12)" }}>
                              <Upload className="w-5 h-5 text-amber-400" />
                            </div>
                            <div className="text-center">
                              <p className="text-sm font-black text-white/70">Tap to upload logo</p>
                              <p className="text-[10px] text-white/30">PNG, JPG, WebP · max 5MB</p>
                            </div>
                          </>
                        )}
                      </button>
                    )}
                  </Field>

                  <Field label="Store Banner Image" hint="PNG, JPG or WebP — max 10MB (recommended 1200x400 px)">
                    <input
                      ref={bannerInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      aria-label="Upload store banner"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleBannerUpload(file);
                        e.target.value = "";
                      }}
                    />

                    {form.store_banner_url ? (
                      <div className="flex flex-col gap-3">
                        <div className="w-full h-32 rounded-2xl border border-white/10 overflow-hidden bg-[#1a1a24] flex items-center justify-center relative">
                          <img src={form.store_banner_url} alt="Banner" className="w-full h-full object-cover" />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => bannerInputRef.current?.click()}
                            disabled={uploadingBanner}
                            className="flex items-center gap-2 h-9 px-4 rounded-xl text-xs font-black text-amber-400 border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20 transition-all disabled:opacity-50"
                          >
                            {uploadingBanner ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            {uploadingBanner ? "Uploading…" : "Replace Banner"}
                          </button>
                          <button
                            type="button"
                            onClick={() => update("store_banner_url", "")}
                            className="flex items-center gap-2 h-9 px-4 rounded-xl text-xs font-bold text-white/40 border border-white/8 bg-white/4 hover:bg-white/8 transition-all"
                          >
                            <X className="w-3.5 h-3.5" /> Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => bannerInputRef.current?.click()}
                        disabled={uploadingBanner}
                        className="w-full h-24 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all disabled:opacity-50"
                        style={{ borderColor: "rgba(255,255,255,0.12)", background: "#1a1a24" }}
                      >
                        {uploadingBanner ? (
                          <>
                            <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
                            <span className="text-xs font-bold text-white/40">Uploading…</span>
                          </>
                        ) : (
                          <>
                            <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "rgba(251,191,36,0.12)" }}>
                              <Upload className="w-5 h-5 text-amber-400" />
                            </div>
                            <div className="text-center">
                              <p className="text-sm font-black text-white/70">Tap to upload store banner</p>
                              <p className="text-[10px] text-white/30">PNG, JPG, WebP · max 10MB</p>
                            </div>
                          </>
                        )}
                      </button>
                    )}
                  </Field>

                  <Field label="Store Description" hint="Explain what your store offers. This will be shown on your home page.">
                    <textarea
                      value={form.store_description}
                      onChange={(e) => update("store_description", e.target.value)}
                      placeholder="Welcome to Kwame's Data Hub! We provide MTN wholesale bundles."
                      maxLength={500}
                      rows={3}
                      className="w-full rounded-2xl px-4 py-3 text-sm font-medium text-white border outline-none transition-all focus:border-amber-400/50 placeholder:text-white/20"
                      style={{ background: "#1a1a24", borderColor: "rgba(255,255,255,0.08)", resize: "none" }}
                    />
                  </Field>

                  <Field label="Primary Brand Color" hint="Used for buttons and accents on your store page">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          title={c}
                          aria-label={`Select color ${c}`}
                          onClick={() => update("store_primary_color", c)}
                          className="w-8 h-8 rounded-xl border-2 transition-all hover:scale-110 active:scale-95"
                          style={{
                            background: c,
                            borderColor: form.store_primary_color === c ? "white" : "transparent",
                            boxShadow: form.store_primary_color === c ? `0 0 0 3px ${c}55` : "none",
                          }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-2 items-center">
                      <div
                        className="w-11 h-11 rounded-2xl border-2 border-white/20 overflow-hidden shrink-0 cursor-pointer relative"
                        style={{ background: form.store_primary_color }}
                      >
                        <input
                          type="color"
                          title="Pick a custom color"
                          aria-label="Pick a custom color"
                          value={form.store_primary_color}
                          onChange={(e) => update("store_primary_color", e.target.value)}
                          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                        />
                      </div>
                      <StyledInput
                        value={form.store_primary_color}
                        onChange={(e) => update("store_primary_color", e.target.value)}
                        placeholder="#fbbf24"
                        maxLength={7}
                        className="font-mono"
                      />
                    </div>
                  </Field>
                </SECTION>

                {/* Custom Domain Section for active store */}
                <SECTION icon={Globe} title="Custom Domain Settings" description="Configure or purchase custom whitelabel domains for this store">
                  <Field 
                    label="Custom Domain Name" 
                    hint="Enter your domain name (e.g. data.mybrand.com) to point to this whitelabel storefront."
                  >
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                      <StyledInput
                        value={form.custom_domain}
                        onChange={(e) => update("custom_domain", e.target.value)}
                        placeholder="data.mybrand.com"
                        maxLength={100}
                        style={{ paddingLeft: "2.25rem" }}
                      />
                    </div>
                  </Field>

                  {/* DNS / CNAME verification status */}
                  <div className="rounded-2xl p-4 border border-white/6 space-y-2.5 bg-white/2">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${form.custom_domain && stores.find(x => x.id === selectedStoreId)?.domain_verified ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
                      <p className="text-xs font-black text-white/90 uppercase tracking-widest">
                        Verification Status: {form.custom_domain && stores.find(x => x.id === selectedStoreId)?.domain_verified ? "✅ Fully Verified" : "⏳ Pending Verification"}
                      </p>
                    </div>
                    
                    <p className="text-[11px] text-white/50 leading-relaxed">
                      Point a CNAME record at your external DNS provider:
                    </p>
                    <div className="rounded-xl p-3 font-mono text-[10px] text-white/80 space-y-1 bg-[#1a1a24]">
                      <div><span className="text-white/40">Type:</span> CNAME</div>
                      <div><span className="text-white/40">Host:</span> {form.custom_domain && form.custom_domain.includes(".") ? form.custom_domain.split(".")[0] : "@"}</div>
                      <div><span className="text-white/40">Value:</span> {window.location.host}</div>
                    </div>
                  </div>

                  {/* Premium Domain Marketplace Widget inside Settings */}
                  <div className="rounded-3xl border p-5 space-y-4 bg-gradient-to-r from-amber-400/5 to-amber-600/5 border-amber-400/20">
                    <div className="flex items-center gap-2">
                      <Globe className="w-5 h-5 text-amber-400" />
                      <div>
                        <h5 className="text-xs font-black uppercase text-amber-400 tracking-wider">Search & Buy a Custom Domain</h5>
                        <p className="text-[10px] text-white/40">Register a new domain instantly with your wallet balance</p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={searchDomainText}
                        onChange={(e) => setSearchDomainText(e.target.value)}
                        placeholder="e.g. mywholesalebundles"
                        className="flex-1 h-11 rounded-2xl px-4 text-sm font-medium bg-[#1a1a24] border border-white/8 outline-none focus:border-amber-400 transition-all text-white"
                      />
                      <button
                        type="button"
                        onClick={handleSearchDomain}
                        disabled={searchingDomain}
                        className="h-11 px-5 rounded-2xl font-black text-xs uppercase bg-amber-400 text-black hover:bg-amber-500 transition-all disabled:opacity-50 flex items-center gap-1.5 border-0 cursor-pointer"
                      >
                        {searchingDomain ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                        Search
                      </button>
                    </div>

                    {searchResults.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                        {searchResults.map((res: any) => (
                          <div 
                            key={res.domain} 
                            className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                              res.available 
                                ? "bg-[#16161e] border-white/5 hover:border-amber-400/30" 
                                : "bg-white/1 border-white/4 opacity-50"
                            }`}
                          >
                            <div>
                              <p className="text-xs font-black text-white truncate">{res.domain}</p>
                              <div className="flex flex-col gap-0.5">
                                <p className="text-[9px] font-bold text-white/30 uppercase mt-0.5 tracking-wider">
                                  {res.available ? "✅ Available" : "❌ Taken"}
                                </p>
                                {!res.available && res.message && res.message !== "Domain is already registered" && (
                                  <p className="text-[8px] font-medium text-red-400/80 leading-tight">
                                    {res.message}
                                  </p>
                                )}
                              </div>
                            </div>

                            {res.available && (
                              <div className="flex items-center justify-between gap-2 pt-1">
                                <span className="text-sm font-black text-amber-400 font-mono">₵{Number(res.price_ghs).toFixed(2)}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedDomainToBuy(res);
                                    setShowDomainModal(true);
                                  }}
                                  className="h-8 px-3 rounded-xl bg-amber-400 text-black font-black text-[10px] uppercase hover:bg-amber-500 transition-all border-0 cursor-pointer"
                                >
                                  Buy
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </SECTION>

                {/* Checkout Dialog Modal */}
                {showDomainModal && selectedDomainToBuy && (
                  <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 animate-in fade-in duration-300">
                    <div className="absolute inset-0 bg-black/85 backdrop-blur-md" onClick={() => !buyingDomain && setShowDomainModal(false)} />
                    <div className="relative max-w-sm w-full bg-[#111116] border border-white/10 rounded-3xl p-6 text-left space-y-6 animate-in zoom-in-95 duration-200">
                      <div>
                        <h3 className="text-base font-black text-white">Purchase Custom Domain</h3>
                        <p className="text-xs text-white/45 mt-0.5">Instant registration and automated whitelabel pointing</p>
                      </div>

                      <div className="rounded-2xl border border-white/6 p-4 space-y-3 bg-white/2">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-white/40">Domain Name</span>
                          <span className="text-xs font-black text-white font-mono">{selectedDomainToBuy.domain}</span>
                        </div>
                        <div className="flex justify-between items-center border-t border-white/6 pt-2.5">
                          <span className="text-xs font-bold text-white/40">Price (1 Year)</span>
                          <span className="text-sm font-black text-amber-400 font-mono">₵{Number(selectedDomainToBuy.price_ghs).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center border-t border-white/6 pt-2.5">
                          <span className="text-xs font-bold text-white/40">Your Wallet</span>
                          <span className="text-xs font-bold text-white/80 font-mono">₵{agentWalletBalance.toFixed(2)}</span>
                        </div>
                      </div>

                      {buyStep === "idle" && (
                        <div className="flex gap-3">
                          <button
                            type="button"
                            onClick={() => setShowDomainModal(false)}
                            className="flex-1 h-11 rounded-2xl bg-white/5 hover:bg-white/10 text-white text-xs font-black uppercase border border-white/8 transition-all cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handlePurchaseDomain}
                            className="flex-1 h-11 rounded-2xl bg-amber-400 text-black text-xs font-black uppercase hover:bg-amber-500 transition-all border-0 cursor-pointer"
                          >
                            Confirm Purchase
                          </button>
                        </div>
                      )}

                      {buyStep !== "idle" && buyStep !== "error" && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-3">
                            <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                            <p className="text-xs font-bold text-white">
                              {buyStep === "debiting" && "🪙 Securing funds & debiting wallet..."}
                              {buyStep === "registering" && "🌐 Registering domain with registrar..."}
                              {buyStep === "activating" && "🔒 Connecting storefront SSL certificates..."}
                              {buyStep === "success" && "🎉 Storefront successfully activated!"}
                            </p>
                          </div>

                          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-amber-400 transition-all duration-500" 
                              style={{
                                width: 
                                  buyStep === "debiting" ? "25%" :
                                  buyStep === "registering" ? "60%" :
                                  buyStep === "activating" ? "85%" : "100%"
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {buyStep === "error" && (
                        <div className="space-y-4">
                          <div className="rounded-2xl border border-red-500/20 p-4 bg-red-500/8 space-y-2">
                            <div className="flex items-center gap-2 text-red-400">
                              <XCircle className="w-5 h-5 shrink-0" />
                              <p className="text-xs font-black uppercase tracking-wider">Purchase Failed</p>
                            </div>
                            <p className="text-[11px] text-white/60 leading-relaxed">{buyError}</p>
                          </div>
                          
                          <button
                            type="button"
                            onClick={() => setBuyStep("idle")}
                            className="w-full h-11 rounded-2xl bg-white/5 hover:bg-white/10 text-white text-xs font-black uppercase border border-white/8 transition-all cursor-pointer"
                          >
                            Try Again
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Central Payout Channels */}
            <SECTION icon={MessageCircle} title="Contact & Cashout Channels" description="Profile-level Momo network and customer support channels">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="WhatsApp Number" required>
                  <div className="relative">
                    <MessageCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                    <StyledInput
                      value={form.whatsapp_number}
                      onChange={(e) => update("whatsapp_number", e.target.value)}
                      placeholder="024 XXX XXXX"
                      maxLength={20}
                      style={{ paddingLeft: "2.25rem" }}
                    />
                  </div>
                </Field>
                <Field label="Support Number" required>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                    <StyledInput
                      value={form.support_number}
                      onChange={(e) => update("support_number", e.target.value)}
                      placeholder="020 XXX XXXX"
                      maxLength={20}
                      style={{ paddingLeft: "2.25rem" }}
                    />
                  </div>
                </Field>
              </div>
              
              <Field label="WhatsApp Group Link">
                <div className="relative">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                  <StyledInput
                    value={form.whatsapp_group_link}
                    onChange={(e) => update("whatsapp_group_link", e.target.value)}
                    placeholder="https://chat.whatsapp.com/..."
                    maxLength={500}
                    style={{ paddingLeft: "2.25rem" }}
                  />
                </div>
              </Field>

              <Field label="MoMo Network" required>
                <div className="grid grid-cols-3 gap-2">
                  {MOMO_NETWORKS.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => update("momo_network", n.id)}
                      className="h-11 rounded-2xl flex items-center justify-center gap-1.5 text-xs font-black border-2 transition-all"
                      style={
                        form.momo_network === n.id
                          ? { background: `${n.color}22`, borderColor: n.color, color: n.color }
                          : { background: "#1a1a24", borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }
                      }
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      {n.id}
                    </button>
                  ))}
                </div>
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="MoMo Account Name" required>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                    <StyledInput
                      value={form.momo_account_name}
                      onChange={(e) => update("momo_account_name", e.target.value)}
                      placeholder="Kwame Asante"
                      maxLength={100}
                      style={{ paddingLeft: "2.25rem" }}
                    />
                  </div>
                </Field>
                <Field label="MoMo Number" required>
                  <div className="relative">
                    <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                    <StyledInput
                      value={form.momo_number}
                      onChange={(e) => update("momo_number", e.target.value)}
                      placeholder="024 XXX XXXX"
                      maxLength={20}
                      style={{ paddingLeft: "2.25rem" }}
                    />
                  </div>
                </Field>
              </div>
            </SECTION>

            {/* Save button */}
            <button
              type="submit"
              disabled={saving}
              className="w-full h-14 rounded-3xl font-black text-base transition-all flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
              style={{
                background: saved
                  ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                  : "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                color: "#000",
                boxShadow: saved
                  ? "0 4px 24px rgba(16,185,129,0.35)"
                  : "0 4px 24px rgba(251,191,36,0.35)",
              }}
            >
              {saving ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Saving changes...</>
              ) : saved ? (
                <><CheckCircle2 className="w-5 h-5" /> All settings saved successfully!</>
              ) : (
                "Save Active Storefront & Profile"
              )}
            </button>

          </form>
        ))}

        {/* ── Customers Management Tab ── */}
        {activeTab === "customers" && (
          <div className="space-y-4">
            <div className="rounded-3xl border border-white/8 overflow-hidden" style={{ background: "#111116" }}>
              <div className="flex items-center gap-3 px-5 py-4 border-b border-white/6 bg-white/2">
                <div className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 bg-amber-400/10 border border-amber-400/20">
                  <User className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-black text-white">Registered Storefront Customers</p>
                  <p className="text-[11px] text-white/40">Manage your whitelabel store users and direct balance updates</p>
                </div>
              </div>

              <div className="p-5">
                {loadingCustomers ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-2">
                    <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
                    <p className="text-xs font-bold text-white/40">Loading customer profiles...</p>
                  </div>
                ) : customers.length === 0 ? (
                  <div className="py-12 text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center mx-auto text-white/20">
                      <User className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-white">No Customers Registered Yet</p>
                      <p className="text-xs text-white/40 max-w-xs mx-auto mt-1 leading-relaxed">
                        When users register on your whitelabel store, they will instantly appear here!
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {customers.map((c) => (
                      <div key={c.user_id} className="p-4 rounded-2xl bg-[#1c1c24] border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-xs font-black text-white">{c.full_name || "Anonymous Customer"}</p>
                          <p className="text-[10px] text-white/40 font-mono">{c.email}</p>
                          {c.phone && <p className="text-[10px] text-white/40">{c.phone}</p>}
                        </div>

                        <div className="flex items-center gap-4 self-end sm:self-auto">
                          <div className="text-right">
                            <p className="text-[9px] font-bold text-white/30 uppercase tracking-wider">Balance</p>
                            <p className="text-base font-black text-amber-400 font-mono mt-0.5">₵{Number(c.balance || 0).toFixed(2)}</p>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setEditingCustomer(c);
                              setNewBalance(String(c.balance || 0));
                            }}
                            className="h-10 px-3.5 rounded-xl bg-white/5 hover:bg-white/10 text-white flex items-center gap-1.5 text-xs font-bold transition-all border border-white/8 active:scale-95"
                          >
                            <Edit className="w-3.5 h-3.5" />
                            Edit
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Edit Balance Popup Overlay */}
            {editingCustomer && (
              <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 animate-in fade-in duration-300">
                <div className="absolute inset-0 bg-black/85 backdrop-blur-md" onClick={() => setEditingCustomer(null)} />
                <div className="relative max-w-xs w-full bg-[#111116] border border-white/10 rounded-3xl p-6 text-left space-y-4 animate-in zoom-in-95 duration-200">
                  <div>
                    <h3 className="text-sm font-black text-white">Adjust Customer Balance</h3>
                    <p className="text-[10px] text-white/40 font-bold uppercase mt-0.5 tracking-wider">{editingCustomer.full_name || editingCustomer.email}</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-black uppercase text-white/40 tracking-wider">Wallet Balance (GHS)</label>
                    <input
                      type="number"
                      value={newBalance}
                      onChange={(e) => setNewBalance(e.target.value)}
                      className="w-full h-11 rounded-2xl bg-white/5 border border-white/8 px-4 text-sm font-bold text-white focus:outline-none focus:border-amber-400 transition-colors"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingCustomer(null)}
                      className="flex-1 h-11 rounded-2xl bg-white/5 text-white text-xs font-black uppercase border border-white/8 active:scale-95 transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={savingBalance}
                      onClick={handleSaveBalance}
                      className="flex-1 h-11 rounded-2xl bg-amber-400 text-black text-xs font-black uppercase active:scale-95 transition-all flex items-center justify-center gap-1.5 border-0"
                    >
                      {savingBalance ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Momo Deposits Approval Tab ── */}
        {activeTab === "deposits" && (
          <div className="space-y-4">
            <div className="rounded-3xl border border-white/8 overflow-hidden" style={{ background: "#111116" }}>
              <div className="flex items-center gap-3 px-5 py-4 border-b border-white/6 bg-white/2">
                <div className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 bg-amber-400/10 border border-amber-400/20">
                  <CreditCard className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-black text-white">Manual Momo Deposit Approvals</p>
                  <p className="text-[11px] text-white/40">Verify offline customer MoMo payments and credit wallets instantly</p>
                </div>
              </div>

              <div className="p-5">
                {loadingDeposits ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-2">
                    <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
                    <p className="text-xs font-bold text-white/40">Loading deposit requests...</p>
                  </div>
                ) : deposits.length === 0 ? (
                  <div className="py-12 text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center mx-auto text-white/20">
                      <CreditCard className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-white">No Deposit Requests Yet</p>
                      <p className="text-xs text-white/40 max-w-xs mx-auto mt-1 leading-relaxed">
                        When customers submit Manual Momo Funding requests, they will instantly appear here for your verification and approval!
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {deposits.map((d) => {
                      const isPending = d.status === "pending";
                      const customerName = d.profiles?.full_name || d.profiles?.email || "Anonymous";
                      
                      return (
                        <div key={d.id} className="p-4 rounded-2xl bg-[#1c1c24] border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex items-center gap-2.5">
                              <span className="text-xs font-black text-white">{customerName}</span>
                              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                                d.status === "approved"
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : d.status === "declined"
                                  ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                  : "bg-amber-400/10 text-amber-400 border border-amber-400/20 animate-pulse"
                              }`}>
                                {d.status}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 font-mono text-[10px] text-white/50">
                              <div><span className="text-white/25">Sender:</span> {d.sender_number}</div>
                              <div className="flex items-center gap-1">
                                <span className="text-white/25">Ref:</span>
                                <span className="truncate max-w-[120px]">{d.transaction_reference}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(d.transaction_reference);
                                    toast({ title: "Copied!", description: "Transaction reference copied to clipboard.", variant: "default" });
                                  }}
                                  className="text-white/30 hover:text-white/80 p-0.5 hover:bg-white/5 rounded"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                              <div><span className="text-white/25">Date:</span> {new Date(d.created_at).toLocaleDateString()}</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 justify-between md:justify-end self-stretch md:self-auto pt-2 md:pt-0 border-t md:border-t-0 border-white/5">
                            <div className="text-left md:text-right">
                              <p className="text-[9px] font-bold text-white/30 uppercase tracking-wider">Amount</p>
                              <p className="text-lg font-black text-emerald-400 font-mono mt-0.5">₵{Number(d.amount).toFixed(2)}</p>
                            </div>

                            {isPending && (
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={processingDepositId !== null}
                                  onClick={() => handleDeclineDeposit(d.id)}
                                  className="h-10 w-10 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 flex items-center justify-center transition-all active:scale-95 disabled:opacity-40"
                                >
                                  {processingDepositId === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                                </button>

                                <button
                                  type="button"
                                  disabled={processingDepositId !== null}
                                  onClick={() => handleApproveDeposit(d.id)}
                                  className="h-10 px-4 rounded-xl bg-emerald-500 text-black flex items-center justify-center gap-1.5 text-xs font-black transition-all active:scale-95 disabled:opacity-40 border-0"
                                >
                                  {processingDepositId === d.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <>
                                      <Check className="w-4 h-4" />
                                      Approve
                                    </>
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardSettings;
