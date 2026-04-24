import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Key, Search, Shield, ShieldOff, RefreshCw, Loader2,
  Eye, EyeOff, Activity, Users, TrendingUp, Ban,
  CheckCircle, XCircle, ChevronDown, ChevronUp, Copy,
  Globe, Webhook, ListChecks, Clock, BarChart2, Save, BadgePercent,
} from "lucide-react";
import { networks, basePackages } from "@/lib/data";

const ALLOWED_ACTION_OPTIONS = ["balance", "plans", "buy", "orders"] as const;
type AllowedAction = typeof ALLOWED_ACTION_OPTIONS[number];

interface APIUser {
  user_id: string;
  full_name: string;
  email: string;
  api_key: string | null;
  api_access_enabled: boolean;
  api_rate_limit: number;
  api_allowed_actions: string[] | null;
  api_ip_whitelist: string[] | null;
  api_webhook_url: string | null;
  api_requests_today: number | null;
  api_requests_total: number | null;
  api_last_used_at: string | null;
  api_custom_prices: any | null;
  agent_approved: boolean;
  sub_agent_approved: boolean;
  stats?: { total_sales_volume: number }[];
}

interface APIOrder {
  id: string;
  created_at: string;
  network: string;
  customer_phone: string;
  package_size: string;
  amount: number;
  status: string;
}

const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, string> = {
    fulfilled: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    pending: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    paid: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    fulfillment_failed: "bg-red-500/15 text-red-400 border-red-500/20",
    failed: "bg-red-500/15 text-red-400 border-red-500/20",
  };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${map[status] ?? "bg-white/10 text-white/40 border-white/10"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
};

