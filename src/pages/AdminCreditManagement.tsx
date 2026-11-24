import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  RefreshCw, CreditCard, Search, CheckCircle2, XCircle,
  TrendingUp, AlertTriangle, DollarSign, RotateCcw,
} from "lucide-react";
import { format } from "date-fns";
import { useConfirmedCall } from "@/components/admin/ConfirmActionProvider";

interface AgentCredit {
  agent_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  credit_enabled: boolean;
  credit_limit: number;
  credit_used: number;
  wallet_balance: number;
  orders_30d: number;
  revenue_30d: number;
}

interface CreditTx {
  id: string;
  agent_id: string;
  type: string;
  amount: number;
  balance_after: number;
  note: string | null;
  created_at: string;
}

export default function AdminCreditManagement() {
  const confirmed = useConfirmedCall();
  const { toast } = useToast();
  const [agents, setAgents] = useState<AgentCredit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<AgentCredit | null>(null);
  const [txHistory, setTxHistory] = useState<CreditTx[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editLimit, setEditLimit] = useState("");
  const [repayAmount, setRepayAmount] = useState("");

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("v_agent_performance")
      .select("agent_id, full_name, email, phone, credit_enabled, credit_limit, credit_used, wallet_balance, orders_30d, revenue_30d")
      .order("credit_enabled", { ascending: false })
      .order("revenue_30d", { ascending: false });
    if (!error) setAgents((data as AgentCredit[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const fetchTxHistory = async (agentId: string) => {
    setTxLoading(true);
    const { data } = await (supabase as any)
      .from("credit_transactions")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(20);
    setTxHistory((data as CreditTx[]) || []);
    setTxLoading(false);
  };

  const openAgent = (agent: AgentCredit) => {
    setSelectedAgent(agent);
    setEditLimit(String(agent.credit_limit || 0));
    setRepayAmount("");
    fetchTxHistory(agent.agent_id);
  };

  const handleToggleCredit = async (agent: AgentCredit) => {
    setSaving(true);
    const { error } = await (supabase as any)
      .from("profiles")
      .update({
        credit_enabled: !agent.credit_enabled,
        credit_approved_at: !agent.credit_enabled ? new Date().toISOString() : null,
      })
      .eq("user_id", agent.agent_id);

    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Credit ${!agent.credit_enabled ? "enabled" : "disabled"} for ${agent.full_name}` });
      setAgents((prev) => prev.map((a) => a.agent_id === agent.agent_id ? { ...a, credit_enabled: !a.credit_enabled } : a));
      if (selectedAgent?.agent_id === agent.agent_id) setSelectedAgent((p) => p ? { ...p, credit_enabled: !p.credit_enabled } : null);

      await (supabase as any).from("system_logs").insert({
        level: "info", source: "admin", event: "credit.toggled",
        message: `Credit ${!agent.credit_enabled ? "enabled" : "disabled"} for ${agent.full_name}`,
        agent_id: agent.agent_id,
        data: { credit_limit: agent.credit_limit },
      });
    }
    setSaving(false);
  };

  const handleSaveLimit = async () => {
    if (!selectedAgent) return;
    const limit = parseFloat(editLimit);
    if (isNaN(limit) || limit < 0) { toast({ title: "Invalid limit", variant: "destructive" }); return; }
    if (!(await confirmed.confirm({
      title: "Change this agent's credit limit?",
      description: `${selectedAgent.full_name || "This agent"} will be able to buy on credit up to this amount.`,
      kind: "money",
      amountGhs: limit,
      confirmLabel: "Yes, set the limit",
    }))) return;
    setSaving(true);
    
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "update_credit_limit", user_id: selectedAgent.agent_id, credit_limit: limit },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    if (error || data?.error) {
      toast({ title: "Failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
      setSelectedAgent((p) => p ? { ...p, credit_limit: limit } : null);
      setAgents((prev) => prev.map((a) => a.agent_id === selectedAgent.agent_id ? { ...a, credit_limit: limit } : a));
      toast({ title: `Credit limit set to GHS ${limit.toFixed(2)}` });
    }
    setSaving(false);
  };

  const handleRepay = async () => {
    if (!selectedAgent) return;
    const amount = parseFloat(repayAmount);
    if (isNaN(amount) || amount <= 0) { toast({ title: "Invalid amount", variant: "destructive" }); return; }
    if (!(await confirmed.confirm({
      title: "Record a credit repayment?",
      description: `Records a manual repayment from ${selectedAgent.full_name || "this agent"} against their credit balance.`,
      kind: "money",
      amountGhs: amount,
      confirmLabel: "Yes, record repayment",
    }))) return;
    setSaving(true);
    const { data, error } = await (supabase as any).rpc("repay_agent_credit", {
      p_agent_id: selectedAgent.agent_id, p_amount: amount, p_note: "Manual repayment by admin",
    });
    if (error || !data) {
      toast({ title: "Repayment failed", description: error?.message, variant: "destructive" });
    } else {
      const newUsed = Math.max(0, selectedAgent.credit_used - amount);
      setSelectedAgent((p) => p ? { ...p, credit_used: newUsed } : null);
      setAgents((prev) => prev.map((a) => a.agent_id === selectedAgent.agent_id ? { ...a, credit_used: newUsed } : a));
      setRepayAmount("");
      fetchTxHistory(selectedAgent.agent_id);
      toast({ title: `GHS ${amount.toFixed(2)} credit repaid for ${selectedAgent.full_name}` });
    }
    setSaving(false);
  };

  const filtered = agents.filter((a) =>
    !search || a.full_name?.toLowerCase().includes(search.toLowerCase()) || a.email?.toLowerCase().includes(search.toLowerCase())
  );

  const totalExposure = agents.reduce((s, a) => s + (a.credit_used || 0), 0);
  const totalLimit = agents.filter((a) => a.credit_enabled).reduce((s, a) => s + (a.credit_limit || 0), 0);
  const enabledCount = agents.filter((a) => a.credit_enabled).length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Credit Management</h1>
          <p className="text-white/40 text-sm mt-1">Manage agent credit limits and float balances</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={fetchAgents}
          className="gap-2 border-white/10 text-white/60 hover:bg-white/5">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-white/5 border-white/10 p-4">
          <p className="text-white/40 text-[10px] font-black uppercase tracking-widest">Credit Agents</p>
          <p className="text-3xl font-black text-white mt-1">{enabledCount}</p>
        </Card>
        <Card className="bg-amber-500/5 border-amber-500/20 p-4">
          <p className="text-amber-400/60 text-[10px] font-black uppercase tracking-widest">Total Exposure</p>
          <p className="text-3xl font-black text-amber-400 mt-1">GHS {totalExposure.toFixed(0)}</p>
        </Card>
        <Card className="bg-primary/5 border-primary/20 p-4">
          <p className="text-primary/60 text-[10px] font-black uppercase tracking-widest">Total Limit</p>
          <p className="text-3xl font-black text-primary mt-1">GHS {totalLimit.toFixed(0)}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Agent list */}
        <div className="lg:col-span-2 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <Input placeholder="Search agents..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/20" />
          </div>

          <Card className="bg-white/[0.02] border-white/10 overflow-hidden max-h-[600px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-5 h-5 text-white/20 animate-spin" />
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {filtered.map((agent) => {
                  const utilization = agent.credit_limit > 0 ? (agent.credit_used / agent.credit_limit) * 100 : 0;
                  const isSelected = selectedAgent?.agent_id === agent.agent_id;

                  return (
                    <button type="button" key={agent.agent_id} onClick={() => openAgent(agent)}
                      className={cn("w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5",
                        isSelected && "bg-primary/10")}>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-bold truncate">{agent.full_name}</p>
                        <p className="text-white/30 text-xs truncate">{agent.email}</p>
                        {agent.credit_enabled && (
                          <div className="mt-1.5">
                            <div className="flex justify-between text-[10px] mb-0.5">
                              <span className="text-white/30">Used: GHS {(agent.credit_used || 0).toFixed(0)}</span>
                              <span className={cn(utilization > 80 ? "text-red-400" : "text-white/30")}>
                                {utilization.toFixed(0)}%
                              </span>
                            </div>
                            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                              <div className={cn("h-full rounded-full", utilization > 80 ? "bg-red-500" : utilization > 50 ? "bg-amber-400" : "bg-green-500")}
                                style={{ width: `${Math.min(utilization, 100)}%` }} />
                            </div>
                          </div>
                        )}
                      </div>
                      <Badge className={cn("text-[9px] h-4 px-1.5 border font-black uppercase shrink-0 mt-0.5",
                        agent.credit_enabled ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-white/5 text-white/20 border-white/10")}>
                        {agent.credit_enabled ? "Credit" : "No Credit"}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Agent detail */}
        <div className="lg:col-span-3">
          {!selectedAgent ? (
            <Card className="bg-white/[0.02] border-white/10 flex items-center justify-center py-20">
              <div className="text-center space-y-2">
                <CreditCard className="w-10 h-10 text-white/10 mx-auto" />
                <p className="text-white/30 text-sm">Select an agent to manage their credit</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              <Card className="bg-white/[0.03] border-white/10 p-5 space-y-4">
                {/* Agent info */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-white font-black">{selectedAgent.full_name}</p>
                    <p className="text-white/40 text-sm">{selectedAgent.email}</p>
                    <p className="text-white/20 text-xs mt-1">
                      {selectedAgent.orders_30d} orders · GHS {(selectedAgent.revenue_30d || 0).toFixed(2)} revenue (30d)
                    </p>
                  </div>
                  <button type="button" onClick={() => handleToggleCredit(selectedAgent)} disabled={saving}
                    className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-black border transition-all disabled:opacity-50",
                      selectedAgent.credit_enabled
                        ? "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20"
                        : "bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20")}>
                    {selectedAgent.credit_enabled ? <><XCircle className="w-3.5 h-3.5" /> Disable Credit</> : <><CheckCircle2 className="w-3.5 h-3.5" /> Enable Credit</>}
                  </button>
                </div>

                {/* Credit stats */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    ["Limit", `GHS ${(selectedAgent.credit_limit || 0).toFixed(2)}`, "text-white"],
                    ["Used", `GHS ${(selectedAgent.credit_used || 0).toFixed(2)}`, "text-amber-400"],
                    ["Available", `GHS ${Math.max(0, (selectedAgent.credit_limit || 0) - (selectedAgent.credit_used || 0)).toFixed(2)}`, "text-green-400"],
                  ].map(([label, val, color]) => (
                    <div key={label} className="bg-white/5 rounded-xl p-3 text-center">
                      <p className="text-white/30 text-[10px] font-black uppercase tracking-widest">{label}</p>
                      <p className={cn("font-black text-base mt-1", color)}>{val}</p>
                    </div>
                  ))}
                </div>

                {/* Edit limit */}
                <div className="space-y-2">
                  <p className="text-white/40 text-xs font-bold uppercase tracking-widest">Credit Limit</p>
                  <div className="flex gap-2">
                    <Input value={editLimit} onChange={(e) => setEditLimit(e.target.value)} type="number" min="0" step="50"
                      placeholder="e.g. 500" className="bg-white/5 border-white/10 text-white flex-1" />
                    <Button type="button" onClick={handleSaveLimit} disabled={saving}
                      className="bg-primary/20 text-primary hover:bg-primary/30 border-0 gap-1.5">
                      <DollarSign className="w-3.5 h-3.5" /> Set
                    </Button>
                  </div>
                </div>

                {/* Repay */}
                <div className="space-y-2">
                  <p className="text-white/40 text-xs font-bold uppercase tracking-widest">Manual Repayment</p>
                  <div className="flex gap-2">
                    <Input value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} type="number" min="0" step="10"
                      placeholder="Amount to repay..." className="bg-white/5 border-white/10 text-white flex-1" />
                    <Button type="button" onClick={handleRepay} disabled={saving || !repayAmount}
                      className="bg-green-500/20 text-green-400 hover:bg-green-500/30 border-0 gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5" /> Repay
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Transaction history */}
              <Card className="bg-white/[0.02] border-white/10 p-5">
                <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-3">Transaction History</p>
                {txLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="w-4 h-4 text-white/20 animate-spin" />
                  </div>
                ) : txHistory.length === 0 ? (
                  <p className="text-white/20 text-sm text-center py-6">No transactions yet</p>
                ) : (
                  <div className="divide-y divide-white/5 max-h-64 overflow-y-auto">
                    {txHistory.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between py-2.5">
                        <div>
                          <p className="text-white/70 text-sm font-bold capitalize">{tx.type}</p>
                          <p className="text-white/25 text-[10px]">{tx.note}</p>
                          <p className="text-white/20 text-[10px]">{format(new Date(tx.created_at), "MMM dd HH:mm")}</p>
                        </div>
                        <div className="text-right">
                          <p className={cn("font-black text-sm", tx.type === "repay" ? "text-green-400" : tx.type === "draw" ? "text-amber-400" : "text-white/60")}>
                            {tx.type === "repay" ? "+" : "-"}GHS {Number(tx.amount).toFixed(2)}
                          </p>
                          <p className="text-white/20 text-[10px]">bal: GHS {Number(tx.balance_after || 0).toFixed(2)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
