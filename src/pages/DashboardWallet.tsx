import { useState, useEffect, useCallback, useRef } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";
import { invokePublicFunction, invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { 
  Wallet, Loader2, Send, CreditCard, Gift, 
  ArrowRightLeft, History, RefreshCw, 
  ArrowUpRight, Zap, ShieldCheck, CheckCircle2, X,
  Coins, Smartphone, PieChart
} from "lucide-react";
import { basePackages, networks, getPublicPrice } from "@/lib/data";
import { WalletStatement } from "@/components/WalletStatement";
import { OfflineQueueWidget } from "@/components/OfflineQueueWidget";
import { PaystackMomoCheckout } from "@/components/PaystackMomoCheckout";
import { cn } from "@/lib/utils";

interface WalletTopupRow {
  id: string;
  amount: number;
  status: string;
  created_at: string;
}

interface GlobalPackageSetting {
  network: string;
  package_size: string;
  agent_price: number | null;
  public_price: number | null;
  is_unavailable: boolean;
}

const PAYSTACK_FEE_CAP = 100;

const calculatePaystackFee = (amount: number, feeRate: number) => {
  const fee = amount * feeRate;
  return Math.min(fee, PAYSTACK_FEE_CAP);
};

const getAssignedSubAgentPrice = (
  assignedMap: Record<string, Record<string, string | number>> | undefined,
  network: string,
  size: string,
): number | null => {
  if (!assignedMap || typeof assignedMap !== "object") return null;

  const networkCandidates = [
    network,
    network.replace(/\s+/g, ""),
    network === "AT iShare" ? "AirtelTigo" : network,
  ];
  const sizeCandidates = [size, size.replace(/\s+/g, ""), size.toUpperCase()];

  for (const n of networkCandidates) {
    const byNetwork = assignedMap[n];
    if (!byNetwork) continue;
    for (const s of sizeCandidates) {
      const value = Number(byNetwork[s]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }

  return null;
};

const normalizePackageSize = (size: string) => size.replace(/\s+/g, "").toUpperCase();

const DashboardWallet = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState<"overview" | "buy" | "history">("overview");
  const [balance, setBalance] = useState(0);
  const [apiBalance, setApiBalance] = useState(0);
  const [availableProfit, setAvailableProfit] = useState(0);
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  const [convertingPoints, setConvertingPoints] = useState(false);
  const [loading, setLoading] = useState(true);
  const [globalSettings, setGlobalSettings] = useState<GlobalPackageSetting[]>([]);
  const [parentAssignedPrices, setParentAssignedPrices] = useState<Record<string, Record<string, string | number>>>({});
  const [feeRate, setFeeRate] = useState(0.03);
  const [priceMultiplier, setPriceMultiplier] = useState(1);

  // Buy data form
  const [selectedNetwork, setSelectedNetwork] = useState("");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [buying, setBuying] = useState(false);
  const [syncingDeposits, setSyncingDeposits] = useState(false);
  const [recentTopups, setRecentTopups] = useState<WalletTopupRow[]>([]);
  const [topupAmount, setTopupAmount] = useState("");
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // Quick preset buttons for topup
  const PRESET_AMOUNTS = [20, 50, 100, 200, 500];

  // Fetch global package settings
  useEffect(() => {
    supabase.from("global_package_settings").select("*").then(({ data }) => {
      if (data) setGlobalSettings(data as GlobalPackageSetting[]);
    });
    fetchApiPricingContext().then((ctx) => setPriceMultiplier(ctx.multiplier));

    if (profile?.is_sub_agent && profile?.parent_agent_id) {
      supabase
        .from("profiles")
        .select("sub_agent_prices")
        .eq("user_id", profile.parent_agent_id)
        .maybeSingle()
        .then(({ data }) => {
          setParentAssignedPrices((data?.sub_agent_prices || {}) as Record<string, Record<string, string | number>>);
        });
    }
  }, [profile?.is_sub_agent, profile?.parent_agent_id]);

  const getAgentPrice = (network: string, size: string): number => {
    const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);
    const assignedFromParent = getAssignedSubAgentPrice(parentAssignedPrices, network, size);
    const assignedFromProfile = getAssignedSubAgentPrice(
      profile?.agent_prices as Record<string, Record<string, string | number>> | undefined,
      network,
      size,
    );
    const assignedPrice = assignedFromParent || assignedFromProfile;
    if (assignedPrice && assignedPrice > 0) return applyPriceMultiplier(assignedPrice, priceMultiplier);

    const setting = globalSettings.find(
      (s) => s.network === network && normalizePackageSize(s.package_size) === normalizePackageSize(size)
    );

    if (isPaidAgent && setting?.agent_price && setting.agent_price > 0) {
      return applyPriceMultiplier(setting.agent_price, priceMultiplier);
    }

    if (!isPaidAgent && setting?.public_price && setting.public_price > 0) {
      return applyPriceMultiplier(setting.public_price, priceMultiplier);
    }

    if (!isPaidAgent) {
      const basePkg = basePackages[network]?.find((p) => p.size === size);
      if (basePkg) return applyPriceMultiplier(getPublicPrice(basePkg.price), priceMultiplier);
    }

    const basePkg = basePackages[network]?.find((p) => p.size === size);
    return basePkg ? applyPriceMultiplier(basePkg.price, priceMultiplier) : 0;
  };

  const fetchBalance = useCallback(async () => {
    if (!user) return;

    const [walletRes, ordersRes, parentProfitRes, withdrawalsRes, settingsRes] = await Promise.all([
      supabase.from("wallets").select("balance, loyalty_balance, api_balance").eq("agent_id", user.id).maybeSingle(),
      supabase.from("orders").select("profit").eq("agent_id", user.id).eq("status", "fulfilled"),
      supabase.from("orders").select("parent_profit").eq("parent_agent_id", user.id).eq("status", "fulfilled"),
      supabase.from("withdrawals").select("amount, status").eq("agent_id", user.id).in("status", ["completed", "pending", "processing"]),
      supabase.from("system_settings").select("paystack_deposit_fee_percent").eq("id", 1).maybeSingle(),
    ]);

    const walletData = walletRes.data;
    const walletBalance = walletData?.balance || 0;
    const apiBal = walletData?.api_balance || 0;
    const loyaltyPoints = walletData?.loyalty_balance || 0;
    const totalProfit = (ordersRes.data || []).reduce((sum, row: any) => sum + Number(row.profit || 0), 0);
    const parentProfitRows = (parentProfitRes.data || []) as Array<{ parent_profit?: number }>;
    const totalParentProfit = parentProfitRows.reduce((sum, row) => sum + Number(row.parent_profit || 0), 0);
    const withdrawnProfit = (withdrawalsRes.data || []).reduce((sum, row: any) => sum + Number(row.amount || 0), 0);
    const profitBalance = parseFloat(((totalProfit + totalParentProfit) - withdrawnProfit).toFixed(2));

    setBalance(walletBalance);
    setApiBalance(apiBal);
    setLoyaltyBalance(Number(loyaltyPoints));
    setAvailableProfit(Math.max(0, profitBalance));
    if (settingsRes.data?.paystack_deposit_fee_percent !== undefined) {
      setFeeRate(Number(settingsRes.data.paystack_deposit_fee_percent));
    }
    setLoading(false);
  }, [user]);

  const fetchRecentTopups = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("orders")
      .select("id, amount, status, created_at")
      .eq("agent_id", user.id)
      .eq("order_type", "wallet_topup")
      .order("created_at", { ascending: false })
      .limit(8);
    setRecentTopups((data || []) as WalletTopupRow[]);
  }, [user]);

  useEffect(() => { fetchBalance(); }, [fetchBalance]);
  useEffect(() => { fetchRecentTopups(); }, [fetchRecentTopups]);

  useEffect(() => {
    const handleSyncComplete = () => {
      void fetchBalance();
      void fetchRecentTopups();
    };
    window.addEventListener("offline-sync-complete", handleSyncComplete);
    return () => {
      window.removeEventListener("offline-sync-complete", handleSyncComplete);
    };
  }, [fetchBalance, fetchRecentTopups]);

  useRealtimeRefresh({
    tables: ["wallets", "orders"],
    onRefresh: () => { fetchBalance(); fetchRecentTopups(); },
    filters: user ? { wallets: `agent_id=eq.${user.id}`, orders: `agent_id=eq.${user.id}` } : {},
  });

  const verifiedRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    if (reference && !verifiedRef.current) {
      verifiedRef.current = true;
      invokePublicFunctionAsUser("verify-payment", { body: { reference } }).then(async (res) => {
        const status = res.data?.status;
        if (status === "fulfilled") {
          toast({ title: "Wallet topped up successfully! 🎉" });
        } else {
          toast({ title: "Deposit received", description: "If balance is not updated yet, tap Verify Deposits." });
        }
        await fetchBalance();
        await fetchRecentTopups();
        let retries = 3;
        const poll = setInterval(async () => {
          await fetchBalance();
          await fetchRecentTopups();
          retries--;
          if (retries <= 0) clearInterval(poll);
        }, 3000);
        window.history.replaceState({}, "", window.location.pathname);
      }).catch(async () => {
        toast({ title: "Could not auto-verify", description: "Tap Verify Deposits or paste reference.", variant: "destructive" });
        await fetchBalance();
        window.history.replaceState({}, "", window.location.pathname);
      });
    }
  }, [fetchBalance, fetchRecentTopups, toast]);

  const handlePaystackTopup = async () => {
    const requestedCredit = Number(topupAmount);
    if (!Number.isFinite(requestedCredit) || requestedCredit < 10) {
      toast({ title: "Check Top-Up Amount", description: "Minimum wallet top-up is GH₵ 10.00", variant: "destructive" });
      return;
    }
    setCheckoutOpen(true);
  };

  const handleCheckoutSuccess = async (ref: string) => {
    setCheckoutOpen(false);
    toast({ title: "Deposit Received", description: "Verifying and updating wallet balance..." });
    setTopupAmount("");
    try {
      await invokePublicFunctionAsUser("verify-payment", { body: { reference: ref } });
      await fetchBalance();
      await fetchRecentTopups();
    } catch (e) {
      console.error("Verification failed", e);
    }
  };

  const handleCheckoutFailure = (error: string) => {
    console.error("Checkout failed:", error);
  };

  const agentPackages = selectedNetwork
    ? (basePackages[selectedNetwork] || []).map((p) => ({
        ...p,
        price: getAgentPrice(selectedNetwork, p.size),
      }))
    : [];

  const selectedPkg = agentPackages.find((p) => p.size === selectedPackage);
  const topupRequestedAmount = Number(topupAmount);
  const topupFee = Number.isFinite(topupRequestedAmount) && topupRequestedAmount > 0
    ? Math.round(calculatePaystackFee(topupRequestedAmount, feeRate) * 100) / 100
    : 0;
  const topupChargeTotal = Number.isFinite(topupRequestedAmount) && topupRequestedAmount > 0
    ? Math.round((topupRequestedAmount + topupFee) * 100) / 100
    : 0;

  const handleBuyData = async () => {
    if (!selectedNetwork || !selectedPackage || !customerPhone || !selectedPkg) {
      toast({ title: "Incomplete selection", description: "Please choose network, plan, and phone number.", variant: "destructive" });
      return;
    }

    if (balance < selectedPkg.price) {
      toast({ title: "Insufficient Balance", description: `You need GH₵ ${selectedPkg.price.toFixed(2)}. Please top up your wallet.`, variant: "destructive" });
      return;
    }

    setBuying(true);
    const { data, error } = await invokePublicFunctionAsUser("wallet-buy-data", {
      body: {
        network: selectedNetwork,
        package_size: selectedPackage,
        customer_phone: customerPhone,
        amount: selectedPkg.price,
      },
    });

    if (error || data?.error) {
      const description = data?.error || await getFunctionErrorMessage(error, "Could not complete wallet purchase.");
      toast({ title: "Purchase Failed", description, variant: "destructive" });
    } else if (data?.queued) {
      toast({
        title: "Order Queued Offline 📶",
        description: "Order queued locally and will process when online.",
      });
      setCustomerPhone("");
      setSelectedPackage("");
    } else if (data?.success || data?.status === "paid" || data?.status === "fulfilled") {
      if (data?.order_id) {
        invokePublicFunction("verify-payment", { body: { reference: data.order_id } }).catch(e => console.error("[FastTrack-Error]", e));
      }
      setShowSuccessOverlay(true);
      setCustomerPhone("");
      setSelectedPackage("");
      toast({ title: "Purchase Completed! 🎉", description: "Data bundle sent to recipient." });
    } else {
      toast({ title: "Order Placed", description: data?.failure_reason || "Fulfillment in progress", variant: "destructive" });
    }
    await fetchBalance();
    setBuying(false);
  };

  const handleConvertPoints = async () => {
    if (loyaltyBalance < 100) {
      toast({ title: "Minimum 100 SwiftPoints required", description: "100 points = GH₵ 1.00", variant: "destructive" });
      return;
    }
    setConvertingPoints(true);
    const { data, error } = await supabase.rpc("convert_loyalty_points", {
      user_id: user?.id,
      points_to_convert: loyaltyBalance
    });
    if (error || !data?.success) {
      toast({ title: "Conversion Failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: "Points Converted! 🪙", description: `GH₵ ${data.cash_added} added to your main wallet balance.` });
      await fetchBalance();
    }
    setConvertingPoints(false);
  };

  const handleSyncPendingDeposits = async () => {
    if (!user) return;
    setSyncingDeposits(true);
    try {
      const { data: pendingRows, error } = await supabase
        .from("orders").select("id, status").eq("agent_id", user.id)
        .eq("order_type", "wallet_topup").in("status", ["pending", "paid", "processing", "fulfillment_failed"])
        .order("created_at", { ascending: false }).limit(10);

      if (error) { toast({ title: "Sync failed", description: error.message, variant: "destructive" }); return; }
      if (!pendingRows || pendingRows.length === 0) { toast({ title: "No pending deposits found" }); return; }

      let fulfilledCount = 0;
      for (const row of pendingRows) {
        try {
          const res = await invokePublicFunctionAsUser("verify-payment", { body: { reference: row.id } });
          if (res.data?.status === "fulfilled") fulfilledCount++;
          await new Promise(r => setTimeout(r, 300));
        } catch (e) {
          console.error(`[Sync-Error] Reference ${row.id}:`, e);
        }
      }

      await fetchBalance();
      await fetchRecentTopups();
      toast({
        title: "Deposit Check Complete",
        description: fulfilledCount > 0 ? `${fulfilledCount} deposit(s) credited to your wallet.` : "No new successful deposits found yet.",
      });
    } catch (syncError) {
      toast({ title: "Sync failed", description: syncError instanceof Error ? syncError.message : "Could not verify pending deposits.", variant: "destructive" });
    } finally {
      setSyncingDeposits(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[500px] gap-3">
      <div className="relative">
        <div className="absolute inset-0 bg-amber-500/20 rounded-full blur-xl animate-pulse" />
        <Loader2 className="w-10 h-10 animate-spin text-amber-500 relative z-10" />
      </div>
      <p className="text-xs font-black uppercase tracking-widest text-muted-foreground animate-pulse">Securing Wallet Context...</p>
    </div>
  );

  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8 max-w-6xl mx-auto text-foreground">
      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-amber-500/10 via-slate-900/40 to-indigo-500/10 p-6 rounded-3xl border border-amber-500/20 backdrop-blur-xl shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Agent Capital Hub
            </span>
            {profile?.is_agent && (
              <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-bold text-[10px]">
                Verified Partner
              </Badge>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-3">
            <Wallet className="w-7 h-7 text-amber-400" /> Account Wallet & Capital
          </h1>
          <p className="text-xs text-muted-foreground max-w-md font-medium">
            Instant Mobile Money & Card top-ups, profit withdrawals, and SwiftPoints rewards.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button 
            variant="outline" 
            size="sm" 
            className="h-10 px-4 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30 font-bold text-xs gap-2 transition-all shadow-md"
            onClick={handleSyncPendingDeposits} 
            disabled={syncingDeposits}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingDeposits ? "animate-spin text-amber-400" : ""}`} />
            <span>{syncingDeposits ? "Checking..." : "Verify Deposits"}</span>
          </Button>

          {profile?.is_agent && (
            <Button
              size="sm"
              className="h-10 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs gap-2 shadow-lg shadow-emerald-500/20 border border-emerald-400/40"
              onClick={() => navigate("/dashboard/withdraw")}
            >
              <ArrowUpRight className="w-4 h-4" /> Withdraw Profit
            </Button>
          )}
        </div>
      </div>

      {/* ── Top Hero Cards Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Main Balance & Profits */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 via-amber-600 to-orange-600 p-6 text-slate-950 shadow-2xl shadow-amber-500/25 border border-amber-400/50 flex flex-col justify-between group">
          <div className="absolute top-0 right-0 p-8 opacity-15 group-hover:scale-110 group-hover:rotate-6 transition-transform duration-500 pointer-events-none">
            <Wallet className="w-32 h-32 text-slate-950" />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] px-2.5 py-1 rounded-full bg-slate-950/20 text-slate-950 border border-slate-950/30">
                Primary Wallet Balance
              </span>
              <ShieldCheck className="w-5 h-5 text-slate-950/80" />
            </div>

            <div className="mt-4">
              <p className="text-xs font-bold text-slate-950/70 uppercase tracking-widest">Available Working Capital</p>
              <h2 className="text-4xl font-black tracking-tight text-slate-950 mt-1">
                GH₵ {balance.toFixed(2)}
              </h2>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-950/20 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold text-slate-950/70 uppercase tracking-wider block">Available Profit Balance</span>
              <span className="text-base font-black text-slate-950">GH₵ {availableProfit.toFixed(2)}</span>
            </div>
            {apiBalance > 0 && (
              <div className="text-right">
                <span className="text-[10px] font-bold text-slate-950/70 uppercase tracking-wider block">API Balance</span>
                <span className="text-base font-black text-slate-950">GH₵ {apiBalance.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Quick MoMo Top-Up Form */}
        <div className="relative overflow-hidden rounded-3xl bg-slate-900/80 border border-blue-500/30 p-6 backdrop-blur-2xl shadow-xl flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30">
                <Zap className="w-4 h-4 fill-current" />
              </div>
              <div>
                <h3 className="text-sm font-black text-white">Instant Paystack Top Up</h3>
                <p className="text-[10px] text-muted-foreground font-mono">MoMo (MTN, Telecel, AT) or Card</p>
              </div>
            </div>
            <Badge variant="outline" className="bg-blue-500/10 border-blue-500/30 text-blue-400 font-mono text-[9px] uppercase">
              Auto Credit
            </Badge>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block mb-1.5">
                Amount (GH₵)
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-sm">
                  GH₵
                </div>
                <Input
                  type="number" 
                  placeholder="50.00" 
                  value={topupAmount}
                  onChange={(e) => setTopupAmount(e.target.value)}
                  className="h-11 pl-12 bg-slate-950/60 border-slate-800 text-white font-mono font-bold text-base rounded-xl focus:border-blue-500"
                />
              </div>
            </div>

            {/* Quick Amount Presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRESET_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setTopupAmount(amt.toString())}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-mono font-bold border transition-all",
                    topupAmount === amt.toString()
                      ? "bg-blue-500 text-white border-blue-400 shadow-md"
                      : "bg-slate-950/40 border-slate-800 text-muted-foreground hover:text-white hover:border-slate-700"
                  )}
                >
                  +{amt}
                </button>
              ))}
            </div>

            {topupRequestedAmount > 0 && (
              <div className="flex items-center justify-between text-[11px] font-mono px-3 py-2 rounded-xl bg-blue-950/30 border border-blue-500/20 text-blue-300">
                <span>Fee ({ (feeRate * 100).toFixed(1) }%): GH₵ {topupFee.toFixed(2)}</span>
                <span className="font-extrabold text-white">Total: GH₵ {topupChargeTotal.toFixed(2)}</span>
              </div>
            )}
          </div>

          <Button
            onClick={handlePaystackTopup}
            className="w-full h-11 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-500/20 border border-blue-400/30 gap-2"
          >
            <CreditCard className="w-4 h-4" /> Top Up Wallet Now
          </Button>
        </div>

        {/* Card 3: SwiftPoints & Swift Float */}
        <div className="relative overflow-hidden rounded-3xl bg-slate-900/80 border border-amber-500/30 p-6 backdrop-blur-2xl shadow-xl flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <Gift className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-black text-white">SwiftPoints Rewards</h3>
                <p className="text-[10px] text-muted-foreground font-mono">100 Points = GH₵ 1.00 Cash</p>
              </div>
            </div>
            <Coins className="w-4 h-4 text-amber-400" />
          </div>

          <div className="space-y-2 p-3 rounded-2xl bg-amber-950/20 border border-amber-500/20">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-black text-white">{loyaltyBalance.toLocaleString()}</span>
              <span className="text-xs font-bold text-amber-400 uppercase font-mono">pts</span>
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
              <span>Est. Cash Value:</span>
              <span className="font-extrabold text-emerald-400">GH₵ {(loyaltyBalance / 100).toFixed(2)}</span>
            </div>
          </div>

          <Button
            onClick={handleConvertPoints}
            disabled={convertingPoints || loyaltyBalance < 100}
            variant="outline"
            className="w-full h-10 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30 font-black text-xs uppercase tracking-widest gap-2 disabled:opacity-30"
          >
            {convertingPoints ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4 text-amber-400" />}
            Convert Points to Cash
          </Button>

          {/* Micro-Credit Float Status */}
          {profile?.credit_enabled ? (
            <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase">Active Overdraft Float</span>
              <span className="text-xs font-black font-mono text-white">GH₵ {(profile?.credit_limit || 0).toFixed(2)}</span>
            </div>
          ) : (
            <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground px-1">
              <span>Need sales credit?</span>
              <button
                type="button"
                onClick={async () => {
                  if (!user) return;
                  await supabase.from("user_notifications").insert({
                     user_id: user.id,
                     title: "Float Request",
                     message: `${profile?.full_name || 'Agent'} requested Swift Float credit limit.`,
                     type: "info"
                  });
                  toast({ title: "Application Submitted", description: "Admin will review your agent sales volume." });
                }}
                className="text-amber-400 font-extrabold hover:underline"
              >
                Apply for Float &rarr;
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Navigation Tabs ── */}
      <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-xl w-fit">
        <button
          onClick={() => setActiveTab("overview")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === "overview"
              ? "bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-md"
              : "text-muted-foreground hover:text-white"
          )}
        >
          <PieChart className="w-3.5 h-3.5" /> Capital Overview
        </button>
        <button
          onClick={() => setActiveTab("buy")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === "buy"
              ? "bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-md"
              : "text-muted-foreground hover:text-white"
          )}
        >
          <Send className="w-3.5 h-3.5" /> Buy Data with Wallet
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === "history"
              ? "bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-md"
              : "text-muted-foreground hover:text-white"
          )}
        >
          <History className="w-3.5 h-3.5" /> Wallet Statement & Deposits
        </button>
      </div>

      {/* ── Tab Content 1: Overview & Recent Deposits ── */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Recent Top-ups List */}
            <Card className="bg-slate-900/80 border-slate-800 backdrop-blur-2xl shadow-xl rounded-3xl overflow-hidden">
              <CardHeader className="border-b border-slate-800/80 pb-4 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-black text-white flex items-center gap-2">
                    <History className="w-4 h-4 text-amber-400" /> Recent Wallet Deposits
                  </CardTitle>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">Paystack Mobile Money & Card top-up history</p>
                </div>
                <Button variant="ghost" size="sm" onClick={fetchRecentTopups} className="h-8 text-xs font-mono text-amber-400 hover:text-amber-300">
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Reload
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {recentTopups.length === 0 ? (
                  <div className="p-8 text-center text-xs font-mono text-muted-foreground">
                    No recent deposits recorded.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/60">
                    {recentTopups.map((topup) => {
                      const isFulfilled = topup.status === "fulfilled" || topup.status === "paid";
                      const isPending = topup.status === "pending" || topup.status === "processing";
                      
                      return (
                        <div key={topup.id} className="p-4 flex items-center justify-between hover:bg-slate-800/30 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "w-9 h-9 rounded-xl flex items-center justify-center border shrink-0",
                              isFulfilled ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : isPending ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                            )}>
                              {isFulfilled ? <CheckCircle2 className="w-4 h-4" /> : isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-black text-white font-mono">GH₵ {Number(topup.amount).toFixed(2)}</span>
                                <Badge variant="outline" className={cn(
                                  "text-[9px] font-mono uppercase px-1.5 py-0",
                                  isFulfilled ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : isPending ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                                )}>
                                  {topup.status}
                                </Badge>
                              </div>
                              <span className="text-[10px] text-muted-foreground font-mono block mt-0.5">
                                {new Date(topup.created_at).toLocaleString("en-GH")} · Ref: {topup.id.slice(0, 8)}
                              </span>
                            </div>
                          </div>

                          {isPending && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-[10px] font-mono font-bold bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20"
                              onClick={async () => {
                                toast({ title: "Verifying deposit..." });
                                await invokePublicFunctionAsUser("verify-payment", { body: { reference: topup.id } });
                                await fetchBalance();
                                await fetchRecentTopups();
                              }}
                            >
                              Verify
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <OfflineQueueWidget />
          </div>

          <div className="space-y-6">
            {/* Wallet Statement Component */}
            {user && <WalletStatement userId={user.id} />}
          </div>
        </div>
      )}

      {/* ── Tab Content 2: Buy Data with Wallet ── */}
      {activeTab === "buy" && (
        <Card className="bg-slate-900/80 border-slate-800 backdrop-blur-2xl shadow-xl rounded-3xl overflow-hidden max-w-2xl mx-auto">
          <CardHeader className="border-b border-slate-800/80 pb-4">
            <CardTitle className="text-base font-black text-white flex items-center gap-2">
              <Send className="w-4 h-4 text-amber-400" /> Instant Data Bundle Purchase
            </CardTitle>
            <p className="text-xs text-muted-foreground font-mono">Deducted instantly from your main wallet balance (GH₵ {balance.toFixed(2)})</p>
          </CardHeader>

          <CardContent className="p-6 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Telecom Network</Label>
                <Select value={selectedNetwork} onValueChange={(v) => { setSelectedNetwork(v); setSelectedPackage(""); }}>
                  <SelectTrigger className="h-12 bg-slate-950/60 border-slate-800 text-white rounded-xl font-bold">
                    <SelectValue placeholder="Select Network" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-950 border-slate-800 text-white">
                    {networks.map((n) => (<SelectItem key={n.name} value={n.name}>{n.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Data Package</Label>
                <Select value={selectedPackage} onValueChange={setSelectedPackage} disabled={!selectedNetwork}>
                  <SelectTrigger className="h-12 bg-slate-950/60 border-slate-800 text-white rounded-xl font-bold">
                    <SelectValue placeholder="Choose Plan" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-950 border-slate-800 text-white max-h-[300px]">
                    {agentPackages.map((p) => (
                      <SelectItem key={p.size} value={p.size} className="focus:bg-amber-400 focus:text-black">
                        {p.size} — GH₵ {p.price.toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Recipient Phone Number</Label>
              <div className="relative">
                <Input
                  placeholder="e.g. 0241234567" 
                  value={customerPhone} 
                  onChange={(e) => setCustomerPhone(e.target.value)} 
                  className="h-12 bg-slate-950/60 border-slate-800 text-white font-mono font-bold rounded-xl pl-11"
                />
                <Smartphone className="w-4 h-4 text-muted-foreground absolute left-4 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            {selectedPkg && (
              <div className="flex items-center justify-between p-3.5 rounded-2xl bg-amber-950/20 border border-amber-500/20 text-xs font-mono">
                <span className="text-muted-foreground">Order Total:</span>
                <span className="text-sm font-black text-amber-400">GH₵ {selectedPkg.price.toFixed(2)}</span>
              </div>
            )}

            <Button 
              onClick={handleBuyData} 
              disabled={buying || !selectedPkg || !customerPhone} 
              className="w-full h-12 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs uppercase tracking-widest shadow-xl shadow-amber-500/10 gap-2"
            >
              {buying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {buying ? "Processing Order..." : "Confirm & Pay from Wallet"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Tab Content 3: Full Statement ── */}
      {activeTab === "history" && (
        <div className="space-y-6">
          {user && <WalletStatement userId={user.id} />}
        </div>
      )}

      {/* ── Success Modal Overlay ── */}
      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-in fade-in duration-500">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-3xl" />
          <div className="relative max-w-sm w-full bg-[#0A0A0C] border border-white/10 rounded-[3rem] p-10 text-center space-y-8 animate-in zoom-in-95 duration-300 shadow-3xl">
            <div className="relative mx-auto w-36 h-36">
              <div className="absolute inset-0 bg-emerald-500 rounded-full blur-3xl opacity-10 animate-pulse" />
              <svg className="w-full h-full drop-shadow-[0_8px_24px_rgba(16,185,129,0.2)] animate-bounce-subtle relative z-10" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="55" y="25" width="90" height="150" rx="16" fill="url(#phoneGradOverlay)" stroke="rgba(255,255,255,0.15)" strokeWidth="2"/>
                <rect x="62" y="32" width="76" height="136" rx="10" fill="#0A0A0C"/>
                <rect x="90" y="35" width="20" height="4" rx="2" fill="rgba(255,255,255,0.2)"/>
                <path d="M 65 100 Q 100 85 135 100" stroke="rgba(16,185,129,0.3)" strokeWidth="2" fill="none"/>
                <path d="M 65 120 Q 100 105 135 120" stroke="rgba(16,185,129,0.15)" strokeWidth="2" fill="none"/>
                <circle cx="100" cy="90" r="32" fill="url(#badgeGradOverlay)" />
                <circle cx="100" cy="90" r="26" fill="#0A0A0C"/>
                <path d="M 90 90 L 97 97 L 112 82" stroke="#10B981" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M 45 60 L 48 65 L 53 66 L 49 70 L 50 75 L 45 72 L 40 75 L 41 70 L 37 66 L 42 65 Z" fill="#ffd43b" opacity="0.8"/>
                <path d="M 155 120 L 157 123 L 161 124 L 158 127 L 159 131 L 155 129 L 151 131 L 152 127 L 149 124 L 153 123 Z" fill="#ff9f1c" opacity="0.8"/>
                <circle cx="145" cy="55" r="4" fill="#0ea5e9"/>
                <circle cx="50" cy="130" r="3" fill="#10B981"/>
                <defs>
                  <linearGradient id="phoneGradOverlay" x1="55" y1="25" x2="145" y2="175" gradientUnits="userSpaceOnUse">
                    <stop stopColor="rgba(255,255,255,0.08)"/>
                    <stop offset="1" stopColor="rgba(255,255,255,0.02)"/>
                  </linearGradient>
                  <linearGradient id="badgeGradOverlay" x1="68" y1="58" x2="132" y2="122" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#10B981"/>
                    <stop offset="1" stopColor="#059669"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div className="space-y-3">
              <h2 className="text-4xl font-black tracking-tighter text-white uppercase">Delivered!</h2>
              <p className="text-white/40 text-sm font-medium leading-relaxed">Your data bundle has been processed successfully. Your wallet balance has been updated.</p>
            </div>
            <div className="pt-4">
              <button onClick={() => setShowSuccessOverlay(false)} className="w-full bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black py-4 rounded-2xl transition-all uppercase tracking-widest text-xs">Continue</button>
            </div>
          </div>
          <style>{`
            @keyframes bounce-subtle {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-6px); }
            }
            .animate-bounce-subtle {
              animation: bounce-subtle 3s infinite ease-in-out;
            }
          `}</style>
        </div>
      )}

      {/* ── Checkout Modal ── */}
      <PaystackMomoCheckout
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        amount={topupChargeTotal}
        email={profile?.email || user?.email || ""}
        recipientPhone={""}
        recipientNetwork={""}
        metadata={{
          order_type: "wallet_topup",
          agent_id: user?.id,
          wallet_credit: topupRequestedAmount,
          wallet_type: "main"
        }}
        onSuccess={handleCheckoutSuccess}
        onFailure={handleCheckoutFailure}
      />
    </div>
  );
};

export default DashboardWallet;
