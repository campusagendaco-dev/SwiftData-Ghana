import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import html2canvas from "html2canvas";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { 
  Zap, ArrowRightLeft, Wallet, Phone, Landmark, 
  Search, Loader2, CheckCircle2, AlertCircle, Info,
  ArrowDownCircle, ArrowUpCircle, RefreshCw, Globe,
  Eye, EyeOff, Share2, UserPlus, Users, TrendingUp, AlertTriangle, Lock,
  Download, History, ShieldAlert, Sparkles, X
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { SecurityGateway } from "@/components/SecurityGateway";
import { VendorOnboardingWizard } from "@/components/VendorOnboardingWizard";
import { VendorSecurityApproval } from "@/components/VendorSecurityApproval";

const GHANA_BANKS = [
  { code: "SCH", name: "Standard Chartered Bank" },
  { code: "ABG", name: "Absa Bank Ghana Limited" },
  { code: "GCB", name: "GCB Bank Limited" },
  { code: "NIB", name: "National Investment Bank" },
  { code: "ADB", name: "Agricultural Development Bank" },
  { code: "UMB", name: "Universal Merchant Bank" },
  { code: "RBL", name: "Republic Bank Limited" },
  { code: "ZEN", name: "Zenith Bank Ghana Ltd" },
  { code: "ECO", name: "Ecobank Ghana Ltd" },
  { code: "CAL", name: "Cal Bank Limited" },
  { code: "PRD", name: "Prudential Bank Ltd" },
  { code: "STB", name: "Stanbic Bank" },
  { code: "GTB", name: "Guaranty Trust Bank" },
  { code: "UBA", name: "United Bank of Africa" },
  { code: "ACB", name: "Access Bank Ltd" },
  { code: "CBG", name: "Consolidated Bank Ghana" },
  { code: "SGG", name: "Societe Generale Ghana" },
  { code: "FNB", name: "First National Bank" },
  { code: "UNL", name: "Unity Link" },
  { code: "FDL", name: "Fidelity Bank Limited" },
  { code: "SIS", name: "Services Integrity Savings & Loans" },
  { code: "BOA", name: "Bank of Africa" },
  { code: "DFL", name: "Dalex Finance and Leasing Company" },
  { code: "FBO", name: "First Bank of Nigeria" },
  { code: "GHL", name: "GHL Bank" },
  { code: "BOG", name: "Bank of Ghana" },
  { code: "FAB", name: "First Atlantic Bank" },
  { code: "SSB", name: "OmniBSIC Bank" },
  { code: "GMY", name: "G-Money" },
  { code: "APX", name: "ARB Apex Bank Limited" }
];


const AFRICA_COUNTRIES = [
  { code: "GH", name: "Ghana (GHS)", currency: "GHS" },
  { code: "NG", name: "Nigeria (NGN)", currency: "NGN" },
  { code: "KE", name: "Kenya (KES)", currency: "KES" },
  { code: "ZA", name: "South Africa (ZAR)", currency: "ZAR" },
];

const THETELLER_ERRORS: Record<string, string> = {
  "101": "Insufficient funds in wallet.",
  "102": "Number not registered for mobile money.",
  "103": "Wrong PIN or transaction timed out.",
  "104": "Transaction declined or terminated.",
  "105": "Invalid amount or general failure (try changing the transaction ID).",
  "106": "Transaction cancelled.",
  "107": "Merchant limit exceeded.",
  "111": "System error. Payment provider gateway is currently down.",
  "200": "Transaction timeout. No response received from customer's provider.",
  "400": "Invalid request parameters sent to gateway.",
  "401": "Gateway authentication failed (unauthorized).",
  "404": "Service endpoint not found.",
  "429": "Too many requests. Please slow down."
};

const getErrorMessageFromData = (data: any) => {
  if (!data) return "Unknown error";
  const code = String(data.code || "");
  if (THETELLER_ERRORS[code]) {
    return THETELLER_ERRORS[code];
  }
  return data.description || data.reason || data.message || data.error || data.desc || data.status || "Unknown error";
};

const playSuccessSound = () => {
  try {
    const audio = new Audio("https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/success-beep.mp3");
    audio.play().catch(e => console.log('Audio playback prevented:', e));
  } catch (e) {
    console.warn("Audio playback failed:", e);
  }
};

const DashboardSwiftVendor = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [isLockedByAdmin, setIsLockedByAdmin] = useState<boolean>(false);
  const [vendorStatus, setVendorStatus] = useState<string>("active");
  const [kycRejectionReason, setKycRejectionReason] = useState<string | null>(null);
  const [kycExpiryData, setKycExpiryData] = useState<{ natId?: string, bizCert?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [todayStats, setTodayStats] = useState({ 
    sales: 0, 
    profit: 0, 
    count: 0,
    cashIn: 0,
    cashOut: 0,
    bankTransfers: 0
  });
  const [networkStatus, setNetworkStatus] = useState({
    MTN: "Stable",
    VOD: "Stable",
    TGO: "Stable",
    GLO: "Stable"
  });
  const [aiRecommendations, setAiRecommendations] = useState<any[]>([]);
  
  // MoMo State
  const [momoAction, setMomoAction] = useState<"cash-in" | "cash-out">("cash-out");
  const [momoPhone, setMomoPhone] = useState("");
  const [momoAmount, setMomoAmount] = useState("");
  const [momoNetwork, setMomoNetwork] = useState("MTN");
  const [momoAccountName, setMomoAccountName] = useState<string | null>(null);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);

  // Bank State
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankAmount, setBankAmount] = useState("");
  const [accountName, setAccountName] = useState<string | null>(null);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState("GH");
  const [africaBanks, setAfricaBanks] = useState<{code: string, name: string}[]>([]);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({ NGN: 0, KES: 0, ZAR: 0 });
  const [isPrivateMode, setIsPrivateMode] = useState(false);
  const [balanceThreshold] = useState(500); // threshold
  const [savedRecipients, setSavedRecipients] = useState<{id?: string, name: string, account_number: string, network_or_bank: string, type: string}[]>([]);
  const [activeTab, setActiveTab] = useState("momo");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "fulfilled" | "pending" | "failed">("all");
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);
  const [securityApproval, setSecurityApproval] = useState<{isOpen: boolean, amount: number, onApprove: () => void}>({isOpen: false, amount: 0, onApprove: () => {}});

  // Master Agent State
  const [subAgents, setSubAgents] = useState<any[]>([]);
  const [loadingSubAgents, setLoadingSubAgents] = useState(false);
  const [bridgeFloatModal, setBridgeFloatModal] = useState<{isOpen: boolean, subAgent: any}>({isOpen: false, subAgent: null});
  const [bridgeAmount, setBridgeAmount] = useState("");

  const [minTxAmount, setMinTxAmount] = useState<number>(1.00);

  // Gamification & Churn AI
  const [swiftPoints, setSwiftPoints] = useState<number>(0);
  const [showPointsModal, setShowPointsModal] = useState(false);
  const [redeemAmount, setRedeemAmount] = useState<number>(100);
  const [redeeming, setRedeeming] = useState(false);
  const [churnInsights, setChurnInsights] = useState<any[]>([]);

  // Transaction processing overlay state
  const [overlay, setOverlay] = useState<{
    isOpen: boolean;
    type: "cash-in" | "cash-out" | "bank" | "africa";
    step: "submitting" | "verify-pin" | "success" | "failed";
    amount: number;
    phoneOrAccount: string;
    networkOrBank: string;
    orderId?: string;
    errorMsg?: string;
    countdown?: number;
    successDetails?: {
      transactionId?: string;
      accountName?: string;
      reference?: string;
    };
  }>({
    isOpen: false,
    type: "cash-in",
    step: "submitting",
    amount: 0,
    phoneOrAccount: "",
    networkOrBank: "",
  });

  // Polling logic for pending transactions
  useEffect(() => {
    if (!overlay.isOpen || overlay.step !== "verify-pin" || !overlay.orderId) {
      return;
    }

    const intervals: { countdown?: any; poll?: any } = {};
    
    // Set default countdown
    setOverlay(prev => ({ ...prev, countdown: 60 }));
    
    intervals.countdown = setInterval(() => {
      setOverlay(prev => {
        if (prev.countdown === undefined || prev.countdown <= 1) {
          clearInterval(intervals.countdown);
          clearInterval(intervals.poll);
          return {
            ...prev,
            step: "failed",
            errorMsg: "Transaction timed out. Please check your phone prompt again or view recent activity."
          };
        }
        return { ...prev, countdown: prev.countdown - 1 };
      });
    }, 1000);

    // Poll status every 3.5 seconds
    intervals.poll = setInterval(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("paystack-vendor", {
          body: {
            action: "check-status",
            transaction_id: overlay.orderId
          }
        });
        
        if (!error && data) {
          const isSuccess = data.code === "000" || data.status === "approved" || data.status === "successful";
          const isFailed = data.code === "104" || data.code === "103" || data.code === "106" || data.status === "failed";
          
          if (isSuccess) {
            clearInterval(intervals.countdown);
            clearInterval(intervals.poll);
            setOverlay(prev => ({
              ...prev,
              step: "success",
              successDetails: {
                transactionId: data.transaction_id || prev.orderId,
                accountName: data.account_name || prev.successDetails?.accountName
              }
            }));
            playSuccessSound();
            fetchBalance();
          } else if (isFailed) {
            clearInterval(intervals.countdown);
            clearInterval(intervals.poll);
            setOverlay(prev => ({
              ...prev,
              step: "failed",
              errorMsg: getErrorMessageFromData(data)
            }));
            fetchBalance();
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 3500);

    return () => {
      clearInterval(intervals.countdown);
      clearInterval(intervals.poll);
    };
  }, [overlay.isOpen, overlay.step, overlay.orderId]);

  const fetchSubAgents = async () => {
    if (!user) return;
    setLoadingSubAgents(true);
    try {
      const { data, error } = await (supabase as any).rpc('get_sub_agents_status', { p_master_id: user.id });
      if (!error && data) {
        setSubAgents(data as any);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSubAgents(false);
    }
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value === "bank" || value === "momo") {
      setSelectedCountry("GH");
    }
    if (value === "franchises") {
      fetchSubAgents();
    }
  };

  const handleBridgeFloat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bridgeFloatModal.subAgent || !bridgeAmount || isNaN(Number(bridgeAmount)) || Number(bridgeAmount) <= 0) return;
    setLoadingSubAgents(true);
    try {
      const { data, error } = await (supabase as any).rpc('transfer_float_to_subagent', {
        p_master_id: user?.id,
        p_sub_id: bridgeFloatModal.subAgent.user_id,
        p_amount: Number(bridgeAmount)
      });
      if (error) throw new Error(error.message);
      const res = data as any;
      if (res && res.success) {
        toast.success(`Successfully bridged GHS ${bridgeAmount} to ${bridgeFloatModal.subAgent.full_name}`);
        setBridgeFloatModal({isOpen: false, subAgent: null});
        setBridgeAmount("");
        fetchSubAgents();
        fetchBalance();
        playSuccessSound();
      } else {
        toast.error(res?.error || "Failed to bridge float");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to transfer float");
    } finally {
      setLoadingSubAgents(false);
    }
  };

  const requireSecurityApproval = (amount: number, callback: () => void) => {
    if (amount >= 2000) {
      setSecurityApproval({
        isOpen: true,
        amount,
        onApprove: () => {
          setSecurityApproval(prev => ({...prev, isOpen: false}));
          callback();
        }
      });
    } else {
      callback();
    }
  };

  // Fetch beneficiaries from database
  useEffect(() => {
    if (!user) return;
    const fetchBeneficiaries = async () => {
      const { data, error } = await supabase
        .from('swift_beneficiaries')
        .select('*')
        .eq('user_id', user.id)
        .order('last_used_at', { ascending: false })
        .limit(20);
      
      if (!error && data) {
        setSavedRecipients(data as any);
      } else {
        // Fallback to local storage if DB fetch fails or schema missing
        const saved = localStorage.getItem("swift_recipients");
        if (saved) setSavedRecipients(JSON.parse(saved));
      }
    };
    fetchBeneficiaries();
  }, [user]);

  const saveRecipient = async (name: string, account_number: string, network_or_bank: string, type: string) => {
    if (!user) return;
    
    // Check if exists
    const existing = savedRecipients.find(r => r.account_number === account_number && r.type === type);
    
    if (existing) {
      // Update last_used_at
      const { error } = await supabase
        .from('swift_beneficiaries')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', existing.id);
      return;
    }
    
    const newRecipient = {
      user_id: user.id,
      name,
      account_number,
      network_or_bank,
      type,
      last_used_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('swift_beneficiaries')
      .insert([newRecipient])
      .select();
      
    if (!error && data && data.length > 0) {
      setSavedRecipients(prev => [data[0] as any, ...prev].slice(0, 20));
      toast.success("Recipient saved to Address Book");
    } else {
      // Fallback
      const fallbackList = [{name, account_number, network_or_bank, type}, ...savedRecipients].slice(0, 10);
      setSavedRecipients(fallbackList);
      localStorage.setItem("swift_recipients", JSON.stringify(fallbackList));
    }
  };

  const handleShareReceipt = (order: any) => {
    const isDisbursement = order.order_type === "vendor_cash_in" || order.order_type === "vendor_bank_transfer";
    const text = `*Swift Vendor Transaction Receipt*%0A%0A` +
                 `*Type:* ${isDisbursement ? "Disbursement" : "Collection"}%0A` +
                 `*Amount:* GHS ${order.amount.toFixed(2)}%0A` +
                 `*Recipient:* ${order.customer_phone}%0A` +
                 `*Status:* SUCCESSFUL%0A` +
                 `*Date:* ${new Date(order.created_at).toLocaleString()}%0A%0A` +
                 `_Thank you for choosing Swift Vendor!_`;
    window.open(`https://wa.me/${order.customer_phone}?text=${text}`, "_blank");
  };

  const filteredOrders = recentOrders.filter(order => {
    const matchesSearch = 
      order.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (order.customer_phone && order.customer_phone.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (order.metadata?.bank_name && order.metadata.bank_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (order.metadata?.account_name && order.metadata.account_name.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = 
      statusFilter === "all" || 
      order.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const handleExportCSV = () => {
    if (filteredOrders.length === 0) {
      toast.error("No transactions available to export");
      return;
    }

    // CSV headers
    const headers = ["Transaction ID", "Date", "Type", "Amount (GHS)", "Fee (GHS)", "Commission (GHS)", "Status", "Recipient"];
    const rows = filteredOrders.map(o => {
      const isDisbursement = o.order_type === "vendor_cash_in" || o.order_type === "vendor_bank_transfer";
      const typeLabel = isDisbursement ? "Disbursement" : "Collection";
      const dateFormatted = new Date(o.created_at).toLocaleString();
      return [
        o.id,
        dateFormatted,
        typeLabel,
        o.amount,
        o.fee || 0,
        o.profit || 0,
        o.status,
        o.customer_phone || ""
      ];
    });

    const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Swift_Vendor_Reconciliation_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("CSV file exported successfully");
  };

  const downloadReceiptImage = async (elementId: string, transactionId: string) => {
    const element = document.getElementById(elementId);
    if (!element) {
      toast.error("Receipt element not found");
      return;
    }
    toast.loading("Generating receipt image...", { id: "receipt-download" });
    try {
      const canvas = await html2canvas(element, {
        useCORS: true,
        scale: 2,
        backgroundColor: "#0d0d0e",
      });
      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = `Receipt_${transactionId}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("Receipt downloaded successfully", { id: "receipt-download" });
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate receipt image", { id: "receipt-download" });
    }
  };

  useEffect(() => {
    fetchBalance();

    // Check for theTeller redirect query parameters
    const params = new URLSearchParams(window.location.search);
    const trxId = params.get("transaction_id");
    if (trxId) {
      handleVerifyOrderStatus(trxId);
      // Clean up URL parameters to avoid checking again on refresh
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Auto Network Detection
  useEffect(() => {
    const prefix = momoPhone.substring(0, 3);
    if (["024", "054", "055", "059", "025"].includes(prefix)) {
      setMomoNetwork("MTN");
    } else if (["020", "050"].includes(prefix)) {
      setMomoNetwork("VOD");
    } else if (["027", "057", "026", "056"].includes(prefix)) {
      setMomoNetwork("ATL");
    }
    // Reset name verification when phone changes
    setMomoAccountName(null);
  }, [momoPhone]);

  useEffect(() => {
    if (selectedCountry !== "GH") {
      fetchAfricaBanks();
      fetchExchangeRates();
    }
  }, [selectedCountry]);

  // Auto-Verify debouncers
  useEffect(() => {
    if (momoNetwork && momoPhone && momoPhone.length === 10 && momoAction === "cash-in") {
      const timer = setTimeout(() => {
        if (!momoAccountName && !verifying) {
          handleMomoEnquiry();
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [momoNetwork, momoPhone, momoAction]);

  useEffect(() => {
    if (bankCode && accountNumber && accountNumber.length >= 10) {
      const timer = setTimeout(() => {
        if (!accountName && !verifying) {
          handleBankEnquiry();
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [bankCode, accountNumber, selectedCountry, accountName]);

  const fetchExchangeRates = async () => {
    try {
      const resp = await fetch("https://open.er-api.com/v6/latest/GHS");
      const data = await resp.json();
      if (data && data.rates) {
        setExchangeRates({
          NGN: data.rates.NGN,
          KES: data.rates.KES,
          ZAR: data.rates.ZAR
        });
      }
    } catch (err) {
      console.error("Failed to fetch rates", err);
    }
  };

  const fetchAfricaBanks = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("paystack-vendor", {
        body: {
          action: "list-banks",
          country: selectedCountry.toLowerCase() === "ng" ? "nigeria" : selectedCountry.toLowerCase() === "ke" ? "kenya" : "south africa"
        }
      });
      if (data && data.data) {
        setAfricaBanks(data.data.map((b: any) => ({ code: b.code, name: b.name })));
      }
    } catch (err) {
      console.error("Failed to fetch banks", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchBalance = async () => {
    if (!user) return;
    
    // Check terminal lock state and vendor KYC status
    const { data: profile } = await supabase
      .from("profiles")
      .select("terminal_locked, vendor_status, vendor_rejection_reason, vendor_kyc_api_response")
      .eq("user_id", user.id)
      .single();
    if (profile) {
      const p = profile as any;
      setIsLockedByAdmin(p.terminal_locked);
      setVendorStatus(p.vendor_status || "inactive");
      setKycRejectionReason(p.vendor_rejection_reason);
      if (p.vendor_kyc_api_response && typeof p.vendor_kyc_api_response === 'object') {
        const kycData = p.vendor_kyc_api_response as any;
        setKycExpiryData({
          natId: kycData.national_id_expiry,
          bizCert: kycData.business_cert_expiry
        });
      }
    }

    // Fetch AI Recommendations
    const { data: recs } = await supabase
      .from("ai_recommendations")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_acted_upon", false)
      .order("created_at", { ascending: false });
    if (recs) {
      setAiRecommendations(recs);
    }

    const { data: sysSettings } = await supabase
      .from("public_system_settings")
      .select("vendor_min_transaction")
      .eq("id", 1)
      .maybeSingle();
    if (sysSettings) {
      const settings = sysSettings as any;
      if (settings.vendor_min_transaction) {
        setMinTxAmount(Number(settings.vendor_min_transaction));
      }
    }

    const { data } = await supabase.from("wallets").select("balance, swift_points").eq("agent_id", user.id).single();
    if (data) {
      setWalletBalance(Number(data.balance));
      setSwiftPoints(Number(data.swift_points || 0));
    }

    // Fetch AI Churn Insights
    const { data: churnData } = await supabase.rpc("get_agent_churn_insights", { p_agent_id: user.id });
    if (churnData) {
      setChurnInsights(churnData);
    }

    // Fetch Today's Stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { data: stats } = await supabase
      .from("orders")
      .select("amount, profit, parent_profit, order_type")
      .eq("agent_id", user.id)
      .gte("created_at", today.toISOString())
      .eq("status", "fulfilled");

    if (stats) {
      const totals = stats.reduce((acc, curr) => {
        const isCashIn = curr.order_type === "vendor_cash_in";
        const isCashOut = curr.order_type === "vendor_cash_out";
        const isBank = curr.order_type === "vendor_bank_transfer";
        
        return {
          sales: acc.sales + Number(curr.amount),
          profit: acc.profit + (Number(curr.profit) + Number(curr.parent_profit || 0)),
          count: acc.count + 1,
          cashIn: acc.cashIn + (isCashIn ? Number(curr.amount) : 0),
          cashOut: acc.cashOut + (isCashOut ? Number(curr.amount) : 0),
          bankTransfers: acc.bankTransfers + (isBank ? Number(curr.amount) : 0)
        };
      }, { sales: 0, profit: 0, count: 0, cashIn: 0, cashOut: 0, bankTransfers: 0 });
      setTodayStats(totals);
    }

    // Fetch Recent Vendor Orders
    const { data: recent } = await supabase
      .from("orders")
      .select("*")
      .eq("agent_id", user.id)
      .ilike("order_type", "vendor_%")
      .order("created_at", { ascending: false })
      .limit(50);
    
    if (recent) setRecentOrders(recent);
  };

  const handleVerifyOrderStatus = async (orderId: string, silent = false) => {
    if (!silent) {
      toast.loading("Verifying transaction status...", { id: "verify-order" });
    }
    try {
      const { data, error } = await supabase.functions.invoke("paystack-vendor", {
        body: {
          action: "check-status",
          transaction_id: orderId
        }
      });

      if (error) {
        let msg = error.message;
        try {
          const body = await error.context.json();
          msg = body.error || body.message || error.message;
        } catch (_) { /* ignore */ }
        throw new Error(msg);
      }

      const isSuccess = data && (data.code === "000" || data.status === "approved" || data.status === "successful");
      const isPending = data && (data.code === "100" || data.status === "pending");

      if (isSuccess) {
        if (!silent) {
          toast.success("Transaction successful! Wallet updated.", { id: "verify-order" });
          playSuccessSound();
        }
        fetchBalance();
      } else if (isPending) {
        if (!silent) {
          toast.info("Transaction is still pending approval.", { id: "verify-order" });
        }
      } else {
        if (!silent) {
          toast.error("Transaction failed: " + getErrorMessageFromData(data), { id: "verify-order" });
        }
        fetchBalance();
      }
    } catch (err: any) {
      console.error(err);
      if (!silent) {
        toast.error(err.message || "Failed to verify transaction status", { id: "verify-order" });
      }
    }
  };

  const handleRedeemPoints = async () => {
    if (redeemAmount < 100 || redeemAmount % 100 !== 0) {
      toast.error("Points must be redeemed in multiples of 100");
      return;
    }
    setRedeeming(true);
    try {
      const { data, error } = await supabase.rpc("redeem_swift_points", { p_points: redeemAmount });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Redemption failed");
      
      toast.success(`Successfully redeemed GHS ${data.redeemed_amount.toFixed(2)} to wallet!`);
      setSwiftPoints(data.new_points);
      fetchBalance();
      setShowPointsModal(false);
      playSuccessSound();
    } catch (err: any) {
      toast.error(err.message || "Failed to redeem points");
    } finally {
      setRedeeming(false);
    }
  };

  const handleMomoAction = async () => {
    if (loading) return;
    if (!momoPhone || !momoAmount) {
      toast.error("Please enter both phone number and amount");
      return;
    }
    const amountVal = parseFloat(momoAmount);
    if (isNaN(amountVal) || amountVal < minTxAmount) {
      toast.error(`Minimum transaction amount is GHS ${minTxAmount.toFixed(2)}`);
      return;
    }

    requireSecurityApproval(amountVal, async () => {
      setLoading(true);
      setOverlay({
        isOpen: true,
        type: momoAction === "cash-out" ? "cash-out" : "cash-in",
        step: "submitting",
      amount: amountVal,
      phoneOrAccount: momoPhone,
      networkOrBank: momoNetwork,
    });

    try {
      const actionType = momoAction === "cash-out" ? "momo-collection" : "momo-disbursement";
      const { data, error } = await supabase.functions.invoke("paystack-vendor", {
        body: {
          action: actionType,
          amount: amountVal,
          phone: momoPhone,
          network: momoNetwork,
          description: momoAction === "cash-out" ? "Swift Vendor Collection" : "Swift Vendor Disbursement"
        }
      });

      if (error) {
        let msg = error.message;
        try {
          const body = await error.context.json();
          msg = body.error || body.message || error.message;
        } catch (_) { /* ignore */ }
        throw new Error(msg);
      }

      if (data && (data.code === "000" || data.status === "approved" || data.status === "successful" || data.status === true)) {
        setOverlay(prev => ({
          ...prev,
          step: "success",
          orderId: data.order_id,
          successDetails: {
            transactionId: data.transaction_id || data.order_id,
            accountName: momoAccountName || undefined
          }
        }));
        playSuccessSound();
        if (momoAction === "cash-in" && momoAccountName) {
          saveRecipient(momoAccountName, momoPhone, momoNetwork, "momo");
        }
        // Reset state
        setMomoPhone("");
        setMomoAmount("");
        setMomoAccountName(null);
        fetchBalance();
      } else if (data && (data.code === "100" || data.status === "pending" || data.status === "queued")) {
        if (momoAction === "cash-out") {
          setOverlay(prev => ({
            ...prev,
            step: "verify-pin",
            orderId: data.order_id
          }));
        } else {
          // Cash in (Disbursement) pending/queued -> can display success screen or verify details
          setOverlay(prev => ({
            ...prev,
            step: "success",
            orderId: data.order_id,
            successDetails: {
              transactionId: data.transaction_id || data.order_id,
              accountName: momoAccountName || undefined,
              reference: data.reference_id
            }
          }));
        }
        if (momoAction === "cash-in" && momoAccountName) {
          saveRecipient(momoAccountName, momoPhone, momoNetwork, "momo");
        }
        // Reset state
        setMomoPhone("");
        setMomoAmount("");
        setMomoAccountName(null);
        fetchBalance();
      } else {
        throw new Error(getErrorMessageFromData(data));
      }
    } catch (err: any) {
      console.error(err);
      setOverlay(prev => ({
        ...prev,
        step: "failed",
        errorMsg: err.message || "Failed to process MoMo transaction"
      }));
    } finally {
      setLoading(false);
    }
    });
  };

  const handleMomoEnquiry = async () => {
    if (!momoPhone || momoPhone.length < 10) {
      toast.error("Please enter a valid phone number");
      return;
    }
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("paystack-vendor", {
        body: {
          action: "momo-enquiry",
          phone: momoPhone,
          network: momoNetwork
        }
      });
      if (error) {
        let msg = error.message;
        try {
          const body = await error.context.json();
          msg = body.error || body.message || error.message;
        } catch (_) { /* ignore */ }
        throw new Error(msg);
      }

      if (data && data.status === "successful" && data.account_name) {
        setMomoAccountName(data.account_name);
        toast.success("Account name verified successfully");
      } else {
        toast.error("Verification failed", {
          description: getErrorMessageFromData(data)
        });
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to verify MoMo account");
    } finally {
      setVerifying(false);
    }
  };

  const handleBankEnquiry = async () => {
    if (!bankCode) {
      toast.error("Please select a destination bank");
      return;
    }
    if (!accountNumber || accountNumber.length < 8) {
      toast.error("Please enter a valid account number");
      return;
    }
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("paystack-vendor", {
        body: {
          action: "momo-enquiry",
          phone: accountNumber,
          network: bankCode
        }
      });
      if (error) {
        let msg = error.message;
        try {
          const body = await error.context.json();
          msg = body.error || body.message || error.message;
        } catch (_) { /* ignore */ }
        throw new Error(msg);
      }

      if (data && data.status === "successful" && data.account_name) {
        setAccountName(data.account_name);
        toast.success("Account name verified successfully");
      } else {
        toast.error("Verification failed", {
          description: getErrorMessageFromData(data)
        });
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to verify bank account");
    } finally {
      setVerifying(false);
    }
  };

  const handleBankTransferComplete = async () => {
    if (loading) return;
    if (selectedCountry === "GH") {
      // Ghana Bank Payout Flow via theTeller
      if (!bankCode || !accountNumber || !bankAmount) {
        toast.error("Please enter bank, account number, and amount");
        return;
      }
      const amountVal = parseFloat(bankAmount);
      if (isNaN(amountVal) || amountVal < minTxAmount) {
        toast.error(`Minimum transaction amount is GHS ${minTxAmount.toFixed(2)}`);
        return;
      }

      requireSecurityApproval(amountVal, async () => {
        setLoading(true);
        setOverlay({
          isOpen: true,
          type: "bank",
          step: "submitting",
        amount: amountVal,
        phoneOrAccount: accountNumber,
        networkOrBank: bankCode,
      });

      try {
        const { data: initData, error: initError } = await supabase.functions.invoke("paystack-vendor", {
          body: {
            action: "bank-transfer-init",
            amount: amountVal,
            bank_code: bankCode,
            account_number: accountNumber,
            description: "Swift Vendor Bank Transfer"
          }
        });

        if (initError) {
          let msg = initError.message;
          try {
            const body = await initError.context.json();
            msg = body.error || body.message || initError.message;
          } catch (_) { /* ignore */ }
          throw new Error(msg);
        }

        if (!initData || initData.status === "failed") {
          throw new Error(initData?.message || "Failed to initialize bank transfer");
        }

        const refId = initData.reference_id || initData.transaction_id || initData.data?.reference;
        if (!refId) {
          throw new Error("No reference ID returned from payment gateway");
        }

        const { data: completeData, error: completeError } = await supabase.functions.invoke("paystack-vendor", {
          body: {
            action: "bank-transfer-complete",
            reference_id: refId
          }
        });

        if (completeError) {
          let msg = completeError.message;
          try {
            const body = await completeError.context.json();
            msg = body.error || body.message || completeError.message;
          } catch (_) { /* ignore */ }
          throw new Error(msg);
        }

        if (completeData && (completeData.code === "000" || completeData.status === "approved" || completeData.status === "successful" || completeData.status === true)) {
          setOverlay(prev => ({
            ...prev,
            step: "success",
            orderId: completeData.order_id,
            successDetails: {
              transactionId: completeData.transaction_id || completeData.order_id,
              accountName: accountName || undefined
            }
          }));
          if (accountName) {
            saveRecipient(accountName, accountNumber, bankCode, "bank");
          }
          // Reset state
          setBankCode("");
          setAccountNumber("");
          setBankAmount("");
          setAccountName(null);
          fetchBalance();
        } else {
          throw new Error(getErrorMessageFromData(completeData));
        }
      } catch (err: any) {
        console.error(err);
        setOverlay(prev => ({
          ...prev,
          step: "failed",
          errorMsg: err.message || "Failed to complete bank transfer"
        }));
      } finally {
        setLoading(false);
      }
      });
    } else {
      // Pan-African Payout Flow via Paystack
      if (!bankCode || !accountNumber || !bankAmount) {
        toast.error("Please enter provider, account/phone, and amount");
        return;
      }
      const amountVal = parseFloat(bankAmount);
      if (isNaN(amountVal) || amountVal < minTxAmount) {
        toast.error(`Minimum transaction amount is GHS ${minTxAmount.toFixed(2)}`);
        return;
      }

      const countryInfo = AFRICA_COUNTRIES.find(c => c.code === selectedCountry);
      if (!countryInfo) {
        toast.error("Invalid country selected");
        return;
      }

      requireSecurityApproval(amountVal, async () => {
        setLoading(true);
        setOverlay({
          isOpen: true,
        type: "africa",
        step: "submitting",
        amount: amountVal,
        phoneOrAccount: accountNumber,
        networkOrBank: bankCode,
      });

      try {
        const { data, error } = await supabase.functions.invoke("paystack-vendor", {
          body: {
            action: "africa-transfer",
            amount: amountVal,
            country: selectedCountry,
            account_name: accountName,
            account_number: accountNumber,
            bank_code: bankCode,
            currency: countryInfo.currency,
            description: `Swift Vendor ${countryInfo.name} Payout`
          }
        });

        if (error) {
          let msg = error.message;
          try {
            const body = await error.context.json();
            msg = body.error || body.message || error.message;
          } catch (_) { /* ignore */ }
          throw new Error(msg);
        }

        if (data && data.status === true) {
          setOverlay(prev => ({
            ...prev,
            step: "success",
            orderId: data.order_id,
            successDetails: {
              transactionId: data.transaction_id || data.order_id,
              accountName: accountName || undefined,
              reference: data.reference_id
            }
          }));
          if (accountName) {
            saveRecipient(accountName, accountNumber, bankCode, "africa");
          }
          // Reset state
          setBankCode("");
          setAccountNumber("");
          setBankAmount("");
          setAccountName(null);
          fetchBalance();
        } else {
          throw new Error(getErrorMessageFromData(data));
        }
      } catch (err: any) {
        console.error(err);
        setOverlay(prev => ({
          ...prev,
          step: "failed",
          errorMsg: err.message || "Failed to complete Pan-African transfer"
        }));
      } finally {
        setLoading(false);
      }
      });
    }
  };

  if (isLockedByAdmin) {
    return (
      <div className="relative h-[80vh] w-full flex items-center justify-center overflow-hidden rounded-3xl p-6">
        {/* Neon warning background */}
        <div className="absolute inset-0 bg-[#0c0c0d]">
          <div className="absolute top-[-20%] left-[-20%] w-[50%] h-[50%] rounded-full bg-red-500/10 blur-[120px]" />
          <div className="absolute bottom-[-20%] right-[-20%] w-[50%] h-[50%] rounded-full bg-red-900/5 blur-[120px]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(239,68,68,0.03),transparent)]" />
        </div>

        <Card className="w-full max-w-md border border-red-500/20 bg-black/60 backdrop-blur-2xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.8)] relative overflow-hidden text-center p-8 space-y-6">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-red-500 to-transparent animate-pulse" />
          
          <div className="relative mx-auto w-24 h-24 rounded-full flex items-center justify-center bg-red-500/10 border border-red-500/20">
            <div className="absolute inset-0 rounded-full bg-red-500/20 blur-md animate-pulse" />
            <Lock className="w-12 h-12 text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-500">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span className="text-[9px] font-black uppercase tracking-[0.2em]">Terminal Suspended</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white uppercase italic">Access Revoked</h2>
            <p className="text-sm text-muted-foreground font-semibold leading-relaxed max-w-sm mx-auto">
              Your Swift Vendor agency POS terminal has been locked remotely. Cash collection, float bridge adjustments, and disbursements are currently offline.
            </p>
          </div>

          <div className="pt-4 border-t border-white/5 flex flex-col gap-3">
            <Button 
              className="w-full h-12 rounded-xl font-black bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/20 gap-2"
              onClick={fetchBalance}
              disabled={loading}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Re-Verify Terminal Status
            </Button>
            <Button 
              variant="ghost" 
              className="w-full h-12 rounded-xl font-bold text-muted-foreground hover:text-white"
              onClick={() => window.open("https://wa.me/233244000000", "_blank")}
            >
              Contact Support
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <SecurityGateway>
      <div className="relative h-full w-full overflow-hidden min-h-[80vh] rounded-3xl">
        <div className="p-6 md:p-8 space-y-8 animate-in fade-in duration-700">
          
      {vendorStatus !== "active" && vendorStatus !== "pending_approval" ? (
        <VendorOnboardingWizard 
          initialStatus={vendorStatus} 
          rejectionReason={kycRejectionReason} 
          onComplete={fetchBalance}
          walletBalance={walletBalance}
        />
      ) : (
        <>
          {/* Expiry Warning Banners */}
          {kycExpiryData && (
        <>
          {(() => {
            const warnings = [];
            const today = new Date();
            const daysToNatId = kycExpiryData.natId ? (new Date(kycExpiryData.natId).getTime() - today.getTime()) / (1000 * 3600 * 24) : null;
            const daysToBizCert = kycExpiryData.bizCert ? (new Date(kycExpiryData.bizCert).getTime() - today.getTime()) / (1000 * 3600 * 24) : null;
            
            if (daysToNatId !== null && daysToNatId < 30) {
              warnings.push(`National ID expires in ${Math.ceil(daysToNatId)} days.`);
            }
            if (daysToBizCert !== null && daysToBizCert < 30) {
              warnings.push(`Business Certificate expires in ${Math.ceil(daysToBizCert)} days.`);
            }

            return warnings.length > 0 ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-red-500">Document Expiry Alert</p>
                    <p className="text-xs font-bold text-muted-foreground leading-relaxed">
                      {warnings.join(" ")} Please renew and update your KYC.
                    </p>
                  </div>
                </div>
              </div>
            ) : null;
          })()}
        </>
      )}

      {/* Trial Mode Banner */}
      {vendorStatus === "pending_approval" && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 flex items-center justify-between mb-4 shadow-[0_0_20px_rgba(59,130,246,0.15)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-black text-blue-400">Restricted Trial Mode</p>
              <p className="text-xs font-bold text-blue-400/80 leading-relaxed">
                Your application is under 24-hour review. Transactions are currently capped at <strong className="text-white font-black">GHS 200.00</strong>.
              </p>
            </div>
          </div>
        </div>
      )}

      {walletBalance < balanceThreshold && !isPrivateMode && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in slide-in-from-top-4 duration-500 shadow-[0_0_30px_-5px_rgba(245,158,11,0.15)] relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 to-transparent pointer-events-none" />
          <div className="flex items-center gap-3 relative z-10">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-black text-amber-500">Low Balance Warning</p>
              <p className="text-xs font-bold text-amber-500/80 leading-relaxed max-w-sm">Your float is below GHS {balanceThreshold}. Top up soon to avoid missing transactions.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 relative z-10 shrink-0">
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => {
                toast.success("Auto Top-Up activated. Your float will automatically reload when it drops below GHS 500.", { id: "auto-top-up" });
              }}
              className="bg-transparent border-amber-500/30 hover:bg-amber-500/10 text-amber-500 font-bold rounded-lg h-9 transition-all"
            >
              Enable Auto-Pilot
            </Button>
            <Button 
              size="sm" 
              onClick={() => navigate('/dashboard/wallet')}
              className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black shadow-[0_0_15px_rgba(245,158,11,0.5)] font-black rounded-lg h-9 transition-all hover:scale-105"
            >
              Top Up Now
            </Button>
          </div>
        </div>
      )}

      {/* AI Profit Recommender Banner */}
      {aiRecommendations.length > 0 && (
        <div className="mb-6 grid gap-4 animate-in slide-in-from-top-4 duration-500">
          {aiRecommendations.map((rec) => (
            <div key={rec.id} className="p-4 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 backdrop-blur-md relative overflow-hidden flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between shadow-[0_0_30px_-5px_rgba(99,102,241,0.15)]">
              <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.8)]"></div>
              <div className="flex items-start gap-4 z-10">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center shrink-0 border border-indigo-500/30">
                  <Sparkles className="w-5 h-5 text-indigo-400 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                </div>
                <div>
                  <h3 className="font-black text-indigo-400">{rec.title}</h3>
                  <p className="text-sm mt-1 text-gray-300 font-medium">
                    {rec.message}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto z-10">
                <button 
                  onClick={async () => {
                    await supabase.from("ai_recommendations").update({ is_acted_upon: true }).eq("id", rec.id);
                    setAiRecommendations(prev => prev.filter(r => r.id !== rec.id));
                    navigate("/dashboard/vendor/pricing");
                  }}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-black text-sm flex-1 sm:flex-none text-center shadow-[0_0_15px_rgba(99,102,241,0.4)] transition-all hover:scale-105"
                >
                  Update Pricing
                </button>
                <button 
                  onClick={async () => {
                    await supabase.from("ai_recommendations").update({ is_acted_upon: true }).eq("id", rec.id);
                    setAiRecommendations(prev => prev.filter(r => r.id !== rec.id));
                  }}
                  className="p-2 rounded-xl hover:bg-white/10 text-gray-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <Zap className="w-8 h-8 text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.5)]" />
            Swift Vendor
            <Badge className="bg-emerald-500 text-white border-none uppercase font-black px-2 py-0.5 animate-pulse text-[10px] shadow-lg shadow-emerald-500/20">NEW</Badge>
          </h1>
          <p className="text-muted-foreground mt-1.5 font-medium text-sm">Flagship Agency Banking POS by theTeller</p>
        </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#1c1c1e]/80 backdrop-blur-xl border border-white/5 rounded-2xl p-4 flex flex-col justify-center gap-1.5 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
          <p className="text-[9px] font-black uppercase tracking-widest text-primary/70">Float</p>
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            <p className={cn("text-base font-black text-primary truncate", isPrivateMode && "blur-md")}>
              GHS {walletBalance.toFixed(1)}
            </p>
          </div>
        </div>

        <div className="bg-[#1c1c1e]/80 backdrop-blur-xl border border-white/5 rounded-2xl p-4 flex flex-col justify-center gap-1.5 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500/70">Profit</p>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-emerald-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]" />
            <p className={cn("text-base font-black text-emerald-500 truncate", isPrivateMode && "blur-md")}>
              GHS {todayStats.profit.toFixed(1)}
            </p>
          </div>
        </div>

        <div 
          onClick={() => setShowPointsModal(true)}
          className="bg-[#1c1c1e]/80 backdrop-blur-xl border border-white/5 rounded-2xl p-4 flex flex-col justify-center gap-1.5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] cursor-pointer hover:bg-white/5 transition-all group"
        >
          <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400/70 group-hover:text-indigo-400 transition-colors">Swift Points</p>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400 group-hover:animate-pulse" />
            <p className={cn("text-base font-black text-indigo-400 truncate", isPrivateMode && "blur-md")}>
              {swiftPoints.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="bg-[#1c1c1e]/80 backdrop-blur-xl border border-white/5 rounded-2xl p-4 flex flex-col justify-center gap-1.5 relative overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Security</p>
             <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6 rounded-full bg-white/5 text-muted-foreground hover:text-primary hover:bg-white/10 transition-colors"
              onClick={() => window.location.reload()} // Force reload to trigger lock
            >
              <Lock className="w-3.5 h-3.5" />
            </Button>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            className={cn("h-8 w-full rounded-xl justify-start p-2 transition-all active:scale-95", isPrivateMode ? "bg-amber-500/10 text-amber-500" : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white")}
            onClick={() => setIsPrivateMode(!isPrivateMode)}
          >
            {isPrivateMode ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
            <span className="text-[11px] font-bold">{isPrivateMode ? "Hidden" : "Public"}</span>
          </Button>
        </div>
      </div>
    </div>

          <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="overflow-x-auto pb-4 scrollbar-hide -mx-6 px-6">
          <TabsList className="bg-[#1c1c1e]/60 backdrop-blur-xl border border-white/5 p-1.5 rounded-[28px] h-[58px] w-max sm:w-auto inline-flex whitespace-nowrap shadow-inner">
            <TabsTrigger value="momo" className="rounded-[22px] h-[46px] px-5 sm:px-8 font-black gap-2.5 data-[state=active]:bg-white data-[state=active]:text-black transition-all data-[state=active]:shadow-sm">
              <Phone className="w-4 h-4" />
              MoMo Agency
            </TabsTrigger>
            <TabsTrigger value="bank" className="rounded-[22px] h-[46px] px-5 sm:px-8 font-black gap-2.5 data-[state=active]:bg-white data-[state=active]:text-black transition-all data-[state=active]:shadow-sm">
              <Landmark className="w-4 h-4" />
              Bank Transfer
            </TabsTrigger>
            <TabsTrigger value="africa" className="rounded-[22px] h-[46px] px-5 sm:px-8 font-black gap-2.5 data-[state=active]:bg-white data-[state=active]:text-black transition-all data-[state=active]:shadow-sm text-indigo-400 data-[state=active]:text-indigo-600">
              <Zap className="w-4 h-4" />
              Africa Hub
            </TabsTrigger>
            <TabsTrigger value="franchises" className="rounded-[22px] h-[46px] px-5 sm:px-8 font-black gap-2.5 data-[state=active]:bg-white data-[state=active]:text-black transition-all data-[state=active]:shadow-sm">
              <Users className="w-4 h-4" />
              My Franchises
            </TabsTrigger>
            <TabsTrigger value="insights" className="rounded-[22px] h-[46px] px-5 sm:px-8 font-black gap-2.5 data-[state=active]:bg-white data-[state=active]:text-black transition-all data-[state=active]:shadow-sm">
              <Search className="w-4 h-4" />
              Insights
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="momo" className="animate-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card className="border border-white/5 bg-[#1c1c1e]/60 backdrop-blur-2xl shadow-2xl shadow-black/20 overflow-hidden rounded-[24px]">
              <CardHeader className="bg-white/5 border-b border-white/5 pb-5">
                <CardTitle className="text-xl font-black flex items-center gap-2">
                  <ArrowRightLeft className="w-5 h-5 text-primary" />
                  Initiate MoMo Transaction
                </CardTitle>
                <CardDescription className="text-xs font-bold mt-1">Perform Cash-In (Deposit) or Cash-Out (Withdrawal)</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-1 bg-black/40 p-1.5 rounded-[14px] h-[52px] shadow-inner border border-white/5">
                  <button 
                    onClick={() => setMomoAction("cash-out")}
                    className={cn(
                      "rounded-[10px] font-black text-sm transition-all flex items-center justify-center gap-2 active:scale-95 duration-200",
                      momoAction === "cash-out" ? "bg-[#2c2c2e] shadow-md text-primary" : "text-muted-foreground hover:text-white"
                    )}
                  >
                    <ArrowDownCircle className="w-4 h-4" />
                    Cash-Out
                  </button>
                  <button 
                    onClick={() => setMomoAction("cash-in")}
                    className={cn(
                      "rounded-[10px] font-black text-sm transition-all flex items-center justify-center gap-2 active:scale-95 duration-200",
                      momoAction === "cash-in" ? "bg-[#2c2c2e] shadow-md text-primary" : "text-muted-foreground hover:text-white"
                    )}
                  >
                    <ArrowUpCircle className="w-4 h-4" />
                    Cash-In
                  </button>
                </div>

                {savedRecipients.filter(r => r.type === "momo").length > 0 && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Frequent Recipient Quick-Click</Label>
                    <div className="flex flex-wrap gap-2">
                      {savedRecipients
                        .filter(r => r.type === "momo")
                        .reduce((acc: any[], current) => {
                          const x = acc.find(item => item.account_number === current.account_number);
                          if (!x) acc.push(current);
                          return acc;
                        }, [])
                        .slice(0, 4)
                        .map((recipient, idx) => (
                          <button
                            key={idx}
                            type="button"
                            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-xs font-bold text-white active:scale-95 text-left shrink-0"
                            onClick={() => {
                              setMomoPhone(recipient.account_number);
                              setMomoNetwork(recipient.network_or_bank);
                              if (recipient.name) {
                                setMomoAccountName(recipient.name);
                              }
                              toast.info(`Selected ${recipient.name || recipient.account_number}`);
                            }}
                          >
                            <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-black uppercase text-primary shrink-0">
                              {recipient.name ? recipient.name.charAt(0) : "M"}
                            </div>
                            <div className="leading-tight truncate max-w-[100px]">
                              <p className="text-[9px] font-black text-white truncate leading-none mb-0.5">{recipient.name || "Customer"}</p>
                              <p className="text-[8px] text-muted-foreground leading-none">{recipient.account_number}</p>
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Network</Label>
                    <Select value={momoNetwork} onValueChange={setMomoNetwork}>
                      <SelectTrigger className="h-12 rounded-xl bg-muted/30 border-none font-bold">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MTN">MTN Mobile Money</SelectItem>
                        <SelectItem value="VOD">Telecel Cash</SelectItem>
                        <SelectItem value="ATL">AirtelTigo Money</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Phone Number</Label>
                    <Input 
                      placeholder="e.g. 0244000000" 
                      className="h-12 rounded-xl bg-muted/30 border-none font-bold text-lg"
                      value={momoPhone}
                      onChange={(e) => setMomoPhone(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Amount (GHS)</Label>
                    <Input 
                      type="number" 
                      placeholder="0.00" 
                      className="h-12 rounded-xl bg-muted/30 border-none font-bold text-2xl text-primary"
                      value={momoAmount}
                      onChange={(e) => setMomoAmount(e.target.value)}
                    />
                  </div>

                  {momoAction === "cash-in" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between ml-1">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Recipient Name</Label>
                        <button 
                          type="button" 
                          onClick={handleMomoEnquiry}
                          disabled={verifying || momoPhone.length < 10}
                          className="text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
                        >
                          {verifying ? "VERIFYING..." : "AUTO-VERIFY"}
                        </button>
                      </div>
                      <Input 
                        placeholder="Enter recipient name" 
                        className="h-12 rounded-xl bg-muted/30 border-none font-bold text-lg"
                        value={momoAccountName || ""}
                        onChange={(e) => setMomoAccountName(e.target.value)}
                      />
                    </div>
                  )}

                  <Button 
                    className="w-full h-14 rounded-2xl text-lg font-black shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
                    disabled={loading || (momoAction === "cash-in" && !momoAccountName)}
                    onClick={() => {
                      handleMomoAction();
                      if (momoAccountName) saveRecipient(momoAccountName, momoPhone, momoNetwork, "momo");
                    }}
                  >
                    {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : (
                      momoAction === "cash-out" ? "Request Money (Collect)" : "Send Money (Disburse)"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="border-none bg-amber-400/5 shadow-xl shadow-black/5">
                <CardContent className="p-6">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-amber-400/10 flex items-center justify-center shrink-0">
                      <Info className="w-6 h-6 text-amber-400" />
                    </div>
                    <div className="space-y-2">
                      <h4 className="font-black text-amber-400 uppercase tracking-widest text-[10px]">How it works</h4>
                      <p className="text-sm text-muted-foreground leading-relaxed font-medium">
                        {momoAction === "cash-out" 
                          ? "Enter the customer's number and amount. They will receive a prompt on their phone to enter their PIN. Once approved, funds are added to your floating balance instantly."
                          : "Funds will be deducted from your floating balance and sent directly to the customer's wallet. Ensure you have collected physical cash before confirming."
                        }
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-none bg-card/50 shadow-xl shadow-black/5 overflow-hidden">
                 <CardHeader className="py-4 border-b border-white/5 space-y-4">
                    <div className="flex items-center justify-between">
                       <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                          <History className="w-4 h-4 text-primary" />
                          Recent Activity
                       </CardTitle>
                       <Button 
                         variant="outline" 
                         size="sm" 
                         className="h-8 rounded-lg text-xs font-bold border-white/10 hover:bg-white/5 gap-1.5"
                         onClick={handleExportCSV}
                       >
                         <Download className="w-3.5 h-3.5" />
                         Export CSV
                       </Button>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row gap-2">
                       <div className="relative flex-1">
                          <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                          <Input 
                             placeholder="Search phone, ID..." 
                             className="h-9 pl-9 rounded-xl bg-muted/40 border-none font-bold text-xs"
                             value={searchQuery}
                             onChange={(e) => setSearchQuery(e.target.value)}
                          />
                       </div>
                       <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                          {(["all", "fulfilled", "pending", "failed"] as const).map((status) => (
                             <button
                                key={status}
                                onClick={() => setStatusFilter(status)}
                                className={cn(
                                   "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all border shrink-0",
                                   statusFilter === status 
                                      ? "bg-primary text-black border-primary" 
                                      : "bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10"
                                )}
                             >
                                {status === "fulfilled" ? "Success" : status}
                             </button>
                          ))}
                       </div>
                    </div>
                 </CardHeader>
                 <CardContent className="p-0">
                    <div className="divide-y divide-white/5 max-h-[480px] overflow-y-auto scrollbar-thin">
                      {filteredOrders.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground text-xs font-bold">
                          No matching transactions found
                        </div>
                      ) : (
                        filteredOrders.map((order) => {
                          const isCashIn = order.order_type === "vendor_cash_in" || order.order_type === "vendor_bank_transfer";
                          return (
                            <div 
                              key={order.id} 
                              className="px-4 py-3.5 flex items-center justify-between hover:bg-white/5 transition-all cursor-pointer active:scale-[0.98] active:bg-white/10"
                              onClick={() => setSelectedReceipt(order)}
                            >
                              <div className="flex items-center gap-3.5">
                                <div className={cn("w-11 h-11 rounded-[14px] flex items-center justify-center shadow-inner", isCashIn ? "bg-red-500/15" : "bg-emerald-500/15")}>
                                    {isCashIn ? <ArrowUpCircle className="w-6 h-6 text-red-500 drop-shadow-md" /> : <ArrowDownCircle className="w-6 h-6 text-emerald-500 drop-shadow-md" />}
                                </div>
                                <div>
                                   <p className="text-sm font-black tracking-tight">{order.customer_phone || (order.order_type === "vendor_bank_transfer" ? "Bank Transfer" : "Vendor")}</p>
                                   <p className="text-[11px] font-bold text-muted-foreground mt-0.5">
                                     {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                   </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8 rounded-full text-primary bg-primary/10 hover:bg-primary/20 transition-transform active:scale-90"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleShareReceipt(order);
                                  }}
                                >
                                  <Share2 className="w-4 h-4" />
                                </Button>
                                <div className="text-right flex flex-col items-end justify-center">
                                   <p className={cn("text-sm font-black tracking-tight", isCashIn ? "text-red-400" : "text-emerald-400")}>
                                      {isCashIn ? "-" : "+"}GHS {Number(order.amount).toFixed(2)}
                                   </p>
                                   {order.status === "pending" ? (
                                     <button 
                                       onClick={(e) => {
                                         e.stopPropagation();
                                         handleVerifyOrderStatus(order.id);
                                       }}
                                       className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 hover:bg-amber-400/20 transition-all text-[8px] font-black uppercase cursor-pointer border-none mt-1"
                                       title="Verify Transaction Status"
                                     >
                                       Pending <RefreshCw className="w-2 h-2 animate-[spin_3s_linear_infinite]" />
                                     </button>
                                   ) : (
                                     <Badge className={cn(
                                       "border-none h-4 text-[8px] px-1 font-black mt-1 shadow-sm",
                                       order.status === "fulfilled" ? "bg-emerald-400/10 text-emerald-400" : 
                                       (order.status === "failed" ? "bg-red-400/10 text-red-400" : "bg-amber-400/10 text-amber-400")
                                     )}>
                                       {order.status.toUpperCase()}
                                     </Badge>
                                   )}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                 </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="bank" className="animate-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card className="border border-white/5 bg-[#1c1c1e]/60 backdrop-blur-2xl shadow-2xl shadow-black/20 overflow-hidden rounded-[24px]">
              <CardHeader className="bg-white/5 border-b border-white/5 pb-5">
                <CardTitle className="text-xl font-black flex items-center gap-2">
                  <Landmark className="w-5 h-5 text-primary" />
                  Bank Disbursement
                </CardTitle>
                <CardDescription className="text-xs font-bold mt-1">Send funds to any local bank account in Ghana</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {savedRecipients.filter(r => r.type === "bank").length > 0 && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Frequent Recipient Quick-Click</Label>
                    <div className="flex flex-wrap gap-2">
                      {savedRecipients
                        .filter(r => r.type === "bank")
                        .reduce((acc: any[], current) => {
                          const x = acc.find(item => item.account_number === current.account_number);
                          if (!x) acc.push(current);
                          return acc;
                        }, [])
                        .slice(0, 4)
                        .map((recipient, idx) => (
                          <button
                            key={idx}
                            type="button"
                            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-xs font-bold text-white active:scale-95 text-left shrink-0"
                            onClick={() => {
                              setAccountNumber(recipient.account_number);
                              setBankCode(recipient.network_or_bank);
                              if (recipient.name) {
                                setAccountName(recipient.name);
                              }
                              toast.info(`Selected ${recipient.name || recipient.account_number}`);
                            }}
                          >
                            <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-black uppercase text-primary shrink-0">
                              {recipient.name ? recipient.name.charAt(0) : "B"}
                            </div>
                            <div className="leading-tight truncate max-w-[100px]">
                              <p className="text-[9px] font-black text-white truncate leading-none mb-0.5">{recipient.name || "Customer"}</p>
                              <p className="text-[8px] text-muted-foreground leading-none">{recipient.account_number}</p>
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Destination Bank</Label>
                    <Select value={bankCode} onValueChange={setBankCode}>
                      <SelectTrigger className="h-12 rounded-xl bg-muted/30 border-none font-bold">
                        <SelectValue placeholder="Select Bank" />
                      </SelectTrigger>
                      <SelectContent>
                        {GHANA_BANKS.map((bank, idx) => (
                          <SelectItem key={`${bank.code}-${idx}`} value={bank.code}>{bank.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Account Number</Label>
                    <Input 
                      placeholder="Enter account number" 
                      className="h-12 rounded-xl bg-muted/30 border-none font-bold text-lg"
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Amount (GHS)</Label>
                    <Input 
                      type="number" 
                      placeholder="0.00" 
                      className="h-12 rounded-xl bg-muted/30 border-none font-bold text-2xl text-primary"
                      value={bankAmount}
                      onChange={(e) => setBankAmount(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between ml-1">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Account Name</Label>
                      <button 
                        type="button" 
                        onClick={handleBankEnquiry}
                        disabled={verifying || !bankCode || !accountNumber || accountNumber.length < 8}
                        className="text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
                      >
                        {verifying ? "VERIFYING..." : "AUTO-VERIFY"}
                      </button>
                    </div>
                    <Input 
                      placeholder="Enter account name" 
                      className="h-12 rounded-xl bg-muted/30 border-none font-bold text-lg"
                      value={accountName || ""}
                      onChange={(e) => setAccountName(e.target.value)}
                    />
                  </div>

                  <Button 
                    className="w-full h-14 rounded-2xl text-lg font-black shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
                    disabled={loading || !accountName}
                    onClick={handleBankTransferComplete}
                  >
                    {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : "Complete Bank Transfer"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="border border-indigo-400/10 bg-[#1c1c1e]/60 backdrop-blur-xl shadow-lg shadow-black/20 rounded-[20px]">
                <CardContent className="p-5">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-400/15 flex items-center justify-center shrink-0 shadow-inner">
                      <Search className="w-6 h-6 text-indigo-400 drop-shadow-md" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-black text-indigo-400 uppercase tracking-widest text-[10px]">Verification First</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                        Always use the **Verify Account Details** button before completing a transfer. This ensures your funds are sent to the correct recipient. Bank transfers are processed instantly via the GIP network.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-red-400/10 bg-[#1c1c1e]/60 backdrop-blur-xl shadow-lg shadow-black/20 rounded-[20px]">
                <CardContent className="p-5">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-red-400/15 flex items-center justify-center shrink-0 shadow-inner">
                      <AlertCircle className="w-6 h-6 text-red-400 drop-shadow-md" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-black text-red-400 uppercase tracking-widest text-[10px]">Security Notice</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                        Bank transfers are final and irreversible. Ensure the account name returned by the system matches the person you intend to pay.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Button 
                variant="ghost" 
                className="w-full h-14 rounded-2xl text-muted-foreground hover:text-primary gap-2 font-bold"
                onClick={fetchBalance}
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Floating Balance
              </Button>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="africa" className="animate-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card className="border border-white/5 bg-[#1c1c1e]/60 backdrop-blur-2xl shadow-2xl shadow-black/20 overflow-hidden rounded-[24px]">
               <CardHeader className="bg-white/5 border-b border-white/5 pb-5">
                <CardTitle className="text-xl font-black flex items-center gap-2">
                  <Zap className="w-5 h-5 text-indigo-500" />
                  Pan-African Payouts
                </CardTitle>
                <CardDescription className="text-xs font-bold mt-1">Send money to any bank or MoMo across Africa via Paystack</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {savedRecipients.filter(r => r.type === "africa").length > 0 && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Frequent Recipient Quick-Click</Label>
                    <div className="flex flex-wrap gap-2">
                      {savedRecipients
                        .filter(r => r.type === "africa")
                        .reduce((acc: any[], current) => {
                          const x = acc.find(item => item.account_number === current.account_number);
                          if (!x) acc.push(current);
                          return acc;
                        }, [])
                        .slice(0, 4)
                        .map((recipient, idx) => (
                          <button
                            key={idx}
                            type="button"
                            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-xs font-bold text-white active:scale-95 text-left shrink-0"
                            onClick={() => {
                              setAccountNumber(recipient.account_number);
                              setBankCode(recipient.network_or_bank);
                              if (recipient.name) {
                                setAccountName(recipient.name);
                              }
                              toast.info(`Selected ${recipient.name || recipient.account_number}`);
                            }}
                          >
                            <div className="w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center text-[10px] font-black uppercase text-indigo-400 shrink-0">
                              {recipient.name ? recipient.name.charAt(0) : "A"}
                            </div>
                            <div className="leading-tight truncate max-w-[100px]">
                              <p className="text-[9px] font-black text-white truncate leading-none mb-0.5">{recipient.name || "Customer"}</p>
                              <p className="text-[8px] text-muted-foreground leading-none">{recipient.account_number}</p>
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
                 <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Destination Country</Label>
                    <Select value={selectedCountry} onValueChange={setSelectedCountry}>
                      <SelectTrigger className="h-12 rounded-xl bg-muted/30 border-none font-bold">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AFRICA_COUNTRIES.map((c) => (
                          <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Destination Bank/Provider</Label>
                    <Select value={bankCode} onValueChange={setBankCode}>
                      <SelectTrigger className="h-12 rounded-xl bg-muted/30 border-none font-bold">
                        <SelectValue placeholder="Select Provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {africaBanks.map((bank, idx) => (
                          <SelectItem key={`${bank.code}-${idx}`} value={bank.code}>{bank.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Account Number / Phone</Label>
                    <Input 
                      placeholder="Enter details" 
                      className="h-12 rounded-xl bg-muted/30 border-none font-bold text-lg"
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Amount ({AFRICA_COUNTRIES.find(c => c.code === selectedCountry)?.currency})</Label>
                    <Input 
                      type="number" 
                      placeholder="0.00" 
                      className="h-12 rounded-xl bg-muted/30 border-none font-bold text-2xl text-indigo-500"
                      value={bankAmount}
                      onChange={(e) => setBankAmount(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between ml-1">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Account Name</Label>
                      {(selectedCountry === 'GH' || selectedCountry === 'NG') && (
                        <button 
                          type="button" 
                          onClick={handleBankEnquiry}
                          disabled={verifying || !bankCode || !accountNumber}
                          className="text-[10px] font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-400 disabled:opacity-50 transition-colors"
                        >
                          {verifying ? "VERIFYING..." : "AUTO-VERIFY"}
                        </button>
                      )}
                    </div>
                    <Input 
                      placeholder="Enter recipient name" 
                      className="h-12 rounded-xl bg-muted/30 border-none font-bold text-lg"
                      value={accountName || ""}
                      onChange={(e) => setAccountName(e.target.value)}
                    />
                  </div>

                  <Button 
                    className="w-full h-14 rounded-2xl text-lg font-black bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 active:scale-[0.98] transition-all"
                    disabled={loading || !accountName}
                    onClick={handleBankTransferComplete}
                  >
                    {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : `Send to ${selectedCountry}`}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
               <Card className="border border-indigo-500/10 bg-[#1c1c1e]/60 backdrop-blur-xl shadow-lg shadow-black/20 overflow-hidden rounded-[20px]">
                <div className="bg-indigo-500/10 p-4 border-b border-white/5">
                   <h4 className="font-black text-indigo-500 uppercase tracking-widest text-[10px] flex items-center gap-2">
                     <Globe className="w-3 h-3" />
                     Live Market Rates (1 GHS)
                   </h4>
                </div>
                <CardContent className="p-0">
                  <div className="divide-y divide-indigo-500/5">
                    <div className="p-4 flex items-center justify-between">
                      <span className="text-sm font-bold flex items-center gap-2">
                         <span className="w-6 h-4 bg-green-600/20 rounded-sm flex items-center justify-center text-[8px] font-bold">NG</span>
                         Nigeria (NGN)
                      </span>
                      <span className="font-black text-indigo-500">₦{exchangeRates.NGN.toFixed(2)}</span>
                    </div>
                    <div className="p-4 flex items-center justify-between">
                      <span className="text-sm font-bold flex items-center gap-2">
                         <span className="w-6 h-4 bg-red-600/20 rounded-sm flex items-center justify-center text-[8px] font-bold">KE</span>
                         Kenya (KES)
                      </span>
                      <span className="font-black text-indigo-500">KSh{exchangeRates.KES.toFixed(2)}</span>
                    </div>
                    <div className="p-4 flex items-center justify-between">
                      <span className="text-sm font-bold flex items-center gap-2">
                         <span className="w-6 h-4 bg-blue-600/20 rounded-sm flex items-center justify-center text-[8px] font-bold">ZA</span>
                         South Africa (ZAR)
                      </span>
                      <span className="font-black text-indigo-500">R{exchangeRates.ZAR.toFixed(2)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

               <Card className="border border-indigo-500/10 bg-[#1c1c1e]/60 backdrop-blur-xl shadow-lg shadow-black/20 rounded-[20px]">
                <CardContent className="p-5">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 flex items-center justify-center shrink-0 shadow-inner">
                      <Zap className="w-6 h-6 text-indigo-500 drop-shadow-md" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-black text-indigo-500 uppercase tracking-widest text-[10px]">Currency Exchange</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                        Paystack handles the currency conversion automatically. Your GHS balance will be deducted based on the real-time exchange rate plus a small processing fee.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

               <Card className="border border-amber-400/10 bg-[#1c1c1e]/60 backdrop-blur-xl shadow-lg shadow-black/20 rounded-[20px]">
                <CardContent className="p-5">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-amber-400/15 flex items-center justify-center shrink-0 shadow-inner">
                      <Info className="w-6 h-6 text-amber-400 drop-shadow-md" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-black text-amber-400 uppercase tracking-widest text-[10px]">Processing Times</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                        Transfers to Nigeria and Kenya are typically instant. South African bank transfers may take up to 24 hours depending on the receiving bank.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="franchises" className="animate-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <Card className="border border-white/5 bg-[#1c1c1e]/60 backdrop-blur-2xl shadow-2xl shadow-black/20 lg:col-span-2 rounded-[24px]">
              <CardHeader className="bg-white/5 border-b border-white/5 pb-5 rounded-t-[24px]">
                <CardTitle className="text-xl font-black flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary" />
                  My Sub-Agents
                </CardTitle>
                <CardDescription className="text-xs font-bold mt-1">Manage your franchise kiosks and bridge float instantly</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                {loadingSubAgents ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  </div>
                ) : subAgents.length === 0 ? (
                  <div className="text-center p-8 space-y-4">
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto">
                      <Users className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground font-bold">You haven't added any sub-agents yet.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {subAgents.map((agent: any) => (
                      <div key={agent.user_id} className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-2xl">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary font-black uppercase text-xl">
                            {agent.full_name?.charAt(0) || "A"}
                          </div>
                          <div>
                            <p className="font-black text-white">{agent.full_name}</p>
                            <p className="text-xs font-bold text-muted-foreground">{agent.momo_number}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right hidden sm:block">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Today's Sales</p>
                            <p className="font-black text-emerald-400">GHS {Number(agent.total_sales_today).toFixed(2)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Float Balance</p>
                            <p className={cn("font-black text-lg", Number(agent.wallet_balance) < 100 ? "text-amber-500" : "text-primary")}>
                              GHS {Number(agent.wallet_balance).toFixed(2)}
                            </p>
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="h-10 rounded-xl border-primary/20 hover:bg-primary/10 text-primary font-bold gap-2"
                            onClick={() => setBridgeFloatModal({isOpen: true, subAgent: agent})}
                          >
                            <Zap className="w-4 h-4" />
                            Bridge Float
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="border border-primary/10 bg-[#1c1c1e]/60 backdrop-blur-xl shadow-lg shadow-black/20 rounded-[20px]">
                <CardContent className="p-5">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0 shadow-inner">
                      <Zap className="w-6 h-6 text-primary drop-shadow-md" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-black text-primary uppercase tracking-widest text-[10px]">What is Float Bridging?</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                        If one of your sub-agents runs out of float during a busy day, you can instantly bridge them some of your own float so they don't have to turn away customers.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="insights" className="animate-in slide-in-from-bottom-4 duration-500">
          <div className="space-y-6">
            <div className="bg-[#1c1c1e]/60 backdrop-blur-xl rounded-3xl p-6 border border-indigo-500/30">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-black text-indigo-400 flex items-center gap-2">
                    <Sparkles className="w-5 h-5" /> AI Churn Insights
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">Smart alerts for loyal customers who haven't bought in a while.</p>
                </div>
              </div>

              {churnInsights.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-indigo-500/20 rounded-2xl">
                  <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-indigo-400" />
                  </div>
                  <h3 className="text-lg font-black text-white">Your customers are highly engaged!</h3>
                  <p className="text-sm text-muted-foreground">Our AI couldn't find any loyal customers who are currently at risk of churning.</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {churnInsights.map((insight, idx) => (
                    <div key={idx} className="bg-black/40 rounded-2xl p-4 border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20 shrink-0">
                          <AlertTriangle className="w-6 h-6 text-red-500" />
                        </div>
                        <div>
                          <p className="font-black text-white text-lg">{insight.phone}</p>
                          <p className="text-xs text-muted-foreground font-medium mt-1">
                            <span className="text-red-400">At Risk!</span> Last bought {insight.days_since_last_purchase} days ago.
                          </p>
                          <div className="flex gap-2 mt-2">
                            <Badge variant="outline" className="text-[10px] bg-white/5">{insight.total_orders} Past Orders</Badge>
                            <Badge variant="outline" className="text-[10px] bg-white/5">Usually buys {insight.favorite_package}</Badge>
                          </div>
                        </div>
                      </div>
                      <Button 
                        onClick={() => navigate('/dashboard/vendor/settings')}
                        className="bg-indigo-500 hover:bg-indigo-600 text-white font-black rounded-xl h-10 shrink-0"
                      >
                        Send Promo SMS
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
            <Card className="border border-white/5 bg-[#1c1c1e]/60 backdrop-blur-2xl shadow-2xl shadow-black/20 lg:col-span-2 rounded-[24px]">
               <CardHeader className="bg-white/5 border-b border-white/5 pb-5 rounded-t-[24px]">
                <CardTitle className="text-xl font-black flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                  Daily Reconciliation Report
                </CardTitle>
                <CardDescription className="text-xs font-bold mt-1">Summary of physical cash vs digital float movements</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div>
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-4">Cash Inflow (From Customers)</h4>
                      <div className="flex items-center justify-between p-4 bg-emerald-500/5 rounded-2xl border border-emerald-500/10">
                        <span className="font-bold text-sm">MoMo Cash-Outs</span>
                        <span className="font-black text-emerald-500">GHS {todayStats.cashOut.toFixed(2)}</span>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-4">Cash Outflow (To Customers)</h4>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between p-4 bg-red-500/5 rounded-2xl border border-red-500/10">
                          <span className="font-bold text-sm">MoMo Cash-Ins</span>
                          <span className="font-black text-red-500">GHS {todayStats.cashIn.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between p-4 bg-red-500/5 rounded-2xl border border-red-500/10">
                          <span className="font-bold text-sm">Bank Transfers</span>
                          <span className="font-black text-red-500">GHS {todayStats.bankTransfers.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-primary/5 rounded-3xl p-8 flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
                      <Wallet className="w-8 h-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Expected Physical Cash</h3>
                      <p className="text-4xl font-black text-primary">GHS {(todayStats.cashOut - (todayStats.cashIn + todayStats.bankTransfers)).toFixed(2)}</p>
                      <p className="text-[10px] font-bold text-muted-foreground mt-2 px-4 leading-relaxed">
                        This is the net physical cash you should have collected from customers today.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
               <Card className="border border-emerald-500/10 bg-[#1c1c1e]/60 backdrop-blur-xl shadow-lg shadow-black/20 rounded-[20px]">
                <CardContent className="p-5">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 flex items-center justify-center shrink-0 shadow-inner">
                      <Zap className="w-6 h-6 text-emerald-500 drop-shadow-md" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-black text-emerald-500 uppercase tracking-widest text-[10px]">Total Revenue</h4>
                      <p className="text-2xl font-black">GHS {todayStats.profit.toFixed(2)}</p>
                      <p className="text-[11px] text-muted-foreground font-bold">Earned from {todayStats.count} transactions</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Button className="w-full h-14 rounded-2xl font-black gap-2" variant="outline" onClick={() => window.print()}>
                 Print Daily Summary
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
      </>
      )}
      </div>
      </div>

      {overlay.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-300">
          <div className="relative w-full max-w-md bg-[#0e0e10]/95 border border-white/10 rounded-[32px] p-8 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col items-center text-center space-y-6 animate-in zoom-in-95 slide-in-from-bottom-10 duration-500">
            
            {/* Decorative background glow */}
            <div className={cn(
              "absolute -top-24 w-48 h-48 rounded-full blur-[80px] opacity-20 pointer-events-none",
              overlay.step === "success" ? "bg-emerald-500" :
              overlay.step === "failed" ? "bg-red-500" :
              overlay.step === "verify-pin" ? "bg-amber-500" : "bg-primary"
            )} />

            {/* STEP: SUBMITTING / PROCESSING */}
            {overlay.step === "submitting" && (
              <div className="py-6 space-y-6 flex flex-col items-center">
                <div className="relative flex items-center justify-center">
                  <div className="w-20 h-20 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                  <RefreshCw className="w-8 h-8 text-primary absolute animate-pulse" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-black text-white">Processing Transaction</h3>
                  <p className="text-sm text-muted-foreground font-medium max-w-[280px]">
                    Initiating your {overlay.type === "cash-out" ? "cash collection" : "disbursement"} of <span className="font-bold text-white">GHS {overlay.amount}</span>. Please wait...
                  </p>
                </div>
              </div>
            )}

            {/* STEP: VERIFY PIN */}
            {overlay.step === "verify-pin" && (
              <div className="py-4 space-y-6 flex flex-col items-center w-full">
                <div className="relative flex items-center justify-center">
                  {/* Pulsing ring */}
                  <div className="absolute w-24 h-24 rounded-full bg-amber-500/10 animate-ping duration-1000" />
                  <div className="w-20 h-20 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                    <Phone className="w-10 h-10 text-amber-500 animate-bounce" />
                  </div>
                  {/* Clock/Countdown badge */}
                  <div className="absolute -bottom-2 -right-2 bg-amber-500 text-black text-xs font-black w-8 h-8 rounded-full flex items-center justify-center border-4 border-[#0e0e10]">
                    {overlay.countdown ?? 60}s
                  </div>
                </div>
                
                <div className="space-y-2 px-2">
                  <h3 className="text-xl font-black text-amber-500 uppercase tracking-wider">Confirm PIN</h3>
                  <p className="text-sm text-muted-foreground font-medium leading-relaxed">
                    A prompt has been sent to <span className="font-bold text-white">{overlay.phoneOrAccount}</span>. Please enter your mobile money PIN to authorize the transaction of <span className="font-black text-white">GHS {overlay.amount}</span>.
                  </p>
                </div>

                <div className="w-full p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 flex items-center gap-3 text-left">
                  <Loader2 className="w-5 h-5 text-amber-500 animate-spin shrink-0" />
                  <p className="text-[11px] text-amber-500/80 font-semibold uppercase tracking-wider">
                    Waiting for PIN confirmation...
                  </p>
                </div>
              </div>
            )}

            {/* STEP: SUCCESS */}
            {overlay.step === "success" && (
              <div className="py-4 space-y-6 flex flex-col items-center w-full">
                <div className="w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center animate-in zoom-in-50 duration-500">
                  <CheckCircle2 className="w-12 h-12 text-emerald-400 animate-in zoom-in-75 duration-300 delay-200" />
                </div>

                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-emerald-400">Transaction Successful!</h3>
                  <p className="text-sm text-muted-foreground font-medium">
                    Your transaction has been processed successfully.
                  </p>
                </div>

                {/* Receipt Info */}
                <div id="active-receipt" className="w-full bg-[#0d0d0e] border border-white/10 rounded-2xl p-5 text-left space-y-3 font-medium text-sm relative">
                  <div className="absolute top-3 right-3 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">Swift Vendor</div>
                  <div className="flex justify-between items-center py-1 border-b border-white/5 pt-4">
                    <span className="text-muted-foreground text-xs">Amount</span>
                    <span className="font-black text-emerald-400 text-base">GHS {overlay.amount}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-white/5">
                    <span className="text-muted-foreground text-xs">Type</span>
                    <span className="font-bold text-white capitalize">{overlay.type === "cash-out" ? "Cash-Out (Collection)" : "Cash-In (Disbursement)"}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-white/5">
                    <span className="text-muted-foreground text-xs">{overlay.type === "bank" ? "Bank Account" : "Phone/Account"}</span>
                    <span className="font-bold text-white">{overlay.phoneOrAccount}</span>
                  </div>
                  {overlay.successDetails?.transactionId && (
                    <div className="flex justify-between items-center py-1">
                      <span className="text-muted-foreground text-xs">Transaction ID</span>
                      <span className="font-mono text-xs text-white/70 truncate max-w-[150px]">{overlay.successDetails.transactionId}</span>
                    </div>
                  )}
                </div>

                <div className="w-full flex flex-wrap gap-2 sm:gap-3">
                  <Button 
                    variant="outline"
                    className="flex-1 min-w-[100px] h-11 rounded-xl border border-white/10 hover:bg-white/5 font-bold text-xs sm:text-sm gap-1.5"
                    onClick={() => downloadReceiptImage("active-receipt", overlay.successDetails?.transactionId || "tx")}
                  >
                    <Download className="w-4 h-4" />
                    <span className="hidden sm:inline">Save</span> PNG
                  </Button>
                  <Button 
                    variant="outline"
                    className="flex-1 min-w-[100px] h-11 rounded-xl border border-[#25D366]/30 bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 font-bold text-xs sm:text-sm gap-1.5"
                    onClick={() => {
                      const text = `*Swift Vendor Receipt*%0A%0A*Amount:* GHS ${overlay.amount.toFixed(2)}%0A*Recipient:* ${overlay.phoneOrAccount}%0A*Network/Bank:* ${overlay.networkOrBank}%0A*Status:* SUCCESSFUL%0A*Transaction ID:* ${overlay.successDetails?.transactionId || 'N/A'}%0A*Date:* ${new Date().toLocaleString()}%0A%0A_Thank you for trading with us!_`;
                      const phoneParam = (overlay.type === "cash-out" || overlay.type === "cash-in") && overlay.phoneOrAccount.length >= 10 ? overlay.phoneOrAccount : "";
                      window.open(`https://wa.me/${phoneParam}?text=${text}`, "_blank");
                    }}
                  >
                    <Share2 className="w-4 h-4" />
                    WhatsApp
                  </Button>
                  <Button 
                    className="flex-1 min-w-[100px] h-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-black font-black text-xs sm:text-sm transition-all active:scale-[0.98]"
                    onClick={() => setOverlay(prev => ({ ...prev, isOpen: false }))}
                  >
                    Done
                  </Button>
                </div>
              </div>
            )}

            {/* STEP: FAILED */}
            {overlay.step === "failed" && (
              <div className="py-4 space-y-6 flex flex-col items-center w-full">
                <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center animate-in zoom-in-50 duration-500">
                  <AlertCircle className="w-12 h-12 text-red-500 animate-in zoom-in-75 duration-300 delay-200" />
                </div>

                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-red-500">Transaction Failed</h3>
                  <p className="text-sm text-muted-foreground font-medium max-w-[280px]">
                    {overlay.errorMsg || "An unexpected error occurred while processing the transaction."}
                  </p>
                </div>

                <div className="w-full flex gap-3">
                  <Button 
                    variant="outline" 
                    className="flex-1 h-12 rounded-xl border border-white/10 hover:bg-white/5 font-bold"
                    onClick={() => setOverlay(prev => ({ ...prev, isOpen: false }))}
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}
      {selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-300">
          <div className="relative w-full max-w-md bg-[#0e0e10]/95 border border-white/10 rounded-[32px] p-8 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col items-center text-center space-y-6 animate-in zoom-in-95 slide-in-from-bottom-10 duration-500">
            <div className="absolute -top-24 w-48 h-48 rounded-full blur-[80px] opacity-10 pointer-events-none bg-primary" />
            
            <div className="w-full flex items-center justify-between border-b border-white/5 pb-4">
              <span className="text-sm font-black uppercase tracking-wider text-muted-foreground">Transaction Receipt</span>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-white"
                onClick={() => setSelectedReceipt(null)}
              >
                <AlertCircle className="w-5 h-5 rotate-45" />
              </Button>
            </div>

            <div id="historical-receipt-card" className="w-full bg-[#0d0d0e] border border-white/10 rounded-2xl p-6 text-left space-y-4 relative">
              <div className="absolute top-4 right-4 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">Swift Vendor</div>
              
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Amount</p>
                <p className="text-3xl font-black text-emerald-400">GHS {Number(selectedReceipt.amount).toFixed(2)}</p>
              </div>

              <div className="divide-y divide-white/5 font-medium text-xs pt-2">
                <div className="flex justify-between items-center py-2.5">
                  <span className="text-muted-foreground">Status</span>
                  <Badge className={cn(
                    "border-none h-5 text-[9px] font-black px-2",
                    selectedReceipt.status === "fulfilled" ? "bg-emerald-400/10 text-emerald-400" :
                    selectedReceipt.status === "failed" ? "bg-red-400/10 text-red-400" : "bg-amber-400/10 text-amber-400"
                  )}>
                    {selectedReceipt.status.toUpperCase()}
                  </Badge>
                </div>
                <div className="flex justify-between items-center py-2.5">
                  <span className="text-muted-foreground">Type</span>
                  <span className="font-bold text-white capitalize">
                    {selectedReceipt.order_type === "vendor_cash_in" ? "Cash-In (Disbursement)" : 
                     selectedReceipt.order_type === "vendor_cash_out" ? "Cash-Out (Collection)" : "Bank Transfer"}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2.5">
                  <span className="text-muted-foreground">Recipient</span>
                  <span className="font-bold text-white">{selectedReceipt.customer_phone || "Bank Account"}</span>
                </div>
                <div className="flex justify-between items-center py-2.5">
                  <span className="text-muted-foreground">Date & Time</span>
                  <span className="font-bold text-white">{new Date(selectedReceipt.created_at).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center py-2.5">
                  <span className="text-muted-foreground">Transaction ID</span>
                  <span className="font-mono text-[10px] text-white/70 truncate max-w-[180px]">{selectedReceipt.id}</span>
                </div>
              </div>
            </div>

            <div className="w-full flex gap-3">
              <Button 
                variant="outline"
                className="flex-1 h-12 rounded-xl border border-white/10 hover:bg-white/5 font-bold text-sm gap-1.5"
                onClick={() => downloadReceiptImage("historical-receipt-card", selectedReceipt.id)}
              >
                <Download className="w-4 h-4" />
                Download PNG
              </Button>
              <Button 
                className="flex-1 h-12 rounded-xl bg-primary hover:bg-primary/95 text-black font-black text-sm transition-all active:scale-[0.98]"
                onClick={() => handleShareReceipt(selectedReceipt)}
              >
                Share Receipt
              </Button>
            </div>
          </div>
        </div>
      )}

      {bridgeFloatModal.isOpen && bridgeFloatModal.subAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-300">
          <div className="relative w-full max-w-md bg-[#0e0e10]/95 border border-primary/20 rounded-[32px] p-8 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col items-center text-center space-y-6">
            <div className="absolute -top-24 w-48 h-48 rounded-full blur-[80px] opacity-10 pointer-events-none bg-primary" />
            
            <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mb-2">
              <Zap className="w-10 h-10 text-primary" />
            </div>

            <div className="space-y-2">
              <h3 className="text-2xl font-black text-white">Bridge Float</h3>
              <p className="text-sm text-muted-foreground font-medium">
                Transfer float to <span className="font-bold text-primary">{bridgeFloatModal.subAgent.full_name}</span>
              </p>
            </div>

            <div className="w-full space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left block w-full ml-1">Amount (GHS)</Label>
              <Input 
                type="number" 
                placeholder="0.00" 
                className="h-14 rounded-2xl bg-muted/30 border-none font-black text-2xl text-primary text-center"
                value={bridgeAmount}
                onChange={(e) => setBridgeAmount(e.target.value)}
                autoFocus
              />
            </div>

            <div className="w-full flex gap-3 mt-4">
              <Button 
                variant="outline" 
                className="flex-1 h-14 rounded-2xl border border-white/10 hover:bg-white/5 font-bold"
                onClick={() => {
                  setBridgeFloatModal({isOpen: false, subAgent: null});
                  setBridgeAmount("");
                }}
              >
                Cancel
              </Button>
              <Button 
                className="flex-1 h-14 rounded-2xl bg-primary hover:bg-primary/90 text-black font-black transition-all active:scale-[0.98]"
                onClick={handleBridgeFloat}
                disabled={!bridgeAmount || Number(bridgeAmount) <= 0 || loadingSubAgents}
              >
                {loadingSubAgents ? <Loader2 className="w-6 h-6 animate-spin" /> : "Transfer Float"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <VendorSecurityApproval
        isOpen={securityApproval.isOpen}
        amount={securityApproval.amount}
        onApprove={securityApproval.onApprove}
        onCancel={() => setSecurityApproval(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Points Redemption Modal */}
      {showPointsModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-[#111116] border border-indigo-500/30 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500"></div>
            
            <button 
              onClick={() => setShowPointsModal(false)}
              className="absolute top-4 right-4 text-white/40 hover:text-white transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col gap-5 mt-2">
              <div className="text-center space-y-2">
                <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto shadow-[0_0_15px_rgba(99,102,241,0.2)]">
                  <Sparkles className="w-8 h-8 text-indigo-400" />
                </div>
                <h3 className="text-2xl font-black text-white mt-4">Swift Rewards</h3>
                <p className="text-sm text-white/50">Turn your loyalty points into wallet cash.</p>
              </div>

              <div className="bg-black/50 rounded-2xl p-4 border border-white/5 text-center">
                <p className="text-xs font-black uppercase tracking-widest text-indigo-400/70">Your Balance</p>
                <p className="text-3xl font-black text-indigo-400 mt-1">{swiftPoints.toLocaleString()} PTS</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Points to Redeem</Label>
                  <Input 
                    type="number"
                    min="100"
                    step="100"
                    value={redeemAmount}
                    onChange={(e) => setRedeemAmount(parseInt(e.target.value) || 0)}
                    className="bg-black/50 border-white/10 h-12 text-lg rounded-xl font-bold"
                  />
                  <p className="text-[10px] text-white/40 ml-1">Must be multiples of 100.</p>
                </div>
                
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex justify-between items-center">
                  <span className="text-sm font-bold text-emerald-500/70">Cash Value:</span>
                  <span className="text-xl font-black text-emerald-500">GHS {((redeemAmount / 100) * 1.00).toFixed(2)}</span>
                </div>
              </div>

              <Button
                onClick={handleRedeemPoints}
                disabled={redeeming || redeemAmount < 100 || redeemAmount > swiftPoints}
                className="w-full h-12 mt-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-black transition-all disabled:opacity-50"
              >
                {redeeming ? <Loader2 className="w-5 h-5 animate-spin" /> : "Redeem Cash"}
              </Button>
            </div>
          </div>
        </div>
      )}

    </SecurityGateway>
  );
};

export default DashboardSwiftVendor;
