import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Globe, Clock, Phone, ShieldCheck, Users2, User,
  Wallet, ShoppingCart, AlertTriangle, Gift, Hash,
  Loader2, CheckCircle2, XCircle, AlertCircle, Ban,
  Plus, Minus, TrendingUp, Save
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
}

interface Order {
  id: string;
  order_type: string;
  network?: string;
  package_size?: string;
  customer_phone?: string;
  amount: number;
  status: string;
  created_at: string;
}

interface SharedAccount {
  user_id: string;
  full_name: string;
  email: string;
}

interface DrawerData {
  walletBalance: number;
  orders: Order[];
  sharedIpAccounts: SharedAccount[];
  referrerName?: string;
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
  const [data, setData] = useState<DrawerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSuspended, setIsSuspended] = useState(user?.is_suspended ?? false);
  const [suspending, setSuspending] = useState(false);
  const [adminNotes, setAdminNotes] = useState(user?.admin_notes || "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupLoading, setTopupLoading] = useState(false);

  useEffect(() => {
    setIsSuspended(user?.is_suspended ?? false);
    setAdminNotes(user?.admin_notes || "");
  }, [user?.user_id, user?.admin_notes]);

  const handleSuspend = async () => {
    if (!user) return;
    const next = !isSuspended;
    setSuspending(true);
    try {
      const [rpcRes, adminRes] = await Promise.all([
        (supabase as any).rpc("toggle_user_suspension", { p_user_id: user.user_id, p_suspend: next }),
        supabase.auth.getUser(),
      ]);
      if (rpcRes.error) throw new Error(rpcRes.error.message);
      await (supabase as any).from("admin_action_log").insert({
        admin_id: adminRes.data?.user?.id,
        admin_email: adminRes.data?.user?.email,
        action: next ? "suspend_user" : "unsuspend_user",
        target_user_id: user.user_id,
        target_email: user.email,
        metadata: { name: user.full_name },
      });
      setIsSuspended(next);
      toast({ title: next ? "User suspended" : "User unsuspended", description: user.email });
    } catch (err: unknown) {
      toast({ title: "Action failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSuspending(false);
    }
  };

  const handleManualTopup = async (isDeduction = false) => {
    if (!user || !topupAmount || isNaN(Number(topupAmount))) return;
    const amount = Number(topupAmount) * (isDeduction ? -1 : 1);
    
    if (isDeduction && Math.abs(amount) > (data?.walletBalance ?? 0)) {
       if (!window.confirm("This will result in a negative balance. Continue?")) return;
    }

    setTopupLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("admin-user-actions", {
        body: { action: "manual_topup", user_id: user.user_id, amount: amount },
      });
      if (error || res?.error) throw new Error(res?.error || error?.message);
      
      setData(prev => prev ? { ...prev, walletBalance: res.new_balance } : prev);
      setTopupAmount("");
      toast({ 
        title: isDeduction ? "Wallet Debited" : "Wallet Credited", 
        description: `${isDeduction ? "Removed" : "Added"} GH₵ ${Math.abs(amount).toFixed(2)} to ${user.full_name}'s wallet.` 
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

  useEffect(() => {
    if (!user) { setData(null); return; }
    setLoading(true);
    setData(null);

    const load = async () => {
      const queries: Promise<any>[] = [
        supabase.from("wallets").select("balance").eq("agent_id", user.user_id).maybeSingle(),
        supabase.from("orders").select("id, order_type, network, package_size, customer_phone, amount, status, created_at")
          .eq("agent_id", user.user_id).order("created_at", { ascending: false }).limit(15),
        user.last_ip
          ? (supabase.from("profiles") as any).select("user_id, full_name, email").eq("last_ip", user.last_ip).neq("user_id", user.user_id).limit(5)
          : Promise.resolve({ data: [] }),
        user.referred_by
          ? supabase.from("profiles").select("full_name").eq("user_id", user.referred_by).maybeSingle()
          : Promise.resolve({ data: null }),
      ];

      const [walletRes, ordersRes, sharedRes, referrerRes] = await Promise.all(queries);

      setData({
        walletBalance: Number(walletRes.data?.balance ?? 0),
        orders: (ordersRes.data || []) as Order[],
        sharedIpAccounts: (sharedRes.data || []) as SharedAccount[],
        referrerName: referrerRes.data?.full_name ?? undefined,
      });
      setLoading(false);
    };

    void load();
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
          </SheetHeader>
          <div className="flex items-start gap-4">
            <div className={`w-14 h-14 rounded-2xl ${avatarColor(user.full_name)} flex items-center justify-center text-white font-black text-lg shrink-0`}>
              {initials}
            </div>
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
        <div className="px-6 pt-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Wallet, label: "Wallet", value: loading ? "…" : `GH₵ ${(data?.walletBalance ?? 0).toFixed(2)}`, color: "text-cyan-400" },
              { icon: ShoppingCart, label: "Orders", value: loading ? "…" : String(data?.orders.length ?? 0) + (data && data.orders.length === 15 ? "+" : ""), color: "text-violet-400" },
              { icon: Hash, label: "Logins", value: String(user.login_count ?? 0), color: "text-amber-400" },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className="rounded-xl bg-white/[0.03] border border-white/5 p-3 text-center">
                <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
                <p className={`text-sm font-black ${color}`}>{value}</p>
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
                const style = STATUS_STYLES[order.status] || "text-white/40 bg-white/5 border-white/10";
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
                    <p className="text-xs font-black text-white/70 shrink-0">GH₵{Number(order.amount).toFixed(2)}</p>
                    <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${style}`}>
                      <StatusIcon status={order.status} />
                      {order.status.replace(/_/g, " ")}
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
