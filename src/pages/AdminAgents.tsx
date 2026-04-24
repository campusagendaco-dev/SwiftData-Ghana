import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/utils/auditLogger";
import {
  CheckCircle, XCircle, Clock, Search, Wallet, Users2, Phone,
  ChevronDown, ChevronUp, Loader2, RefreshCw, Store, MessageCircle
} from "lucide-react";

interface AgentRow {
  user_id: string;
  full_name: string;
  email: string;
  store_name: string;
  phone: string;
  momo_number: string;
  momo_network: string;
  slug: string | null;
  is_agent: boolean;
  is_sub_agent: boolean;
  onboarding_complete: boolean;
  agent_approved: boolean;
  created_at: string;
  wallet_balance?: number;
  sub_agent_count?: number;
  total_sales_volume?: number;
}

const AdminAgents = () => {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "approved" | "pending">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [subAgents, setSubAgents] = useState<Record<string, AgentRow[]>>({});
  const [loadingSubAgents, setLoadingSubAgents] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState<Record<string, string>>({});
  const [toppingUp, setToppingUp] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("is_agent", true)
      .eq("is_sub_agent" as any, false)
      .order("created_at", { ascending: false });

    const rows = ((data as any[]) || []) as AgentRow[];

    // Fetch wallet balances
    const ids = rows.map(r => r.user_id);
    if (ids.length > 0) {
      const [walletsRes, subCountRes, salesRes] = await Promise.all([
        supabase.from("wallets").select("agent_id, balance").in("agent_id", ids),
        supabase.from("profiles").select("user_id, parent_agent_id").eq("is_sub_agent" as any, true).in("parent_agent_id" as any, ids),
        supabase.from("user_sales_stats").select("user_id, total_sales_volume").in("user_id", ids),
      ]);

      const walletMap = new Map((walletsRes.data || []).map((w: any) => [w.agent_id, w.balance]));
      const salesMap = new Map((salesRes.data || []).map((s: any) => [s.user_id, s.total_sales_volume]));
      const subCountMap: Record<string, number> = {};
      (subCountRes.data || []).forEach((sa: any) => {
        subCountMap[sa.parent_agent_id] = (subCountMap[sa.parent_agent_id] || 0) + 1;
      });

      rows.forEach(r => {
        r.wallet_balance = walletMap.get(r.user_id) ?? 0;
        r.sub_agent_count = subCountMap[r.user_id] ?? 0;
        r.total_sales_volume = salesMap.get(r.user_id) ?? 0;
      });
    }

    setAgents(rows);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const handleApprove = async (userId: string) => {
    setApprovingId(userId);
    const { error } = await supabase
      .from("profiles")
      .update({ agent_approved: true })
      .eq("user_id", userId);
    if (error) {
      toast({ title: "Failed to approve", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Agent approved" });
      setAgents(prev => prev.map(a => a.user_id === userId ? { ...a, agent_approved: true } : a));
      if (currentUser) await logAudit(currentUser.id, "approve_agent", { target_agent_id: userId });
    }
    setApprovingId(null);
  };

  const handleRevoke = async (userId: string) => {
    setApprovingId(userId);
    const { error } = await supabase
      .from("profiles")
      .update({ agent_approved: false })
      .eq("user_id", userId);
    if (error) {
      toast({ title: "Failed to revoke", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Agent access revoked" });
      setAgents(prev => prev.map(a => a.user_id === userId ? { ...a, agent_approved: false } : a));
      if (currentUser) await logAudit(currentUser.id, "revoke_agent", { target_agent_id: userId });
    }
    setApprovingId(null);
  };

  const handleTopUp = async (agent: AgentRow) => {
    const amount = parseFloat(topupAmount[agent.user_id] || "");
    if (!amount || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" }); return;
    }
    setToppingUp(agent.user_id);

    const { data: wallet } = await supabase.from("wallets").select("balance").eq("agent_id", agent.user_id).maybeSingle();

    if (!wallet) {
      await supabase.from("wallets").insert({ agent_id: agent.user_id, balance: amount } as any);
    } else {
      const newBal = parseFloat((wallet.balance + amount).toFixed(2));
      await supabase.from("wallets").update({ balance: newBal }).eq("agent_id", agent.user_id);
    }

    await supabase.from("orders").insert({
      agent_id: agent.user_id, order_type: "wallet_topup", amount, profit: 0, status: "fulfilled",
    });

    if (currentUser) {
      await logAudit(currentUser.id, "manual_wallet_topup", {
        target_agent_id: agent.user_id,
        target_agent_name: agent.full_name,
        amount,
        previous_balance: wallet?.balance ?? 0,
      });
    }

    toast({ title: `GH₵${amount.toFixed(2)} credited to ${agent.full_name}` });
    setTopupAmount(prev => ({ ...prev, [agent.user_id]: "" }));
    setAgents(prev => prev.map(a => a.user_id === agent.user_id ? { ...a, wallet_balance: (a.wallet_balance || 0) + amount } : a));
    setToppingUp(null);
  };

  const toggleExpand = async (agentId: string) => {
    if (expandedId === agentId) { setExpandedId(null); return; }
    setExpandedId(agentId);
    if (subAgents[agentId]) return;
    setLoadingSubAgents(agentId);
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("parent_agent_id" as any, agentId)
      .order("created_at", { ascending: false });
    setSubAgents(prev => ({ ...prev, [agentId]: (data as any[]) || [] }));
    setLoadingSubAgents(null);
  };

  const filtered = agents.filter(a => {
    const matchSearch = [a.full_name, a.email, a.store_name, a.phone]
      .filter(Boolean).some(v => v.toLowerCase().includes(search.toLowerCase()));
    if (filter === "approved") return matchSearch && a.agent_approved;
    if (filter === "pending") return matchSearch && !a.agent_approved;
    return matchSearch;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        <p className="text-white/50 text-sm">Loading agents...</p>
      </div>
    );
  }

  const approvedCount = agents.filter(a => a.agent_approved).length;
  const pendingCount = agents.filter(a => !a.agent_approved).length;

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <h1 className="font-display text-3xl font-black tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            Agent Management
          </h1>
          <p className="text-sm text-white/50 mt-1">Approve, manage wallets, and view sub-agents for all parent agents.</p>
        </div>
        <Button onClick={fetchAgents} className="gap-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Agents", value: agents.length, color: "text-white" },
          { label: "Approved", value: approvedCount, color: "text-green-400" },
          { label: "Pending", value: pendingCount, color: "text-yellow-400" },
        ].map(s => (
          <div key={s.label} className="rounded-2xl bg-white/[0.02] border border-white/5 p-4 text-center">
            <p className={`font-display text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-xs text-white/40 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <Input
            placeholder="Search by name, email, store, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-amber-400/40"
          />
        </div>
        <div className="flex gap-2">
          {(["all", "approved", "pending"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all capitalize ${
                filter === f
                  ? "bg-amber-400/20 text-amber-400 border border-amber-400/30"
                  : "bg-white/5 text-white/50 border border-white/10 hover:text-white/80"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Agents list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-white/30 text-sm">No agents found.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((agent) => (
            <div key={agent.user_id} className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
              {/* Agent row */}
              <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <p className="font-bold text-white">{agent.full_name || "—"}</p>
                    {agent.agent_approved ? (
                      <Badge className="gap-1 bg-green-500/20 text-green-400 border-green-500/30 text-[10px]">
                        <CheckCircle className="w-3 h-3" /> Approved
                      </Badge>
                    ) : agent.onboarding_complete ? (
                      <Badge className="gap-1 bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">
                        <Clock className="w-3 h-3" /> Pending Approval
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-[10px] text-white/40 border-white/10">
                        <Clock className="w-3 h-3" /> Onboarding
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/40">
                    {agent.store_name && (
                      <span className="flex items-center gap-1">
                        <Store className="w-3 h-3" /> {agent.store_name}
                      </span>
                    )}
                    {agent.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {agent.phone}
                      </span>
                    )}
                    {agent.email && <span>{agent.email}</span>}
                    <span>Joined {new Date(agent.created_at).toLocaleDateString()}</span>
                  </div>
                </div>

                {/* Wallet + sub-agents */}
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-center">
                    <p className="text-xs text-white/40">Total Sales</p>
                    <p className="text-sm font-black text-green-400">GH₵{(agent.total_sales_volume || 0).toFixed(2)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-white/40">Wallet</p>
                    <p className="text-sm font-black text-amber-400">GH₵{(agent.wallet_balance || 0).toFixed(2)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-white/40">Sub-Agents</p>
                    <p className="text-sm font-black text-blue-400">{agent.sub_agent_count ?? 0}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                    <Link
                      to={`/admin/orders?agent=${encodeURIComponent(agent.full_name || agent.email)}`}
                      className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 hover:bg-blue-500/20 transition-colors"
                      title="View Sales History"
                    >
                      <ShoppingCart className="w-4 h-4" />
                    </Link>
                    <a
                      href={`https://wa.me/233${agent.phone?.replace(/^0/, "")}`}
                      target="_blank" rel="noopener noreferrer"
                      className="w-8 h-8 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-400 hover:bg-green-500/20 transition-colors"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </a>
                  )}
                  {agent.agent_approved ? (
                    <Button
                      size="sm" variant="outline"
                      onClick={() => handleRevoke(agent.user_id)}
                      disabled={approvingId === agent.user_id}
                      className="text-xs border-white/10 text-white/60 hover:text-red-400 hover:border-red-500/30"
                    >
                      {approvingId === agent.user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Revoke"}
                    </Button>
                  ) : agent.onboarding_complete ? (
                    <Button
                      size="sm"
                      onClick={() => handleApprove(agent.user_id)}
                      disabled={approvingId === agent.user_id}
                      className="text-xs bg-amber-400 text-black font-bold hover:bg-amber-300"
                    >
                      {approvingId === agent.user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Approve"}
                    </Button>
                  ) : null}
                  <button
                    onClick={() => toggleExpand(agent.user_id)}
                    className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors"
                  >
                    {expandedId === agent.user_id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Expanded section */}
              {expandedId === agent.user_id && (
                <div className="border-t border-white/5 p-4 bg-white/[0.01] space-y-4">
                  {/* Quick wallet top-up */}
                  <div>
                    <p className="text-xs font-bold text-white/60 uppercase tracking-wider mb-2">Quick Wallet Top-Up</p>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-xs">GH₵</span>
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={topupAmount[agent.user_id] || ""}
                          onChange={(e) => setTopupAmount(prev => ({ ...prev, [agent.user_id]: e.target.value }))}
                          className="pl-9 w-32 bg-white/5 border-white/10 text-white text-sm rounded-xl focus:border-amber-400/40"
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleTopUp(agent)}
                        disabled={toppingUp === agent.user_id}
                        className="bg-amber-400/20 text-amber-400 hover:bg-amber-400/30 border border-amber-400/30 font-bold rounded-xl"
                      >
                        {toppingUp === agent.user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Wallet className="w-3 h-3 mr-1" /> Credit</>}
                      </Button>
                    </div>
                  </div>

                  {/* MoMo info */}
                  {agent.momo_number && (
                    <div>
                      <p className="text-xs font-bold text-white/60 uppercase tracking-wider mb-2">MoMo Details</p>
                      <p className="text-sm text-white/70">{agent.momo_network} — {agent.momo_number}</p>
                    </div>
                  )}

                  {/* Sub-agents */}
                  <div>
                    <p className="text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                      Sub-Agents ({agent.sub_agent_count ?? 0})
                    </p>
                    {loadingSubAgents === agent.user_id ? (
                      <div className="flex items-center gap-2 text-white/40 text-sm py-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading sub-agents...
                      </div>
                    ) : (subAgents[agent.user_id] || []).length === 0 ? (
                      <p className="text-sm text-white/30">No sub-agents yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {(subAgents[agent.user_id] || []).map((sa: any) => (
                          <div key={sa.user_id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                            <div>
                              <p className="text-sm font-semibold text-white">{sa.full_name || "—"}</p>
                              <p className="text-xs text-white/40">{sa.email} • {sa.phone}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {(sa as any).sub_agent_approved ? (
                                <Badge className="text-[10px] bg-green-500/20 text-green-400 border-green-500/30">Active</Badge>
                              ) : (
                                <Badge className="text-[10px] bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Pending</Badge>
                              )}
                              <Users2 className="w-3.5 h-3.5 text-white/30" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminAgents;
