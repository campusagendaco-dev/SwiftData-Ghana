import React, { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Zap, Droplets, Tv, Loader2, ShieldCheck,
  CreditCard, Wallet, ChevronRight, RotateCcw,
  CheckCircle2, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ECGLogo, NEDCOLogo, GhanaWaterLogo, DSTVLogo, GOTVLogo, StarTimesLogo } from "@/components/BrandLogos";

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
  const [amount, setAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PayMethod>("paystack");

  const [verifying, setVerifying] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const activeStyle = TABS.find((t) => t.id === activeTab)!;

  const reset = () => {
    setProvider("");
    setAccountNumber("");
    setAmount("");
    setAccountName(null);
    setVerifyError(null);
  };

  const handleTabChange = (id: UtilityType) => {
    setActiveTab(id);
    reset();
  };

  const handleVerify = async () => {
    if (!accountNumber.trim() || !provider) {
      toast({ title: "Select a provider and enter your account number", variant: "destructive" });
      return;
    }
    setVerifying(true);
    setAccountName(null);
    setVerifyError(null);
    // Mocked verification — replace with real lookup when API is ready
    setTimeout(() => {
      if (accountNumber.length < 5) {
        setVerifyError("Account not found. Please check the number.");
      } else {
        setAccountName("JOHN DOE ENT.");
      }
      setVerifying(false);
    }, 1400);
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
          utility_account_number: accountNumber,
          utility_account_name: accountName,
          amount: numAmount,
        },
      });
      if (error || data?.error) {
        toast({ title: "Payment failed", description: data?.error || "Insufficient balance or server error.", variant: "destructive" });
        setLoading(false);
        return;
      }
      toast({ title: "Payment Successful!", description: "Your bill has been paid from your wallet." });
      setLoading(false);
      reset();
      return;
    }

    const reference = crypto.randomUUID();
    const { data, error } = await supabase.functions.invoke("initialize-payment", {
      body: {
        email: user?.email || "customer@swiftdata.gh",
        amount: numAmount,
        reference,
        callback_url: `${window.location.origin}/dashboard/utilities?ref=${reference}`,
        metadata: {
          order_type: "utility",
          utility_type: activeTab,
          utility_provider: provider,
          utility_account_number: accountNumber,
          utility_account_name: accountName,
          agent_id: user?.id,
        },
      },
    });
    if (error || !data?.authorization_url) {
      toast({ title: "Payment initialization failed", description: error?.message || "Please try again.", variant: "destructive" });
      setLoading(false);
      return;
    }
    window.location.href = data.authorization_url;
  };

  const numAmount = Number(amount);
  const canVerify = !!provider && !!accountNumber.trim();
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

          {/* Step 2 — Account number + verify */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-3">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black mr-2">2</span>
              {FIELD_LABELS[activeTab]}
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={accountNumber}
                onChange={(e) => { setAccountNumber(e.target.value); setAccountName(null); setVerifyError(null); }}
                placeholder={FIELD_PLACEHOLDERS[activeTab]}
                className="flex-1 h-12 px-4 bg-secondary/60 border border-border rounded-2xl text-sm font-medium placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
              />
              <button
                onClick={handleVerify}
                disabled={verifying || !canVerify}
                className="h-12 px-5 rounded-2xl bg-secondary border border-border text-sm font-black text-foreground hover:bg-secondary/80 disabled:opacity-40 transition-all flex items-center gap-2 shrink-0"
              >
                {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
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
            disabled={loading || !canPay}
            className="w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground font-black text-base transition-all hover:scale-[1.01] active:scale-[0.99] shadow-xl shadow-primary/25 flex items-center justify-center gap-2"
          >
            {loading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Zap className="w-5 h-5" />}
            {loading ? "Processing..." : `Pay ${numAmount > 0 ? `₵${numAmount.toFixed(2)}` : "Bill"} Now`}
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
