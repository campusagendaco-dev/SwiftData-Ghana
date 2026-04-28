import { type ReactNode, useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LucideIcon } from "lucide-react";
import {
  Shield, Globe, AlertTriangle, Clock, RefreshCw,
  Loader2, CheckCircle2, Eye, Search, Zap, Gift,
  TrendingUp, FileDown, Activity, BookOpen, Hash,
  BarChart2, Ban, ChevronDown,
} from "lucide-react";

import { cn } from "@/lib/utils";

interface ProfileRow {
  user_id: string;
  full_name: string;
  email: string;
  last_ip: string | null;
  last_seen_at: string | null;
  last_location: string | null;
  login_count: number;
  is_agent: boolean;
  agent_approved: boolean;
  is_sub_agent: boolean;
  referred_by: string | null;
  created_at: string;
  is_suspended: boolean;
}

interface IpCluster {
  ip: string;
  location: string | null;
  accounts: ProfileRow[];
}

interface RecentLogin {
  user_id: string;
  full_name: string;
  email: string;
  last_ip: string | null;
  last_seen_at: string | null;
  last_location: string | null;
  login_count: number;
  is_agent: boolean;
}

interface VelocityAccount {
  user_id: string;
  full_name: string;
  email: string;
  joined_at: string;
  first_order_at: string;
  minutes_to_first_order: number;
}

interface ReferralGroup {
  referrer_id: string;
  referrer_name: string;
  referrer_email: string;
  count: number;
  members: { user_id: string; full_name: string; email: string }[];
}

interface FailedOrderUser {
  user_id: string;
  full_name: string;
  email: string;
  total: number;
  failed: number;
  rate: number;
}

interface SignupDay {
  date: string;
  count: number;
}

interface AdminAction {
  id: string;
  admin_email: string;
  action: string;
  target_email: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface Alert {
  id: string;
  message: string;
  time: Date;
}

const roleLabel = (p: ProfileRow) => {
  if (p.is_sub_agent) return { label: "Sub-Agent", cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
  if (p.is_agent && p.agent_approved) return { label: "Agent", cls: "bg-green-500/20 text-green-400 border-green-500/30" };
  if (p.is_agent) return { label: "Agent (Pending)", cls: "bg-amber-500/20 text-amber-400 border-amber-500/30" };
  return { label: "Customer", cls: "bg-white/5 text-white/40 border-white/10" };
};

const exportCsv = (rows: Record<string, unknown>[], filename: string) => {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? "")).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
};

interface SectionProps {
  icon: LucideIcon;
  title: string;
  badge: ReactNode;
  iconColor: string;
  children: ReactNode;
  onExport?: () => void;
  defaultOpen?: boolean;
}

const Section = ({ icon: Icon, title, badge, iconColor, children, onExport, defaultOpen = true }: SectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-2 cursor-pointer group bg-transparent border-none p-0 text-left outline-none"
          >
            <Icon className={`w-4 h-4 ${iconColor} group-hover:scale-110 transition-transform`} />
            <h2 className="font-black text-lg text-white group-hover:text-white/80 transition-colors">{title}</h2>
            <ChevronDown className={`w-4 h-4 text-white/30 transition-transform ${open ? "rotate-180" : ""} group-hover:text-white/60`} />
          </button>
          {badge}
        </div>
        {onExport && (
          <button
            type="button"
            onClick={onExport}
            className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/60 transition-colors"
          >
            <FileDown className="w-3.5 h-3.5" /> Export CSV
          </button>
        )}
      </div>
      {open && children}
    </div>
  );
};

const EmptyState = ({ message }: { message: string }) => (
  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center">
    <CheckCircle2 className="w-7 h-7 text-green-400 mx-auto mb-2" />
    <p className="text-sm text-white/50">{message}</p>
  </div>
);

