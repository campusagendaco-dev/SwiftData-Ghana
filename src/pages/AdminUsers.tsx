import { useEffect, useState, useCallback } from "react";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/utils/auditLogger";
import { Loader2, Search, RefreshCw, Phone, User, ShieldCheck, Users2, ShoppingCart, ChevronDown, Globe, Clock, Ban, MessageCircle, Wallet, Eye } from "lucide-react";
import UserDetailDrawer from "@/components/UserDetailDrawer";

interface UserRow {
  user_id: string;
  full_name: string;
  email: string;
  phone?: string;
  is_agent: boolean;
  agent_approved: boolean;
  onboarding_complete: boolean;
  is_sub_agent: boolean;
  sub_agent_approved: boolean;
  parent_agent_id: string | null;
  created_at: string;
  last_ip?: string | null;
  last_seen_at?: string | null;
  last_location?: string | null;
  login_count?: number;
  parent_name?: string;
  total_sales_volume?: number;
  wallet_balance?: number;
  api_wallet_balance?: number;
  is_suspended?: boolean;
  avatar_url?: string | null;
  has_mfa?: boolean;
}

type RoleTab = "all" | "customers" | "agents" | "sub-agents";

const AdminUsers = () => {
  const { isDark } = useAppTheme();
  const { toast } = useToast();
  const { user: currentUser, session } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<RoleTab>("all");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 50;
  const [actionLoading, setActionLoading] = useState<Record<string, "reset" | "delete" | "approve-sub" | "approve-agent" | "impersonate" | null>>({});
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);

  const fetchUsers = useCallback(async (isLoadMore = false) => {
    if (!isLoadMore) {
      setLoading(true);
      setPage(0);
    }
    
    const currentPage = isLoadMore ? page + 1 : 0;
    const from = currentPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = supabase
      .from("profiles")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (search) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search.trim());
      if (isUuid) {
        q = q.eq("user_id", search.trim());
      } else {
        q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
      }
    }

    if (tab === "customers") {
      q = q.eq("is_agent", false).eq("is_sub_agent" as any, false);
    } else if (tab === "agents") {
      q = q.eq("is_agent", true).eq("is_sub_agent" as any, false);
    } else if (tab === "sub-agents") {
      q = q.eq("is_sub_agent" as any, true);
    }

    const { data, count } = await q;
    const rows = ((data as any[]) || []) as UserRow[];
    setTotalCount(count || 0);

    const userIds = rows.map(r => r.user_id);
    if (userIds.length > 0) {
      const parentIds = [...new Set(rows.filter(r => r.parent_agent_id).map(r => r.parent_agent_id as string))];
      const [parentsRes, salesRes, walletsRes, mfaRes] = await Promise.all([
        parentIds.length > 0 ? supabase.from("profiles").select("user_id, full_name").in("user_id", parentIds) : Promise.resolve({ data: [] }),
        supabase.from("orders").select("agent_id, amount").eq("status", "fulfilled").in("agent_id", userIds),
        supabase.from("wallets").select("agent_id, balance, api_balance").in("agent_id", userIds),
        Promise.resolve(supabase.from("user_mfa_status").select("user_id, has_mfa").in("user_id", userIds)).catch(() => ({ data: [] })),
      ]);
      const parentMap = new Map((parentsRes.data || []).map((p: any) => [p.user_id, p.full_name]));
      
      const salesMap = new Map();
      (salesRes.data || []).forEach((s: any) => {
        if (s.agent_id && s.amount) {
          salesMap.set(s.agent_id, (salesMap.get(s.agent_id) || 0) + Number(s.amount));
        }
      });
      
      const walletMap = new Map((walletsRes.data || []).map((w: any) => [w.agent_id, w]));
      const mfaMap = new Map((mfaRes?.data || []).map((m: any) => [m.user_id, m.has_mfa]));
      rows.forEach(r => {
        if (r.parent_agent_id) r.parent_name = parentMap.get(r.parent_agent_id) || "Unknown";
        r.total_sales_volume = salesMap.get(r.user_id) ?? 0;
        const wallet = walletMap.get(r.user_id);
        r.wallet_balance = Number(wallet?.balance ?? 0);
        r.api_wallet_balance = Number(wallet?.api_balance ?? 0);
        r.has_mfa = mfaMap.get(r.user_id) || false;
      });
    }

    setUsers(prev => isLoadMore ? [...prev, ...rows] : rows);
    setHasMore(count ? (from + rows.length < count) : rows.length === PAGE_SIZE);
    if (isLoadMore) setPage(currentPage);
    setLoading(false);
  }, [page, search, tab]);

  useEffect(() => { 
    const timer = setTimeout(() => fetchUsers(false), 300);
    return () => clearTimeout(timer);
  }, [tab, search]);

  const setRowAction = (userId: string, action: UserRow["is_agent"] extends boolean ? any : any) => {
    setActionLoading((prev) => ({ ...prev, [userId]: action }));
  };

  const handleApproveAgent = async (row: UserRow) => {
    setRowAction(row.user_id, "approve-agent");
    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "approve_agent", user_id: row.user_id },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    if (error || data?.error) {
      toast({ title: "Failed to approve agent", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: "Agent approved" });
      setUsers(prev => prev.map(u => u.user_id === row.user_id ? { ...u, agent_approved: true } : u));
      if (currentUser) await logAudit(currentUser.id, "approve_agent", { target_user_id: row.user_id });
    }
    setRowAction(row.user_id, null);
  };

  const handleApproveSubAgent = async (row: UserRow) => {
    if (!row.parent_agent_id) {
      toast({ title: "Missing parent agent", variant: "destructive" }); return;
    }
    setRowAction(row.user_id, "approve-sub");

    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "approve_sub_agent", user_id: row.user_id },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    if (error || data?.error) {
      toast({ title: "Failed to approve sub-agent", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: "Sub-agent approved", description: "User can now access dashboard." });
      setUsers(prev => prev.map(u => u.user_id === row.user_id
        ? { ...u, is_agent: true, agent_approved: true, onboarding_complete: true, sub_agent_approved: true } : u));
      if (currentUser) await logAudit(currentUser.id, "approve_sub_agent", { target_user_id: row.user_id });
    }
    setRowAction(row.user_id, null);
  };

  const handleResetPassword = async (row: UserRow) => {
    const entered = window.prompt(`New password for ${row.email} (min 6 chars). Leave blank to auto-generate.`);
    if (entered !== null && entered.trim() && entered.trim().length < 6) {
      toast({ title: "Password too short", variant: "destructive" }); return;
    }
    setRowAction(row.user_id, "reset");
    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body: { action: "reset_password", user_id: row.user_id, new_password: entered?.trim() || undefined },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (error || data?.error) {
      const msg = data?.error || error?.message || "Unknown error";
      toast({ title: "Failed to reset password", description: msg, variant: "destructive" });
    } else {
      if (currentUser) {
        await logAudit(currentUser.id, "reset_password", { target_user_id: row.user_id, target_email: row.email });
      }
      toast({ title: `Password reset for ${row.email}` });
    }
    setRowAction(row.user_id, null);
  };

  const handleImpersonateUser = async (row: UserRow) => {
    if (!window.confirm(`Impersonate ${row.email}? You will be logged in as this user.`)) return;
    setRowAction(row.user_id, "impersonate");
    try {
      const { data, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "impersonate_user", user_id: row.user_id },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });

      if (error || data?.error) throw new Error(data?.error || error?.message);

      if (data?.magic_link) {
        toast({ title: "Redirecting...", description: "Swapping session to user mode." });
        // Set a flag in session storage so the app knows it's an impersonation
        sessionStorage.setItem("impersonating", "true");
        sessionStorage.setItem("admin_token", session?.access_token || "");
        
        // Use magic link to log in as user
        window.location.href = data.magic_link;
      }
    } catch (err: any) {
      toast({ title: "Impersonation failed", description: err.message, variant: "destructive" });
    } finally {
      setRowAction(row.user_id, null);
    }
  };

  const getRoleBadge = (user: UserRow) => {
    if ((user as any).is_sub_agent) {
      return user.sub_agent_approved
        ? <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">Sub-Agent</Badge>
        : <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">Sub-Agent (Pending)</Badge>;
    }
    if (user.is_agent) {
      return user.agent_approved
        ? <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]">Agent</Badge>
        : <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">Agent (Pending)</Badge>;
    }
    return <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">Customer</Badge>;
  };

  const tabCounts = {
    all: tab === "all" ? totalCount : 0,
    customers: tab === "customers" ? totalCount : 0,
    agents: tab === "agents" ? totalCount : 0,
    "sub-agents": tab === "sub-agents" ? totalCount : 0,
  };

  const filtered = users;

  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const toggleSelectAll = () => {
    if (selectedUsers.length === users.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(users.map(u => u.user_id));
    }
  };

  const toggleSelectUser = (userId: string, e: React.MouseEvent | React.ChangeEvent) => {
    if (e && 'stopPropagation' in e) e.stopPropagation();
    setSelectedUsers(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
  };

  const handleBulkSuspend = async (suspend: boolean) => {
    if (!selectedUsers.length) return;
    setBulkActionLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "bulk_suspend_users", user_ids: selectedUsers, suspend },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error) {
        let msg = error.message;
        try {
          const bodyText = await (error as any).context?.text();
          if (bodyText) {
            const parsed = JSON.parse(bodyText);
            if (parsed.error) msg = parsed.error;
          }
        } catch {}
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);

      toast({ title: suspend ? "Users Suspended" : "Users Restored", description: `${selectedUsers.length} users updated.` });
      setUsers(prev => prev.map(u => selectedUsers.includes(u.user_id) ? { ...u, is_suspended: suspend } : u));
      setSelectedUsers([]);
    } catch (err: any) {
      toast({ title: "Bulk action failed", description: err.message, variant: "destructive" });
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleToggleUserSuspend = async (user: UserRow) => {
    const next = !user.is_suspended;
    setRowAction(user.user_id, "suspend");
    try {
      const { data, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "bulk_suspend_users", user_ids: [user.user_id], suspend: next },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });

      if (error) {
        let msg = error.message;
        try {
          const bodyText = await (error as any).context?.text();
          if (bodyText) {
            const parsed = JSON.parse(bodyText);
            if (parsed.error) msg = parsed.error;
          }
        } catch {}
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);

      toast({ title: next ? "User suspended" : "User restored", description: user.email });
      setUsers(prev => prev.map(u => u.user_id === user.user_id ? { ...u, is_suspended: next } : u));
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    } finally {
      setRowAction(user.user_id, null);
    }
  };

  const handleBulkSMS = async () => {
    if (!selectedUsers.length) return;
    const msg = window.prompt(`Enter SMS message for ${selectedUsers.length} users:`);
    if (!msg) return;
    setBulkActionLoading(true);
    try {
      const selectedProfiles = users.filter(u => selectedUsers.includes(u.user_id) && u.phone);
      if (!selectedProfiles.length) {
        toast({ title: "No phone numbers", description: "Selected users don't have phone numbers.", variant: "destructive" });
        return;
      }
      const { error } = await supabase.functions.invoke("admin-send-sms", {
        body: { 
          recipients: selectedProfiles.map(u => u.phone),
          message: msg,
          broadcast: true
        }
      });
      if (error) throw error;
      toast({ title: "Bulk SMS Sent", description: `Message queued for ${selectedProfiles.length} users.` });
      setSelectedUsers([]);
    } catch (err: any) {
      toast({ title: "Bulk SMS failed", description: err.message, variant: "destructive" });
    } finally {
      setBulkActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
        <p className="text-muted-foreground text-sm font-medium">Loading users...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b pb-6 ${isDark ? "border-white/5" : "border-gray-200"}`}>
        <div>
          <h1 className={`font-display text-3xl font-black tracking-tight ${isDark ? "bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent" : "text-gray-900"}`}>
            User Management
          </h1>
          <p className={`text-sm mt-1 ${isDark ? "text-white/50" : "text-gray-500"}`}>Manage all platform users — customers, agents, and sub-agents.</p>
        </div>
        <Button onClick={() => fetchUsers()} variant={isDark ? "outline" : "default"} title="Refresh user list" className={isDark ? "gap-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl" : "gap-2 rounded-xl shadow-sm"}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {/* Role tabs */}
      <div className="flex flex-wrap gap-2">
        {([
          { key: "all", icon: User, label: "All Users" },
          { key: "customers", icon: User, label: "Customers" },
          { key: "agents", icon: ShieldCheck, label: "Agents" },
          { key: "sub-agents", icon: Users2, label: "Sub-Agents" },
        ] as { key: RoleTab; icon: any; label: string }[]).map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            title={`View ${label}`}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all border shadow-sm ${
              tab === key
                ? "bg-amber-400/20 text-amber-700 dark:text-amber-400 border-amber-400/30"
                : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-secondary"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            <span className={`text-xs rounded-full px-1.5 py-0.5 font-bold ${tab === key ? "bg-amber-400/30 text-amber-800 dark:text-amber-400" : "bg-secondary text-muted-foreground"}`}>
              {tabCounts[key]}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, email, phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          title="Search users"
          className="pl-9 rounded-xl border-input bg-card shadow-sm"
        />
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="p-4 w-10">
                   <input 
                     type="checkbox" 
                     checked={selectedUsers.length === users.length && users.length > 0} 
                     onChange={toggleSelectAll}
                     title="Select all users"
                     className="rounded border-input text-amber-500 focus:ring-amber-500/30"
                   />
                </th>
                <th className="text-left p-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">User</th>
                <th className="text-left p-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Phone</th>
                <th className="text-left p-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Role</th>
                <th className="text-left p-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Main Wallet</th>
                <th className="text-left p-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">API Wallet</th>
                <th className="text-left p-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Sales</th>
                <th className="text-left p-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider hidden md:table-cell">Parent Agent</th>
                <th className="text-left p-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.user_id} onClick={() => setSelectedUser(user)} className="border-b border-border hover:bg-muted/50 transition-colors cursor-pointer group">
                  <td className="p-4" onClick={e => toggleSelectUser(user.user_id, e)}>
                     <input 
                       type="checkbox" 
                       checked={selectedUsers.includes(user.user_id)} 
                       onChange={() => {}}
                       title="Select user"
                       className="rounded border-input text-amber-500 focus:ring-amber-500/30"
                     />
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-foreground">{user.full_name || "—"}</p>
                      {user.has_mfa && (
                        <span title="2FA Secured">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500/10 shrink-0 animate-pulse-subtle" />
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
                  </td>
                  <td className="p-4">
                    {user.phone ? (
                      <span className="flex items-center gap-1 text-foreground/70">
                        <Phone className="w-3 h-3" /> {user.phone}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {getRoleBadge(user)}
                      {user.is_suspended && (
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">Suspended</Badge>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <p className={`font-bold ${Number(user.wallet_balance) < 10 ? "text-red-600 dark:text-red-400" : "text-cyan-600 dark:text-cyan-400"}`}>
                      GH₵{(user.wallet_balance || 0).toFixed(2)}
                    </p>
                  </td>
                  <td className="p-4">
                    {(user.is_agent || user.sub_agent_approved || (user.api_wallet_balance ?? 0) > 0) ? (
                      <p className={`font-bold ${Number(user.api_wallet_balance) < 100 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                        GH₵{(user.api_wallet_balance || 0).toFixed(2)}
                      </p>
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </td>
                  <td className="p-4">
                    <p className="font-bold text-emerald-600 dark:text-emerald-400">GH₵{(user.total_sales_volume || 0).toFixed(2)}</p>
                  </td>
                  <td className="p-4 hidden md:table-cell">
                    {(user as any).is_sub_agent && user.parent_name ? (
                      <span className="text-xs text-muted-foreground">{user.parent_name}</span>
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </td>
                  <td className="p-4" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm" variant="outline"
                        onClick={() => handleResetPassword(user)}
                        disabled={!!actionLoading[user.user_id]}
                        title="Reset user password"
                        className="text-xs border-input hover:bg-secondary rounded-xl h-8 shadow-sm"
                      >
                        {actionLoading[user.user_id] === "reset" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Reset"}
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        onClick={() => handleImpersonateUser(user)}
                        disabled={!!actionLoading[user.user_id]}
                        title="Impersonate user"
                        className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 hover:bg-amber-500/20 transition-colors"
                      >
                        {actionLoading[user.user_id] === "impersonate" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        onClick={() => setSelectedUser(user)}
                        title="View user wallets"
                        className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                      >
                        <Wallet className="w-3.5 h-3.5" />
                      </Button>
                      <Link
                        to={`/admin/orders?agent=${encodeURIComponent(user.full_name || user.email)}`}
                        title="View user orders"
                        className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 hover:bg-blue-500/20 transition-colors"
                      >
                        <ShoppingCart className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-4">
        {filtered.map((user) => (
          <div 
            key={user.user_id} 
            onClick={() => setSelectedUser(user)}
            className="rounded-2xl bg-card border border-border p-4 space-y-4 shadow-sm active:bg-muted/30 transition-colors relative"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div 
                  onClick={e => e.stopPropagation()}
                  className="relative z-10"
                >
                  <input 
                    type="checkbox" 
                    checked={selectedUsers.includes(user.user_id)} 
                    onChange={(e) => toggleSelectUser(user.user_id, e)}
                    title="Select user"
                    className="rounded border-input text-amber-500 focus:ring-amber-500/30 w-5 h-5"
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="font-bold text-foreground leading-none">{user.full_name || "—"}</p>
                    {user.has_mfa && (
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500/10 shrink-0" />
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">{user.email}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`font-black leading-none ${Number(user.wallet_balance || 0) < 10 ? "text-red-600 dark:text-red-400" : "text-cyan-600 dark:text-cyan-400"}`}>
                  ₵{(user.wallet_balance || 0).toFixed(2)}
                </p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-bold mt-0.5">Main</p>
                
                {((user.api_wallet_balance ?? 0) > 0 || user.is_agent) && (
                  <div className="mt-1.5">
                    <p className="font-black leading-none text-emerald-600 dark:text-emerald-400 text-xs">
                      ₵{(user.api_wallet_balance || 0).toFixed(2)}
                    </p>
                    <p className="text-[8px] text-muted-foreground uppercase font-bold">API</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {getRoleBadge(user)}
              {user.is_suspended && (
                <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[9px]">Suspended</Badge>
              )}
              {user.phone && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full border border-border">
                  <Phone className="w-2.5 h-2.5" /> {user.phone}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border">
               <div className="flex items-center gap-4">
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-bold">Total Sales</p>
                    <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">GH₵{(user.total_sales_volume || 0).toFixed(2)}</p>
                  </div>
                  {user.is_sub_agent && user.parent_name && (
                    <div>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-bold">Parent</p>
                      <p className="text-[10px] text-foreground/70 truncate max-w-[80px]">{user.parent_name}</p>
                    </div>
                  )}
               </div>
               <div className="flex gap-2 relative z-10" onClick={e => e.stopPropagation()}>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setSelectedUser(user)}
                    title="View user wallets"
                    className="h-8 w-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center p-0"
                  >
                    <Wallet className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => handleToggleUserSuspend(user)}
                    disabled={actionLoading[user.user_id] === "suspend"}
                    title={user.is_suspended ? "Restore/Unsuspend user" : "Suspend user"}
                    className={`h-8 w-8 rounded-xl border flex items-center justify-center p-0 ${
                      user.is_suspended
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
                        : "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20"
                    }`}
                  >
                    {actionLoading[user.user_id] === "suspend" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Ban className="w-3.5 h-3.5" />
                    )}
                  </Button>
                  <Link
                    to={`/admin/orders?agent=${encodeURIComponent(user.full_name || user.email)}`}
                    title="View user orders"
                    className="h-8 w-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 p-0"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                  </Link>
               </div>
            </div>
          </div>
        ))}
      </div>

      {/* Bulk Actions Bar */}
      {selectedUsers.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4">
          <div className="bg-slate-900 dark:bg-[#1a1a2e] border border-amber-500/30 rounded-2xl p-4 shadow-2xl shadow-black/50 flex items-center gap-4">
            <div className="px-3 border-r border-white/10">
               <p className="text-xs font-black text-amber-500 uppercase tracking-widest">{selectedUsers.length} Selected</p>
            </div>
            <div className="flex items-center gap-2">
               <Button 
                 size="sm" 
                 variant="outline"
                 onClick={() => handleBulkSuspend(true)}
                 disabled={bulkActionLoading}
                 className="h-9 rounded-xl border-white/10 text-xs font-bold gap-2 text-white hover:bg-white/10"
               >
                 <Ban className="w-3.5 h-3.5 text-red-400" /> Suspend
               </Button>
               <Button 
                 size="sm" 
                 variant="outline"
                 onClick={() => handleBulkSuspend(false)}
                 disabled={bulkActionLoading}
                 className="h-9 rounded-xl border-white/10 text-xs font-bold gap-2 text-white hover:bg-white/10"
               >
                 <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Restore
               </Button>
               <Button 
                 size="sm" 
                 onClick={handleBulkSMS}
                 disabled={bulkActionLoading}
                 className="h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold gap-2 shadow-sm"
               >
                 <MessageCircle className="w-3.5 h-3.5" /> Send Bulk SMS
               </Button>
               <Button 
                 size="sm" 
                 variant="ghost"
                 onClick={() => setSelectedUsers([])}
                 className="h-9 rounded-xl text-white/50 hover:text-white hover:bg-white/5"
               >
                 Cancel
               </Button>
            </div>
          </div>
        </div>
      )}

      {hasMore && (
        <div className="pt-8 flex justify-center">
          <Button
            variant="outline"
            onClick={() => fetchUsers(true)}
            disabled={loading}
            className="rounded-xl px-10 font-black tracking-widest uppercase text-xs shadow-sm"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ChevronDown className="w-4 h-4 mr-2" />}
            Load More Users
          </Button>
        </div>
      )}

      <UserDetailDrawer user={selectedUser} onClose={() => setSelectedUser(null)} />
    </div>
  );
};

export default AdminUsers;
