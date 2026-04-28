import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, CheckCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/utils/auditLogger";

interface WithdrawalRow {
  id: string;
  agent_id: string;
  amount: number;
  status: string;
  failure_reason: string | null;
  created_at: string;
  agent_name?: string;
  agent_email?: string;
  momo_number?: string;
  momo_network?: string;
  momo_account_name?: string;
  total_profit?: number;
  fee: number;
  net_amount: number;
}

const statusColors: Record<string, string> = {
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  processing: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
};

const AdminWithdrawals = () => {
  const { toast } = useToast();
  const { user: currentUser, session } = useAuth();
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const fetchWithdrawals = async () => {
    const { data } = await supabase
      .from("withdrawals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    const rows = (data || []) as WithdrawalRow[];

    // Fetch agent profiles with momo details
    const agentIds = [...new Set(rows.map((r) => r.agent_id))];
    if (agentIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, momo_number, momo_network, momo_account_name")
        .in("user_id", agentIds);

      // Also get total profits per agent
      const { data: orders } = await supabase
        .from("orders")
        .select("agent_id, profit, status")
        .in("agent_id", agentIds)
        .in("status", ["paid", "fulfilled", "fulfillment_failed"]);

      const profitMap = new Map<string, number>();
      (orders || []).forEach((o: any) => {
        profitMap.set(o.agent_id, (profitMap.get(o.agent_id) || 0) + (o.profit || 0));
      });

      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
      rows.forEach((r) => {
        const p = profileMap.get(r.agent_id) as any;
        if (p) {
          r.agent_name = p.full_name;
          r.agent_email = p.email;
          r.momo_number = p.momo_number;
          r.momo_network = p.momo_network;
          r.momo_account_name = p.momo_account_name;
        }
        r.total_profit = profitMap.get(r.agent_id) || 0;
      });
    }

    setWithdrawals(rows);
    setLoading(false);
  };

  useEffect(() => { fetchWithdrawals(); }, []);

  const handleConfirm = async (withdrawalId: string) => {
    setConfirming(withdrawalId);
    
    // Find withdrawal row for logging
    const withdrawal = withdrawals.find(w => w.id === withdrawalId);

    const { data, error } = await supabase.functions.invoke("admin-user-actions", {
      body: { action: "confirm_withdrawal", withdrawal_id: withdrawalId },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    if (error || data?.error) {
      toast({ title: "Failed to confirm", description: data?.error || error?.message, variant: "destructive" });
    } else {
      if (currentUser && withdrawal) {
        await logAudit(currentUser.id, "confirm_withdrawal", {
          withdrawal_id: withdrawalId,
          agent_id: withdrawal.agent_id,
          agent_name: withdrawal.agent_name,
          amount: withdrawal.amount
        });
      }
      toast({ title: "Withdrawal confirmed as sent!" });
      await fetchWithdrawals();
    }
    setConfirming(null);
  };

  const filtered = withdrawals.filter((w) =>
    [w.id, w.agent_name, w.agent_email, w.status, w.momo_number]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(search.toLowerCase()))
  );

  const pendingCount = withdrawals.filter((w) => w.status === "pending").length;
  const totalPaid = withdrawals.filter((w) => w.status === "completed").reduce((sum, w) => sum + w.amount, 0);

  if (loading) return <div className="text-muted-foreground">Loading withdrawals...</div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Withdrawal Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pending: <span className="font-medium text-yellow-400">{pendingCount}</span> · Total paid: <span className="font-medium text-foreground">GH₵{totalPaid.toFixed(2)}</span>
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 bg-secondary" />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-4 font-medium text-muted-foreground">Date</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Agent</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Amount</th>
                <th className="text-left p-4 font-medium text-muted-foreground hidden md:table-cell">Total Profit</th>
                <th className="text-left p-4 font-medium text-muted-foreground hidden lg:table-cell">MoMo Details</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Status</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr key={w.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="p-4 text-muted-foreground whitespace-nowrap">
                    {new Date(w.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-4">
                    <p className="font-medium text-sm">{w.agent_name || "Unknown"}</p>
                    <p className="text-xs text-muted-foreground">{w.agent_email || ""}</p>
                  </td>
                  <td className="p-4">
                    <p className="font-medium whitespace-nowrap">GH₵{w.amount.toFixed(2)}</p>
                    <p className="text-[10px] text-red-400 font-bold">Fee: GH₵{(w.fee || 0).toFixed(2)}</p>
                  </td>
                  <td className="p-4 text-muted-foreground hidden md:table-cell">GH₵{(w.total_profit || 0).toFixed(2)}</td>
                  <td className="p-4 hidden lg:table-cell">
                    <p className="text-sm">{w.momo_account_name || "—"}</p>
                    <p className="text-xs text-muted-foreground">{w.momo_number || "—"} · {w.momo_network || "—"}</p>
                  </td>
                  <td className="p-4">
                    <div className="flex flex-col gap-1">
                      <p className="font-black text-emerald-400 text-sm">SEND: GH₵{(w.net_amount || w.amount).toFixed(2)}</p>
                      <Badge className={`${statusColors[w.status] || ""} w-fit`}>{w.status}</Badge>
                    </div>
                  </td>
                  <td className="p-4">
                    {w.status === "pending" && (
                      <Button
                        size="sm" variant="outline" className="text-xs gap-1.5"
                        disabled={confirming === w.id}
                        onClick={() => handleConfirm(w.id)}
                      >
                        {confirming === w.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                        Confirm Sent
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-muted-foreground">No withdrawals found.</div>
        )}
      </div>
    </div>
  );
};

export default AdminWithdrawals;
