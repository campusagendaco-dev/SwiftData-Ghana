import { type ReactNode, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Shield, Globe, RefreshCw, Loader2, CheckCircle2,
  Search, Zap, Gift, TrendingUp, FileDown, Activity, BookOpen, Hash,
  BarChart2, Ban, ChevronDown, ChevronUp, Copy, Lock, ShieldAlert,
  UserX, MapPin, LogIn, AlertCircle, ShieldCheck, Bot,
  Crosshair, Radio, Terminal, TriangleAlert, Play
} from "lucide-react";

/* ─── interfaces ─────────────────────────────────────────────────── */
interface ProfileRow {
  user_id: string; full_name: string; email: string;
  last_ip: string | null; last_seen_at: string | null;
  last_location: string | null; login_count: number;
  is_agent: boolean; agent_approved: boolean; is_sub_agent: boolean;
  referred_by: string | null; created_at: string; is_suspended: boolean;
  device_id: string | null;
}
interface DeviceCluster {
  device_id: string;
  accounts: ProfileRow[];
  is_blocked: boolean;
}
interface IpCluster { ip: string; location: string | null; accounts: ProfileRow[] }
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
  user_id: string; role: string; email: string; full_name: string;
  last_seen_at: string | null; is_mfa_verified: boolean; allowed_ips: string[] | null;
}
interface SignupDay { date: string; count: number }
interface AdminAction {
  id: string; admin_email: string; action: string;
  target_email: string | null; metadata: Record<string, unknown>; created_at: string;
}
interface LiveAlert { id: string; message: string; time: Date }
interface SystemSettings {
  maintenance_mode: boolean; registration_enabled: boolean;
  dark_mode_enabled: boolean; store_visitor_popup_enabled: boolean;
}
interface GuardianLog {
  id: string; action_type: string; status: string; reasoning: string;
  created_at: string; metadata: any;
}
interface AgentEntry {
  id: string;
  type: "AUTO_SUSPEND" | "AUTO_BLACKLIST" | "BOT_DETECT" | "SCAN" | "ALERT" | "PATTERN" | "GUARDIAN";
  reasoning: string;
  target: string;
  severity: "critical" | "high" | "medium" | "info";
  status: "executing" | "done" | "failed";
  timestamp: Date;
  count?: number;
}
interface AttackPattern {
  id: string;
  type: "SUBNET_SWEEP" | "VELOCITY_SWARM" | "REFERRAL_RING" | "BOT_CLUSTER";
  description: string;
  severity: "critical" | "high";
  details: string;
  ips?: string[];
  userCount: number;
}

