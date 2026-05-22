import { type ReactNode, useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Shield, Globe, AlertTriangle, Clock, RefreshCw, Loader2, CheckCircle2,
  Eye, Search, Zap, Gift, TrendingUp, FileDown, Activity, BookOpen, Hash,
  BarChart2, Ban, ChevronDown, ChevronUp, Copy, Lock, ShieldAlert,
  UserX, MapPin, LogIn, AlertCircle, Flame, Filter, ShieldCheck, Bot
} from "lucide-react";

/* ─── interfaces ──────────────────────────────────────────────────── */

interface ProfileRow {
  user_id: string; full_name: string; email: string;
  last_ip: string | null; last_seen_at: string | null;
  last_location: string | null; login_count: number;
  is_agent: boolean; agent_approved: boolean; is_sub_agent: boolean;
  referred_by: string | null; created_at: string; is_suspended: boolean;
}
interface IpCluster  { ip: string; location: string | null; accounts: ProfileRow[] }
interface RecentLogin {
  user_id: string; full_name: string; email: string;
  last_ip: string | null; last_seen_at: string | null;
  last_location: string | null; login_count: number; is_agent: boolean;
}
interface VelocityAccount {
  user_id: string; full_name: string; email: string;
  joined_at: string; first_order_at: string; minutes_to_first_order: number;
}
interface ReferralGroup {
  referrer_id: string; referrer_name: string; referrer_email: string;
  count: number; members: { user_id: string; full_name: string; email: string }[];
}
interface FailedOrderUser {
  user_id: string; full_name: string; email: string;
  total: number; failed: number; rate: number;
}
interface SystemAdmin {
  user_id: string;
  role: string;
  email: string;
  full_name: string;
  last_seen_at: string | null;
  is_mfa_verified: boolean;
  allowed_ips: string[] | null;
}
interface SignupDay   { date: string; count: number }
interface AdminAction {
  id: string; admin_email: string; action: string;
  target_email: string | null; metadata: Record<string, unknown>; created_at: string;
}
interface LiveAlert   { id: string; message: string; time: Date }
interface SystemSettings {
  maintenance_mode: boolean; registration_enabled: boolean;
  dark_mode_enabled: boolean; store_visitor_popup_enabled: boolean;
}
interface GuardianLog {
  id: string; action_type: string; status: string; reasoning: string; created_at: string; metadata: any;
}

/* ─── helpers ─────────────────────────────────────────────────────── */

const roleLabel = (p: ProfileRow) => {
  if (p.is_sub_agent)                      return { label: "Sub-Agent",      cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" };
  if (p.is_agent && p.agent_approved)      return { label: "Agent",          cls: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20" };
  if (p.is_agent)                          return { label: "Pending Agent",  cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" };
  return                                          { label: "Customer",       cls: "bg-muted text-muted-foreground border-border" };
};

const exportCsv = (rows: Record<string, unknown>[], filename: string) => {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv  = [keys.join(","), ...rows.map(r => keys.map(k => JSON.stringify(r[k] ?? "")).join(","))].join("\n");
  const url  = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
};

const fmt = (d: string | null) => d ? new Date(d).toLocaleString("en-GH", { dateStyle: "short", timeStyle: "short" }) : "—";

/* ─── sub-components ──────────────────────────────────────────────── */

const Badge = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black border ${className}`}>{children}</span>
);

const SectionCard = ({ title, count, icon: Icon, color, children, onExport, defaultOpen = true }: {
  title: string; count?: number; icon: typeof Shield; color: string;
  children: ReactNode; onExport?: () => void; defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-3 flex-1 text-left"
        >
          <div className={`p-2 rounded-xl ${color.replace("text-", "bg-").replace("400", "500/10")} border ${color.replace("text-", "border-").replace("400", "500/20")}`}>
            <Icon className={`w-4 h-4 ${color}`} />
          </div>
          <span className="font-black text-foreground text-sm">{title}</span>
          {count !== undefined && (
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
              count > 0 ? `${color.replace("text-", "bg-").replace("400", "500/20")} ${color} ${color.replace("text-", "border-").replace("400", "500/30")}` : "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
            }`}>{count}</span>
          )}
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {onExport && (
            <button
              type="button"
              title="Export CSV"
              onClick={onExport}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-muted"
            >
              <FileDown className="w-3 h-3" /> CSV
            </button>
          )}
          <button type="button" title={open ? "Collapse" : "Expand"} onClick={() => setOpen(o => !o)} className="text-muted-foreground">
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {open && <div className="border-t border-border p-5">{children}</div>}
    </div>
  );
};

const EmptyState = ({ icon: Icon = CheckCircle2, message }: { icon?: typeof Shield; message: string }) => (
  <div className="flex flex-col items-center justify-center py-10 gap-3 opacity-60">
    <Icon className="w-8 h-8 text-emerald-500" />
    <p className="text-sm text-muted-foreground text-center font-medium">{message}</p>
  </div>
);

const TH = ({ children }: { children: ReactNode }) => (
  <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground whitespace-nowrap">{children}</th>
);

/* ─── main component ──────────────────────────────────────────────── */

type TabId = "overview" | "guardian" | "threats" | "activity" | "access" | "admins" | "audit";

const TABS: { id: TabId; label: string; icon: typeof Shield }[] = [
  { id: "overview",  label: "Overview",       icon: Shield      },
  { id: "guardian",  label: "Guardian AI",    icon: Bot         },
  { id: "threats",   label: "Threats",        icon: ShieldAlert },
  { id: "activity",  label: "Activity",       icon: Activity    },
  { id: "access",    label: "Access Control", icon: Lock        },
  { id: "admins",    label: "Administrators", icon: ShieldCheck },
  { id: "audit",     label: "Audit Log",      icon: BookOpen    },
];

