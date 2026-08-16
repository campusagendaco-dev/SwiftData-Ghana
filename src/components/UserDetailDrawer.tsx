import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Globe, Clock, Phone, ShieldCheck, Users2, User,
  Wallet, ShoppingCart, AlertTriangle, Gift, Hash,
  Loader2, CheckCircle2, XCircle, AlertCircle, Ban,
  Plus, Minus, TrendingUp, Save, Key, Lock, RefreshCw
} from "lucide-react";

interface UserRow {
  user_id: string;
  full_name: string;
  email: string;
  phone?: string;
  is_agent: boolean;
  agent_approved: boolean;
  is_sub_agent: boolean;
  sub_agent_approved: boolean;
  parent_agent_id: string | null;
  created_at: string;
  last_ip?: string | null;
  last_seen_at?: string | null;
  last_location?: string | null;
  login_count?: number;
  referral_code?: string | null;
  referred_by?: string | null;
  total_sales_volume?: number;
  parent_name?: string;
  is_suspended?: boolean;
  admin_notes?: string | null;
  avatar_url?: string | null;
}

interface Order {
  id: string;
  order_type: string;
  network?: string;
  package_size?: string;
  customer_phone?: string;
  amount: number;
  profit?: number;
  parent_profit?: number;
  status: string;
  failure_reason?: string | null;
  created_at: string;
}

// Matches the same detection logic used on the Non-Beneficiary Hub, the
// general Admin Orders list, and the agent's own Transactions page, so this
// drawer's badges stay consistent with all of them.
function isBeneficiaryFailure(order: Pick<Order, "status" | "failure_reason">): boolean {
  if (order.status !== "fulfillment_failed") return false;
  const reason = (order.failure_reason || "").toLowerCase();
  return reason.includes("beneficiary") || reason.includes("not added");
}

