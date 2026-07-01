import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Zap, Droplets, Tv, Loader2, ShieldCheck,
  CreditCard, Wallet, ChevronRight, RotateCcw,
  CheckCircle2, AlertCircle, Info, Plus, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ECGLogo, NEDCOLogo, GhanaWaterLogo, DSTVLogo, GOTVLogo, StarTimesLogo, KweseTVLogo, GBCTVLogo } from "@/components/BrandLogos";
import { useConnectivity } from "@/hooks/useConnectivity";
import { WifiOff } from "lucide-react";
import { PaystackMomoCheckout } from "@/components/PaystackMomoCheckout";


type UtilityType = "electricity" | "water" | "tv";
type PayMethod = "wallet" | "paystack";

const TABS = [
  {
    id: "electricity" as UtilityType,
    label: "Electricity",
    icon: Zap,
    accent: "text-amber-400",
    activeBg: "bg-amber-400/15",
    activeBorder: "border-amber-400/30",
    activeText: "text-amber-400",
    glow: "shadow-amber-400/15",
  },
  {
    id: "water" as UtilityType,
    label: "Water",
    icon: Droplets,
    accent: "text-sky-400",
    activeBg: "bg-sky-400/15",
    activeBorder: "border-sky-400/30",
    activeText: "text-sky-400",
    glow: "shadow-sky-400/15",
  },
  {
    id: "tv" as UtilityType,
    label: "TV",
    icon: Tv,
    accent: "text-purple-400",
    activeBg: "bg-purple-400/15",
    activeBorder: "border-purple-400/30",
    activeText: "text-purple-400",
    glow: "shadow-purple-400/15",
  },
];

type ProviderEntry = { name: string; Logo: React.FC<{ size?: number }> };

const PROVIDERS: Record<UtilityType, ProviderEntry[]> = {
  electricity: [
    { name: "ECG Prepaid",  Logo: ECGLogo },
    { name: "ECG Postpaid", Logo: ECGLogo },
    { name: "NEDCO",        Logo: NEDCOLogo },
  ],
  water: [
    { name: "Ghana Water Company", Logo: GhanaWaterLogo },
  ],
  tv: [
    { name: "DSTV",      Logo: DSTVLogo },
    { name: "GOtv",      Logo: GOTVLogo },
    { name: "StarTimes", Logo: StarTimesLogo },
    { name: "KWESETV",   Logo: KweseTVLogo },
    { name: "GBCTV",     Logo: GBCTVLogo },
  ],
};

const QUICK_AMOUNTS = [20, 50, 100, 200, 500];

const FIELD_LABELS: Record<UtilityType, string> = {
  electricity: "Meter Number",
  water: "Customer Number",
  tv: "Smartcard / IUC Number",
};

const FIELD_PLACEHOLDERS: Record<UtilityType, string> = {
  electricity: "e.g. 04123456789",
  water: "e.g. WC-0012345",
  tv: "e.g. 1234567890",
};