const AdminAPIUsers = () => {
  const { toast } = useToast();
  const { session } = useAuth();
  const [users, setUsers] = useState<APIUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [userOrders, setUserOrders] = useState<Record<string, APIOrder[]>>({});
  const [loadingOrders, setLoadingOrders] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  // Editable field state per user
  const [rateLimitEdits, setRateLimitEdits] = useState<Record<string, number>>({});
  const [actionEdits, setActionEdits] = useState<Record<string, AllowedAction[]>>({});
  const [ipEdits, setIpEdits] = useState<Record<string, string>>({});
  const [webhookEdits, setWebhookEdits] = useState<Record<string, string>>({});
  const [priceEdits, setPriceEdits] = useState<Record<string, Record<string, Record<string, number>>>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    const accessToken = session?.access_token;
    if (!accessToken) {
      toast({ title: "Not authenticated", variant: "destructive" });
      setLoading(false);
      return;
    }

    const { data: fnData, error } = await supabase.functions.invoke("admin-user-actions", {
      body: { action: "get_api_users" },
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (error || fnData?.error) {
      toast({ title: "Error loading API users", description: fnData?.error ?? error?.message, variant: "destructive" });
    } else {
      const rows = (fnData?.users ?? []) as unknown as APIUser[];
      setUsers(rows);
      // Seed edit state from DB values
      const rl: Record<string, number> = {};
      const ac: Record<string, AllowedAction[]> = {};
      const ip: Record<string, string> = {};
      const wh: Record<string, string> = {};
      const pr: Record<string, Record<string, Record<string, number>>> = {};
      for (const u of rows) {
        rl[u.user_id] = u.api_rate_limit ?? 30;
        ac[u.user_id] = ((u.api_allowed_actions ?? ["balance", "plans"]) as AllowedAction[]);
        ip[u.user_id] = (u.api_ip_whitelist ?? []).join(", ");
        wh[u.user_id] = u.api_webhook_url ?? "";
        pr[u.user_id] = (u.api_custom_prices as any) || {};
      }
      setRateLimitEdits(rl);
      setActionEdits(ac);
      setIpEdits(ip);
      setWebhookEdits(wh);
      setPriceEdits(pr);
    }
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchUsers(); }, []);

  const fetchUserOrders = async (userId: string) => {
    if (userOrders[userId]) { setExpandedUser(userId); return; }
    setLoadingOrders(userId);
    const { data } = await supabase
      .from("orders")
      .select("id, created_at, network, customer_phone, package_size, amount, status")
      .eq("agent_id", userId)
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
    const { error } = await supabase.from("profiles").update({ api_access_enabled: newVal } as any).eq("user_id", user.user_id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: newVal ? "API Access Enabled" : "API Access Revoked" });
    setUsers((prev) => prev.map((u) => u.user_id === user.user_id ? { ...u, api_access_enabled: newVal } : u));
  };

  const revokeKey = async (userId: string) => {
    const { error } = await supabase.from("profiles").update({ api_key: null } as any).eq("user_id", userId);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "API Key revoked" });
    setUsers((prev) => prev.map((u) => u.user_id === userId ? { ...u, api_key: null } : u));
  };

  const saveSettings = async (userId: string) => {
    const rateLimit = rateLimitEdits[userId] ?? 30;
    const allowedActions = actionEdits[userId] ?? ["balance", "plans"];
    const ipWhitelist = (ipEdits[userId] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const webhookUrl = (webhookEdits[userId] ?? "").trim() || null;
    const customPrices = priceEdits[userId] || {};

    if (rateLimit < 1 || rateLimit > 1000) {
      toast({ title: "Invalid rate limit", description: "Must be between 1 and 1000.", variant: "destructive" }); return;
    }

    setSaving(userId);
    const { error } = await supabase.from("profiles").update({
      api_rate_limit: rateLimit,
      api_allowed_actions: allowedActions,
      api_ip_whitelist: ipWhitelist.length > 0 ? ipWhitelist : null,
      api_webhook_url: webhookUrl,
      api_custom_prices: customPrices,
    } as any).eq("user_id", userId);
    setSaving(null);

    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "API settings saved" });
    setUsers((prev) => prev.map((u) => u.user_id === userId ? {
      ...u,
      api_rate_limit: rateLimit,
      api_allowed_actions: allowedActions,
      api_ip_whitelist: ipWhitelist.length > 0 ? ipWhitelist : null,
      api_webhook_url: webhookUrl,
      api_custom_prices: customPrices,
    } : u));
  };

  const toggleAction = (userId: string, action: AllowedAction) => {
    setActionEdits((prev) => {
      const current = prev[userId] ?? ["balance", "plans"];
      return {
        ...prev,
        [userId]: current.includes(action)
          ? current.filter((a) => a !== action)
          : [...current, action],
      };
    });
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast({ title: "API key copied" });
  };

  const toggleReveal = (userId: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const updateCustomPrice = (userId: string, network: string, size: string, price: string) => {
    setPriceEdits((prev) => {
      const userPrices = { ...(prev[userId] || {}) };
      const networkPrices = { ...(userPrices[network] || {}) };
      
      if (price === "") {
        delete networkPrices[size];
      } else {
        networkPrices[size] = parseFloat(price);
      }
      
      if (Object.keys(networkPrices).length === 0) {
        delete userPrices[network];
      } else {
        userPrices[network] = networkPrices;
      }
      
      return { ...prev, [userId]: userPrices };
    });
  };

  const isDirty = (user: APIUser) => {
    const rl = rateLimitEdits[user.user_id] ?? 30;
    const ac = actionEdits[user.user_id] ?? ["balance", "plans"];
    const ip = (ipEdits[user.user_id] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const wh = (webhookEdits[user.user_id] ?? "").trim() || null;
    const dbRl = user.api_rate_limit ?? 30;
    const dbAc = user.api_allowed_actions ?? ["balance", "plans"];
    const dbIp = user.api_ip_whitelist ?? [];
    const dbWh = user.api_webhook_url ?? null;
    return (
      rl !== dbRl ||
      JSON.stringify([...ac].sort()) !== JSON.stringify([...dbAc].sort()) ||
      JSON.stringify(ip) !== JSON.stringify(dbIp) ||
      wh !== dbWh
    );
  };

  const filtered = users.filter(
    (u) =>
      u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const totalApiUsers = users.length;
  const activeApiUsers = users.filter((u) => u.api_access_enabled).length;
  const totalRequestsToday = users.reduce((a, u) => a + (u.api_requests_today ?? 0), 0);
  const totalRequestsAll = users.reduce((a, u) => a + (u.api_requests_total ?? 0), 0);

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
          { label: "Requests Today", value: totalRequestsToday.toLocaleString(), icon: Activity, color: "text-amber-400" },
          { label: "Total Requests", value: totalRequestsAll.toLocaleString(), icon: BarChart2, color: "text-purple-400" },
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
            const currentActions = actionEdits[user.user_id] ?? user.api_allowed_actions ?? ["balance", "plans"];
            const dirty = isDirty(user);

            return (
              <Card key={user.user_id} className={`border-white/8 transition-all ${user.api_access_enabled ? "bg-white/3" : "bg-red-500/5 border-red-500/10"}`}>
                <CardContent className="p-0">
                  {/* User summary row */}
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
                      {user.api_last_used_at && (
                        <p className="text-[10px] text-white/25 mt-0.5 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Last used {new Date(user.api_last_used_at).toLocaleString("en-GH", { dateStyle: "short", timeStyle: "short" })}
                        </p>
                      )}
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

                    {/* Usage counters */}
                    <div className="flex gap-4 shrink-0 text-center">
                      <div>
                        <p className="text-base font-black text-amber-400">{(user.api_requests_today ?? 0).toLocaleString()}</p>
                        <p className="text-[10px] text-white/30">Today</p>
                      </div>
                      <div>
                        <p className="text-base font-black text-white/70">{(user.api_requests_total ?? 0).toLocaleString()}</p>
                        <p className="text-[10px] text-white/30">Total</p>
                      </div>
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

                  {/* Expanded panel */}
                  {isExpanded && (
                    <div className="border-t border-white/5 bg-black/20 divide-y divide-white/5">

                      {/* ── Settings section ──────────────────────────────── */}
                      <div className="p-4 space-y-5">
                        <p className="text-xs font-bold uppercase tracking-widest text-white/30 flex items-center gap-2">
                          <Key className="w-3.5 h-3.5" /> API Settings
                        </p>

                        <div className="grid md:grid-cols-3 gap-5">
                          {/* Rate limit */}
                          <div className="space-y-2">
                            <Label className="text-xs text-white/50 flex items-center gap-1.5">
                              <Activity className="w-3.5 h-3.5" /> Rate Limit (req/min)
                            </Label>
                            <Input
                              type="number"
                              min={1}
                              max={1000}
                              className="h-8 text-xs bg-white/5 border-white/10"
                              value={rateLimitEdits[user.user_id] ?? user.api_rate_limit ?? 30}
                              onChange={(e) => setRateLimitEdits((prev) => ({ ...prev, [user.user_id]: parseInt(e.target.value) || 30 }))}
                            />
                          </div>

                          {/* IP Whitelist */}
                          <div className="space-y-2">
                            <Label className="text-xs text-white/50 flex items-center gap-1.5">
                              <Globe className="w-3.5 h-3.5" /> IP Whitelist
                              <span className="text-white/25">(comma-separated, blank = all IPs)</span>
                            </Label>
                            <Input
                              type="text"
                              placeholder="e.g. 1.2.3.4, 5.6.7.8"
                              className="h-8 text-xs bg-white/5 border-white/10 font-mono"
                              value={ipEdits[user.user_id] ?? ""}
                              onChange={(e) => setIpEdits((prev) => ({ ...prev, [user.user_id]: e.target.value }))}
                            />
                          </div>

                          {/* Webhook URL */}
                          <div className="space-y-2">
                            <Label className="text-xs text-white/50 flex items-center gap-1.5">
                              <Webhook className="w-3.5 h-3.5" /> Webhook URL
                            </Label>
                            <Input
                              type="url"
                              placeholder="https://yourdomain.com/webhook"
                              className="h-8 text-xs bg-white/5 border-white/10"
                              value={webhookEdits[user.user_id] ?? ""}
                              onChange={(e) => setWebhookEdits((prev) => ({ ...prev, [user.user_id]: e.target.value }))}
                            />
                          </div>
                        </div>

                        {/* Custom Prices */}
                        <div className="space-y-3">
                          <Label className="text-xs text-white/50 flex items-center gap-1.5">
                            <BadgePercent className="w-3.5 h-3.5" /> Custom Package Prices
                            <span className="text-white/25">(Override global API prices for this user. Leave blank for default.)</span>
                          </Label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 bg-white/5 p-4 rounded-xl border border-white/5">
                            {networks.map((n) => (
                              <div key={n.name} className="space-y-2">
                                <p className="text-[10px] font-black uppercase text-amber-500/70 border-b border-amber-500/10 pb-1">{n.name}</p>
                                <div className="space-y-1.5">
                                  {basePackages[n.name]?.map((pkg) => (
                                    <div key={pkg.size} className="flex items-center justify-between gap-2">
                                      <span className="text-[10px] text-white/60 font-mono">{pkg.size}</span>
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-white/20">GH₵</span>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          placeholder={pkg.price.toFixed(2)}
                                          className="h-6 w-20 text-[10px] bg-black/40 border-white/5 text-right font-mono"
                                          value={priceEdits[user.user_id]?.[n.name]?.[pkg.size] ?? ""}
                                          onChange={(e) => updateCustomPrice(user.user_id, n.name, pkg.size, e.target.value)}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Allowed Actions */}
                        <div className="space-y-2">
                          <Label className="text-xs text-white/50 flex items-center gap-1.5">
                            <ListChecks className="w-3.5 h-3.5" /> Allowed Actions
                          </Label>
                          <div className="flex flex-wrap gap-4">
                            {ALLOWED_ACTION_OPTIONS.map((action) => (
                              <label key={action} className="flex items-center gap-2 cursor-pointer select-none">
                                <Checkbox
                                  checked={currentActions.includes(action)}
                                  onCheckedChange={() => toggleAction(user.user_id, action)}
                                  className="border-white/20 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                                />
                                <span className="text-xs font-mono text-white/70">{action}</span>
                              </label>
                            ))}
                          </div>
                          <p className="text-[10px] text-white/25">
                            Controls which API endpoints this key can call. <span className="text-amber-400/60">buy</span> lets them purchase data bundles from their wallet. <span className="text-amber-400/60">orders</span> lets them read their order history.
                          </p>
                        </div>

                        {/* Save button */}
                        {dirty && (
                          <Button
                            size="sm"
                            className="gap-2 bg-amber-500 hover:bg-amber-600 text-black font-bold"
                            onClick={() => saveSettings(user.user_id)}
                            disabled={saving === user.user_id}
                          >
                            {saving === user.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Save Changes
                          </Button>
                        )}
                      </div>

                      {/* ── Transactions section ──────────────────────────── */}
                      <div className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-bold uppercase tracking-widest text-white/30 flex items-center gap-2">
                            <TrendingUp className="w-3.5 h-3.5" /> Recent Orders (last 20)
                          </p>
                          
                          {/* Sales Stat */}
                          <div className="bg-white/5 rounded-xl px-3 py-1 border border-white/5 flex items-center gap-3">
                            <p className="text-[10px] uppercase tracking-wider text-white/40">Total Sales</p>
                            <div className="flex items-center gap-1.5">
                              <Wallet className="w-3 h-3 text-green-400" />
                              <p className="text-xs font-bold text-white">
                                GH₵{(user.stats?.[0]?.total_sales_volume || 0).toFixed(2)}
                              </p>
                            </div>
                          </div>
                        </div>
                        
                        {orders.length === 0 ? (
                          <p className="text-xs text-white/30 italic py-4 text-center">No orders found for this agent.</p>
                        ) : (
                          <div className="overflow-x-auto rounded-xl border border-white/8">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-white/5 bg-white/3">
                                  <th className="text-left px-3 py-2 text-white/30 font-bold uppercase tracking-widest">Date</th>
                                  <th className="text-left px-3 py-2 text-white/30 font-bold uppercase tracking-widest">Network</th>
                                  <th className="text-left px-3 py-2 text-white/30 font-bold uppercase tracking-widest">Package</th>
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
                                    <td className="px-3 py-2 text-white/50">{order.package_size}</td>
                                    <td className="px-3 py-2 font-mono text-white/50">{order.customer_phone}</td>
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
