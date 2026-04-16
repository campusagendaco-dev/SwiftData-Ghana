import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { fetchApiPricingContext, applyPriceMultiplier } from "@/lib/api-source-pricing";
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

const DashboardWallet = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [balance, setBalance] = useState(0);
  const [availableProfit, setAvailableProfit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [globalSettings, setGlobalSettings] = useState<GlobalPackageSetting[]>([]);
  const [priceMultiplier, setPriceMultiplier] = useState(1);

  // Buy data form
  const [selectedNetwork, setSelectedNetwork] = useState("");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"wallet" | "paystack">("wallet");
  const [buying, setBuying] = useState(false);
  const [syncingDeposits, setSyncingDeposits] = useState(false);
  const [recentTopups, setRecentTopups] = useState<WalletTopupRow[]>([]);
  const [topupAmount, setTopupAmount] = useState("");
  const [toppingUp, setToppingUp] = useState(false);

  const verifyHeaders = () => {
    const anonKey = (supabase as any)?.supabaseKey as string | undefined;
    return anonKey ? { Authorization: `Bearer ${anonKey}` } : undefined;
  };

  // Fetch global package settings (admin-set agent prices)
  useEffect(() => {
    supabase.from("global_package_settings").select("*").then(({ data }) => {
      if (data) setGlobalSettings(data as GlobalPackageSetting[]);
    });
    fetchApiPricingContext().then((ctx) => setPriceMultiplier(ctx.multiplier));
  }, []);

  const getAgentPrice = (network: string, size: string): number => {
    // First check admin-set agent price from global_package_settings
    const setting = globalSettings.find(
      (s) => s.network === network && s.package_size === size.replace(/\s+/g, "").toUpperCase()
    );
    if (setting?.agent_price && setting.agent_price > 0) return applyPriceMultiplier(setting.agent_price, priceMultiplier);
    // Fallback to base price
    const basePkg = basePackages[network]?.find((p) => p.size === size);
    return basePkg ? applyPriceMultiplier(basePkg.price, priceMultiplier) : 0;
  };

  const fetchBalance = useCallback(async () => {
    if (!user) return;

    const [walletRes, ordersRes, withdrawalsRes] = await Promise.all([
      supabase.from("wallets").select("balance").eq("agent_id", user.id).maybeSingle(),
      supabase.from("orders").select("profit").eq("agent_id", user.id).in("status", ["paid", "fulfilled", "fulfillment_failed"]),
      supabase.from("withdrawals").select("amount, status").eq("agent_id", user.id).in("status", ["completed", "pending", "processing"]),
    ]);

    const walletBalance = walletRes.data?.balance || 0;
    const totalProfit = (ordersRes.data || []).reduce((sum, row: any) => sum + Number(row.profit || 0), 0);
    const withdrawnProfit = (withdrawalsRes.data || []).reduce((sum, row: any) => sum + Number(row.amount || 0), 0);
    const profitBalance = parseFloat((totalProfit - withdrawnProfit).toFixed(2));

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
      supabase.functions.invoke("verify-payment", { body: { reference }, headers: verifyHeaders() }).then(async (res) => {
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
    const amount = Number(topupAmount);
    if (!Number.isFinite(amount) || amount < 1) {
      toast({ title: "Enter a valid top-up amount (minimum GHS 1)", variant: "destructive" });
      return;
    }

    setToppingUp(true);
    const { data, error } = await supabase.functions.invoke("wallet-topup", {
      body: {
        amount,
        wallet_credit: amount,
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

  const paystackFee = (() => {
    if (!selectedPkg || paymentMethod !== "paystack") return 0;
    const fee = Math.round(selectedPkg.price * 0.0195 * 100) / 100;
    return Math.min(fee, 100);
  })();

  const totalPaystack = selectedPkg ? Math.round((selectedPkg.price + paystackFee) * 100) / 100 : 0;

  const handleBuyData = async () => {
    if (!selectedNetwork || !selectedPackage || !customerPhone || !selectedPkg) {
      toast({ title: "Fill in all fields", variant: "destructive" });
      return;
    }

    if (paymentMethod === "wallet") {
      if (balance < selectedPkg.price) {
        toast({ title: "Insufficient wallet balance", variant: "destructive" });
        return;
      }
      setBuying(true);
      const { data, error } = await supabase.functions.invoke("wallet-buy-data", {
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
        setCustomerPhone("");
        setSelectedPackage("");
      } else {
        toast({ title: "Order placed", description: data?.failure_reason || "Fulfillment pending", variant: "destructive" });
      }
      await fetchBalance();
      setBuying(false);
    } else {
      setBuying(true);
      const orderId = crypto.randomUUID();

      // Order is created server-side by initialize-payment

      const { data: paymentData, error: paymentError } = await supabase.functions.invoke("initialize-payment", {
        body: {
          email: profile?.email || `${user!.id}@agent.swiftdata.gh`,
          amount: totalPaystack,
          reference: orderId,
          callback_url: `${getAppBaseUrl()}/dashboard/wallet`,
          metadata: {
            order_id: orderId, order_type: "data", network: selectedNetwork, package_size: selectedPackage,
            customer_phone: customerPhone.replace(/\s/g, ""), fee: paystackFee, agent_id: user!.id,
            base_price: selectedPkg.price, payment_source: "dashboard_wallet", deduct_agent_wallet: false,
          },
        },
      });

      if (paymentError || !paymentData?.authorization_url) {
        const description = paymentData?.error || await getFunctionErrorMessage(paymentError, "Could not initialize payment.");
        toast({ title: "Payment failed", description, variant: "destructive" });
        setBuying(false);
        return;
      }

      window.location.href = paymentData.authorization_url;
    }
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
        pendingRows.map((row) => supabase.functions.invoke("verify-payment", { body: { reference: row.id }, headers: verifyHeaders() })),
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
      <h1 className="font-display text-2xl font-black">Reseller Wallet</h1>
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
            <p className="text-xs text-muted-foreground mt-1">
              Wallet: GHS {balance.toFixed(2)} + Profit: GHS {availableProfit.toFixed(2)}
            </p>
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
            <Label htmlFor="topup-amount" className="text-xs text-muted-foreground">Amount (GHS)</Label>
            <Input
              id="topup-amount"
              type="number"
              min="1"
              step="0.01"
              placeholder="e.g. 50"
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
              className="bg-secondary"
            />
            <Button onClick={handlePaystackTopup} disabled={toppingUp} className="w-full gap-2">
              {toppingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              {toppingUp ? "Initializing..." : "Top Up Now"}
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

          <div>
            <Label>Payment Method</Label>
            <div className="flex gap-3 mt-1">
              <button onClick={() => setPaymentMethod("wallet")} className={`flex-1 py-3 px-4 rounded-lg border text-sm font-medium transition-colors ${paymentMethod === "wallet" ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-muted-foreground hover:text-foreground"}`}>
                <Wallet className="w-4 h-4 inline mr-2" />Wallet (GHS {balance.toFixed(2)})
              </button>
              <button onClick={() => setPaymentMethod("paystack")} className={`flex-1 py-3 px-4 rounded-lg border text-sm font-medium transition-colors ${paymentMethod === "paystack" ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-muted-foreground hover:text-foreground"}`}>
                Paystack
              </button>
            </div>
          </div>

          {selectedPkg && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Package</span><span className="font-medium">{selectedNetwork} {selectedPkg.size}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Agent Price</span><span className="font-medium">GHS {selectedPkg.price.toFixed(2)}</span></div>
              {paymentMethod === "paystack" && (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">Paystack Fee (1.95%)</span><span className="font-medium">GHS {paystackFee.toFixed(2)}</span></div>
                  <div className="flex justify-between border-t pt-1"><span className="text-muted-foreground font-medium">Total</span><span className="font-bold">GHS {totalPaystack.toFixed(2)}</span></div>
                </>
              )}
              {paymentMethod === "wallet" && (
                <div className="flex justify-between"><span className="text-muted-foreground">Balance After</span><span className="font-medium">GHS {(balance - selectedPkg.price).toFixed(2)}</span></div>
              )}
            </div>
          )}

          <Button onClick={handleBuyData} disabled={buying || !selectedPkg || !customerPhone} className="w-full gap-2">
            {buying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {paymentMethod === "wallet"
              ? `Buy with Wallet (GHS ${selectedPkg?.price.toFixed(2) || "0.00"})`
              : `Pay with Paystack (GHS ${totalPaystack.toFixed(2)})`
            }
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default DashboardWallet;
