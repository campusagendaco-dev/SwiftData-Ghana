import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/utils/auditLogger";
import { Loader2, Search, RefreshCw, Phone, User, ShieldCheck, Users2, ShoppingCart } from "lucide-react";

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
  parent_name?: string;
  total_sales_volume?: number;
}

type RoleTab = "all" | "customers" | "agents" | "sub-agents";

const AdminUsers = () => {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<RoleTab>("all");
  const [actionLoading, setActionLoading] = useState<Record<string, "reset" | "delete" | "approve-sub" | "approve-agent" | null>>({});

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    const rows = ((data as any[]) || []) as UserRow[];

    // Resolve parent agent names for sub-agents
    const parentIds = [...new Set(rows.filter(r => r.parent_agent_id).map(r => r.parent_agent_id as string))];
    if (parentIds.length > 0) {
      const [parentsRes, salesRes] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name").in("user_id", parentIds),
        supabase.from("user_sales_stats").select("user_id, total_sales_volume").in("user_id", rows.map(r => r.user_id)),
      ]);
      const parentMap = new Map((parentsRes.data || []).map((p: any) => [p.user_id, p.full_name]));
      const salesMap = new Map((salesRes.data || []).map((s: any) => [s.user_id, s.total_sales_volume]));
      rows.forEach(r => {
        if (r.parent_agent_id) r.parent_name = parentMap.get(r.parent_agent_id) || "Unknown";
        r.total_sales_volume = salesMap.get(r.user_id) ?? 0;
      });
    } else {
      const { data: sales } = await supabase
        .from("user_sales_stats")
        .select("user_id, total_sales_volume")
        .in("user_id", rows.map(r => r.user_id));
      const salesMap = new Map((sales || []).map((s: any) => [s.user_id, s.total_sales_volume]));
      rows.forEach(r => {
        r.total_sales_volume = salesMap.get(r.user_id) ?? 0;
      });
    }

    setUsers(rows);
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const setRowAction = (userId: string, action: UserRow["is_agent"] extends boolean ? any : any) => {
    setActionLoading((prev) => ({ ...prev, [userId]: action }));
  };

  const handleApproveAgent = async (row: UserRow) => {
    setRowAction(row.user_id, "approve-agent");
    const { error } = await supabase.from("profiles").update({ agent_approved: true }).eq("user_id", row.user_id);
    if (error) {
      toast({ title: "Failed to approve agent", description: error.message, variant: "destructive" });
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

    const { data: parent } = await supabase
      .from("profiles")
      .select("sub_agent_prices")
      .eq("user_id", row.parent_agent_id)
      .maybeSingle();

    const parentSubAgentPrices = (parent?.sub_agent_prices && typeof parent.sub_agent_prices === "object")
      ? parent.sub_agent_prices : {};

    const { error } = await supabase.from("profiles").update({
      is_agent: true,
      agent_approved: true,
      onboarding_complete: true,
      sub_agent_approved: true,
      agent_prices: parentSubAgentPrices,
    }).eq("user_id", row.user_id);

    if (error) {
      toast({ title: "Failed to approve sub-agent", description: error.message, variant: "destructive" });
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
    const { data, error } = await supabase.functions.invoke("admin-user-actions", {
      body: { action: "reset_password", user_id: row.user_id, new_password: entered?.trim() || undefined },
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

  const handleDeleteUser = async (row: UserRow) => {
    if (!window.confirm(`Delete ${row.email}? This cannot be undone.`)) return;
    setRowAction(row.user_id, "delete");
    const { data, error } = await supabase.functions.invoke("admin-user-actions", {
      body: { action: "delete_user", user_id: row.user_id },
    });
    if (error || data?.error) {
      toast({ title: "Failed to delete user", description: data?.error || error?.message, variant: "destructive" });
    } else {
      if (currentUser) {
        await logAudit(currentUser.id, "delete_user", { target_user_id: row.user_id, target_email: row.email });
      }
      setUsers(prev => prev.filter(u => u.user_id !== row.user_id));
      toast({ title: "User deleted" });
    }
    setRowAction(row.user_id, null);
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
    return <Badge variant="outline" className="text-[10px] text-white/40 border-white/10">Customer</Badge>;
  };

  const tabCounts = {
    all: users.length,
    customers: users.filter(u => !u.is_agent && !(u as any).is_sub_agent).length,
    agents: users.filter(u => u.is_agent && !(u as any).is_sub_agent).length,
    "sub-agents": users.filter(u => (u as any).is_sub_agent).length,
  };

  const filtered = users.filter(u => {
    const matchSearch = [u.full_name, u.email, u.phone, u.parent_name]
      .filter(Boolean).some(v => v!.toLowerCase().includes(search.toLowerCase()));
    if (!matchSearch) return false;
    if (tab === "customers") return !u.is_agent && !(u as any).is_sub_agent;
    if (tab === "agents") return u.is_agent && !(u as any).is_sub_agent;
    if (tab === "sub-agents") return (u as any).is_sub_agent;
    return true;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        <p className="text-white/50 text-sm">Loading users...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <h1 className="font-display text-3xl font-black tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            User Management
          </h1>
          <p className="text-sm text-white/50 mt-1">Manage all platform users — customers, agents, and sub-agents.</p>
        </div>
        <Button onClick={fetchUsers} className="gap-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl">
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
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              tab === key
                ? "bg-amber-400/20 text-amber-400 border border-amber-400/30"
                : "bg-white/5 text-white/50 border border-white/10 hover:text-white/80"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            <span className={`text-xs rounded-full px-1.5 py-0.5 font-bold ${tab === key ? "bg-amber-400/30" : "bg-white/10"}`}>
              {tabCounts[key]}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <Input
          placeholder="Search by name, email, phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-amber-400/40"
        />
      </div>

      {/* Table */}
      <div className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <th className="text-left p-4 font-semibold text-white/40 text-xs uppercase tracking-wider">User</th>
                <th className="text-left p-4 font-semibold text-white/40 text-xs uppercase tracking-wider">Phone</th>
                <th className="text-left p-4 font-semibold text-white/40 text-xs uppercase tracking-wider">Role</th>
                <th className="text-left p-4 font-semibold text-white/40 text-xs uppercase tracking-wider">Sales</th>
                <th className="text-left p-4 font-semibold text-white/40 text-xs uppercase tracking-wider hidden md:table-cell">Parent Agent</th>
                <th className="text-left p-4 font-semibold text-white/40 text-xs uppercase tracking-wider hidden lg:table-cell">Joined</th>
                <th className="text-left p-4 font-semibold text-white/40 text-xs uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.user_id} className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                  <td className="p-4">
                    <p className="font-semibold text-white">{user.full_name || "—"}</p>
                    <p className="text-xs text-white/40 mt-0.5">{user.email}</p>
                  </td>
                  <td className="p-4">
                    {user.phone ? (
                      <span className="flex items-center gap-1 text-white/60">
                        <Phone className="w-3 h-3" /> {user.phone}
                      </span>
                    ) : (
                      <span className="text-white/20">—</span>
                    )}
                  </td>
                  <td className="p-4">{getRoleBadge(user)}</td>
                  <td className="p-4">
                    <p className="font-bold text-green-400">GH₵{(user.total_sales_volume || 0).toFixed(2)}</p>
                  </td>
                  <td className="p-4 hidden md:table-cell">
                    {(user as any).is_sub_agent && user.parent_name ? (
                      <span className="text-xs text-white/50">{user.parent_name}</span>
                    ) : (
                      <span className="text-white/20">—</span>
                    )}
                  </td>
                  <td className="p-4 text-white/40 text-xs hidden lg:table-cell">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-2">
                      {/* Approve pending agent */}
                      {user.is_agent && !(user as any).is_sub_agent && user.onboarding_complete && !user.agent_approved && (
                        <Button
                          size="sm"
                          onClick={() => handleApproveAgent(user)}
                          disabled={!!actionLoading[user.user_id]}
                          className="bg-amber-400/20 text-amber-400 hover:bg-amber-400/30 border border-amber-400/30 font-bold text-xs rounded-xl"
                        >
                          {actionLoading[user.user_id] === "approve-agent" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Approve Agent"}
                        </Button>
                      )}
                      {/* Approve pending sub-agent */}
                      {(user as any).is_sub_agent && !user.sub_agent_approved && (
                        <Button
                          size="sm"
                          onClick={() => handleApproveSubAgent(user)}
                          disabled={!!actionLoading[user.user_id]}
                          className="bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 font-bold text-xs rounded-xl"
                        >
                          {actionLoading[user.user_id] === "approve-sub" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Approve Sub-Agent"}
                        </Button>
                      )}
                      <Button
                        size="sm" variant="outline"
                        onClick={() => handleResetPassword(user)}
                        disabled={!!actionLoading[user.user_id]}
                        className="text-xs border-white/10 text-white/60 hover:text-white rounded-xl"
                      >
                        {actionLoading[user.user_id] === "reset" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Reset PWD"}
                      </Button>
                      <Link
                        to={`/admin/orders?agent=${encodeURIComponent(user.full_name || user.email)}`}
                        className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 hover:bg-blue-500/20 transition-colors"
                        title="View Sales History"
                      >
                        <ShoppingCart className="w-3.5 h-3.5" />
                      </Link>
                      <Button
                        size="sm" variant="destructive"
                        onClick={() => handleDeleteUser(user)}
                        disabled={!!actionLoading[user.user_id] || currentUser?.id === user.user_id}
                        className="text-xs rounded-xl"
                      >
                        {actionLoading[user.user_id] === "delete" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Delete"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="p-12 text-center text-white/30 text-sm">No users found.</div>
        )}
      </div>

      <p className="text-xs text-white/30 text-center">Showing {filtered.length} of {users.length} total users</p>
    </div>
  );
};

export default AdminUsers;
