/**
 * AI FIX-PROPOSER AGENT — Incident Root-Cause Analyzer & Safe Fix Proposal Engine
 *
 * Inspects recent reconciliation discrepancies (e.g. "Delivered twice", double refunds,
 * underpaid deliveries), margin watchdog alerts, failing SME providers, error clusters,
 * and stuck order summaries.
 *
 * STRICT SAFETY GUARDRAILS:
 *  - Read-only on `orders`, `wallet_ledger`, `providers`, and `system_logs`.
 *  - NEVER sends, retries, heals, or refunds orders; NEVER debits/credits wallets.
 *  - NEVER promotes or routes Korba providers for affordable SME data bundles.
 *  - Every operational change is queued as a deduplicated, 2FA-gated proposal in
 *    `ai_worker_tasks` via `queueAgentAction` (approved only via `ai-task-decide`).
 *  - Structured fix playbooks (root cause, impact, safe steps) are persisted into
 *    `ai_system_memory` (`category: "fix_proposal"`) for `/admin/watchdog`.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { timingSafeEqual } from "../_shared/gateway-security.ts";
import { callAiAgent, getAgentConfig } from "../_shared/ai.ts";
import {
  routeAgentAction,
  shouldSkipRun,
  type AgentAction,
  type AgentMode,
} from "../_shared/agent_policy.ts";
import { queueAgentAction, runAutoAction } from "../_shared/agent_actions.ts";
import { agentSms } from "../_shared/agent_sms.ts";

declare const Deno: any;

const AGENT_NAME = "ai_fix_proposer";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function isKorbaProvider(p: any): boolean {
  const ht = String(p?.handler_type || "").toLowerCase();
  const name = String(p?.name || "").toLowerCase();
  return ht.includes("korba") || name.includes("korba");
}

function safeParseJson(raw: string): Record<string, any> {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
  } catch (err) {
    console.warn("[ai-fix-proposer] Failed to parse AI JSON:", err);
  }
  return {};
}

function slugify(input: string): string {
  return String(input || "incident")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "incident";
}

interface IncidentItem {
  id: string;
  incident_type: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  summary: string;
  impact_ghs?: number;
  details: Record<string, unknown>;
}

interface FixProposal {
  proposal_key: string;
  incident_type: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  root_cause: string;
  impact: string;
  recommended_steps: string[];
  guardrail_note?: string;
  safe_action?: AgentAction | null;
}

async function collectIncidentContext(supabaseAdmin: any) {
  const now = Date.now();
  const fiveMinsAgo = new Date(now - 5 * 60 * 1000).toISOString();
  const tenMinsAgo = new Date(now - 10 * 60 * 1000).toISOString();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const [
    reconRunsRes,
    memoryRes,
    insightsRes,
    providersRes,
    errorLogsRes,
    stuckPendingRes,
    stuckProcessingRes,
    existingTasksRes,
  ] = await Promise.all([
    supabaseAdmin
      .from("wallet_reconciliation_runs")
      .select("id, kind, ok, issues, details, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabaseAdmin
      .from("ai_system_memory")
      .select("id, memory_key, category, summary, data, confidence, observations_count, last_observed_at")
      .order("last_observed_at", { ascending: false })
      .limit(35),
    supabaseAdmin
      .from("ai_insights")
      .select("id, type, insight_text, metadata, created_at")
      .in("type", ["margin_watchdog", "agent_finding"])
      .gte("created_at", twentyFourHoursAgo)
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("providers")
      .select("id, name, handler_type, balance, priority, is_active, consecutive_failures")
      .order("priority", { ascending: true }),
    supabaseAdmin
      .from("system_logs")
      .select("id, source, event, message, ts")
      .eq("level", "error")
      .gte("ts", sixHoursAgo)
      .order("ts", { ascending: false })
      .limit(40),
    supabaseAdmin
      .from("orders")
      .select("id, network, amount, order_type, created_at")
      .eq("status", "pending")
      .not(
        "order_type",
        "in",
        '("wallet_topup","store_wallet_topup","agent_activation","sub_agent_activation","vendor_activation","free_data_claim")'
      )
      .gte("created_at", twoHoursAgo)
      .lte("created_at", fiveMinsAgo)
      .limit(20),
    supabaseAdmin
      .from("orders")
      .select("id, network, provider_id, amount, created_at")
      .eq("status", "processing")
      .gte("created_at", twentyFourHoursAgo)
      .lte("created_at", tenMinsAgo)
      .limit(25),
    supabaseAdmin
      .from("ai_worker_tasks")
      .select("id, agent_name, task_type, target_key, status, title, created_at")
      .gte("created_at", twentyFourHoursAgo)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const providers = (providersRes.data || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    handler_type: p.handler_type,
    is_korba: isKorbaProvider(p),
    balance: Number(p.balance || 0),
    priority: Number(p.priority ?? 99),
    is_active: p.is_active !== false,
    consecutive_failures: Number(p.consecutive_failures || 0),
  }));

  const healthySmeBackups = providers.filter(
    (p: any) => !p.is_korba && p.is_active && p.balance >= 100 && p.consecutive_failures < 3
  );

  const incidents: IncidentItem[] = [];

  // 1. Latest reconciliation discrepancies (including "Delivered twice", double refunds, underpaid deliveries)
  const latestRecon = (reconRunsRes.data || [])[0];
  if (latestRecon && !latestRecon.ok && Number(latestRecon.issues || 0) > 0) {
    const sample = Array.isArray(latestRecon.details?.sample) ? latestRecon.details.sample : [];
    const byType = (latestRecon.details?.by_type || {}) as Record<string, number>;
    for (const [issueType, count] of Object.entries(byType)) {
      if (!Number(count)) continue;
      const matching = sample.filter((s: any) => s?.type === issueType);
      const totalGhs = Number(
        matching.reduce((acc: number, item: any) => acc + Number(item?.amount_ghs || 0), 0).toFixed(2)
      );
      const label = issueType.replace(/_/g, " ");
      incidents.push({
        id: `recon:${issueType}`,
        incident_type: issueType,
        severity:
          issueType === "delivered_twice" ||
          issueType === "refunded_twice" ||
          issueType === "delivered_underpaid" ||
          issueType === "credited_without_payment"
            ? "critical"
            : "high",
        title: `Reconciliation: ${count} ${label} issue(s)`,
        summary: `${count} ${label} discrepancy(ies) detected in last ${Number(
          latestRecon.details?.window_hours || 48
        )}h totaling GH₵${totalGhs.toFixed(2)}.`,
        impact_ghs: totalGhs,
        details: {
          run_id: latestRecon.id,
          run_at: latestRecon.created_at,
          count,
          sample: matching.slice(0, 5),
        },
      });
    }
  }

  // 2. Reconciliation / Margin / Error signals persisted in ai_system_memory
  const memories = memoryRes.data || [];
  for (const mem of memories) {
    const key = String(mem.memory_key || "");
    if (key.startsWith("fix_proposal:")) continue;
    if (key === "margin_watchdog:latest") {
      const lossCount = Number(mem.data?.loss_count || 0);
      const razorCount = Number(mem.data?.razor_thin_count || 0);
      if (lossCount > 0 || razorCount > 0) {
        incidents.push({
          id: "margin:latest",
          incident_type: "margin_loss",
          severity: lossCount > 0 ? "critical" : "medium",
          title:
            lossCount > 0
              ? `Margin Loss: ${lossCount} bundle(s) selling below wholesale cost`
              : `Margin Warning: ${razorCount} razor-thin (<2%) bundle(s)`,
          summary: String(mem.summary || "Margin watchdog flagged pricing exposure."),
          details: {
            loss_count: lossCount,
            razor_thin_count: razorCount,
            top_loss_findings: Array.isArray(mem.data?.top_loss_findings)
              ? mem.data.top_loss_findings.slice(0, 5)
              : [],
            prioritized_actions: Array.isArray(mem.data?.prioritized_actions)
              ? mem.data.prioritized_actions.slice(0, 5)
              : [],
          },
        });
      }
    }
  }

  // 3. Failing or underfunded active SME providers
  const degradedProviders = providers.filter(
    (p: any) => !p.is_korba && p.is_active && (p.consecutive_failures >= 3 || p.balance < 100)
  );
  for (const prov of degradedProviders) {
    incidents.push({
      id: `provider:${prov.id}`,
      incident_type: "provider_error",
      severity: prov.priority === 1 ? "critical" : "high",
      title: `SME Provider Degraded: ${prov.name}`,
      summary: `${prov.name} (priority ${prov.priority}) has ${prov.consecutive_failures} consecutive failure(s) and GH₵${prov.balance.toFixed(
        2
      )} balance.`,
      details: {
        provider: prov,
        healthy_sme_backups: healthySmeBackups.filter((b: any) => b.id !== prov.id).slice(0, 3),
      },
    });
  }

  // 4. Error clusters from system_logs (6h)
  const errorClusters: Record<string, { count: number; sample_message: string; source: string }> = {};
  for (const row of errorLogsRes.data || []) {
    const clusterKey = `${row.source || "system"}:${String(row.event || row.message || "error").slice(0, 60)}`;
    if (!errorClusters[clusterKey]) {
      errorClusters[clusterKey] = {
        count: 0,
        sample_message: String(row.message || row.event || "").slice(0, 220),
        source: String(row.source || "system"),
      };
    }
    errorClusters[clusterKey].count += 1;
  }
  const topErrorClusters = Object.entries(errorClusters)
    .filter(([, v]) => v.count >= 3)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);
  for (const [clusterKey, info] of topErrorClusters) {
    incidents.push({
      id: `err:${slugify(clusterKey)}`,
      incident_type: "provider_error",
      severity: info.count >= 10 ? "high" : "medium",
      title: `Recurring Error (${info.count}x in 6h): ${clusterKey}`,
      summary: info.sample_message || `Repeated error in ${info.source}`,
      details: { cluster_key: clusterKey, ...info },
    });
  }

  // 5. Stuck orders summary (read-only)
  const stuckPending = stuckPendingRes.data || [];
  const stuckProcessing = stuckProcessingRes.data || [];
  if (stuckPending.length > 0 || stuckProcessing.length > 0) {
    const pendingTotal = Number(
      stuckPending.reduce((s: number, o: any) => s + Number(o.amount || 0), 0).toFixed(2)
    );
    const processingTotal = Number(
      stuckProcessing.reduce((s: number, o: any) => s + Number(o.amount || 0), 0).toFixed(2)
    );
    incidents.push({
      id: "stuck_orders:summary",
      incident_type: "stuck_orders",
      severity: stuckProcessing.length >= 5 || processingTotal >= 200 ? "high" : "medium",
      title: `Stuck Orders: ${stuckPending.length} pending, ${stuckProcessing.length} processing`,
      summary: `${stuckPending.length} pending (>5m, GH₵${pendingTotal.toFixed(2)}) and ${
        stuckProcessing.length
      } processing (>10m, GH₵${processingTotal.toFixed(2)}) orders awaiting operator verification.`,
      impact_ghs: Number((pendingTotal + processingTotal).toFixed(2)),
      details: {
        pending_count: stuckPending.length,
        pending_total_ghs: pendingTotal,
        processing_count: stuckProcessing.length,
        processing_total_ghs: processingTotal,
        sample_processing_ids: stuckProcessing.slice(0, 5).map((o: any) => ({
          id: o.id,
          network: o.network,
          provider_id: o.provider_id,
          amount: Number(o.amount || 0),
        })),
      },
    });
  }

  return {
    incidents,
    providers,
    healthy_sme_backups: healthySmeBackups,
    recent_insights: (insightsRes.data || []).slice(0, 10),
    recent_tasks: (existingTasksRes.data || []).slice(0, 20),
    existing_fix_memories: memories
      .filter((m: any) => m.category === "fix_proposal" || String(m.memory_key || "").startsWith("fix_proposal:"))
      .slice(0, 15),
  };
}

function buildFallbackProposals(ctx: Awaited<ReturnType<typeof collectIncidentContext>>): FixProposal[] {
  const proposals: FixProposal[] = [];

  for (const inc of ctx.incidents.slice(0, 6)) {
    if (inc.incident_type === "delivered_twice") {
      const sample = Array.isArray(inc.details?.sample) ? (inc.details.sample as any[]) : [];
      const orderIds = sample.map((s) => String(s?.order_id || "").slice(0, 8)).filter(Boolean);
      proposals.push({
        proposal_key: `fix_proposal:delivered_twice`,
        incident_type: "delivered_twice",
        severity: "critical",
        title: "Prevent & Reconcile Duplicate Bundle Deliveries",
        root_cause:
          "Two fulfilled orders for the same customer phone, network, and bundle size completed within a short window (e.g. concurrent checkout retry or webhook race).",
        impact: `${Number(inc.details?.count || sample.length || 1)} duplicate delivery pair(s) totaling GH₵${Number(
          inc.impact_ghs || 0
        ).toFixed(2)}${orderIds.length ? ` (orders: ${orderIds.join(", ")})` : ""}.`,
        recommended_steps: [
          "Inspect the flagged duplicate order pairs on /admin/reconciliation to verify whether the customer paid twice or was double-dispatched on one payment.",
          "Confirm duplicate-order idempotency guard is active on verify-payment and wallet-buy-data.",
          "Handle any manual wallet adjustment or refund strictly through the 2FA-verified Admin Orders page — never via automated agent debit/credit.",
        ],
        guardrail_note: "Read-only proposal: no wallet debit/credit or order mutation is performed automatically.",
        safe_action: {
          type: "notify_admin",
          priority: "critical",
          title: "Duplicate bundle deliveries detected",
          reason: inc.summary,
          params: {
            topic: "fix_proposer_delivered_twice",
            message: `${inc.summary} Review playbook on /admin/watchdog.`,
          },
        },
      });
      continue;
    }

    if (inc.incident_type === "provider_error" && inc.details?.provider) {
      const prov = inc.details.provider as any;
      const backup = ctx.healthy_sme_backups.find((b: any) => b.id !== prov.id);
      proposals.push({
        proposal_key: `fix_proposal:provider_${slugify(prov.name || prov.id)}`,
        incident_type: "provider_error",
        severity: inc.severity,
        title: backup
          ? `Rebalance SME Traffic from ${prov.name} to ${backup.name}`
          : `Inspect Degraded SME Provider ${prov.name}`,
        root_cause: `${prov.name} reported ${prov.consecutive_failures} consecutive failure(s) and GH₵${Number(
          prov.balance || 0
        ).toFixed(2)} remaining balance.`,
        impact: `SME data orders routed to ${prov.name} risk elevated failures or delays until traffic is shifted or balance is topped up.`,
        recommended_steps: [
          backup
            ? `Approve the queued rebalance_sme_provider task to promote funded non-Korba provider ${backup.name} (GH₵${backup.balance.toFixed(
                2
              )}) to priority 1.`
            : `Top up or investigate ${prov.name} credentials and upstream API health on /admin/providers.`,
          "Verify SME bundles remain strictly excluded from Korba routing.",
        ],
        guardrail_note: "Provider priority change requires 2FA admin approval via ai-task-decide.",
        safe_action: backup
          ? {
              type: "rebalance_sme_provider",
              priority: "high",
              title: `Promote ${backup.name} to priority 1 while ${prov.name} is degraded`,
              reason: `${prov.name} has ${prov.consecutive_failures} consecutive failures (bal GH₵${Number(
                prov.balance || 0
              ).toFixed(2)}). ${backup.name} is active and funded (GH₵${backup.balance.toFixed(2)}).`,
              params: { provider_id: backup.id, new_priority: 1 },
            }
          : {
              type: "notify_admin",
              priority: "high",
              title: `SME provider ${prov.name} degraded with no funded backup`,
              reason: inc.summary,
              params: {
                topic: `fix_proposer_provider_${slugify(prov.name)}`,
                message: `${inc.summary} Top up or switch SME provider on /admin/providers.`,
              },
            },
      });
      continue;
    }

    proposals.push({
      proposal_key: `fix_proposal:${slugify(inc.id)}`,
      incident_type: inc.incident_type,
      severity: inc.severity,
      title: `Investigate & Resolve: ${inc.title}`,
      root_cause: inc.summary,
      impact:
        inc.impact_ghs && inc.impact_ghs > 0
          ? `Estimated financial exposure: GH₵${inc.impact_ghs.toFixed(2)}.`
          : "Operational degradation or alert requiring admin review.",
      recommended_steps: [
        "Inspect full telemetry in /admin/watchdog Reports & Findings.",
        "Apply pricing, provider, or order remediation manually via 2FA-protected admin tools.",
      ],
      guardrail_note: "No automated money movement or order dispatch is executed by AI.",
      safe_action:
        inc.severity === "critical"
          ? {
              type: "notify_admin",
              priority: "high",
              title: inc.title,
              reason: inc.summary,
              params: {
                topic: `fix_proposer_${slugify(inc.incident_type)}`,
                message: `${inc.title}: ${inc.summary}`.slice(0, 260),
              },
            }
          : null,
    });
  }

  return proposals;
}

async function persistFixPlaybook(
  supabaseAdmin: any,
  proposal: FixProposal,
  meta: {
    ai_model: string;
    ai_provider: string;
    action_outcome: { route: string; queued?: boolean; reason?: string; task_type?: string } | null;
  }
): Promise<boolean> {
  const memoryKey = proposal.proposal_key.startsWith("fix_proposal:")
    ? proposal.proposal_key.slice(0, 120)
    : `fix_proposal:${slugify(proposal.proposal_key)}`.slice(0, 120);

  const summary = `[${proposal.severity.toUpperCase()}] ${proposal.title} — ${proposal.root_cause}`.slice(0, 500);
  const nowIso = new Date().toISOString();
  const dataPayload = {
    source: AGENT_NAME,
    proposal_type: "fix_proposal",
    incident_type: proposal.incident_type,
    severity: proposal.severity,
    title: proposal.title,
    root_cause: proposal.root_cause,
    impact: proposal.impact,
    recommended_steps: Array.isArray(proposal.recommended_steps)
      ? proposal.recommended_steps.slice(0, 8)
      : [],
    guardrail_note:
      proposal.guardrail_note ||
      "Safe proposal only: requires human review and 2FA admin approval for any operational change.",
    safe_action: proposal.safe_action || null,
    action_outcome: meta.action_outcome,
    ai_model: meta.ai_model,
    ai_provider: meta.ai_provider,
    generated_at: nowIso,
  };

  try {
    const { data: existing } = await supabaseAdmin
      .from("ai_system_memory")
      .select("id, observations_count")
      .eq("memory_key", memoryKey)
      .maybeSingle();

    const writeWithCategory = async (category: "fix_proposal" | "ops_playbook") => {
      if (existing?.id) {
        return await supabaseAdmin
          .from("ai_system_memory")
          .update({
            category,
            summary,
            data: dataPayload,
            confidence: 0.9,
            observations_count: Number(existing.observations_count || 1) + 1,
            last_observed_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", existing.id);
      }
      return await supabaseAdmin.from("ai_system_memory").insert({
        memory_key: memoryKey,
        category,
        summary,
        data: dataPayload,
        confidence: 0.9,
        observations_count: 1,
        last_observed_at: nowIso,
      });
    };

    const primaryRes = await writeWithCategory("fix_proposal");
    if (primaryRes?.error) {
      // If migration adding 'fix_proposal' to CHECK constraint hasn't been applied yet, fall back safely
      const fallbackRes = await writeWithCategory("ops_playbook");
      if (fallbackRes?.error) {
        console.warn("[ai-fix-proposer] Failed to persist fix playbook:", fallbackRes.error.message);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.warn("[ai-fix-proposer] Exception persisting fix playbook:", err);
    return false;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Missing Supabase environment configuration" }, 500);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Auth: timing-safe SERVICE_ROLE_KEY or CRON_SECRET, OR 2FA-verified admin JWT
  const cronSecret = (Deno.env.get("CRON_SECRET") || "").trim();
  const providedCron = (req.headers.get("x-cron-secret") || "").trim();
  const bearerToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const isServiceRole = Boolean(
    SUPABASE_SERVICE_ROLE_KEY && bearerToken && timingSafeEqual(bearerToken, SUPABASE_SERVICE_ROLE_KEY.trim())
  );
  const isCronAuthed = Boolean(
    isServiceRole ||
      (cronSecret && providedCron && timingSafeEqual(providedCron, cronSecret)) ||
      (cronSecret && bearerToken && timingSafeEqual(bearerToken, cronSecret))
  );

  let isAdminManual = false;
  if (!isCronAuthed) {
    const authRes = await verifyAdmin(req, supabaseAdmin);
    if (!authRes.success) {
      return json({ error: authRes.error || "Unauthorized" }, authRes.status || 401);
    }
    isAdminManual = true;
  }

  try {
    let body: Record<string, any> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const source = String(body?.source || (isAdminManual ? "admin_manual" : "pg_cron"));
    const agentConfig = await getAgentConfig(supabaseAdmin, AGENT_NAME);

    // Honour pause (is_active = false) except for an admin's manual run
    if (shouldSkipRun(agentConfig.is_active, { manual: source === "admin_manual" })) {
      return json({ ok: true, skipped: true, reason: "ai_fix_proposer is paused" });
    }

    const ctx = await collectIncidentContext(supabaseAdmin);

    if (ctx.incidents.length === 0) {
      return json({
        ok: true,
        severity: "HEALTHY",
        headline: "No active reconciliation, margin, provider, or stuck-order incidents require fix proposals.",
        incidents_analyzed: 0,
        playbooks_saved: 0,
        queued_tasks: 0,
        proposals: [],
      });
    }

    const systemPrompt = `You are SwiftData Ghana's AI Fix-Proposer Agent (${AGENT_NAME}).
Your job is to inspect detected operational, financial reconciliation, margin, and provider incidents and produce clear, human-approvable fix playbooks and safe action proposals.

━━━ STRICT SWIFTDATA SAFETY GUARDRAILS ━━━
1. NEVER propose auto-refunding, auto-debiting/crediting wallets, or auto-dispatching/retrying orders.
2. NEVER recommend or promote a Korba provider (is_korba: true) for affordable SME data bundles (MTN, Telecel, AT).
3. Only propose safe_action types from this exact allowlist:
   - Approval-gated (queued in ai_worker_tasks for 2FA admin approval):
     * rebalance_sme_provider: { "provider_id": "uuid", "new_priority": 1 } (ONLY non-Korba active provider with balance >= 100)
     * switch_priority: { "provider_id": "uuid", "new_priority": 1..10 }
     * self_heal_provider: { "provider_id": "uuid" }
     * disable_network: { "network": "MTN|TELECEL|AT" }
     * quarantine_order: { "order_id": "uuid" }
     * relink_order_provider: { "order_id": "uuid", "provider_id": "uuid" }
   - Auto-logged (safe alerts/flags only):
     * notify_admin: { "message": "string", "topic": "short-stable-key" }
     * flag_review: { "user_ids": ["uuid"], "reason": "string", "confidence": 0.8 }
     * flag_aml_review: { "agent_id": "uuid", "pattern": "string", "risk_score": 70, "reason": "string" }
     * record_finding: { "text": "string" }
4. Deduplicate against recent_tasks — do not repeat already-queued proposals.
5. For "delivered_twice" or "refunded_twice" reconciliation issues, explain the exact root cause, impact in GHS, and step-by-step human verification steps; use safe_action=notify_admin (or null) — never invent a refund action.

━━━ OUTPUT JSON SCHEMA (RAW JSON ONLY) ━━━
{
  "severity": "CRITICAL | WARNING | HEALTHY",
  "headline": "Concise 1-line summary (max 140 chars)",
  "proposals": [
    {
      "proposal_key": "fix_proposal:<short_stable_slug>",
      "incident_type": "delivered_twice | refunded_twice | margin_loss | provider_error | stuck_orders | reconciliation | other",
      "severity": "low | medium | high | critical",
      "title": "Clear human-readable fix title",
      "root_cause": "Specific root cause grounded in the incident data",
      "impact": "Financial (GH₵) and operational impact",
      "recommended_steps": ["Step 1...", "Step 2..."],
      "guardrail_note": "Confirmation that no money/order is mutated automatically",
      "safe_action": null
    }
  ]
}`;

    const aiRes = await callAiAgent(
      supabaseAdmin,
      AGENT_NAME,
      systemPrompt,
      `DETECTED INCIDENTS & CONTEXT:\n${JSON.stringify({
        incidents: ctx.incidents,
        providers: ctx.providers,
        healthy_sme_backups: ctx.healthy_sme_backups,
        recent_tasks: ctx.recent_tasks.slice(0, 15),
      })}`,
      2000,
      { responseJson: true }
    );

    const parsed = safeParseJson(aiRes.text);
    const rawProposals: FixProposal[] =
      Array.isArray(parsed.proposals) && parsed.proposals.length > 0
        ? parsed.proposals.slice(0, 8)
        : buildFallbackProposals(ctx);

    // An explicit admin click runs in "propose" mode; scheduled runs follow ai_agent_registry.autonomy_mode
    const effectiveMode: AgentMode =
      source === "admin_manual" ? "propose" : agentConfig.autonomy_mode;

    const queued: any[] = [];
    const ran: any[] = [];
    const recorded: any[] = [];
    const dropped: any[] = [];
    let playbooksSaved = 0;

    for (const raw of rawProposals) {
      if (!raw || !raw.title) continue;
      const proposal: FixProposal = {
        proposal_key: String(raw.proposal_key || `fix_proposal:${slugify(raw.incident_type || raw.title)}`),
        incident_type: String(raw.incident_type || "other"),
        severity: (["low", "medium", "high", "critical"].includes(String(raw.severity))
          ? raw.severity
          : "high") as FixProposal["severity"],
        title: String(raw.title).slice(0, 180),
        root_cause: String(raw.root_cause || "Detected from live watchdog telemetry.").slice(0, 500),
        impact: String(raw.impact || "Requires admin review.").slice(0, 400),
        recommended_steps: Array.isArray(raw.recommended_steps)
          ? raw.recommended_steps.map((s) => String(s).slice(0, 260)).slice(0, 8)
          : ["Review incident details in /admin/watchdog and apply remediation manually."],
        guardrail_note: raw.guardrail_note ? String(raw.guardrail_note).slice(0, 240) : undefined,
        safe_action: raw.safe_action && typeof raw.safe_action === "object" ? (raw.safe_action as AgentAction) : null,
      };

      let actionOutcome: { route: string; queued?: boolean; reason?: string; task_type?: string } | null = null;

      if (proposal.safe_action?.type) {
        const act: AgentAction = {
          type: String(proposal.safe_action.type),
          priority: proposal.safe_action.priority || proposal.severity,
          title: proposal.safe_action.title || proposal.title,
          reason:
            proposal.safe_action.reason ||
            `Root cause: ${proposal.root_cause} | Impact: ${proposal.impact}`,
          params: (proposal.safe_action.params || {}) as Record<string, unknown>,
        };

        // Extra Korba SME guard before routing
        const targetProvId = String((act.params as any)?.provider_id || "");
        const targetProv = targetProvId
          ? ctx.providers.find((p: any) => String(p.id) === targetProvId)
          : null;
        if (targetProv?.is_korba && ["rebalance_sme_provider", "switch_priority", "self_heal_provider"].includes(act.type.toLowerCase())) {
          actionOutcome = { route: "drop", reason: "Korba excluded from SME data routing", task_type: act.type };
          dropped.push({ type: act.type, title: act.title, reason: actionOutcome.reason });
        } else {
          const { route, reason } = routeAgentAction(effectiveMode, act);
          if (route === "run") {
            const r = await runAutoAction(supabaseAdmin, AGENT_NAME, act, { sms: agentSms });
            ran.push({ type: act.type, ...r });
            actionOutcome = { route: "run", task_type: act.type, reason };
          } else if (route === "queue") {
            const q = await queueAgentAction(supabaseAdmin, AGENT_NAME, act);
            if (q.queued) {
              queued.push({ type: act.type, title: act.title });
            } else {
              dropped.push({ type: act.type, title: act.title, reason: q.reason });
            }
            actionOutcome = { route: "queue", queued: q.queued, reason: q.reason, task_type: act.type };
          } else if (route === "record") {
            await runAutoAction(
              supabaseAdmin,
              AGENT_NAME,
              { type: "record_finding", reason: act.reason, params: { would_propose: act } },
              { sms: agentSms }
            );
            recorded.push({ type: act.type, title: act.title });
            actionOutcome = { route: "record", task_type: act.type, reason };
          } else {
            dropped.push({ type: act.type, title: act.title, reason });
            actionOutcome = { route: "drop", task_type: act.type, reason };
          }
        }
      }

      const saved = await persistFixPlaybook(supabaseAdmin, proposal, {
        ai_model: aiRes.model,
        ai_provider: aiRes.provider,
        action_outcome: actionOutcome,
      });
      if (saved) playbooksSaved += 1;
    }

    const severity =
      parsed.severity === "CRITICAL" || parsed.severity === "WARNING" || parsed.severity === "HEALTHY"
        ? parsed.severity
        : ctx.incidents.some((i) => i.severity === "critical")
        ? "CRITICAL"
        : "WARNING";

    const headline = String(
      parsed.headline ||
        `Analyzed ${ctx.incidents.length} incident(s) and generated ${playbooksSaved} fix playbook(s) (${queued.length} task(s) queued for approval).`
    ).slice(0, 200);

    return json({
      ok: true,
      severity,
      headline,
      autonomy_mode: effectiveMode,
      ai_provider: aiRes.provider,
      ai_model: aiRes.model,
      incidents_analyzed: ctx.incidents.length,
      playbooks_saved: playbooksSaved,
      queued_tasks: queued.length,
      queued,
      ran,
      recorded,
      dropped,
      proposals: rawProposals,
    });
  } catch (err: any) {
    console.error("[ai-fix-proposer] Fatal error:", err);
    return json({ error: err?.message || String(err) }, 500);
  }
});
