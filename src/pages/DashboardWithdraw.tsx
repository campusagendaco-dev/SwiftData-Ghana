import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { getFunctionErrorMessage } from "@/lib/function-errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Wallet, ArrowDownToLine, Loader2, CheckCircle, XCircle, Clock, TrendingUp,
  ShieldCheck, User, Phone, Activity, RefreshCw, Fingerprint, Lock, Key
} from "lucide-react";
import { useWebAuthn } from "@/hooks/useWebAuthn";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Withdrawal {
  id: string;
  amount: number;
  status: string;
  failure_reason: string | null;
  created_at: string;
  fee: number;
  net_amount: number;
}

const WITHDRAWAL_FEE_FLAT = 1.00;
const WITHDRAWAL_FEE_PERCENT = 0.01; // 1%

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  completed: { icon: CheckCircle, color: "bg-green-500/20 text-green-400 border-green-500/30", label: "Completed" },
  pending: { icon: Clock, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", label: "Pending" },
  processing: { icon: Loader2, color: "bg-blue-500/20 text-blue-400 border-blue-500/30", label: "Processing" },
  failed: { icon: XCircle, color: "bg-red-500/20 text-red-400 border-red-500/30", label: "Failed" },
};

const DashboardWithdraw = () => {
  const { user, profile } = useAuth();
  const [totalProfit, setTotalProfit] = useState(0);
  const [completedWithdrawals, setCompletedWithdrawals] = useState(0);
  const [pendingWithdrawals, setPendingWithdrawals] = useState(0);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [enteredPin, setEnteredPin] = useState("");
  const [biometricScanning, setBiometricScanning] = useState(false);
  const [minWithdrawal, setMinWithdrawal] = useState(25);
  const [maxWithdrawal, setMaxWithdrawal] = useState(5000);
  const [systemEnabled, setSystemEnabled] = useState(true);
  const [walletBalance, setWalletBalance] = useState(0);

  const { isSupported, credentials, authenticate } = useWebAuthn();
  const hasBiometric = isSupported && credentials.length > 0;

  const theoreticalBalance = parseFloat((totalProfit - (completedWithdrawals + pendingWithdrawals)).toFixed(2));
  const availableBalance = theoreticalBalance;

  const fetchData = useCallback(async () => {
    if (!user) return;

    const [ordersRes, parentRes, withdrawalsRes, walletRes] = await Promise.all([
      supabase.from("orders").select("profit").eq("agent_id", user.id).eq("status", "fulfilled"),
      supabase.from("orders").select("parent_profit").eq("parent_agent_id", user.id).eq("status", "fulfilled"),
      supabase.from("withdrawals").select("*").eq("agent_id", user.id).order("created_at", { ascending: false }),
      supabase.from("wallets").select("balance").eq("agent_id", user.id).maybeSingle(),
    ]);

    // Fetch settings separately — columns may not exist in older deployments; default gracefully
    let settingsRes: { data: { min_withdrawal_amount?: number; max_withdrawal_amount?: number; withdrawal_system_enabled?: boolean } | null } = { data: null };
    try {
      const res = await supabase
        .from("public_system_settings")
        .select("min_withdrawal_amount, max_withdrawal_amount, withdrawal_system_enabled")
        .eq("id", 1)
        .maybeSingle();
      settingsRes = res;
    } catch {
      // ignore — defaults will be used
    }

    const profits = (ordersRes.data || []).reduce((sum, o: any) => sum + (o.profit || 0), 0);
    const parentProfits = (parentRes.data || []).reduce((sum, o: any) => sum + (o.parent_profit || 0), 0);
    setTotalProfit(parseFloat((profits + parentProfits).toFixed(2)));

    const wds = (withdrawalsRes.data || []) as Withdrawal[];
    setWithdrawals(wds);

    const completed = wds
      .filter((w) => w.status === "completed")
      .reduce((sum, w) => sum + w.amount, 0);
    
    const pending = wds
      .filter((w) => ["pending", "processing"].includes(w.status))
      .reduce((sum, w) => sum + w.amount, 0);

    setCompletedWithdrawals(completed);
    setPendingWithdrawals(pending);
    setWalletBalance(Number(walletRes.data?.balance || 0));

    if (settingsRes.data) {
      setMinWithdrawal(Number(settingsRes.data.min_withdrawal_amount) || 25);
      setMaxWithdrawal(Number(settingsRes.data.max_withdrawal_amount) || 5000);
      setSystemEnabled(settingsRes.data.withdrawal_system_enabled !== false);
    }
    
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleWithdraw = async () => {
    setConfirmOpen(false);
    setWithdrawing(true);

    const numAmount = parseFloat(amount);
    if (!systemEnabled) {
      toast.error("Withdrawals are temporarily disabled for maintenance.");
      setWithdrawing(false);
      return;
    }

    if (isNaN(numAmount) || numAmount < minWithdrawal) {
      toast.error(`Minimum withdrawal is GHS ${minWithdrawal.toFixed(2)}`);
      setWithdrawing(false);
      return;
    }

    if (numAmount > maxWithdrawal) {
      toast.error(`Maximum withdrawal is GHS ${maxWithdrawal.toFixed(2)}`);
      setWithdrawing(false);
      return;
    }

    const fee = parseFloat((WITHDRAWAL_FEE_FLAT + (numAmount * WITHDRAWAL_FEE_PERCENT)).toFixed(2));
    const net = numAmount - fee;

    if (profile?.last_security_update) {
      const lastUpdate = new Date(profile.last_security_update);
      const now = new Date();
      const diffHours = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);
      if (diffHours < 24) {
        toast.error("Security Hold Active", { 
          description: `You recently updated your security settings. Withdrawals are disabled for 24 hours (approx. ${Math.ceil(24 - diffHours)} hours remaining).` 
        });
        setWithdrawing(false);
        return;
      }
    }

    const { data, error } = await supabase.functions.invoke("agent-withdraw", {
      body: { amount: numAmount },
    });

    if (error || data?.error) {
      const errorMsg = data?.error || await getFunctionErrorMessage(error, "Withdrawal failed. Please try again.");
      toast.error("Withdrawal failed", { description: errorMsg });
    } else {
      toast.success("Withdrawal request placed!", { description: "You will receive your funds within 24 hours." });
      setAmount("");
      setEnteredPin("");
    }

    await fetchData();
    setWithdrawing(false);
  };

  if (loading) return <div className="text-muted-foreground p-8">Loading...</div>;

  return (
    <div className="space-y-6 p-6 md:p-8 max-w-4xl">
      <h1 className="font-display text-2xl font-bold">Withdrawals</h1>

      {/* Maintenance Banner */}
      {!systemEnabled && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-3 text-amber-500">
          <Clock className="w-5 h-5 shrink-0" />
          <p className="text-sm font-bold">Withdrawals are currently undergoing maintenance. Please check back later.</p>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 px-4 pt-4">
            <CardTitle className="text-[10px] uppercase tracking-widest font-black text-muted-foreground">Lifetime Profit</CardTitle>
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-display text-xl sm:text-2xl font-black">₵{totalProfit.toFixed(2)}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 px-4 pt-4">
            <CardTitle className="text-[10px] uppercase tracking-widest font-black text-muted-foreground">Paid Out</CardTitle>
            <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-display text-xl sm:text-2xl font-black text-emerald-500">₵{completedWithdrawals.toFixed(2)}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 px-4 pt-4">
            <CardTitle className="text-[10px] uppercase tracking-widest font-black text-muted-foreground">Pending</CardTitle>
            <Clock className="w-3.5 h-3.5 text-amber-500" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-display text-xl sm:text-2xl font-black text-amber-500">₵{pendingWithdrawals.toFixed(2)}</p>
          </CardContent>
        </Card>

        <Card className="border-primary/40 bg-primary/5 shadow-lg shadow-primary/5">
          <CardHeader className="flex flex-row items-center justify-between pb-1 px-4 pt-4">
            <CardTitle className="text-[10px] uppercase tracking-widest font-black text-primary">Available</CardTitle>
            <Wallet className="w-3.5 h-3.5 text-primary" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="font-display text-xl sm:text-2xl font-black text-primary">₵{availableBalance.toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>

      {profile && (
        <Card className="overflow-hidden border-indigo-500/10">
          <CardHeader className="bg-indigo-500/5 border-b border-indigo-500/10 py-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-black flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-500" />
                Verified Recipient Details
              </CardTitle>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[9px] uppercase font-bold px-2">
                Active Destination
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <User className="w-3 h-3" /> Account Holder
                </p>
                <p className="text-sm font-black text-foreground">{profile.momo_account_name || "Verification Pending"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Phone className="w-3 h-3" /> MoMo Number
                </p>
                <p className="text-sm font-black text-foreground">{profile.momo_number || "Not Set"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Activity className="w-3 h-3" /> Network
                </p>
                <p className="text-sm font-black text-emerald-500">{profile.momo_network || "Not Set"}</p>
              </div>
            </div>
            
            <Button 
              variant="outline" 
              size="sm"
              className="w-full h-11 rounded-xl border-dashed border-2 hover:bg-indigo-500/5 group"
              onClick={async () => {
                if (!profile.momo_number || !profile.momo_network) {
                   toast.error("Details Missing", { description: "Set your MoMo number in Settings first." });
                   return;
                }
                const toastId = toast.loading("Verifying account identity...");
                try {
                  // Map Network to Paystack Bank Code
                  const net = profile.momo_network.toUpperCase();
                  let bankCode = "MTN";
                  if (net.includes("VODA") || net.includes("TELECEL")) bankCode = "VOD";
                  if (net.includes("AIRTEL") || net.includes("TIGO") || net.includes("AT")) bankCode = "ATL";

                  const { data, error } = await supabase.functions.invoke("paystack-resolve", {
                    body: { account_number: profile.momo_number, bank_code: bankCode }
                  });

                  if (error || !data?.success) throw new Error(data?.error || "Could not resolve name");

                  // Update profile with resolved name
                  await supabase.from("profiles").update({ momo_account_name: data.account_name }).eq("user_id", user?.id);
                  
                  toast.success("Identity Verified!", { description: `Account resolved to: ${data.account_name}`, id: toastId });
                  fetchData();
                } catch (e: any) {
                  toast.error("Verification Failed", { description: e.message, id: toastId });
                }
              }}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-2 group-hover:rotate-180 transition-transform duration-700" />
              Verify & Sync Legal Name
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Request Withdrawal</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Input
                type="number"
                step="0.01"
                min={minWithdrawal}
                max={availableBalance}
                placeholder={`Amount (min GHS ${minWithdrawal.toFixed(2)}, max GHS ${Math.min(maxWithdrawal, availableBalance).toFixed(2)})`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-secondary"
              />
            </div>
            <Button
              onClick={async () => {
                const n = parseFloat(amount);
                if (isNaN(n) || n < minWithdrawal) {
                  toast.error(`Minimum withdrawal is GHS ${minWithdrawal.toFixed(2)}`);
                  return;
                }
                if (n > availableBalance) {
                  toast.error("Amount exceeds available balance");
                  return;
                }
                if (n > maxWithdrawal) {
                  toast.error(`Maximum withdrawal is GHS ${maxWithdrawal.toFixed(2)}`);
                  return;
                }
                if (hasBiometric) {
                  setBiometricScanning(true);
                  try {
                    const ok = await authenticate();
                    if (!ok) {
                      toast.error("Biometric check failed. Withdrawal blocked.");
                      return;
                    }
                  } catch (e: any) {
                    const msg: string = e?.message ?? "";
                    if (msg.includes("cancelled") || msg.includes("NotAllowedError")) {
                      toast.error("Authentication cancelled.");
                    } else {
                      toast.error("Biometric error", { description: msg });
                    }
                    return;
                  } finally {
                    setBiometricScanning(false);
                  }
                } else if (profile?.transaction_pin) {
                  setPinDialogOpen(true);
                  return;
                } else if (!hasBiometric && !profile?.transaction_pin) {
                  toast.error("Security Required", { 
                    description: "Please set a Transaction PIN or Biometric in Account Settings to secure your withdrawals." 
                  });
                  return;
                }
                setConfirmOpen(true);
              }}
              disabled={!systemEnabled || withdrawing || biometricScanning}
              className="gap-2"
            >
              {biometricScanning
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                : withdrawing
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                  : <>{hasBiometric ? <Fingerprint className="w-4 h-4" /> : <ArrowDownToLine className="w-4 h-4" />} Request Withdrawal</>
              }
            </Button>
          </div>
          {(!profile?.momo_number || !profile?.momo_network) && (
            <p className="text-xs text-amber-500 mt-2 font-medium">
              ⚠ Set your MoMo number and network in Account Settings before withdrawing.
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            A processing fee of GHS 1.00 + 1% applies to all withdrawals. Funds are sent within 24 hours.
            {hasBiometric && " · Biometric verification enabled."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Withdrawal History</CardTitle>
        </CardHeader>
        <CardContent>
          {withdrawals.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">No withdrawals yet.</p>
          ) : (
            <div className="space-y-3">
              {withdrawals.map((w) => {
                const config = statusConfig[w.status] || statusConfig.pending;
                const Icon = config.icon;
                return (
                  <div key={w.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
                    <div className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 ${w.status === "processing" ? "animate-spin" : ""} ${config.color.split(" ")[1]}`} />
                      <div>
                        <p className="font-medium text-sm">GHS {w.amount.toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(w.created_at).toLocaleDateString()} - {new Date(w.created_at).toLocaleTimeString()}
                          {Number(w.fee || 0) > 0 && <span className="ml-2 text-amber-500/70">· Fee: ₵{Number(w.fee).toFixed(2)}</span>}
                        </p>
                        {w.failure_reason && <p className="text-xs text-destructive mt-0.5">{w.failure_reason}</p>}
                      </div>
                    </div>
                    <Badge className={config.color}>{config.label}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Withdrawal Request</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <div className="p-4 rounded-xl bg-muted/50 border border-border space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Request Amount:</span>
                  <span className="font-bold">GHS {parseFloat(amount || "0").toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Processing Fee (GHS 1.00 + 1%):</span>
                  <span className="font-bold text-red-400">- GHS {(WITHDRAWAL_FEE_FLAT + (parseFloat(amount || "0") * WITHDRAWAL_FEE_PERCENT)).toFixed(2)}</span>
                </div>
                <div className="pt-2 border-t border-border flex justify-between text-base">
                  <span className="font-semibold text-foreground">You will receive:</span>
                  <span className="font-black text-emerald-400">GHS {(parseFloat(amount || "0") - (WITHDRAWAL_FEE_FLAT + (parseFloat(amount || "0") * WITHDRAWAL_FEE_PERCENT))).toFixed(2)}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Funds will be sent to your MoMo: <span className="text-foreground font-medium">{profile?.momo_number}</span> ({profile?.momo_network}).
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleWithdraw}>Submit Request</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      <AlertDialog open={pinDialogOpen} onOpenChange={setPinDialogOpen}>
        <AlertDialogContent className="max-w-[340px]">
          <AlertDialogHeader>
            <div className="mx-auto w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center mb-2">
              <Key className="w-6 h-6 text-indigo-500" />
            </div>
            <AlertDialogTitle className="text-center">Enter Transaction PIN</AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              Verify your identity to authorize this withdrawal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="••••"
              className="h-14 text-center text-2xl tracking-[0.5em] font-black bg-secondary border-white/10"
              value={enteredPin}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "");
                setEnteredPin(val);
                if (val.length === 4) {
                  if (val === profile?.transaction_pin) {
                    setPinDialogOpen(false);
                    setConfirmOpen(true);
                  } else {
                    toast.error("Incorrect PIN");
                    setEnteredPin("");
                  }
                }
              }}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="w-full">Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DashboardWithdraw;
