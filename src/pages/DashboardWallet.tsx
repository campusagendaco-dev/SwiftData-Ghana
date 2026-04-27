import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";
import { invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Wallet, Loader2, Send, CreditCard, Gift, 
  ArrowRightLeft, History, RefreshCw, PlusCircle, 
  ChevronRight, ArrowUpRight, Zap, ShieldCheck 
} from "lucide-react";
import { basePackages, networks, getPublicPrice } from "@/lib/data";

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

const PAYSTACK_FEE_RATE = 0.03;
const PAYSTACK_FEE_CAP = 100;

const calculatePaystackFee = (amount: number) => {
  const fee = amount * PAYSTACK_FEE_RATE;
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
  const [balance, setBalance] = useState(0);
  const [availableProfit, setAvailableProfit] = useState(0);
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  const [convertingPoints, setConvertingPoints] = useState(false);
  const [loading, setLoading] = useState(true);
  const [globalSettings, setGlobalSettings] = useState<GlobalPackageSetting[]>([]);
  const [parentAssignedPrices, setParentAssignedPrices] = useState<Record<string, Record<string, string | number>>>({});
  const [priceMultiplier, setPriceMultiplier] = useState(1);

  // Buy data form
  const [selectedNetwork, setSelectedNetwork] = useState("");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [buying, setBuying] = useState(false);
  const [syncingDeposits, setSyncingDeposits] = useState(false);
  const [recentTopups, setRecentTopups] = useState<WalletTopupRow[]>([]);
  const [topupAmount, setTopupAmount] = useState("");
  const [toppingUp, setToppingUp] = useState(false);

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

    const [walletRes, ordersRes, parentProfitRes, withdrawalsRes] = await Promise.all([
      supabase.from("wallets").select("balance, loyalty_balance").eq("agent_id", user.id).maybeSingle(),
      supabase.from("orders").select("profit").eq("agent_id", user.id).in("status", ["paid", "fulfilled", "fulfillment_failed"]),
      supabase.from("orders").select("parent_profit").eq("parent_agent_id", user.id).in("status", ["paid", "fulfilled", "fulfillment_failed"]),
      supabase.from("withdrawals").select("amount, status").eq("agent_id", user.id).in("status", ["completed", "pending", "processing"]),
    ]);

    const walletBalance = walletRes.data?.balance || 0;
    const totalProfit = (ordersRes.data || []).reduce((sum, row: any) => sum + Number(row.profit || 0), 0);
    const parentProfitRows = (parentProfitRes.data || []) as Array<{ parent_profit?: number }>;
    const totalParentProfit = parentProfitRows.reduce((sum, row) => sum + Number(row.parent_profit || 0), 0);
    const withdrawnProfit = (withdrawalsRes.data || []).reduce((sum, row: any) => sum + Number(row.amount || 0), 0);
    const profitBalance = parseFloat(((totalProfit + totalParentProfit) - withdrawnProfit).toFixed(2));

    setBalance(walletBalance);
    setLoyaltyBalance(Number(walletRes.data?.loyalty_balance || 0));
    setAvailableProfit(Math.max(0, profitBalance));
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
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    if (reference) {
      invokePublicFunctionAsUser("verify-payment", { body: { reference } }).then(async (res) => {
        const status = res.data?.status;
        if (status === "fulfilled") {
          toast({ title: "Wallet topped up successfully!" });
        } else {
          toast({ title: "Deposit received", description: "If balance is not updated yet, tap Verify Pending Deposit." });
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
        toast({ title: "Could not auto-verify", description: "Tap Verify Pending Deposit or paste your reference below.", variant: "destructive" });
        await fetchBalance();
        window.history.replaceState({}, "", window.location.pathname);
      });
    }
  }, [fetchBalance, fetchRecentTopups, toast]);

  const handlePaystackTopup = async () => {
    const requestedCredit = Number(topupAmount);
    if (!Number.isFinite(requestedCredit) || requestedCredit < 15) {
      toast({ title: "Enter a valid top-up amount (minimum GHS 15)", variant: "destructive" });
      return;
    }

    const paystackFee = Math.round(calculatePaystackFee(requestedCredit) * 100) / 100;
    const chargeAmount = Math.round((requestedCredit + paystackFee) * 100) / 100;

    setToppingUp(true);
    const { data, error } = await invokePublicFunctionAsUser("wallet-topup", {
      body: {
        amount: chargeAmount,
        wallet_credit: requestedCredit,
        callback_url: `${getAppBaseUrl()}/dashboard/wallet`,
      },
    });

    if (error || !data?.authorization_url) {
      const description = data?.error || await getFunctionErrorMessage(error, "Could not initialize wallet top-up.");
      toast({ title: "Top-up failed", description, variant: "destructive" });
      setToppingUp(false);
      return;
    }

    window.location.href = data.authorization_url;
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
    ? Math.round(calculatePaystackFee(topupRequestedAmount) * 100) / 100
    : 0;
  const topupChargeTotal = Number.isFinite(topupRequestedAmount) && topupRequestedAmount > 0
    ? Math.round((topupRequestedAmount + topupFee) * 100) / 100
    : 0;

  const handleBuyData = async () => {
    if (!selectedNetwork || !selectedPackage || !customerPhone || !selectedPkg) {
      toast({ title: "Fill in all fields", variant: "destructive" });
      return;
    }

    if (balance < selectedPkg.price) {
      toast({ title: "Insufficient wallet balance", variant: "destructive" });
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
      toast({ title: "Purchase failed", description, variant: "destructive" });
    } else if (data?.status === "fulfilled") {
      toast({ title: "Data delivered successfully!" });
      const successParams = new URLSearchParams({
        source: "wallet",
        network: selectedNetwork,
        package: selectedPackage,
        phone: customerPhone,
      });
      if (typeof data?.order_id === "string" && data.order_id) {
        successParams.set("reference", data.order_id);
      }
      navigate(`/purchase-success?${successParams.toString()}`);
      setCustomerPhone("");
      setSelectedPackage("");
    } else {
      toast({ title: "Order placed", description: data?.failure_reason || "Fulfillment pending", variant: "destructive" });
    }
    await fetchBalance();
    setBuying(false);
  };

  const handleConvertPoints = async () => {
    if (loyaltyBalance < 100) {
      toast({ title: "Minimum 100 points required", description: "100 points = GHS 1.00", variant: "destructive" });
      return;
    }
    setConvertingPoints(true);
    const { data, error } = await supabase.rpc("convert_loyalty_points", {
      user_id: user?.id,
      points_to_convert: loyaltyBalance
    });
    if (error || !data?.success) {
      toast({ title: "Conversion failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ 
        title: "Points Converted!", 
        description: `GHS ${data.cash_added} has been added to your wallet.` 
      });
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
        .eq("order_type", "wallet_topup").in("status", ["pending", "paid"])
        .order("created_at", { ascending: false }).limit(10);

      if (error) { toast({ title: "Sync failed", description: error.message, variant: "destructive" }); return; }
      if (!pendingRows || pendingRows.length === 0) { toast({ title: "No pending deposits found" }); return; }

      const checks = await Promise.allSettled(
        pendingRows.map((row) => invokePublicFunctionAsUser("verify-payment", { body: { reference: row.id } })),
      );

      const fulfilledCount = checks.filter((result) => result.status === "fulfilled" && result.value?.data?.status === "fulfilled").length;

      await fetchBalance();
      await fetchRecentTopups();
      toast({
        title: "Deposit check completed",
        description: fulfilledCount > 0 ? `${fulfilledCount} deposit(s) credited to your wallet.` : "No new successful deposits found yet.",
      });
    } catch (syncError) {
      toast({ title: "Sync failed", description: syncError instanceof Error ? syncError.message : "Could not verify pending deposits.", variant: "destructive" });
    } finally {
      setSyncingDeposits(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      <p className="text-sm font-medium text-muted-foreground animate-pulse">Loading wallet balance...</p>
    </div>
  );

  return (
    <div className="space-y-8 p-4 md:p-8 max-w-5xl mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-black tracking-tight text-white flex items-center gap-3">
            <Wallet className="w-8 h-8 text-amber-400" /> My Wallet
          </h1>
          <p className="text-sm text-white/40 mt-1 max-w-md">
            Manage your funds, top up instantly with Paystack, and track your loyalty points.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="bg-white/5 border-white/10 hover:bg-white/10 text-white/70 h-10 px-4 rounded-xl gap-2"
            onClick={handleSyncPendingDeposits}
            disabled={syncingDeposits}
          >
            <RefreshCw className={`w-4 h-4 ${syncingDeposits ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline text-xs font-bold uppercase tracking-widest">Verify Deposits</span>
          </Button>
        </div>
      </div>

      {/* ── Main Stats Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Balance Card (Pro Design) */}
        <Card className="relative overflow-hidden border-none bg-gradient-to-br from-amber-500 to-amber-600 shadow-2xl shadow-amber-500/20 group">
          <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:scale-110 transition-transform duration-500">
            <Wallet className="w-24 h-24 text-white" />
          </div>
          <CardHeader className="pb-2">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">Main Balance</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-4xl font-black text-white leading-none">GHS {balance.toFixed(2)}</p>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 border border-white/10">
                  <ShieldCheck className="w-3 h-3 text-white" />
                  <span className="text-[10px] font-bold text-white uppercase tracking-wider">Secured</span>
                </div>
              </div>
            </div>
            <div className="pt-4 border-t border-white/10 flex justify-between items-center">
               <p className="text-[10px] font-bold text-white/60 uppercase">Available Profit</p>
               <p className="text-sm font-black text-white">GHS {availableProfit.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Loyalty Card (Pro Design) */}
        <Card className="relative overflow-hidden border-white/10 bg-white/5 backdrop-blur-xl group">
          <div className="absolute -top-4 -right-4 w-24 h-24 bg-amber-400/10 rounded-full blur-2xl group-hover:bg-amber-400/20 transition-colors" />
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">SwiftPoints</p>
            <Gift className="w-4 h-4 text-amber-400" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-3xl font-black text-white">{loyaltyBalance.toLocaleString()} <span className="text-sm text-amber-400">pts</span></p>
              <p className="text-[10px] text-white/40 mt-1 font-medium uppercase tracking-widest">Est. Value: GHS {(loyaltyBalance / 100).toFixed(2)}</p>
            </div>
            <Button 
              variant="outline" 
              className="w-full h-11 bg-amber-400 text-black border-none font-black text-xs uppercase tracking-widest hover:bg-amber-300 shadow-lg shadow-amber-400/10 disabled:opacity-30 rounded-xl"
              onClick={handleConvertPoints} 
              disabled={convertingPoints || loyaltyBalance < 100}
            >
              {convertingPoints ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowRightLeft className="w-4 h-4 mr-2" />}
              Convert to Cash
            </Button>
          </CardContent>
        </Card>

        {/* Quick Topup (Pro Design) */}
        <Card className="border-white/10 bg-white/5 backdrop-blur-xl">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Quick Recharge</p>
            <Zap className="w-4 h-4 text-blue-400" />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative group">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-blue-400 transition-colors">
                <span className="text-xs font-bold">GHS</span>
              </div>
              <Input
                type="number"
                placeholder="0.00"
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                className="h-12 pl-12 bg-white/5 border-white/10 focus:border-blue-400/50 rounded-xl text-lg font-black text-white"
              />
            </div>
            <Button 
              onClick={handlePaystackTopup} 
              disabled={toppingUp} 
              className="w-full h-11 bg-blue-500 hover:bg-blue-600 text-white font-black text-xs uppercase tracking-widest rounded-xl shadow-lg shadow-blue-500/10"
            >
              {toppingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CreditCard className="w-4 h-4 mr-2" /> Recharge Now</>}
            </Button>
            {topupChargeTotal > 0 && (
              <div className="flex justify-between items-center px-1">
                <span className="text-[9px] text-white/20 font-bold uppercase tracking-wider">Fee Included</span>
                <span className="text-[10px] text-blue-400 font-black">Total: GHS {topupChargeTotal.toFixed(2)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        
        {/* ── Buy Data Section (Left) ── */}
        <div className="lg:col-span-3 space-y-6">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1 h-6 bg-amber-500 rounded-full" />
            <h2 className="text-lg font-black text-white uppercase tracking-wider">Purchase Service</h2>
          </div>
          
          <Card className="border-white/10 bg-white/3 overflow-hidden rounded-[2rem]">
            <CardContent className="p-8 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-white/40 px-1">Network</Label>
                  <Select value={selectedNetwork} onValueChange={(v) => { setSelectedNetwork(v); setSelectedPackage(""); }}>
                    <SelectTrigger className="h-12 bg-white/5 border-white/10 rounded-xl text-white">
                      <SelectValue placeholder="Select Network" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-white/10 text-white">
                      {networks.map((n) => (<SelectItem key={n.name} value={n.name}>{n.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-white/40 px-1">Package</Label>
                  <Select value={selectedPackage} onValueChange={setSelectedPackage} disabled={!selectedNetwork}>
                    <SelectTrigger className="h-12 bg-white/5 border-white/10 rounded-xl text-white">
                      <SelectValue placeholder="Choose Plan" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-white/10 text-white max-h-[300px]">
                      {agentPackages.map((p) => (
                        <SelectItem key={p.size} value={p.size} className="focus:bg-amber-400 focus:text-black">
                          {p.size} — GHS {p.price.toFixed(2)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-white/40 px-1">Recipient Number</Label>
                <div className="relative">
                  <Input 
                    placeholder="e.g. 024XXXXXXX" 
                    value={customerPhone} 
                    onChange={(e) => setCustomerPhone(e.target.value)} 
                    className="h-12 bg-white/5 border-white/10 rounded-xl pl-11 text-white font-mono" 
                  />
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20">
                    <CreditCard className="w-4 h-4" />
                  </div>
                </div>
              </div>

              {selectedPkg && (
                <div className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex justify-between items-center text-xs font-bold uppercase tracking-wider text-white/40">
                    <span>Selected Plan</span>
                    <span className="text-white">{selectedNetwork} {selectedPkg.size}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-black">
                    <span className="text-white/40 uppercase text-[10px] tracking-widest">Amount to Pay</span>
                    <span className="text-amber-400 text-lg">GHS {selectedPkg.price.toFixed(2)}</span>
                  </div>
                  <div className="pt-2 mt-2 border-t border-white/5 flex justify-between items-center text-[10px] font-medium text-white/20 italic">
                    <span>Balance after purchase</span>
                    <span>GHS {(balance - selectedPkg.price).toFixed(2)}</span>
                  </div>
                </div>
              )}

              <Button 
                onClick={handleBuyData} 
                disabled={buying || !selectedPkg || !customerPhone} 
                className="w-full h-14 rounded-2xl bg-amber-500 hover:bg-amber-400 text-black font-black text-base shadow-xl shadow-amber-500/10 group overflow-hidden relative"
              >
                {buying ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Send className="w-5 h-5 mr-2 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                    Buy with Wallet
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ── Recent Activity (Right) ── */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1 h-6 bg-blue-500 rounded-full" />
            <h2 className="text-lg font-black text-white uppercase tracking-wider">Recent Activity</h2>
          </div>

          <Card className="border-white/10 bg-white/3 overflow-hidden rounded-[2rem]">
            <CardContent className="p-6">
              {recentTopups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <History className="w-10 h-10 text-white/10 mb-4" />
                  <p className="text-xs font-bold text-white/20 uppercase tracking-widest">No activity yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {recentTopups.map((row) => (
                    <div 
                      key={row.id} 
                      className="group flex items-center justify-between p-4 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-all hover:scale-[1.02]"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${row.status === "fulfilled" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                          <PlusCircle className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-black text-white">GHS {Number(row.amount || 0).toFixed(2)}</p>
                          <p className="text-[10px] text-white/20 font-medium uppercase tracking-tight">
                            {new Date(row.created_at).toLocaleDateString("en-GH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                         <div className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${row.status === "fulfilled" ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-white/40"}`}>
                            {row.status === "fulfilled" ? "Verified" : row.status}
                         </div>
                         <ChevronRight className="w-4 h-4 text-white/10 group-hover:text-white/40 transition-colors" />
                      </div>
                    </div>
                  ))}
                  <Button variant="ghost" className="w-full h-10 text-[10px] font-black uppercase tracking-[0.2em] text-white/20 hover:text-white/60 hover:bg-transparent">
                     View All History
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Help Tip */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-6 flex gap-4">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
               <ArrowUpRight className="w-5 h-5 text-blue-400" />
            </div>
            <div className="space-y-1">
               <p className="text-xs font-black text-white uppercase tracking-wider">Pro Tip</p>
               <p className="text-[10px] text-white/40 leading-relaxed font-medium">
                 Use the wallet to bypass Paystack fees on every single purchase. Top up a large amount once and save on processing costs!
               </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardWallet;
