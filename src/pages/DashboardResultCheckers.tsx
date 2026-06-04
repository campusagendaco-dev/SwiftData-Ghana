import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  GraduationCap, Loader2, ShieldCheck,
  CreditCard, Wallet, ChevronRight, RotateCcw,
  CheckCircle2, Hash, Smartphone, Copy,
  AlertTriangle, FlaskConical, ClipboardList,
  Clock, CopyCheck, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnectivity } from "@/hooks/useConnectivity";
import { WifiOff } from "lucide-react";
import { playSuccessSound } from "@/lib/sound";

type VoucherType = "WASSCE" | "BECE";

const DEFAULT_VOUCHERS = [
  { id: "WASSCE" as VoucherType, label: "WAEC / WASSCE", price: 18.00, description: "Valid for checking WASSCE Results" },
  { id: "BECE" as VoucherType,   label: "BECE Result",    price: 15.00, description: "Valid for checking BECE Results" },
];

const DashboardResultCheckers = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { isOnline } = useConnectivity();

  const [vouchers, setVouchers] = useState(DEFAULT_VOUCHERS);
  const [pricesLoading, setPricesLoading] = useState(true);
  const [voucherType, setVoucherType] = useState<VoucherType | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [recipient, setRecipient] = useState("");
  const [loading, setLoading] = useState(false);
  const [successData, setSuccessData] = useState<any | null>(null);

  // New state for UI improvements
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [copiedAll, setCopiedAll] = useState(false);

  // Fetch live prices from system settings
  useEffect(() => {
    supabase
      .from("public_system_settings")
      .select("wassce_price, bece_price")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setVouchers([
            { id: "WASSCE", label: "WAEC / WASSCE", price: Number(data.wassce_price || 18.00), description: "Valid for checking WASSCE Results" },
            { id: "BECE",   label: "BECE Result",    price: Number(data.bece_price || 15.00), description: "Valid for checking BECE Results" },
          ]);
        }
      })
      .finally(() => setPricesLoading(false));
  }, []);

  // Fetch wallet balance
  const fetchWalletBalance = useCallback(async () => {
    if (!user?.id) return;
    setWalletLoading(true);
    const { data } = await supabase
      .from("wallets")
      .select("balance")
      .eq("agent_id", user.id)
      .maybeSingle();
    setWalletBalance(data?.balance ?? null);
    setWalletLoading(false);
  }, [user?.id]);

  useEffect(() => {
    fetchWalletBalance();
  }, [fetchWalletBalance]);

  // Fetch recent voucher orders
  const fetchRecentOrders = useCallback(async () => {
    if (!user?.id) return;
    setOrdersLoading(true);
    const { data } = await supabase
      .from("orders")
      .select("id, package_size, amount, status, created_at, metadata, customer_phone")
      .eq("agent_id", user.id)
      .eq("network", "VOUCHER")
      .order("created_at", { ascending: false })
      .limit(5);
    setRecentOrders(data || []);
    setOrdersLoading(false);
  }, [user?.id]);

  useEffect(() => {
    fetchRecentOrders();
  }, [fetchRecentOrders]);

  const reset = () => {
    setVoucherType(null);
    setQuantity("1");
    setRecipient("");
    setSuccessData(null);
    setErrorMessage(null);
    setCopiedAll(false);
  };

  const handlePurchase = async () => {
    setErrorMessage(null);

    if (!voucherType) {
      toast({ title: "Select a checker type", variant: "destructive" });
      return;
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty < 1 || qty > 100) {
      toast({ title: "Invalid Quantity", description: "Enter a value between 1 and 100", variant: "destructive" });
      return;
    }

    const digits = recipient.replace(/\D/g, "");
    if (digits.length !== 10 || !digits.startsWith("0")) {
      toast({ title: "Invalid Recipient", description: "Please enter a valid 10-digit number starting with 0", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("voucher-purchase", {
        body: {
          VoucherType: voucherType,
          Recipient: digits,
          Quantity: qty,
        }
      });

      if (error || !data?.success) {
        const msg = data?.error || error?.message || "Insufficient balance or provider error.";
        setErrorMessage(msg);
        toast({ 
          title: "Purchase Failed", 
          description: msg, 
          variant: "destructive" 
        });
      } else {
        playSuccessSound();
        toast({ title: "Purchase Successful!", description: `Vouchers delivered to ${digits}` });
        setSuccessData(data);
        // Refresh wallet balance and order history after successful purchase
        fetchWalletBalance();
        fetchRecentOrders();
      }
    } catch (err: any) {
      const msg = err.message || "Network error occurred.";
      setErrorMessage(msg);
      toast({ title: "Network Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const activePrice = voucherType ? vouchers.find(v => v.id === voucherType)?.price || 0 : 0;
  const qtyNum = parseInt(quantity, 10) || 0;
  const totalCost = activePrice * qtyNum;
  const insufficientBalance = walletBalance !== null && totalCost > 0 && totalCost > walletBalance;
  const canSubmit = voucherType && qtyNum > 0 && recipient.replace(/\D/g, "").length === 10 && isOnline && !insufficientBalance;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to Clipboard" });
  };

  const copyAllVouchers = () => {
    if (!successData?.vouchers?.length) return;
    const allText = successData.vouchers
      .map((v: any, i: number) => `${i + 1}. Serial: ${v.serial}  |  PIN: ${v.pin}`)
      .join("\n");
    navigator.clipboard.writeText(allText);
    setCopiedAll(true);
    toast({ title: "All Pins Copied!" });
    setTimeout(() => setCopiedAll(false), 2500);
  };

  // Detect if the purchase was made in test mode
  const isTestModePurchase = successData?.vouchers?.[0]?.serial?.startsWith("TST-");

  // SUCCESS STATE SCREEN
  if (successData) {
    return (
      <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-8 animate-in zoom-in-95 duration-300">
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>
          <h1 className="font-black text-3xl tracking-tight text-foreground">Order Completed!</h1>

          {/* Test Mode Badge */}
          {isTestModePurchase && (
            <div className="inline-flex items-center gap-1.5 bg-violet-500/15 text-violet-400 px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-widest border border-violet-500/20 mx-auto">
              <FlaskConical className="w-3.5 h-3.5" />
              Test Mode — Not a real purchase
            </div>
          )}

          <p className="text-muted-foreground max-w-md mx-auto">
            Your result checker pins have been generated successfully and delivered to the recipient.
          </p>
        </div>

        <div className="bg-card border border-border rounded-3xl overflow-hidden shadow-xl">
          <div className="bg-emerald-500/10 border-b border-border p-5 flex justify-between items-center">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-emerald-500/70">Voucher Type</p>
              <p className="font-black text-foreground">{voucherType} Checker (x{qtyNum})</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-black uppercase tracking-widest text-emerald-500/70">
                {isTestModePurchase ? "Simulated Cost" : "Total Deducted"}
              </p>
              <p className="font-black text-foreground text-lg">₵{totalCost.toFixed(2)}</p>
            </div>
          </div>

          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-sm uppercase tracking-wider text-muted-foreground/60">Generated Pins</h3>
              
              {/* Copy All Button */}
              {Array.isArray(successData.vouchers) && successData.vouchers.length > 1 && (
                <button
                  onClick={copyAllVouchers}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all border",
                    copiedAll
                      ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/20"
                      : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/30"
                  )}
                >
                  {copiedAll ? <CopyCheck className="w-3.5 h-3.5" /> : <ClipboardList className="w-3.5 h-3.5" />}
                  {copiedAll ? "Copied!" : "Copy All"}
                </button>
              )}
            </div>

            {Array.isArray(successData.vouchers) && successData.vouchers.length > 0 ? (
              <div className="grid gap-3">
                {successData.vouchers.map((v: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-secondary/40 border border-border group hover:border-emerald-500/30 transition-all">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase">SERIAL / PIN</p>
                      <p className="font-mono font-black text-foreground tracking-wider text-sm md:text-base">
                        {v.serial} <span className="text-muted-foreground mx-1.5">|</span> {v.pin}
                      </p>
                    </div>
                    <button 
                      onClick={() => copyToClipboard(`${v.serial} | ${v.pin}`)}
                      className="p-2 rounded-lg bg-card border border-border opacity-60 group-hover:opacity-100 hover:bg-secondary transition-all"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
                <p className="text-amber-600 font-bold text-sm">Vouchers were generated successfully and will be accessible via text shortly.</p>
              </div>
            )}
          </div>
        </div>

        <button 
          onClick={reset}
          className="w-full h-14 bg-primary text-primary-foreground font-black rounded-2xl hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
        >
          Buy More Pins
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl space-y-8 animate-in fade-in duration-500">
      
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 bg-amber-400/15 text-amber-500 px-3 py-1 rounded-full text-xs font-black mb-2 uppercase tracking-widest border border-amber-400/20">
          <GraduationCap className="w-3.5 h-3.5" />
          Instant Delivery
        </div>
        <h1 className="font-black text-3xl tracking-tight text-foreground mb-1">Result Checkers</h1>
        <p className="text-muted-foreground text-sm">Buy WAEC and BECE Result Checker pins directly from your wallet.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        {/* Procurement Card */}
        <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 md:p-8 space-y-7">
          
          {/* 1. Select Type */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-3 flex items-center">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black mr-2">1</span>
              Select Checker Type
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {vouchers.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVoucherType(v.id)}
                  className={cn(
                    "relative flex items-start gap-3.5 p-4 rounded-2xl border text-left transition-all hover:scale-[1.01]",
                    voucherType === v.id
                      ? "border-primary/50 bg-primary/10 text-foreground shadow-md shadow-primary/10"
                      : "border-border bg-card/40 text-muted-foreground hover:text-foreground hover:border-border/80"
                  )}
                >
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", voucherType === v.id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-black text-sm leading-tight mb-0.5">{v.label}</p>
                    <p className="text-[10px] font-medium opacity-70 mb-1.5">{v.description}</p>
                    {pricesLoading ? (
                      <span className="inline-block w-16 h-5 rounded-md bg-secondary animate-pulse" />
                    ) : (
                      <span className="inline-flex items-center bg-card border px-2 py-0.5 rounded-md font-black text-xs text-foreground">₵{v.price.toFixed(2)}</span>
                    )}
                  </div>
                  {voucherType === v.id && (
                    <CheckCircle2 className="w-4 h-4 text-primary absolute top-3 right-3" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* 2. Recipient */}
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-3 flex items-center">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black mr-2">2</span>
                Recipient Number
              </p>
              <div className="relative">
                <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
                <input
                  type="tel"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="e.g. 0541234567"
                  className="w-full h-12 pl-11 pr-4 bg-secondary/60 border border-border rounded-2xl text-sm font-black focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
            </div>

            {/* 3. Quantity */}
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-3 flex items-center">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black mr-2">3</span>
                Quantity
              </p>
              <div className="relative">
                <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full h-12 pl-11 pr-4 bg-secondary/60 border border-border rounded-2xl text-sm font-black focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Inline Error Banner */}
          {errorMessage && (
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="w-8 h-8 bg-red-500/15 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <XCircle className="w-4 h-4 text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm text-red-500 mb-0.5">Purchase Failed</p>
                <p className="text-xs text-red-400/80 leading-relaxed">{errorMessage}</p>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-red-400/60 hover:text-red-400 transition-colors p-1 shrink-0"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Insufficient Balance Warning */}
          {insufficientBalance && (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 animate-in fade-in duration-300">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <p className="text-xs text-amber-500 font-bold">
                Insufficient balance. You need ₵{(totalCost - (walletBalance || 0)).toFixed(2)} more. Please top up your wallet.
              </p>
            </div>
          )}

          {/* Action Button */}
          <button
            onClick={handlePurchase}
            disabled={loading || !canSubmit}
            className="w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground font-black text-base transition-all shadow-xl shadow-primary/25 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Authorizing Purchase...
              </>
            ) : !isOnline ? (
              <>
                <WifiOff className="w-5 h-5" />
                Waiting for Internet...
              </>
            ) : insufficientBalance ? (
              <>
                <AlertTriangle className="w-5 h-5" />
                Insufficient Balance
              </>
            ) : (
              <>
                <Wallet className="w-5 h-5" />
                Pay From Wallet
              </>
            )}
          </button>

        </div>

        {/* Summary Panel */}
        <div className="space-y-5">
          <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 space-y-4 shadow-sm">
            <h3 className="font-black text-foreground text-base">Payment Summary</h3>
            
            <div className="space-y-3.5 text-sm">
              <SummaryRow label="Service" value="Result Checker" />
              <SummaryRow label="Type" value={voucherType || "—"} />
              <SummaryRow label="Unit Price" value={voucherType ? `₵${activePrice.toFixed(2)}` : "—"} />
              <SummaryRow label="Quantity" value={`x${qtyNum}`} />
              
              <div className="pt-3 border-t border-border flex items-center justify-between">
                <span className="text-muted-foreground font-medium">Total Cost</span>
                <span className="font-black text-foreground text-xl">
                  ₵{totalCost.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Wallet Balance Card */}
          <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center shrink-0">
                <Wallet className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">Available Balance</p>
                {walletLoading ? (
                  <span className="inline-block w-20 h-5 rounded bg-secondary animate-pulse mt-0.5" />
                ) : (
                  <p className={cn(
                    "font-black text-base",
                    insufficientBalance ? "text-red-500" : "text-foreground"
                  )}>
                    ₵{(walletBalance ?? 0).toFixed(2)}
                  </p>
                )}
              </div>
            </div>
            {totalCost > 0 && walletBalance !== null && !walletLoading && (
              <div className="text-right">
                <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">After Purchase</p>
                <p className={cn(
                  "font-black text-sm",
                  insufficientBalance ? "text-red-500" : "text-emerald-500"
                )}>
                  {insufficientBalance ? "—" : `₵${(walletBalance - totalCost).toFixed(2)}`}
                </p>
              </div>
            )}
          </div>

          {/* Trust Banner */}
          <div className="bg-card/40 border border-border rounded-2xl p-4 flex items-center gap-3">
            <div className="w-8 h-8 bg-primary/10 text-primary rounded-full flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-black text-foreground">Secured Purchase</p>
              <p className="text-[10px] text-muted-foreground">Deducted directly from your main balance.</p>
            </div>
          </div>

          <button
            onClick={reset}
            className="w-full flex items-center justify-center gap-2 text-muted-foreground text-xs font-bold hover:text-foreground transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear Fields
          </button>
        </div>
      </div>

      {/* Recent Purchase History */}
      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-foreground text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            Recent Purchases
          </h3>
          <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">Last 5</span>
        </div>

        {ordersLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-2xl bg-secondary/30 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-secondary" />
                <div className="flex-1 space-y-2">
                  <div className="w-32 h-3.5 rounded bg-secondary" />
                  <div className="w-24 h-3 rounded bg-secondary" />
                </div>
                <div className="w-16 h-5 rounded bg-secondary" />
              </div>
            ))}
          </div>
        ) : recentOrders.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-12 h-12 bg-secondary/50 rounded-full flex items-center justify-center mx-auto mb-3">
              <GraduationCap className="w-6 h-6 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-bold text-muted-foreground/60">No voucher purchases yet</p>
            <p className="text-xs text-muted-foreground/40 mt-1">Your purchase history will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentOrders.map((order) => {
              const isTest = order.metadata?.test_mode === true;
              const vouchersList = order.metadata?.vouchers || [];
              const orderDate = new Date(order.created_at);
              const timeAgo = getTimeAgo(orderDate);

              return (
                <div key={order.id} className="flex items-center gap-4 p-4 rounded-2xl bg-secondary/20 border border-border/50 hover:border-border transition-all group">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                    order.status === "fulfilled" ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"
                  )}>
                    {order.status === "fulfilled" ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : (
                      <Clock className="w-5 h-5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-black text-sm text-foreground truncate">{order.package_size}</p>
                      {isTest && (
                        <span className="inline-flex items-center gap-1 bg-violet-500/15 text-violet-400 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border border-violet-500/20 shrink-0">
                          <FlaskConical className="w-2.5 h-2.5" />
                          Test
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {order.customer_phone} · {timeAgo}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-black text-sm text-foreground">₵{Number(order.amount).toFixed(2)}</p>
                    <p className={cn(
                      "text-[10px] font-bold uppercase tracking-wider",
                      order.status === "fulfilled" ? "text-emerald-500" : "text-amber-500"
                    )}>
                      {order.status}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-bold text-foreground text-right">{value}</span>
  </div>
);

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default DashboardResultCheckers;
