import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { sendPaymentSms } from "../_shared/sms.ts";
import { callAiAgent } from "../_shared/ai.ts";

declare const Deno: any;

// Cron: runs daily at 07:00 UTC
// Generates an OpenAI-powered 5-line Daily CEO Briefing + morning summary report to all admins

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function timingSafeEqualStr(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function safeParseJson(raw: string): Record<string, any> {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
  } catch (err) {
    console.warn("[cron-daily-report] Failed to parse AI briefing JSON:", err);
  }
  return {};
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing Supabase environment configuration" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const authHeader = req.headers.get("Authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const headerCronSecret = (req.headers.get("x-cron-secret") || "").trim();
  const cronSecret = (Deno.env.get("CRON_SECRET") || "").trim();
  const isCronOrService =
    timingSafeEqualStr(bearerToken, SUPABASE_SERVICE_ROLE_KEY.trim()) ||
    (Boolean(cronSecret) &&
      (timingSafeEqualStr(bearerToken, cronSecret) || timingSafeEqualStr(headerCronSecret, cronSecret)));

  if (!isCronOrService) {
    const adminCheck = await verifyAdmin(req, supabase);
    if (!adminCheck.success) {
      return new Response(JSON.stringify({ error: adminCheck.error || "Unauthorized" }), {
        status: adminCheck.status || 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Time windows (UTC-anchored for deterministic daily reporting)
  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0, 0));
  const yesterdayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 23, 59, 59, 999));

  const thisWeekStart = new Date(yesterdayEnd.getTime() - 7 * 24 * 60 * 60 * 1000 + 1);
  const prevWeekStart = new Date(yesterdayEnd.getTime() - 14 * 24 * 60 * 60 * 1000 + 1);

  const since = yesterday.toISOString();
  const until = yesterdayEnd.toISOString();
  const dateLabel = yesterday.toLocaleDateString("en-GH", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  // Fetch yesterday's orders, 14-day reseller history, withdrawals, new agents, and providers in parallel
  const [
    ordersRes,
    twoWeekOrdersRes,
    withdrawalsRes,
    newAgentsRes,
    providersRes,
  ] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, status, amount, profit, parent_profit, cost_price, order_type, network, payment_method, auto_refunded, refund_amount, agent_id, provider_id, failure_reason"
      )
      .gte("created_at", since)
      .lte("created_at", until),
    supabase
      .from("orders")
      .select("agent_id, amount, status, order_type, created_at")
      .eq("status", "fulfilled")
      .neq("agent_id", ZERO_UUID)
      .gte("created_at", prevWeekStart.toISOString())
      .lte("created_at", until)
      .limit(10000),
    supabase
      .from("withdrawals")
      .select("amount, status")
      .gte("created_at", since)
      .lte("created_at", until),
    supabase
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("is_agent", true)
      .gte("created_at", since)
      .lte("created_at", until),
    supabase
      .from("providers")
      .select("id, name, handler_type, balance, is_active, balance_alert_threshold"),
  ]);

  const orders = ordersRes.data;
  if (!orders) {
    console.log("[cron-daily-report] No orders data found");
    return new Response(JSON.stringify({ sent: false }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const fulfilled = orders.filter((o: any) => o.status === "fulfilled");
  const failed = orders.filter((o: any) => o.status === "fulfillment_failed");
  const processing = orders.filter((o: any) => o.status === "processing");
  const refunded = orders.filter((o: any) => o.auto_refunded);

  const totalRevenue = round2(fulfilled.reduce((s: number, o: any) => s + Number(o.amount || 0), 0));
  const totalProfit = round2(
    fulfilled.reduce((s: number, o: any) => s + Number(o.profit || 0) + Number(o.parent_profit || 0), 0)
  );
  const totalCost = round2(fulfilled.reduce((s: number, o: any) => s + Number(o.cost_price || 0), 0));
  const totalRefunded = round2(refunded.reduce((s: number, o: any) => s + Number(o.refund_amount || 0), 0));
  const failedGrossAmount = round2(failed.reduce((s: number, o: any) => s + Number(o.amount || 0), 0));
  const unrefundedFailedAmount = round2(
    failed
      .filter((o: any) => !o.auto_refunded)
      .reduce((s: number, o: any) => s + Number(o.amount || 0), 0)
  );
  const netProfit = round2(totalProfit);

  // Failure reason breakdown
  const failureReasonCounts = new Map<string, number>();
  for (const o of failed) {
    const reason = String(o.failure_reason || "Unknown error").slice(0, 80);
    failureReasonCounts.set(reason, (failureReasonCounts.get(reason) || 0) + 1);
  }
  const topFailureReasons = Array.from(failureReasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => ({ reason, count }));

  // Provider map & provider success rates
  const allProviders = providersRes.data || [];
  const providerNameById = new Map<string, string>();
  for (const p of allProviders) {
    if (p?.id) providerNameById.set(String(p.id), String(p.name || p.id));
  }

  const providerStatsMap = new Map<string, { name: string; total: number; fulfilled: number; failed: number }>();
  for (const o of orders) {
    if (!o.provider_id) continue;
    const pid = String(o.provider_id);
    const name = providerNameById.get(pid) || pid.slice(0, 8);
    const cur = providerStatsMap.get(pid) || { name, total: 0, fulfilled: 0, failed: 0 };
    cur.total += 1;
    if (o.status === "fulfilled") cur.fulfilled += 1;
    if (o.status === "fulfillment_failed") cur.failed += 1;
    providerStatsMap.set(pid, cur);
  }
  const providerSuccessRates = Array.from(providerStatsMap.values())
    .map((p) => ({
      provider: p.name,
      total: p.total,
      fulfilled: p.fulfilled,
      failed: p.failed,
      success_rate_pct: p.total > 0 ? round2((p.fulfilled / p.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // Top agents yesterday (by fulfilled revenue)
  const agentYesterdayMap = new Map<string, { orders: number; revenue: number; profit: number }>();
  for (const o of fulfilled) {
    const aid = String(o.agent_id || "");
    if (!aid || aid === ZERO_UUID) continue;
    const cur = agentYesterdayMap.get(aid) || { orders: 0, revenue: 0, profit: 0 };
    cur.orders += 1;
    cur.revenue += Number(o.amount || 0);
    cur.profit += Number(o.profit || 0) + Number(o.parent_profit || 0);
    agentYesterdayMap.set(aid, cur);
  }

  // Weekly reseller churn-risk detection (>40% drop vs previous 7 days)
  const thisWeekCutoffMs = thisWeekStart.getTime();
  const weeklyAgentMap = new Map<
    string,
    { prevRev: number; thisRev: number; prevOrders: number; thisOrders: number }
  >();
  for (const o of twoWeekOrdersRes.data || []) {
    const aid = String(o.agent_id || "");
    if (!aid || aid === ZERO_UUID) continue;
    const ts = new Date(o.created_at).getTime();
    const cur = weeklyAgentMap.get(aid) || { prevRev: 0, thisRev: 0, prevOrders: 0, thisOrders: 0 };
    if (ts >= thisWeekCutoffMs) {
      cur.thisRev += Number(o.amount || 0);
      cur.thisOrders += 1;
    } else {
      cur.prevRev += Number(o.amount || 0);
      cur.prevOrders += 1;
    }
    weeklyAgentMap.set(aid, cur);
  }

  const rawChurnCandidates = Array.from(weeklyAgentMap.entries())
    .map(([agent_id, s]) => {
      const dropPct = s.prevRev > 0 ? ((s.prevRev - s.thisRev) / s.prevRev) * 100 : 0;
      return {
        agent_id,
        prev_week_ghs: round2(s.prevRev),
        this_week_ghs: round2(s.thisRev),
        prev_week_orders: s.prevOrders,
        this_week_orders: s.thisOrders,
        drop_pct: round2(dropPct),
        ghs_drop: round2(s.prevRev - s.thisRev),
      };
    })
    .filter((c) => (c.prev_week_ghs >= 30 || c.prev_week_orders >= 3) && c.drop_pct > 40)
    .sort((a, b) => b.ghs_drop - a.ghs_drop)
    .slice(0, 5);

  const rawTopAgents = Array.from(agentYesterdayMap.entries())
    .map(([agent_id, s]) => ({
      agent_id,
      orders: s.orders,
      revenue_ghs: round2(s.revenue),
      profit_ghs: round2(s.profit),
    }))
    .sort((a, b) => b.revenue_ghs - a.revenue_ghs)
    .slice(0, 5);

  // Resolve agent names & phones in one query
  const relevantAgentIds = Array.from(
    new Set([...rawTopAgents.map((a) => a.agent_id), ...rawChurnCandidates.map((c) => c.agent_id)])
  );
  const profileMap = new Map<string, { name: string; store_name: string; phone: string }>();
  if (relevantAgentIds.length > 0) {
    const { data: agentProfiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, store_name, phone")
      .in("user_id", relevantAgentIds);

    for (const p of agentProfiles || []) {
      const displayName = (p.store_name || p.full_name || "Reseller").trim();
      profileMap.set(String(p.user_id), {
        name: displayName,
        store_name: p.store_name || "",
        phone: p.phone || "",
      });
    }
  }

  const topAgents = rawTopAgents.map((a) => ({
    ...a,
    name: profileMap.get(a.agent_id)?.name || `Agent ${a.agent_id.slice(0, 6)}`,
  }));

  const churnRiskResellers = rawChurnCandidates.map((c) => ({
    ...c,
    name: profileMap.get(c.agent_id)?.name || `Reseller ${c.agent_id.slice(0, 6)}`,
    phone: profileMap.get(c.agent_id)?.phone || null,
  }));

  // Withdrawals & low-balance providers
  const withdrawals = withdrawalsRes.data || [];
  const approvedWithdrawals = withdrawals.filter((w: any) => w.status === "approved");
  const totalWithdrawn = round2(approvedWithdrawals.reduce((s: number, w: any) => s + Number(w.amount || 0), 0));
  const pendingWithdrawals = withdrawals.filter((w: any) => w.status === "pending").length;
  const newAgents = newAgentsRes.count || 0;

  const activeProviders = allProviders.filter((p: any) => p.is_active);
  const lowBalanceProviders = activeProviders.filter(
    (p: any) => p.balance !== null && Number(p.balance) < Number(p.balance_alert_threshold || 500)
  );

  const failedOrderLeakage = {
    failed_count: failed.length,
    failed_gross_ghs: failedGrossAmount,
    auto_refunded_ghs: totalRefunded,
    unrefunded_leakage_ghs: unrefundedFailedAmount,
    top_reasons: topFailureReasons,
  };

  // Build structured report summary
  const report = {
    date: dateLabel,
    orders: { total: orders.length, fulfilled: fulfilled.length, failed: failed.length, processing: processing.length },
    revenue: { total: totalRevenue, profit: totalProfit, net_profit: netProfit, cost: totalCost, refunded: totalRefunded },
    withdrawals: { approved: approvedWithdrawals.length, total_paid: totalWithdrawn, pending: pendingWithdrawals },
    agents: { new_today: newAgents, top_agents: topAgents, churn_risk_count: churnRiskResellers.length },
    providers: {
      success_rates: providerSuccessRates,
      low_balance: lowBalanceProviders.map((p: any) => `${p.name}: GHS ${Number(p.balance || 0).toFixed(2)}`),
    },
    failed_order_leakage: failedOrderLeakage,
    churn_risk_resellers: churnRiskResellers,
  };

  // Generate OpenAI 5-line Daily CEO Briefing + Personalized Winback Suggestions via callAiAgent
  const systemPrompt = `You are the Chief of Staff AI for SwiftData Ghana (a telecom SME data & utility distribution platform).
Return ONLY valid JSON with this exact shape:
{
  "briefing_lines": [
    "Line 1: Net profit & revenue summary with concrete GHS figures",
    "Line 2: Top agents performance summary",
    "Line 3: Provider success rates & low-balance warnings (never recommend Korba for SME data bundles)",
    "Line 4: Failed-order leakage, refunds, and primary failure cause",
    "Line 5: Churn-risk resellers (>40% weekly drop) & immediate winback focus"
  ],
  "winback_suggestions": [
    {
      "agent_name": "Reseller Name",
      "drop_pct": 55,
      "suggestion": "Short, personalized Ghanaian WhatsApp/SMS winback offer (1 sentence)"
    }
  ]
}
Rules:
- "briefing_lines" MUST have EXACTLY 5 concise lines (max 140 chars each, SMS-friendly, no markdown asterisks).
- Use GHS for currency.
- Never suggest routing MTN/Telecel/AirtelTigo SME data bundles to Korba.
- If no churn-risk resellers exist, say so on Line 5 and return an empty winback_suggestions array.`;

  const userPrompt = `Yesterday (${dateLabel}) SwiftData metrics JSON:\n${JSON.stringify(report)}`;

  const aiResult = await callAiAgent(supabase, "ops_worker", systemPrompt, userPrompt, 750, {
    responseJson: true,
  });

  const parsedAi = safeParseJson(aiResult.text);
  const aiLines: string[] = Array.isArray(parsedAi.briefing_lines)
    ? parsedAi.briefing_lines.map((l: any) => String(l || "").trim()).filter(Boolean).slice(0, 5)
    : [];

  // Deterministic 5-line fallback if AI returned fewer than 5 lines (e.g. heuristic fallback)
  const topAgentText = topAgents.length
    ? topAgents.slice(0, 2).map((a) => `${a.name} (GHS ${a.revenue_ghs.toFixed(0)})`).join(", ")
    : "No agent sales recorded";
  const topProvText = providerSuccessRates.length
    ? providerSuccessRates.slice(0, 2).map((p) => `${p.provider} ${p.success_rate_pct}%`).join(", ")
    : "No provider traffic";
  const churnText = churnRiskResellers.length
    ? `${churnRiskResellers.length} reseller(s) down >40% wk/wk (top: ${churnRiskResellers[0].name} -${churnRiskResellers[0].drop_pct}%)`
    : "0 resellers flagged for >40% weekly drop";

  const fallbackLines = [
    `1. Profit: GHS ${netProfit.toFixed(2)} net profit on GHS ${totalRevenue.toFixed(2)} rev (${fulfilled.length}/${orders.length} fulfilled).`,
    `2. Top Agents: ${topAgentText}. New agents: ${newAgents}.`,
    `3. Providers: ${topProvText}.${lowBalanceProviders.length ? ` Low bal: ${lowBalanceProviders.map((p: any) => p.name).join(", ")}.` : ""}`,
    `4. Leakage: ${failed.length} failed (GHS ${failedGrossAmount.toFixed(2)}), GHS ${totalRefunded.toFixed(2)} refunded, GHS ${unrefundedFailedAmount.toFixed(2)} unrefunded.`,
    `5. Churn Risk: ${churnText}.`,
  ];

  const briefingLines = aiLines.length === 5 ? aiLines : fallbackLines;
  const winbackSuggestions = Array.isArray(parsedAi.winback_suggestions)
    ? parsedAi.winback_suggestions.slice(0, 5)
    : churnRiskResellers.map((c) => ({
        agent_name: c.name,
        drop_pct: c.drop_pct,
        suggestion: `Check in with ${c.name} (down ${c.drop_pct}% from GHS ${c.prev_week_ghs}) via WhatsApp and offer a temporary 1% restock bonus.`,
      }));

  const ceoBriefingText = briefingLines.join("\n");

  // Store the Daily CEO Briefing in ai_insights
  try {
    await supabase.from("ai_insights").insert({
      agent_id: null,
      type: "daily_ceo_briefing",
      insight_text: ceoBriefingText,
      metadata: {
        date: dateLabel,
        ai_provider: aiResult.provider,
        ai_model: aiResult.model,
        briefing_lines: briefingLines,
        winback_suggestions: winbackSuggestions,
        top_agents: topAgents,
        provider_success_rates: providerSuccessRates,
        failed_order_leakage: failedOrderLeakage,
        churn_risk_resellers: churnRiskResellers,
        report,
      },
    });
  } catch (err) {
    console.error("[cron-daily-report] Failed to save Daily CEO Briefing to ai_insights:", err);
  }

  // Log the report to system_logs
  try {
    await supabase.from("system_logs").insert({
      level: "info",
      source: "cron-daily-report",
      event: "report.daily",
      message: `Daily CEO Briefing for ${dateLabel}: ${fulfilled.length} fulfilled, GHS ${totalRevenue.toFixed(2)} rev, GHS ${netProfit.toFixed(2)} profit`,
      data: {
        ...report,
        ceo_briefing: briefingLines,
        winback_suggestions: winbackSuggestions,
        ai_model: aiResult.model,
      },
    });
  } catch (err) {
    console.error("[cron-daily-report] Failed to log to system_logs:", err);
  }

  // Build concise admin SMS digest
  const smsLines = [
    `📊 SwiftData Daily CEO Briefing — ${dateLabel}`,
    ...briefingLines,
    winbackSuggestions.length > 0
      ? `Winback: ${winbackSuggestions[0].agent_name} — ${String(winbackSuggestions[0].suggestion || "").slice(0, 120)}`
      : null,
    pendingWithdrawals > 0 ? `Withdrawals: GHS ${totalWithdrawn.toFixed(2)} paid | ${pendingWithdrawals} pending` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Notify all admins (in-app notification + SMS)
  const { data: admins } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
  if (admins?.length) {
    try {
      await supabase.from("user_notifications").insert(
        admins.map((a: any) => ({
          user_id: a.user_id,
          title: `📊 Daily CEO Briefing — ${dateLabel}`,
          message: ceoBriefingText.slice(0, 600),
          type: "info",
          link: "/admin/analytics",
          data: {
            ...report,
            ceo_briefing: briefingLines,
            winback_suggestions: winbackSuggestions,
            ai_model: aiResult.model,
            link: "/admin/analytics",
          },
        }))
      );
    } catch (err) {
      console.error("[cron-daily-report] Failed to insert admin notifications:", err);
    }

    const adminIds = admins.map((a: any) => a.user_id);
    const { data: adminProfiles } = await supabase
      .from("profiles")
      .select("phone")
      .in("user_id", adminIds)
      .not("phone", "is", null);

    for (const profile of adminProfiles || []) {
      if (!profile.phone) continue;
      try {
        await sendPaymentSms(supabase, profile.phone, "custom" as any, { message: smsLines });
      } catch {
        // ignore individual SMS failure
      }
    }
  }

  return new Response(
    JSON.stringify({
      sent: true,
      date: dateLabel,
      ai_provider: aiResult.provider,
      ai_model: aiResult.model,
      ceo_briefing: briefingLines,
      winback_suggestions: winbackSuggestions,
      report,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
