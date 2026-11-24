/**
 * THREAT HUNTER — Cross-Signal Attack Correlation Engine
 * Runs every 3 minutes via pg_cron.
 *
 * Unlike Guardian AI (which watches live orders) this agent operates at the
 * IDENTITY layer: it cross-correlates profiles, IP clusters, signup velocity,
 * referral rings and failed-order patterns to detect coordinated attacks that
 * span multiple sessions and accounts.  When a coordinated attack is confirmed
 * it proposes actions for an admin to approve (safe-agents design 2026-11-24).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { timingSafeEqual } from "../_shared/gateway-security.ts";
import { routeAgentAction, type AgentAction, type AgentMode } from "../_shared/agent_policy.ts";
import { queueAgentAction, runAutoAction } from "../_shared/agent_actions.ts";
import { agentSms } from "../_shared/agent_sms.ts";
import { callAiAgent, getAgentConfig } from "../_shared/ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const db = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  const cronSecret = (Deno.env.get("CRON_SECRET") || "").trim();
  const providedCron = (req.headers.get("x-cron-secret") || "").trim();
  const bearerToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  const isServiceRole = Boolean(SUPABASE_SERVICE_ROLE_KEY && bearerToken && timingSafeEqual(bearerToken, SUPABASE_SERVICE_ROLE_KEY));
  const isCronAuthed = Boolean(isServiceRole || (cronSecret && providedCron && timingSafeEqual(providedCron, cronSecret)));
  if (!isCronAuthed) {
    const authRes = await verifyAdmin(req, db);
    if (!authRes.success) {
      return new Response(JSON.stringify({ error: authRes.error || "Unauthorized" }), {
        status: authRes.status || 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    console.log("🎯 Threat Hunter: Initiating cross-signal correlation sweep...");

    const AGENT = "threat_hunter";
    // Safe-agents design (2026-11-24): this agent WATCHES and PROPOSES. Suspensions, IP
    // blocks, locks and cashout freezes go through routeAgentAction: queued for an admin
    // with 2FA (propose mode) or recorded as "would propose" findings (observe_only).
    // Flags and capped admin alerts are the only things it does by itself.
    const notifyAdmin = (msg: string, topic?: string) =>
      runAutoAction(db, AGENT, { type: "notify_admin", params: { message: msg, topic } }, { sms: agentSms });
    const routeOne = async (mode: AgentMode, action: AgentAction) => {
      const { route, reason } = routeAgentAction(mode, action);
      if (route === "run") return { type: action.type, route, ...(await runAutoAction(db, AGENT, action, { sms: agentSms })) };
      if (route === "queue") return { type: action.type, route, ...(await queueAgentAction(db, AGENT, action)) };
      if (route === "record") {
        await runAutoAction(db, AGENT, { type: "record_finding", reason: action.reason, params: { would_propose: action } }, { sms: agentSms });
        return { type: action.type, route };
      }
      return { type: action.type, route, reason };
    };

    // ── 1. Pull profile snapshot ───────────────────────────────────────────────
    const { data: profiles } = await db
      .from("profiles")
      .select("user_id,full_name,email,last_ip,last_seen_at,login_count,is_agent,is_suspended,referred_by,created_at")
      .order("created_at", { ascending: false })
      .limit(3000);

    const rows = profiles ?? [];

    // ── 2. IP cluster analysis ─────────────────────────────────────────────────
    const ipMap = new Map<string, typeof rows>();
    rows.forEach(p => {
      if (!p.last_ip) return;
      const bucket = ipMap.get(p.last_ip) ?? [];
      bucket.push(p);
      ipMap.set(p.last_ip, bucket);
    });

    const clusters: { ip: string; count: number; user_ids: string[] }[] = [];
    ipMap.forEach((accs, ip) => {
      if (accs.length >= 3) {
        clusters.push({ ip, count: accs.length, user_ids: accs.map(a => a.user_id) });
      }
    });
    clusters.sort((a, b) => b.count - a.count);

    // ── 3. Subnet sweep detection (multiple IPs from same /24) ────────────────
    const subnetMap = new Map<string, string[]>();
    clusters.forEach(c => {
      const sn = c.ip.split(".").slice(0, 3).join(".");
      const arr = subnetMap.get(sn) ?? [];
      arr.push(c.ip);
      subnetMap.set(sn, arr);
    });
    const subnetSweeps: { subnet: string; ips: string[]; total_accounts: number }[] = [];
    subnetMap.forEach((ips, subnet) => {
      if (ips.length < 2) return;
      const total = ips.reduce((s, ip) => s + (ipMap.get(ip)?.length ?? 0), 0);
      subnetSweeps.push({ subnet, ips, total_accounts: total });
    });

    // ── 4. Signup velocity (>10 new accounts within 1 hour windows) ───────────
    const hourBuckets = new Map<string, number>();
    rows.forEach(p => {
      const hour = p.created_at.slice(0, 13); // "2026-05-28T14"
      hourBuckets.set(hour, (hourBuckets.get(hour) ?? 0) + 1);
    });
    const signupBursts = Array.from(hourBuckets.entries())
      .filter(([, n]) => n >= 10)
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // ── 5. Referral ring detection ─────────────────────────────────────────────
    const refMap = new Map<string, string[]>();
    rows.forEach(p => {
      if (!p.referred_by) return;
      const arr = refMap.get(p.referred_by) ?? [];
      arr.push(p.user_id);
      refMap.set(p.referred_by, arr);
    });
    const referralRings = Array.from(refMap.entries())
      .filter(([, ids]) => ids.length >= 6)
      .map(([referrer_id, member_ids]) => ({ referrer_id, size: member_ids.length, member_ids }))
      .sort((a, b) => b.size - a.size);

    // ── 6. High-frequency login bots ──────────────────────────────────────────
    const loginBots = rows
      .filter(p => (p.login_count ?? 0) >= 300 && !p.is_suspended)
      .map(p => ({ user_id: p.user_id, email: p.email, login_count: p.login_count }));

    // Early exit if environment is clean
    const totalSignals = clusters.length + subnetSweeps.length + referralRings.length + loginBots.length;
    if (totalSignals === 0) {
      console.log("Threat Hunter: Environment clean — no cross-signal threats detected.");
      return new Response(JSON.stringify({ success: true, message: "Clean environment." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 7. AI reasoning ───────────────────────────────────────────────────────
    const systemPrompt = `
You are THREAT HUNTER — an elite cross-signal attack correlation engine for SwiftData.
You analyse multi-layer threat signals from identity and behavioural data to detect coordinated attacks.

━━━ THREAT SIGNALS ━━━
1. IP_CLUSTER (≥3 accounts on same IP) → credential sharing / SIM-swap ring
2. SUBNET_SWEEP (≥2 clusters in same /24) → VPN rotation / botnet sweep
3. SIGNUP_BURST (≥10 signups in 1 hour) → mass account farming
4. REFERRAL_RING (≥6 members per referrer) → bonus farming syndicate
5. LOGIN_BOT (≥300 logins, not suspended) → automated credential testing

━━━ AVAILABLE ACTIONS ━━━
- suspend_cluster: { "user_ids": ["uuid",...], "ip": "string", "reason": "string" }
- blacklist_ip: { "ip": "string", "reason": "string" }
- suspend_referral_ring: { "referrer_id": "uuid", "member_ids": ["uuid",...], "reason": "string" }
- suspend_login_bot: { "user_id": "uuid", "reason": "string" }
- notify_admin: { "message": "string" }

━━━ DECISION RULES ━━━
- IP cluster ≥5 accounts → propose suspend_cluster + blacklist_ip (an admin approves)
- IP cluster 3-4 accounts → blacklist_ip only
- Subnet sweep with ≥3 IPs → notify_admin with coordinated attack assessment
- Referral ring ≥10 members → suspend_referral_ring
- Login bot ≥300 logins → suspend_login_bot
- Always include a notify_admin for any CRITICAL action.

━━━ OUTPUT FORMAT ━━━
Respond with RAW JSON only. No markdown. No backticks.
{"threat_level":"CRITICAL|HIGH|MEDIUM|LOW","summary":"string","actions":[{"type":"string","params":{}}]}
`.trim();

    const userMessage = JSON.stringify({
      ip_clusters: clusters.slice(0, 20),
      subnet_sweeps: subnetSweeps,
      signup_bursts: signupBursts,
      referral_rings: referralRings.slice(0, 10),
      login_bots: loginBots.slice(0, 20),
    });

    const aiResult = await callAiAgent(
      db,
      "threat_hunter",
      systemPrompt,
      userMessage,
      1200
    );

    const rawText = aiResult.text;
    const jStart = rawText.indexOf("{");
    const jEnd = rawText.lastIndexOf("}");
    const parsed = JSON.parse(rawText.slice(jStart, jEnd + 1));
    const { threat_level = "LOW", summary = "", actions = [] } = parsed;

    // ── Route actions through the safe-agents policy ─────────────────────────
    const agentCfg = await getAgentConfig(db, "threat_hunter");
    const executed: any[] = [];
    for (const raw of (Array.isArray(actions) ? actions : []).slice(0, 10)) {
      const p: Record<string, any> = { ...(raw?.params ?? {}) };
      const reason = String(p.reason ?? summary ?? "");
      const proposals: AgentAction[] = [];
      if (raw?.type === "suspend_cluster") {
        proposals.push({ type: "suspend_cluster", title: `Threat Hunter: suspend ${(p.user_ids ?? []).length} accounts on IP ${p.ip ?? "?"}`, reason, priority: "critical", params: { user_ids: p.user_ids, ip: p.ip, reason } });
        if (p.ip) proposals.push({ type: "blacklist_ip", title: `Threat Hunter: block IP ${p.ip}`, reason, priority: "high", params: { ip: p.ip, reason } });
      } else if (raw?.type === "blacklist_ip") {
        proposals.push({ type: "blacklist_ip", title: `Threat Hunter: block IP ${p.ip}`, reason, priority: "high", params: { ip: p.ip, reason } });
      } else if (raw?.type === "suspend_referral_ring") {
        proposals.push({ type: "suspend_referral_ring", title: `Threat Hunter: suspend referral ring of ${String(p.referrer_id ?? "?").slice(0, 8)}`, reason, priority: "high", params: { referrer_id: p.referrer_id, member_ids: p.member_ids, reason } });
      } else if (raw?.type === "suspend_login_bot") {
        proposals.push({ type: "suspend_login_bot", title: `Threat Hunter: suspend login bot ${String(p.user_id ?? "?").slice(0, 8)}`, reason, priority: "high", params: { user_id: p.user_id, reason } });
      } else if (raw?.type === "notify_admin") {
        await notifyAdmin(p.message ?? "Threat Hunter detected a coordinated attack.", p.topic);
      } else {
        executed.push({ type: raw?.type, route: "drop", reason: "unknown action" });
      }
      for (const action of proposals) executed.push(await routeOne(agentCfg.autonomy_mode, action));
    }

    // Always log the scan summary even if no actions
    if (executed.length === 0 && totalSignals > 0) {
      await db.from("sentinel_actions").insert({
        action_type: "threat_scan",
        status: "executed",
        effectiveness: 0,
        reasoning: summary || `Threat Hunter: ${totalSignals} signals analysed, threat level ${threat_level}`,
        metadata: { source: "threat_hunter", threat_level, signals: totalSignals },
      });
    }

    if (threat_level === "CRITICAL" || threat_level === "HIGH") {
      await notifyAdmin(`${threat_level} threat detected. ${executed.length} responses proposed or recorded. ${summary}`);
    }

    return new Response(JSON.stringify({ success: true, threat_level, actions_taken: executed.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Threat Hunter Critical Failure:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
