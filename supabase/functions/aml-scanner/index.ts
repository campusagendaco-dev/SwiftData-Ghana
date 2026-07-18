/**
 * AML SCANNER — Anti-Money Laundering & Financial Crime Detection
 * Runs every 10 minutes via pg_cron.
 *
 * Detects financial crime patterns invisible to normal fraud checks:
 *  • Structuring   — many small transactions to avoid thresholds
 *  • Rapid cashout — large outflows immediately after top-up
 *  • Volume spike  — agent volume suddenly 10× their own 7-day baseline
 *  • Circular flow — funds deposited then immediately cashed out (wash)
 *  • Smurfing      — many low-value orders across coordinated accounts
 *
 * All findings are written to `aml_alerts` + `sentinel_actions`.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getSmsConfig, sendSmsViaTxtConnect } from "../_shared/sms.ts";
import { callAiAgent } from "../_shared/ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const db = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    console.log("💰 AML Scanner: Initiating financial crime pattern analysis...");

    // ── Admin contact ──────────────────────────────────────────────────────────
    const { data: admins } = await db.from("profiles").select("phone").eq("role", "admin").limit(1);
    const adminPhone = admins?.[0]?.phone ?? null;

    const notifyAdmin = async (msg: string) => {
      if (!adminPhone) return;
      try {
        const { apiKey, senderId } = await getSmsConfig(db);
        if (apiKey) await sendSmsViaTxtConnect(apiKey, senderId, adminPhone, `[AML Scanner] ${msg}`);
      } catch { /* non-critical */ }
    };

    const now = Date.now();
    const ago30m  = new Date(now - 30  * 60 * 1000).toISOString();
    const ago24h  = new Date(now - 24  * 60 * 60 * 1000).toISOString();
    const ago7d   = new Date(now -  7  * 24 * 60 * 60 * 1000).toISOString();

    // ── 1. Fetch recent orders (30 min window for hot analysis) ───────────────
    const [recentRes, historicRes] = await Promise.all([
      db.from("orders")
        .select("id,agent_id,amount,status,order_type,network,created_at")
        .gte("created_at", ago30m)
        .limit(5000),
      db.from("orders")
        .select("agent_id,amount,status")
        .gte("created_at", ago7d)
        .lt("created_at", ago30m)
        .limit(20000),
    ]);

    const recent   = (recentRes.data  ?? []) as { id:string; agent_id:string; amount:string; status:string; order_type:string; network:string; created_at:string }[];
    const historic = (historicRes.data ?? []) as { agent_id:string; amount:string; status:string }[];

    // ── 2. Build per-agent metrics ─────────────────────────────────────────────
    type AgentMetrics = {
      total_volume_30m:  number;
      cashout_volume_30m: number;
      data_volume_30m:   number;
      order_count_30m:   number;
      micro_count_30m:   number;   // orders < 10 GHS
      failed_count_30m:  number;
      historic_volume:   number;
      historic_orders:   number;
    };

    const metrics = new Map<string, AgentMetrics>();

    const get = (id: string): AgentMetrics => {
      if (!metrics.has(id)) metrics.set(id, { total_volume_30m: 0, cashout_volume_30m: 0, data_volume_30m: 0, order_count_30m: 0, micro_count_30m: 0, failed_count_30m: 0, historic_volume: 0, historic_orders: 0 });
      return metrics.get(id)!;
    };

    recent.forEach(o => {
      const m = get(o.agent_id);
      const amt = Number(o.amount ?? 0);
      m.total_volume_30m  += amt;
      m.order_count_30m   += 1;
      if (amt < 10) m.micro_count_30m += 1;
      if (o.status === "failed" || o.status === "fulfillment_failed") m.failed_count_30m += 1;
      if (o.order_type === "cashout" || o.order_type === "wallet_transfer") m.cashout_volume_30m += amt;
      else m.data_volume_30m += amt;
    });

    historic.forEach(o => {
      const m = get(o.agent_id);
      m.historic_volume += Number(o.amount ?? 0);
      m.historic_orders += 1;
    });

    // ── 3. Flag suspicious agents ──────────────────────────────────────────────
    type Flag = {
      agent_id: string;
      flags: string[];
      risk_score: number;
      volume_30m: number;
      cashout_30m: number;
      micro_orders: number;
      volume_spike_ratio: number;
    };

    const flagged: Flag[] = [];

    metrics.forEach((m, agent_id) => {
      const flags: string[] = [];
      let risk = 0;

      // Structuring: many micro-orders
      if (m.micro_count_30m >= 8) { flags.push("STRUCTURING"); risk += 35; }

      // Rapid cashout: >2000 GHS out in 30 min
      if (m.cashout_volume_30m > 2000) { flags.push("RAPID_CASHOUT"); risk += 40; }

      // Volume spike: current 30m pace is 10× 7-day daily average
      const dailyAvg = m.historic_volume / 7;
      const pace30mAs24h = m.total_volume_30m * 48; // project 30min to 24h
      const spikeRatio = dailyAvg > 0 ? pace30mAs24h / dailyAvg : 0;
      if (spikeRatio >= 10) { flags.push("VOLUME_SPIKE_10X"); risk += 30; }

      // Circular flow: cashout ≥ 80% of total inflow
      if (m.total_volume_30m > 500 && m.cashout_volume_30m / m.total_volume_30m >= 0.8) {
        flags.push("CIRCULAR_FLOW"); risk += 25;
      }

      // Smurfing: high order count, all tiny amounts
      if (m.order_count_30m >= 15 && m.total_volume_30m / m.order_count_30m < 15) {
        flags.push("SMURFING"); risk += 20;
      }

      if (flags.length > 0) {
        flagged.push({
          agent_id, flags, risk_score: Math.min(risk, 100),
          volume_30m: m.total_volume_30m,
          cashout_30m: m.cashout_volume_30m,
          micro_orders: m.micro_count_30m,
          volume_spike_ratio: Math.round(spikeRatio),
        });
      }
    });

    flagged.sort((a, b) => b.risk_score - a.risk_score);

    if (flagged.length === 0) {
      console.log("AML Scanner: No suspicious financial patterns in the last 30 minutes.");
      return new Response(JSON.stringify({ success: true, message: "No AML signals detected." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 4. Enrich with profile info ────────────────────────────────────────────
    const { data: profileRows } = await db.from("profiles")
      .select("user_id,full_name,phone,terminal_locked,is_suspended,role")
      .in("user_id", flagged.map(f => f.agent_id));

    const profileMap = new Map((profileRows ?? []).map(p => [p.user_id, p]));

    const enriched = flagged.map(f => ({
      ...f,
      full_name: profileMap.get(f.agent_id)?.full_name ?? "Unknown",
      phone: profileMap.get(f.agent_id)?.phone ?? null,
      already_suspended: profileMap.get(f.agent_id)?.is_suspended ?? false,
      is_admin: profileMap.get(f.agent_id)?.role === "admin",
    })).filter(f => !f.is_admin);

    // ── 5. AI assessment ───────────────────────────────────────────────────────
    const systemPrompt = `
You are the AML SCANNER — Anti-Money Laundering AI for SwiftData Ghana, a mobile data reseller platform.
You analyse suspicious financial patterns and decide on enforcement actions.

━━━ AML FLAG DEFINITIONS ━━━
STRUCTURING    : Breaking payments into micro-amounts (<10 GHS) to stay below detection thresholds.
RAPID_CASHOUT  : Cashing out >2000 GHS within 30 minutes — money laundering red flag.
VOLUME_SPIKE   : Agent volume suddenly 10× their own historical baseline — possible account takeover.
CIRCULAR_FLOW  : ≥80% of funds deposited then immediately withdrawn — wash trading.
SMURFING       : High order count with very low average amount — value fragmentation.

━━━ AVAILABLE ACTIONS ━━━
- lock_terminal      : { "agent_id": "uuid", "reason": "string" }
- flag_aml_review    : { "agent_id": "uuid", "pattern": "string", "risk_score": 0-100 }
- freeze_cashouts    : { "agent_id": "uuid", "reason": "string" }
- notify_admin       : { "message": "string" }

━━━ DECISION THRESHOLDS ━━━
risk_score ≥ 80   → lock_terminal + notify_admin (CRITICAL)
risk_score 50–79  → freeze_cashouts + flag_aml_review (HIGH)
risk_score < 50   → flag_aml_review only (MEDIUM)
Never act on admins. Never act on already_suspended agents.

━━━ OUTPUT ━━━
RAW JSON only. No markdown.
{"aml_level":"CRITICAL|HIGH|MEDIUM","summary":"string","actions":[{"type":"string","params":{}}]}
`.trim();

    const aiResult = await callAiAgent(
      db,
      "aml_scanner",
      systemPrompt,
      JSON.stringify(enriched.slice(0, 15)),
      1200
    );

    const rawText = aiResult.text;
    const jStart = rawText.indexOf("{");
    const jEnd   = rawText.lastIndexOf("}");
    const parsed = JSON.parse(rawText.slice(jStart, jEnd + 1));
    const { aml_level = "MEDIUM", summary = "", actions = [] } = parsed;

    // ── 6. Execute actions ─────────────────────────────────────────────────────
    const executed: any[] = [];

    for (const action of actions) {
      const p = action.params ?? {};
      try {
        if (action.type === "lock_terminal" && p.agent_id) {
          const f = enriched.find(e => e.agent_id === p.agent_id);
          if (f && !f.already_suspended) {
            await db.from("profiles").update({ terminal_locked: true }).eq("user_id", p.agent_id);
            await db.from("fraud_risk_logs").insert({
              agent_id: p.agent_id,
              risk_score: f.risk_score,
              risk_factors: f.flags,
              action_taken: "aml_terminal_lock",
            });
          }
        }

        if (action.type === "flag_aml_review" && p.agent_id) {
          await db.from("aml_alerts").insert({
            agent_id: p.agent_id,
            alert_type: p.pattern ?? "GENERAL",
            risk_score: p.risk_score ?? 50,
            pattern_description: summary,
            action_taken: "flagged_for_review",
          });
        }

        if (action.type === "freeze_cashouts" && p.agent_id) {
          await db.from("aml_alerts").insert({
            agent_id: p.agent_id,
            alert_type: "CASHOUT_FREEZE",
            risk_score: 70,
            pattern_description: p.reason ?? summary,
            action_taken: "cashouts_frozen",
          });
        }

        if (action.type === "notify_admin") {
          await notifyAdmin(p.message ?? `AML ${aml_level}: ${summary}`);
        }

        const { data: log } = await db.from("sentinel_actions").insert({
          action_type: action.type,
          status: "executed",
          effectiveness: 1,
          reasoning: p.reason ?? summary,
          metadata: { ...p, source: "aml_scanner", aml_level },
        }).select().single();

        if (log) executed.push(log);
      } catch (err: any) {
        console.error(`AML Scanner execution failed [${action.type}]:`, err.message);
      }
    }

    // Scan summary log (always written so the dashboard shows activity)
    await db.from("sentinel_actions").insert({
      action_type: "aml_scan",
      status: "executed",
      effectiveness: 0,
      reasoning: summary || `AML Scanner: ${flagged.length} flagged agents, level ${aml_level}`,
      metadata: { source: "aml_scanner", aml_level, flagged_count: flagged.length },
    });

    if (aml_level === "CRITICAL") {
      await notifyAdmin(`CRITICAL AML: ${executed.length} enforcement actions. ${summary}`);
    }

    return new Response(JSON.stringify({ success: true, aml_level, flagged: flagged.length, actions_taken: executed.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("AML Scanner Critical Failure:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
