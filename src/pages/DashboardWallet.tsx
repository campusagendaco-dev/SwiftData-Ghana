import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wallet, Loader2, Send, Copy, Check, Smartphone } from "lucide-react";
import { basePackages, networks } from "@/lib/data";

const DashboardWallet = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [balance, setBalance] = useState(0);
  const [availableProfit, setAvailableProfit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  const [toppingUp, setToppingUp] = useState(false);

  // Buy data form
  const [selectedNetwork, setSelectedNetwork] = useState("");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"wallet" | "paystack">("wallet");
  const [buying, setBuying] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!user) return;

    const [walletRes, ordersRes, withdrawalsRes] = await Promise.all([
      supabase
        .from("wallets")
        .select("balance")
        .eq("agent_id", user.id)
        .maybeSingle(),
      supabase
        .from("orders")
        .select("profit")
        .eq("agent_id", user.id)
        .in("status", ["paid", "fulfilled", "fulfillment_failed"]),
      supabase
        .from("withdrawals")
        .select("amount, status")
        .eq("agent_id", user.id)
        .in("status", ["completed", "pending", "processing"]),
    ]);

    const walletBalance = walletRes.data?.balance || 0;
    const totalProfit = (ordersRes.data || []).reduce((sum, row: any) => sum + Number(row.profit || 0), 0);
    const withdrawnProfit = (withdrawalsRes.data || []).reduce((sum, row: any) => sum + Number(row.amount || 0), 0);
    const profitBalance = parseFloat((totalProfit - withdrawnProfit).toFixed(2));

    setBalance(walletBalance);
    setAvailableProfit(Math.max(0, profitBalance));
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchBalance(); }, [fetchBalance]);

  // Check for returning from Paystack payment
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    if (reference) {
      supabase.functions.invoke("verify-payment", { body: { reference } }).then(async (res) => {
        const status = res.data?.status;
        if (status === "fulfilled") {
          toast({ title: "Wallet topped up successfully!" });
        } else {
          toast({ title: "Payment processing", description: "Your deposit is being processed. Balance will update shortly." });
        }
        await fetchBalance();
        let retries = 3;
        const poll = setInterval(async () => {
          await fetchBalance();
          retries--;
          if (retries <= 0) clearInterval(poll);
        }, 3000);
        window.history.replaceState({}, "", window.location.pathname);
      }).catch(async () => {
        toast({ title: "Verification in progress", description: "Your payment is being verified.", variant: "destructive" });
        await fetchBalance();
        window.history.replaceState({}, "", window.location.pathname);
      });
    }
  }, [fetchBalance, toast]);

  const topupReference = (profile as any)?.topup_reference || "------";

  const copyReference = () => {
    navigator.clipboard.writeText(topupReference);
    setCopied(true);
    toast({ title: "Reference copied!" });
    setTimeout(() => setCopied(false), 2000);
  };

  const packages = selectedNetwork ? basePackages[selectedNetwork] || [] : [];
  const selectedPkg = packages.find((p) => p.size === selectedPackage);
  const totalFunds = parseFloat((balance + availableProfit).toFixed(2));

  const paystackFee = (() => {
    if (!selectedPkg || paymentMethod !== "paystack") return 0;
    const fee = Math.round(selectedPkg.price * 0.0195 * 100) / 100;
    return Math.min(fee, 100);
  })();

  const totalPaystack = selectedPkg ? Math.round((selectedPkg.price + paystackFee) * 100) / 100 : 0;

  const handlePaystackTopup = async () => {
    const amount = parseFloat(topupAmount);
    if (isNaN(amount) || amount < 1) {
      toast({ title: "Enter a valid top-up amount", description: "Minimum is GHS 1.00", variant: "destructive" });
      return;
    }

    setToppingUp(true);
    const { data, error } = await supabase.functions.invoke("wallet-topup", {
      body: {
        amount,
        callback_url: `${window.location.origin}/dashboard/wallet`,
      },
    });

    if (error || data?.error || !data?.authorization_url) {
      toast({
        title: "Top-up failed",
        description: data?.error || error?.message || "Could not initialize Paystack payment.",
        variant: "destructive",
      });
      setToppingUp(false);
      return;
    }

    window.location.href = data.authorization_url;
  };

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
        toast({ title: "Purchase failed", description: data?.error || error?.message, variant: "destructive" });
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
      // Paystack payment
      setBuying(true);
      const orderId = crypto.randomUUID();
      const { error: insertError } = await supabase.from("orders").insert({
        id: orderId,
        agent_id: user!.id,
        order_type: "data",
        customer_phone: customerPhone.replace(/\s/g, ""),
        network: selectedNetwork,
        package_size: selectedPackage,
        amount: totalPaystack,
        profit: 0,
      });

      if (insertError) {
        toast({ title: "Order failed", description: insertError.message, variant: "destructive" });
        setBuying(false);
        return;
      }

      const { data: paymentData, error: paymentError } = await supabase.functions.invoke("initialize-payment", {
        body: {
          email: profile?.email || `${user!.id}@agent.quickdata.gh`,
          amount: totalPaystack,
          reference: orderId,
          callback_url: `${window.location.origin}/dashboard/wallet`,
          metadata: {
            order_id: orderId,
            order_type: "data",
            network: selectedNetwork,
            package_size: selectedPackage,
            customer_phone: customerPhone.replace(/\s/g, ""),
            fee: paystackFee,
            agent_id: user!.id,
            base_price: selectedPkg.price,
            payment_source: "dashboard_wallet",
            deduct_agent_wallet: false,
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

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6 p-6 md:p-8 max-w-4xl">
      <h1 className="font-display text-2xl font-bold">Wallet</h1>

      {/* Balance + Topup Reference */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-primary">Total Funds</CardTitle>
            <Wallet className="w-5 h-5 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="font-display text-3xl font-bold text-primary">GHS {totalFunds.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Wallet: GHS {balance.toFixed(2)} + Profit: GHS {availableProfit.toFixed(2)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-accent/30 bg-accent/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-accent-foreground">Topup Reference</CardTitle>
            <button onClick={copyReference} className="p-1 rounded hover:bg-secondary transition-colors">
              {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
            </button>
          </CardHeader>
          <CardContent>
            <p className="font-display text-3xl font-bold tracking-[0.3em] text-foreground">{topupReference}</p>
            <p className="text-xs text-muted-foreground mt-1">Use this code as payment reference when sending MoMo</p>
          </CardContent>
        </Card>
      </div>

      {/* MoMo Top Up Instructions */}
      <Card className="border-yellow-500/30 bg-yellow-500/5">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-yellow-600" />
            How to Top Up Your Wallet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Send your desired top-up amount via Mobile Money to the number below. 
            <strong className="text-foreground"> Use your Topup Reference ({topupReference}) as the payment reference.</strong>
          </p>
          <div className="bg-card border border-border rounded-xl p-4 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">MoMo Number</span>
              <span className="font-bold text-foreground text-lg">0547116139</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Account Name</span>
              <span className="font-semibold text-foreground">SAMUEL OWUSU BENSARFO KOFI</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Network</span>
              <span className="font-semibold text-yellow-600">MTN</span>
            </div>
          </div>
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
            <p className="text-xs text-destructive font-medium">
              Warning: Always include your Topup Reference <strong>({topupReference})</strong> as the payment reference.
              After sending, the admin will verify and credit your wallet.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Paystack Top Up */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Instant Wallet Top-Up (Paystack)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Top-up Amount (GHS)</Label>
            <Input
              type="number"
              min="1"
              step="0.01"
              placeholder="e.g. 50.00"
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
              className="bg-secondary mt-1 max-w-xs"
            />
          </div>
          <Button onClick={handlePaystackTopup} disabled={toppingUp || !topupAmount} className="gap-2">
            {toppingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Top Up with Paystack
          </Button>
          <p className="text-xs text-muted-foreground">
            You will be redirected to Paystack. Wallet will be credited automatically after successful payment.
          </p>
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
                  {networks.map((n) => (
                    <SelectItem key={n.name} value={n.name}>{n.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Package</Label>
              <Select value={selectedPackage} onValueChange={setSelectedPackage} disabled={!selectedNetwork}>
                <SelectTrigger className="bg-secondary mt-1"><SelectValue placeholder="Select package" /></SelectTrigger>
                <SelectContent>
                  {packages.map((p) => (
                    <SelectItem key={p.size} value={p.size}>{p.size} - GHS {p.price.toFixed(2)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Recipient Phone Number</Label>
            <Input
              placeholder="e.g. 0241234567" value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              className="bg-secondary mt-1"
            />
          </div>

          <div>
            <Label>Payment Method</Label>
            <div className="flex gap-3 mt-1">
              <button
                onClick={() => setPaymentMethod("wallet")}
                className={`flex-1 py-3 px-4 rounded-lg border text-sm font-medium transition-colors ${
                  paymentMethod === "wallet"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                <Wallet className="w-4 h-4 inline mr-2" />
                Wallet (GHS {balance.toFixed(2)})
              </button>
              <button
                onClick={() => setPaymentMethod("paystack")}
                className={`flex-1 py-3 px-4 rounded-lg border text-sm font-medium transition-colors ${
                  paymentMethod === "paystack"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                Paystack
              </button>
            </div>
          </div>

          {selectedPkg && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Package</span><span className="font-medium">{selectedNetwork} {selectedPkg.size}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Cost</span><span className="font-medium">GHS {selectedPkg.price.toFixed(2)}</span></div>
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

          <Button
            onClick={handleBuyData} disabled={buying || !selectedPkg || !customerPhone}
            className="w-full gap-2"
          >
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

