import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Wallet, ArrowDownToLine, Loader2, CheckCircle, XCircle, Clock, TrendingUp } from "lucide-react";
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

const MIN_WITHDRAWAL = 25;
const WITHDRAWAL_FEE_RATE = 0.015; // 1.5%

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  completed: { icon: CheckCircle, color: "bg-green-500/20 text-green-400 border-green-500/30", label: "Completed" },
  pending: { icon: Clock, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", label: "Pending" },
  processing: { icon: Loader2, color: "bg-blue-500/20 text-blue-400 border-blue-500/30", label: "Processing" },
  failed: { icon: XCircle, color: "bg-red-500/20 text-red-400 border-red-500/30", label: "Failed" },
};

const DashboardWithdraw = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [totalProfit, setTotalProfit] = useState(0);
  const [completedWithdrawals, setCompletedWithdrawals] = useState(0);
  const [pendingWithdrawals, setPendingWithdrawals] = useState(0);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const availableBalance = parseFloat((totalProfit - (completedWithdrawals + pendingWithdrawals)).toFixed(2));

  const fetchData = useCallback(async () => {
    if (!user) return;

    const [ordersRes, parentRes, withdrawalsRes] = await Promise.all([
      supabase.from("orders").select("profit").eq("agent_id", user.id).eq("status", "fulfilled"),
      supabase.from("orders").select("parent_profit").eq("parent_agent_id", user.id).eq("status", "fulfilled"),
      supabase.from("withdrawals").select("*").eq("agent_id", user.id).order("created_at", { ascending: false }),
    ]);

    const profits = (ordersRes.data || []).reduce((sum, o: any) => sum + (o.profit || 0), 0);
    const parentProfits = (parentRes.data || []).reduce((sum, o: any) => sum + (o.parent_profit || 0), 0);
    setTotalProfit(profits + parentProfits);

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
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleWithdraw = async () => {
    setConfirmOpen(false);
    setWithdrawing(true);

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < MIN_WITHDRAWAL) {
      toast({ title: `Minimum withdrawal is GHS ${MIN_WITHDRAWAL.toFixed(2)}`, variant: "destructive" });
      setWithdrawing(false);
      return;
    }

    const fee = parseFloat((numAmount * WITHDRAWAL_FEE_RATE).toFixed(2));
    const net = numAmount - fee;

    const { data, error } = await supabase.functions.invoke("agent-withdraw", {
      body: { amount: numAmount },
    });

    if (error || data?.error) {
      toast({ title: "Withdrawal failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: "Withdrawal request placed!", description: "You will receive your funds within 24 hours." });
      setAmount("");
    }

    await fetchData();
    setWithdrawing(false);
  };

  if (loading) return <div className="text-muted-foreground p-8">Loading...</div>;

  return (
    <div className="space-y-6 p-6 md:p-8 max-w-4xl">
      <h1 className="font-display text-2xl font-bold">Withdrawals</h1>

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
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your MoMo Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{profile.momo_account_name || "Not set"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Number</span><span className="font-medium">{profile.momo_number || "Not set"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Network</span><span className="font-medium">{profile.momo_network || "Not set"}</span></div>
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
                min={MIN_WITHDRAWAL}
                max={availableBalance}
                placeholder={`Amount (min GHS ${MIN_WITHDRAWAL.toFixed(2)}, max GHS ${availableBalance.toFixed(2)})`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-secondary"
              />
            </div>
            <Button
              onClick={() => {
                const n = parseFloat(amount);
                if (isNaN(n) || n < MIN_WITHDRAWAL) {
                  toast({ title: `Minimum withdrawal is GHS ${MIN_WITHDRAWAL.toFixed(2)}`, variant: "destructive" });
                  return;
                }
                if (n > availableBalance) {
                  toast({ title: "Amount exceeds available balance", variant: "destructive" });
                  return;
                }
                setConfirmOpen(true);
              }}
              disabled={withdrawing || availableBalance < MIN_WITHDRAWAL}
              className="gap-2"
            >
              {withdrawing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDownToLine className="w-4 h-4" />}
              Request Withdrawal
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">A 1.5% processing fee applies to all withdrawals. Funds are sent within 24 hours.</p>
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
                  <span className="text-muted-foreground">Processing Fee (1.5%):</span>
                  <span className="font-bold text-red-400">- GHS {(parseFloat(amount || "0") * WITHDRAWAL_FEE_RATE).toFixed(2)}</span>
                </div>
                <div className="pt-2 border-t border-border flex justify-between text-base">
                  <span className="font-semibold text-foreground">You will receive:</span>
                  <span className="font-black text-emerald-400">GHS {(parseFloat(amount || "0") * (1 - WITHDRAWAL_FEE_RATE)).toFixed(2)}</span>
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
    </div>
  );
};

export default DashboardWithdraw;
