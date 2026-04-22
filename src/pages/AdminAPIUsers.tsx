import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Key, Search, Shield, ShieldOff, RefreshCw, Loader2,
  Eye, EyeOff, Activity, Users, TrendingUp, Ban,
  CheckCircle, XCircle, ChevronDown, ChevronUp, Copy,
} from "lucide-react";

interface APIUser {
  user_id: string;
  full_name: string;
  email: string;
  api_key: string | null;
  api_access_enabled: boolean;
  api_rate_limit: number;
  agent_approved: boolean;
  sub_agent_approved: boolean;
  api_orders_count?: number;
  api_last_used?: string;
}

interface APIOrder {
  id: string;
  created_at: string;
  network: string;
  phone: string;
  amount: number;
  status: string;
  metadata: any;
}

const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, string> = {
    completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    pending: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    failed: "bg-red-500/15 text-red-400 border-red-500/20",
  };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${map[status] ?? "bg-white/10 text-white/40 border-white/10"}`}>
      {status}
    </span>
  );
};

const AdminAPIUsers = () => {
  const { toast } = useToast();
  const [users, setUsers] = useState<APIUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [userOrders, setUserOrders] = useState<Record<string, APIOrder[]>>({});
  const [loadingOrders, setLoadingOrders] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [savingRateLimit, setSavingRateLimit] = useState<string | null>(null);
  const [rateLimitEdits, setRateLimitEdits] = useState<Record<string, number>>({});

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, api_key, api_access_enabled, api_rate_limit, agent_approved, sub_agent_approved")
      .not("api_key", "is", null)
      .order("full_name");

    if (error) {
      toast({ title: "Error loading API users", description: error.message, variant: "destructive" });
    } else {
      setUsers((data ?? []) as APIUser[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const fetchUserOrders = async (userId: string) => {
    if (userOrders[userId]) { setExpandedUser(userId); return; }
    setLoadingOrders(userId);
    const { data } = await supabase
      .from("orders")
      .select("id, created_at, network, phone, amount, status, metadata")
      .eq("user_id", userId)
      .eq("metadata->>source", "api")
      .order("created_at", { ascending: false })
      .limit(20);

    setUserOrders((prev) => ({ ...prev, [userId]: (data ?? []) as APIOrder[] }));
    setExpandedUser(userId);
    setLoadingOrders(null);
  };

  const toggleExpand = (userId: string) => {
    if (expandedUser === userId) { setExpandedUser(null); return; }
    fetchUserOrders(userId);
  };

  const toggleAccess = async (user: APIUser) => {
    const newVal = !user.api_access_enabled;
    const { error } = await supabase
      .from("profiles")
      .update({ api_access_enabled: newVal })
      .eq("user_id", user.user_id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: newVal ? "API Access Enabled" : "API Access Revoked" });
    setUsers((prev) => prev.map((u) => u.user_id === user.user_id ? { ...u, api_access_enabled: newVal } : u));
  };

  const revokeKey = async (userId: string) => {
    const { error } = await supabase.from("profiles").update({ api_key: null }).eq("user_id", userId);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "API Key revoked" });
    setUsers((prev) => prev.map((u) => u.user_id === userId ? { ...u, api_key: null } : u));
  };

  const saveRateLimit = async (userId: string) => {
    const newLimit = rateLimitEdits[userId];
    if (!newLimit || newLimit < 1) return;
    setSavingRateLimit(userId);
    const { error } = await supabase.from("profiles").update({ api_rate_limit: newLimit }).eq("user_id", userId);
    setSavingRateLimit(null);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Rate limit updated" });
    setUsers((prev) => prev.map((u) => u.user_id === userId ? { ...u, api_rate_limit: newLimit } : u));
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast({ title: "API key copied" });
  };

  const toggleReveal = (userId: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  };

  const filtered = users.filter(
    (u) =>
      u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const totalApiUsers = users.length;
  const activeApiUsers = users.filter((u) => u.api_access_enabled).length;

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Key className="w-6 h-6 text-amber-400" /> API User Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor, control, and configure all API integrations.</p>
        </div>
        <Button onClick={fetchUsers} variant="outline" size="sm" className="gap-2 self-start">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total API Users", value: totalApiUsers, icon: Users, color: "text-blue-400" },
          { label: "Active Access", value: activeApiUsers, icon: CheckCircle, color: "text-emerald-400" },
          { label: "Revoked Access", value: totalApiUsers - activeApiUsers, icon: XCircle, color: "text-red-400" },
          { label: "Avg Rate Limit", value: users.length ? Math.round(users.reduce((a, u) => a + (u.api_rate_limit || 30), 0) / users.length) + " req/min" : "—", icon: Activity, color: "text-amber-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-white/3 border-white/8">
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`w-8 h-8 ${color} shrink-0 opacity-70`} />
              <div>
                <p className="text-2xl font-black text-white">{value}</p>
                <p className="text-xs text-white/40">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <Input
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-white/5 border-white/10"
        />
      </div>

      {/* User list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="bg-white/3 border-white/8">
          <CardContent className="py-16 text-center text-white/40">
            <Key className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-semibold">No API users found</p>
            <p className="text-sm mt-1">Users who generate an API key will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((user) => {
            const isExpanded = expandedUser === user.user_id;
            const isRevealed = revealedKeys.has(user.user_id);
            const orders = userOrders[user.user_id] ?? [];
            const currentRateLimit = rateLimitEdits[user.user_id] ?? user.api_rate_limit ?? 30;

            return (
              <Card key={user.user_id} className={`border-white/8 transition-all ${user.api_access_enabled ? "bg-white/3" : "bg-red-500/5 border-red-500/10"}`}>
                <CardContent className="p-0">
                  {/* User row */}
                  <div className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                    {/* Identity */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm text-white truncate">{user.full_name || "Unnamed"}</p>
                        <Badge variant="outline" className={user.api_access_enabled ? "border-emerald-500/30 text-emerald-400 text-[10px]" : "border-red-500/30 text-red-400 text-[10px]"}>
                          {user.api_access_enabled ? "Active" : "Revoked"}
                        </Badge>
                        {user.agent_approved && <Badge variant="outline" className="border-amber-500/30 text-amber-400 text-[10px]">Agent</Badge>}
                        {user.sub_agent_approved && <Badge variant="outline" className="border-blue-500/30 text-blue-400 text-[10px]">Sub-Agent</Badge>}
                      </div>
                      <p className="text-xs text-white/40 mt-0.5 truncate">{user.email}</p>
                    </div>

                    {/* API Key display */}
                    <div className="flex items-center gap-2 min-w-0 flex-1 md:max-w-xs">
                      {user.api_key ? (
                        <>
                          <code className="text-xs font-mono text-amber-300/80 bg-white/5 px-2 py-1 rounded truncate flex-1">
                            {isRevealed ? user.api_key : `${user.api_key.substring(0, 12)}${"•".repeat(16)}`}
                          </code>
                          <button onClick={() => toggleReveal(user.user_id)} className="p-1 rounded hover:bg-white/10 transition shrink-0">
                            {isRevealed ? <EyeOff className="w-3.5 h-3.5 text-white/40" /> : <Eye className="w-3.5 h-3.5 text-white/40" />}
                          </button>
                          <button onClick={() => copyKey(user.api_key!)} className="p-1 rounded hover:bg-white/10 transition shrink-0">
                            <Copy className="w-3.5 h-3.5 text-white/40" />
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-white/30 italic">No key generated</span>
                      )}
                    </div>

                    {/* Rate limit editor */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Label className="text-xs text-white/40 whitespace-nowrap">Rate limit</Label>
                      <Input
                        type="number"
                        min={1}
                        max={300}
                        className="w-20 h-7 text-xs bg-white/5 border-white/10 text-center"
                        value={currentRateLimit}
                        onChange={(e) => setRateLimitEdits((prev) => ({ ...prev, [user.user_id]: parseInt(e.target.value) || 30 }))}
                      />
                      <span className="text-[10px] text-white/30">/min</span>
                      {rateLimitEdits[user.user_id] && rateLimitEdits[user.user_id] !== user.api_rate_limit && (
                        <Button size="sm" className="h-7 text-xs px-2" onClick={() => saveRateLimit(user.user_id)} disabled={savingRateLimit === user.user_id}>
                          {savingRateLimit === user.user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                        </Button>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className={`gap-1.5 h-8 text-xs ${user.api_access_enabled ? "border-red-500/30 text-red-400 hover:bg-red-500/10" : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"}`}
                        onClick={() => toggleAccess(user)}
                      >
                        {user.api_access_enabled ? <><ShieldOff className="w-3.5 h-3.5" /> Revoke</> : <><Shield className="w-3.5 h-3.5" /> Enable</>}
                      </Button>
                      {user.api_key && (
                        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs border-orange-500/30 text-orange-400 hover:bg-orange-500/10" onClick={() => revokeKey(user.user_id)}>
                          <Ban className="w-3.5 h-3.5" /> Delete Key
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-white/40 hover:text-white" onClick={() => toggleExpand(user.user_id)}>
                        {loadingOrders === user.user_id ? <Loader2 className="w-4 h-4 animate-spin" /> : isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded transactions */}
                  {isExpanded && (
                    <div className="border-t border-white/5 bg-black/20">
                      <div className="p-4">
                        <p className="text-xs font-bold uppercase tracking-widest text-white/30 mb-3 flex items-center gap-2">
                          <TrendingUp className="w-3.5 h-3.5" /> API Transactions (last 20)
                        </p>
                        {orders.length === 0 ? (
                          <p className="text-xs text-white/30 italic py-4 text-center">No API transactions found for this user.</p>
                        ) : (
                          <div className="overflow-x-auto rounded-xl border border-white/8">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-white/5 bg-white/3">
                                  <th className="text-left px-3 py-2 text-white/30 font-bold uppercase tracking-widest">Date</th>
                                  <th className="text-left px-3 py-2 text-white/30 font-bold uppercase tracking-widest">Network</th>
                                  <th className="text-left px-3 py-2 text-white/30 font-bold uppercase tracking-widest">Phone</th>
                                  <th className="text-right px-3 py-2 text-white/30 font-bold uppercase tracking-widest">Amount</th>
                                  <th className="text-center px-3 py-2 text-white/30 font-bold uppercase tracking-widest">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/5">
                                {orders.map((order) => (
                                  <tr key={order.id} className="hover:bg-white/3 transition-colors">
                                    <td className="px-3 py-2 text-white/50">{new Date(order.created_at).toLocaleString("en-GH", { dateStyle: "short", timeStyle: "short" })}</td>
                                    <td className="px-3 py-2 font-medium text-white/70">{order.network}</td>
                                    <td className="px-3 py-2 font-mono text-white/50">{order.phone}</td>
                                    <td className="px-3 py-2 text-right font-bold text-amber-400">GH₵{Number(order.amount).toFixed(2)}</td>
                                    <td className="px-3 py-2 text-center"><StatusBadge status={order.status} /></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminAPIUsers;
