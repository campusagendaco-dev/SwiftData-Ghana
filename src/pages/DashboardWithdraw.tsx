import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Wallet, ArrowDownToLine, Loader2, CheckCircle, XCircle, Clock } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Withdrawal {
  id: string;
  amount: number;
  status: string;
  failure_reason: string | null;
  created_at: string;
}

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
  const [totalWithdrawn, setTotalWithdrawn] = useState(0);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const availableBalance = parseFloat((totalProfit - totalWithdrawn).toFixed(2));

  const fetchData = useCallback(async () => {
    if (!user) return;

    const [ordersRes, withdrawalsRes] = await Promise.all([
      supabase.from("orders").select("profit").eq("agent_id", user.id).in("status", ["paid", "fulfilled", "fulfillment_failed"]),
      supabase.from("withdrawals").select("*").eq("agent_id", user.id).order("created_at", { ascending: false }),
    ]);

    const profits = (ordersRes.data || []).reduce((sum, o: any) => sum + (o.profit || 0), 0);
    setTotalProfit(profits);

    const wds = (withdrawalsRes.data || []) as Withdrawal[];
    setWithdrawals(wds);

    const withdrawn = wds
      .filter((w) => ["completed", "pending", "processing"].includes(w.status))
      .reduce((sum, w) => sum + w.amount, 0);
    setTotalWithdrawn(withdrawn);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleWithdraw = async () => {
    setConfirmOpen(false);
    setWithdrawing(true);

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 10) {
      toast({ title: "Minimum withdrawal is GH₵10.00", variant: "destructive" });
      setWithdrawing(false);
      return;
    }

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

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Withdrawals</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Earnings</CardTitle>
            <Wallet className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-bold">GH₵{totalProfit.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Withdrawn</CardTitle>
            <ArrowDownToLine className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-bold">GH₵{totalWithdrawn.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-primary">Available Balance</CardTitle>
            <Wallet className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-bold text-primary">GH₵{availableBalance.toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>

      {/* MoMo Details */}
      {profile && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Your MoMo Details</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{profile.momo_account_name || "Not set"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Number</span><span className="font-medium">{profile.momo_number || "Not set"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Network</span><span className="font-medium">{profile.momo_network || "Not set"}</span></div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg">Request Withdrawal</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Input
                type="number" step="0.01" min="10" max={availableBalance}
                placeholder={`Amount (min GH₵10.00, max GH₵${availableBalance.toFixed(2)})`}
                value={amount} onChange={(e) => setAmount(e.target.value)} className="bg-secondary"
              />
            </div>
            <Button
              onClick={() => {
                const n = parseFloat(amount);
                if (isNaN(n) || n < 10) { toast({ title: "Minimum withdrawal is GH₵10.00", variant: "destructive" }); return; }
                if (n > availableBalance) { toast({ title: "Amount exceeds available balance", variant: "destructive" }); return; }
                setConfirmOpen(true);
              }}
              disabled={withdrawing || availableBalance < 10}
              className="gap-2"
            >
              {withdrawing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDownToLine className="w-4 h-4" />}
              Request Withdrawal
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Withdrawal requests are processed within 24 hours to your registered MoMo number.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Withdrawal History</CardTitle></CardHeader>
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
                        <p className="font-medium text-sm">GH₵{w.amount.toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(w.created_at).toLocaleDateString()} · {new Date(w.created_at).toLocaleTimeString()}
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
            <AlertDialogDescription>
              You are requesting <span className="font-bold text-foreground">GH₵{parseFloat(amount || "0").toFixed(2)}</span> to be sent to your MoMo ({profile?.momo_number}). This will be processed within 24 hours.
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