const BENEFICIARY_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  submitted: { label: "in queue", className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  whitelisted: { label: "in queue", className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  in_queue: { label: "in queue", className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
};

interface SharedAccount {
  user_id: string;
  full_name: string;
  email: string;
}

interface DrawerData {
  walletBalance: number;
  apiBalance: number;
  orders: Order[];
  sharedIpAccounts: SharedAccount[];
  referrerName?: string;
  totalSalesVolume?: number;
  totalOwnProfit?: number;
  totalCommissionsPaid?: number;
}

const STATUS_STYLES: Record<string, string> = {
  fulfilled: "text-green-400 bg-green-400/10 border-green-400/20",
  paid: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  pending: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  fulfillment_failed: "text-red-400 bg-red-400/10 border-red-400/20",
  failed: "text-red-400 bg-red-400/10 border-red-400/20",
};

const StatusIcon = ({ status }: { status: string }) => {
  if (status === "fulfilled") return <CheckCircle2 className="w-3 h-3" />;
  if (status === "fulfillment_failed" || status === "failed") return <XCircle className="w-3 h-3" />;
  return <AlertCircle className="w-3 h-3" />;
};

const avatarColor = (name: string) => {
  const colors = ["bg-amber-500", "bg-cyan-500", "bg-violet-500", "bg-emerald-500", "bg-rose-500", "bg-blue-500"];
  const idx = (name?.charCodeAt(0) ?? 0) % colors.length;
  return colors[idx];
};

interface Props {
  user: UserRow | null;
  onClose: () => void;
}

const UserDetailDrawer = ({ user, onClose }: Props) => {
  const { toast } = useToast();
  const { session } = useAuth();
  const [data, setData] = useState<DrawerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSuspended, setIsSuspended] = useState(user?.is_suspended ?? false);
  const [suspending, setSuspending] = useState(false);
  const [adminNotes, setAdminNotes] = useState(user?.admin_notes || "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupLoading, setTopupLoading] = useState(false);
  const [walletType, setWalletType] = useState<"main" | "api">("main");
  // Per-phone beneficiary whitelist status, shared with the Non-Beneficiary
  // Hub, the general Admin Orders list, and the agent's own Transactions page.
  const [beneficiaryStatus, setBeneficiaryStatus] = useState<Record<string, string>>({});

  useEffect(() => {
    setIsSuspended(user?.is_suspended ?? false);
    setAdminNotes(user?.admin_notes || "");
  }, [user?.user_id, user?.admin_notes]);

  const parseEdgeError = async (error: any, resData?: any): Promise<string> => {
    if (resData?.error) return resData.error;
    if (error) {
      try {
        const bodyText = await error.context?.text();
        if (bodyText) {
          const parsed = JSON.parse(bodyText);
          if (parsed.error) return parsed.error;
        }
      } catch {}
      return error.message || "Edge function invocation failed";
    }
    return "Unknown error";
  };

  const handleSuspend = async () => {
    if (!user) return;
    const next = !isSuspended;
    setSuspending(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "bulk_suspend_users", user_ids: [user.user_id], suspend: next },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      
      if (error || res?.error) {
        throw new Error(await parseEdgeError(error, res));
      }

      setIsSuspended(next);
      toast({ title: next ? "User suspended" : "User unsuspended", description: user.email });
    } catch (err: unknown) {
      toast({ title: "Action failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSuspending(false);
    }
  };

  const [promoting, setPromoting] = useState(false);
  const handlePromoteAgent = async () => {
    if (!user) return;
    setPromoting(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "approve_agent", user_id: user.user_id },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || res?.error) {
        throw new Error(await parseEdgeError(error, res));
      }
      
      toast({ title: "User promoted to Agent", description: user.email });
      onClose();
    } catch (err: any) {
      toast({ title: "Promotion failed", description: err.message, variant: "destructive" });
    } finally {
      setPromoting(false);
    }
  };

  const handleManualTopup = async (isDeduction = false) => {
    if (!user || !topupAmount || isNaN(Number(topupAmount))) return;
    const amount = Number(topupAmount) * (isDeduction ? -1 : 1);
    const currentBalance = walletType === "api" ? (data?.apiBalance ?? 0) : (data?.walletBalance ?? 0);
    
    if (isDeduction && Math.abs(amount) > currentBalance) {
       if (!window.confirm("This will result in a negative balance. Continue?")) return;
    }

    setTopupLoading(true);
    try {
      const action = walletType === "api" ? "manual_api_topup" : "manual_topup";
      const { data: res, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: action, user_id: user.user_id, amount: amount },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || res?.error) {
        throw new Error(await parseEdgeError(error, res));
      }
      
      setData(prev => prev ? { 
        ...prev, 
        walletBalance: walletType === "main" ? res.new_balance : prev.walletBalance,
        apiBalance: walletType === "api" ? res.new_balance : prev.apiBalance 
      } : prev);
      setTopupAmount("");
      toast({ 
        title: isDeduction ? `${walletType === "api" ? "API " : ""}Wallet Debited` : `${walletType === "api" ? "API " : ""}Wallet Credited`, 
        description: `${isDeduction ? "Removed" : "Added"} GH₵ ${Math.abs(amount).toFixed(2)} to ${user.full_name}'s ${walletType} wallet.` 
      });
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    } finally {
      setTopupLoading(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!user) return;
    setSavingNotes(true);
    try {
      const { error } = await (supabase as any).from("profiles").update({ admin_notes: adminNotes }).eq("user_id", user.user_id);
      if (error) throw error;
      toast({ title: "Notes updated" });
    } catch (err: any) {
      toast({ title: "Failed to save notes", description: err.message, variant: "destructive" });
    } finally {
      setSavingNotes(false);
    }
  };

  const [mfaLoading, setMfaLoading] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const handleResetMfa = async () => {
    if (!user) return;
    if (!window.confirm(`⚠️ DANGER: Are you sure you want to COMPLETELY DISABLE Multi-Factor Authentication (MFA) for ${user.full_name || user.email}?\n\nThis will remove their active authenticator association and allow them to log in with only their password. Only do this if the user is locked out or has lost their mobile device.`)) {
      return;
    }

    setMfaLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "reset_user_mfa", user_id: user.user_id },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      
      if (error) {
        try {
          const bodyText = await (error as any).context?.text();
          if (bodyText) {
            const parsed = JSON.parse(bodyText);
            if (parsed.error) throw new Error(parsed.error);
          }
        } catch (innerErr: any) {
          if (innerErr.message && innerErr.message !== "Unexpected end of JSON input") throw innerErr;
        }
        throw new Error(error.message || "Edge function failed");
      }
      if (res?.error) throw new Error(res.error);
      
      toast({ 
        title: "MFA/2FA successfully disabled", 
        description: `Removed ${res.reset_count || 0} active MFA factor(s). User can now log in without a 2FA code.` 
      });
    } catch (err: any) {
      toast({ title: "MFA reset failed", description: err.message, variant: "destructive" });
    } finally {
      setMfaLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!user) return;
    const entered = window.prompt(`New password for ${user.email} (min 6 chars). Leave blank to auto-generate.`);
    if (entered !== null && entered.trim() && entered.trim().length < 6) {
      toast({ title: "Password too short", variant: "destructive" }); return;
    }
    setPwLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "reset_password", user_id: user.user_id, new_password: entered?.trim() || undefined },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      
      if (error) {
        try {
          const bodyText = await (error as any).context?.text();
          if (bodyText) {
            const parsed = JSON.parse(bodyText);
            if (parsed.error) throw new Error(parsed.error);
          }
        } catch (innerErr: any) {
          if (innerErr.message && innerErr.message !== "Unexpected end of JSON input") throw innerErr;
        }
        throw new Error(error.message || "Edge function failed");
      }
      if (res?.error) throw new Error(res.error);

      toast({ title: "Password updated successfully", description: `Login: ${user.email}` });
    } catch (err: any) {
      toast({ title: "Failed to reset password", description: err.message, variant: "destructive" });
    } finally {
      setPwLoading(false);
    }
  };

  useEffect(() => {
    if (!user) { setData(null); return; }
    setLoading(true);
    setData(null);

    const load = async () => {
      const queries: Promise<any>[] = [
        supabase.from("wallets").select("balance, api_balance").eq("agent_id", user.user_id).maybeSingle(),
        supabase.from("orders").select("id, order_type, network, package_size, customer_phone, amount, profit, parent_profit, status, failure_reason, created_at")
          .eq("agent_id", user.user_id).order("created_at", { ascending: false }).limit(15),
        user.last_ip
          ? (supabase.from("profiles") as any).select("user_id, full_name, email").eq("last_ip", user.last_ip).neq("user_id", user.user_id).limit(5)
          : Promise.resolve({ data: [] }),
        user.referred_by
          ? supabase.from("profiles").select("full_name").eq("user_id", user.referred_by).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("user_sales_stats").select("total_sales_volume, total_own_profit, total_commissions_paid").eq("user_id", user.user_id).maybeSingle(),
      ];

      const [walletRes, ordersRes, sharedRes, referrerRes, salesStatsRes] = await Promise.all(queries);
      const orders = (ordersRes.data || []) as Order[];

      setData({
        walletBalance: Number(walletRes.data?.balance ?? 0),
        apiBalance: Number(walletRes.data?.api_balance ?? 0),
        orders,
        sharedIpAccounts: (sharedRes.data || []) as SharedAccount[],
        referrerName: referrerRes.data?.full_name ?? undefined,
        totalSalesVolume: Number(salesStatsRes.data?.total_sales_volume ?? 0),
        totalOwnProfit: Number(salesStatsRes.data?.total_own_profit ?? 0),
        totalCommissionsPaid: Number(salesStatsRes.data?.total_commissions_paid ?? 0),
      });
      setLoading(false);

      setBeneficiaryStatus({});
    };

    void load();
  }, [user?.user_id]);

  // Live updates for beneficiary submission status while the drawer is open.
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("user-drawer-beneficiary-status-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "beneficiary_submissions" },
        (payload: any) => {
          const row = payload.new;
          if (!row?.phone_number) return;
          setBeneficiaryStatus((prev) => ({ ...prev, [row.phone_number]: row.status }));
        }
      )
      .subscribe();
    return () => { safeRemoveChannel(ch); };
  }, [user?.user_id]);

  if (!user) return null;

  const initials = (user.full_name || user.email || "?")
    .split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();

  const roleLabel = user.is_sub_agent
    ? user.sub_agent_approved ? "Sub-Agent" : "Sub-Agent (Pending)"
    : user.is_agent
    ? user.agent_approved ? "Agent" : "Agent (Pending)"
    : "Customer";

  const roleColor = user.is_sub_agent
    ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
    : user.is_agent
    ? "bg-green-500/20 text-green-400 border-green-500/30"
    : "bg-white/5 text-white/40 border-white/10";

  const flags = [
    isSuspended && { type: "danger", label: "This account is suspended", sub: "" },
    data && data.sharedIpAccounts.length > 0 && {
      type: "danger",
      label: `IP shared with ${data.sharedIpAccounts.length} other account${data.sharedIpAccounts.length > 1 ? "s" : ""}`,
      sub: data.sharedIpAccounts.map(a => a.email).join(", "),
    },
    !user.phone && { type: "warn", label: "No phone number on file", sub: "" },
    user.is_agent && !user.agent_approved && { type: "warn", label: "Agent approval pending", sub: "" },
    user.is_sub_agent && !user.sub_agent_approved && { type: "warn", label: "Sub-agent approval pending", sub: "" },
  ].filter(Boolean) as { type: string; label: string; sub: string }[];

  return (
    <Sheet open={!!user} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto bg-[#0a0a12] border-white/10 p-0"
      >
        {/* ── Header ── */}
        <div className="p-6 border-b border-white/5">
          <SheetHeader>
            <SheetTitle className="sr-only">User Detail</SheetTitle>
            <SheetDescription className="sr-only">
              Detailed information and management options for user {user.full_name || user.user_id}.
            </SheetDescription>
          </SheetHeader>
          <div className="flex items-start gap-4">
            <Avatar className="w-14 h-14 rounded-2xl border-2 border-primary/20 shrink-0">
              <AvatarImage src={user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.user_id}`} />
              <AvatarFallback className={`${avatarColor(user.full_name)} text-white font-black text-lg`}>
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="font-black text-white text-lg leading-tight truncate">{user.full_name || "—"}</p>
              <p className="text-xs text-white/40 truncate">{user.email}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${roleColor}`}>{roleLabel}</span>
                {isSuspended && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-500/20 text-red-400 border-red-500/30">Suspended</span>
                )}
                <span className="text-[10px] text-white/30">Joined {new Date(user.created_at).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleSuspend}
                disabled={suspending}
                className={`shrink-0 h-8 text-xs gap-1.5 rounded-xl border ${
                  isSuspended
                    ? "bg-green-500/10 text-green-400 border-green-500/30 hover:bg-green-500/20"
                    : "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
                }`}
              >
                {suspending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                {isSuspended ? "Unsuspend" : "Suspend"}
              </Button>
              
              {!user.agent_approved && (
                <Button
                  onClick={handlePromoteAgent}
                  disabled={promoting}
                  className="shrink-0 h-8 text-xs gap-1.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
                >
                  {promoting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                  {user.is_agent ? "Approve Agent" : "Make Agent"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ── Flags ── */}
        {flags.length > 0 && (
          <div className="px-6 pt-4 space-y-2">
            {flags.map((flag, i) => (
              <div
                key={i}
                className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-xs ${
                  flag.type === "danger"
                    ? "bg-red-500/10 border-red-500/25 text-red-400"
                    : "bg-amber-500/10 border-amber-500/25 text-amber-400"
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold">{flag.label}</p>
                  {flag.sub && <p className="text-[10px] opacity-70 mt-0.5 font-mono">{flag.sub}</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Admin Notes ── */}
        <div className="px-6 pt-5">
           <div className="flex items-center justify-between mb-2">
             <p className="text-[10px] font-black uppercase tracking-widest text-amber-500 flex items-center gap-1.5">
               <ShieldCheck className="w-3 h-3" /> Admin Notes
             </p>
             {adminNotes !== (user.admin_notes || "") && (
               <button 
                 onClick={handleSaveNotes} 
                 disabled={savingNotes}
                 className="text-[10px] font-bold text-amber-500 hover:text-amber-400 disabled:opacity-50"
               >
                 {savingNotes ? "Saving..." : "Save Notes"}
               </button>
             )}
           </div>
           <textarea
             value={adminNotes}
             onChange={(e) => setAdminNotes(e.target.value)}
             placeholder="Private notes about this user..."
             className="w-full min-h-[80px] bg-white/[0.02] border border-white/5 rounded-xl p-3 text-xs text-white/70 placeholder:text-white/20 focus:outline-none focus:border-amber-500/30 transition-colors"
           />
        </div>

        {/* ── Stats ── */}
        <div className="px-6 pt-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { icon: Wallet, label: "Main Wallet", value: loading ? "…" : `GH₵ ${(data?.walletBalance ?? 0).toFixed(2)}`, color: "text-cyan-400" },
              { icon: ShieldCheck, label: "API Wallet", value: loading ? "…" : `GH₵ ${(data?.apiBalance ?? 0).toFixed(2)}`, color: "text-emerald-400" },
              { icon: ShoppingCart, label: "Total Sales", value: loading ? "…" : `GH₵ ${(data?.totalSalesVolume ?? 0).toFixed(2)}`, color: "text-blue-400" },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className="rounded-xl bg-white/[0.03] border border-white/5 p-3 text-center">
                <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
                <p className={`text-sm font-black ${color}`}>{value}</p>
                <p className="text-[10px] text-white/30 uppercase tracking-wider mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: TrendingUp, label: "Direct Profit", value: loading ? "…" : `GH₵ ${(data?.totalOwnProfit ?? 0).toFixed(2)}`, color: "text-emerald-400" },
              { icon: Users2, label: "Sub Comms", value: loading ? "…" : `GH₵ ${(data?.totalCommissionsPaid ?? 0).toFixed(2)}`, color: "text-purple-400" },
              { icon: Hash, label: "Logins", value: String(user.login_count ?? 0), color: "text-amber-400" },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className="rounded-xl bg-white/[0.03] border border-white/5 p-3 text-center">
                <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
                <p className={`text-xs sm:text-sm font-black ${color}`}>{value}</p>
                <p className="text-[10px] text-white/30 uppercase tracking-wider mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Wallet Management ── */}
        <div className="px-6 pt-5">
           <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400 mb-3 flex items-center gap-1.5">
             <Wallet className="w-3 h-3" /> Manage Wallet
           </p>
           <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 space-y-4">
              
              {/* Wallet Toggle */}
              <div className="flex gap-1.5 p-1 bg-black/40 border border-white/5 rounded-xl mb-1">
                <button
                  type="button"
                  onClick={() => setWalletType("main")}
                  className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${walletType === "main" ? "bg-cyan-500 text-black" : "text-white/40 hover:text-white hover:bg-white/5"}`}
                >
                  Main Wallet
                </button>
                <button
                  type="button"
                  onClick={() => setWalletType("api")}
                  className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${walletType === "api" ? "bg-emerald-500 text-black" : "text-white/40 hover:text-white hover:bg-white/5"}`}
                >
                  API Wallet
                </button>
              </div>

              <div className="flex items-center gap-3">
                 <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-xs font-bold">GH₵</span>
                    <input 
                      type="number"
                      value={topupAmount}
                      onChange={(e) => setTopupAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                    />
                 </div>
                 <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleManualTopup(false)}
                      disabled={topupLoading || !topupAmount}
                      className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl px-4 h-10 gap-2 shadow-lg shadow-emerald-500/10"
                    >
                      {topupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      <span className="hidden sm:inline">Add</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleManualTopup(true)}
                      disabled={topupLoading || !topupAmount}
                      className="border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-xl px-4 h-10 gap-2"
                    >
                      {topupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Minus className="w-4 h-4" />}
                      <span className="hidden sm:inline">Deduct</span>
                    </Button>
                 </div>
              </div>
              <p className="text-[10px] text-white/30 italic px-1">
                * Users will receive an SMS notification for manual top-ups.
              </p>
           </div>
        </div>

        {/* ── Account Security ── */}
        <div className="px-6 pt-5">
           <p className="text-[10px] font-black uppercase tracking-widest text-rose-400 mb-3 flex items-center gap-1.5">
             <Lock className="w-3 h-3" /> Security & Authentication
           </p>
           <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4">
              <p className="text-[11px] text-white/40 mb-3 leading-relaxed">
                If a user loses their authenticator device or gets locked out of their account, you can manually disable their Multi-Factor security or trigger a credentials reset.
              </p>
              <div className="grid grid-cols-2 gap-3">
                 <Button
                   variant="outline"
                   onClick={handleResetMfa}
                   disabled={mfaLoading}
                   className="border-rose-500/20 text-rose-400 hover:bg-rose-500/10 rounded-xl h-10 text-xs gap-2 shadow-sm"
                 >
                   {mfaLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                   Reset MFA/2FA
                 </Button>
                 <Button
                   variant="outline"
                   onClick={handleResetPassword}
                   disabled={pwLoading}
                   className="border-white/10 text-white/80 hover:bg-white/5 rounded-xl h-10 text-xs gap-2 shadow-sm"
                 >
                   {pwLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                   Reset Password
                 </Button>
              </div>
           </div>
        </div>

        {/* ── Profile Details ── */}
        <div className="px-6 pt-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-3">Profile</p>
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 divide-y divide-white/5 text-xs">
            {[
              { icon: Phone, label: "Phone", value: user.phone || "—" },
              { icon: Globe, label: "Last IP", value: user.last_ip || "Never logged in", mono: true, flag: data && data.sharedIpAccounts.length > 0 },
              { icon: Globe, label: "Location", value: user.last_location || "—", mono: false },
              { icon: Clock, label: "Last Seen", value: user.last_seen_at ? new Date(user.last_seen_at).toLocaleString() : "—" },
              { icon: Gift, label: "Referral Code", value: user.referral_code || "—", mono: true },
              { icon: User, label: "Referred By", value: data?.referrerName || (user.referred_by ? "Loading…" : "—") },
              { icon: user.is_sub_agent ? Users2 : ShieldCheck, label: "Parent Agent", value: user.parent_name || "—" },
            ].map(({ icon: Icon, label, value, mono, flag }) => (
              <div key={label} className="flex items-center justify-between px-4 py-2.5 gap-3">
                <div className="flex items-center gap-2 text-white/40 shrink-0">
                  <Icon className="w-3.5 h-3.5" />
                  <span className="uppercase tracking-wider text-[10px] font-bold">{label}</span>
                </div>
                <span className={`text-right truncate max-w-[55%] ${mono ? "font-mono" : ""} ${flag ? "text-red-400" : "text-white/70"}`}>
                  {value}
                  {flag && <AlertTriangle className="w-3 h-3 inline ml-1" />}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Recent Orders ── */}
        <div className="px-6 pt-5 pb-10">
          <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-3">Recent Orders</p>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-white/30" />
            </div>
          ) : !data || data.orders.length === 0 ? (
            <p className="text-xs text-white/30 text-center py-6">No orders yet</p>
          ) : (
            <div className="space-y-2">
              {data.orders.map((order) => {
                const phoneStatus = isBeneficiaryFailure(order) && order.customer_phone
                  ? beneficiaryStatus[order.customer_phone]
                  : undefined;
                const override = phoneStatus ? BENEFICIARY_STATUS_BADGE[phoneStatus] : undefined;
                const style = override?.className || STATUS_STYLES[order.status] || "text-white/40 bg-white/5 border-white/10";
                const label = override?.label || order.status.replace(/_/g, " ");
                return (
                  <div key={order.id} className="rounded-xl bg-white/[0.02] border border-white/5 px-3 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-white truncate">
                        {order.network && order.package_size
                          ? `${order.network} ${order.package_size}`
                          : order.order_type.replace(/_/g, " ")}
                      </p>
                      <p className="text-[10px] text-white/35 font-mono truncate">
                        {order.customer_phone || order.id.slice(0, 8)}
                        {" · "}
                        {new Date(order.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-black text-white/80">GH₵{Number(order.amount).toFixed(2)}</p>
                      {Number(order.profit || 0) > 0 && (
                        <p className="text-[10px] font-bold text-emerald-400">+GH₵{Number(order.profit).toFixed(2)} profit</p>
                      )}
                      {Number(order.parent_profit || 0) > 0 && (
                        <p className="text-[9px] font-bold text-purple-400">+GH₵{Number(order.parent_profit || 0).toFixed(2)} parent comm</p>
                      )}
                    </div>
                    <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${style}`}>
                      {override ? <Clock className="w-3 h-3" /> : <StatusIcon status={order.status} />}
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default UserDetailDrawer;