/* ─── helpers ────────────────────────────────────────────────────── */
const roleLabel = (p: ProfileRow) => {
  if (p.is_sub_agent)               return { label: "Sub-Agent",     cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" };
  if (p.is_agent && p.agent_approved) return { label: "Agent",       cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" };
  if (p.is_agent)                   return { label: "Pending Agent", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" };
  return                                   { label: "Customer",      cls: "bg-zinc-800 text-zinc-400 border-zinc-700" };
};
const exportCsv = (rows: Record<string, unknown>[], filename: string) => {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(","), ...rows.map(r => keys.map(k => JSON.stringify(r[k] ?? "")).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
};
const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-GH", { dateStyle: "short", timeStyle: "short" }) : "—";

const SCAN_MESSAGES = [
  "Analyzing behavioral entropy across session tokens…",
  "Cross-referencing IP geolocation with signup patterns…",
  "Evaluating referral graph for ring structures…",
  "Scanning velocity distribution against fraud baseline…",
  "Monitoring login frequency anomalies…",
  "Checking subnet correlation across active clusters…",
  "Validating order timing against bot detection model…",
  "Scanning for credential stuffing patterns…",
  "Analyzing device fingerprint consistency…",
  "Cross-checking email domains against threat intelligence…",
  "Inspecting session token reuse patterns…",
  "Profiling payment method diversification across cluster…",
];

/* ─── micro-components ───────────────────────────────────────────── */
const Pulse = ({ color = "bg-red-500" }: { color?: string }) => (
  <span className="relative flex h-2 w-2 shrink-0">
    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-60`} />
    <span className={`relative inline-flex rounded-full h-2 w-2 ${color}`} />
  </span>
);

const TH = ({ children }: { children: ReactNode }) => (
  <th className="text-left px-4 py-3 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 whitespace-nowrap font-mono">{children}</th>
);

const EmptyState = ({ icon: Icon = CheckCircle2, message }: { icon?: typeof Shield; message: string }) => (
  <div className="flex flex-col items-center justify-center py-10 gap-3 opacity-50">
    <Icon className="w-7 h-7 text-emerald-500" />
    <p className="text-xs text-zinc-400 text-center font-bold font-mono">{message}</p>
  </div>
);

const SectionCard = ({
  title, count, icon: Icon, color, children, onExport, defaultOpen = true, threat = false,
}: {
  title: string; count?: number; icon: typeof Shield; color: string;
  children: ReactNode; onExport?: () => void; defaultOpen?: boolean; threat?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-xl border overflow-hidden ${threat && (count ?? 0) > 0 ? "border-red-500/30 bg-red-950/10" : "border-zinc-800 bg-zinc-900/60"}`}>
      <div className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition-colors">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-3 flex-1 text-left">
          <div className={`p-1.5 rounded-lg border ${color.replace("text-", "bg-").replace("400", "500/10")} ${color.replace("text-", "border-").replace("400", "500/20")}`}>
            <Icon className={`w-3.5 h-3.5 ${color}`} />
          </div>
          <span className="font-black text-white text-xs uppercase tracking-[0.12em] font-mono">{title}</span>
          {count !== undefined && (
            <span className={`text-[10px] font-black px-2 py-0.5 rounded border tracking-widest font-mono ${
              count > 0 ? `${color.replace("text-", "bg-").replace("400", "500/15")} ${color} ${color.replace("text-", "border-").replace("400", "500/30")}` : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            }`}>{count}</span>
          )}
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {onExport && (
            <button type="button" onClick={onExport}
              className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-white transition-colors px-2 py-1 rounded hover:bg-zinc-800 font-mono">
              <FileDown className="w-3 h-3" /> CSV
            </button>
          )}
          <button type="button" onClick={() => setOpen(o => !o)} className="text-zinc-600">
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {open && <div className="border-t border-zinc-800 p-5">{children}</div>}
    </div>
  );
};

/* DEFCON badge */
const DEFCON_CFG = {
  1: { label: "DEFCON 1", sub: "ATTACK IN PROGRESS", text: "text-red-400", border: "border-red-500/40", bg: "bg-red-950/30", ring: "stroke-red-500", pulse: true },
  2: { label: "DEFCON 2", sub: "CRITICAL THREAT",    text: "text-orange-400", border: "border-orange-500/40", bg: "bg-orange-950/20", ring: "stroke-orange-500", pulse: true },
  3: { label: "DEFCON 3", sub: "ELEVATED",            text: "text-amber-400", border: "border-amber-500/40", bg: "bg-amber-950/10", ring: "stroke-amber-500", pulse: false },
  4: { label: "DEFCON 4", sub: "GUARDED",             text: "text-cyan-400",  border: "border-cyan-500/30",  bg: "bg-cyan-950/10",  ring: "stroke-cyan-500",  pulse: false },
  5: { label: "DEFCON 5", sub: "ALL CLEAR",           text: "text-emerald-400", border: "border-emerald-500/30", bg: "bg-emerald-950/10", ring: "stroke-emerald-500", pulse: false },
} as const;

/* Agent action type styling */
const AGENT_TYPE_CFG = {
  AUTO_SUSPEND:   { label: "SUSPEND",   color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/25",     icon: UserX },
  AUTO_BLACKLIST: { label: "BLACKLIST", color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/25",  icon: Ban },
  BOT_DETECT:     { label: "BOT",       color: "text-rose-400",    bg: "bg-rose-500/10",    border: "border-rose-500/25",    icon: Bot },
  SCAN:           { label: "SCAN",      color: "text-cyan-400",    bg: "bg-cyan-500/10",    border: "border-cyan-500/25",    icon: Radio },
  ALERT:          { label: "ALERT",     color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/25",   icon: TriangleAlert },
  PATTERN:        { label: "PATTERN",   color: "text-purple-400",  bg: "bg-purple-500/10",  border: "border-purple-500/25",  icon: Crosshair },
  GUARDIAN:       { label: "GUARDIAN",  color: "text-cyan-400",    bg: "bg-cyan-500/10",    border: "border-cyan-500/25",    icon: Shield },
};

/* ─── main component ─────────────────────────────────────────────── */
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

const AUTO_INTERVAL = 60; // seconds between auto-scans

const AdminSecurity = () => {
  const { toast }   = useToast();
  const { session } = useAuth();
  const [tab, setTab]     = useState<TabId>("overview");
  const [search, setSearch] = useState("");
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [purging, setPurging]     = useState(false);
  const [expandedIp, setExpandedIp] = useState<string | null>(null);

  /* core data */
  const [clusters,       setClusters]       = useState<IpCluster[]>([]);
  const [deviceClusters, setDeviceClusters] = useState<DeviceCluster[]>([]);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
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
  const [dbAgents, setDbAgents] = useState<any[]>([]);

  /* AI automation state */
  const [autoMode,        setAutoMode]        = useState(true);
  const [agentFeed,       setAgentFeed]       = useState<AgentEntry[]>([]);
  const [attackPatterns,  setAttackPatterns]  = useState<AttackPattern[]>([]);
  const [neutralized,     setNeutralized]     = useState(0);
  const [autoCount,       setAutoCount]       = useState(AUTO_INTERVAL);
  const [scanning,        setScanning]        = useState(false);
  const [threatsAnalyzed, setThreatsAnalyzed] = useState(0);

  /* prevent double-handling */
  const handledRef = useRef<{ ips: Set<string>; users: Set<string> }>({ ips: new Set(), users: new Set() });
  const autoModeRef = useRef(true);
  useEffect(() => { autoModeRef.current = autoMode; }, [autoMode]);

  /* blacklist form */
  const [blType, setBlType]   = useState("ip");
  const [blValue, setBlValue] = useState("");
  const [blReason, setBlReason] = useState("");

  /* admins */
  const [adminsList, setAdminsList]     = useState<SystemAdmin[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [addingAdmin, setAddingAdmin]   = useState(false);

  /* ── agent feed helpers ──────────────────────────────────────────── */
  const addEntry = useCallback((entry: Omit<AgentEntry, "id" | "timestamp">): string => {
    const id = Math.random().toString(36).slice(2);
    setAgentFeed(prev => [{ ...entry, id, timestamp: new Date() }, ...prev].slice(0, 120));
    return id;
  }, []);

  const updateEntry = useCallback((id: string, updates: Partial<AgentEntry>) => {
    setAgentFeed(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }, []);

  /* ── invoke edge fn ──────────────────────────────────────────────── */
  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("system-payout-v1", {
      body, headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (error) {
      try {
        const bodyText = await (error as any).context?.text();
        if (bodyText) { const p = JSON.parse(bodyText); if (p.error) throw new Error(p.error); }
      } catch (inner: any) {
        if (inner.message && inner.message !== "Unexpected end of JSON input") throw inner;
      }
      throw new Error(error.message || "Edge function failed");
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, [session]);

  /* ── auto-response engine ────────────────────────────────────────── */
  const runAutoResponse = useCallback(async (
    cls: IpCluster[], vel: VelocityAccount[],
  ) => {
    if (!autoModeRef.current) return;
    setScanning(true);

    /* 1. Critical IP clusters (≥5 accounts) → auto-suspend all + blacklist */
    for (const cluster of cls.filter(c => c.accounts.length >= 5)) {
      if (handledRef.current.ips.has(cluster.ip)) continue;
      handledRef.current.ips.add(cluster.ip);

      const eId = addEntry({
        type: "AUTO_SUSPEND", severity: "critical", status: "executing",
        target: cluster.ip,
        reasoning: `IP ${cluster.ip} — ${cluster.accounts.length} accounts breaches critical threshold`,
        count: cluster.accounts.length,
      });
      try {
        await invoke({ action: "bulk_suspend_users", user_ids: cluster.accounts.map(a => a.user_id), suspend: true });
        updateEntry(eId, { status: "done" });
        const blId = addEntry({
          type: "AUTO_BLACKLIST", severity: "critical", status: "executing",
          target: cluster.ip,
          reasoning: `Blacklisting ${cluster.ip} — ${cluster.accounts.length}-account cluster confirmed`,
        });
        await invoke({ action: "manage_blacklist", op: "add", type: "ip", value: cluster.ip, reason: `Auto: ${cluster.accounts.length}-account cluster` });
        updateEntry(blId, { status: "done" });
        setNeutralized(n => n + cluster.accounts.length + 1);
        toast({ title: `🔒 Auto-Neutralized: ${cluster.ip}`, description: `${cluster.accounts.length} accounts suspended + IP blacklisted` });
      } catch {
        updateEntry(eId, { status: "failed" });
      }
    }

    /* 2. Extreme velocity (≤1 min) → auto-suspend as confirmed bots */
    for (const acct of vel.filter(v => v.minutes_to_first_order <= 1)) {
      if (handledRef.current.users.has(acct.user_id)) continue;
      handledRef.current.users.add(acct.user_id);

      const eId = addEntry({
        type: "BOT_DETECT", severity: "critical", status: "executing",
        target: acct.user_id,
        reasoning: `${acct.email} — order ${acct.minutes_to_first_order}m post-signup, bot signature confirmed`,
      });
      try {
        await invoke({ action: "bulk_suspend_users", user_ids: [acct.user_id], suspend: true });
        updateEntry(eId, { status: "done" });
        setNeutralized(n => n + 1);
      } catch {
        updateEntry(eId, { status: "failed" });
      }
    }

    setScanning(false);
    setThreatsAnalyzed(n => n + cls.length + vel.length);
  }, [invoke, addEntry, updateEntry, toast]);

  /* ── attack pattern detector ─────────────────────────────────────── */
  const detectPatterns = useCallback((cls: IpCluster[], vel: VelocityAccount[], ref: ReferralGroup[]) => {
    const patterns: AttackPattern[] = [];

    /* subnet sweep: ≥2 clusters from same /24 */
    const subnetMap = new Map<string, IpCluster[]>();
    cls.forEach(c => {
      const sn = c.ip.split(".").slice(0, 3).join(".");
      const arr = subnetMap.get(sn) || []; arr.push(c); subnetMap.set(sn, arr);
    });
    subnetMap.forEach((list, sn) => {
      if (list.length < 2) return;
      const total = list.reduce((s, c) => s + c.accounts.length, 0);
      patterns.push({
        id: `sn_${sn}`, type: "SUBNET_SWEEP", userCount: total,
        severity: list.length >= 4 ? "critical" : "high",
        description: `Coordinated sweep from ${sn}.0/24`,
        details: `${list.length} distinct IPs · ${total} accounts · possible VPN rotation`,
        ips: list.map(c => c.ip),
      });
    });

    /* velocity swarm */
    if (vel.length >= 3) {
      patterns.push({
        id: "vel_swarm", type: "VELOCITY_SWARM", userCount: vel.length,
        severity: vel.length >= 6 ? "critical" : "high",
        description: `${vel.length} bot accounts detected in velocity window`,
        details: `Avg delay: ${Math.round(vel.reduce((s, v) => s + v.minutes_to_first_order, 0) / vel.length)}m — scripted ordering suspected`,
      });
    }

    /* referral ring */
    const bigRings = ref.filter(g => g.count >= 8);
    if (bigRings.length > 0) {
      patterns.push({
        id: "ref_ring", type: "REFERRAL_RING", userCount: bigRings.reduce((s, g) => s + g.count, 0),
        severity: bigRings.some(g => g.count >= 12) ? "critical" : "high",
        description: `Referral bonus farming — ${bigRings.length} ring${bigRings.length > 1 ? "s" : ""}`,
        details: `Largest ring: ${Math.max(...bigRings.map(g => g.count))} accounts · likely coordinated`,
      });
    }

    setAttackPatterns(patterns);

    if (patterns.some(p => p.severity === "critical")) {
      addEntry({
        type: "PATTERN", severity: "critical", status: "done",
        target: "system",
        reasoning: `CRITICAL: ${patterns.filter(p => p.severity === "critical").length} coordinated attack pattern(s) identified`,
        count: patterns.length,
      });
    }
  }, [addEntry]);

  /* ── fetch ───────────────────────────────────────────────────────── */
  const fetchData = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const d14 = new Date(Date.now() - 14 * 864e5).toISOString();

    const [profilesRes, recentRes, velocityRes, ordersRes, signupsRes, actionRes, blacklistRes, settingsRes, agentsRes] =
      await Promise.all([
        (supabase as any).from("profiles")
          .select("user_id,full_name,email,last_ip,last_seen_at,last_location,login_count,is_agent,agent_approved,is_sub_agent,referred_by,created_at,is_suspended,device_id")
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
        supabase.from("ai_agent_registry").select("*").order("name"),
      ]);

    const profiles = (profilesRes.data || []) as unknown as ProfileRow[];

    const ipMap = new Map<string, ProfileRow[]>();
    profiles.forEach(p => { if (p.last_ip) { const a = ipMap.get(p.last_ip) || []; a.push(p); ipMap.set(p.last_ip, a); } });
    const shared: IpCluster[] = [];
    ipMap.forEach((accs, ip) => { if (accs.length >= 2) shared.push({ ip, location: accs.find(a => a.last_location)?.last_location ?? null, accounts: accs }); });
    shared.sort((a, b) => b.accounts.length - a.accounts.length);

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

    const dayMap = new Map<string, number>();
    for (let i = 13; i >= 0; i--) dayMap.set(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10), 0);
    ((signupsRes.data || []) as { created_at: string }[]).forEach(r => { const d = r.created_at.slice(0, 10); if (dayMap.has(d)) dayMap.set(d, (dayMap.get(d) || 0) + 1); });

    const vel = velocityRes.error ? [] : (velocityRes.data || []) as unknown as VelocityAccount[];

    const deviceMap = new Map<string, ProfileRow[]>();
    profiles.forEach(p => { if (p.device_id) { const a = deviceMap.get(p.device_id) || []; a.push(p); deviceMap.set(p.device_id, a); } });
    const devClusters: DeviceCluster[] = [];
    deviceMap.forEach((accs, devId) => {
      const isBlocked = accs.some(a => a.is_suspended);
      devClusters.push({ device_id: devId, accounts: accs, is_blocked: isBlocked });
    });
    devClusters.sort((a, b) => b.accounts.length - a.accounts.length);

    setClusters(shared);
    setDeviceClusters(devClusters);
    setRecentLogins((recentRes.data || []) as unknown as RecentLogin[]);
    setVelocityAccts(vel);
    setReferralGroups(groups);
    setHighLogins(profiles.filter(p => (p.login_count ?? 0) >= 50).sort((a, b) => (b.login_count ?? 0) - (a.login_count ?? 0)));
    setFailedUsers(failed);
    setSignupTrend(Array.from(dayMap.entries()).map(([date, count]) => ({ date, count })));
    setActionLog((actionRes.data || []) as unknown as AdminAction[]);
    setBlacklist(blacklistRes.data || []);
    setSysSettings(settingsRes.data);
    setSuspendedCount(profiles.filter(p => p.is_suspended).length);
    setDbAgents(agentsRes.data || []);

    const guardianData = await (supabase as any).from("sentinel_actions").select("*").order("created_at", { ascending: false }).limit(30);
    setGuardianLogs((guardianData.data || []) as unknown as GuardianLog[]);

    setLoading(false); setRefreshing(false);

    /* run AI after data loads */
    detectPatterns(shared, vel, groups);
    await runAutoResponse(shared, vel);
  }, [detectPatterns, runAutoResponse]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  /* ── periodic scan log messages (keep feed alive) ─────────────────── */
  useEffect(() => {
    if (!autoMode) return;
    let idx = Math.floor(Math.random() * SCAN_MESSAGES.length);
    const iv = setInterval(() => {
      addEntry({ type: "SCAN", severity: "info", status: "done", target: "system", reasoning: SCAN_MESSAGES[idx % SCAN_MESSAGES.length] });
      idx++;
    }, 28000);
    return () => clearInterval(iv);
  }, [autoMode, addEntry]);

  /* ── auto-refresh countdown ───────────────────────────────────────── */
  useEffect(() => {
    setAutoCount(AUTO_INTERVAL);
    const iv = setInterval(() => {
      setAutoCount(c => {
        if (c <= 1) { void fetchData(true); return AUTO_INTERVAL; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [fetchData]);

  /* ── multi-channel realtime ───────────────────────────────────────── */
  useEffect(() => {
    const profileCh = supabase.channel("admin-sec-profiles")
      .on("postgres_changes" as any, { event: "UPDATE", schema: "public", table: "profiles" }, (payload: any) => {
        const p = payload.new as RecentLogin;
        if (!p.last_seen_at) return;
        setRecentLogins(prev => [p, ...prev.filter(l => l.user_id !== p.user_id)].slice(0, 30));
        setLiveAlerts(prev => [{
          id: Math.random().toString(36).slice(2),
          message: `${p.full_name || p.email} logged in${p.last_ip ? ` · ${p.last_ip}` : ""}${p.last_location ? ` · ${p.last_location}` : ""}`,
          time: new Date(),
        }, ...prev].slice(0, 20));
      }).subscribe();

    const sentinelCh = supabase.channel("admin-sec-sentinel")
      .on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "sentinel_actions" }, (payload: any) => {
        const action = payload.new as GuardianLog;
        setGuardianLogs(prev => [action, ...prev].slice(0, 30));
        addEntry({
          type: "GUARDIAN", severity: "high", status: "done",
          target: action.metadata?.target || "system",
          reasoning: `Guardian: ${action.action_type.replace(/_/g, " ")} — ${action.reasoning}`,
        });
      }).subscribe();

    const blCh = supabase.channel("admin-sec-blacklist")
      .on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "security_blacklist" }, (payload: any) => {
        const e = payload.new;
        setLiveAlerts(prev => [{
          id: Math.random().toString(36).slice(2),
          message: `BLOCKED: ${e.value} (${e.type}) — ${e.reason}`,
          time: new Date(),
        }, ...prev].slice(0, 20));
        setBlacklist(prev => [e, ...prev]);
      }).subscribe();

    return () => {
      safeRemoveChannel(profileCh);
      safeRemoveChannel(sentinelCh);
      safeRemoveChannel(blCh);
    };
  }, [addEntry]);

  /* ── actions ─────────────────────────────────────────────────────── */
  const fetchAdmins = useCallback(async () => {
    setLoadingAdmins(true);
    try {
      const res = await invoke({ action: "get_admins" });
      setAdminsList(res.admins || []);
    } catch (e: any) {
      toast({ title: "Fetch Failed", description: e.message, variant: "destructive" });
    } finally { setLoadingAdmins(false); }
  }, [invoke, toast]);

  useEffect(() => { if (tab === "admins") void fetchAdmins(); }, [tab, fetchAdmins]);

  const handleAddAdmin = async () => {
    if (!newAdminEmail.trim()) return;
    setAddingAdmin(true);
    try {
      await invoke({ action: "grant_admin_role", email: newAdminEmail.trim() });
      toast({ title: "Success", description: "Administrator granted!" });
      setNewAdminEmail(""); void fetchAdmins();
    } catch (e: any) {
      toast({ title: "Grant Failed", description: e.message, variant: "destructive" });
    } finally { setAddingAdmin(false); }
  };

  const handleRevokeAdmin = async (uid: string, name: string) => {
    if (!confirm(`REVOKE admin access for ${name}?`)) return;
    try {
      await invoke({ action: "revoke_admin_role", user_id: uid });
      toast({ title: "Access Revoked" }); void fetchAdmins();
    } catch (e: any) { toast({ title: "Revoke Failed", description: e.message, variant: "destructive" }); }
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

  /* ── filtered ────────────────────────────────────────────────────── */
  const q = search.toLowerCase();
  const fClusters  = useMemo(() => clusters.filter(c => !q || c.ip.includes(q) || c.accounts.some(a => a.full_name?.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q))), [clusters, q]);
  const fDeviceClusters = useMemo(() => deviceClusters.filter(c => !q || c.device_id.toLowerCase().includes(q) || c.accounts.some(a => a.full_name?.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q))), [deviceClusters, q]);
  const fLogins    = useMemo(() => recentLogins.filter(r => !q || r.full_name?.toLowerCase().includes(q) || r.email?.toLowerCase().includes(q) || r.last_ip?.includes(q)), [recentLogins, q]);
  const fHighLogin = useMemo(() => highLogins.filter(p => !q || p.full_name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)), [highLogins, q]);
  const fFailed    = useMemo(() => failedUsers.filter(u => !q || u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)), [failedUsers, q]);
  const fVelocity  = useMemo(() => velocityAccts.filter(v => !q || v.full_name?.toLowerCase().includes(q) || v.email?.toLowerCase().includes(q)), [velocityAccts, q]);
  const fReferrals = useMemo(() => referralGroups.filter(g => !q || g.referrer_name?.toLowerCase().includes(q) || g.referrer_email?.toLowerCase().includes(q)), [referralGroups, q]);

  /* ── derived ─────────────────────────────────────────────────────── */
  const healthScore = Math.max(0, 100 - clusters.length * 5 - referralGroups.length * 8 - failedUsers.length * 2 - (velocityAccts.length > 5 ? 10 : 0));
  const defcon = (healthScore >= 90 ? 5 : healthScore >= 70 ? 4 : healthScore >= 50 ? 3 : healthScore >= 30 ? 2 : 1) as 1 | 2 | 3 | 4 | 5;
  const dc = DEFCON_CFG[defcon];
  const totalThreats = clusters.length + referralGroups.length + failedUsers.length + velocityAccts.length;
  const maxSignup = Math.max(...signupTrend.map(d => d.count), 1);
  const STATS = [
    { label: "Shared IPs",     value: clusters.length,       icon: Globe,      danger: clusters.length > 0,       color: "text-red-400",    bg: "bg-red-500/10 border-red-500/25"      },
    { label: "Velocity Flags", value: velocityAccts.length,  icon: Zap,        danger: velocityAccts.length > 0,  color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/25"},
    { label: "Referral Abuse", value: referralGroups.length, icon: Gift,       danger: referralGroups.length > 0, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/25"},
    { label: "High Logins",    value: highLogins.length,     icon: Hash,       danger: false,                     color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/25"  },
    { label: "High Fail Rate", value: failedUsers.length,    icon: TrendingUp, danger: failedUsers.length > 0,    color: "text-red-400",    bg: "bg-red-500/10 border-red-500/25"      },
    { label: "Suspended",      value: suspendedCount,        icon: UserX,      danger: suspendedCount > 0,        color: "text-rose-400",   bg: "bg-rose-500/10 border-rose-500/25"    },
  ];

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="relative w-12 h-12">
        <Shield className="w-12 h-12 text-red-500/20 absolute inset-0" />
        <Loader2 className="w-12 h-12 text-red-500 animate-spin absolute inset-0" />
      </div>
      <p className="text-zinc-500 text-[11px] font-black uppercase tracking-[0.3em] font-mono">Initializing Security Matrix…</p>
    </div>
  );

  /* ══ TAB RENDERS ══════════════════════════════════════════════════ */

  const renderOverview = () => (
    <div className="space-y-4">

      {/* DEFCON + auto-mode bar */}
      <div className={`flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-4 rounded-xl border ${dc.border} ${dc.bg}`}>
        {/* DEFCON block */}
        <div className="flex items-center gap-4 flex-1">
          <div className={`flex flex-col items-center justify-center w-20 h-16 rounded-lg border ${dc.border} bg-black/30`}>
            <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500 font-mono">DEFCON</p>
            <p className={`text-4xl font-black ${dc.text} ${dc.pulse ? "animate-pulse" : ""} leading-none font-mono`}>{defcon}</p>
          </div>
          <div>
            <p className={`text-lg font-black ${dc.text} font-mono tracking-wider`}>{dc.label}</p>
            <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">{dc.sub}</p>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-[9px] text-zinc-600 font-mono">Health: {healthScore}/100</span>
              <span className={`text-[9px] font-black font-mono ${scanning ? "text-cyan-400 animate-pulse" : "text-zinc-600"}`}>
                {scanning ? "▶ SCANNING…" : `Next scan: ${autoCount}s`}
              </span>
            </div>
          </div>
        </div>

        {/* counters */}
        <div className="flex items-center gap-4 sm:border-l border-zinc-800 sm:pl-4">
          <div className="text-center">
            <p className="text-2xl font-black text-emerald-400 font-mono tabular-nums">{neutralized}</p>
            <p className="text-[9px] text-zinc-600 font-mono uppercase tracking-widest">Neutralized</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-black text-cyan-400 font-mono tabular-nums">{threatsAnalyzed}</p>
            <p className="text-[9px] text-zinc-600 font-mono uppercase tracking-widest">Analyzed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-black text-purple-400 font-mono tabular-nums">{attackPatterns.length}</p>
            <p className="text-[9px] text-zinc-600 font-mono uppercase tracking-widest">Patterns</p>
          </div>
        </div>

        {/* auto-mode toggle */}
        <div className="flex flex-col items-end gap-1.5 sm:border-l border-zinc-800 sm:pl-4">
          <button
            type="button"
            onClick={() => {
              if (!autoMode && !confirm("Enable AUTO-RESPONSE? The AI will automatically suspend accounts and blacklist IPs when threats are confirmed.")) return;
              setAutoMode(m => !m);
            }}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border font-mono text-xs font-black uppercase tracking-widest transition-all ${
              autoMode
                ? "bg-red-500/15 border-red-500/40 text-red-400"
                : "bg-zinc-900 border-zinc-700 text-zinc-500 hover:border-zinc-600"
            }`}
          >
            {autoMode ? <><Pulse color="bg-red-500" /> AUTO-RESPONSE ON</> : <><Play className="w-3 h-3" /> AUTO-RESPONSE OFF</>}
          </button>
          <p className="text-[9px] text-zinc-600 font-mono">{autoMode ? "AI will act automatically on confirmed threats" : "Manual review required"}</p>
        </div>
      </div>

      {/* Attack patterns */}
      {attackPatterns.length > 0 && (
        <div className="space-y-2">
          {attackPatterns.map(p => {
            const PTYPE = { SUBNET_SWEEP: "SUBNET SWEEP", VELOCITY_SWARM: "VELOCITY SWARM", REFERRAL_RING: "REFERRAL RING", BOT_CLUSTER: "BOT CLUSTER" };
            return (
              <div key={p.id} className={`flex items-start gap-3 p-3.5 rounded-xl border ${p.severity === "critical" ? "border-red-500/40 bg-red-950/20" : "border-orange-500/30 bg-orange-950/10"}`}>
                <Crosshair className={`w-4 h-4 mt-0.5 shrink-0 ${p.severity === "critical" ? "text-red-400" : "text-orange-400"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded border font-mono tracking-widest ${p.severity === "critical" ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-orange-500/10 text-orange-400 border-orange-500/30"}`}>{PTYPE[p.type]}</span>
                    <span className="text-xs font-black text-white">{p.description}</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded font-mono ${p.severity === "critical" ? "text-red-400" : "text-orange-400"}`}>{p.userCount} accounts</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 font-mono mt-0.5">{p.details}</p>
                  {p.ips && <p className="text-[10px] text-zinc-600 font-mono mt-0.5">{p.ips.join(" · ")}</p>}
                </div>
                {p.severity === "critical" && <Pulse />}
              </div>
            );
          })}
        </div>
      )}

      {/* Health + live feed + agent feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Health score */}
        <div className={`lg:col-span-1 rounded-xl border border-zinc-800 p-5 relative overflow-hidden bg-zinc-900/60`}>
          <div className="absolute top-0 right-0 w-24 h-24 border-t-2 border-r-2 border-zinc-700/30" />
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-500 mb-3 font-mono">// Health Matrix</p>
          <div className="flex items-center gap-4 mb-4">
            <svg className="w-16 h-16 -rotate-90 shrink-0" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="5" className="text-zinc-800" />
              <circle cx="32" cy="32" r="26" fill="none" strokeWidth="5" strokeLinecap="round"
                className={dc.ring} strokeDasharray={`${2 * Math.PI * 26}`}
                strokeDashoffset={`${2 * Math.PI * 26 * (1 - healthScore / 100)}`}
                style={{ transition: "stroke-dashoffset 1s ease" }} />
            </svg>
            <div>
              <p className={`text-5xl font-black ${dc.text} tabular-nums font-mono leading-none`}>{healthScore}</p>
              <p className="text-zinc-500 text-xs font-mono">/ 100</p>
            </div>
          </div>
          <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden mb-3">
            <div className={`h-full rounded-full transition-all duration-700 ${defcon <= 2 ? "bg-red-500" : defcon === 3 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${healthScore}%` }} />
          </div>
          <div className="space-y-1.5">
            {clusters.length > 0 && <div className="flex items-center gap-2 text-[11px] text-red-400 font-mono"><Pulse />{clusters.length} shared IP cluster{clusters.length !== 1 ? "s" : ""}</div>}
            {referralGroups.length > 0 && <div className="flex items-center gap-2 text-[11px] text-purple-400 font-mono"><Pulse color="bg-purple-500" />{referralGroups.length} referral abuse pattern{referralGroups.length !== 1 ? "s" : ""}</div>}
            {failedUsers.length > 0 && <div className="flex items-center gap-2 text-[11px] text-orange-400 font-mono"><Pulse color="bg-orange-500" />{failedUsers.length} high failure account{failedUsers.length !== 1 ? "s" : ""}</div>}
            {totalThreats === 0 && <div className="flex items-center gap-2 text-[11px] text-emerald-400 font-mono"><CheckCircle2 className="w-3 h-3" />No active threats</div>}
          </div>
        </div>

        {/* Live event terminal */}
        <div className="rounded-xl border border-cyan-500/20 bg-zinc-950 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-cyan-500/20 bg-cyan-500/5">
            <div className="flex items-center gap-2"><Pulse color="bg-cyan-500" /><span className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-400 font-mono">Live Events</span></div>
            <button type="button" onClick={() => setLiveAlerts([])} className="text-[9px] text-zinc-600 hover:text-white font-black font-mono tracking-widest">CLR</button>
          </div>
          <div className="flex-1 p-3 space-y-1.5 overflow-y-auto max-h-44 scrollbar-none">
            {liveAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 py-6">
                <Globe className="w-5 h-5 text-cyan-500/30" />
                <p className="text-[9px] text-zinc-600 font-mono uppercase tracking-widest">Awaiting events…</p>
              </div>
            ) : liveAlerts.map(a => (
              <div key={a.id} className="border-l border-cyan-500/30 pl-2 py-0.5">
                <span className="text-[8px] text-cyan-500/40 font-mono">{a.time.toLocaleTimeString()}</span>
                <p className="text-[10px] text-zinc-400 font-mono leading-tight">{a.message}</p>
              </div>
            ))}
          </div>
        </div>

        {/* AI agent feed */}
        <div className="rounded-xl border border-purple-500/20 bg-zinc-950 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-purple-500/20 bg-purple-500/5">
            <div className="flex items-center gap-2">
              {autoMode ? <Pulse color="bg-purple-500" /> : <span className="w-2 h-2 rounded-full bg-zinc-700 shrink-0" />}
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-purple-400 font-mono">AI Agent</span>
            </div>
            <button type="button" onClick={() => setAgentFeed([])} className="text-[9px] text-zinc-600 hover:text-white font-black font-mono tracking-widest">CLR</button>
          </div>
          <div className="flex-1 p-3 space-y-1.5 overflow-y-auto max-h-44 scrollbar-none">
            {agentFeed.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 py-6">
                <Bot className="w-5 h-5 text-purple-500/30" />
                <p className="text-[9px] text-zinc-600 font-mono uppercase tracking-widest">{autoMode ? "Agent initializing…" : "Agent paused"}</p>
              </div>
            ) : agentFeed.slice(0, 15).map(a => {
              const cfg = AGENT_TYPE_CFG[a.type];
              return (
                <div key={a.id} className={`border-l-2 pl-2 py-0.5 ${a.severity === "critical" ? "border-red-500/50" : a.severity === "high" ? "border-orange-500/40" : a.severity === "medium" ? "border-amber-500/30" : "border-cyan-500/20"}`}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-[8px] font-black px-1.5 py-0 rounded font-mono ${cfg.bg} ${cfg.color} ${cfg.border} border`}>{cfg.label}</span>
                    <span className="text-[8px] text-zinc-600 font-mono">{a.timestamp.toLocaleTimeString()}</span>
                    {a.status === "executing" && <span className="text-[8px] text-amber-400 font-mono animate-pulse">EXEC…</span>}
                    {a.status === "done" && <span className="text-[8px] text-emerald-400 font-mono">✓</span>}
                    {a.status === "failed" && <span className="text-[8px] text-red-400 font-mono">✗</span>}
                  </div>
                  <p className="text-[10px] text-zinc-400 font-mono leading-tight">{a.reasoning}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {STATS.map(({ label, value, icon: Icon, danger, color, bg }) => (
          <div key={label} className={`rounded-xl border p-4 relative overflow-hidden ${danger && value > 0 ? bg : "bg-zinc-900 border-zinc-800"}`}>
            {danger && value > 0 && <div className="absolute top-2 right-2"><Pulse color={color.replace("text-", "bg-")} /></div>}
            <Icon className={`w-4 h-4 mb-3 ${danger && value > 0 ? color : "text-zinc-600"}`} />
            <p className={`text-3xl font-black tabular-nums leading-none mb-1 font-mono ${danger && value > 0 ? color : "text-white"}`}>{value}</p>
            <p className="text-[9px] text-zinc-500 font-black uppercase tracking-[0.15em] leading-tight font-mono">{label}</p>
          </div>
        ))}
      </div>

      {/* Signup trend */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <BarChart2 className="w-4 h-4 text-cyan-500" />
            <span className="font-black text-white text-xs uppercase tracking-[0.12em] font-mono">Signup Trend</span>
            <span className="text-[9px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded font-black font-mono tracking-widest">14D</span>
          </div>
          <div className="text-right">
            <span className="text-2xl font-black text-cyan-400 tabular-nums font-mono">{signupTrend.reduce((s, d) => s + d.count, 0)}</span>
            <p className="text-[9px] text-zinc-500 font-mono">new accounts</p>
          </div>
        </div>
        <div className="flex items-end gap-0.5 h-14">
          {signupTrend.map(day => (
            <div key={day.date} className="flex flex-col items-center flex-1 group cursor-default">
              <span className="text-[8px] text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity font-mono">{day.count}</span>
              <div className="w-full bg-cyan-500/20 hover:bg-cyan-500 rounded-sm transition-all" style={{ height: `${Math.max(2, (day.count / maxSignup) * 48)}px` }} title={`${day.date}: ${day.count}`} />
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-zinc-600 font-mono">{signupTrend[0]?.date.slice(5)}</span>
          <span className="text-[9px] text-zinc-600 font-mono">{signupTrend[signupTrend.length - 1]?.date.slice(5)}</span>
        </div>
      </div>
    </div>
  );

  const renderThreats = () => (
    <div className="space-y-4">
      {totalThreats > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-red-500/30 bg-red-950/20">
          <Pulse />
          <p className="text-xs font-black text-red-400 uppercase tracking-widest font-mono">
            {totalThreats} active threat signal{totalThreats !== 1 ? "s" : ""} — AI response {autoMode ? "armed" : "in manual mode"}
          </p>
        </div>
      )}

      <SectionCard title="Shared IP Groups" count={fClusters.length} icon={Globe} color="text-red-400" threat
        onExport={() => exportCsv(clusters.flatMap(c => c.accounts.map(a => ({ ip: c.ip, location: c.location, ...a } as Record<string, unknown>))), "shared_ips.csv")}
      >
        {fClusters.length === 0 ? <EmptyState icon={Globe} message="No shared IP addresses detected." /> : (
          <div className="space-y-2">
            {fClusters.map(cluster => {
              const exp = expandedIp === cluster.ip;
              const sev = cluster.accounts.length >= 5 ? "critical" : cluster.accounts.length >= 3 ? "high" : "medium";
              const autoHandled = handledRef.current.ips.has(cluster.ip);
              return (
                <div key={cluster.ip} className={`rounded-xl border overflow-hidden ${sev === "critical" ? "border-red-500/40 bg-red-950/15" : sev === "high" ? "border-orange-500/30 bg-orange-950/10" : "border-amber-500/20 bg-amber-950/5"}`}>
                  <div className="flex items-center justify-between px-4 py-3">
                    <button type="button" onClick={() => setExpandedIp(exp ? null : cluster.ip)} className="flex-1 flex items-center gap-3 text-left flex-wrap">
                      {exp ? <ChevronUp className="w-3 h-3 text-red-400 shrink-0" /> : <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />}
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border font-mono tracking-wider ${sev === "critical" ? "text-red-400 bg-red-500/10 border-red-500/30" : sev === "high" ? "text-orange-400 bg-orange-500/10 border-orange-500/30" : "text-amber-400 bg-amber-500/10 border-amber-500/30"}`}>{sev}</span>
                      <span className="font-mono text-sm font-bold text-white">{cluster.ip}</span>
                      {cluster.location && <span className="flex items-center gap-1 text-[10px] text-emerald-500/70 font-mono"><MapPin className="w-3 h-3" />{cluster.location}</span>}
                      <span className="text-[9px] font-black bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded font-mono">{cluster.accounts.length} accounts</span>
                      {autoHandled && <span className="text-[9px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono">AI NEUTRALIZED</span>}
                    </button>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <button type="button" onClick={() => copyText(cluster.ip, "IP copied")} className="p-1.5 rounded text-zinc-600 hover:text-white hover:bg-zinc-800 transition-all"><Copy className="w-3 h-3" /></button>
                      <button type="button" onClick={() => handleBulkSuspend(cluster.accounts.map(a => a.user_id), true)}
                        className="text-[9px] font-black uppercase bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded transition-all tracking-widest font-mono">
                        SUSPEND ALL
                      </button>
                    </div>
                  </div>
                  {exp && (
                    <div className="border-t border-zinc-800/60 divide-y divide-zinc-800/40">
                      {cluster.accounts.map(acc => {
                        const role = roleLabel(acc);
                        return (
                          <div key={acc.user_id} className="flex items-center justify-between px-4 py-2.5 bg-zinc-950/50">
                            <div className="min-w-0">
                              <p className="text-sm font-black text-white truncate">{acc.full_name || "—"}</p>
                              <p className="text-[11px] text-zinc-500 font-mono truncate">{acc.email}</p>
                              {acc.last_seen_at && <p className="text-[10px] text-zinc-600 font-mono">{fmt(acc.last_seen_at)}</p>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 ml-3">
                              {acc.is_suspended && <span className="text-[9px] font-black px-2 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/20 font-mono">SUSPENDED</span>}
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${role.cls}`}>{role.label}</span>
                              <span className="text-[10px] text-zinc-500 font-mono">{acc.login_count ?? 0}×</span>
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

      <SectionCard title="Account Velocity" count={fVelocity.length} icon={Zap} color="text-orange-400" threat
        onExport={() => exportCsv(fVelocity as unknown as Record<string, unknown>[], "velocity.csv")}
      >
        {fVelocity.length === 0 ? <EmptyState icon={Zap} message="No accounts placed orders within 5 minutes of signup." /> : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-zinc-900 border-b border-zinc-800"><TH>User</TH><TH>Joined</TH><TH>First Order</TH><TH>Delay</TH><TH>Status</TH></tr></thead>
              <tbody>
                {fVelocity.map(v => {
                  const isBot = v.minutes_to_first_order <= 1;
                  const autoHandled = handledRef.current.users.has(v.user_id);
                  return (
                    <tr key={v.user_id} className={`border-b border-zinc-800/60 hover:bg-zinc-900/60 transition-colors ${isBot ? "bg-red-950/10" : ""}`}>
                      <td className="px-4 py-3"><p className="font-black text-white">{v.full_name || "—"}</p><p className="text-[11px] text-zinc-500 font-mono">{v.email}</p></td>
                      <td className="px-4 py-3 text-xs text-zinc-500 font-mono">{fmt(v.joined_at)}</td>
                      <td className="px-4 py-3 text-xs text-zinc-500 font-mono">{fmt(v.first_order_at)}</td>
                      <td className="px-4 py-3"><span className={`text-sm font-black font-mono ${isBot ? "text-red-400 animate-pulse" : "text-orange-400"}`}>{v.minutes_to_first_order}m</span></td>
                      <td className="px-4 py-3">
                        {autoHandled ? <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded font-mono">AI SUSPENDED</span>
                          : isBot ? <span className="text-[9px] font-black text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded font-mono animate-pulse">BOT CONFIRMED</span>
                          : <span className="text-[9px] font-black text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded font-mono">SUSPICIOUS</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Referral Abuse" count={fReferrals.length} icon={Gift} color="text-purple-400" threat
        onExport={() => exportCsv(referralGroups.flatMap(g => g.members.map(m => ({ referrer: g.referrer_email, ...m } as Record<string, unknown>))), "referral_abuse.csv")}
      >
        {fReferrals.length === 0 ? <EmptyState icon={Gift} message="No referral codes with 5+ signups." /> : (
          <div className="space-y-2">
            {fReferrals.map(g => (
              <div key={g.referrer_id} className="rounded-lg border border-purple-500/20 bg-purple-950/10 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div><p className="font-black text-white text-sm">{g.referrer_name}</p><p className="text-[11px] text-zinc-500 font-mono">{g.referrer_email}</p></div>
                  <span className="text-[9px] font-black bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded font-mono">{g.count} referrals</span>
                </div>
                <div className="space-y-1">
                  {g.members.map(m => (
                    <div key={m.user_id} className="flex items-center gap-2 text-[11px] bg-zinc-950 border border-zinc-800 px-3 py-1.5 rounded font-mono">
                      <span className="text-white font-bold">{m.full_name || "—"}</span>
                      <span className="text-zinc-700">·</span>
                      <span className="text-zinc-500">{m.email}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="High Failure Rate" count={fFailed.length} icon={TrendingUp} color="text-red-400" threat
        onExport={() => exportCsv(fFailed as unknown as Record<string, unknown>[], "failed_rate.csv")}
      >
        {fFailed.length === 0 ? <EmptyState icon={TrendingUp} message="No users with ≥50% failure rate (min 5 orders)." /> : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-zinc-900 border-b border-zinc-800"><TH>User</TH><TH>Orders</TH><TH>Failed</TH><TH>Rate</TH></tr></thead>
              <tbody>
                {fFailed.map(u => (
                  <tr key={u.user_id} className="border-b border-zinc-800/60 hover:bg-zinc-900/60 transition-colors">
                    <td className="px-4 py-3"><p className="font-black text-white">{u.full_name || "—"}</p><p className="text-[11px] text-zinc-500 font-mono">{u.email}</p></td>
                    <td className="px-4 py-3 text-xs text-zinc-400 font-black font-mono">{u.total}</td>
                    <td className="px-4 py-3 text-xs text-red-400 font-black font-mono">{u.failed}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-red-500 rounded-full" style={{ width: `${u.rate}%` }} /></div>
                        <span className="text-xs font-black text-red-400 font-mono">{u.rate}%</span>
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
      <SectionCard title="Recent Logins" count={fLogins.length} icon={LogIn} color="text-cyan-400"
        onExport={() => exportCsv(fLogins.map(l => ({ ...l } as Record<string, unknown>)), "recent_logins.csv")}
      >
        <div className="overflow-x-auto rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-zinc-900 border-b border-zinc-800"><TH>User</TH><TH>IP</TH><TH>Location</TH><TH>Last Seen</TH><TH>Logins</TH></tr></thead>
            <tbody>
              {fLogins.map(l => (
                <tr key={l.user_id} className="border-b border-zinc-800/60 hover:bg-zinc-900/60 transition-colors">
                  <td className="px-4 py-3"><p className="font-black text-white">{l.full_name || "—"}</p><p className="text-[11px] text-zinc-500 font-mono">{l.email}</p></td>
                  <td className="px-4 py-3">
                    {l.last_ip ? <div className="flex items-center gap-1.5"><span className="font-mono text-xs text-cyan-400/80 font-bold">{l.last_ip}</span><button type="button" onClick={() => copyText(l.last_ip!, "IP copied")} className="text-zinc-600 hover:text-white"><Copy className="w-3 h-3" /></button></div> : <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs font-bold text-emerald-500/70">{l.last_location || <span className="text-zinc-700">—</span>}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500 font-mono">{fmt(l.last_seen_at)}</td>
                  <td className="px-4 py-3"><span className="text-xs font-black text-zinc-400 font-mono">{l.login_count ?? 0}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="High Login Frequency" count={fHighLogin.length} icon={Hash} color="text-amber-400"
        onExport={() => exportCsv(fHighLogin.map(p => ({ ...p } as unknown as Record<string, unknown>)), "high_logins.csv")}
      >
        {fHighLogin.length === 0 ? <EmptyState icon={Hash} message="No accounts with 50+ logins." /> : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-zinc-900 border-b border-zinc-800"><TH>User</TH><TH>Logins</TH><TH>IP</TH><TH>Location</TH><TH>Role</TH></tr></thead>
              <tbody>
                {fHighLogin.map(p => {
                  const role = roleLabel(p);
                  return (
                    <tr key={p.user_id} className="border-b border-zinc-800/60 hover:bg-zinc-900/60 transition-colors">
                      <td className="px-4 py-3"><p className="font-black text-white">{p.full_name || "—"}</p><p className="text-[11px] text-zinc-500 font-mono">{p.email}</p></td>
                      <td className="px-4 py-3"><span className="text-xl font-black text-amber-400 font-mono">{p.login_count}</span></td>
                      <td className="px-4 py-3"><span className="font-mono text-xs text-cyan-400/60">{p.last_ip || "—"}</span></td>
                      <td className="px-4 py-3 text-xs font-bold text-emerald-500/60">{p.last_location || "—"}</td>
                      <td className="px-4 py-3"><span className={`text-[9px] font-black px-2 py-0.5 rounded border ${role.cls}`}>{role.label}</span></td>
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
      {/* Auto-response rules */}
      <div className="rounded-xl border border-purple-500/20 bg-purple-950/10 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Bot className="w-4 h-4 text-purple-400" />
          <span className="font-black text-white text-xs uppercase tracking-[0.12em] font-mono">Active Auto-Response Rules</span>
          {autoMode ? <Pulse color="bg-purple-500" /> : <span className="text-[9px] text-zinc-500 font-mono">(paused)</span>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { rule: "IP Cluster ≥5 accounts", action: "Auto-suspend all + blacklist IP", sev: "CRITICAL", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
            { rule: "Velocity ≤1 minute",      action: "Auto-suspend as confirmed bot",  sev: "CRITICAL", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
            { rule: "Subnet sweep detected",   action: "Pattern alert + flag cluster",   sev: "HIGH",     color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
            { rule: "Velocity swarm ≥3 accts", action: "Pattern alert + escalate",       sev: "HIGH",     color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
            { rule: "Referral ring ≥8 accts",  action: "Pattern alert + log",            sev: "MEDIUM",   color: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/20"  },
            { rule: "Realtime blacklist add",   action: "Live feed update + alert",       sev: "INFO",     color: "text-cyan-400",   bg: "bg-cyan-500/10",   border: "border-cyan-500/20"   },
          ].map(r => (
            <div key={r.rule} className={`flex items-start gap-3 p-3 rounded-lg border ${r.border} ${r.bg}`}>
              <div className={`w-1 h-full min-h-8 rounded-full ${r.bg.replace("/10", "")} shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-[9px] font-black px-1.5 py-0 rounded font-mono border ${r.border} ${r.color} ${r.bg}`}>{r.sev}</span>
                  <span className="text-[10px] font-black text-white font-mono truncate">{r.rule}</span>
                </div>
                <p className="text-[10px] text-zinc-500 font-mono">{r.action}</p>
              </div>
              <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${autoMode ? "text-emerald-400" : "text-zinc-700"}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Platform controls */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="flex items-center gap-2 mb-5">
          <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20"><Lock className="w-3.5 h-3.5 text-amber-500" /></div>
          <span className="font-black text-white text-xs uppercase tracking-[0.12em] font-mono">Platform Controls</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { key: "registration_enabled", label: "User Registration", desc: "Allow new users to sign up", active: sysSettings?.registration_enabled, activeColor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400", inactiveColor: "border-red-500/30 bg-red-500/10 text-red-400", activeLabel: "OPEN", inactiveLabel: "LOCKED" },
            { key: "maintenance_mode", label: "Maintenance Mode", desc: "Show maintenance message at checkout", active: sysSettings?.maintenance_mode, activeColor: "border-amber-500/30 bg-amber-500/10 text-amber-400", inactiveColor: "border-zinc-700 bg-zinc-800 text-zinc-500", activeLabel: "ACTIVE", inactiveLabel: "OFF" },
          ].map(s => (
            <div key={s.key} className="flex items-center justify-between p-4 rounded-lg bg-zinc-950 border border-zinc-800">
              <div><p className="font-black text-sm text-white">{s.label}</p><p className="text-[11px] text-zinc-500 mt-0.5">{s.desc}</p></div>
              <button type="button" onClick={() => toggleSetting(s.key, !s.active)}
                className={`px-3 py-1.5 rounded text-[9px] font-black uppercase tracking-widest border font-mono transition-all ${s.active ? s.activeColor : s.inactiveColor}`}>
                {s.active ? s.activeLabel : s.inactiveLabel}
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <Button onClick={handlePurge} disabled={purging}
            className="gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-xs h-9 font-mono uppercase tracking-widest">
            {purging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
            Purge Test Accounts
          </Button>
        </div>
      </div>

      {/* Blocklist */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-zinc-800">
          <div className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20"><Shield className="w-3.5 h-3.5 text-red-500" /></div>
          <span className="font-black text-white text-xs uppercase tracking-[0.12em] font-mono">IP & Domain Blocklist</span>
          <span className="text-[9px] font-black bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded font-mono">{blacklist.length}</span>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <select title="Block type" value={blType} onChange={e => setBlType(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-red-500/30 font-mono">
              <option value="ip">IP Address</option>
              <option value="domain">Email Domain</option>
            </select>
            <Input value={blValue} onChange={e => setBlValue(e.target.value)} placeholder="192.168.1.1 or @domain.com"
              className="sm:col-span-2 bg-zinc-950 border-zinc-800 text-white rounded-lg font-mono placeholder:text-zinc-600" />
            <Button onClick={() => { if (blValue.trim()) handleBlacklist("add", blValue.trim(), blType, blReason || "Manual block"); }}
              className="bg-red-600 hover:bg-red-700 text-white rounded-lg font-black uppercase tracking-widest font-mono text-xs">
              BLOCK
            </Button>
          </div>
          {blacklist.length === 0 ? <EmptyState icon={Shield} message="No IPs or domains blocked." /> : (
            <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
              {blacklist.map(item => (
                <div key={item.id} className="flex items-center justify-between px-4 py-3 bg-zinc-950 hover:bg-zinc-900 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 shrink-0 font-mono">{item.type}</span>
                    <span className="text-sm font-mono text-white font-black truncate">{item.value}</span>
                    {item.reason && <span className="text-[10px] text-zinc-600 font-mono truncate hidden sm:block">{item.reason}</span>}
                  </div>
                  <button type="button" onClick={() => handleBlacklist("remove", item.value)}
                    className="text-[9px] font-black text-zinc-600 hover:text-red-400 transition-colors ml-3 shrink-0 uppercase tracking-widest font-mono">REMOVE</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Device Fingerprint Audit */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20"><ShieldAlert className="w-3.5 h-3.5 text-red-500" /></div>
            <span className="font-black text-white text-xs uppercase tracking-[0.12em] font-mono">Device Fingerprint Audit</span>
            <span className="text-[9px] font-black bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded font-mono">{fDeviceClusters.length} devices</span>
          </div>
          <button type="button" onClick={() => exportCsv(deviceClusters.flatMap(c => c.accounts.map(a => ({ device_id: c.device_id, is_blocked: c.is_blocked, ...a } as Record<string, unknown>))), "device_clusters.csv")}
            className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-white transition-colors px-2 py-1 rounded hover:bg-zinc-800 font-mono">
            <FileDown className="w-3 h-3" /> CSV
          </button>
        </div>
        <div className="p-5 space-y-3">
          {fDeviceClusters.length === 0 ? <EmptyState icon={Shield} message="No device identifiers tracked yet." /> : (
            <div className="space-y-2">
              {fDeviceClusters.map(cluster => {
                const exp = expandedDevice === cluster.device_id;
                const hasSuspended = cluster.is_blocked;
                return (
                  <div key={cluster.device_id} className={`rounded-xl border overflow-hidden ${hasSuspended ? "border-red-500/40 bg-red-950/15" : "border-zinc-800 bg-zinc-950/40"}`}>
                    <div className="flex items-center justify-between px-4 py-3">
                      <button type="button" onClick={() => setExpandedDevice(exp ? null : cluster.device_id)} className="flex-1 flex items-center gap-3 text-left flex-wrap min-w-0">
                        {exp ? <ChevronUp className="w-3 h-3 text-red-400 shrink-0" /> : <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />}
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border font-mono tracking-wider ${hasSuspended ? "text-red-400 bg-red-500/10 border-red-500/30" : "text-zinc-400 bg-zinc-850 border-zinc-700"}`}>
                          {hasSuspended ? "BLOCKED DEVICE" : "ACTIVE DEVICE"}
                        </span>
                        <span className="font-mono text-xs font-bold text-white truncate max-w-[200px] sm:max-w-xs">{cluster.device_id}</span>
                        <span className="text-[9px] font-black bg-zinc-800 text-zinc-400 border border-zinc-700 px-2 py-0.5 rounded font-mono">
                          {cluster.accounts.length} linked account{cluster.accounts.length !== 1 ? "s" : ""}
                        </span>
                      </button>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <button type="button" onClick={() => copyText(cluster.device_id, "Device ID copied")} className="p-1.5 rounded text-zinc-600 hover:text-white hover:bg-zinc-800 transition-all"><Copy className="w-3 h-3" /></button>
                        <button type="button" onClick={() => handleBulkSuspend(cluster.accounts.map(a => a.user_id), !hasSuspended)}
                          className={`text-[9px] font-black uppercase px-3 py-1.5 rounded transition-all tracking-widest font-mono ${
                            hasSuspended 
                              ? "bg-emerald-600 hover:bg-emerald-700 text-white" 
                              : "bg-red-600 hover:bg-red-700 text-white"
                          }`}>
                          {hasSuspended ? "RESTORE ALL" : "SUSPEND ALL"}
                        </button>
                      </div>
                    </div>
                    {exp && (
                      <div className="border-t border-zinc-800/60 divide-y divide-zinc-800/40">
                        {cluster.accounts.map(acc => {
                          const role = roleLabel(acc);
                          return (
                            <div key={acc.user_id} className="flex items-center justify-between px-4 py-2.5 bg-zinc-950/50">
                              <div className="min-w-0">
                                <p className="text-sm font-black text-white truncate">{acc.full_name || "—"}</p>
                                <p className="text-[11px] text-zinc-500 font-mono truncate">{acc.email}</p>
                                {acc.last_seen_at && <p className="text-[10px] text-zinc-600 font-mono">Seen: {fmt(acc.last_seen_at)}</p>}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0 ml-3">
                                {acc.is_suspended && <span className="text-[9px] font-black px-2 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/20 font-mono">SUSPENDED</span>}
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${role.cls}`}>{role.label}</span>
                                <span className="text-[10px] text-zinc-500 font-mono">{acc.login_count ?? 0}× logins</span>
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
        </div>
      </div>
    </div>
  );

  const renderAdmins = () => (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20"><ShieldCheck className="w-3.5 h-3.5 text-amber-500" /></div>
          <span className="font-black text-white text-xs uppercase tracking-[0.12em] font-mono">Grant Administrator Privileges</span>
        </div>
        <p className="text-xs text-zinc-500 mb-4 font-mono">Promote an existing user to permanent Administrator. They gain full access to wallets, providers, and user management.</p>
        <div className="flex flex-col sm:flex-row gap-2 max-w-2xl">
          <Input placeholder="Enter account email…" value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)}
            className="bg-zinc-950 border-zinc-800 text-white rounded-lg font-mono placeholder:text-zinc-600"
            onKeyDown={e => { if (e.key === "Enter") void handleAddAdmin(); }} />
          <Button onClick={handleAddAdmin} disabled={addingAdmin || !newAdminEmail.trim()}
            className="gap-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-black uppercase tracking-widest font-mono text-xs shrink-0">
            {addingAdmin ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Grant Admin
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20"><Lock className="w-3.5 h-3.5 text-emerald-500" /></div>
            <span className="font-black text-white text-xs uppercase tracking-[0.12em] font-mono">System Administrators</span>
            <span className="text-[9px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono">{adminsList.length}</span>
          </div>
          <button type="button" onClick={() => void fetchAdmins()} className="text-zinc-600 hover:text-white transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loadingAdmins ? "animate-spin" : ""}`} />
          </button>
        </div>
        {loadingAdmins && adminsList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-7 h-7 text-amber-500 animate-spin" />
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest font-mono">Fetching roster…</p>
          </div>
        ) : adminsList.length === 0 ? (
          <EmptyState icon={ShieldAlert} message="No administrators returned. Check edge log." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-zinc-950 border-b border-zinc-800"><TH>Administrator</TH><TH>MFA</TH><TH>Last Seen</TH><TH>IP Lock</TH><TH>Actions</TH></tr></thead>
              <tbody>
                {adminsList.map(adm => {
                  const isMe = adm.user_id === session?.user.id;
                  return (
                    <tr key={adm.user_id} className="border-b border-zinc-800/60 hover:bg-zinc-900/60 transition-colors">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs ${isMe ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : "bg-zinc-800 text-zinc-400 border border-zinc-700"}`}>
                            {(adm.full_name || adm.email || "?").charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-black text-white text-sm">{adm.full_name || "Unnamed"}</p>
                              {isMe && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">YOU</span>}
                            </div>
                            <p className="text-[11px] text-zinc-500 font-mono">{adm.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {adm.is_mfa_verified
                          ? <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><Shield className="w-3 h-3" /><span className="text-[9px] font-black font-mono uppercase">2FA OK</span></div>
                          : <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20 animate-pulse"><AlertCircle className="w-3 h-3" /><span className="text-[9px] font-black font-mono uppercase">NO 2FA</span></div>}
                      </td>
                      <td className="px-4 py-4 text-xs font-mono text-zinc-500">{fmt(adm.last_seen_at)}</td>
                      <td className="px-4 py-4">
                        {adm.allowed_ips?.length ? <span className="text-[10px] font-black text-emerald-400 flex items-center gap-1 font-mono"><Lock className="w-3 h-3" />{adm.allowed_ips.length} IPs</span>
                          : <span className="text-[10px] text-zinc-600 flex items-center gap-1 font-mono"><Globe className="w-3 h-3" />Global</span>}
                      </td>
                      <td className="px-4 py-4">
                        {!isMe
                          ? <Button size="sm" variant="ghost" onClick={() => handleRevokeAdmin(adm.user_id, adm.full_name || adm.email)}
                              className="h-7 text-[9px] font-black text-zinc-600 hover:text-red-400 hover:bg-red-500/5 px-3 rounded uppercase tracking-widest font-mono">REVOKE</Button>
                          : <span className="text-[10px] text-zinc-700 italic px-3">—</span>}
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
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20"><BookOpen className="w-3.5 h-3.5 text-violet-400" /></div>
          <span className="font-black text-white text-xs uppercase tracking-[0.12em] font-mono">Admin Action Log</span>
          <span className="text-[9px] font-black bg-violet-500/10 text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded font-mono">Last 50</span>
        </div>
        <button type="button" onClick={() => exportCsv(actionLog as unknown as Record<string, unknown>[], "admin_log.csv")}
          className="flex items-center gap-1.5 text-[9px] text-zinc-500 hover:text-white transition-colors px-2 py-1 rounded hover:bg-zinc-800 font-black font-mono uppercase tracking-widest">
          <FileDown className="w-3 h-3" /> CSV
        </button>
      </div>
      {actionLog.length === 0 ? <div className="p-5"><EmptyState icon={BookOpen} message="No admin actions recorded yet." /></div> : (
        <div className="divide-y divide-zinc-800/60">
          {actionLog.map(entry => (
            <div key={entry.id} className="flex items-center justify-between px-5 py-3 bg-zinc-950 hover:bg-zinc-900 transition-colors gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border font-mono tracking-widest ${
                    entry.action.includes("suspend") ? "bg-red-500/10 text-red-400 border-red-500/20" :
                    entry.action.includes("approve") || entry.action.includes("unsuspend") ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                    entry.action.includes("reject") ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                    "bg-zinc-800 text-zinc-400 border-zinc-700"
                  }`}>{entry.action.replace(/_/g, " ")}</span>
                  <span className="text-xs font-bold text-zinc-300">{entry.target_email || "—"}</span>
                  <span className="text-[10px] text-zinc-600 font-mono hidden sm:block">by {entry.admin_email}</span>
                </div>
              </div>
              <span className="text-[9px] text-zinc-600 font-mono shrink-0">{fmt(entry.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderGuardian = () => {
    /* Agent fleet definition — mirrors ai_agent_registry */
    const AGENT_FLEET = [
      {
        key: "sentinel_prime",
        name: "Sentinel Prime",
        role: "Fraud · Liquidity · Network Healing",
        schedule: "Every 1 min",
        icon: Shield,
        color: "text-amber-400",
        border: "border-amber-500/25",
        bg: "bg-amber-500/10",
        pulse: "bg-amber-500",
        description: "Autonomous system controller. Watches all agents, rebalances provider priorities, broadcasts outages, locks high-risk terminals.",
      },
      {
        key: "guardian_ai",
        name: "Guardian AI",
        role: "24/7 Security Patrol",
        schedule: "Every 5 min",
        icon: ShieldAlert,
        color: "text-cyan-400",
        border: "border-cyan-500/25",
        bg: "bg-cyan-500/10",
        pulse: "bg-cyan-500",
        description: "Monitors live orders for wallet draining, micro-transactions (card testing), impossible travel, and API brute-force attacks.",
      },
      {
        key: "threat_hunter",
        name: "Threat Hunter",
        role: "Cross-Signal Correlation",
        schedule: "Every 3 min",
        icon: Crosshair,
        color: "text-red-400",
        border: "border-red-500/25",
        bg: "bg-red-500/10",
        pulse: "bg-red-500",
        description: "Correlates IP clusters, subnet sweeps, signup bursts, referral rings, and login bots into unified coordinated-attack profiles.",
      },
      {
        key: "aml_scanner",
        name: "AML Scanner",
        role: "Anti-Money Laundering",
        schedule: "Every 10 min",
        icon: TrendingUp,
        color: "text-purple-400",
        border: "border-purple-500/25",
        bg: "bg-purple-500/10",
        pulse: "bg-purple-500",
        description: "Detects structuring, rapid cashout, volume spikes (10×), circular flows (wash trading), and smurfing patterns in transaction data.",
      },
      {
        key: "account_cloner",
        name: "Account Cloner",
        role: "Multi-Account Fraud",
        schedule: "Every 20 min",
        icon: UserX,
        color: "text-orange-400",
        border: "border-orange-500/25",
        bg: "bg-orange-500/10",
        pulse: "bg-orange-500",
        description: "Identifies duplicate accounts via phone deduplication, IP burst signups, name+domain pattern matching, and self-referral loops.",
      },
      {
        key: "sentinel_evolve",
        name: "Sentinel Evolve",
        role: "Self-Learning Loop",
        schedule: "Every 15 min",
        icon: Radio,
        color: "text-emerald-400",
        border: "border-emerald-500/25",
        bg: "bg-emerald-500/10",
        pulse: "bg-emerald-500",
        description: "Evaluates effectiveness of every autonomous action and updates strategy confidence scores — the system learns from every decision.",
      },
    ];

    return (
    <div className="space-y-5">

      {/* ── Fleet status header ── */}
      <div className="rounded-xl border border-cyan-500/25 bg-zinc-950 p-5 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,255,0.012) 2px, rgba(0,255,255,0.012) 4px)" }} />
        <div className="relative flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center relative overflow-hidden shrink-0">
            <div className="absolute inset-0 bg-cyan-500/10 animate-pulse" />
            <Bot className="w-6 h-6 text-cyan-400 relative z-10" />
          </div>
          <div className="flex-1">
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-600 font-mono">// Autonomous AI Defense Network</p>
            <h2 className="text-base font-black text-cyan-400 uppercase tracking-wide font-mono mt-0.5">AI Agent Fleet — {AGENT_FLEET.length} Agents Deployed</h2>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-black uppercase tracking-widest font-mono"><Pulse color="bg-emerald-500" />ALL AGENTS ACTIVE</span>
              <span className="text-[9px] text-zinc-600 font-mono">Next UI scan: {autoCount}s</span>
              <span className="text-[9px] text-zinc-600 font-mono">Neutralized: {neutralized}</span>
            </div>
          </div>
          <button type="button" onClick={() => void fetchData(true)} className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-600 hover:text-white flex items-center justify-center shrink-0">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Agent fleet grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {AGENT_FLEET.map(agent => {
          const AIcon = agent.icon;
          const dbAgent = dbAgents.find(a => a.name === agent.key);
          const currentModel = dbAgent?.active_model || "claude-haiku-4-5-20251001";
          
          return (
            <div key={agent.key} className={`rounded-xl border ${agent.border} bg-zinc-950 p-4 relative overflow-hidden`}>
              {/* subtle scan-line top accent */}
              <div className={`absolute top-0 left-0 right-0 h-0.5 ${agent.bg}`} />
              <div className="flex items-start justify-between mb-3">
                <div className={`p-2 rounded-lg border ${agent.border} ${agent.bg}`}>
                  <AIcon className={`w-4 h-4 ${agent.color}`} />
                </div>
                <div className="flex items-center gap-1.5">
                  <Pulse color={agent.pulse} />
                  <span className={`text-[9px] font-black font-mono uppercase tracking-widest ${agent.color}`}>LIVE</span>
                </div>
              </div>
              <p className={`text-xs font-black ${agent.color} font-mono uppercase tracking-wide mb-0.5`}>{agent.name}</p>
              <p className="text-[10px] text-zinc-500 font-mono mb-2">{agent.role}</p>
              <p className="text-[10px] text-zinc-600 leading-relaxed mb-3">{agent.description}</p>
              
              <div className="flex items-center justify-between pt-2 border-t border-zinc-800 flex-wrap gap-2">
                <span className="text-[9px] text-zinc-600 font-mono">{agent.schedule}</span>
                <select
                  value={currentModel}
                  onChange={async (e) => {
                    const modelVal = e.target.value;
                    setDbAgents(prev => prev.map(a => a.name === agent.key ? { ...a, active_model: modelVal } : a));
                    
                    const { error } = await supabase
                      .from("ai_agent_registry")
                      .update({ active_model: modelVal })
                      .eq("name", agent.key);
                      
                    if (error) {
                      toast({ title: "Failed to update routing", description: error.message, variant: "destructive" });
                      void fetchData(true);
                    } else {
                      toast({ title: `${agent.name} Rerouted`, description: `Agent model updated to ${modelVal}` });
                    }
                  }}
                  className="text-[9px] font-bold font-mono bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-cyan-400 focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="claude-haiku-4-5-20251001">Claude Haiku</option>
                  <option value="claude-sonnet-4-5-20250929">Claude Sonnet</option>
                  <option value="gemini-1.5-flash">Gemini Flash</option>
                  <option value="gemini-1.5-pro">Gemini Pro</option>
                </select>
              </div>
            </div>
          );
        })}
      </div>

      {/* Full agent feed */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <Terminal className="w-3.5 h-3.5 text-purple-400" />
            <span className="font-black text-white text-xs uppercase tracking-[0.12em] font-mono">AI Agent Decision Log</span>
            <span className="text-[9px] font-black bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded font-mono">{agentFeed.length}</span>
          </div>
          <button type="button" onClick={() => setAgentFeed([])} className="text-[9px] text-zinc-600 hover:text-white font-black font-mono uppercase tracking-widest">CLEAR</button>
        </div>
        {agentFeed.length === 0 ? (
          <div className="p-5"><EmptyState icon={Bot} message="Agent initializing — awaiting threat data…" /></div>
        ) : (
          <div className="divide-y divide-zinc-800/60 max-h-[500px] overflow-y-auto">
            {agentFeed.map(a => {
              const cfg = AGENT_TYPE_CFG[a.type];
              const AIcon = cfg.icon;
              return (
                <div key={a.id} className={`p-4 hover:bg-zinc-900/60 transition-colors ${a.status === "executing" ? "bg-amber-950/10" : ""}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className={`flex items-center gap-1 px-2 py-0.5 rounded border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                        <AIcon className={`w-3 h-3 ${cfg.color}`} />
                        <span className="text-[9px] font-black font-mono tracking-widest">{cfg.label}</span>
                      </div>
                      <span className={`text-[9px] font-black px-1.5 py-0 rounded font-mono ${
                        a.severity === "critical" ? "bg-red-500/10 text-red-400" : a.severity === "high" ? "bg-orange-500/10 text-orange-400" : a.severity === "medium" ? "bg-amber-500/10 text-amber-400" : "bg-zinc-800 text-zinc-500"
                      }`}>{a.severity.toUpperCase()}</span>
                      {a.count !== undefined && <span className="text-[9px] text-zinc-500 font-mono">{a.count} accounts</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {a.status === "executing" && <span className="text-[9px] text-amber-400 font-mono animate-pulse">EXECUTING…</span>}
                      {a.status === "done"      && <span className="text-[9px] text-emerald-400 font-mono">✓ DONE</span>}
                      {a.status === "failed"    && <span className="text-[9px] text-red-400 font-mono">✗ FAILED</span>}
                      <span className="text-[9px] text-zinc-600 font-mono">{a.timestamp.toLocaleTimeString()}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-400 font-mono">{a.reasoning}</p>
                  {a.target !== "system" && <p className="text-[10px] text-zinc-600 font-mono mt-0.5">Target: {a.target}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sentinel DB log */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-zinc-800">
          <Shield className="w-3.5 h-3.5 text-cyan-500" />
          <span className="font-black text-white text-xs uppercase tracking-[0.12em] font-mono">Sentinel Action DB</span>
        </div>
        {guardianLogs.length === 0 ? <div className="p-5"><EmptyState icon={Bot} message="Sentinel has not executed recent actions." /></div> : (
          <div className="divide-y divide-zinc-800/60">
            {guardianLogs.map(log => (
              <div key={log.id} className="p-4 bg-zinc-950 hover:bg-zinc-900/60 transition-colors">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border font-mono tracking-widest ${
                      log.action_type === "lock_terminal" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                      log.action_type === "broadcast_outage" ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                      "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                    }`}>{log.action_type.replace(/_/g, " ")}</span>
                    {log.metadata?.target && <span className="text-xs font-bold text-zinc-300 font-mono">→ {String(log.metadata.target).slice(0, 12)}…</span>}
                  </div>
                  <span className="text-[9px] text-zinc-600 font-mono">{fmt(log.created_at)}</span>
                </div>
                <p className="text-[11px] text-zinc-500 font-mono">{log.reasoning}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
  };

  /* ══ MAIN RENDER ═════════════════════════════════════════════════ */
  return (
    <div className="space-y-5 pb-10">

      {/* DEFCON 1-2 critical alert banner */}
      {defcon <= 2 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-red-500/50 bg-red-950/30 animate-pulse">
          <Pulse /><Pulse />
          <p className="text-xs font-black text-red-400 uppercase tracking-widest font-mono flex-1">
            {defcon === 1 ? "DEFCON 1 — ACTIVE ATTACK IN PROGRESS — ALL RESPONSES ARMED" : "DEFCON 2 — CRITICAL THREAT LEVEL — AUTO-RESPONSE ENGAGED"}
          </p>
          <Pulse /><Pulse />
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
              <Shield className="w-5 h-5 text-red-500" />
            </div>
            {totalThreats > 0 && <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-zinc-950 animate-pulse" />}
          </div>
          <div>
            <h1 className="font-black text-xl text-white tracking-tight uppercase font-mono">Security Center</h1>
            <p className="text-[10px] text-zinc-600 font-mono mt-0.5 uppercase tracking-widest">AI-Powered · Auto-Response · Real-Time</p>
          </div>
          {totalThreats > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded border border-red-500/30 bg-red-950/20 ml-2">
              <Pulse />
              <span className="text-[10px] font-black text-red-400 uppercase tracking-widest font-mono">{totalThreats} Active</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600" />
            <Input placeholder="Search users, IPs…" value={search} onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 w-48 bg-zinc-950 border-zinc-800 text-white placeholder:text-zinc-600 rounded-lg text-xs font-mono focus-visible:ring-red-500/20" />
          </div>
          <button type="button" onClick={() => void fetchData(true)} title="Refresh"
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-600 hover:text-white hover:bg-zinc-900 transition-all">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button type="button"
            onClick={() => exportCsv([
              ...clusters.flatMap(c => c.accounts.map(a => ({ section: "shared_ip", ip: c.ip, ...a } as Record<string, unknown>))),
              ...velocityAccts.map(v => ({ section: "velocity", ...v } as Record<string, unknown>)),
              ...failedUsers.map(u => ({ section: "failed_orders", ...u } as Record<string, unknown>)),
            ], "security_export.csv")}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-white hover:bg-zinc-900 transition-all text-[10px] font-black font-mono uppercase tracking-widest">
            <FileDown className="w-3 h-3" /> Export
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 p-1 bg-zinc-950 border border-zinc-800 rounded-xl w-fit overflow-x-auto">
        {TABS.map(t => {
          const active = tab === t.id;
          const Icon = t.icon;
          const danger = (t.id === "threats" && totalThreats > 0) || (t.id === "access" && !!sysSettings?.maintenance_mode);
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap font-mono ${
                active ? "bg-zinc-800 text-white border border-zinc-700" : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900 border border-transparent"
              }`}>
              <Icon className="w-3 h-3" />
              {t.label}
              {danger && !active && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />}
            </button>
          );
        })}
      </div>

      {/* Tab body */}
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
