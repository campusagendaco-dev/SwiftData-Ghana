import { useEffect, useState, useCallback } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/utils/auditLogger";
import {
  CheckCircle, AlertTriangle, Clock, Search, Wallet, Users2, Phone,
  ChevronDown, ChevronUp, Loader2, RefreshCw, Store, MessageCircle, ShoppingCart
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
  api_wallet_balance?: number;
  credit_limit?: number;
  sub_agent_count?: number;
  total_sales_volume?: number;
  total_own_profit?: number;
  total_commissions_paid?: number;
  api_access_enabled?: boolean;
  activation_amount?: number;
  activation_fee?: number;
  activation_gateway?: string;
}

interface StuckActivation {
  order_id: string;
  agent_id: string;
  full_name: string;
  email: string;
  store_name: string;
  phone: string;
  paid_at: string;
  amount: number;
  paystack_fee?: number;
  payment_method?: string;
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
  const [creditLimits, setCreditLimits] = useState<Record<string, string>>({});
  const [updatingLimit, setUpdatingLimit] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [stuckActivations, setStuckActivations] = useState<StuckActivation[]>([]);
  const [forcingId, setForcingId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [forceEmail, setForceEmail] = useState("");
  const [forcingEmail, setForcingEmail] = useState(false);
  const [pendingSenderIds, setPendingSenderIds] = useState<any[]>([]);
  const [updatingSenderId, setUpdatingSenderId] = useState<string | null>(null);
  const [togglingApi, setTogglingApi] = useState<string | null>(null);
  const PAGE_SIZE = 50;
  const { toast } = useToast();
  const { user: currentUser, session } = useAuth();

  const fetchAgents = useCallback(async (isLoadMore = false) => {
    if (!isLoadMore) {
      setLoading(true);
      setPage(0);
    }
    
    const currentPage = isLoadMore ? page + 1 : 0;
    const from = currentPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("profiles")
      .select("*", { count: "exact" }) as any;

    query = query.eq("is_agent", true);
    query = query.eq("is_sub_agent" as any, false);

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,store_name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    if (filter === "approved") {
      query = query.eq("agent_approved", true);
    } else if (filter === "pending") {
      query = query.eq("agent_approved", false);
    }

    const { data, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);
    const rows = ((data as any[]) || []) as AgentRow[];

    // Fetch wallet balances for this batch only
    const ids = rows.map(r => r.user_id);
    if (ids.length > 0) {
      const [walletsRes, subCountRes, salesRes, activationsRes] = await Promise.all([
        supabase.from("wallets").select("agent_id, balance, api_balance, credit_limit").in("agent_id", ids),
        supabase.from("profiles").select("user_id, parent_agent_id").eq("is_sub_agent" as any, true).in("parent_agent_id" as any, ids),
        supabase.from("user_sales_stats").select("user_id, total_sales_volume, total_own_profit, total_commissions_paid").in("user_id", ids),
        supabase.from("orders").select("agent_id, amount, paystack_fee, payment_method").in("agent_id", ids).in("order_type", ["agent_activation", "sub_agent_activation"]).in("status", ["paid", "fulfilled"]),
      ]);

      const walletMap = new Map((walletsRes.data || []).map((w: any) => [w.agent_id, { balance: w.balance, api_balance: w.api_balance, limit: w.credit_limit }]));
      const salesMap = new Map((salesRes.data || []).map((s: any) => [s.user_id, s]));
      const activationsMap = new Map((activationsRes.data || []).map((a: any) => [a.agent_id, { amount: a.amount, fee: a.paystack_fee, gateway: a.payment_method }]));
      const subCountMap: Record<string, number> = {};
      (subCountRes.data || []).forEach((sa: any) => {
        const pid = sa.parent_agent_id;
        subCountMap[pid] = (subCountMap[pid] || 0) + 1;
      });

      rows.forEach(r => {
        const wallet = walletMap.get(r.user_id) as any;
        r.wallet_balance = wallet?.balance ?? 0;
        r.api_wallet_balance = wallet?.api_balance ?? 0;
        r.credit_limit = wallet?.limit ?? 0;
        r.sub_agent_count = subCountMap[r.user_id] ?? 0;
        
        const stats = salesMap.get(r.user_id) as any;
        r.total_sales_volume = stats?.total_sales_volume ?? 0;
        r.total_own_profit = stats?.total_own_profit ?? 0;
        r.total_commissions_paid = stats?.total_commissions_paid ?? 0;

        const act = activationsMap.get(r.user_id) as any;
        r.activation_amount = act?.amount;
        r.activation_fee = act?.fee;
        r.activation_gateway = act?.gateway;
      });
    }

    setAgents(prev => isLoadMore ? [...prev, ...rows] : rows);
    setHasMore(count ? (from + rows.length < count) : rows.length === PAGE_SIZE);
    if (isLoadMore) setPage(currentPage);

    // Find agents who paid for activation but store is still not activated
    const { data: activationOrders } = await supabase
      .from("orders")
      .select("id, agent_id, created_at, amount, paystack_fee, payment_method")
      .in('status', ['paid', 'pending', 'processing', 'fulfillment_failed'])
      .in('order_type', ['agent_activation', 'sub_agent_activation'])
      .order('created_at', { ascending: false });

    if (activationOrders && activationOrders.length > 0) {
      const paidAgentIds = activationOrders.map((o: any) => o.agent_id).filter(Boolean);
      const { data: unapprovedProfiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, store_name, phone")
        .in("user_id", paidAgentIds)
        .eq("agent_approved", false);

      if (unapprovedProfiles && unapprovedProfiles.length > 0) {
        const unapprovedIds = new Set(unapprovedProfiles.map((p: any) => p.user_id));
        const profileMap = new Map(unapprovedProfiles.map((p: any) => [p.user_id, p]));
        const stuck: StuckActivation[] = activationOrders
          .filter((o: any) => unapprovedIds.has(o.agent_id))
          .map((o: any) => {
            const p: any = profileMap.get(o.agent_id) || {};
            return {
              order_id: o.id,
              agent_id: o.agent_id,
              full_name: p.full_name || "Unknown",
              email: p.email || "",
              store_name: p.store_name || "",
              phone: p.phone || "",
              paid_at: o.created_at,
              amount: Number(o.amount || 0),
              paystack_fee: o.paystack_fee ? Number(o.paystack_fee) : 0,
              payment_method: o.payment_method || "",
            };
          });
        setStuckActivations(stuck);
      } else {
        setStuckActivations([]);
      }
    } else {
      setStuckActivations([]);
    }

    // Fetch pending SMS Sender IDs
    const { data: pendingSenderData } = await supabase
      .from("profiles")
      .select("user_id, full_name, store_name, sms_sender_id")
      .eq("sms_sender_status", "pending")
      .not("sms_sender_id", "is", null);
      
    if (pendingSenderData) {
      setPendingSenderIds(pendingSenderData as any[]);
    } else {
      setPendingSenderIds([]);
    }

    setLoading(false);
  }, [filter, page, search]);

  useEffect(() => {
    const timer = setTimeout(() => fetchAgents(false), 300);
    return () => clearTimeout(timer);
  }, [fetchAgents]);

  // Live updates — refresh when profiles or wallets change (approvals, topups)
  useRealtimeRefresh({ tables: ["profiles", "wallets"], onRefresh: () => fetchAgents(false) });

  const handleApprove = async (userId: string) => {
    setApprovingId(userId);
    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "approve_agent", user_id: userId },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    if (error || data?.error) {
      toast({ title: "Failed to approve", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: "Agent approved" });
      setAgents(prev => prev.map(a => a.user_id === userId ? { ...a, agent_approved: true } : a));
      if (currentUser) await logAudit(currentUser.id, "approve_agent", { target_agent_id: userId });
    }
    setApprovingId(null);
  };

  const handleRevoke = async (userId: string) => {
    setApprovingId(userId);
    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "revoke_agent", user_id: userId },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    if (error || data?.error) {
      toast({ title: "Failed to revoke", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: "Agent access revoked" });
      setAgents(prev => prev.map(a => a.user_id === userId ? { ...a, agent_approved: false } : a));
      if (currentUser) await logAudit(currentUser.id, "revoke_agent", { target_agent_id: userId });
    }
    setApprovingId(null);
  };