const AdminSecurity = () => {
  const { toast } = useToast();
  const [clusters, setClusters] = useState<IpCluster[]>([]);
  const [recentLogins, setRecentLogins] = useState<RecentLogin[]>([]);
  const [velocityAccounts, setVelocityAccounts] = useState<VelocityAccount[]>([]);
  const [referralGroups, setReferralGroups] = useState<ReferralGroup[]>([]);
  const [highLogins, setHighLogins] = useState<ProfileRow[]>([]);
  const [failedUsers, setFailedUsers] = useState<FailedOrderUser[]>([]);
  const [signupTrend, setSignupTrend] = useState<SignupDay[]>([]);
  const [actionLog, setActionLog] = useState<AdminAction[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [suspendedCount, setSuspendedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedIp, setExpandedIp] = useState<string | null>(null);
  const [blacklist, setBlacklist] = useState<{id: string, type: string, value: string, reason: string}[]>([]);
  const [sysSettings, setSysSettings] = useState<any>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    setLoading(true);

    const [profilesRes, recentRes, velocityRes, ordersRes, signupsRes, actionRes, blacklistRes, settingsRes] = await Promise.all([
      (supabase as any)
        .from("profiles")
        .select("user_id, full_name, email, last_ip, last_seen_at, last_location, login_count, is_agent, agent_approved, is_sub_agent, referred_by, created_at, is_suspended")
        .order("created_at", { ascending: false })
        .limit(2000),

      (supabase as any)
        .from("profiles")
        .select("user_id, full_name, email, last_ip, last_seen_at, last_location, login_count, is_agent")
        .not("last_seen_at", "is", null)
        .order("last_seen_at", { ascending: false })
        .limit(30),

      (supabase as any).rpc("get_velocity_accounts"),

      supabase
        .from("orders")
        .select("agent_id, status")
        .gte("created_at", thirtyDaysAgo)
        .limit(5000),

      (supabase as any)
        .from("profiles")
        .select("created_at")
        .gte("created_at", fourteenDaysAgo)
        .order("created_at", { ascending: true }),

      (supabase as any)
        .from("admin_action_log")
        .select("id, admin_email, action, target_email, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(50),

      supabase.from("security_blacklist").select("*"),
      supabase.from("system_settings").select("*").eq("id", 1).maybeSingle(),
    ]);

    const allProfiles = (profilesRes.data || []) as unknown as ProfileRow[];

    // Shared IP clusters
    const ipMap = new Map<string, ProfileRow[]>();
    for (const row of allProfiles) {
      if (!row.last_ip) continue;
      const arr = ipMap.get(row.last_ip) || [];
      arr.push(row);
      ipMap.set(row.last_ip, arr);
    }
    const sharedClusters: IpCluster[] = [];
    ipMap.forEach((accounts, ip) => {
      if (accounts.length >= 2) {
        sharedClusters.push({ ip, location: accounts.find(a => a.last_location)?.last_location ?? null, accounts });
      }
    });
    sharedClusters.sort((a, b) => b.accounts.length - a.accounts.length);

    // High login frequency (50+)
    const highLoginAccounts = allProfiles
      .filter(p => (p.login_count ?? 0) >= 50)
      .sort((a, b) => (b.login_count ?? 0) - (a.login_count ?? 0));

    // Referral abuse (5+ signups from one referrer)
    const refMap = new Map<string, ProfileRow[]>();
    for (const p of allProfiles) {
      if (!p.referred_by) continue;
      const arr = refMap.get(p.referred_by) || [];
      arr.push(p);
      refMap.set(p.referred_by, arr);
    }
    const groups: ReferralGroup[] = [];
    refMap.forEach((members, referrerId) => {
      if (members.length >= 5) {
        const referrer = allProfiles.find(p => p.user_id === referrerId);
        groups.push({
          referrer_id: referrerId,
          referrer_name: referrer?.full_name || "Unknown",
          referrer_email: referrer?.email || referrerId,
          count: members.length,
          members: members.map(m => ({ user_id: m.user_id, full_name: m.full_name, email: m.email })),
        });
      }
    });
    groups.sort((a, b) => b.count - a.count);

    // Failed order rate (≥5 orders, ≥50% failure)
    const orderStats = new Map<string, { total: number; failed: number }>();
    for (const o of ((ordersRes.data || []) as { agent_id: string; status: string }[])) {
      const s = orderStats.get(o.agent_id) || { total: 0, failed: 0 };
      s.total++;
      if (o.status === "failed" || o.status === "fulfillment_failed") s.failed++;
      orderStats.set(o.agent_id, s);
    }
    const failed: FailedOrderUser[] = [];
    orderStats.forEach((s, agentId) => {
      if (s.total >= 5 && s.failed / s.total >= 0.5) {
        const p = allProfiles.find(x => x.user_id === agentId);
        if (p) failed.push({ user_id: agentId, full_name: p.full_name, email: p.email, total: s.total, failed: s.failed, rate: Math.round((s.failed / s.total) * 100) });
      }
    });
    failed.sort((a, b) => b.rate - a.rate);

    // Signup trend (last 14 days)
    const dayMap = new Map<string, number>();
    for (let i = 13; i >= 0; i--) {
      dayMap.set(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10), 0);
    }
    for (const row of ((signupsRes.data || []) as { created_at: string }[])) {
      const d = row.created_at.slice(0, 10);
      if (dayMap.has(d)) dayMap.set(d, (dayMap.get(d) || 0) + 1);
    }
    const trend = Array.from(dayMap.entries()).map(([date, count]) => ({ date, count }));

    setClusters(sharedClusters);
    setRecentLogins((recentRes.data || []) as unknown as RecentLogin[]);
    setVelocityAccounts(velocityRes.error ? [] : ((velocityRes.data || []) as unknown as VelocityAccount[]));
    setReferralGroups(groups);
    setHighLogins(highLoginAccounts);
    setFailedUsers(failed);
    setSignupTrend(trend);
    setActionLog((actionRes.data || []) as unknown as AdminAction[]);
    setBlacklist(blacklistRes.data || []);
    setSysSettings(settingsRes.data);
    setSuspendedCount(allProfiles.filter(p => p.is_suspended).length);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Real-time: push new logins into the recent logins feed + live alert strip
  useEffect(() => {
    const channel = supabase
      .channel("security-rt")
      .on("postgres_changes" as any, { event: "UPDATE", schema: "public", table: "profiles" }, (payload: any) => {
        const p = payload.new as RecentLogin;
        if (!p.last_seen_at) return;
        setRecentLogins(prev => [p, ...prev.filter(l => l.user_id !== p.user_id)].slice(0, 30));
        setAlerts(prev => [{
          id: Math.random().toString(36).slice(2),
          message: `Login: ${p.full_name || p.email || "Unknown"} — ${p.last_ip || "no IP"}${p.last_location ? ` · ${p.last_location}` : ""}`,
          time: new Date(),
        }, ...prev].slice(0, 10));
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, []);

  const copyIp = (ip: string) => {
    void navigator.clipboard.writeText(ip);
    toast({ title: "IP copied", description: ip });
  };

  const handlePurge = async () => {
    if (!confirm("Are you sure? This will delete all 'apitest' and '@example.com' accounts, wallets, and orders.")) return;
    setPurging(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-user-actions", {
        body: { action: "purge_test_accounts" }
      });
      if (error) throw error;
      toast({ title: "Purge Complete", description: `Deleted ${data.deleted_count} test accounts.` });
      void fetchData();
    } catch (err: any) {
      toast({ title: "Purge Failed", description: err.message, variant: "destructive" });
    } finally {
      setPurging(false);
    }
  };

  const handleBulkSuspend = async (userIds: string[], suspend: boolean) => {
    try {
      const { error } = await supabase.functions.invoke("admin-user-actions", {
        body: { action: "bulk_suspend_users", user_ids: userIds, suspend }
      });
      if (error) throw error;
      toast({ title: suspend ? "Accounts Suspended" : "Accounts Restored", description: `${userIds.length} accounts updated.` });
      void fetchData();
    } catch (err: any) {
      toast({ title: "Bulk Action Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleBlacklist = async (op: "add" | "remove", type?: string, value?: string, reason?: string) => {
    try {
      const { error } = await supabase.functions.invoke("admin-user-actions", {
        body: { action: "manage_blacklist", op, type, value, reason }
      });
      if (error) throw error;
      toast({ title: op === "add" ? "Added to Blacklist" : "Removed from Blacklist" });
      void fetchData();
    } catch (err: any) {
      toast({ title: "Blacklist Update Failed", description: err.message, variant: "destructive" });
    }
  };

  const toggleSystemSetting = async (key: string, value: boolean) => {
    try {
      const { error } = await supabase.functions.invoke("admin-user-actions", {
        body: { action: "update_system_settings", settings: { [key]: value } }
      });
      if (error) throw error;
      toast({ title: "Setting Updated" });
      void fetchData();
    } catch (err: any) {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    }
  };

  const s = search.toLowerCase();
  const filteredClusters = clusters.filter(c =>
    !s || c.ip.includes(s) || c.accounts.some(a => a.full_name?.toLowerCase().includes(s) || a.email?.toLowerCase().includes(s))
  );
  const filteredLogins = recentLogins.filter(r =>
    !s || r.full_name?.toLowerCase().includes(s) || r.email?.toLowerCase().includes(s) || r.last_ip?.includes(s)
  );
  const filteredHighLogins = highLogins.filter(p =>
    !s || p.full_name?.toLowerCase().includes(s) || p.email?.toLowerCase().includes(s)
  );
  const filteredFailed = failedUsers.filter(u =>
    !s || u.full_name?.toLowerCase().includes(s) || u.email?.toLowerCase().includes(s)
  );
  const filteredVelocity = velocityAccounts.filter(v =>
    !s || v.full_name?.toLowerCase().includes(s) || v.email?.toLowerCase().includes(s)
  );
  const filteredReferrals = referralGroups.filter(g =>
    !s || g.referrer_name?.toLowerCase().includes(s) || g.referrer_email?.toLowerCase().includes(s)
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        <p className="text-white/50 text-sm">Loading security data…</p>
      </div>
    );
  }

  const maxSignup = Math.max(...signupTrend.map(d => d.count), 1);

  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-5 h-5 text-amber-400" />
            <h1 className="font-display text-3xl font-black tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
              Security Center
            </h1>
          </div>
          <p className="text-sm text-white/50">Monitor IP activity, detect fraud patterns, and audit admin actions.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={handlePurge}
            disabled={purging}
            className="gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl text-xs h-9"
          >
            {purging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
            Purge Test Data
          </Button>
          
          <div className="flex items-center gap-2 bg-white/5 p-1 rounded-xl border border-white/10">
            <button
              onClick={() => toggleSystemSetting("registration_enabled", !sysSettings?.registration_enabled)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all",
                sysSettings?.registration_enabled ? "text-white/40 hover:text-white" : "bg-red-500 text-white shadow-lg shadow-red-500/20"
              )}
            >
              {sysSettings?.registration_enabled ? "Reg Open" : "Reg Locked"}
            </button>
            <button
              onClick={() => toggleSystemSetting("maintenance_mode", !sysSettings?.maintenance_mode)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all",
                !sysSettings?.maintenance_mode ? "text-white/40 hover:text-white" : "bg-amber-500 text-black shadow-lg shadow-amber-500/20"
              )}
            >
              {sysSettings?.maintenance_mode ? "Maintenance ON" : "Live"}
            </button>
          </div>

          <Button
            onClick={() => exportCsv([
              ...clusters.flatMap(c => c.accounts.map(a => ({ section: "shared_ip", ip: c.ip, location: c.location, ...a } as Record<string, unknown>))),
              ...velocityAccounts.map(v => ({ section: "velocity", ...v } as Record<string, unknown>)),
              ...referralGroups.flatMap(g => g.members.map(m => ({ section: "referral_abuse", referrer: g.referrer_email, ...m } as Record<string, unknown>))),
              ...failedUsers.map(u => ({ section: "failed_orders", ...u } as Record<string, unknown>)),
            ], "security_export.csv")}
            className="gap-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl text-xs h-9"
          >
            <FileDown className="w-3.5 h-3.5" /> Export All
          </Button>
          <Button onClick={fetchData} className="gap-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl h-9">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Security Health Score */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-3xl border border-white/5 bg-gradient-to-br from-white/[0.03] to-transparent p-6">
          <div className="flex items-center justify-between mb-6">
             <div>
                <h3 className="text-xl font-black text-white italic">SECURITY HEALTH</h3>
                <p className="text-xs text-white/40 uppercase tracking-widest font-bold">Platform integrity assessment</p>
             </div>
             <div className="text-right">
                <span className={cn(
                  "text-5xl font-black italic tracking-tighter",
                  clusters.length > 5 || referralGroups.length > 3 ? "text-red-500" : "text-emerald-500"
                )}>
                  {Math.max(0, 100 - (clusters.length * 5) - (referralGroups.length * 10) - (failedUsers.length * 2))}%
                </span>
             </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
             <div className="space-y-3">
                <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Active Risks</p>
                <div className="space-y-2">
                   {clusters.length > 0 && (
                     <div className="flex items-center gap-3 text-xs text-red-400 bg-red-500/5 p-3 rounded-2xl border border-red-500/10">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{clusters.length} shared IP clusters detected</span>
                     </div>
                   )}
                   {referralGroups.length > 0 && (
                     <div className="flex items-center gap-3 text-xs text-purple-400 bg-purple-500/5 p-3 rounded-2xl border border-purple-500/10">
                        <Gift className="w-4 h-4 shrink-0" />
                        <span>{referralGroups.length} referral abuse patterns</span>
                     </div>
                   )}
                   {failedUsers.length > 0 && (
                     <div className="flex items-center gap-3 text-xs text-orange-400 bg-orange-500/5 p-3 rounded-2xl border border-orange-500/10">
                        <TrendingUp className="w-4 h-4 shrink-0" />
                        <span>{failedUsers.length} users with high failure rate</span>
                     </div>
                   )}
                </div>
             </div>
             <div className="space-y-3">
                <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Recommendations</p>
                <div className="space-y-2">
                   {clusters.length > 0 && (
                     <div className="flex items-center gap-3 text-xs text-white/60 bg-white/5 p-3 rounded-2xl border border-white/10">
                        <Ban className="w-4 h-4 shrink-0 text-amber-400" />
                        <span>Audit accounts on IP {clusters[0].ip}</span>
                     </div>
                   )}
                   <div className="flex items-center gap-3 text-xs text-white/60 bg-white/5 p-3 rounded-2xl border border-white/10">
                      <Shield className="w-4 h-4 shrink-0 text-emerald-400" />
                      <span>Regularly rotate admin API keys</span>
                   </div>
                </div>
             </div>
          </div>
        </div>
        
        {/* Live alert feed (moved inside) */}
        <div className="rounded-3xl border border-cyan-500/20 bg-cyan-500/[0.04] p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
              <span className="text-xs font-black uppercase tracking-widest text-cyan-400">Live Traffic</span>
            </div>
            <button type="button" onClick={() => setAlerts([])} className="text-[10px] text-white/30 hover:text-white/60 uppercase font-black">
              Clear
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto max-h-[200px] scrollbar-none">
            {alerts.length === 0 ? (
               <div className="flex flex-col items-center justify-center h-full opacity-20">
                  <Globe className="w-8 h-8 mb-2" />
                  <p className="text-[10px] font-bold">Waiting for events...</p>
               </div>
            ) : alerts.map(a => (
              <div key={a.id} className="flex flex-col gap-1 text-xs border-l-2 border-cyan-500/30 pl-3 py-1">
                <span className="text-cyan-400/50 font-mono text-[9px]">{a.time.toLocaleTimeString()}</span>
                <p className="text-white/70 line-clamp-2">{a.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Shared IP Groups", value: clusters.length, icon: AlertTriangle, color: clusters.length > 0 ? "text-red-400" : "text-green-400", bg: clusters.length > 0 ? "bg-red-500/10 border-red-500/20" : "bg-green-500/10 border-green-500/20" },
          { label: "Velocity Flags", value: velocityAccounts.length, icon: Zap, color: velocityAccounts.length > 0 ? "text-orange-400" : "text-green-400", bg: velocityAccounts.length > 0 ? "bg-orange-500/10 border-orange-500/20" : "bg-green-500/10 border-green-500/20" },
          { label: "Referral Abuse", value: referralGroups.length, icon: Gift, color: referralGroups.length > 0 ? "text-purple-400" : "text-green-400", bg: referralGroups.length > 0 ? "bg-purple-500/10 border-purple-500/20" : "bg-green-500/10 border-green-500/20" },
          { label: "High Logins", value: highLogins.length, icon: Hash, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
          { label: "Failed Orders", value: failedUsers.length, icon: TrendingUp, color: failedUsers.length > 0 ? "text-red-400" : "text-green-400", bg: failedUsers.length > 0 ? "bg-red-500/10 border-red-500/20" : "bg-green-500/10 border-green-500/20" },
          { label: "Suspended", value: suspendedCount, icon: Ban, color: suspendedCount > 0 ? "text-red-400" : "text-white/30", bg: suspendedCount > 0 ? "bg-red-500/10 border-red-500/20" : "bg-white/[0.02] border-white/5" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className={`rounded-2xl border p-4 ${bg}`}>
            <Icon className={`w-5 h-5 mb-2 ${color}`} />
            <p className={`text-2xl font-black ${color}`}>{value}</p>
            <p className="text-[11px] text-white/40 uppercase tracking-wider mt-0.5 leading-tight">{label}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <Input
          placeholder="Search by IP, name, or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-amber-400/40"
        />
      </div>

      {/* ── Shared IP Groups ── */}
      <Section
        icon={AlertTriangle}
        title="Shared IP Groups"
        iconColor="text-red-400"
        badge={<span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full font-bold">{filteredClusters.length}</span>}
        onExport={() => exportCsv(clusters.flatMap(c => c.accounts.map(a => ({ ip: c.ip, location: c.location, ...a } as Record<string, unknown>))), "shared_ips.csv")}
      >
        {filteredClusters.length === 0 ? (
          <EmptyState message="No shared IP addresses detected." />
        ) : (
          <div className="space-y-3">
            {filteredClusters.map(cluster => {
              const isExpanded = expandedIp === cluster.ip;
              return (
                <div key={cluster.ip} className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] overflow-hidden">
                  <div
                    className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-red-500/[0.06] transition-colors text-left border-none"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedIp(isExpanded ? null : cluster.ip)}
                      className="flex-1 flex items-center gap-3 flex-wrap cursor-pointer group bg-transparent border-none p-0 text-left outline-none"
                    >
                      <Globe className="w-4 h-4 text-red-400 shrink-0 group-hover:scale-110 transition-transform" />
                      <span className="font-mono text-sm font-bold text-red-300">{cluster.ip}</span>
                      {cluster.location && <span className="text-xs text-emerald-400/70">{cluster.location}</span>}
                      <span className="text-[10px] font-black uppercase tracking-widest bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full">
                        {cluster.accounts.length} accounts
                      </span>
                      <Eye className={`w-3.5 h-3.5 ml-1 transition-transform ${isExpanded ? "rotate-180 text-red-400" : "text-white/20"}`} />
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleBulkSuspend(cluster.accounts.map(a => a.user_id), true)}
                        className="text-[10px] font-black uppercase tracking-widest bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-1.5 rounded-xl transition-all"
                      >
                        Suspend All
                      </button>
                      <button
                        type="button"
                        onClick={() => copyIp(cluster.ip)}
                        className="text-[10px] font-bold text-white/30 hover:text-white/70 px-2 py-1.5 rounded-xl border border-white/10 hover:border-white/20 transition-colors"
                      >
                        Copy IP
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-red-500/20 divide-y divide-white/5">
                      {cluster.accounts.map(account => {
                        const role = roleLabel(account);
                        return (
                          <div key={account.user_id} className="flex items-center justify-between px-5 py-3 bg-black/20">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-white truncate">{account.full_name || "—"}</p>
                              <p className="text-xs text-white/40 truncate">{account.email}</p>
                              {account.last_seen_at && (
                                <p className="text-[10px] text-white/25 mt-0.5 flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5" />
                                  Last seen {new Date(account.last_seen_at).toLocaleString()}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-3">
                              {account.is_suspended && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-500/20 text-red-400 border-red-500/30">Suspended</span>
                              )}
                              <span className="text-[10px] text-white/30">{account.login_count ?? 0} logins</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${role.cls}`}>{role.label}</span>
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
      </Section>

      {/* ── Account Velocity ── */}
      <Section
        icon={Zap}
        title="Account Velocity"
        iconColor="text-orange-400"
        badge={<span className="text-xs bg-orange-500/20 text-orange-400 border border-orange-500/30 px-2 py-0.5 rounded-full font-bold">{filteredVelocity.length}</span>}
        onExport={() => exportCsv(filteredVelocity as unknown as Record<string, unknown>[], "velocity_accounts.csv")}
      >
        {filteredVelocity.length === 0 ? (
          <EmptyState message="No accounts placed orders within 5 minutes of signup." />
        ) : (
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 bg-white/[0.02]">
                    <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">User</th>
                    <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">Joined</th>
                    <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">First Order</th>
                    <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">Delay</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVelocity.map(v => (
                    <tr key={v.user_id} className="border-b border-white/5 hover:bg-white/[0.03]">
                      <td className="p-4">
                        <p className="font-semibold text-white">{v.full_name || "—"}</p>
                        <p className="text-xs text-white/40">{v.email}</p>
                      </td>
                      <td className="p-4 text-xs text-white/50">{new Date(v.joined_at).toLocaleString()}</td>
                      <td className="p-4 text-xs text-white/50">{new Date(v.first_order_at).toLocaleString()}</td>
                      <td className="p-4">
                        <span className="text-sm font-black text-orange-400">{v.minutes_to_first_order}m</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* ── Referral Abuse ── */}
      <Section
        icon={Gift}
        title="Referral Abuse"
        iconColor="text-purple-400"
        badge={<span className="text-xs bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full font-bold">{filteredReferrals.length}</span>}
        onExport={() => exportCsv(
          referralGroups.flatMap(g => g.members.map(m => ({ referrer: g.referrer_email, ...m } as Record<string, unknown>))),
          "referral_abuse.csv"
        )}
      >
        {filteredReferrals.length === 0 ? (
          <EmptyState message="No referral codes with 5+ signups detected." />
        ) : (
          <div className="space-y-3">
            {filteredReferrals.map(group => (
              <div key={group.referrer_id} className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.04] p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-bold text-white">{group.referrer_name}</p>
                    <p className="text-xs text-white/40">{group.referrer_email}</p>
                  </div>
                  <span className="text-xs font-black bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full">
                    {group.count} referrals
                  </span>
                </div>
                <div className="space-y-1.5">
                  {group.members.map(m => (
                    <div key={m.user_id} className="flex items-center gap-2 text-xs bg-black/20 px-3 py-1.5 rounded-lg">
                      <span className="text-white/70">{m.full_name || "—"}</span>
                      <span className="text-white/30">·</span>
                      <span className="font-mono text-white/40">{m.email}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── High Login Frequency ── */}
      <Section
        icon={Hash}
        title="High Login Frequency"
        iconColor="text-amber-400"
        badge={<span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold">{filteredHighLogins.length}</span>}
        onExport={() => exportCsv(
          filteredHighLogins.map(p => ({ user_id: p.user_id, full_name: p.full_name, email: p.email, login_count: p.login_count, last_ip: p.last_ip, last_location: p.last_location } as Record<string, unknown>)),
          "high_logins.csv"
        )}
      >
        {filteredHighLogins.length === 0 ? (
          <EmptyState message="No accounts with 50+ logins." />
        ) : (
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 bg-white/[0.02]">
                    <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">User</th>
                    <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">Logins</th>
                    <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30 hidden sm:table-cell">IP</th>
                    <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30 hidden sm:table-cell">Location</th>
                    <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHighLogins.map(p => {
                    const role = roleLabel(p);
                    return (
                      <tr key={p.user_id} className="border-b border-white/5 hover:bg-white/[0.03]">
                        <td className="p-4">
                          <p className="font-semibold text-white">{p.full_name || "—"}</p>
                          <p className="text-xs text-white/40">{p.email}</p>
                        </td>
                        <td className="p-4">
                          <span className="text-sm font-black text-amber-400">{p.login_count}</span>
                        </td>
                        <td className="p-4 hidden sm:table-cell">
                          <span className="font-mono text-xs text-cyan-400/70">{p.last_ip || "—"}</span>
                        </td>
                        <td className="p-4 text-xs text-emerald-400/70 hidden sm:table-cell">
                          {p.last_location || "—"}
                        </td>
                        <td className="p-4">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${role.cls}`}>{role.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* ── High Failure Rate ── */}
      <Section
        icon={TrendingUp}
        title="High Failure Rate"
        iconColor="text-red-400"
        badge={<span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full font-bold">{filteredFailed.length}</span>}
        onExport={() => exportCsv(filteredFailed as unknown as Record<string, unknown>[], "failed_order_users.csv")}
      >
        {filteredFailed.length === 0 ? (
          <EmptyState message="No users with ≥50% failure rate (min 5 orders)." />
        ) : (
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 bg-white/[0.02]">
                    <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">User</th>
                    <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">Total</th>
                    <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">Failed</th>
                    <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">Failure Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFailed.map(u => (
                    <tr key={u.user_id} className="border-b border-white/5 hover:bg-white/[0.03]">
                      <td className="p-4">
                        <p className="font-semibold text-white">{u.full_name || "—"}</p>
                        <p className="text-xs text-white/40">{u.email}</p>
                      </td>
                      <td className="p-4 text-xs text-white/50">{u.total}</td>
                      <td className="p-4 text-xs text-red-400">{u.failed}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full bg-red-500 rounded-full" style={{ width: `${u.rate}%` }} />
                          </div>
                          <span className="text-xs font-black text-red-400">{u.rate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* ── Signup Trend ── */}
      <Section
        icon={BarChart2}
        title="Signup Trend"
        iconColor="text-cyan-400"
        badge={<span className="text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded-full font-bold">14 days</span>}
        onExport={() => exportCsv(signupTrend as unknown as Record<string, unknown>[], "signup_trend.csv")}
      >
        <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
          <div className="flex items-end gap-1 h-24">
            {signupTrend.map(day => (
              <div key={day.date} className="flex flex-col items-center gap-1 flex-1 group">
                <span className="text-[9px] text-white/40 opacity-0 group-hover:opacity-100 transition-opacity">{day.count}</span>
                <div
                  className="w-full bg-cyan-500/40 hover:bg-cyan-500/70 rounded-t transition-colors"
                  style={{ height: `${Math.max(3, (day.count / maxSignup) * 72)}px` }}
                  title={`${day.date}: ${day.count} signups`}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-white/25">{signupTrend[0]?.date.slice(5)}</span>
            <span className="text-[10px] text-white/25">{signupTrend[signupTrend.length - 1]?.date.slice(5)}</span>
          </div>
          <p className="text-center text-xs text-white/30 mt-3">
            Total: <span className="text-cyan-400 font-black">{signupTrend.reduce((s, d) => s + d.count, 0)}</span> new accounts in 14 days
          </p>
        </div>
      </Section>

      {/* ── Recent Logins ── */}
      <Section
        icon={Clock}
        title="Recent Logins"
        iconColor="text-cyan-400"
        badge={
          <div className="flex items-center gap-2">
            <span className="text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded-full font-bold">Last 30</span>
            <span className="flex items-center gap-1 text-[10px] text-cyan-400/60">
              <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse inline-block" />
              Live
            </span>
          </div>
        }
        onExport={() => exportCsv(
          filteredLogins.map(l => ({ user_id: l.user_id, full_name: l.full_name, email: l.email, last_ip: l.last_ip, last_location: l.last_location, last_seen_at: l.last_seen_at, login_count: l.login_count } as Record<string, unknown>)),
          "recent_logins.csv"
        )}
      >
        <div className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.02]">
                  <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">User</th>
                  <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">IP Address</th>
                  <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30 hidden sm:table-cell">Location</th>
                  <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">Last Seen</th>
                  <th className="text-left p-4 text-[10px] font-black uppercase tracking-widest text-white/30">Logins</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogins.map(login => (
                  <tr key={login.user_id} className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                    <td className="p-4">
                      <p className="font-semibold text-white">{login.full_name || "—"}</p>
                      <p className="text-xs text-white/40">{login.email}</p>
                    </td>
                    <td className="p-4">
                      {login.last_ip ? <span className="font-mono text-xs text-cyan-400/80">{login.last_ip}</span> : <span className="text-white/20">—</span>}
                    </td>
                    <td className="p-4 text-xs text-emerald-400/70 hidden sm:table-cell">
                      {login.last_location || <span className="text-white/20">—</span>}
                    </td>
                    <td className="p-4 text-xs text-white/50">
                      {login.last_seen_at ? new Date(login.last_seen_at).toLocaleString() : "—"}
                    </td>
                    <td className="p-4">
                      <span className="text-xs font-bold text-white/60">{login.login_count ?? 0}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* ── Blacklist Management ── */}
      <Section
        icon={Shield}
        title="Blacklist Management"
        iconColor="text-red-500"
        badge={<span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full font-bold">{blacklist.length}</span>}
        defaultOpen={false}
      >
        <div className="space-y-4">
           {/* Add Form */}
           <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-white/5 p-4 rounded-2xl border border-white/10">
              <select 
                id="blacklist-type"
                className="bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none"
              >
                 <option value="ip">IP Address</option>
                 <option value="domain">Email Domain</option>
              </select>
              <Input id="blacklist-value" placeholder="192.168.1.1 or @gmail.com" className="sm:col-span-2 bg-black/40 border-white/10 rounded-xl text-white" />
              <Button 
                onClick={() => {
                  const t = (document.getElementById("blacklist-type") as HTMLSelectElement).value;
                  const v = (document.getElementById("blacklist-value") as HTMLInputElement).value;
                  if (v) handleBlacklist("add", t, v, "Manual Admin Addition");
                }}
                className="bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold"
              >
                Add to Ban List
              </Button>
           </div>

           {blacklist.length === 0 ? (
             <EmptyState message="No IPs or domains blacklisted." />
           ) : (
             <div className="rounded-2xl bg-white/[0.02] border border-white/5 divide-y divide-white/5">
                {blacklist.map(item => (
                   <div key={item.id} className="flex items-center justify-between p-4">
                      <div>
                         <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20">{item.type}</span>
                            <span className="text-sm font-mono text-white font-bold">{item.value}</span>
                         </div>
                         <p className="text-[10px] text-white/30 mt-1">{item.reason}</p>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleBlacklist("remove", undefined, item.value)}
                        className="text-white/30 hover:text-red-400"
                      >
                         Remove
                      </Button>
                   </div>
                ))}
             </div>
           )}
        </div>
      </Section>

      {/* ── Admin Action Log ── */}
      <Section
        icon={BookOpen}
        title="Admin Action Log"
        iconColor="text-violet-400"
        badge={<span className="text-xs bg-violet-500/20 text-violet-400 border border-violet-500/30 px-2 py-0.5 rounded-full font-bold">Last 50</span>}
        onExport={() => exportCsv(actionLog as unknown as Record<string, unknown>[], "admin_action_log.csv")}
        defaultOpen={false}
      >
        {actionLog.length === 0 ? (
          <EmptyState message="No admin actions recorded yet." />
        ) : (
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 divide-y divide-white/5">
            {actionLog.map(entry => (
              <div key={entry.id} className="flex items-center justify-between px-4 py-3 gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                      entry.action.includes("suspend") ? "bg-red-500/20 text-red-400 border-red-500/30" :
                      entry.action.includes("unsuspend") || entry.action.includes("approve") ? "bg-green-500/20 text-green-400 border-green-500/30" :
                      "bg-white/5 text-white/40 border-white/10"
                    }`}>{entry.action.replace(/_/g, " ")}</span>
                    <span className="text-xs text-white/50">{entry.target_email || "—"}</span>
                  </div>
                  <p className="text-[11px] text-white/30 mt-0.5">by {entry.admin_email || "unknown"}</p>
                </div>
                <span className="text-[10px] text-white/25 shrink-0">{new Date(entry.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
};

export default AdminSecurity;