const DashboardUtilities = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<UtilityType>("electricity");
  const [provider, setProvider] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PayMethod>("paystack");

  const [verifying, setVerifying] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [lookupTxId, setLookupTxId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [meters, setMeters] = useState<any[] | null>(null);
  const [selectedMeter, setSelectedMeter] = useState<any | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  
  const navigate = useNavigate();
  const { isOnline } = useConnectivity();
  
  const [savedMeters, setSavedMeters] = useState<any[]>([]);
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [regAlias, setRegAlias] = useState("");
  const [regMeterNumber, setRegMeterNumber] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regCategory, setRegCategory] = useState("PREPAID");
  const [regAccountNumber, setRegAccountNumber] = useState("");
  const [registering, setRegistering] = useState(false);

  // Load saved meters from local storage
  React.useEffect(() => {
    const stored = localStorage.getItem("swift_saved_meters");
    if (stored) {
      try {
        setSavedMeters(JSON.parse(stored));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  const saveMeter = (meterNum: string, name: string, prov: string, type: string) => {
    if (!meterNum) return;
    const newItem = { meterNumber: meterNum, name, provider: prov, type, id: crypto.randomUUID() };
    const filtered = savedMeters.filter(m => m.meterNumber !== meterNum);
    const updated = [newItem, ...filtered].slice(0, 10);
    setSavedMeters(updated);
    localStorage.setItem("swift_saved_meters", JSON.stringify(updated));
  };

  const removeSavedMeter = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedMeters.filter(m => m.id !== id);
    setSavedMeters(updated);
    localStorage.setItem("swift_saved_meters", JSON.stringify(updated));
  };


  const activeStyle = TABS.find((t) => t.id === activeTab)!;

  const reset = () => {
    setProvider("");
    setAccountNumber("");
    setPhoneNumber("");
    setAmount("");
    setAccountName(null);
    setVerifyError(null);
    setLookupTxId(null);
    setMeters(null);
    setSelectedMeter(null);
  };

  const handleTabChange = (id: UtilityType) => {
    setActiveTab(id);
    reset();
  };

  const handleVerify = async () => {
    if ((!accountNumber.trim() && !phoneNumber.trim()) || !provider) {
      toast({ title: "Select a provider and enter your account or phone number", variant: "destructive" });
      return;
    }
    setVerifying(true);
    setAccountName(null);
    setVerifyError(null);
    
    try {
      const { data, error } = await supabase.functions.invoke("utility-lookup", {
        body: {
          utility_type: activeTab,
          provider: provider,
          account_number: accountNumber.trim(),
          phone_number: phoneNumber.trim() || undefined,
        },
      });

      if (error || !data?.success) {
        setVerifyError(data?.error || error?.message || "Account verification failed.");
      } else if (data.customer_name || data.accountName || (data.meters && data.meters.length > 0)) {
        const resolvedName = data.customer_name || data.accountName || (data.meters?.[0]?.customerName || data.meters?.[0]?.alias);
        setAccountName(resolvedName);
        const txId = data.raw?.data?.transaction_id || data.raw?.transaction_id || data.raw?.transactionId;
        if (txId) {
          setLookupTxId(txId);
        }
        
        if (data.meters && Array.isArray(data.meters) && data.meters.length > 0) {
          setMeters(data.meters);
          setSelectedMeter(data.meters[0]);
          const mName = data.meters[0].customerName || data.meters[0].alias || resolvedName;
          setAccountName(mName);
          saveMeter(data.meters[0].meterNumber, mName, provider, activeTab);
        } else {
          setMeters(null);
          setSelectedMeter(null);
          saveMeter(accountNumber.trim() || phoneNumber.trim(), resolvedName, provider, activeTab);
        }
        
        toast({ title: "Account Verified" });
      } else {
        setVerifyError("Could not verify account name.");
      }
    } catch (err: any) {
      setVerifyError("Network error. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const handleRegisterMeter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regAlias || !regMeterNumber || !regPhone) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    setRegistering(true);
    try {
      const { data, error } = await supabase.functions.invoke("utility-lookup", {
        body: {
          action: "add_meter",
          utility_type: "electricity",
          provider: "ECG Prepaid",
          alias: regAlias.trim(),
          meter_number: regMeterNumber.trim(),
          phone_number: regPhone.trim(),
          meter_category: regCategory,
          account_number: regAccountNumber.trim() || undefined
        }
      });

      if (error || !data?.success) {
        toast({ title: "Registration failed", description: data?.error || "Could not register meter.", variant: "destructive" });
      } else {
        toast({ title: "Meter Registered Successfully!", description: `Meter ${regMeterNumber} is now registered.` });
        setShowRegisterDialog(false);
        setRegAlias("");
        setRegMeterNumber("");
        setRegPhone("");
        setRegAccountNumber("");
        
        // Auto fill and trigger verification lookup for the new registered phone number
        setAccountNumber(regPhone.trim());
        setTimeout(() => {
          handleVerify();
        }, 100);
      }
    } catch (err: any) {
      toast({ title: "Network error", description: "Please try again later.", variant: "destructive" });
    } finally {
      setRegistering(false);
    }
  };

  const handlePay = async () => {
    if (!accountName || !amount || !provider) {
      toast({ title: "Please verify account and enter amount", variant: "destructive" });
      return;
    }



    setLoading(true);
    const numAmount = Number(amount);

    if (payMethod === "wallet") {
      const { data, error } = await supabase.functions.invoke("wallet-pay-utility", {
        body: {
          utility_type: activeTab,
          utility_provider: provider,
          utility_account_number: selectedMeter ? selectedMeter.meterNumber : accountNumber.trim(),
          utility_account_name: selectedMeter ? (selectedMeter.customerName || selectedMeter.alias) : accountName,
          amount: numAmount,
          lookup_transaction_id: lookupTxId,
          metadata: selectedMeter ? {
            meter_id: selectedMeter.id,
            meter_number: selectedMeter.meterNumber,
            meter_category: selectedMeter.meterCategory,
            account_number: selectedMeter.accountNumber
          } : undefined
        },
      });
      if (error || data?.error) {
        toast({ title: "Payment failed", description: data?.error || "Insufficient balance or server error.", variant: "destructive" });
        setLoading(false);
        return;
      }
      toast({ title: "Payment Successful!", description: "Your bill payment order has been initiated." });
      setLoading(false);
      if (data.order_id) {
        navigate(`/order-status?reference=${data.order_id}`);
      }
      reset();
      return;
    }

    setCheckoutOpen(true);
  };

  const numAmount = Number(amount);
  const canVerify = !!provider && (!!accountNumber.trim() || !!phoneNumber.trim());
  const canPay = !!accountName && numAmount > 0;

  return (
    <div className="p-4 md:p-8 max-w-5xl space-y-8 animate-in fade-in duration-500">

      {/* ── Page header ── */}
      <div>
        <h1 className="font-black text-3xl tracking-tight text-foreground mb-1">Pay Bills</h1>
        <p className="text-muted-foreground text-sm">Pay electricity, water, and TV subscriptions instantly.</p>
      </div>

      {/* ── Category tabs ── */}
      <div className="flex gap-2">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-bold border transition-all",
                active
                  ? cn(tab.activeBg, tab.activeBorder, tab.activeText, "shadow-lg", tab.glow)
                  : "bg-card/50 border-border text-muted-foreground hover:text-foreground hover:border-border/80",
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">

        {/* ── Main form card ── */}
        <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 md:p-8 space-y-7">

          {/* Step 1 — Provider */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-3">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black mr-2">1</span>
              Select Provider
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {PROVIDERS[activeTab].map((p) => (
                <button
                  key={p.name}
                  onClick={() => { setProvider(p.name); setAccountName(null); setVerifyError(null); }}
                  className={cn(
                    "relative flex items-center gap-3 px-4 py-3.5 rounded-2xl border text-left text-sm font-bold transition-all",
                    provider === p.name
                      ? cn("border-primary/50 bg-primary/10 text-foreground shadow-md shadow-primary/10")
                      : "border-border bg-card/40 text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-card",
                  )}
                >
                  <p.Logo size={32} />
                  <span className="leading-tight">{p.name}</span>
                  {provider === p.name && (
                    <CheckCircle2 className="w-4 h-4 text-primary absolute top-2.5 right-2.5" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Saved Meters */}
          {savedMeters && savedMeters.length > 0 && (
            <div className="space-y-2 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Saved & Recent Meters</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-thin">
                {savedMeters.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => {
                      setProvider(m.provider);
                      setActiveTab(m.type);
                      setAccountNumber(m.meterNumber);
                      setAccountName(m.name);
                      setMeters(null);
                      setSelectedMeter(null);
                      toast({ title: "Loaded Meter Details", description: `${m.name} (${m.meterNumber})` });
                    }}
                    className={cn(
                      "flex items-center gap-2.5 shrink-0 px-3.5 py-2.5 rounded-xl border text-left cursor-pointer transition-all",
                      accountNumber === m.meterNumber
                        ? "bg-primary/8 border-primary/45 text-foreground shadow-sm shadow-primary/5"
                        : "bg-card/45 border-border hover:bg-card/85 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] font-black uppercase tracking-wider text-foreground/80 truncate max-w-[120px]">{m.name}</span>
                      <span className="text-[9px] font-mono opacity-50">{m.meterNumber}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => removeSavedMeter(m.id, e)}
                      className="p-1 hover:bg-foreground/10 rounded text-muted-foreground/65 hover:text-foreground transition-all ml-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 2 — Account number + verify */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-3">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black mr-2">2</span>
              {activeTab === "electricity" && provider === "ECG Prepaid" ? "PowerApp Phone / Account Number" : FIELD_LABELS[activeTab]}
            </p>
            {activeTab === "electricity" && provider === "ECG Prepaid" && (
              <div className="mb-4 flex items-start justify-between p-4 rounded-2xl bg-amber-500/8 border border-amber-500/20 text-amber-500 text-xs leading-relaxed animate-in slide-in-from-top-2 duration-200">
                <div className="flex gap-3">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold mb-0.5">ECG Prepaid Verification Info</p>
                    <p className="text-muted-foreground">
                      For prepaid lookup, enter the **phone number** registered on your ECG PowerApp account.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRegisterDialog(true)}
                  className="shrink-0 h-8 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-black font-black text-[10px] uppercase tracking-wider transition-colors ml-3 mt-1"
                >
                  Register
                </button>
              </div>
            )}
            {provider.includes("ECG") && provider !== "ECG Prepaid" && (
              <div className="mb-2">
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => { setPhoneNumber(e.target.value); setAccountName(null); setVerifyError(null); }}
                  placeholder="Phone Number (Optional, e.g., 233XXXXXXXXX)"
                  className="w-full h-12 px-4 bg-secondary/60 border border-border rounded-2xl text-sm font-medium placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={accountNumber}
                onChange={(e) => { setAccountNumber(e.target.value); setAccountName(null); setVerifyError(null); }}
                placeholder={
                  activeTab === "electricity"
                    ? provider === "ECG Prepaid"
                      ? "Enter Phone Number linked to ECG PowerApp (e.g. 024XXXXXXX)"
                      : "Enter Postpaid Meter Number (no letters, e.g. 181198568)"
                    : FIELD_PLACEHOLDERS[activeTab]
                }
                className="flex-1 h-12 px-4 bg-secondary/60 border border-border rounded-2xl text-sm font-medium placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
              />
              <button
                onClick={handleVerify}
                disabled={verifying || !canVerify || !isOnline}
                className="h-12 px-5 rounded-2xl bg-secondary border border-border text-sm font-black text-foreground hover:bg-secondary/80 disabled:opacity-40 transition-all flex items-center gap-2 shrink-0"
              >
                {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : !isOnline ? <WifiOff className="w-4 h-4" /> : "Verify"}
              </button>

            </div>

            {/* Verification result */}
            {accountName && (
              <div className="mt-3 flex items-center justify-between p-4 rounded-2xl bg-emerald-500/8 border border-emerald-500/20 animate-in zoom-in-95 duration-200">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500/60 mb-0.5">Verified Account</p>
                  <p className="text-foreground font-black text-sm">{accountName}</p>
                </div>
                <ShieldCheck className="w-6 h-6 text-emerald-500 shrink-0" />
              </div>
            )}

            {meters && meters.length > 0 && (
              <div className="mt-4 space-y-2.5 animate-in slide-in-from-top-3 duration-300">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Select Your Meter</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {meters.map((m) => {
                    const isSelected = selectedMeter?.id === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setSelectedMeter(m);
                          setAccountName(m.customerName || m.alias);
                        }}
                        className={cn(
                          "flex flex-col text-left p-4 rounded-2xl border transition-all relative overflow-hidden",
                          isSelected
                            ? "bg-primary/10 border-primary/40 shadow-lg shadow-primary/5"
                            : "bg-card/45 border-border hover:border-border/80 hover:bg-card/80"
                        )}
                      >
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground animate-in zoom-in-50 duration-200">
                            ✓
                          </div>
                        )}
                        <span className="text-[10px] font-black uppercase tracking-wide opacity-50">{m.meterCategory || "Meter"}</span>
                        <span className="text-sm font-bold text-foreground truncate max-w-[200px] mt-0.5">{m.customerName || m.alias}</span>
                        <span className="text-xs font-mono text-muted-foreground mt-1">{m.meterNumber}</span>
                        {m.balance !== null && m.balance !== undefined && (
                          <span className="text-[10px] font-black text-amber-500 mt-1">Balance: ₵{m.balance}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {verifyError && (
              <div className="mt-3 flex items-center gap-3 p-4 rounded-2xl bg-destructive/8 border border-destructive/20 animate-in zoom-in-95 duration-200">
                <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
                <p className="text-sm text-destructive font-medium">{verifyError}</p>
              </div>
            )}
          </div>

          {/* Step 3 — Amount */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-3">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black mr-2">3</span>
              Amount (GHS)
            </p>
            {/* Quick amounts */}
            <div className="flex flex-wrap gap-2 mb-3">
              {QUICK_AMOUNTS.map((q) => (
                <button
                  key={q}
                  onClick={() => setAmount(String(q))}
                  className={cn(
                    "px-4 py-1.5 rounded-xl text-xs font-black border transition-all",
                    amount === String(q)
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-card/50 border-border text-muted-foreground hover:text-foreground hover:border-border/80",
                  )}
                >
                  ₵{q}
                </button>
              ))}
            </div>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-black text-sm">₵</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min={1}
                className="w-full h-14 pl-8 pr-4 bg-secondary/60 border border-border rounded-2xl text-xl font-black placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
          </div>

          {/* Step 4 — Payment method */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-3">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black mr-2">4</span>
              Payment Method
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(["wallet", "paystack"] as PayMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setPayMethod(m)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 h-20 rounded-2xl border font-bold text-sm transition-all",
                    payMethod === m
                      ? "bg-primary/12 border-primary/40 text-foreground shadow-md shadow-primary/10"
                      : "bg-card/50 border-border text-muted-foreground hover:text-foreground hover:bg-card",
                  )}
                >
                  {m === "wallet"
                    ? <Wallet className="w-5 h-5 text-primary" />
                    : <CreditCard className="w-5 h-5 text-primary" />}
                  <span>{m === "wallet" ? "Wallet" : "Card / MoMo"}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Pay button */}
          <button
            onClick={handlePay}
            disabled={loading || !canPay || !isOnline}
            className="w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground font-black text-base transition-all hover:scale-[1.01] active:scale-[0.99] shadow-xl shadow-primary/25 flex items-center justify-center gap-2"
          >
            {loading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : !isOnline ? <WifiOff className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
            {loading ? "Processing..." : !isOnline ? "Waiting for Internet..." : `Pay ${numAmount > 0 ? `₵${numAmount.toFixed(2)}` : "Bill"} Now`}
          </button>

        </div>

        {/* ── Right panel ── */}
        <div className="space-y-5">

          {/* Summary */}
          <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 space-y-4">
            <h3 className="font-black text-foreground text-base">Order Summary</h3>

            {/* Provider logo hero */}
            {provider && (() => {
              const entry = PROVIDERS[activeTab].find((p) => p.name === provider);
              return entry ? (
                <div className="flex items-center gap-3 p-3 rounded-2xl bg-secondary/40 border border-border">
                  <entry.Logo size={36} />
                  <div>
                    <p className="text-xs text-muted-foreground">Selected Provider</p>
                    <p className="font-black text-foreground text-sm">{provider}</p>
                  </div>
                </div>
              ) : null;
            })()}

            <div className="space-y-3 text-sm">
              <SummaryRow label="Utility" value={activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} />
              <SummaryRow label="Provider" value={provider || "—"} />
              <SummaryRow
                label="Account"
                value={accountName || (accountNumber ? `${accountNumber.slice(0, 6)}****` : "—")}
                valueClass={accountName ? "text-emerald-400 font-black" : undefined}
              />
              <SummaryRow label="Payment" value={payMethod === "wallet" ? "Wallet" : "Card / MoMo"} />

              <div className="pt-3 border-t border-border flex items-center justify-between">
                <span className="text-muted-foreground font-medium">Total</span>
                <span className="font-black text-foreground text-xl">
                  {numAmount > 0 ? `₵${numAmount.toFixed(2)}` : "—"}
                </span>
              </div>
            </div>

            {canVerify && !accountName && (
              <button
                onClick={handleVerify}
                disabled={verifying}
                className="w-full h-10 rounded-xl bg-secondary border border-border text-sm font-black text-foreground hover:bg-secondary/80 flex items-center justify-center gap-2 transition-all"
              >
                {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Verify Account
              </button>
            )}
          </div>

          {/* Why SwiftData */}
          <div
            className="relative overflow-hidden rounded-3xl p-6 space-y-4"
            style={{ background: "linear-gradient(135deg, rgba(251,191,36,0.1) 0%, rgba(245,158,11,0.05) 100%)", border: "1px solid rgba(251,191,36,0.18)" }}
          >
            <div className="absolute -top-8 -right-8 w-32 h-32 bg-amber-400/8 rounded-full blur-2xl pointer-events-none" />
            <h4 className="font-black text-foreground text-sm relative z-10">Why pay with SwiftData?</h4>
            <ul className="space-y-3 relative z-10">
              {[
                { icon: Zap, text: "Instant tokens delivered via SMS" },
                { icon: ShieldCheck, text: "Official receipt every time" },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <Icon className="w-4 h-4 text-amber-400 shrink-0" />
                  {text}
                </li>
              ))}
            </ul>
          </div>

          {/* Reset */}
          <button
            onClick={reset}
            className="w-full flex items-center justify-center gap-2 text-muted-foreground text-xs font-bold hover:text-foreground transition-colors py-2"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear Form
          </button>
        </div>
      </div>

      <PaystackMomoCheckout
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        amount={numAmount}
        email={user?.email || "customer@swiftdata.gh"}
        recipientPhone={selectedMeter ? selectedMeter.meterNumber : accountNumber.trim()}
        recipientNetwork={""}
        metadata={{
          order_type: "utility",
          utility_type: activeTab,
          utility_provider: provider,
          utility_account_number: selectedMeter ? selectedMeter.meterNumber : accountNumber.trim(),
          utility_account_name: selectedMeter ? (selectedMeter.customerName || selectedMeter.alias) : accountName,
          agent_id: user?.id,
          lookup_transaction_id: lookupTxId,
          meter_id: selectedMeter?.id,
          meter_number: selectedMeter?.meterNumber,
          meter_category: selectedMeter?.meterCategory,
          account_number: selectedMeter?.accountNumber
        }}
        onSuccess={(reference) => {
          setCheckoutOpen(false);
          navigate(`/order-status?reference=${reference}`);
          reset();
        }}
        onFailure={(error) => {
          console.error("Payment failed:", error);
        }}
      />

      {/* Add Meter Dialog */}
      {showRegisterDialog && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowRegisterDialog(false)} />
          <div className="relative max-w-md w-full bg-card border border-border rounded-3xl p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-black text-foreground text-sm uppercase tracking-wider">Register ECG Meter</h3>
              <button onClick={() => setShowRegisterDialog(false)} className="p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <form onSubmit={handleRegisterMeter} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Meter Alias / Name</label>
                <input
                  type="text" required
                  placeholder="e.g. Home Meter or John Doe"
                  value={regAlias} onChange={(e) => setRegAlias(e.target.value)}
                  className="w-full h-11 px-4 bg-secondary/50 border border-border rounded-xl text-sm font-medium focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Physical Meter Number</label>
                  <input
                    type="text" required
                    placeholder="e.g. P191177631"
                    value={regMeterNumber} onChange={(e) => setRegMeterNumber(e.target.value)}
                    className="w-full h-11 px-4 bg-secondary/50 border border-border rounded-xl text-sm font-medium focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">ECG Phone Number</label>
                  <input
                    type="tel" required
                    placeholder="e.g. 024XXXXXXX"
                    value={regPhone} onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full h-11 px-4 bg-secondary/50 border border-border rounded-xl text-sm font-medium focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Meter Category</label>
                  <select
                    value={regCategory} onChange={(e) => setRegCategory(e.target.value)}
                    className="w-full h-11 px-3 bg-secondary/50 border border-border rounded-xl text-sm font-black focus:outline-none focus:border-primary/50 transition-colors"
                  >
                    <option value="PREPAID">PREPAID</option>
                    <option value="POSTPAID">POSTPAID</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">ECG Account Number (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. 700252531"
                    value={regAccountNumber} onChange={(e) => setRegAccountNumber(e.target.value)}
                    className="w-full h-11 px-4 bg-secondary/50 border border-border rounded-xl text-sm font-medium focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={registering}
                className="w-full h-11 mt-2 bg-amber-500 hover:bg-amber-600 text-black font-black text-xs uppercase tracking-wider rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/10"
              >
                {registering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Register Meter
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const SummaryRow = ({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-muted-foreground">{label}</span>
    <span className={cn("font-bold text-foreground text-right truncate max-w-[150px]", valueClass)}>{value}</span>
  </div>
);

export default DashboardUtilities;
