import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { basePackages, generateSlug } from "@/lib/data";
import { cn } from "@/lib/utils";
import {
  Store,
  LayoutDashboard,
  CreditCard,
  Users,
  Palette,
  DollarSign,
  Settings as SettingsIcon,
  Loader2,
  CheckCircle2,
  XCircle,
  Copy,
  ExternalLink,
  Download,
  Upload,
  ChevronRight,
  QrCode,
  Globe,
  X,
  Plus,
  Trash2,
  Edit2,
  Check,
  Phone,
  MessageCircle,
  AlertCircle,
  TrendingUp,
  Wallet,
  Search,
  ArrowDownToLine,
  Clock,
  Fingerprint,
  Key,
  Lock,
  ShieldCheck,
  HandCoins,
  RefreshCw
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useWebAuthn } from "@/hooks/useWebAuthn";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Safe SVG QR renderer
const SafeQRCodeSVG = (props: any) => {
  try {
    return <QRCodeSVG {...props} />;
  } catch (e) {
    console.error("QRCodeSVG render error:", e);
    return (
      <div className="w-[180px] h-[180px] bg-secondary flex items-center justify-center text-[10px] text-muted-foreground text-center p-4">
        QR Code unavailable
      </div>
    );
  }
};

const PRESET_COLORS = [
  "#fbbf24", "#f59e0b", "#ef4444", "#ec4899",
  "#8b5cf6", "#6366f1", "#3b82f6", "#06b6d4",
  "#10b981", "#84cc16", "#f97316", "#ffffff",
];

const GRADIENT_PRESETS = [
  { id: "amber", name: "Crimson Amber", value: "linear-gradient(135deg, #fbbf24, #f59e0b, #ef4444)", color: "#f59e0b" },
  { id: "ocean", name: "Ocean Glass", value: "linear-gradient(135deg, #0284c7, #06b6d4, #10b981)", color: "#06b6d4" },
  { id: "velvet", name: "Velvet Night", value: "linear-gradient(135deg, #8b5cf6, #6366f1, #3b82f6)", color: "#8b5cf6" },
  { id: "mint", name: "Emerald Mint", value: "linear-gradient(135deg, #10b981, #84cc16, #06b6d4)", color: "#10b981" },
];

const MOMO_NETWORKS = [
  { id: "MTN", label: "MTN MoMo", color: "#fbbf24" },
  { id: "Telecel", label: "Telecel Cash", color: "#ef4444" },
  { id: "AirtelTigo", label: "AirtelTigo Money", color: "#3b82f6" },
];

const WITHDRAWAL_FEE_FLAT = 1.00;
const WITHDRAWAL_FEE_PERCENT = 0.01; // 1%