  const handleForceActivate = async (agentId: string, name: string) => {
    setForcingId(agentId);
    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "approve_agent", user_id: agentId },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (error || data?.error) {
      console.error("Force activate error:", error || data?.error);
      toast({ 
        title: "Failed to force-activate", 
        description: data?.error || error?.message || "Check server logs", 
        variant: "destructive" 
      });
    } else {
      toast({ title: "Activation Successful", description: `${name}'s store is now active.` });
      await fetchAgents();
    }
    setForcingId(null);
  };

  const handleTopUp = async (agent: AgentRow) => {
    const amount = parseFloat(topupAmount[agent.user_id] || "");
    if (!amount || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" }); return;
    }
    setToppingUp(agent.user_id);

    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "manual_topup", user_id: agent.user_id, amount },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    if (error || data?.error) {
      toast({ title: "Failed to top up", description: data?.error || error?.message, variant: "destructive" });
    } else {
      if (currentUser) {
        await logAudit(currentUser.id, "manual_wallet_topup", {
          target_agent_id: agent.user_id,
          target_agent_name: agent.full_name,
          amount,
          new_balance: data.new_balance,
        });
      }

      toast({ title: `GH₵${amount.toFixed(2)} credited to ${agent.full_name}` });
      setTopupAmount(prev => ({ ...prev, [agent.user_id]: "" }));
      setAgents(prev => prev.map(a => a.user_id === agent.user_id ? { ...a, wallet_balance: data.new_balance } : a));
    }
    setToppingUp(null);
  };

  const handleUpdateCreditLimit = async (agentId: string) => {
    const limit = parseFloat(creditLimits[agentId] || "");
    if (isNaN(limit) || limit < 0) {
      toast({ title: "Enter a valid limit amount", variant: "destructive" }); return;
    }
    setUpdatingLimit(agentId);

    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "update_credit_limit", user_id: agentId, credit_limit: limit },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    if (error || data?.error) {
      toast({ title: "Failed to update credit limit", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: `Credit limit updated to GH₵${limit.toFixed(2)}` });
      setAgents(prev => prev.map(a => a.user_id === agentId ? { ...a, credit_limit: limit } : a));
    }
    setUpdatingLimit(null);
  };
  
  const handleForceApproveByEmail = async () => {
    if (!forceEmail || !forceEmail.includes("@")) {
      toast({ title: "Enter a valid email", variant: "destructive" });
      return;
    }
    
    setForcingEmail(true);
    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "approve_by_email", email: forceEmail.trim() },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    
    if (error || data?.error) {
      toast({ 
        title: "Approval Failed", 
        description: data?.error || error?.message || "User not found", 
        variant: "destructive" 
      });
    } else {
      toast({ title: "Agent Approved", description: `User ${forceEmail} is now an active agent.` });
      setForceEmail("");
      await fetchAgents();
    }
    setForcingEmail(false);
  };

  const handleApproveSenderId = async (userId: string) => {
    setUpdatingSenderId(userId);
    const { error } = await supabase
      .from("profiles")
      .update({ sms_sender_status: 'approved' })
      .eq("user_id", userId);
    if (!error) {
      toast({ title: "Sender ID Approved", description: "You must also register it with your SMS Provider." });
      await fetchAgents(false);
    } else {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    }
    setUpdatingSenderId(null);
  };

  const handleRejectSenderId = async (userId: string) => {
    setUpdatingSenderId(userId);
    const { error } = await supabase
      .from("profiles")
      .update({ sms_sender_status: 'rejected' })
      .eq("user_id", userId);
    if (!error) {
      toast({ title: "Sender ID Rejected" });
      await fetchAgents(false);
    } else {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    }
    setUpdatingSenderId(null);
  };

  const handleToggleApi = async (userId: string, currentVal: boolean) => {
    setTogglingApi(userId);
    const newVal = !currentVal;
    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "toggle_api_access", user_id: userId, enabled: newVal },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    if (error || data?.error) {
      toast({ title: "Failed to toggle API access", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: newVal ? "Developer API Access Enabled" : "Developer API Access Revoked" });
      setAgents(prev => prev.map(a => a.user_id === userId ? { ...a, api_access_enabled: newVal } : a));
      if (currentUser) await logAudit(currentUser.id, newVal ? "enable_api_access" : "revoke_api_access", { target_agent_id: userId });
    }
    setTogglingApi(null);
  };

  const toggleExpand = async (agentId: string) => {
    if (expandedId === agentId) { setExpandedId(null); return; }
    setExpandedId(agentId);
    if (subAgents[agentId]) return;
    setLoadingSubAgents(agentId);
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("parent_agent_id", agentId)
      .order("created_at", { ascending: false });
    setSubAgents(prev => ({ ...prev, [agentId]: (data as any[]) || [] }));
    setLoadingSubAgents(null);
  };

  const filtered = agents;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        <p className="text-muted-foreground text-sm font-medium">Loading agents...</p>
      </div>
    );
  }

  const approvedCount = agents.filter(a => a.agent_approved).length;
  const pendingCount = agents.filter(a => !a.agent_approved).length;

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="font-display text-3xl font-black tracking-tight text-foreground">
            Agent Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Approve, manage wallets, and view sub-agents for all parent agents.</p>
        </div>
        <Button onClick={() => fetchAgents(false)} className="gap-2 bg-secondary text-foreground border border-border rounded-xl shadow-sm hover:bg-secondary/80">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Agents", value: agents.length, color: "text-foreground" },
          { label: "Approved", value: approvedCount, color: "text-emerald-500" },
          { label: "Pending", value: pendingCount, color: "text-amber-500" },
        ].map(s => (
          <div key={s.label} className="rounded-2xl bg-card border border-border shadow-sm p-4 text-center">
            <p className={`font-display text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Force Approve Tool */}
      <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4 flex flex-col sm:flex-row items-center gap-4 shadow-sm">
        <div className="flex-1">
          <p className="text-sm font-black text-amber-600 dark:text-amber-400">Force Approve by Email</p>
          <p className="text-xs text-muted-foreground mt-0.5">Activation orders will be automatically fulfilled.</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Input 
            placeholder="user@example.com" 
            value={forceEmail}
            onChange={(e) => setForceEmail(e.target.value)}
            className="bg-background border-input text-foreground text-sm rounded-xl h-10 w-full sm:w-64 focus:border-amber-500/40"
          />
          <Button 
            onClick={handleForceApproveByEmail}
            disabled={forcingEmail}
            className="bg-amber-400 hover:bg-amber-300 text-black font-bold h-10 px-6 rounded-xl shrink-0 shadow-lg shadow-amber-400/20"
          >
            {forcingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : "Approve"}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, store, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-secondary/50 border-input text-foreground placeholder:text-muted-foreground rounded-xl focus:border-amber-500/40"
          />
        </div>
        <div className="flex gap-2">
          {(["all", "approved", "pending"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all capitalize ${
                filter === f
                  ? "bg-amber-400 text-black shadow-sm"
                  : "bg-secondary/50 text-muted-foreground border border-input hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* ── Pending Sender IDs Banner ── */}
      {pendingSenderIds.length > 0 && (
        <div className="relative group overflow-hidden rounded-[2rem] border border-indigo-500/20 bg-indigo-500/[0.05] shadow-sm animate-in fade-in slide-in-from-top-4 duration-700">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b from-indigo-500 via-indigo-400 to-indigo-600" />
          
          <div className="flex flex-col px-8 py-6">
            <div className="flex items-center gap-5 mb-4">
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0 shadow-xl shadow-indigo-500/5">
                <MessageCircle className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h3 className="font-black text-xl tracking-tight text-foreground">
                  {pendingSenderIds.length} Pending Sender ID{pendingSenderIds.length !== 1 ? "s" : ""}
                </h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Agents have requested custom SMS Sender IDs. Register them with your SMS provider before approving.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pendingSenderIds.map((item) => (
                <div key={item.user_id} className="bg-background/60 border border-border rounded-xl p-4 flex flex-col gap-3">
                  <div>
                    <p className="text-sm font-bold text-foreground truncate">{item.store_name || item.full_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Requested: <span className="font-mono text-indigo-400">{item.sms_sender_id}</span></p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleApproveSenderId(item.user_id)}
                      disabled={updatingSenderId === item.user_id}
                      className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white"
                    >
                      {updatingSenderId === item.user_id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Approve"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRejectSenderId(item.user_id)}
                      disabled={updatingSenderId === item.user_id}
                      className="flex-1"
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Stuck Activations Banner ── */}
      {stuckActivations.length > 0 && (
        <div className="relative group overflow-hidden rounded-[2rem] border border-amber-500/20 bg-amber-500/[0.05] shadow-sm animate-in fade-in slide-in-from-top-4 duration-700">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b from-amber-500 via-amber-400 to-amber-600" />
          
          <div className="flex flex-col lg:flex-row lg:items-center gap-6 px-8 py-6">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 shadow-xl shadow-amber-500/5">
                <Clock className="w-7 h-7 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="font-black text-xl tracking-tight text-foreground">
                  {stuckActivations.length} Pending Approval{stuckActivations.length !== 1 ? "s" : ""}
                </h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  These agents have paid their activation fee and are waiting for your approval.
                </p>
              </div>
            </div>
            
            <div className="flex-1 overflow-x-auto pb-2 lg:pb-0">
              <div className="flex gap-4">
                {stuckActivations.map((s) => (
                  <div key={s.order_id} className="min-w-[300px] rounded-2xl border border-border bg-card p-5 group/item shadow-sm transition-all">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-bold text-sm text-foreground truncate">{s.full_name}</p>
                        <p className="text-[10px] text-muted-foreground font-medium">{s.email}</p>
                      </div>
                      <div className="text-right">
                        <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px] font-black tracking-widest uppercase">
                          GH₵{s.amount}
                        </Badge>
                        {s.paystack_fee !== undefined && (
                          <p className="text-[9px] text-muted-foreground mt-0.5 font-bold">
                            Fee: GH₵{s.paystack_fee.toFixed(2)}
                            {s.payment_method ? ` (${s.payment_method})` : ""}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 pt-3 border-t border-border">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        {s.phone && (
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground truncate">
                            <Phone className="w-3 h-3" /> {s.phone}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground truncate">
                          <Store className="w-3 h-3" /> {s.store_name || "No Store Name"}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleForceActivate(s.agent_id, s.full_name)}
                        disabled={forcingId === s.agent_id}
                        className="h-9 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-black text-[10px] uppercase tracking-widest shrink-0 shadow-lg shadow-amber-400/20"
                      >
                        {forcingId === s.agent_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Approve Store"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Agents list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">No agents found.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((agent) => (
            <div key={agent.user_id} className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
              {/* Agent row */}
              <div className="p-4 flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <p className="font-bold text-foreground text-base">{agent.full_name || "—"}</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {agent.agent_approved ? (
                          <Badge className="gap-1 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20 text-[9px] font-bold">
                            <CheckCircle className="w-2.5 h-2.5" /> Approved
                          </Badge>
                        ) : agent.onboarding_complete ? (
                          <Badge className="gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[9px] font-bold">
                            <Clock className="w-2.5 h-2.5" /> Pending
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-[9px] text-muted-foreground border-border font-bold">
                            <Clock className="w-2.5 h-2.5" /> Onboarding
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                      {agent.store_name ? (
                        <span className="flex items-center gap-1.5 text-amber-500 font-medium bg-amber-500/10 dark:bg-amber-500/5 px-2 py-0.5 rounded border border-amber-500/10">
                          <Store className="w-3.5 h-3.5" /> Store: {agent.store_name}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-blue-400 font-medium bg-blue-500/10 dark:bg-blue-500/5 px-2 py-0.5 rounded border border-blue-500/10">
                          <CheckCircle className="w-3.5 h-3.5" /> Direct Reseller (No Store)
                        </span>
                      )}
                      {agent.phone && (
                        <span className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-muted-foreground/60" /> {agent.phone}
                        </span>
                      )}
                      <span className="truncate">{agent.email}</span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Joined {new Date(agent.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* Actions (Desktop) */}
                  <div className="hidden sm:flex items-center gap-2">
                    <Link
                      to={`/admin/orders?agent=${encodeURIComponent(agent.full_name || agent.email)}`}
                      className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors shadow-sm"
                      title="View Sales History"
                    >
                      <ShoppingCart className="w-4 h-4" />
                    </Link>
                    <a
                      href={`https://wa.me/233${agent.phone?.replace(/^0/, "")}`}
                      target="_blank" rel="noopener noreferrer"
                      className="w-9 h-9 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400 hover:bg-green-500/20 transition-colors shadow-sm"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </a>
                    {agent.agent_approved ? (
                      <Button
                        size="sm" variant="outline"
                        onClick={() => handleRevoke(agent.user_id)}
                        disabled={approvingId === agent.user_id}
                        className="text-xs border-input text-muted-foreground hover:text-red-500 hover:border-red-500/30 h-9 rounded-xl shadow-sm"
                      >
                        {approvingId === agent.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Revoke"}
                      </Button>
                    ) : agent.onboarding_complete ? (
                      <Button
                        size="sm"
                        onClick={() => handleApprove(agent.user_id)}
                        disabled={approvingId === agent.user_id}
                        className="text-xs bg-amber-400 text-black font-bold hover:bg-amber-300 h-9 rounded-xl shadow-lg shadow-amber-400/10"
                      >
                        {approvingId === agent.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Approve"}
                      </Button>
                    ) : null}
                    <button
                      onClick={() => toggleExpand(agent.user_id)}
                      className="w-9 h-9 rounded-xl bg-secondary border border-input flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shadow-sm"
                    >
                      {expandedId === agent.user_id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Stats & Actions (Mobile) */}
                <div className="flex flex-col gap-4 border-t border-border pt-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                    <div className="p-2.5 rounded-xl bg-secondary/30 border border-border">
                        <p className="text-[9px] text-muted-foreground font-black uppercase tracking-widest mb-0.5">Sales Volume</p>
                        <p className="text-sm font-black text-foreground truncate">₵{(agent.total_sales_volume || 0).toFixed(2)}</p>
                      </div>
                      <div className="p-2.5 rounded-xl bg-secondary/30 border border-border">
                        <p className="text-[9px] text-muted-foreground font-black uppercase tracking-widest mb-0.5">Profit Earned</p>
                        <p className="text-sm font-black text-emerald-600 dark:text-emerald-400 truncate">₵{(agent.total_own_profit || 0).toFixed(2)}</p>
                      </div>
                      <div className="p-2.5 rounded-xl bg-secondary/30 border border-border">
                        <p className="text-[9px] text-muted-foreground font-black uppercase tracking-widest mb-0.5">Comms Generated</p>
                        <p className="text-sm font-black text-amber-600 dark:text-amber-400 truncate">₵{(agent.total_commissions_paid || 0).toFixed(2)}</p>
                      </div>
                    <div className="p-2.5 rounded-xl bg-secondary/30 border border-border text-center">
                      <p className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1">Wallet</p>
                      <p className="text-xs font-black text-amber-600 dark:text-amber-400 truncate">₵{(agent.wallet_balance || 0).toFixed(2)}</p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-secondary/30 border border-border text-center">
                      <p className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1">API Balance</p>
                      <p className="text-xs font-black text-cyan-600 dark:text-cyan-400 truncate">₵{(agent.api_wallet_balance || 0).toFixed(2)}</p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-secondary/30 border border-border text-center">
                      <p className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1">Subs</p>
                      <p className="text-xs font-black text-blue-600 dark:text-blue-400">{agent.sub_agent_count ?? 0}</p>
                    </div>
                  </div>

                  <div className="flex sm:hidden items-center gap-2">
                    <Link
                      to={`/admin/orders?agent=${encodeURIComponent(agent.full_name || agent.email)}`}
                      className="flex-1 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xs gap-2"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" /> Sales
                    </Link>
                    <a
                      href={`https://wa.me/233${agent.phone?.replace(/^0/, "")}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex-1 h-10 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400 font-bold text-xs gap-2"
                    >
                      <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                    </a>
                    <button
                      onClick={() => toggleExpand(agent.user_id)}
                      className="w-10 h-10 rounded-xl bg-secondary border border-input flex items-center justify-center text-muted-foreground"
                    >
                      {expandedId === agent.user_id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Approve/Revoke (Mobile) */}
                  <div className="sm:hidden">
                    {agent.agent_approved ? (
                      <Button
                        variant="outline"
                        onClick={() => handleRevoke(agent.user_id)}
                        disabled={approvingId === agent.user_id}
                        className="w-full h-10 border-red-500/20 text-red-400 hover:bg-red-500/10 rounded-xl text-xs font-bold"
                      >
                        {approvingId === agent.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Revoke Access"}
                      </Button>
                    ) : agent.onboarding_complete ? (
                      <Button
                        onClick={() => handleApprove(agent.user_id)}
                        disabled={approvingId === agent.user_id}
                        className="w-full h-10 bg-amber-400 text-black font-bold hover:bg-amber-300 rounded-xl text-xs shadow-lg shadow-amber-400/10"
                      >
                        {approvingId === agent.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Approve Agent"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Expanded section */}
              {expandedId === agent.user_id && (
                <div className="border-t border-border p-4 bg-muted/30 space-y-4">
                  {/* Quick wallet top-up */}
                  <div>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Quick Wallet Top-Up</p>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">GH₵</span>
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={topupAmount[agent.user_id] || ""}
                          onChange={(e) => setTopupAmount(prev => ({ ...prev, [agent.user_id]: e.target.value }))}
                          className="pl-9 w-32 bg-background border-input text-foreground text-sm rounded-xl focus:border-amber-500/40"
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleTopUp(agent)}
                        disabled={toppingUp === agent.user_id}
                        className="bg-amber-400/10 text-amber-600 dark:text-amber-400 hover:bg-amber-400/20 border border-amber-500/20 font-bold rounded-xl"
                      >
                        {toppingUp === agent.user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Wallet className="w-3 h-3 mr-1" /> Credit</>}
                      </Button>
                    </div>
                  </div>

                  {/* Credit Limit (Overdraft) */}
                  <div className="pt-4 border-t border-border">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Credit Limit (Overdraft)</p>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">GH₵</span>
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={creditLimits[agent.user_id] ?? agent.credit_limit ?? ""}
                          onChange={(e) => setCreditLimits(prev => ({ ...prev, [agent.user_id]: e.target.value }))}
                          className="pl-9 w-32 bg-background border-input text-foreground text-sm rounded-xl focus:border-amber-500/40"
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleUpdateCreditLimit(agent.user_id)}
                        disabled={updatingLimit === agent.user_id}
                        className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 font-bold rounded-xl"
                      >
                        {updatingLimit === agent.user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><CheckCircle className="w-3 h-3 mr-1" /> Update Limit</>}
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Allows agent to spend up to this amount after their balance hits zero.
                    </p>
                  </div>

                  {/* MoMo info */}
                  {agent.momo_number && (
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">MoMo Details</p>
                      <p className="text-sm text-foreground font-medium">{agent.momo_network} — {agent.momo_number}</p>
                    </div>
                  )}

                  {/* Activation Payment Details */}
                  {(agent.activation_amount !== undefined || agent.activation_fee !== undefined) && (
                    <div className="pt-4 border-t border-border">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Activation Payment</p>
                      <div className="flex flex-wrap items-center gap-3">
                        {agent.activation_amount !== undefined && (
                          <div className="p-2.5 rounded-xl bg-secondary/30 border border-border">
                            <p className="text-[9px] text-muted-foreground font-black uppercase tracking-widest mb-0.5">Amount Charged</p>
                            <p className="text-sm font-black text-foreground truncate">
                              GH₵{agent.activation_amount.toFixed(2)}
                            </p>
                          </div>
                        )}
                        {agent.activation_fee !== undefined && (
                          <div className="p-2.5 rounded-xl bg-secondary/30 border border-border">
                            <p className="text-[9px] text-muted-foreground font-black uppercase tracking-widest mb-0.5">Payment Fee</p>
                            <p className="text-sm font-black text-amber-600 dark:text-amber-400 truncate">
                              GH₵{agent.activation_fee.toFixed(2)}
                            </p>
                          </div>
                        )}
                        {agent.activation_gateway && (
                          <div className="p-2.5 rounded-xl bg-secondary/30 border border-border">
                            <p className="text-[9px] text-muted-foreground font-black uppercase tracking-widest mb-0.5">Gateway Used</p>
                            <p className="text-sm font-black text-blue-600 dark:text-blue-400 capitalize truncate">
                              {agent.activation_gateway}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Developer API Access */}
                  <div className="pt-4 border-t border-border flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Developer API Access</p>
                      <p className="text-[10px] text-muted-foreground">
                        Allow this agent to authenticate and purchase data via developer API key.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {agent.api_access_enabled ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px] font-bold">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground border-border font-bold">Inactive</Badge>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleApi(agent.user_id, !!agent.api_access_enabled)}
                        disabled={togglingApi === agent.user_id}
                        className={cn(
                          "h-8 text-xs font-bold rounded-xl",
                          agent.api_access_enabled 
                            ? "border-red-500/20 text-red-500 hover:bg-red-500/10" 
                            : "border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/10"
                        )}
                      >
                        {togglingApi === agent.user_id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : agent.api_access_enabled ? (
                          "Disable API"
                        ) : (
                          "Upgrade to API User"
                        )}
                      </Button>
                      {agent.api_access_enabled && (
                        <Link
                          to={`/admin/api-users?search=${encodeURIComponent(agent.email || "")}`}
                          className="h-8 px-3 rounded-xl border border-input text-xs font-bold bg-secondary hover:bg-secondary/80 flex items-center justify-center shadow-sm"
                        >
                          Configure API
                        </Link>
                      )}
                    </div>
                  </div>

                  {/* Sub-agents */}
                  <div>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                      Sub-Agents ({agent.sub_agent_count ?? 0})
                    </p>
                    {loadingSubAgents === agent.user_id ? (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading sub-agents...
                      </div>
                    ) : (subAgents[agent.user_id] || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground/60">No sub-agents yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {(subAgents[agent.user_id] || []).map((sa: any) => (
                          <div key={sa.user_id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 border border-border">
                            <div>
                              <p className="text-sm font-semibold text-foreground">{sa.full_name || "—"}</p>
                              <p className="text-xs text-muted-foreground">{sa.email} • {sa.phone}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {(sa as any).sub_agent_approved ? (
                                <Badge className="text-[10px] bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">Active</Badge>
                              ) : (
                                <Badge className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">Pending</Badge>
                              )}
                              <Users2 className="w-3.5 h-3.5 text-muted-foreground/50" />
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
          {hasMore && (
            <div className="pt-8 flex justify-center">
              <Button
                variant="outline"
                onClick={() => fetchAgents(true)}
                disabled={loading}
                className="bg-secondary border border-input text-foreground rounded-xl px-10 font-black tracking-widest uppercase text-xs shadow-sm"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ChevronDown className="w-4 h-4 mr-2" />}
                Load More Agents
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminAgents;
