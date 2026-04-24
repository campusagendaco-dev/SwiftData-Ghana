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
import { Wallet, Loader2, Send, CreditCard } from "lucide-react";
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

  // Fetch global package settings (admin-set agent prices)
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

    // Sub-agents must use parent-assigned base prices.
    const assignedFromParent = getAssignedSubAgentPrice(parentAssignedPrices, network, size);
    const assignedFromProfile = getAssignedSubAgentPrice(
      profile?.agent_prices as Record<string, Record<string, string | number>> | undefined,
      network,
      size,
    );
    const assignedPrice = assignedFromParent || assignedFromProfile;
    if (assignedPrice && assignedPrice > 0) return applyPriceMultiplier(assignedPrice, priceMultiplier);

    // Admin-set package prices drive dashboard pricing by role.
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

    // Fallback to base price
    const basePkg = basePackages[network]?.find((p) => p.size === size);
    return basePkg ? applyPriceMultiplier(basePkg.price, priceMultiplier) : 0;
  };

  const fetchBalance = useCallback(async () => {
    if (!user) return;

    const [walletRes, ordersRes, parentProfitRes, withdrawalsRes] = await Promise.all([
      supabase.from("wallets").select("balance").eq("agent_id", user.id).maybeSingle(),
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

  // Check for returning from Paystack payment
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

  // Build packages list using agent prices
  const agentPackages = selectedNetwork
    ? (basePackages[selectedNetwork] || []).map((p) => ({
        ...p,
        price: getAgentPrice(selectedNetwork, p.size),
      }))
    : [];

  const selectedPkg = agentPackages.find((p) => p.size === selectedPackage);
  const totalFunds = parseFloat((balance + availableProfit).toFixed(2));
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

  if (loading) return <div className="text-muted-foreground p-8">Loading...</div>;

  return (
    <div className="space-y-6 p-6 md:p-8 max-w-4xl">
      <h1 className="font-display text-2xl font-black">Wallet</h1>
      <p className="text-sm text-muted-foreground -mt-3">
        Top up with Paystack instantly, then use your wallet balance to buy data directly from your dashboard.
      </p>

      {/* Balance + Paystack Topup */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-primary">Total Funds</CardTitle>
            <Wallet className="w-5 h-5 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="font-display text-3xl font-black text-primary">GHS {totalFunds.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-1">Wallet: GHS {balance.toFixed(2)}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={handleSyncPendingDeposits} disabled={syncingDeposits}>
              {syncingDeposits ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Verify Pending Deposit
            </Button>
          </CardContent>
        </Card>

        <Card className="border-accent/30 bg-accent/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-accent-foreground">Top Up with Paystack</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label htmlFor="topup-amount" className="text-xs text-muted-foreground">Wallet Credit Amount (GHS)</Label>
            <Input
              id="topup-amount"
              type="number"
              min="15"
              step="0.01"
              placeholder="e.g. 50"
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
              className="bg-secondary"
            />
            {topupChargeTotal > 0 && (
              <div className="rounded-lg border border-border/60 bg-background/60 p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Wallet Credit</span>
                  <span className="font-medium">GHS {topupRequestedAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paystack Fee (3%)</span>
                  <span className="font-medium">GHS {topupFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1">
                  <span className="text-muted-foreground font-medium">Total to Pay</span>
                  <span className="font-bold">GHS {topupChargeTotal.toFixed(2)}</span>
                </div>
              </div>
            )}
            <Button onClick={handlePaystackTopup} disabled={toppingUp} className="w-full gap-2">
              {toppingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              {toppingUp ? "Initializing..." : topupChargeTotal > 0 ? `Pay GHS ${topupChargeTotal.toFixed(2)}` : "Top Up Now"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Recent Deposits</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {recentTopups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deposit history yet.</p>
          ) : (
            <div className="space-y-2">
              {recentTopups.map((row) => (
                <div key={row.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">GHS {Number(row.amount || 0).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Ref: {row.id} • {new Date(row.created_at).toLocaleString()}</p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full bg-secondary text-foreground capitalize">{row.status}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Buy Data */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Buy Data</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Network</Label>
              <Select value={selectedNetwork} onValueChange={(v) => { setSelectedNetwork(v); setSelectedPackage(""); }}>
                <SelectTrigger className="bg-secondary mt-1"><SelectValue placeholder="Select network" /></SelectTrigger>
                <SelectContent>
                  {networks.map((n) => (<SelectItem key={n.name} value={n.name}>{n.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Package</Label>
              <Select value={selectedPackage} onValueChange={setSelectedPackage} disabled={!selectedNetwork}>
                <SelectTrigger className="bg-secondary mt-1"><SelectValue placeholder="Select package" /></SelectTrigger>
                <SelectContent>
                  {agentPackages.map((p) => (
                    <SelectItem key={p.size} value={p.size}>{p.size} - GHS {p.price.toFixed(2)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Recipient Phone Number</Label>
            <Input placeholder="e.g. 0241234567" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="bg-secondary mt-1" />
          </div>

          {selectedPkg && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Package</span><span className="font-medium">{selectedNetwork} {selectedPkg.size}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Agent Price</span><span className="font-medium">GHS {selectedPkg.price.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Balance After</span><span className="font-medium">GHS {(balance - selectedPkg.price).toFixed(2)}</span></div>
            </div>
          )}

          <Button onClick={handleBuyData} disabled={buying || !selectedPkg || !customerPhone} className="w-full gap-2">
            {buying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {`Buy with Wallet (GHS ${selectedPkg?.price.toFixed(2) || "0.00"})`}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default DashboardWallet;