const AdminSecurity = () => {
  const { toast }           = useToast();
  const { session }         = useAuth();
  const [tab, setTab]       = useState<TabId>("overview");
  const [search, setSearch] = useState("");
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [purging,  setPurging]  = useState(false);
  const [expandedIp, setExpandedIp] = useState<string | null>(null);

  /* data */
  const [clusters,       setClusters]       = useState<IpCluster[]>([]);
  const [recentLogins,   setRecentLogins]   = useState<RecentLogin[]>([]);
  const [velocityAccts,  setVelocityAccts]  = useState<VelocityAccount[]>([]);
  const [referralGroups, setReferralGroups] = useState<ReferralGroup[]>([]);
  const [highLogins,     setHighLogins]     = useState<ProfileRow[]>([]);
  const [failedUsers,    setFailedUsers]    = useState<FailedOrderUser[]>([]);
  const [signupTrend,    setSignupTrend]    = useState<SignupDay[]>([]);
  const [actionLog,      setActionLog]      = useState<AdminAction[]>([]);
  const [blacklist,      setBlacklist]      = useState<{ id: string; type: string; value: string; reason: string }[]>([]);
  const [sysSettings,    setSysSettings]    = useState<SystemSettings | null>(null);
  const [liveAlerts,     setLiveAlerts]     = useState<LiveAlert[]>([]);
  const [guardianLogs,   setGuardianLogs]   = useState<GuardianLog[]>([]);
  const [suspendedCount, setSuspendedCount] = useState(0);

  /* blacklist form state */
  const [blType,   setBlType]   = useState("ip");
  const [blValue,  setBlValue]  = useState("");
  const [blReason, setBlReason] = useState("");

  /* admin management state */
  const [adminsList, setAdminsList] = useState<SystemAdmin[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [addingAdmin, setAddingAdmin] = useState(false);

  /* ── fetch ──────────────────────────────────────────────────────── */
  const fetchData = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const d14 = new Date(Date.now() - 14 * 864e5).toISOString();

    const [profilesRes, recentRes, velocityRes, ordersRes, signupsRes, actionRes, blacklistRes, settingsRes] =
      await Promise.all([
        (supabase as any).from("profiles")
          .select("user_id,full_name,email,last_ip,last_seen_at,last_location,login_count,is_agent,agent_approved,is_sub_agent,referred_by,created_at,is_suspended")
          .order("created_at", { ascending: false }).limit(2000),
        (supabase as any).from("profiles")
          .select("user_id,full_name,email,last_ip,last_seen_at,last_location,login_count,is_agent")
          .not("last_seen_at", "is", null).order("last_seen_at", { ascending: false }).limit(30),
        (supabase as any).rpc("get_velocity_accounts"),
        supabase.from("orders").select("agent_id,status").gte("created_at", d30).limit(5000),
        (supabase as any).from("profiles").select("created_at").gte("created_at", d14).order("created_at", { ascending: true }),
        (supabase as any).from("admin_action_log")
          .select("id,admin_email,action,target_email,metadata,created_at")
          .order("created_at", { ascending: false }).limit(50),
        supabase.from("security_blacklist").select("*"),
        supabase.from("system_settings").select("*").eq("id", 1).maybeSingle(),
        supabase.from("sentinel_actions").select("*").order("created_at", { ascending: false }).limit(30),
      ]);

    const profiles = (profilesRes.data || []) as unknown as ProfileRow[];

    /* shared IPs */
    const ipMap = new Map<string, ProfileRow[]>();
    profiles.forEach(p => { if (p.last_ip) { const a = ipMap.get(p.last_ip) || []; a.push(p); ipMap.set(p.last_ip, a); } });
    const shared: IpCluster[] = [];
    ipMap.forEach((accs, ip) => { if (accs.length >= 2) shared.push({ ip, location: accs.find(a => a.last_location)?.last_location ?? null, accounts: accs }); });
    shared.sort((a, b) => b.accounts.length - a.accounts.length);

    /* referral abuse */
    const refMap = new Map<string, ProfileRow[]>();
    profiles.forEach(p => { if (p.referred_by) { const a = refMap.get(p.referred_by) || []; a.push(p); refMap.set(p.referred_by, a); } });
    const groups: ReferralGroup[] = [];
    refMap.forEach((members, rid) => {
      if (members.length >= 5) {
        const r = profiles.find(p => p.user_id === rid);
        groups.push({ referrer_id: rid, referrer_name: r?.full_name || "Unknown", referrer_email: r?.email || rid, count: members.length, members: members.map(m => ({ user_id: m.user_id, full_name: m.full_name, email: m.email })) });
      }
    });
    groups.sort((a, b) => b.count - a.count);

    /* failed order rate */
    const os = new Map<string, { total: number; failed: number }>();
    ((ordersRes.data || []) as { agent_id: string; status: string }[]).forEach(o => {
      const s = os.get(o.agent_id) || { total: 0, failed: 0 };
      s.total++; if (o.status === "failed" || o.status === "fulfillment_failed") s.failed++;
      os.set(o.agent_id, s);
    });
    const failed: FailedOrderUser[] = [];
    os.forEach((s, id) => {
      if (s.total >= 5 && s.failed / s.total >= 0.5) {
        const p = profiles.find(x => x.user_id === id);
        if (p) failed.push({ user_id: id, full_name: p.full_name, email: p.email, total: s.total, failed: s.failed, rate: Math.round((s.failed / s.total) * 100) });
      }
    });
    failed.sort((a, b) => b.rate - a.rate);

    /* signup trend */
    const dayMap = new Map<string, number>();
    for (let i = 13; i >= 0; i--) dayMap.set(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10), 0);
    ((signupsRes.data || []) as { created_at: string }[]).forEach(r => { const d = r.created_at.slice(0, 10); if (dayMap.has(d)) dayMap.set(d, (dayMap.get(d) || 0) + 1); });

    setClusters(shared);
    setRecentLogins((recentRes.data || []) as unknown as RecentLogin[]);
    setVelocityAccts(velocityRes.error ? [] : (velocityRes.data || []) as unknown as VelocityAccount[]);
    setReferralGroups(groups);
    setHighLogins(profiles.filter(p => (p.login_count ?? 0) >= 50).sort((a, b) => (b.login_count ?? 0) - (a.login_count ?? 0)));
    setFailedUsers(failed);
    setSignupTrend(Array.from(dayMap.entries()).map(([date, count]) => ({ date, count })));
    setActionLog((actionRes.data || []) as unknown as AdminAction[]);
    setBlacklist(blacklistRes.data || []);
    setSysSettings(settingsRes.data);
    setGuardianLogs((settingsRes as any)[3]?.data || actionRes[3]?.data || []); // We'll fix this assignment
    const guardianData = await supabase.from("sentinel_actions").select("*").order("created_at", { ascending: false }).limit(30);
    setGuardianLogs(guardianData.data || []);
    setSuspendedCount(profiles.filter(p => p.is_suspended).length);
    setLoading(false); setRefreshing(false);
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  /* live realtime */
  useEffect(() => {
    const channelName = `sec-rt-${Math.random().toString(36).slice(2)}`;
    const ch = supabase.channel(channelName)
      .on("postgres_changes" as any, { event: "UPDATE", schema: "public", table: "profiles" }, (payload: any) => {
        const p = payload.new as RecentLogin;
        if (!p.last_seen_at) return;
        setRecentLogins(prev => [p, ...prev.filter(l => l.user_id !== p.user_id)].slice(0, 30));
        setLiveAlerts(prev => [{ id: Math.random().toString(36).slice(2), message: `${p.full_name || p.email || "Unknown"} logged in${p.last_ip ? ` from ${p.last_ip}` : ""}${p.last_location ? ` · ${p.last_location}` : ""}`, time: new Date() }, ...prev].slice(0, 15));
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  /* ── actions ────────────────────────────────────────────────────── */
  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body, headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    
    if (error) {
      // Try extracting granular JSON error response if available in the context body
      try {
        const bodyText = await (error as any).context?.text();
        if (bodyText) {
          const parsed = JSON.parse(bodyText);
          if (parsed.error) throw new Error(parsed.error);
        }
      } catch (innerErr: any) {
        if (innerErr.message && innerErr.message !== "Unexpected end of JSON input") {
          throw innerErr;
        }
      }
      throw new Error(error.message || "Edge Function execution failed");
    }
    
    if (data?.error) throw new Error(data.error);
    return data;
  }, [session]);

  const fetchAdmins = useCallback(async () => {
    setLoadingAdmins(true);
    try {
      const res = await invoke({ action: "get_admins" });
      setAdminsList(res.admins || []);
    } catch (e: any) {
      toast({ title: "Fetch Failed", description: e.message, variant: "destructive" });
    } finally {
      setLoadingAdmins(false);
    }
  }, [invoke, toast]);

  useEffect(() => {
    if (tab === "admins") {
      void fetchAdmins();
    }
  }, [tab, fetchAdmins]);

  const handleAddAdmin = async () => {
    if (!newAdminEmail.trim()) return;
    setAddingAdmin(true);
    try {
      await invoke({ action: "grant_admin_role", email: newAdminEmail.trim() });
      toast({ title: "Success", description: "Administrator granted successfully!" });
      setNewAdminEmail("");
      void fetchAdmins();
    } catch (e: any) {
      toast({ title: "Grant Failed", description: e.message, variant: "destructive" });
    } finally {
      setAddingAdmin(false);
    }
  };

  const handleRevokeAdmin = async (targetUserId: string, nameOrEmail: string) => {
    if (!confirm(`Are you absolutely sure you want to REVOKE administrator access for ${nameOrEmail}?`)) return;
    try {
      await invoke({ action: "revoke_admin_role", user_id: targetUserId });
      toast({ title: "Access Revoked", description: "User is no longer an administrator." });
      void fetchAdmins();
    } catch (e: any) {
      toast({ title: "Revoke Failed", description: e.message, variant: "destructive" });
    }
  };

  const handlePurge = async () => {
    if (!confirm("Delete all test accounts (@example.com / apitest)?")) return;
    setPurging(true);
    try {
      const d = await invoke({ action: "purge_test_accounts" });
      toast({ title: "Purged", description: `${d.deleted_count} accounts deleted` });
      void fetchData(true);
    } catch (e: any) { toast({ title: "Purge Failed", description: e.message, variant: "destructive" }); }
    setPurging(false);
  };

  const handleBulkSuspend = async (ids: string[], suspend: boolean) => {
    try {
      await invoke({ action: "bulk_suspend_users", user_ids: ids, suspend });
      toast({ title: suspend ? `${ids.length} accounts suspended` : `${ids.length} accounts restored` });
      void fetchData(true);
    } catch (e: any) { toast({ title: "Action Failed", description: e.message, variant: "destructive" }); }
  };

  const handleBlacklist = async (op: "add" | "remove", value: string, type?: string, reason?: string) => {
    try {
      await invoke({ action: "manage_blacklist", op, type, value, reason });
      toast({ title: op === "add" ? "Added to blocklist" : "Removed from blocklist" });
      if (op === "add") { setBlValue(""); setBlReason(""); }
      void fetchData(true);
    } catch (e: any) { toast({ title: "Blocklist Error", description: e.message, variant: "destructive" }); }
  };

  const toggleSetting = async (key: string, val: boolean) => {
    try {
      await invoke({ action: "update_system_settings", settings: { [key]: val } });
      setSysSettings(prev => prev ? { ...prev, [key]: val } : prev);
      toast({ title: "Setting updated" });
    } catch (e: any) { toast({ title: "Update Failed", description: e.message, variant: "destructive" }); }
  };

  const copyText = (t: string, label = "Copied") => {
    void navigator.clipboard.writeText(t);
    toast({ title: label, description: t });
  };

  /* ── filtered views ─────────────────────────────────────────────── */
  const q = search.toLowerCase();
  const fClusters  = useMemo(() => clusters.filter(c => !q || c.ip.includes(q) || c.accounts.some(a => a.full_name?.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q))), [clusters, q]);
  const fLogins    = useMemo(() => recentLogins.filter(r => !q || r.full_name?.toLowerCase().includes(q) || r.email?.toLowerCase().includes(q) || r.last_ip?.includes(q)), [recentLogins, q]);
  const fHighLogin = useMemo(() => highLogins.filter(p => !q || p.full_name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)), [highLogins, q]);
  const fFailed    = useMemo(() => failedUsers.filter(u => !q || u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)), [failedUsers, q]);
  const fVelocity  = useMemo(() => velocityAccts.filter(v => !q || v.full_name?.toLowerCase().includes(q) || v.email?.toLowerCase().includes(q)), [velocityAccts, q]);
  const fReferrals = useMemo(() => referralGroups.filter(g => !q || g.referrer_name?.toLowerCase().includes(q) || g.referrer_email?.toLowerCase().includes(q)), [referralGroups, q]);

  /* ── health score ───────────────────────────────────────────────── */
  const healthScore = Math.max(0, 100 - clusters.length * 5 - referralGroups.length * 8 - failedUsers.length * 2 - (velocityAccts.length > 5 ? 10 : 0));
  const scoreColor  = healthScore >= 80 ? "text-green-400" : healthScore >= 60 ? "text-amber-400" : "text-red-400";
  const scoreBg     = healthScore >= 80 ? "from-green-500/10"  : healthScore >= 60 ? "from-amber-500/10" : "from-red-500/10";
  const scoreLabel  = healthScore >= 80 ? "Healthy" : healthScore >= 60 ? "At Risk" : "Critical";

  const maxSignup   = Math.max(...signupTrend.map(d => d.count), 1);

  const STATS = [
    { label: "Shared IPs",    value: clusters.length,       icon: Globe,        danger: clusters.length > 0,       color: "text-red-400",    bg: "bg-red-500/10 border-red-500/20"     },
    { label: "Velocity Flags",value: velocityAccts.length,  icon: Zap,          danger: velocityAccts.length > 0,  color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20"},
    { label: "Referral Abuse",value: referralGroups.length, icon: Gift,         danger: referralGroups.length > 0, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20"},
    { label: "High Logins",   value: highLogins.length,     icon: Hash,         danger: false,                     color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/20"  },
    { label: "High Fail Rate",value: failedUsers.length,    icon: TrendingUp,   danger: failedUsers.length > 0,    color: "text-red-400",    bg: "bg-red-500/10 border-red-500/20"     },
    { label: "Suspended",     value: suspendedCount,        icon: UserX,        danger: suspendedCount > 0,        color: "text-rose-400",   bg: "bg-rose-500/10 border-rose-500/20"   },
  ];

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      <p className="text-muted-foreground text-sm font-black uppercase tracking-widest">Loading security data…</p>
    </div>
  );

  /* ── tab content ────────────────────────────────────────────────── */
  const renderOverview = () => (
    <div className="space-y-6">
      {/* Top row: health + live feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Health score */}
        <div className={`lg:col-span-2 rounded-2xl border border-border shadow-sm bg-gradient-to-br ${scoreBg} to-card/50 p-6`}>
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-1">Security Health</p>
              <div className="flex items-baseline gap-3">
                <span className={`text-6xl font-black italic tracking-tighter ${scoreColor.replace("text-", "text-")}`}>{healthScore}</span>
                <span className={`text-lg font-black ${scoreColor}`}>/ 100</span>
                <span className={`text-sm font-black px-3 py-1 rounded-full border shadow-sm bg-card ${
                  healthScore >= 80 ? "text-green-600 dark:text-green-400 border-green-500/20"
                  : healthScore >= 60 ? "text-amber-600 dark:text-amber-400 border-amber-500/20"
                  : "text-red-600 dark:text-red-400 border-red-500/20"
                }`}>{scoreLabel}</span>
              </div>
            </div>
            <Shield className={`w-12 h-12 ${scoreColor} opacity-20`} />
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden mb-5">
            <div className={`h-full rounded-full transition-all duration-700 ${
              healthScore >= 80 ? "bg-green-500" : healthScore >= 60 ? "bg-amber-500" : "bg-red-500"
            }`} style={{ width: `${healthScore}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {clusters.length > 0 && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/10 text-xs font-medium text-red-700 dark:text-red-400 shadow-sm">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{clusters.length} shared IP cluster{clusters.length !== 1 ? "s" : ""}
              </div>
            )}
            {referralGroups.length > 0 && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-purple-50 dark:bg-purple-500/5 border border-purple-200 dark:border-purple-500/10 text-xs font-medium text-purple-700 dark:text-purple-400 shadow-sm">
                <Gift className="w-3.5 h-3.5 shrink-0" />{referralGroups.length} referral abuse pattern{referralGroups.length !== 1 ? "s" : ""}
              </div>
            )}
            {failedUsers.length > 0 && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-orange-50 dark:bg-orange-500/5 border border-orange-200 dark:border-orange-500/10 text-xs font-medium text-orange-700 dark:text-orange-400 shadow-sm">
                <Flame className="w-3.5 h-3.5 shrink-0" />{failedUsers.length} high failure rate account{failedUsers.length !== 1 ? "s" : ""}
              </div>
            )}
            {clusters.length === 0 && referralGroups.length === 0 && failedUsers.length === 0 && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-green-50 dark:bg-green-500/5 border border-green-200 dark:border-green-500/10 text-xs font-medium text-green-700 dark:text-green-400 col-span-2 shadow-sm">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />No active threats detected
              </div>
            )}
          </div>
        </div>

        {/* Live feed */}
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-50/30 dark:bg-cyan-500/[0.03] p-5 flex flex-col shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
              <span className="text-xs font-black uppercase tracking-widest text-cyan-600 dark:text-cyan-400">Live Events</span>
            </div>
            <button type="button" onClick={() => setLiveAlerts([])} className="text-[10px] text-muted-foreground hover:text-foreground uppercase font-black transition-colors">Clear</button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto max-h-48 scrollbar-none">
            {liveAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 opacity-40 py-6">
                <Globe className="w-7 h-7 text-cyan-500" /><p className="text-[10px] font-black text-cyan-600 uppercase">Waiting for events…</p>
              </div>
            ) : liveAlerts.map(a => (
              <div key={a.id} className="flex flex-col gap-0.5 border-l-2 border-cyan-500/40 dark:border-cyan-500/40 pl-3 py-1">
                <span className="text-[9px] font-mono text-cyan-600/60 dark:text-cyan-400/40 font-bold">{a.time.toLocaleTimeString()}</span>
                <p className="text-[11px] text-foreground/70 font-medium line-clamp-2">{a.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {STATS.map(({ label, value, icon: Icon, danger, color, bg }) => (
          <div key={label} className={`rounded-2xl border shadow-sm p-4 ${danger && value > 0 ? bg : "bg-card border-border"}`}>
            <Icon className={`w-5 h-5 mb-2.5 ${danger && value > 0 ? color : "text-muted-foreground"}`} />
            <p className={`text-2xl font-black tabular-nums ${danger && value > 0 ? color : "text-foreground"}`}>{value}</p>
            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mt-0.5 leading-tight">{label}</p>
          </div>
        ))}
      </div>

      {/* Signup trend */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            <span className="font-black text-foreground text-sm">Signup Trend</span>
            <span className="text-[10px] bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded-full font-black">14 days</span>
          </div>
          <div className="text-right">
            <span className="text-xl font-black text-cyan-600 dark:text-cyan-400">{signupTrend.reduce((s, d) => s + d.count, 0)}</span>
            <p className="text-[10px] text-muted-foreground font-medium">new accounts</p>
          </div>
        </div>
        <div className="flex items-end gap-1 h-20">
          {signupTrend.map(day => (
            <div key={day.date} className="flex flex-col items-center gap-1 flex-1 group cursor-default">
              <span className="text-[9px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity font-bold">{day.count}</span>
              <div
                className="w-full bg-cyan-500/30 hover:bg-cyan-500/60 rounded-t-sm transition-colors"
                style={{ height: `${Math.max(3, (day.count / maxSignup) * 64)}px` }}
                title={`${day.date}: ${day.count} signups`}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[9px] text-muted-foreground font-medium">{signupTrend[0]?.date.slice(5)}</span>
          <span className="text-[9px] text-muted-foreground font-medium">{signupTrend[signupTrend.length - 1]?.date.slice(5)}</span>
        </div>
      </div>
    </div>
  );

  const renderThreats = () => (
    <div className="space-y-4">
      {/* Shared IPs */}
      <SectionCard title="Shared IP Groups" count={fClusters.length} icon={Globe} color="text-red-400"
        onExport={() => exportCsv(clusters.flatMap(c => c.accounts.map(a => ({ ip: c.ip, location: c.location, ...a } as Record<string, unknown>))), "shared_ips.csv")}
      >
        {fClusters.length === 0 ? <EmptyState icon={Globe} message="No shared IP addresses detected." /> : (
          <div className="space-y-2">
            {fClusters.map(cluster => {
              const exp = expandedIp === cluster.ip;
              return (
                <div key={cluster.ip} className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/[0.03] overflow-hidden shadow-sm">
                  <div className="flex items-center justify-between px-4 py-3">
                    <button type="button" onClick={() => setExpandedIp(exp ? null : cluster.ip)}
                      className="flex-1 flex items-center gap-3 text-left"
                    >
                      {exp ? <ChevronUp className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                      <span className="font-mono text-sm font-bold text-red-700 dark:text-red-300">{cluster.ip}</span>
                      {cluster.location && <span className="flex items-center gap-1 text-[10px] font-black text-emerald-600 dark:text-emerald-400/60"><MapPin className="w-3 h-3" />{cluster.location}</span>}
                      <span className="text-[10px] font-black bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full shadow-sm">{cluster.accounts.length} accounts</span>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" title="Copy IP" onClick={() => copyText(cluster.ip, "IP copied")}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background transition-all shadow-sm">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => handleBulkSuspend(cluster.accounts.map(a => a.user_id), true)}
                        className="text-[10px] font-black uppercase bg-red-600 hover:bg-red-700 text-white border border-red-600 px-3 py-1.5 rounded-lg transition-all shadow-sm">
                        Suspend All
                      </button>
                    </div>
                  </div>
                  {exp && (
                    <div className="border-t border-red-100 dark:border-red-500/10 divide-y divide-border">
                      {cluster.accounts.map(acc => {
                        const role = roleLabel(acc);
                        return (
                          <div key={acc.user_id} className="flex items-center justify-between px-4 py-2.5 bg-background/50">
                            <div className="min-w-0">
                              <p className="text-sm font-black text-foreground truncate">{acc.full_name || "—"}</p>
                              <p className="text-[11px] text-muted-foreground font-medium truncate">{acc.email}</p>
                              {acc.last_seen_at && <p className="text-[10px] text-muted-foreground/70 font-medium mt-0.5">{fmt(acc.last_seen_at)}</p>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 ml-3">
                              {acc.is_suspended && <span className="text-[9px] font-black px-2 py-0.5 rounded-full border shadow-sm bg-red-500/10 text-red-600 border-red-500/20">Suspended</span>}
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border shadow-sm ${role.cls}`}>{role.label}</span>
                              <span className="text-[10px] text-muted-foreground font-medium">{acc.login_count ?? 0} logins</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Account Velocity */}
      <SectionCard title="Account Velocity" count={fVelocity.length} icon={Zap} color="text-orange-400"
        onExport={() => exportCsv(fVelocity as unknown as Record<string, unknown>[], "velocity.csv")}
      >
        {fVelocity.length === 0 ? <EmptyState icon={Zap} message="No accounts placed orders within 5 minutes of signup." /> : (
          <div className="overflow-x-auto rounded-xl border border-border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted border-b border-border"><TH>User</TH><TH>Joined</TH><TH>First Order</TH><TH>Delay</TH></tr></thead>
              <tbody>
                {fVelocity.map(v => (
                  <tr key={v.user_id} className="border-b border-border hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3"><p className="font-black text-foreground">{v.full_name || "—"}</p><p className="text-[11px] text-muted-foreground font-medium">{v.email}</p></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-medium">{fmt(v.joined_at)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-medium">{fmt(v.first_order_at)}</td>
                    <td className="px-4 py-3"><span className="text-sm font-black text-orange-600 dark:text-orange-400">{v.minutes_to_first_order}m</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Referral Abuse */}
      <SectionCard title="Referral Abuse" count={fReferrals.length} icon={Gift} color="text-purple-400"
        onExport={() => exportCsv(referralGroups.flatMap(g => g.members.map(m => ({ referrer: g.referrer_email, ...m } as Record<string, unknown>))), "referral_abuse.csv")}
      >
        {fReferrals.length === 0 ? <EmptyState icon={Gift} message="No referral codes with 5+ signups." /> : (
          <div className="space-y-2">
            {fReferrals.map(g => (
              <div key={g.referrer_id} className="rounded-xl border border-purple-200 dark:border-purple-500/20 bg-purple-50 dark:bg-purple-500/[0.03] p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div><p className="font-black text-foreground text-sm">{g.referrer_name}</p><p className="text-[11px] text-muted-foreground font-medium">{g.referrer_email}</p></div>
                  <span className="text-[10px] font-black bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded-full shadow-sm">{g.count} referrals</span>
                </div>
                <div className="space-y-1">
                  {g.members.map(m => (
                    <div key={m.user_id} className="flex items-center gap-2 text-[11px] bg-background border border-border px-3 py-1.5 rounded-lg shadow-sm">
                      <span className="text-foreground font-black">{m.full_name || "—"}</span>
                      <span className="text-muted-foreground/30">·</span>
                      <span className="font-mono text-muted-foreground font-medium">{m.email}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* High Failure Rate */}
      <SectionCard title="High Failure Rate" count={fFailed.length} icon={TrendingUp} color="text-red-400"
        onExport={() => exportCsv(fFailed as unknown as Record<string, unknown>[], "failed_rate.csv")}
      >
        {fFailed.length === 0 ? <EmptyState icon={TrendingUp} message="No users with ≥50% failure rate (min 5 orders)." /> : (
          <div className="overflow-x-auto rounded-xl border border-border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted border-b border-border"><TH>User</TH><TH>Orders</TH><TH>Failed</TH><TH>Rate</TH></tr></thead>
              <tbody>
                {fFailed.map(u => (
                  <tr key={u.user_id} className="border-b border-border hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3"><p className="font-black text-foreground">{u.full_name || "—"}</p><p className="text-[11px] text-muted-foreground font-medium">{u.email}</p></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-black">{u.total}</td>
                    <td className="px-4 py-3 text-xs text-red-600 dark:text-red-400 font-black">{u.failed}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-red-500 rounded-full" style={{ width: `${u.rate}%` }} /></div>
                        <span className="text-xs font-black text-red-600 dark:text-red-400">{u.rate}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );

  const renderActivity = () => (
    <div className="space-y-4">
      {/* Recent Logins */}
      <SectionCard title="Recent Logins" count={fLogins.length} icon={LogIn} color="text-cyan-600 dark:text-cyan-400"
        onExport={() => exportCsv(fLogins.map(l => ({ user_id: l.user_id, full_name: l.full_name, email: l.email, last_ip: l.last_ip, last_location: l.last_location, last_seen_at: l.last_seen_at, login_count: l.login_count } as Record<string, unknown>)), "recent_logins.csv")}
      >
        <div className="overflow-x-auto rounded-xl border border-border overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="bg-muted border-b border-border"><TH>User</TH><TH>IP Address</TH><TH>Location</TH><TH>Last Seen</TH><TH>Logins</TH></tr></thead>
            <tbody>
              {fLogins.map(l => (
                <tr key={l.user_id} className="border-b border-border hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3"><p className="font-black text-foreground">{l.full_name || "—"}</p><p className="text-[11px] text-muted-foreground font-medium">{l.email}</p></td>
                  <td className="px-4 py-3">
                    {l.last_ip ? (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-cyan-700 dark:text-cyan-400/80 font-bold">{l.last_ip}</span>
                        <button type="button" title="Copy IP" onClick={() => copyText(l.last_ip!, "IP copied")} className="text-muted-foreground hover:text-foreground transition-colors"><Copy className="w-3 h-3" /></button>
                      </div>
                    ) : <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs font-bold text-emerald-600 dark:text-emerald-400/60">{l.last_location || <span className="text-muted-foreground/50">—</span>}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-medium">{fmt(l.last_seen_at)}</td>
                  <td className="px-4 py-3"><span className="text-xs font-black text-muted-foreground">{l.login_count ?? 0}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* High Login Frequency */}
      <SectionCard title="High Login Frequency" count={fHighLogin.length} icon={Hash} color="text-amber-400"
        onExport={() => exportCsv(fHighLogin.map(p => ({ user_id: p.user_id, full_name: p.full_name, email: p.email, login_count: p.login_count, last_ip: p.last_ip, last_location: p.last_location } as Record<string, unknown>)), "high_logins.csv")}
      >
        {fHighLogin.length === 0 ? <EmptyState icon={Hash} message="No accounts with 50+ logins." /> : (
          <div className="overflow-x-auto rounded-xl border border-border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted border-b border-border"><TH>User</TH><TH>Logins</TH><TH>IP</TH><TH>Location</TH><TH>Role</TH></tr></thead>
              <tbody>
                {fHighLogin.map(p => {
                  const role = roleLabel(p);
                  return (
                    <tr key={p.user_id} className="border-b border-border hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3"><p className="font-black text-foreground">{p.full_name || "—"}</p><p className="text-[11px] text-muted-foreground font-medium">{p.email}</p></td>
                      <td className="px-4 py-3"><span className="text-base font-black text-amber-600 dark:text-amber-400">{p.login_count}</span></td>
                      <td className="px-4 py-3"><span className="font-mono text-xs text-cyan-600 dark:text-cyan-400/60 font-bold">{p.last_ip || "—"}</span></td>
                      <td className="px-4 py-3 text-xs font-bold text-emerald-600 dark:text-emerald-400/60">{p.last_location || "—"}</td>
                      <td className="px-4 py-3"><span className={`text-[10px] font-black px-2 py-0.5 rounded-full border shadow-sm ${role.cls}`}>{role.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );

  const renderAccess = () => (
    <div className="space-y-4">
      {/* System Controls */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
        <div className="flex items-center gap-2 mb-5">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20"><Lock className="w-4 h-4 text-amber-600 dark:text-amber-500" /></div>
          <span className="font-black text-foreground text-sm">Platform Controls</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { key: "registration_enabled", label: "User Registration", desc: "Allow new users to sign up", active: sysSettings?.registration_enabled, activeColor: "border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-400", inactiveColor: "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400", activeLabel: "Open", inactiveLabel: "Locked" },
            { key: "maintenance_mode", label: "Maintenance Mode", desc: "Show maintenance message at checkout", active: sysSettings?.maintenance_mode, activeColor: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400", inactiveColor: "border-border bg-muted text-muted-foreground", activeLabel: "Active", inactiveLabel: "Off" },
          ].map(setting => (
            <div key={setting.key} className="flex items-center justify-between p-4 rounded-xl bg-background border border-border shadow-sm">
              <div>
                <p className="font-black text-sm text-foreground">{setting.label}</p>
                <p className="text-[11px] text-muted-foreground font-medium mt-0.5">{setting.desc}</p>
              </div>
              <button type="button"
                onClick={() => toggleSetting(setting.key, !setting.active)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all border shadow-sm ${setting.active ? setting.activeColor : setting.inactiveColor}`}
              >
                {setting.active ? setting.activeLabel : setting.inactiveLabel}
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <Button onClick={handlePurge} disabled={purging}
            className="gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl text-xs h-9 w-full sm:w-auto">
            {purging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
            Purge Test Accounts
          </Button>
        </div>
      </div>

      {/* Blocklist */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20"><Shield className="w-4 h-4 text-red-600 dark:text-red-500" /></div>
          <span className="font-black text-foreground text-sm">IP & Domain Blocklist</span>
          <span className="text-[10px] font-black bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full shadow-sm">{blacklist.length}</span>
        </div>
        <div className="p-5 space-y-4">
          {/* Add form */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <select title="Block type" value={blType} onChange={e => setBlType(e.target.value)}
              className="bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-red-500/20">
              <option value="ip">IP Address</option>
              <option value="domain">Email Domain</option>
            </select>
            <Input value={blValue} onChange={e => setBlValue(e.target.value)} placeholder="192.168.1.1 or @domain.com"
              className="sm:col-span-2 bg-background border-border text-foreground rounded-xl focus-visible:ring-red-500/20" />
            <Button onClick={() => { if (blValue.trim()) handleBlacklist("add", blValue.trim(), blType, blReason || "Manual block"); }}
              className="bg-red-600 hover:bg-red-700 text-white rounded-xl font-black shadow-sm">
              Block
            </Button>
          </div>

          {blacklist.length === 0 ? (
            <EmptyState icon={Shield} message="No IPs or domains blocked." />
          ) : (
            <div className="rounded-xl border border-border divide-y divide-border overflow-hidden shadow-sm">
              {blacklist.map(item => (
                <div key={item.id} className="flex items-center justify-between px-4 py-3 bg-background hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-500 border border-red-500/20 shrink-0 shadow-sm">{item.type}</span>
                    <span className="text-sm font-mono text-foreground font-black truncate">{item.value}</span>
                    {item.reason && <span className="text-[10px] text-muted-foreground font-medium truncate hidden sm:block">{item.reason}</span>}
                  </div>
                  <button type="button" onClick={() => handleBlacklist("remove", item.value)}
                    className="text-[10px] font-black text-muted-foreground hover:text-red-600 transition-colors ml-3 shrink-0 uppercase tracking-wider">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderAdmins = () => (
    <div className="space-y-6">
      {/* Add Admin Form */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
        <div className="flex items-center gap-2 mb-5">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-500" />
          </div>
          <span className="font-black text-foreground text-sm">Grant Administrator Privileges</span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Promote an existing registered user to permanent Administrator status. They will gain full access to system wallets, providers, and user management tools.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 max-w-2xl">
          <Input
            placeholder="Enter account email (e.g. admin@swiftdatagh.shop)..."
            value={newAdminEmail}
            onChange={(e) => setNewAdminEmail(e.target.value)}
            className="bg-background border-border text-foreground rounded-xl"
            onKeyDown={(e) => { if (e.key === "Enter") void handleAddAdmin(); }}
          />
          <Button
            onClick={handleAddAdmin}
            disabled={addingAdmin || !newAdminEmail.trim()}
            className="gap-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black shadow-sm shrink-0"
          >
            {addingAdmin ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Grant Admin Role
          </Button>
        </div>
      </div>

      {/* Admins List */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
            </div>
            <span className="font-black text-foreground text-sm">System Administrators</span>
            <span className="text-[10px] font-black bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full shadow-sm">
              {adminsList.length}
            </span>
          </div>
          <button type="button" onClick={() => void fetchAdmins()} title="Refresh List" className="text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loadingAdmins ? "animate-spin" : ""}`} />
          </button>
        </div>

        {loadingAdmins && adminsList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
            <p className="text-xs font-bold text-muted-foreground uppercase">Fetching system roster...</p>
          </div>
        ) : adminsList.length === 0 ? (
          <EmptyState icon={ShieldAlert} message="No administrators returned. Check edge log." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted border-b border-border">
                  <TH>Administrator</TH>
                  <TH>🛡️ MFA Status</TH>
                  <TH>Last Seen</TH>
                  <TH>Security Lock</TH>
                  <TH>Actions</TH>
                </tr>
              </thead>
              <tbody>
                {adminsList.map((adm) => {
                  const isMe = adm.user_id === session?.user.id;
                  return (
                    <tr key={adm.user_id} className="border-b border-border hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${
                            isMe ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30" : "bg-muted text-muted-foreground border border-border"
                          }`}>
                            {(adm.full_name || adm.email || "?").charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-black text-foreground text-sm leading-tight">{adm.full_name || "Unnamed"}</p>
                              {isMe && (
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                  You
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground font-medium">{adm.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {adm.is_mfa_verified ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm">
                            <Shield className="w-3.5 h-3.5 fill-emerald-500/20" />
                            <span className="text-[10px] font-black uppercase tracking-wider">2FA Secured</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 animate-pulse shadow-sm">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-black uppercase tracking-wider">No 2FA</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-xs font-medium text-muted-foreground">
                        {fmt(adm.last_seen_at)}
                      </td>
                      <td className="px-4 py-4">
                        {adm.allowed_ips && adm.allowed_ips.length > 0 ? (
                          <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <Lock className="w-3 h-3" /> {adm.allowed_ips.length} IP lockdown
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                            <Globe className="w-3 h-3 opacity-60" /> Global Access
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {!isMe ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRevokeAdmin(adm.user_id, adm.full_name || adm.email)}
                            className="h-8 text-[10px] font-black text-muted-foreground hover:text-red-500 hover:bg-red-500/5 px-3 rounded-lg uppercase tracking-wider shadow-sm"
                          >
                            Revoke
                          </Button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/50 italic px-3">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const renderAudit = () => (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20"><BookOpen className="w-4 h-4 text-violet-600 dark:text-violet-400" /></div>
          <span className="font-black text-foreground text-sm">Admin Action Log</span>
          <span className="text-[10px] font-black bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-full shadow-sm">Last 50</span>
        </div>
        <button type="button" onClick={() => exportCsv(actionLog as unknown as Record<string, unknown>[], "admin_log.csv")}
          className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-muted font-black shadow-sm bg-background border border-border">
          <FileDown className="w-3 h-3" /> CSV
        </button>
      </div>
      {actionLog.length === 0 ? (
        <div className="p-5"><EmptyState icon={BookOpen} message="No admin actions recorded yet." /></div>
      ) : (
        <div className="divide-y divide-border">
          {actionLog.map(entry => (
            <div key={entry.id} className="flex items-center justify-between px-5 py-3 bg-background hover:bg-muted/50 transition-colors gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border shadow-sm ${
                    entry.action.includes("suspend") ? "bg-red-500/10 text-red-600 border-red-500/20" :
                    entry.action.includes("approve") || entry.action.includes("unsuspend") ? "bg-green-500/10 text-green-600 border-green-500/20" :
                    entry.action.includes("reject") ? "bg-orange-500/10 text-orange-600 border-orange-500/20" :
                    "bg-muted text-muted-foreground border-border"
                  }`}>{entry.action.replace(/_/g, " ")}</span>
                  <span className="text-xs font-bold text-foreground/80">{entry.target_email || "—"}</span>
                  <span className="text-[10px] text-muted-foreground font-medium hidden sm:block">by {entry.admin_email}</span>
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground font-bold shrink-0 whitespace-nowrap">{fmt(entry.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderGuardian = () => (
    <div className="space-y-6">
      <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-card/50 p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="flex gap-4">
            <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-cyan-500/20 animate-pulse" />
              <Bot className="w-7 h-7 text-cyan-600 dark:text-cyan-400 relative z-10" />
            </div>
            <div>
              <h2 className="text-lg font-black text-cyan-700 dark:text-cyan-400 uppercase tracking-wide">Guardian AI</h2>
              <p className="text-xs text-muted-foreground font-medium mt-1">Autonomous 24/7 Security Patrol</p>
              <div className="flex items-center gap-2 mt-3">
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-black uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active
                </span>
                <span className="text-[10px] text-muted-foreground font-bold">Scanning every 5 minutes</span>
              </div>
            </div>
          </div>
          <button type="button" onClick={() => void fetchData(true)} className="flex items-center justify-center w-9 h-9 rounded-xl bg-background border border-border text-muted-foreground hover:text-foreground transition-all">
             <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
           <Shield className="w-4 h-4 text-cyan-600 dark:text-cyan-500" />
           <span className="font-black text-foreground text-sm">Action & Patrol Log</span>
        </div>
        {guardianLogs.length === 0 ? (
          <EmptyState icon={Bot} message="Guardian AI is patrolling but has not executed any recent actions." />
        ) : (
          <div className="divide-y divide-border">
            {guardianLogs.map(log => (
              <div key={log.id} className="p-4 bg-background hover:bg-muted/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border shadow-sm ${
                      log.action_type === 'lock_terminal' ? "bg-red-500/10 text-red-600 border-red-500/20" :
                      log.action_type === 'broadcast_outage' ? "bg-orange-500/10 text-orange-600 border-orange-500/20" :
                      "bg-cyan-500/10 text-cyan-600 border-cyan-500/20"
                    }`}>
                      {log.action_type.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs font-bold text-foreground">
                      {log.metadata?.target ? `Target: ${log.metadata.target.slice(0, 8)}` : "System Action"}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-bold">{fmt(log.created_at)}</span>
                </div>
                <p className="text-xs text-muted-foreground/80 font-medium">{log.reasoning}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  /* ── render ─────────────────────────────────────────────────────── */
  return (
    <div className="space-y-6 pb-10">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/20">
            <Shield className="w-5 h-5 text-amber-600 dark:text-amber-500" />
          </div>
          <div>
            <h1 className="font-black text-2xl text-foreground tracking-tight uppercase">Security Center</h1>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">Fraud detection · Access control · Audit trail</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Search users, IPs…" value={search} onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 w-52 bg-background border-border text-foreground placeholder:text-muted-foreground rounded-xl text-sm focus-visible:ring-amber-500/20 shadow-sm" />
          </div>
          <button type="button" title="Refresh" onClick={() => void fetchData(true)}
            className="flex items-center justify-center w-9 h-9 rounded-xl bg-background border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all shadow-sm">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button type="button"
            onClick={() => exportCsv([
              ...clusters.flatMap(c => c.accounts.map(a => ({ section: "shared_ip", ip: c.ip, ...a } as Record<string, unknown>))),
              ...velocityAccts.map(v => ({ section: "velocity", ...v } as Record<string, unknown>)),
              ...failedUsers.map(u => ({ section: "failed_orders", ...u } as Record<string, unknown>)),
            ], "security_export.csv")}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-background border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all text-xs font-black shadow-sm">
            <FileDown className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 p-1.5 bg-muted/50 border border-border rounded-2xl w-fit overflow-x-auto shadow-sm">
        {TABS.map(t => {
          const active = tab === t.id;
          const Icon   = t.icon;
          const danger =
            (t.id === "threats"  && (clusters.length + referralGroups.length + failedUsers.length + velocityAccts.length) > 0) ||
            (t.id === "access"   && sysSettings?.maintenance_mode);
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap shadow-sm ${
                active ? "bg-card text-foreground border border-border shadow-md" : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {danger && !active && <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />}
            </button>
          );
        })}
      </div>

      {/* ── Tab body ── */}
      {tab === "overview"  && renderOverview()}
      {tab === "guardian"  && renderGuardian()}
      {tab === "threats"   && renderThreats()}
      {tab === "activity"  && renderActivity()}
      {tab === "access"    && renderAccess()}
      {tab === "admins"    && renderAdmins()}
      {tab === "audit"     && renderAudit()}
    </div>
  );
};

export default AdminSecurity;
