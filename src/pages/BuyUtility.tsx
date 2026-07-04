import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Zap, Droplets, Tv, Loader2, ShieldCheck,
  CreditCard, Wallet, ChevronRight, RotateCcw,
  CheckCircle2, AlertCircle, Info, X, Phone, User
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ECGLogo, NEDCOLogo, GhanaWaterLogo, DSTVLogo, GOTVLogo, StarTimesLogo, KweseTVLogo, GBCTVLogo } from "@/components/BrandLogos";
import { useConnectivity } from "@/hooks/useConnectivity";
import { WifiOff } from "lucide-react";
import { PaystackMomoCheckout } from "@/components/PaystackMomoCheckout";
import { motion, AnimatePresence } from "framer-motion";
import SEO from "@/components/SEO";

type UtilityType = "electricity" | "water" | "tv";

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

const BuyUtility = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isOnline } = useConnectivity();

  const [activeTab, setActiveTab] = useState<UtilityType>("electricity");
  const [provider, setProvider] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");

  const [verifying, setVerifying] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [lookupTxId, setLookupTxId] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const [meters, setMeters] = useState<any[]>([]);
  const [selectedMeterId, setSelectedMeterId] = useState<string | null>(null);
  const [selectedMeterNumber, setSelectedMeterNumber] = useState<string | null>(null);

  const reset = () => {
    setProvider("");
    setAccountNumber("");
    setPhoneNumber("");
    setAmount("");
    setAccountName(null);
    setVerifyError(null);
    setLookupTxId(null);
    setMeters([]);
    setSelectedMeterId(null);
    setSelectedMeterNumber(null);
  };

  const handleTabChange = (id: UtilityType) => {
    setActiveTab(id);
    reset();
  };

  const handleVerify = async () => {
    const targetAccount = accountNumber.trim();
    const targetPhone = phoneNumber.trim();

    if ((!targetAccount && !targetPhone) || !provider) {
      toast({ title: "Verification details missing", description: "Select a provider and enter account details", variant: "destructive" });
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
          account_number: targetAccount,
          phone_number: targetPhone || undefined,
        },
      });

      if (error || !data?.success) {
        setVerifyError(data?.error || error?.message || "Account verification failed.");
      } else if (data.customer_name || data.accountName || (data.meters && data.meters.length > 0)) {
        const returnedMeters = data.meters || [];
        setMeters(returnedMeters);
        
        if (returnedMeters.length > 0) {
          const firstMeter = returnedMeters[0];
          const resolvedName = firstMeter.customerName || firstMeter.alias || data.customer_name || data.accountName;
          setAccountName(resolvedName);
          setSelectedMeterId(firstMeter.id || firstMeter.meterId || null);
          setSelectedMeterNumber(firstMeter.meterNumber || null);
          
          if (firstMeter.meterNumber && !accountNumber) {
            setAccountNumber(firstMeter.meterNumber);
          }
        } else {
          const resolvedName = data.customer_name || data.accountName;
          setAccountName(resolvedName);
          setSelectedMeterId(null);
          setSelectedMeterNumber(null);
        }

        const txId = data.raw?.data?.transaction_id || data.raw?.transaction_id || data.raw?.transactionId;
        if (txId) {
          setLookupTxId(txId);
        }
        
        const descName = data.customer_name || data.accountName || (returnedMeters[0]?.customerName || returnedMeters[0]?.alias);
        toast({ title: "Account Verified Successfully", description: `Owner: ${descName}` });
      } else {
        setVerifyError("Could not verify account name.");
      }
    } catch (err: any) {
      setVerifyError("Network or server error. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const handlePayClick = () => {
    if (!accountName || !amount || !provider) {
      toast({ title: "Fulfill all fields", description: "Please verify the account and enter a payment amount", variant: "destructive" });
      return;
    }
    setCheckoutOpen(true);
  };

  const numAmount = Number(amount);
  const canVerify = !!provider && (!!accountNumber.trim() || !!phoneNumber.trim());
  const canPay = !!accountName && numAmount >= 5;
  const fee = canPay ? parseFloat((numAmount * 0.03).toFixed(2)) : 0;
  const total = canPay ? parseFloat((numAmount + fee).toFixed(2)) : 0;
  const activeStyle = TABS.find((t) => t.id === activeTab)!;

  return (
    <div className="min-h-screen pt-24 pb-16 px-4 bg-gray-50 dark:bg-[#030305] text-gray-900 dark:text-white">
      <SEO 
        title="Pay ECG Utility & Water Bills | SwiftData Ghana — No Account Required"
        description="Instantly pay your ECG Prepaid, Postpaid, Ghana Water Company, and TV subscription bills (DSTV, GOtv, StarTimes) securely with Mobile Money or Credit Card."
        keywords="ECG Prepaid, ECG Postpaid, Ghana Water bills online, Pay DSTV Ghana, pay bills without signin"
      />

      <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
        
        {/* ── Page Header ── */}
        <div className="text-center space-y-2">
          <h1 className="font-black text-3xl sm:text-5xl tracking-tight text-foreground">
            Pay Bills & Utilities
          </h1>
          <p className="text-muted-foreground text-sm max-w-lg mx-auto">
            Top up your ECG prepaid meter, settle Ghana water, or renew TV subscriptions instantly without creating an account.
          </p>
        </div>

        {/* ── Tabs ── */}
        <div className="flex justify-center gap-2 max-w-md mx-auto">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs sm:text-sm font-bold border transition-all active:scale-95",
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

        {!isOnline && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl text-sm font-bold animate-pulse">
            <WifiOff className="w-5 h-5 shrink-0" />
            <span>Connection offline. You need internet connectivity to complete utility payment.</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6">
          
          {/* ── Main Form ── */}
          <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 md:p-8 space-y-6">
            
            {/* Step 1: Provider selection */}
            <div className="space-y-2.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                1. Select Provider
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {PROVIDERS[activeTab].map((p) => {
                  const active = provider === p.name;
                  const Logo = p.Logo;
                  return (
                    <button
                      key={p.name}
                      onClick={() => {
                        setProvider(p.name);
                        setAccountName(null);
                        setVerifyError(null);
                      }}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border text-center transition-all",
                        active
                          ? "bg-amber-400/10 border-amber-400/40 text-foreground shadow-md shadow-amber-400/5 scale-[1.02]"
                          : "bg-background/40 border-border/80 text-muted-foreground hover:bg-background/80 hover:text-foreground"
                      )}
                    >
                      <Logo size={32} />
                      <span className="text-[10px] font-bold tracking-tight">{p.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Account/Meter Inputs */}
            {provider && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4 pt-2 border-t border-border/60"
              >
                {activeTab === "electricity" && provider === "ECG Prepaid" && (
                  <div className="flex items-start justify-between p-4 rounded-2xl bg-amber-500/8 border border-amber-500/20 text-amber-500 text-xs leading-relaxed animate-in slide-in-from-top-2 duration-200">
                    <div className="flex gap-3">
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold mb-0.5">ECG Prepaid Verification Info</p>
                        <p className="text-muted-foreground/80">
                          For ECG Prepaid lookup, please enter the **phone number** registered on your ECG PowerApp mobile account. Entering a physical card or meter number will result in verification failure.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Meter / Smartcard number input */}
                  {provider !== "NEDCO" && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                        2. {activeTab === "electricity" && provider === "ECG Prepaid" ? "PowerApp Phone / Account Number" : FIELD_LABELS[activeTab]}
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder={activeTab === "electricity" && provider === "ECG Prepaid" ? "e.g. 0244123456" : FIELD_PLACEHOLDERS[activeTab]}
                          value={accountNumber}
                          onChange={(e) => {
                            setAccountNumber(e.target.value);
                            setAccountName(null);
                            setVerifyError(null);
                          }}
                          className="w-full h-12 pl-4 pr-10 bg-background/50 border border-border rounded-xl text-sm font-semibold focus:outline-none focus:border-amber-400/50 transition-colors"
                        />
                      </div>
                    </div>
                  )}

                  {/* Phone input for NEDCO or fallback */}
                  {(activeTab === "electricity" || activeTab === "water") && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                        {provider === "NEDCO" ? "2. Phone Number" : "Recipient Phone Number"}
                      </label>
                      <div className="relative">
                        <input
                          type="tel"
                          placeholder="e.g. 0244123456"
                          value={phoneNumber}
                          onChange={(e) => {
                            setPhoneNumber(e.target.value.replace(/\D/g, ""));
                            setAccountName(null);
                            setVerifyError(null);
                          }}
                          className="w-full h-12 pl-4 pr-10 bg-background/50 border border-border rounded-xl text-sm font-semibold focus:outline-none focus:border-amber-400/50 transition-colors"
                        />
                        <Phone className="absolute right-3.5 top-3.5 w-4 h-4 text-muted-foreground/60" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Verification Trigger */}
                <div className="flex items-center justify-between pt-2">
                  <div className="space-y-0.5 max-w-[70%]">
                    <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                      3. Owner Verification
                    </p>
                    <p className="text-[9px] text-muted-foreground/80 leading-normal">
                      We must query the gateway to verify the name to prevent wrong payments.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!canVerify || verifying}
                    onClick={handleVerify}
                    className={cn(
                      "h-11 px-6 rounded-xl font-black text-xs uppercase tracking-wider transition-all active:scale-95 flex items-center justify-center gap-1.5",
                      canVerify
                        ? "bg-amber-400 hover:bg-amber-500 text-black shadow-md shadow-amber-400/10"
                        : "bg-muted text-muted-foreground cursor-not-allowed border border-border"
                    )}
                  >
                    {verifying ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      "Verify Name"
                    )}
                  </button>
                </div>

                {/* Account Name Display / Error feedback */}
                <AnimatePresence mode="wait">
                  {accountName && (
                    <div className="space-y-3">
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-2xl flex items-start gap-3"
                      >
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        <div className="space-y-0.5">
                          <span className="text-[10px] font-black uppercase tracking-wider block opacity-70">
                            Verified Name
                          </span>
                          <span className="text-sm font-black uppercase tracking-wide">
                            {accountName}
                          </span>
                        </div>
                      </motion.div>

                      {meters && meters.length > 1 && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-2"
                        >
                          <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block">
                            Multiple Meters Found — Select Meter to Pay:
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {meters.map((m: any) => {
                              const isSelected = selectedMeterId === (m.id || m.meterId);
                              return (
                                <button
                                  key={m.id || m.meterNumber}
                                  type="button"
                                  onClick={() => {
                                    setSelectedMeterId(m.id || m.meterId || null);
                                    setSelectedMeterNumber(m.meterNumber || null);
                                    setAccountName(m.customerName || m.alias || accountName);
                                    if (m.meterNumber) setAccountNumber(m.meterNumber);
                                  }}
                                  className={cn(
                                    "flex flex-col p-3.5 rounded-xl border text-left transition-all active:scale-[0.98]",
                                    isSelected
                                      ? "bg-amber-400/10 border-amber-400 text-foreground shadow-sm shadow-amber-400/5"
                                      : "bg-background/40 border-border/80 text-muted-foreground hover:bg-background/80 hover:text-foreground"
                                  )}
                                >
                                  <div className="flex items-center justify-between w-full">
                                    <span className="text-xs font-bold text-foreground">
                                      {m.alias || "Meter"}
                                    </span>
                                    {isSelected && (
                                      <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                                    )}
                                  </div>
                                  <span className="text-[10px] font-mono mt-1">
                                    No: {m.meterNumber}
                                  </span>
                                  <span className="text-[9px] mt-0.5 truncate opacity-80">
                                    Owner: {m.customerName}
                                  </span>
                                  {m.district && (
                                    <span className="text-[8px] opacity-60 mt-0.5">
                                      Loc: {m.district} ({m.region})
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </div>
                  )}

                  {verifyError && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl flex items-start gap-3"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-black uppercase tracking-wider block opacity-70">
                          Verification Error
                        </span>
                        <span className="text-xs font-semibold">
                          {verifyError}
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* Step 3: Amount selection */}
            {accountName && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3 pt-4 border-t border-border/60"
              >
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                    4. Enter Amount (GHS)
                  </label>
                  <span className="text-[9px] text-muted-foreground font-black">
                    Min GHS 5.00
                  </span>
                </div>
                
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Enter GHS amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full h-12 px-4 bg-background/50 border border-border rounded-xl text-base font-black focus:outline-none focus:border-amber-400/50 transition-colors"
                />

                <div className="flex gap-2 pt-1 overflow-x-auto pb-1">
                  {QUICK_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setAmount(String(amt))}
                      className="px-4.5 h-9 rounded-xl border border-border bg-background/40 hover:bg-background text-xs font-bold transition-all shrink-0 active:scale-95"
                    >
                      ₵{amt}
                    </button>
                  ))}
                </div>

                <div className="space-y-1 pt-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block">
                    Your Contact Email (for Receipt)
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      placeholder="e.g. email@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full h-11 px-4 bg-background/50 border border-border rounded-xl text-sm font-semibold focus:outline-none focus:border-amber-400/50 transition-colors"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          {/* ── Summary Column ── */}
          <div className="space-y-5">
            <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wider text-foreground">
                Payment Summary
              </h3>

              <div className="space-y-2.5 text-xs">
                <SummaryRow label="Provider" value={provider || "-"} />
                <SummaryRow label="Account" value={accountNumber || phoneNumber || "-"} />
                <SummaryRow label="Verified Name" value={accountName || "-"} />
                <SummaryRow label="Top Up Amount" value={amount ? `GH₵ ${Number(amount).toFixed(2)}` : "GH₵ 0.00"} />
                {canPay && (
                  <>
                    <SummaryRow label="Service Fee (3%)" value={`GH₵ ${fee.toFixed(2)}`} />
                    <SummaryRow label="Total to Pay" value={`GH₵ ${total.toFixed(2)}`} valueClass="text-amber-500 font-black" />
                  </>
                )}
              </div>

              <div className="pt-3 border-t border-border/60">
                <button
                  type="button"
                  disabled={!canPay}
                  onClick={handlePayClick}
                  className={cn(
                    "w-full h-12 rounded-xl text-xs font-black uppercase tracking-wider transition-all active:scale-97 flex items-center justify-center gap-1.5 shadow-lg",
                    canPay
                      ? "bg-amber-400 hover:bg-amber-500 text-black shadow-amber-400/10"
                      : "bg-muted text-muted-foreground border border-border cursor-not-allowed shadow-none"
                  )}
                >
                  <CreditCard className="w-4 h-4" />
                  Proceed to Payment
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card/20 p-5 text-center space-y-2">
              <ShieldCheck className="w-5 h-5 text-emerald-500 mx-auto" />
              <p className="text-[10px] font-black uppercase tracking-wider text-foreground">
                Secured Payments
              </p>
              <p className="text-[9px] text-muted-foreground leading-normal">
                Payments are processed securely via Paystack. Your meter is credited immediately after payment confirmation.
              </p>
            </div>
          </div>
        </div>
      </div>

      <PaystackMomoCheckout
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        amount={total}
        email={email.trim() || "customer@swiftdata.gh"}
        recipientPhone={selectedMeterNumber || accountNumber.trim() || phoneNumber.trim()}
        recipientNetwork={""}
        metadata={{
          order_type: "utility",
          utility_type: activeTab,
          utility_provider: provider,
          utility_account_number: selectedMeterNumber || accountNumber.trim() || phoneNumber.trim(),
          utility_account_name: accountName,
          lookup_transaction_id: lookupTxId,
          base_price: numAmount,
          meter_id: selectedMeterId || undefined,
          meter_number: selectedMeterNumber || undefined,
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

export default BuyUtility;