export default function DashboardMyStore() {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [stores, setStores] = useState<any[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activationFee, setActivationFee] = useState(50);
  const [copiedStoreId, setCopiedStoreId] = useState<string | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<"overview" | "design" | "pricing" | "customers" | "deposits" | "withdrawals" | "settings">("overview");

  // Withdrawal States & Hook
  const { isSupported, credentials, authenticate } = useWebAuthn();
  const hasBiometric = isSupported && credentials.length > 0;

  const [totalProfit, setTotalProfit] = useState(0);
  const [completedWithdrawals, setCompletedWithdrawals] = useState(0);
  const [pendingWithdrawals, setPendingWithdrawals] = useState(0);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);
  const [confirmWithdrawOpen, setConfirmWithdrawOpen] = useState(false);
  const [pinWithdrawDialogOpen, setPinWithdrawDialogOpen] = useState(false);
  const [enteredWithdrawPin, setEnteredWithdrawPin] = useState("");
  const [biometricWithdrawScanning, setBiometricWithdrawScanning] = useState(false);
  const [minWithdrawal, setMinWithdrawal] = useState(25);
  const [maxWithdrawal, setMaxWithdrawal] = useState(5000);
  const [withdrawalSystemEnabled, setWithdrawalSystemEnabled] = useState(true);

  // Core Data lists
  const [customers, setCustomers] = useState<any[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [loadingDeposits, setLoadingDeposits] = useState(false);
  const [agentWalletBalance, setAgentWalletBalance] = useState<number>(0);
  const [globalPkgSettings, setGlobalPkgSettings] = useState<any[]>([]);

  // Creation State
  const [creatingNew, setCreatingNew] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");

  // Uploading States
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  // Balance Adjustment state
  const [editingCustomer, setEditingCustomer] = useState<any | null>(null);
  const [newBalance, setNewBalance] = useState("");
  const [savingBalance, setSavingBalance] = useState(false);

  // Deposit Processing state
  const [processingDepositId, setProcessingDepositId] = useState<string | null>(null);

  // Custom Pricing State
  const [customPrices, setCustomPrices] = useState<Record<string, Record<string, number>>>({});

  // Domain Search & Purchase States
  const [searchDomainText, setSearchDomainText] = useState("");
  const [searchingDomain, setSearchingDomain] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [buyingDomain, setBuyingDomain] = useState(false);
  const [buyStep, setBuyStep] = useState<"idle" | "debiting" | "registering" | "activating" | "success" | "error">("idle");
  const [buyError, setBuyError] = useState("");
  const [showDomainModal, setShowDomainModal] = useState(false);
  const [selectedDomainToBuy, setSelectedDomainToBuy] = useState<any | null>(null);

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
          checkedResults.push({
            domain: fullDomain,
            tld: extension,
            available: true,
            price_ghs: prices[extension] || 150,
            message: "Domain is available"
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

      if (error || !data || !data.success) {
        throw new Error(error?.message || data?.error || "Registration failed.");
      }

      setBuyStep("activating");
      await new Promise(r => setTimeout(r, 1200));

      setBuyStep("success");
      
      updateField("custom_domain", domain);
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

  // Settings / Design forms matching database schema
  const [form, setForm] = useState({
    store_name: "",
    store_logo_url: "",
    store_banner_url: "",
    store_description: "",
    store_primary_color: "#fbbf24",
    custom_domain: "",
    momo_number: "",
    momo_network: "",
    momo_account_name: "",
    whatsapp_number: "",
    support_number: "",
    whatsapp_group_link: "",
  });

  const qrRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    // 1. Fetch System Settings activation fee
    supabase
      .from("system_settings")
      .select("agent_activation_fee")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.agent_activation_fee) {
          setActivationFee(Number(data.agent_activation_fee));
        }
      });

    // 2. Fetch Agent's stores
    if (user) {
      fetchStores();
      fetchAgentWallet();
      fetchGlobalPackageSettings();
    }
  }, [user, profile]);

  // Sync profile central data to form
  useEffect(() => {
    if (profile) {
      setForm((f) => ({
        ...f,
        whatsapp_number: profile.whatsapp_number || "",
        support_number: profile.support_number || "",
        whatsapp_group_link: profile.whatsapp_group_link || "",
        momo_number: profile.momo_number || "",
        momo_network: profile.momo_network || "",
        momo_account_name: profile.momo_account_name || "",
      }));
      setCustomPrices((profile.agent_prices || {}) as Record<string, Record<string, number>>);
    }
  }, [profile]);

  // Sync active store data to form
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

  // Load contextual data based on active tab
  useEffect(() => {
    if (!user) return;
    if (activeTab === "customers") {
      fetchCustomers();
    } else if (activeTab === "deposits") {
      fetchDeposits();
    } else if (activeTab === "withdrawals") {
      fetchWithdrawalData();
    } else if (activeTab === "overview") {
      fetchCustomers();
      fetchDeposits();
      fetchAgentWallet();
    }
  }, [activeTab, user]);

  const fetchWithdrawalData = useCallback(async () => {
    if (!user) return;
    setLoadingWithdrawals(true);
    try {
      const [ordersRes, parentRes, withdrawalsRes, walletRes] = await Promise.all([
        supabase.from("orders").select("profit").eq("agent_id", user.id).eq("status", "fulfilled"),
        supabase.from("orders").select("parent_profit").eq("parent_agent_id", user.id).eq("status", "fulfilled"),
        supabase.from("withdrawals").select("*").eq("agent_id", user.id).order("created_at", { ascending: false }),
        supabase.from("wallets").select("balance").eq("agent_id", user.id).maybeSingle(),
      ]);

      let settingsRes: any = { data: null };
      try {
        settingsRes = await supabase
          .from("public_system_settings")
          .select("min_withdrawal_amount, max_withdrawal_amount, withdrawal_system_enabled")
          .eq("id", 1)
          .maybeSingle();
      } catch (err) {
        // ignore
      }

      const profits = (ordersRes.data || []).reduce((sum, o: any) => sum + (o.profit || 0), 0);
      const parentProfits = (parentRes.data || []).reduce((sum, o: any) => sum + (o.parent_profit || 0), 0);
      setTotalProfit(parseFloat((profits + parentProfits).toFixed(2)));

      const wds = withdrawalsRes.data || [];
      setWithdrawals(wds);

      const completed = wds
        .filter((w: any) => w.status === "completed")
        .reduce((sum: number, w: any) => sum + w.amount, 0);
      
      const pending = wds
        .filter((w: any) => ["pending", "processing"].includes(w.status))
        .reduce((sum: number, w: any) => sum + w.amount, 0);

      setCompletedWithdrawals(completed);
      setPendingWithdrawals(pending);

      if (settingsRes.data) {
        setMinWithdrawal(Number(settingsRes.data.min_withdrawal_amount) || 25);
        setMaxWithdrawal(Number(settingsRes.data.max_withdrawal_amount) || 5000);
        setWithdrawalSystemEnabled(settingsRes.data.withdrawal_system_enabled !== false);
      }
    } catch (err) {
      console.error("Error fetching withdrawal data:", err);
    } finally {
      setLoadingWithdrawals(false);
    }
  }, [user]);

  const handleWithdraw = async () => {
    setConfirmWithdrawOpen(false);
    setWithdrawing(true);

    const numAmount = parseFloat(withdrawalAmount);
    if (!withdrawalSystemEnabled) {
      toast({ title: "Request failed", description: "Withdrawals are temporarily disabled for maintenance.", variant: "destructive" });
      setWithdrawing(false);
      return;
    }

    if (isNaN(numAmount) || numAmount < minWithdrawal) {
      toast({ title: "Request failed", description: `Minimum withdrawal is GHS ${minWithdrawal.toFixed(2)}`, variant: "destructive" });
      setWithdrawing(false);
      return;
    }

    const availableBalance = parseFloat((totalProfit - (completedWithdrawals + pendingWithdrawals)).toFixed(2));
    if (numAmount > availableBalance) {
      toast({ title: "Request failed", description: "Amount exceeds available balance", variant: "destructive" });
      setWithdrawing(false);
      return;
    }

    if (numAmount > maxWithdrawal) {
      toast({ title: "Request failed", description: `Maximum withdrawal is GHS ${maxWithdrawal.toFixed(2)}`, variant: "destructive" });
      setWithdrawing(false);
      return;
    }

    if (profile?.last_security_update) {
      const lastUpdate = new Date(profile.last_security_update);
      const now = new Date();
      const diffHours = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);
      if (diffHours < 24) {
        toast({
          title: "Security Hold Active",
          description: `You recently updated your security settings. Withdrawals are disabled for 24 hours (approx. ${Math.ceil(24 - diffHours)} hours remaining).`,
          variant: "destructive"
        });
        setWithdrawing(false);
        return;
      }
    }

    try {
      const { data, error } = await supabase.functions.invoke("agent-withdraw", {
        body: { amount: numAmount },
      });

      if (error || data?.error) {
        const errorMsg = data?.error || await getFunctionErrorMessage(error, "Withdrawal failed. Please try again.");
        toast({ title: "Withdrawal failed", description: errorMsg, variant: "destructive" });
      } else {
        toast({ title: "Withdrawal request placed!", description: "You will receive your funds within 24 hours." });
        setWithdrawalAmount("");
        setEnteredWithdrawPin("");
      }
    } catch (err: any) {
      toast({ title: "Request error", description: err.message || "An unexpected error occurred.", variant: "destructive" });
    } finally {
      await fetchWithdrawalData();
      setWithdrawing(false);
    }
  };

  const handleBiometricCheck = async () => {
    const n = parseFloat(withdrawalAmount);
    if (isNaN(n) || n < minWithdrawal) {
      toast({ title: "Error", description: `Minimum withdrawal is GHS ${minWithdrawal.toFixed(2)}`, variant: "destructive" });
      return;
    }
    const availableBalance = parseFloat((totalProfit - (completedWithdrawals + pendingWithdrawals)).toFixed(2));
    if (n > availableBalance) {
      toast({ title: "Error", description: "Amount exceeds available balance", variant: "destructive" });
      return;
    }
    if (n > maxWithdrawal) {
      toast({ title: "Error", description: `Maximum withdrawal is GHS ${maxWithdrawal.toFixed(2)}`, variant: "destructive" });
      return;
    }
    if (hasBiometric) {
      setBiometricWithdrawScanning(true);
      try {
        const ok = await authenticate();
        if (!ok) {
          toast({ title: "Error", description: "Biometric check failed. Withdrawal blocked.", variant: "destructive" });
          return;
        }
      } catch (e: any) {
        const msg: string = e?.message ?? "";
        if (msg.includes("cancelled") || msg.includes("NotAllowedError")) {
          toast({ title: "Authentication cancelled", description: "Please authenticate to complete withdrawal." });
        } else {
          toast({ title: "Biometric error", description: msg, variant: "destructive" });
        }
        return;
      } finally {
        setBiometricWithdrawScanning(false);
      }
    } else if (profile?.transaction_pin) {
      setPinWithdrawDialogOpen(true);
      return;
    } else {
      toast({
        title: "Security Required",
        description: "Please set a Transaction PIN or Biometric in Account Settings to secure your withdrawals.",
        variant: "destructive"
      });
      return;
    }
    setConfirmWithdrawOpen(true);
  };

  const handleVerifyMomoName = async () => {
    if (!profile?.momo_number || !profile?.momo_network) {
       toast({ title: "Details Missing", description: "Set your MoMo number and network in Settings first.", variant: "destructive" });
       return;
    }
    
    toast({ title: "Resolving account identity...", description: "Talking to Paystack gateways." });
    try {
      const net = profile.momo_network.toUpperCase();
      let bankCode = "MTN";
      if (net.includes("VODA") || net.includes("TELECEL")) bankCode = "VOD";
      if (net.includes("AIRTEL") || net.includes("TIGO") || net.includes("AT")) bankCode = "ATL";

      const { data, error } = await supabase.functions.invoke("paystack-resolve", {
        body: { account_number: profile.momo_number, bank_code: bankCode }
      });

      if (error || !data?.success) throw new Error(data?.error || "Could not resolve name");

      await supabase.from("profiles").update({ momo_account_name: data.account_name }).eq("user_id", user?.id);
      
      toast({ title: "Identity Verified!", description: `Account resolved to: ${data.account_name}` });
      await refreshProfile();
      await fetchWithdrawalData();
    } catch (e: any) {
      toast({ title: "Verification Failed", description: e.message, variant: "destructive" });
    }
  };

  const fetchStores = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("reseller_stores")
        .select("*")
        .eq("user_id", user?.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      
      let currentStores = data || [];
      const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);
      
      if (currentStores.length === 0 && isPaidAgent && profile?.store_name && profile?.slug) {
        console.log("[MyStore] Auto-healing: Creating missing reseller store storefront");
        const { data: newStore, error: insertError } = await supabase
          .from("reseller_stores")
          .insert({
            user_id: user?.id,
            store_name: profile.store_name,
            slug: profile.slug,
            store_primary_color: profile.store_primary_color || PRESET_COLORS[0],
            store_logo_url: profile.store_logo_url || null,
          })
          .select()
          .single();
        if (!insertError && newStore) {
          currentStores = [newStore];
        }
      }
      
      setStores(currentStores);

      if (currentStores.length > 0 && !selectedStoreId) {
        setSelectedStoreId(currentStores[0].id);
      }
    } catch (e: any) {
      console.error("Error loading stores:", e);
    } finally {
      setLoading(false);
    }
  };

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

  const fetchGlobalPackageSettings = async () => {
    try {
      const { data } = await supabase
        .from("global_package_settings")
        .select("network, package_size, agent_price, public_price, is_unavailable");
      if (data) {
        setGlobalPkgSettings(data);
      }
    } catch (e) {
      console.error("Error fetching global pkg prices:", e);
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
      toast({ title: "Customers load error", description: e.message, variant: "destructive" });
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
      toast({ title: "Deposits load error", description: e.message, variant: "destructive" });
    } finally {
      setLoadingDeposits(false);
    }
  };

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!newStoreName.trim()) return;

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

      toast({ title: "🎉 Storefront created successfully!" });
      setNewStoreName("");
      setCreatingNew(false);
      await fetchStores();
      if (data) setSelectedStoreId(data.id);
    } catch (e: any) {
      toast({ title: "Store creation failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStore = async (storeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this store storefront? This cannot be undone.")) return;

    try {
      const { error } = await supabase
        .from("reseller_stores")
        .delete()
        .eq("id", storeId);

      if (error) throw error;

      toast({ title: "Store deleted successfully." });
      await fetchStores();
      if (selectedStoreId === storeId) {
        setSelectedStoreId(null);
      }
    } catch (e: any) {
      toast({ title: "Store delete failed", description: e.message, variant: "destructive" });
    }
  };

  const updateField = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleLogoUpload = async (file: File) => {
    if (!user) return;
    setUploadingLogo(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `store-logos/${user.id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("site-assets")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;

      const { data } = supabase.storage.from("site-assets").getPublicUrl(path);
      updateField("store_logo_url", data.publicUrl);
      toast({ title: "Logo uploaded and saved locally!" });
    } catch (e: any) {
      toast({ title: "Logo upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleBannerUpload = async (file: File) => {
    if (!user) return;
    setUploadingBanner(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `store-banners/${user.id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("site-assets")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;

      const { data } = supabase.storage.from("site-assets").getPublicUrl(path);
      updateField("store_banner_url", data.publicUrl);
      toast({ title: "Banner uploaded and saved locally!" });
    } catch (e: any) {
      toast({ title: "Banner upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedStoreId) return;

    setSaving(true);
    try {
      const slug = generateSlug(form.store_name);

      // 1. Update reseller profiles fields (keeping store metadata in sync)
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          whatsapp_number: form.whatsapp_number.trim(),
          support_number: form.support_number.trim(),
          whatsapp_group_link: form.whatsapp_group_link.trim() || null,
          momo_number: form.momo_number.trim(),
          momo_network: form.momo_network.trim(),
          momo_account_name: form.momo_account_name.trim(),
          store_name: form.store_name.trim(),
          slug,
          store_logo_url: form.store_logo_url || null,
          store_primary_color: form.store_primary_color || "#fbbf24",
        })
        .eq("user_id", user.id);

      if (profileError) throw profileError;

      // 2. Update reseller store specific options
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

      await refreshProfile();
      await fetchStores();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      toast({ title: "Store settings saved successfully!" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSavePricing = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          agent_prices: customPrices,
        })
        .eq("user_id", user.id);
      if (error) throw error;
      toast({ title: "Custom bundle prices saved!" });
      await refreshProfile();
    } catch (e: any) {
      toast({ title: "Pricing save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleApproveDeposit = async (id: string) => {
    setProcessingDepositId(id);
    try {
      const { data, error } = await supabase.rpc("approve_store_deposit", { deposit_id: id });
      if (error) throw error;

      if (data && !data.success) {
        throw new Error(data.error || "Fulfillment approval failed.");
      }

      toast({ title: "Deposit Approved!", description: "Customer has been credited." });
      await fetchDeposits();
      await fetchAgentWallet();
    } catch (e: any) {
      toast({ title: "Approval error", description: e.message, variant: "destructive" });
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
      toast({ title: "Deposit marked as declined." });
      await fetchDeposits();
    } catch (e: any) {
      toast({ title: "Failed to decline deposit", description: e.message, variant: "destructive" });
    } finally {
      setProcessingDepositId(null);
    }
  };

  const handleSaveCustomerBalance = async () => {
    if (!editingCustomer) return;
    setSavingBalance(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ balance: Number(newBalance) })
        .eq("user_id", editingCustomer.user_id);
      if (error) throw error;

      toast({ title: "Balance updated successfully!" });
      setEditingCustomer(null);
      await fetchCustomers();
    } catch (e: any) {
      toast({ title: "Failed to update balance", description: e.message, variant: "destructive" });
    } finally {
      setSavingBalance(false);
    }
  };

  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);

  const getStoreUrl = (s: any) => {
    if (s.custom_domain && s.domain_verified) {
      return `https://${s.custom_domain}`;
    }
    return `${window.location.origin}/store/${s.slug}`;
  };

  const copyLink = (s: any) => {
    const url = getStoreUrl(s);
    navigator.clipboard.writeText(url);
    setCopiedStoreId(s.id);
    toast({ title: "Link copied!" });
    setTimeout(() => setCopiedStoreId(null), 2000);
  };

  const downloadQR = (s: any) => {
    const div = qrRefs.current[s.id];
    if (!div) return;
    const svg = div.querySelector("svg");
    if (!svg) return;

    const canvas = document.createElement("canvas");
    const size = 400;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);

    const svgData = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 20, 20, size - 40, size - 40);
      const a = document.createElement("a");
      a.download = `${s.slug}-qr.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;
  };

  const getGlobalRetailPrice = (network: string, size: string) => {
    const norm = size.replace(/\s+/g, "").toUpperCase();
    const gs = globalPkgSettings.find(
      (x) => x.network === network && x.package_size.replace(/\s+/g, "").toUpperCase() === norm
    );
    return gs ? Number(gs.agent_price || gs.public_price || 0) : 0;
  };

  // Upsell view if not qualified reseller
  if (!isPaidAgent) {
    return (
      <div className="p-6 md:p-8 max-w-xl space-y-6" style={{ background: "#0a0a0f", minHeight: "100vh" }}>
        <h1 className="font-black text-3xl tracking-tight text-white">My Store</h1>
        <div className="rounded-3xl border border-white/8 bg-card/60 p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
            <Store className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="font-black text-xl text-white">Unlock Your Store</h2>
          <p className="text-sm text-white/40 max-w-xs mx-auto">
            Pay GHS {activationFee} once to become a reseller and get your own branded store, agent prices, and more.
          </p>
          <a
            href="/agent-program"
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-amber-400 hover:bg-amber-500 text-black px-6 font-bold transition-colors"
          >
            Become a Reseller (GHS {activationFee})
          </a>
        </div>
      </div>
    );
  }

  const activeStore = stores.find((x) => x.id === selectedStoreId);
  const activeUrl = activeStore ? getStoreUrl(activeStore) : "";

  return (
    <div className="min-h-screen p-4 md:p-6 pb-24 text-white" style={{ background: "#0a0a0f" }}>
      <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="font-black text-3xl tracking-tight text-white mb-1 flex items-center gap-2">
              <Store className="w-8 h-8 text-amber-400" />
              Store Manager Pro
            </h1>
            <p className="text-white/40 text-xs font-bold uppercase tracking-wider">
              Reseller Platform · Control Dashboard
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick Balance indicator */}
            <div className="bg-white/5 border border-white/8 px-4 h-11 rounded-2xl flex items-center gap-2 shrink-0">
              <Wallet className="w-4 h-4 text-amber-400" />
              <div>
                <p className="text-[8px] text-white/40 font-bold uppercase leading-none mb-0.5">My Balance</p>
                <p className="text-sm font-black text-white">₵ {agentWalletBalance.toFixed(2)}</p>
              </div>
            </div>

            <button
              onClick={() => setCreatingNew(true)}
              className="flex items-center gap-1.5 h-11 px-4 rounded-2xl text-xs font-black text-amber-400 border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20 transition-all shrink-0 cursor-pointer"
            >
              <Plus className="w-4.5 h-4.5" /> Create Store
            </button>
          </div>
        </div>

        {/* Create new store container */}
        {creatingNew && (
          <div className="rounded-3xl p-5 border-2 border-dashed border-amber-400/25 space-y-4 animate-in slide-in-from-top-2 duration-300" style={{ background: "#111116" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Store className="w-5 h-5 text-amber-400" />
                <p className="text-sm font-black text-white">Initialize a Whitelabel Storefront</p>
              </div>
              <button onClick={() => setCreatingNew(false)} className="text-white/40 hover:text-white transition-all p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateStore} className="flex gap-2 max-w-md">
              <input
                type="text"
                required
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
                placeholder="e.g. Kwame Wholesale Data"
                className="flex-1 h-11 rounded-2xl px-4 text-sm font-medium text-white border border-white/8 outline-none focus:border-amber-400 transition-all bg-[#1a1a24] placeholder:text-white/20"
              />
              <button
                type="submit"
                disabled={saving}
                className="h-11 px-5 rounded-2xl font-black text-xs uppercase tracking-widest bg-amber-400 text-black hover:bg-amber-500 transition-all disabled:opacity-50 border-0 cursor-pointer"
              >
                {saving ? "Deploying..." : "Launch"}
              </button>
            </form>
          </div>
        )}

        {/* Loading / No stores empty states */}
        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
            <p className="text-xs font-bold text-white/40">Loading Reseller storefront settings...</p>
          </div>
        ) : stores.length === 0 ? (
          <div className="rounded-3xl border border-white/8 bg-card/60 p-12 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
              <Store className="w-8 h-8 text-amber-400" />
            </div>
            <h2 className="font-black text-xl text-white">Create Your Storefront</h2>
            <p className="text-sm text-white/40 max-w-xs mx-auto">
              You are officially ready! Create your custom whitelabel store to start reselling data immediately.
            </p>
            <button
              onClick={() => setCreatingNew(true)}
              className="inline-flex h-11 items-center justify-center rounded-2xl bg-amber-400 hover:bg-amber-500 text-black px-6 font-bold border-0 cursor-pointer"
            >
              Build Storefront Now
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            
            {/* Sidebar selector */}
            <div className="space-y-4 lg:col-span-1">
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Active Reseller Store</p>
                <div className="flex lg:flex-col gap-2 overflow-x-auto pb-2 lg:pb-0 scrollbar-none">
                  {stores.map((s) => {
                    const isActive = s.id === selectedStoreId;
                    return (
                      <div
                        key={s.id}
                        onClick={() => {
                          setSelectedStoreId(s.id);
                          setCreatingNew(false);
                        }}
                        className="flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left min-w-[200px] lg:min-w-0 shrink-0 cursor-pointer select-none"
                        style={{
                          background: isActive ? `${s.store_primary_color}11` : "#111116",
                          borderColor: isActive ? s.store_primary_color : "rgba(255,255,255,0.06)",
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
                          <p className="text-[10px] text-white/45 truncate">/store/{s.slug}</p>
                        </div>

                        {stores.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteStore(s.id, e)}
                            className="text-white/20 hover:text-red-400 p-1.5 rounded-lg hover:bg-white/5 transition-all shrink-0 cursor-pointer"
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

              {/* Pro Dashboard Sections Nav list */}
              <div className="rounded-3xl border border-white/6 bg-[#111116] p-2 space-y-1">
                {[
                  { id: "overview", label: "📊 Overview Dashboard", icon: LayoutDashboard },
                  { id: "design", label: "🎨 Custom Branding", icon: Palette },
                  { id: "pricing", label: "💲 Profit Margins", icon: DollarSign },
                  { id: "customers", label: "👥 Customer Management", icon: Users },
                  { id: "deposits", label: "💰 MoMo Deposits", icon: CreditCard, badge: deposits.filter(d => d.status === "pending").length },
                  { id: "withdrawals", label: "💸 Profit Payouts", icon: HandCoins },
                  { id: "settings", label: "⚙️ System Configuration", icon: SettingsIcon },
                ].map((item) => {
                  const isActive = activeTab === item.id;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id as any)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-xs font-bold transition-all border-0 ${
                        isActive
                          ? "bg-amber-400 text-black shadow-lg shadow-amber-400/10"
                          : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon className="w-4 h-4 shrink-0" />
                        {item.label}
                      </span>
                      {!!item.badge && item.badge > 0 && (
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black leading-none ${isActive ? "bg-black text-amber-400" : "bg-amber-400/20 text-amber-400"}`}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pro Management Panel Container */}
            <div className="lg:col-span-3 space-y-6">
              
              {/* Live store banner */}
              {activeStore && (
                <div className="rounded-3xl border border-white/6 p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4" style={{ background: "#111116" }}>
                  <div className="flex items-center gap-3">
                    <Globe className="w-6 h-6 text-emerald-400 animate-pulse shrink-0" />
                    <div>
                      <p className="text-[9px] font-black uppercase text-emerald-405 tracking-wider">Live Whitelabel Domain</p>
                      <p className="text-xs font-mono font-medium text-white/80 break-all">{activeUrl}</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => copyLink(activeStore)}
                      className="h-9 px-3 rounded-xl border border-white/8 bg-white/5 hover:bg-white/10 text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5"
                    >
                      {copiedStoreId === activeStore.id ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedStoreId === activeStore.id ? "Copied" : "Copy Link"}
                    </button>

                    <a
                      href={activeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-9 px-4 rounded-xl bg-white text-black hover:bg-white/90 text-xs font-black transition-all flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Visit Store
                    </a>
                  </div>
                </div>
              )}

              {/* OVERVIEW DASHBOARD */}
              {activeTab === "overview" && activeStore && (
                <div className="space-y-6">
                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="rounded-3xl border border-white/6 p-5 bg-[#111116] flex flex-col gap-2">
                      <div className="w-8 h-8 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
                        <Users className="w-4 h-4 text-amber-400" />
                      </div>
                      <p className="text-2xl font-black">{customers.length}</p>
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Active Customers</p>
                    </div>

                    <div className="rounded-3xl border border-white/6 p-5 bg-[#111116] flex flex-col gap-2">
                      <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                        <CreditCard className="w-4 h-4 text-indigo-400" />
                      </div>
                      <p className="text-2xl font-black">{deposits.filter(d => d.status === "pending").length}</p>
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Pending Deposits</p>
                    </div>

                    <div className="col-span-2 md:col-span-1 rounded-3xl border border-white/6 p-5 bg-[#111116] flex flex-col gap-2">
                      <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                        <TrendingUp className="w-4 h-4 text-emerald-400" />
                      </div>
                      <p className="text-2xl font-black text-emerald-400">
                        ₵ {deposits.filter(d => d.status === "approved").reduce((s, d) => s + Number(d.amount), 0).toFixed(2)}
                      </p>
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Approved Deposits (Revenue)</p>
                    </div>
                  </div>

                  {/* QR code and live guide */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="rounded-3xl border border-white/6 p-6 bg-[#111116] flex flex-col items-center justify-center text-center space-y-4">
                      <div className="flex flex-col items-center justify-center p-4 bg-white rounded-3xl shadow-xl shrink-0" ref={(el) => { qrRefs.current[activeStore.id] = el; }}>
                        <SafeQRCodeSVG value={activeUrl} size={150} bgColor="#ffffff" fgColor="#000000" level="M" />
                      </div>
                      <div>
                        <h3 className="font-black text-sm">Download QR Code</h3>
                        <p className="text-[10px] text-white/45 max-w-xs mt-0.5 leading-relaxed">
                          Save and print the QR code to allow your clients to scan and access your storefront easily!
                        </p>
                      </div>
                      <button
                        onClick={() => downloadQR(activeStore)}
                        className="h-10 px-5 rounded-xl border border-white/8 bg-white/5 hover:bg-white/10 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" /> Download PNG
                      </button>
                    </div>

                    <div className="rounded-3xl border border-white/6 p-6 bg-[#111116] flex flex-col justify-between space-y-4">
                      <div className="space-y-2">
                        <h3 className="font-black text-sm flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-400" />
                          Reseller Wallet Operations
                        </h3>
                        <p className="text-xs text-white/50 leading-relaxed">
                          Your customer checkout relies on manual MoMo requests. When customers complete payments, you approve them here.
                        </p>
                        <p className="text-xs text-white/50 leading-relaxed">
                          Approving a deposit will deduct funds from <span className="font-bold text-amber-400">your main agent wallet</span> and credit <span className="font-bold text-white">your customer's store wallet</span> instantly.
                        </p>
                      </div>

                      <div className="bg-amber-400/8 border border-amber-400/20 rounded-2xl p-4 space-y-1">
                        <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Dashboard Checklist</p>
                        <ul className="text-xs text-white/60 space-y-1 list-disc list-inside">
                          <li>Custom brand your storefront logo & header</li>
                          <li>Configure your own custom data prices & markup</li>
                          <li>Maintain wallet liquidity for customer top-ups</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* DESIGN & BRANDING */}
              {activeTab === "design" && activeStore && (
                <form onSubmit={handleSaveSettings} className="rounded-3xl border border-white/6 p-6 bg-[#111116] space-y-6">
                  <div>
                    <h3 className="font-black text-sm">Design & Aesthetics</h3>
                    <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mt-0.5">Customize your storefront visual identities</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Store name & Color */}
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">Store Name</label>
                        <input
                          type="text"
                          required
                          value={form.store_name}
                          onChange={(e) => updateField("store_name", e.target.value)}
                          className="w-full h-11 rounded-2xl px-4 text-sm font-medium bg-[#1a1a24] border border-white/8 outline-none focus:border-amber-400 transition-all text-white"
                        />
                      </div>

                      {/* Brand Color selection */}
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">Curated Preset Solid Colors</label>
                          <div className="flex flex-wrap gap-2">
                            {PRESET_COLORS.map((c) => {
                              const isSelected = form.store_primary_color.toLowerCase() === c.toLowerCase();
                              return (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => updateField("store_primary_color", c)}
                                  className={`w-7.5 h-7.5 rounded-xl border transition-all cursor-pointer relative shrink-0 ${
                                    isSelected ? "scale-110 border-white" : "border-white/10 hover:scale-105"
                                  }`}
                                  style={{ backgroundColor: c }}
                                >
                                  {isSelected && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/25 rounded-xl">
                                      <Check className="w-3.5 h-3.5 text-white" />
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">Premium Gradients Presets</label>
                          <div className="grid grid-cols-2 gap-2">
                            {GRADIENT_PRESETS.map((g) => {
                              const isSelected = form.store_primary_color === g.value;
                              return (
                                <button
                                  key={g.id}
                                  type="button"
                                  onClick={() => updateField("store_primary_color", g.value)}
                                  className={cn(
                                    "p-2.5 rounded-xl border text-left transition-all cursor-pointer relative overflow-hidden shrink-0",
                                    isSelected ? "border-amber-400 shadow-lg shadow-amber-400/10 scale-102" : "border-white/10 hover:scale-101"
                                  )}
                                  style={{ background: g.value }}
                                >
                                  <div className="flex justify-between items-center relative z-10">
                                    <span className="text-[9px] font-black text-white uppercase tracking-wider">{g.name}</span>
                                    {isSelected && <Check className="w-3 h-3 text-white" />}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Store welcome note */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">Storefront Welcoming description</label>
                        <textarea
                          rows={3}
                          value={form.store_description}
                          onChange={(e) => updateField("store_description", e.target.value)}
                          placeholder="Welcome to Kwame Wholesale Data! The cheapest data bundles in Ghana. Quick delivery..."
                          className="w-full rounded-2xl p-4 text-sm font-medium bg-[#1a1a24] border border-white/8 outline-none focus:border-amber-400 transition-all text-white resize-none"
                        />
                      </div>
                    </div>

                    {/* Logo & Banner uploads */}
                    <div className="space-y-6">
                      {/* Logo file upload */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">Store Logo Image</label>
                        <div className="flex items-center gap-4">
                          <div className="w-16 h-16 rounded-2xl overflow-hidden bg-white flex items-center justify-center shrink-0 border border-white/10">
                            {form.store_logo_url ? (
                              <img src={form.store_logo_url} alt="Logo" className="w-full h-full object-contain" />
                            ) : (
                              <Store className="w-8 h-8 text-black/20" />
                            )}
                          </div>

                          <div className="relative flex-1">
                            <input
                              type="file"
                              accept="image/*"
                              ref={logoInputRef}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleLogoUpload(file);
                              }}
                              className="hidden"
                            />
                            <button
                              type="button"
                              onClick={() => logoInputRef.current?.click()}
                              disabled={uploadingLogo}
                              className="h-10 px-4 rounded-xl border border-white/8 bg-white/5 hover:bg-white/10 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                            >
                              {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                              Upload Logo (5MB)
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Banner file upload */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">Store Hero Banner</label>
                        <div className="space-y-3">
                          {form.store_banner_url && (
                            <div className="relative rounded-2xl overflow-hidden aspect-video border border-white/8 max-w-sm">
                              <img src={form.store_banner_url} alt="Banner" className="w-full h-full object-cover" />
                              <button
                                type="button"
                                onClick={() => updateField("store_banner_url", "")}
                                className="absolute top-2 right-2 bg-black/60 hover:bg-black/90 p-1.5 rounded-xl transition-all"
                              >
                                <X className="w-3.5 h-3.5 text-white/80" />
                              </button>
                            </div>
                          )}

                          <input
                            type="file"
                            accept="image/*"
                            ref={bannerInputRef}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleBannerUpload(file);
                            }}
                            className="hidden"
                          />
                          <button
                            type="button"
                            onClick={() => bannerInputRef.current?.click()}
                            disabled={uploadingBanner}
                            className="h-10 px-4 rounded-xl border border-white/8 bg-white/5 hover:bg-white/10 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                          >
                            {uploadingBanner ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            Upload Hero Banner (10MB)
                          </button>
                        </div>
                      </div>

                      {/* Live Storefront Mockup Preview */}
                      <div className="space-y-2.5 pt-4 border-t border-white/5">
                        <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">Live Storefront Preview Mockup</label>
                        <div className="w-[280px] h-[520px] rounded-[2.5rem] border-8 border-slate-800 bg-[#060608] relative overflow-hidden flex flex-col mx-auto shadow-2xl transition-all duration-300">
                          {/* Speaker Notch */}
                          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-4 bg-slate-800 rounded-full z-30 flex items-center justify-center">
                            <div className="w-10 h-1 bg-black rounded-full" />
                          </div>
                          
                          {/* Screen Area */}
                          <div className="flex-1 flex flex-col relative z-20 pt-7">
                            {/* Header */}
                            <div className="h-10 flex items-center px-4 gap-2 bg-black/50 border-b border-white/5 shrink-0">
                              <div className="w-5 h-5 rounded-lg bg-white overflow-hidden flex items-center justify-center shrink-0">
                                {form.store_logo_url ? (
                                  <img src={form.store_logo_url} alt="Logo" className="w-full h-full object-contain" />
                                ) : (
                                  <Store className="w-3 h-3 text-black" />
                                )}
                              </div>
                              <span className="text-[10px] font-black text-white truncate max-w-[120px]">
                                {form.store_name || "MY WHITESALE STORE"}
                              </span>
                            </div>

                            {/* Scrollable Contents */}
                            <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-none">
                              {/* Hero Card */}
                              <div 
                                className="rounded-2xl p-4 text-center space-y-2 relative overflow-hidden shrink-0"
                                style={{ 
                                  background: form.store_primary_color.includes("gradient") 
                                    ? form.store_primary_color 
                                    : `linear-gradient(135deg, ${form.store_primary_color}, #000)` 
                                }}
                              >
                                <div className="absolute inset-0 bg-black/10 z-0" />
                                <h4 className="text-white font-black text-[10px] relative z-10 leading-tight">
                                  Cheapest Non-Expiry Data Ghana
                                </h4>
                                <p className="text-white/60 text-[8px] relative z-10 leading-tight max-w-[160px] mx-auto truncate">
                                  {form.store_description || "Pick network, enter number, pay MoMo!"}
                                </p>
                              </div>

                              {/* Network Cards Mockup */}
                              <div className="space-y-2">
                                <span className="text-[8px] font-black text-white/30 uppercase tracking-widest leading-none block">Networks Covered</span>
                                <div className="grid grid-cols-3 gap-1.5">
                                  {["MTN", "Telecel", "AirtelTigo"].map(net => (
                                    <div 
                                      key={net} 
                                      className="p-2 rounded-xl border border-white/5 bg-white/[0.02] text-center flex flex-col items-center justify-center"
                                    >
                                      <span className={cn(
                                        "text-[9px] font-black tracking-tighter uppercase",
                                        net === "MTN" ? "text-amber-400" : net === "Telecel" ? "text-red-500" : "text-blue-500"
                                      )}>{net}</span>
                                      <span className="text-[7px] font-bold text-emerald-500/80 mt-1 uppercase">100% SLA</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/6 flex items-center gap-3 justify-end">
                    {saved && (
                      <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> Branding applied!
                      </span>
                    )}

                    <button
                      type="submit"
                      disabled={saving}
                      className="h-11 px-6 rounded-2xl font-black text-xs uppercase tracking-widest text-black bg-amber-400 hover:bg-amber-500 transition-all disabled:opacity-50 border-0 cursor-pointer flex items-center gap-2"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Save Design Settings
                    </button>
                  </div>
                </form>
              )}

              {/* PROFIT MARGINS / PRICING */}
              {activeTab === "pricing" && (
                <div className="rounded-3xl border border-white/6 p-6 bg-[#111116] space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-black text-sm">Profit Margins & Pricing</h3>
                      <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mt-0.5">Define your custom storefront package selling prices</p>
                    </div>

                    <button
                      onClick={handleSavePricing}
                      disabled={saving}
                      className="h-10 px-5 rounded-xl font-black text-xs uppercase tracking-widest text-black bg-amber-400 hover:bg-amber-500 transition-all border-0 cursor-pointer flex items-center gap-1.5"
                    >
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      Save Prices
                    </button>
                  </div>

                  <div className="space-y-6">
                    {Object.entries(basePackages).map(([network, pkgs]) => (
                      <div key={network} className="space-y-3">
                        <div className="flex items-center gap-2 pb-1.5 border-b border-white/6">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: network === "MTN" ? "#fbbf24" : network === "MTN Mash Up" ? "#f59e0b" : network === "Telecel" ? "#ef4444" : "#3b82f6" }} />
                          <h4 className="font-black text-xs uppercase tracking-wider">{network} Packages</h4>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                          {pkgs.map((pkg) => {
                            const globalCost = getGlobalRetailPrice(network, pkg.size);
                            const sellingPrice = customPrices[network]?.[pkg.size] || globalCost;
                            const profit = Math.max(0, sellingPrice - globalCost);

                            return (
                              <div key={pkg.size} className="bg-white/3 border border-white/6 rounded-2xl p-4 space-y-3">
                                <div className="flex justify-between items-start">
                                  <p className="text-xs font-black text-white">{pkg.size}</p>
                                  <div className="text-right">
                                    <p className="text-[8px] text-white/40 font-bold uppercase leading-none mb-0.5">Wholesale Cost</p>
                                    <p className="text-[10px] font-mono text-white/65">₵ {globalCost.toFixed(2)}</p>
                                  </div>
                                </div>

                                <div className="space-y-1">
                                  <label className="text-[8px] text-white/40 font-black uppercase tracking-wider block">Your Store Price (GHS)</label>
                                  <div className="relative">
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-xs font-bold">₵</div>
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={customPrices[network]?.[pkg.size] ?? ""}
                                      placeholder={globalCost.toFixed(2)}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        setCustomPrices((prev) => ({
                                          ...prev,
                                          [network]: {
                                            ...(prev[network] || {}),
                                            [pkg.size]: Number.isFinite(val) ? val : 0,
                                          },
                                        }));
                                      }}
                                      className="w-full h-9 rounded-xl pl-6 pr-3 bg-[#1a1a24] border border-white/8 outline-none focus:border-amber-400 text-xs font-bold text-white"
                                    />
                                  </div>
                                </div>

                                <div className="flex justify-between items-center text-[9px] pt-1.5 border-t border-white/6 font-bold">
                                  <span className="text-white/40">Profit Margin:</span>
                                  <span className="text-emerald-400">₵ {profit.toFixed(2)}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* CUSTOMER MANAGEMENT */}
              {activeTab === "customers" && (
                <div className="rounded-3xl border border-white/6 p-6 bg-[#111116] space-y-6">
                  <div>
                    <h3 className="font-black text-sm">Customer Database</h3>
                    <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mt-0.5">Manage registered storefront accounts & balances</p>
                  </div>

                  {loadingCustomers ? (
                    <div className="py-12 flex justify-center">
                      <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                    </div>
                  ) : customers.length === 0 ? (
                    <div className="py-12 text-center text-xs text-white/40 font-bold uppercase tracking-wider">
                      No customer accounts registered to your storefront yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-white/6 text-white/40 uppercase font-black tracking-widest text-[9px]">
                            <th className="py-3 px-4">User Details</th>
                            <th className="py-3 px-4">Contact Phone</th>
                            <th className="py-3 px-4 text-right">Wallet Balance</th>
                            <th className="py-3 px-4 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customers.map((c) => (
                            <tr key={c.user_id} className="border-b border-white/5 hover:bg-white/3 transition-colors font-medium">
                              <td className="py-3.5 px-4">
                                <p className="font-black text-white">{c.full_name || "Store User"}</p>
                                <p className="text-[10px] text-white/40">{c.email}</p>
                              </td>
                              <td className="py-3.5 px-4 font-mono">{c.phone || "—"}</td>
                              <td className="py-3.5 px-4 text-right font-black text-amber-400">₵ {(Number(c.balance) || 0).toFixed(2)}</td>
                              <td className="py-3.5 px-4 text-center">
                                <button
                                  onClick={() => {
                                    setEditingCustomer(c);
                                    setNewBalance(String(c.balance || 0));
                                  }}
                                  className="h-8 px-3 rounded-lg border border-white/8 bg-white/5 hover:bg-white/10 text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer"
                                >
                                  Adjust Balance
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Adjust Balance Modal dialog */}
                  {editingCustomer && (
                    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 animate-in fade-in duration-300">
                      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setEditingCustomer(null)} />
                      <div className="relative max-w-sm w-full bg-[#111116] border border-white/10 rounded-3xl p-6 text-left space-y-4 animate-in zoom-in-95 duration-200">
                        <button onClick={() => setEditingCustomer(null)} className="absolute top-4 right-4 text-white/40 hover:text-white p-1">
                          <X className="w-4 h-4" />
                        </button>

                        <div>
                          <h4 className="text-sm font-black text-white">Adjust Wallet Balance</h4>
                          <p className="text-[10px] text-white/40 font-bold uppercase mt-0.5 tracking-wider">
                            Setting balance for {editingCustomer.full_name || editingCustomer.email}
                          </p>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">New Balance (GHS)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={newBalance}
                              onChange={(e) => setNewBalance(e.target.value)}
                              className="w-full h-11 rounded-2xl px-4 text-sm font-bold bg-[#1a1a24] border border-white/8 outline-none focus:border-amber-400 text-white"
                            />
                          </div>

                          <button
                            onClick={handleSaveCustomerBalance}
                            disabled={savingBalance}
                            className="w-full h-11 rounded-2xl font-black text-xs uppercase tracking-widest text-black bg-amber-400 hover:bg-amber-500 transition-all border-0 cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            {savingBalance ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            Apply Wallet adjustment
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* MOMO DEPOSITS LIST & VALIDATION */}
              {activeTab === "deposits" && (
                <div className="rounded-3xl border border-white/6 p-6 bg-[#111116] space-y-6">
                  <div>
                    <h3 className="font-black text-sm">MoMo Deposits Validation</h3>
                    <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mt-0.5">Approve or Decline manual mobile money credit requests</p>
                  </div>

                  {loadingDeposits ? (
                    <div className="py-12 flex justify-center">
                      <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                    </div>
                  ) : deposits.length === 0 ? (
                    <div className="py-12 text-center text-xs text-white/40 font-bold uppercase tracking-wider">
                      No deposit requests submitted to your storefront yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-white/6 text-white/40 uppercase font-black tracking-widest text-[9px]">
                            <th className="py-3 px-4">Customer</th>
                            <th className="py-3 px-4">Amount</th>
                            <th className="py-3 px-4">MoMo Details</th>
                            <th className="py-3 px-4">Status</th>
                            <th className="py-3 px-4 text-center">Fulfill Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deposits.map((d) => (
                            <tr key={d.id} className="border-b border-white/5 hover:bg-white/3 transition-colors font-medium">
                              <td className="py-3.5 px-4">
                                <p className="font-black text-white">{d.profiles?.full_name || "Store Client"}</p>
                                <p className="text-[10px] text-white/40">{d.profiles?.email}</p>
                              </td>
                              <td className="py-3.5 px-4 font-black text-amber-400">₵ {Number(d.amount).toFixed(2)}</td>
                              <td className="py-3.5 px-4">
                                <p className="font-mono text-white/80">{d.sender_number}</p>
                                <p className="text-[9px] text-white/35 font-bold uppercase mt-0.5">Ref: {d.transaction_reference}</p>
                              </td>
                              <td className="py-3.5 px-4">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                                    d.status === "pending"
                                      ? "bg-amber-400/10 text-amber-400 border border-amber-400/20"
                                      : d.status === "approved"
                                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                      : "bg-red-500/10 text-red-400 border border-red-500/20"
                                  }`}
                                >
                                  {d.status}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-center">
                                {d.status === "pending" ? (
                                  <div className="flex gap-2 justify-center">
                                    <button
                                      disabled={!!processingDepositId}
                                      onClick={() => handleApproveDeposit(d.id)}
                                      className="h-8 px-2.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-emerald-500 text-black hover:bg-emerald-600 border-0 transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                                    >
                                      {processingDepositId === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                      Approve
                                    </button>

                                    <button
                                      disabled={!!processingDepositId}
                                      onClick={() => handleDeclineDeposit(d.id)}
                                      className="h-8 px-2.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-white/5 hover:bg-white/10 text-white/80 border border-white/8 transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                                    >
                                      Declined
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-white/30 font-bold uppercase tracking-wider">Processed</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* WITHDRAWALS & PAYOUTS */}
              {activeTab === "withdrawals" && activeStore && (
                <div className="space-y-6">
                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="rounded-3xl border border-white/6 p-5 bg-[#111116] flex flex-col gap-2">
                      <div className="w-8 h-8 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
                        <TrendingUp className="w-4 h-4 text-amber-400" />
                      </div>
                      <p className="text-xl md:text-2xl font-black">₵ {totalProfit.toFixed(2)}</p>
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Lifetime Profit</p>
                    </div>

                    <div className="rounded-3xl border border-white/6 p-5 bg-[#111116] flex flex-col gap-2">
                      <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      </div>
                      <p className="text-xl md:text-2xl font-black text-emerald-400">₵ {completedWithdrawals.toFixed(2)}</p>
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Paid Out</p>
                    </div>

                    <div className="rounded-3xl border border-white/6 p-5 bg-[#111116] flex flex-col gap-2">
                      <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                        <Clock className="w-4 h-4 text-blue-400" />
                      </div>
                      <p className="text-xl md:text-2xl font-black text-blue-400">₵ {pendingWithdrawals.toFixed(2)}</p>
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Pending Payouts</p>
                    </div>

                    <div className="rounded-3xl border border-white/6 p-5 bg-gradient-to-br from-amber-400/10 to-transparent border-amber-400/20 flex flex-col gap-2 relative overflow-hidden group">
                      <div className="absolute -right-4 -top-4 w-12 h-12 bg-amber-400/10 rounded-full blur-xl group-hover:bg-amber-400/20 transition-all duration-500" />
                      <div className="w-8 h-8 rounded-xl bg-amber-400/20 border border-amber-400/30 flex items-center justify-center">
                        <Wallet className="w-4 h-4 text-amber-400" />
                      </div>
                      <p className="text-xl md:text-2xl font-black text-amber-400">₵ {(totalProfit - (completedWithdrawals + pendingWithdrawals)).toFixed(2)}</p>
                      <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Available Profit</p>
                    </div>
                  </div>

                  {/* Recipient Details & Payout Request Form */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Destination details card */}
                    <div className="rounded-3xl border border-white/6 p-6 bg-[#111116] flex flex-col justify-between space-y-6">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="font-black text-sm flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-emerald-400" />
                            Verified Payout Destination
                          </h3>
                          <span className="px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                            Active
                          </span>
                        </div>

                        <div className="space-y-3.5 pt-2">
                          <div className="flex justify-between border-b border-white/5 pb-2.5">
                            <span className="text-[10px] font-black text-white/40 uppercase tracking-wider">MOMO Account Owner</span>
                            <span className="text-xs font-black text-white">{profile?.momo_account_name || "Verification Needed"}</span>
                          </div>
                          <div className="flex justify-between border-b border-white/5 pb-2.5">
                            <span className="text-[10px] font-black text-white/40 uppercase tracking-wider">MoMo Wallet Number</span>
                            <span className="text-xs font-mono font-bold text-white">{profile?.momo_number || "Not Setup"}</span>
                          </div>
                          <div className="flex justify-between pb-1.5">
                            <span className="text-[10px] font-black text-white/40 uppercase tracking-wider">Network Carrier</span>
                            <span className="text-xs font-black text-emerald-400 uppercase">{profile?.momo_network || "Not Setup"}</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={handleVerifyMomoName}
                          className="w-full h-11 rounded-2xl border border-white/8 bg-white/5 hover:bg-white/10 text-xs font-black uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-2"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Verify & Sync Legal Name
                        </button>
                        <p className="text-[10px] text-white/30 text-center font-medium leading-relaxed">
                          Your earnings are transferred directly to this mobile money address. To update these details, visit System Configuration.
                        </p>
                      </div>
                    </div>

                    {/* Withdrawal form card */}
                    <div className="rounded-3xl border border-white/6 p-6 bg-[#111116] space-y-6">
                      <div>
                        <h3 className="font-black text-sm flex items-center gap-2">
                          <ArrowDownToLine className="w-5 h-5 text-amber-400" />
                          Request Payout
                        </h3>
                        <p className="text-[10px] text-white/40 font-bold uppercase tracking-wider mt-0.5">Withdraw storefront profit to your MoMo account</p>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">Amount (GHS)</label>
                          <div className="relative">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-base font-bold">₵</div>
                            <input
                              type="number"
                              required
                              min={minWithdrawal}
                              max={maxWithdrawal}
                              placeholder={`min. GHS ${minWithdrawal.toFixed(2)}`}
                              value={withdrawalAmount}
                              onChange={(e) => setWithdrawalAmount(e.target.value)}
                              className="w-full h-12 pl-10 pr-4 rounded-2xl text-sm font-black bg-[#1a1a24] border border-white/8 outline-none focus:border-amber-400 text-white placeholder:text-white/20"
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={handleBiometricCheck}
                          disabled={!withdrawalSystemEnabled || withdrawing || biometricWithdrawScanning || !withdrawalAmount}
                          className="w-full h-12 rounded-2xl bg-amber-400 hover:bg-amber-500 text-black text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2 border-0"
                        >
                          {biometricWithdrawScanning ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</>
                          ) : withdrawing ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                          ) : (
                            <>{hasBiometric ? <Fingerprint className="w-4.5 h-4.5" /> : <Lock className="w-4 h-4" />} Request Withdrawal</>
                          )}
                        </button>

                        <p className="text-[10px] text-white/40 leading-relaxed text-center font-medium">
                          Payout processing is subject to flat GHS 1.00 fee + 1% dynamic network charges. Funds typically arrive within 24 hours.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* History card */}
                  <div className="rounded-3xl border border-white/6 p-6 bg-[#111116] space-y-4">
                    <h3 className="font-black text-sm flex items-center gap-2">
                      <Clock className="w-5 h-5 text-white/60" />
                      Withdrawal History
                    </h3>

                    {loadingWithdrawals ? (
                      <div className="py-12 flex justify-center">
                        <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                      </div>
                    ) : withdrawals.length === 0 ? (
                      <div className="py-12 text-center text-xs text-white/40 font-bold uppercase tracking-wider">
                        No profit payouts processed yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-white/6 text-white/40 uppercase font-black tracking-widest text-[9px]">
                              <th className="py-3 px-4">Withdrawal ID</th>
                              <th className="py-3 px-4">Initiation Date</th>
                              <th className="py-3 px-4 text-right">Fee Charges</th>
                              <th className="py-3 px-4 text-right">Gross Amount</th>
                              <th className="py-3 px-4 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {withdrawals.map((w) => {
                              const badgeStyle = 
                                w.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25" :
                                ["pending", "processing"].includes(w.status) ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/25 animate-pulse" :
                                "bg-red-500/10 text-red-400 border border-red-500/25";
                              
                              return (
                                <tr key={w.id} className="border-b border-white/5 hover:bg-white/3 transition-colors font-medium">
                                  <td className="py-3.5 px-4 font-mono text-[10px] text-white/60">
                                    {w.id}
                                    {w.failure_reason && (
                                      <p className="text-[10px] text-red-400 mt-1 font-sans">{w.failure_reason}</p>
                                    )}
                                  </td>
                                  <td className="py-3.5 px-4 font-mono text-white/80">
                                    {new Date(w.created_at).toLocaleDateString()} - {new Date(w.created_at).toLocaleTimeString()}
                                  </td>
                                  <td className="py-3.5 px-4 text-right text-red-400 font-mono">
                                    ₵ {Number(w.fee || 0).toFixed(2)}
                                  </td>
                                  <td className="py-3.5 px-4 text-right text-white font-black font-mono">
                                    ₵ {Number(w.amount).toFixed(2)}
                                  </td>
                                  <td className="py-3.5 px-4 text-center">
                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${badgeStyle}`}>
                                      {w.status}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* SYSTEM CONFIGURATION / SETTINGS */}
              {activeTab === "settings" && activeStore && (
                <form onSubmit={handleSaveSettings} className="rounded-3xl border border-white/6 p-6 bg-[#111116] space-y-6">
                  <div>
                    <h3 className="font-black text-sm">System Configuration</h3>
                    <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mt-0.5">Configure MoMo accounts, WhatsApp links & custom domains</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Mobile Money Verification settings */}
                    <div className="space-y-4">
                      <h4 className="text-xs font-black uppercase text-amber-400 tracking-wider">Mobile Money Setup</h4>
                      
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">MoMo Account Name</label>
                        <input
                          type="text"
                          required
                          value={form.momo_account_name}
                          onChange={(e) => updateField("momo_account_name", e.target.value)}
                          placeholder="Kwame Reseller Ventures"
                          className="w-full h-11 rounded-2xl px-4 text-sm font-medium bg-[#1a1a24] border border-white/8 outline-none focus:border-amber-400 transition-all text-white"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">MoMo Wallet Number</label>
                        <input
                          type="tel"
                          required
                          value={form.momo_number}
                          onChange={(e) => updateField("momo_number", e.target.value)}
                          placeholder="e.g. 0540000000"
                          className="w-full h-11 rounded-2xl px-4 text-sm font-medium bg-[#1a1a24] border border-white/8 outline-none focus:border-amber-400 transition-all text-white"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">MoMo Network Provider</label>
                        <select
                          required
                          value={form.momo_network}
                          onChange={(e) => updateField("momo_network", e.target.value)}
                          className="w-full h-11 rounded-2xl px-4 text-sm font-medium bg-[#1a1a24] border border-white/8 outline-none focus:border-amber-400 transition-all text-white"
                        >
                          <option value="">Choose MoMo network...</option>
                          {MOMO_NETWORKS.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Support & Contact settings */}
                    <div className="space-y-4">
                      <h4 className="text-xs font-black uppercase text-amber-400 tracking-wider">Support & Community Channels</h4>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">WhatsApp Direct Phone Number</label>
                        <input
                          type="tel"
                          required
                          value={form.whatsapp_number}
                          onChange={(e) => updateField("whatsapp_number", e.target.value)}
                          placeholder="e.g. 0244000000"
                          className="w-full h-11 rounded-2xl px-4 text-sm font-medium bg-[#1a1a24] border border-white/8 outline-none focus:border-amber-400 transition-all text-white"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">Direct Voice Support Number</label>
                        <input
                          type="tel"
                          required
                          value={form.support_number}
                          onChange={(e) => updateField("support_number", e.target.value)}
                          placeholder="e.g. 0540000000"
                          className="w-full h-11 rounded-2xl px-4 text-sm font-medium bg-[#1a1a24] border border-white/8 outline-none focus:border-amber-400 transition-all text-white"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">WhatsApp Group Invite Link</label>
                        <input
                          type="url"
                          value={form.whatsapp_group_link}
                          onChange={(e) => updateField("whatsapp_group_link", e.target.value)}
                          placeholder="https://chat.whatsapp.com/invite/..."
                          className="w-full h-11 rounded-2xl px-4 text-sm font-medium bg-[#1a1a24] border border-white/8 outline-none focus:border-amber-400 transition-all text-white"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Whitelabel Domain setting */}
                  <div className="pt-4 border-t border-white/6 space-y-5">
                    <h4 className="text-xs font-black uppercase text-amber-400 tracking-wider">Domain Configuration</h4>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Manual domain setting */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-white/40 tracking-wider">Custom Whitelabel Domain</label>
                        <input
                          type="text"
                          value={form.custom_domain}
                          onChange={(e) => updateField("custom_domain", e.target.value)}
                          placeholder="e.g. data.mybrand.com"
                          className="w-full h-11 rounded-2xl px-4 text-sm font-medium bg-[#1a1a24] border border-white/8 outline-none focus:border-amber-400 transition-all text-white"
                        />
                      </div>

                      {/* DNS / CNAME info */}
                      <div className="rounded-2xl border border-white/6 p-4 space-y-1.5 flex flex-col justify-center bg-white/2">
                        <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest">Verification Status</p>
                        <p className="text-xs font-black text-white/80">
                          {activeStore.domain_verified ? "✅ Fully Verified" : "⏳ Pending verification (DNS CNAME pointing required)"}
                        </p>
                        <p className="text-[10px] text-white/40">
                          Point CNAME record host to: <span className="font-mono text-white/65">{window.location.host}</span>
                        </p>
                      </div>
                    </div>

                    {/* Premium Domain Marketplace Card */}
                    <div className="relative rounded-3xl border p-6 space-y-6 bg-gradient-to-br from-amber-400/10 to-orange-600/5 border-amber-400/20 backdrop-blur-md shadow-2xl shadow-amber-900/10 overflow-hidden group">
                      <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none group-hover:scale-110 transition-transform duration-700 group-hover:rotate-12">
                        <Globe className="w-32 h-32 text-amber-400" />
                      </div>
                      <div className="flex items-center gap-3 relative z-10">
                        <div className="w-10 h-10 rounded-2xl bg-amber-400/10 flex items-center justify-center border border-amber-400/20 backdrop-blur-xl">
                          <Globe className="w-5 h-5 text-amber-400" />
                        </div>
                        <div>
                          <h5 className="text-sm font-black uppercase text-amber-400 tracking-widest">Premium Domain Marketplace</h5>
                          <p className="text-[10px] text-amber-400/70 font-bold uppercase tracking-wider mt-0.5">Register a whitelabel domain instantly with your wallet</p>
                        </div>
                      </div>

                      <div className="flex gap-2 relative z-10">
                        <div className="relative flex-1 group/input">
                          <div className="absolute inset-0 bg-gradient-to-r from-amber-400 to-orange-500 rounded-2xl blur opacity-0 group-focus-within/input:opacity-20 transition-opacity duration-300"></div>
                          <div className="absolute left-4 top-1/2 -translate-y-1/2">
                            <Search className="w-4 h-4 text-white/30" />
                          </div>
                          <input
                            type="text"
                            value={searchDomainText}
                            onChange={(e) => setSearchDomainText(e.target.value)}
                            placeholder="e.g. mywholesalebundles"
                            className="w-full h-14 rounded-2xl pl-11 pr-4 text-sm font-bold bg-[#1a1a24]/80 border border-white/10 outline-none focus:border-amber-400 transition-all text-white placeholder:text-white/20 relative backdrop-blur-xl"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleSearchDomain}
                          disabled={searchingDomain}
                          className="h-14 px-8 rounded-2xl font-black text-xs uppercase tracking-widest bg-amber-400 text-black hover:bg-amber-500 transition-all disabled:opacity-50 flex items-center gap-2 border-0 cursor-pointer relative z-10 hover:shadow-[0_0_20px_rgba(251,191,36,0.2)] hover:scale-102"
                        >
                          {searchingDomain ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check Availability"}
                        </button>
                      </div>

                      {searchResults.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 relative z-10 animate-in fade-in duration-500">
                          {searchResults.map((res: any, idx: number) => (
                            <div 
                              key={res.domain} 
                              className={`p-5 rounded-3xl border transition-all duration-300 flex flex-col justify-between gap-4 group/card relative overflow-hidden ${
                                res.available 
                                  ? "bg-[#16161e]/90 border-white/10 hover:border-amber-400/50 hover:-translate-y-1 hover:shadow-xl hover:shadow-amber-900/20 backdrop-blur-md" 
                                  : "bg-white/5 border-white/5 opacity-60 grayscale"
                              }`}
                              style={{ animationDelay: `${idx * 100}ms` }}
                            >
                              {res.available && (
                                <div className="absolute top-0 right-0 w-24 h-24 bg-amber-400/10 blur-3xl rounded-full opacity-0 group-hover/card:opacity-100 transition-opacity duration-500"></div>
                              )}
                              <div>
                                <p className="text-sm font-black text-white truncate group-hover/card:text-amber-400 transition-colors">{res.domain}</p>
                                <div className="flex items-center gap-1.5 mt-1.5">
                                  <span className={`w-1.5 h-1.5 rounded-full ${res.available ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`}></span>
                                  <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                                    {res.available ? "Available Now" : "Unavailable"}
                                  </p>
                                </div>
                              </div>

                              {res.available && (
                                <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/5">
                                  <div className="flex flex-col">
                                    <span className="text-[9px] text-white/30 uppercase font-black tracking-widest">1 Year Reg</span>
                                    <span className="text-base font-black text-amber-400 font-mono">₵{Number(res.price_ghs).toFixed(2)}</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedDomainToBuy(res);
                                      setShowDomainModal(true);
                                    }}
                                    className="h-10 px-5 rounded-xl bg-amber-400 text-black font-black text-[10px] tracking-widest uppercase hover:bg-amber-300 transition-all border-0 cursor-pointer shadow-lg shadow-amber-400/20 group-hover/card:scale-105"
                                  >
                                    Claim
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Checkout Dialog Modal */}
                  {showDomainModal && selectedDomainToBuy && (
                    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 animate-in fade-in duration-300">
                      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => !buyingDomain && setShowDomainModal(false)} />
                      <div className="relative max-w-md w-full bg-[#0a0a0f] border border-white/10 rounded-[2rem] p-8 text-left space-y-8 animate-in zoom-in-95 duration-300 shadow-2xl overflow-hidden">
                        
                        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-400/10 blur-3xl rounded-full"></div>
                        <div className="absolute bottom-0 left-0 w-32 h-32 bg-amber-400/5 blur-3xl rounded-full"></div>

                        <div className="relative z-10 flex items-center gap-4 border-b border-white/5 pb-6">
                          <div className="w-12 h-12 rounded-full bg-amber-400/10 flex items-center justify-center border border-amber-400/20 shrink-0">
                            <Globe className="w-6 h-6 text-amber-400" />
                          </div>
                          <div>
                            <h3 className="text-lg font-black text-white tracking-wide">Complete Registration</h3>
                            <p className="text-[11px] text-white/50 uppercase font-bold tracking-widest mt-1">Instant Activation & SSL</p>
                          </div>
                        </div>

                        <div className="relative z-10 rounded-3xl border border-white/10 p-5 space-y-4 bg-white/[0.02] backdrop-blur-sm">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Target Domain</span>
                            <span className="text-sm font-black text-white truncate max-w-[150px]">{selectedDomainToBuy.domain}</span>
                          </div>
                          <div className="flex justify-between items-center border-t border-white/5 pt-4">
                            <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Total Price (1 YR)</span>
                            <span className="text-base font-black text-amber-400 font-mono">₵{Number(selectedDomainToBuy.price_ghs).toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between items-center border-t border-white/5 pt-4">
                            <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Available Balance</span>
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
                              <span className="text-sm font-bold text-white/80 font-mono">₵{agentWalletBalance.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>

                        {buyStep === "idle" && (
                          <div className="flex gap-4 relative z-10">
                            <button
                              type="button"
                              onClick={() => setShowDomainModal(false)}
                              className="flex-1 h-12 rounded-2xl bg-white/5 hover:bg-white/10 text-white text-xs font-black uppercase tracking-widest border border-white/8 transition-all cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handlePurchaseDomain}
                              className="flex-1 h-12 rounded-2xl bg-amber-400 text-black text-xs font-black uppercase tracking-widest hover:bg-amber-500 hover:shadow-[0_0_20px_rgba(251,191,36,0.3)] transition-all border-0 cursor-pointer"
                            >
                              Confirm
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

                  <div className="pt-4 border-t border-white/6 flex items-center gap-3 justify-end">
                    {saved && (
                      <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> Configuration saved!
                      </span>
                    )}

                    <button
                      type="submit"
                      disabled={saving}
                      className="h-11 px-6 rounded-2xl font-black text-xs uppercase tracking-widest text-black bg-amber-400 hover:bg-amber-500 transition-all disabled:opacity-50 border-0 cursor-pointer flex items-center gap-2"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Save Configurations
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Payout Confirmation dialog */}
      <AlertDialog open={confirmWithdrawOpen} onOpenChange={setConfirmWithdrawOpen}>
        <AlertDialogContent className="bg-[#111116] border border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Confirm Withdrawal Request</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-white/60">
              <div className="p-4 rounded-xl bg-white/2 border border-white/5 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-white/40">Request Amount:</span>
                  <span className="font-bold text-white">GHS {parseFloat(withdrawalAmount || "0").toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/40">Processing Fee (GHS 1.00 + 1%):</span>
                  <span className="font-bold text-red-400">- GHS {(WITHDRAWAL_FEE_FLAT + (parseFloat(withdrawalAmount || "0") * WITHDRAWAL_FEE_PERCENT)).toFixed(2)}</span>
                </div>
                <div className="pt-2 border-t border-white/5 flex justify-between text-base">
                  <span className="font-semibold text-white">You will receive:</span>
                  <span className="font-black text-amber-400">GHS {(parseFloat(withdrawalAmount || "0") - (WITHDRAWAL_FEE_FLAT + (parseFloat(withdrawalAmount || "0") * WITHDRAWAL_FEE_PERCENT))).toFixed(2)}</span>
                </div>
              </div>
              <p className="text-xs text-white/40">
                Funds will be sent to your MoMo: <span className="text-white font-medium">{profile?.momo_number}</span> ({profile?.momo_network}).
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/5 border border-white/8 text-white hover:bg-white/10">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleWithdraw} className="bg-amber-400 text-black hover:bg-amber-500 border-0">Submit Request</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Transaction PIN entry dialog */}
      <AlertDialog open={pinWithdrawDialogOpen} onOpenChange={setPinWithdrawDialogOpen}>
        <AlertDialogContent className="max-w-[340px] bg-[#111116] border border-white/10 text-white">
          <AlertDialogHeader>
            <div className="mx-auto w-12 h-12 rounded-full bg-amber-400/10 flex items-center justify-center mb-2 border border-amber-400/20">
              <Key className="w-6 h-6 text-amber-400" />
            </div>
            <AlertDialogTitle className="text-center text-white">Enter Transaction PIN</AlertDialogTitle>
            <AlertDialogDescription className="text-center text-white/50">
              Verify your identity to authorize this withdrawal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="••••"
              className="h-14 w-full text-center text-2xl tracking-[0.5em] font-black bg-white/3 border border-white/10 rounded-2xl outline-none focus:border-amber-400 text-white"
              value={enteredWithdrawPin}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "");
                setEnteredWithdrawPin(val);
                if (val.length === 4) {
                  if (val === profile?.transaction_pin) {
                    setPinWithdrawDialogOpen(false);
                    setConfirmWithdrawOpen(true);
                  } else {
                    toast({ title: "Verification failed", description: "Incorrect PIN", variant: "destructive" });
                    setEnteredWithdrawPin("");
                  }
                }
              }}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="w-full bg-white/5 border border-white/8 text-white hover:bg-white/10">Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
