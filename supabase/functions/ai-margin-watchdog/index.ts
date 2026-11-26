/**
 * AI MARGIN WATCHDOG — Daily Wholesale vs Retail/Agent Margin Protection Auditor
 *
 * Compares active non-Korba SME provider wholesale costs (`provider_packages`)
 * against `global_package_settings` (agent, sub-agent, API, public prices) and
 * per-agent custom pricing tables (`profiles.agent_prices` / `sub_agent_prices`).
 *
 * Flags any bundle selling at a loss (< 0% margin) or razor-thin margin (< 2%),
 * uses `callAiAgent` (`ops_worker`) to produce a prioritized margin protection report,
 * logs to `ai_insights` and `sentinel_actions`, and alerts admins via SMS if any
 * loss-making bundle is detected.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { timingSafeEqual } from "../_shared/gateway-security.ts";
import { sendPaymentSms } from "../_shared/sms.ts";
import { isComboPackage, normalizeNetwork, normalizeSize } from "../_shared/margin_match.ts";
import { callAiAgent } from "../_shared/ai.ts";
import { queueAgentAction } from "../_shared/agent_actions.ts";

declare const Deno: any;

const RAZOR_THIN_MARGIN_PCT = 2.0;

interface MarginFinding {
  scope: "global_package_settings" | "agent_pricing";
  severity: "LOSS" | "RAZOR_THIN";
  network: string;
  package_size: string;
  tier: string;
  wholesale_cost: number;
  wholesale_source: string;
  sell_price: number;
  margin_ghs: number;
  margin_pct: number;
  agent_id?: string;
  agent_name?: string;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isKorbaProvider(p: any): boolean {
  const ht = String(p?.handler_type || "").toLowerCase();
  const name = String(p?.name || "").toLowerCase();
  return ht.includes("korba") || name.includes("korba");
}

function bundleKey(network: string, size: string): string {
  return `${normalizeNetwork(network)}::${normalizeSize(size)}`;
}

function safeParseJson(raw: string): Record<string, any> {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
  } catch (err) {
    console.warn("[ai-margin-watchdog] Failed to parse AI JSON:", err);
  }
  return {};
}

/**
 * Parses custom agent pricing JSONB objects which may be either:
 * - flat:   { "MTN_1GB": 5.5, "TELECEL:5GB": 22 }
 * - nested: { "MTN": { "1GB": 5.5, "5GB": 24 } }
 */
function extractAgentPriceEntries(
  rawObj: unknown
): Array<{ network: string; package_size: string; price: number }> {
  const entries: Array<{ network: string; package_size: string; price: number }> = [];
  if (!rawObj || typeof rawObj !== "object" || Array.isArray(rawObj)) return entries;

  for (const [k, v] of Object.entries(rawObj as Record<string, any>)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const net = normalizeNetwork(k);
      if (!net) continue;
      for (const [sizeKey, priceVal] of Object.entries(v as Record<string, any>)) {
        const num = Number(priceVal);
        const size = normalizeSize(sizeKey);
        if (size && Number.isFinite(num) && num > 0) {
          entries.push({ network: net, package_size: size, price: num });
        }
      }
      continue;
    }

    const num = Number(v);
    if (!Number.isFinite(num) || num <= 0) continue;
    const match = k.trim().match(/^([A-Za-z0-9_]+?)[\s:_-]+(\d+(?:\.\d+)?\s*(?:GB|MB))$/i);
    if (match) {
      const net = normalizeNetwork(match[1]);
      const size = normalizeSize(match[2]);
      if (net && size) {
        entries.push({ network: net, package_size: size, price: num });
      }
    }
  }

  return entries;
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

  // Auth: timing-safe CRON_SECRET or SUPABASE_SERVICE_ROLE_KEY, OR verifyAdmin
  const authHeader = req.headers.get("Authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const headerCronSecret = (req.headers.get("x-cron-secret") || "").trim();
  const cronSecret = (Deno.env.get("CRON_SECRET") || "").trim();

  const isCronOrService =
    (Boolean(bearerToken) && timingSafeEqual(bearerToken, SUPABASE_SERVICE_ROLE_KEY.trim())) ||
    (Boolean(cronSecret) &&
      ((Boolean(bearerToken) && timingSafeEqual(bearerToken, cronSecret)) ||
        (Boolean(headerCronSecret) && timingSafeEqual(headerCronSecret, cronSecret))));

  if (!isCronOrService) {
    const adminCheck = await verifyAdmin(req, supabase);
    if (!adminCheck.success) {
      return new Response(JSON.stringify({ error: adminCheck.error || "Unauthorized" }), {
        status: adminCheck.status || 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Fetch providers, provider wholesale packages, global package settings, and custom agent pricing in parallel
  const [providersRes, providerPackagesRes, globalPackagesRes, agentProfilesRes] = await Promise.all([
    supabase
      .from("providers")
      .select("id, name, handler_type, is_active, priority, balance")
      .eq("is_active", true)
      .order("priority", { ascending: true }),
    supabase
      .from("provider_packages")
      .select("provider_id, network, package_name, capacity_gb, cost_price, is_active")
      .eq("is_active", true),
    supabase
      .from("global_package_settings")
      .select("id, network, package_size, cost_price, agent_price, sub_agent_price, api_price, public_price, is_unavailable")
      .eq("is_unavailable", false),
    supabase
      .from("profiles")
      .select("user_id, full_name, store_name, agent_prices, sub_agent_prices")
      .eq("is_agent", true)
      .limit(2000),
  ]);

  // SwiftData rule: SME data bundles MUST NEVER be routed to Korba — exclude Korba from SME wholesale cost comparison
  const smeProviders = (providersRes.data || []).filter((p: any) => !isKorbaProvider(p));
  const smeProviderMap = new Map<string, { id: string; name: string; priority: number; balance: number }>();
  for (const p of smeProviders) {
    smeProviderMap.set(String(p.id), {
      id: String(p.id),
      name: String(p.name || p.id),
      priority: Number(p.priority ?? 999),
      balance: Number(p.balance ?? 0),
    });
  }

  // Build wholesale cost index per (network, package_size) from active non-Korba providers
  const wholesaleIndex = new Map<
    string,
    {
      primaryCost: number;
      primaryProvider: string;
      primaryProviderId: string;
      primaryPriority: number;
      cheapestCost: number;
      cheapestProvider: string;
      cheapestProviderId: string;
      cheapestBalance: number;
      maxCost: number;
      maxProvider: string;
    }
  >();

  for (const pkg of providerPackagesRes.data || []) {
    const prov = smeProviderMap.get(String(pkg.provider_id));
    if (!prov) continue; // skip inactive or Korba providers
    const cost = Number(pkg.cost_price || 0);
    if (!Number.isFinite(cost) || cost <= 0) continue;

    // Data + minutes combos / Mash Up bundles never set the cost of plain data
    if (isComboPackage(pkg.package_name)) continue;
    const net = normalizeNetwork(pkg.network);
    const size = normalizeSize(pkg.package_name, pkg.capacity_gb);
    if (!net || !size) continue;
    const key = `${net}::${size}`;

    const existing = wholesaleIndex.get(key);
    if (!existing) {
      wholesaleIndex.set(key, {
        primaryCost: cost,
        primaryProvider: prov.name,
        primaryProviderId: prov.id,
        primaryPriority: prov.priority,
        cheapestCost: cost,
        cheapestProvider: prov.name,
        cheapestProviderId: prov.id,
        cheapestBalance: prov.balance,
        maxCost: cost,
        maxProvider: prov.name,
      });
    } else {
      if (prov.priority < existing.primaryPriority) {
        existing.primaryCost = cost;
        existing.primaryProvider = prov.name;
        existing.primaryProviderId = prov.id;
        existing.primaryPriority = prov.priority;
      }
      if (cost < existing.cheapestCost) {
        existing.cheapestCost = cost;
        existing.cheapestProvider = prov.name;
        existing.cheapestProviderId = prov.id;
        existing.cheapestBalance = prov.balance;
      }
      if (cost > existing.maxCost) {
        existing.maxCost = cost;
        existing.maxProvider = prov.name;
      }
    }
  }

  const findings: MarginFinding[] = [];
  const costDriftAlerts: Array<{
    network: string;
    package_size: string;
    configured_cost: number;
    provider_cost: number;
    provider: string;
  }> = [];

  // Map of effective wholesale cost per bundle for agent pricing checks
  const effectiveWholesaleMap = new Map<string, { cost: number; source: string }>();

  // 1. Compare provider wholesale costs against global_package_settings
  const globalRows = globalPackagesRes.data || [];
  for (const row of globalRows) {
    const net = normalizeNetwork(row.network);
    const size = normalizeSize(row.package_size);
    if (!net || !size) continue;
    const key = `${net}::${size}`;

    const provCost = wholesaleIndex.get(key);
    const configuredCost = Number(row.cost_price || 0);

    let effectiveCost = 0;
    let wholesaleSource = "";

    if (provCost && provCost.primaryCost > 0) {
      effectiveCost = provCost.primaryCost;
      wholesaleSource = provCost.primaryProvider;
      if (configuredCost > 0 && provCost.primaryCost > configuredCost + 0.01) {
        costDriftAlerts.push({
          network: net,
          package_size: size,
          configured_cost: round2(configuredCost),
          provider_cost: round2(provCost.primaryCost),
          provider: provCost.primaryProvider,
        });
      }
    } else if (configuredCost > 0) {
      effectiveCost = configuredCost;
      wholesaleSource = "global_package_settings.cost_price";
    } else {
      continue; // no wholesale cost baseline available
    }

    effectiveWholesaleMap.set(key, { cost: effectiveCost, source: wholesaleSource });

    const tiers: Array<{ label: string; value: number | null | undefined }> = [
      { label: "agent_price", value: row.agent_price },
      { label: "sub_agent_price", value: row.sub_agent_price },
      { label: "api_price", value: row.api_price },
      { label: "public_price", value: row.public_price },
    ];

    for (const tier of tiers) {
      const sellPrice = Number(tier.value);
      if (!Number.isFinite(sellPrice) || sellPrice <= 0) continue;

      const marginGhs = round2(sellPrice - effectiveCost);
      const marginPct = round2((marginGhs / sellPrice) * 100);

      if (marginGhs < 0) {
        findings.push({
          scope: "global_package_settings",
          severity: "LOSS",
          network: net,
          package_size: size,
          tier: tier.label,
          wholesale_cost: round2(effectiveCost),
          wholesale_source: wholesaleSource,
          sell_price: round2(sellPrice),
          margin_ghs: marginGhs,
          margin_pct: marginPct,
        });
      } else if (marginPct < RAZOR_THIN_MARGIN_PCT) {
        findings.push({
          scope: "global_package_settings",
          severity: "RAZOR_THIN",
          network: net,
          package_size: size,
          tier: tier.label,
          wholesale_cost: round2(effectiveCost),
          wholesale_source: wholesaleSource,
          sell_price: round2(sellPrice),
          margin_ghs: marginGhs,
          margin_pct: marginPct,
        });
      }
    }
  }

  // 2. Compare wholesale costs against per-agent pricing tables (profiles.agent_prices / sub_agent_prices)
  let agentsChecked = 0;
  for (const prof of agentProfilesRes.data || []) {
    const agentName = (prof.store_name || prof.full_name || `Agent ${String(prof.user_id).slice(0, 6)}`).trim();
    const agentEntries = [
      ...extractAgentPriceEntries(prof.agent_prices).map((e) => ({ ...e, tier: "agent_prices" })),
      ...extractAgentPriceEntries(prof.sub_agent_prices).map((e) => ({ ...e, tier: "sub_agent_prices" })),
    ];
    if (agentEntries.length === 0) continue;
    agentsChecked += 1;

    for (const entry of agentEntries) {
      const key = bundleKey(entry.network, entry.package_size);
      const wholesale = effectiveWholesaleMap.get(key);
      if (!wholesale || wholesale.cost <= 0) continue;

      const marginGhs = round2(entry.price - wholesale.cost);
      const marginPct = round2((marginGhs / entry.price) * 100);

      if (marginGhs < 0) {
        findings.push({
          scope: "agent_pricing",
          severity: "LOSS",
          network: entry.network,
          package_size: entry.package_size,
          tier: entry.tier,
          wholesale_cost: round2(wholesale.cost),
          wholesale_source: wholesale.source,
          sell_price: round2(entry.price),
          margin_ghs: marginGhs,
          margin_pct: marginPct,
          agent_id: String(prof.user_id),
          agent_name: agentName,
        });
      } else if (marginPct < RAZOR_THIN_MARGIN_PCT) {
        findings.push({
          scope: "agent_pricing",
          severity: "RAZOR_THIN",
          network: entry.network,
          package_size: entry.package_size,
          tier: entry.tier,
          wholesale_cost: round2(wholesale.cost),
          wholesale_source: wholesale.source,
          sell_price: round2(entry.price),
          margin_ghs: marginGhs,
          margin_pct: marginPct,
          agent_id: String(prof.user_id),
          agent_name: agentName,
        });
      }
    }
  }

  // Sort findings: LOSS first (worst GHS loss first), then RAZOR_THIN (lowest % first)
  findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "LOSS" ? -1 : 1;
    return a.margin_pct - b.margin_pct;
  });

  const lossFindings = findings.filter((f) => f.severity === "LOSS");
  const razorThinFindings = findings.filter((f) => f.severity === "RAZOR_THIN");

  // 3. Call ops_worker AI via callAiAgent for a prioritized margin protection report
  const systemPrompt = `You are SwiftData Ghana's Margin Protection Watchdog (ops_worker).
Analyze the flagged wholesale vs selling price findings and return ONLY valid JSON:
{
  "severity": "CRITICAL | WARNING | HEALTHY",
  "headline": "1-line executive headline (max 140 chars)",
  "executive_summary": "2-3 sentence summary of margin exposure and immediate fixes",
  "prioritized_actions": [
    {
      "priority": "P0 | P1 | P2",
      "scope": "global_package_settings | agent_pricing | cost_sync",
      "network": "MTN",
      "package_size": "5GB",
      "tier": "agent_price",
      "wholesale_cost": 22.5,
      "current_price": 22.0,
      "recommended_min_price": 23.2,
      "reason": "Brief rationale"
    }
  ],
  "sms_alert": "Concise SMS alert (<= 260 chars) listing top loss-making bundles if any exist, else empty string"
}
Rules:
- Use GHS for currency.
- Never recommend routing SME data bundles to Korba.
- P0 = immediate loss-making global bundles, P1 = loss-making agent overrides or severe cost drift, P2 = razor-thin (<2%) margins.
- Recommend at least a 3% safety margin above wholesale_cost.`;

  const aiPayload = {
    scanned_global_packages: globalRows.length,
    scanned_sme_providers: smeProviders.map((p: any) => p.name),
    scanned_agents_with_custom_pricing: agentsChecked,
    loss_count: lossFindings.length,
    razor_thin_count: razorThinFindings.length,
    cost_drift_count: costDriftAlerts.length,
    top_loss_findings: lossFindings.slice(0, 25),
    top_razor_thin_findings: razorThinFindings.slice(0, 20),
    top_cost_drift_alerts: costDriftAlerts.slice(0, 10),
  };

  const aiResult = await callAiAgent(
    supabase,
    "ai_margin_watchdog",
    systemPrompt,
    `Margin Watchdog Audit Snapshot:\n${JSON.stringify(aiPayload)}`,
    1100,
    { responseJson: true }
  );

  const parsedAi = safeParseJson(aiResult.text);

  const computedSeverity =
    lossFindings.length > 0 ? "CRITICAL" : razorThinFindings.length > 0 ? "WARNING" : "HEALTHY";
  const severity =
    parsedAi.severity === "CRITICAL" || parsedAi.severity === "WARNING" || parsedAi.severity === "HEALTHY"
      ? parsedAi.severity
      : computedSeverity;

  const fallbackHeadline =
    lossFindings.length > 0
      ? `CRITICAL: ${lossFindings.length} loss-making & ${razorThinFindings.length} razor-thin (<2%) bundles detected`
      : razorThinFindings.length > 0
      ? `WARNING: ${razorThinFindings.length} razor-thin (<2%) margin bundles detected`
      : `HEALTHY: All ${globalRows.length} global bundles and ${agentsChecked} custom agent price tables are above 2% margin`;

  const headline = String(parsedAi.headline || fallbackHeadline).trim();
  const executiveSummary = String(parsedAi.executive_summary || fallbackHeadline).trim();
  const prioritizedActions = Array.isArray(parsedAi.prioritized_actions)
    ? parsedAi.prioritized_actions.slice(0, 25)
    : lossFindings.slice(0, 10).map((f) => ({
        priority: f.scope === "global_package_settings" ? "P0" : "P1",
        scope: f.scope,
        network: f.network,
        package_size: f.package_size,
        tier: f.tier,
        wholesale_cost: f.wholesale_cost,
        current_price: f.sell_price,
        recommended_min_price: round2(f.wholesale_cost * 1.03),
        reason: `Selling at GHS ${Math.abs(f.margin_ghs).toFixed(2)} loss (${f.margin_pct}%) vs ${f.wholesale_source}`,
      }));

  // 4. Log to ai_insights
  try {
    await supabase.from("ai_insights").insert({
      agent_id: null,
      type: "margin_watchdog",
      insight_text: `${headline}\n${executiveSummary}`.slice(0, 1000),
      metadata: {
        severity,
        ai_provider: aiResult.provider,
        ai_model: aiResult.model,
        scanned_global_packages: globalRows.length,
        scanned_agents: agentsChecked,
        loss_count: lossFindings.length,
        razor_thin_count: razorThinFindings.length,
        cost_drift_count: costDriftAlerts.length,
        loss_findings: lossFindings.slice(0, 50),
        razor_thin_findings: razorThinFindings.slice(0, 50),
        cost_drift_alerts: costDriftAlerts.slice(0, 25),
        prioritized_actions: prioritizedActions,
      },
    });
  } catch (err) {
    console.error("[ai-margin-watchdog] Failed to log to ai_insights:", err);
  }

  // 4b. Write structured findings into ai_system_memory for the Watchdog Hub
  try {
    const memoryKey = "margin_watchdog:latest";
    const { data: existingMem } = await supabase
      .from("ai_system_memory")
      .select("id, observations_count")
      .eq("memory_key", memoryKey)
      .maybeSingle();

    const memoryPayload = {
      category: "ops_playbook",
      summary: `[${severity}] ${headline}`.slice(0, 500),
      confidence: 0.95,
      data: {
        source: "ai_margin_watchdog",
        severity,
        executive_summary: executiveSummary,
        ai_provider: aiResult.provider,
        ai_model: aiResult.model,
        scanned_global_packages: globalRows.length,
        scanned_agents: agentsChecked,
        loss_count: lossFindings.length,
        razor_thin_count: razorThinFindings.length,
        cost_drift_count: costDriftAlerts.length,
        top_loss_findings: lossFindings.slice(0, 15),
        top_razor_thin_findings: razorThinFindings.slice(0, 10),
        top_cost_drift_alerts: costDriftAlerts.slice(0, 10),
        prioritized_actions: prioritizedActions.slice(0, 10),
      },
      last_observed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existingMem?.id) {
      await supabase
        .from("ai_system_memory")
        .update({
          ...memoryPayload,
          observations_count: Number(existingMem.observations_count || 1) + 1,
        })
        .eq("id", existingMem.id);
    } else {
      await supabase.from("ai_system_memory").insert({
        memory_key: memoryKey,
        observations_count: 1,
        ...memoryPayload,
      });
    }
  } catch (err) {
    console.error("[ai-margin-watchdog] Failed to upsert ai_system_memory:", err);
  }

  // 4c. Queue low-risk, executable SME provider rebalance proposals into ai_worker_tasks
  //     when a cheaper funded non-Korba SME provider can eliminate a detected margin loss.
  const queuedFixTasks: Array<{ provider_id: string; provider: string; bundle: string }> = [];
  if (lossFindings.length > 0) {
    const proposedProviders = new Set<string>();
    for (const finding of lossFindings) {
      if (queuedFixTasks.length >= 3) break;
      const key = bundleKey(finding.network, finding.package_size);
      const idx = wholesaleIndex.get(key);
      if (!idx) continue;
      if (
        idx.cheapestProviderId &&
        idx.cheapestProviderId !== idx.primaryProviderId &&
        idx.cheapestCost < finding.sell_price &&
        idx.cheapestBalance >= 100 &&
        !proposedProviders.has(idx.cheapestProviderId)
      ) {
        proposedProviders.add(idx.cheapestProviderId);
        try {
          const qRes = await queueAgentAction(supabase, "ai_margin_watchdog", {
            type: "rebalance_sme_provider",
            priority: "high",
            title: `Promote ${idx.cheapestProvider} to priority 1 to stop ${finding.network} ${finding.package_size} margin loss`,
            reason: `${finding.network} ${finding.package_size} (${finding.tier}) sells at GHS ${finding.sell_price.toFixed(2)} vs ${idx.primaryProvider} cost GHS ${idx.primaryCost.toFixed(2)}. ${idx.cheapestProvider} offers GHS ${idx.cheapestCost.toFixed(2)} (bal GHS ${idx.cheapestBalance.toFixed(2)}).`,
            params: {
              provider_id: idx.cheapestProviderId,
              new_priority: 1,
            },
          });
          if (qRes.queued) {
            queuedFixTasks.push({
              provider_id: idx.cheapestProviderId,
              provider: idx.cheapestProvider,
              bundle: `${finding.network} ${finding.package_size}`,
            });
          }
        } catch (err) {
          console.warn("[ai-margin-watchdog] Failed to queue rebalance_sme_provider task:", err);
        }
      }
    }
  }

  // 5. Alert admins via SMS + in-app notification if ANY loss-making bundle is found
  let smsSentCount = 0;
  if (lossFindings.length > 0) {
    const topLossPreview = lossFindings
      .slice(0, 3)
      .map(
        (f) =>
          `${f.network} ${f.package_size} (${f.tier}${f.agent_name ? `:${f.agent_name}` : ""}): sell GHS ${f.sell_price} < cost GHS ${f.wholesale_cost}`
      )
      .join("; ");

    const smsMessage =
      String(parsedAi.sms_alert || "").trim() ||
      `🚨 SwiftData Margin Alert: ${lossFindings.length} loss-making bundle(s)! ${topLossPreview}`.slice(0, 300);

    const { data: admins } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
    if (admins?.length) {
      try {
        await supabase.from("user_notifications").insert(
          admins.map((a: any) => ({
            user_id: a.user_id,
            title: `🚨 Margin Watchdog: ${lossFindings.length} Loss-Making Bundle(s)`,
            message: `${headline}. ${topLossPreview}`.slice(0, 600),
            type: "warning",
            link: "/admin/packages",
            data: {
              severity,
              loss_count: lossFindings.length,
              razor_thin_count: razorThinFindings.length,
              prioritized_actions: prioritizedActions.slice(0, 10),
              link: "/admin/packages",
            },
          }))
        );
      } catch (err) {
        console.error("[ai-margin-watchdog] Failed to insert admin notifications:", err);
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
          await sendPaymentSms(supabase, profile.phone, "custom" as any, { message: smsMessage });
          smsSentCount += 1;
        } catch (err) {
          console.warn("[ai-margin-watchdog] Admin SMS send failed:", err);
        }
      }
    }
  }

  // 6. Log audit record to sentinel_actions
  try {
    await supabase.from("sentinel_actions").insert({
      action_type: "margin_watchdog_scan",
      status: "executed",
      effectiveness: lossFindings.length > 0 ? 1 : 0,
      reasoning: headline,
      result: {
        severity,
        loss_count: lossFindings.length,
        razor_thin_count: razorThinFindings.length,
        cost_drift_count: costDriftAlerts.length,
        sms_sent_count: smsSentCount,
      },
      metadata: {
        source: "ai_margin_watchdog",
        ai_provider: aiResult.provider,
        ai_model: aiResult.model,
        prioritized_actions: prioritizedActions.slice(0, 15),
      },
    });
  } catch (err) {
    console.error("[ai-margin-watchdog] Failed to log to sentinel_actions:", err);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      severity,
      headline,
      executive_summary: executiveSummary,
      ai_provider: aiResult.provider,
      ai_model: aiResult.model,
      summary: {
        scanned_global_packages: globalRows.length,
        scanned_sme_providers: smeProviders.length,
        scanned_agents: agentsChecked,
        loss_count: lossFindings.length,
        razor_thin_count: razorThinFindings.length,
        cost_drift_count: costDriftAlerts.length,
        admin_sms_sent: smsSentCount,
        queued_fix_tasks: queuedFixTasks.length,
      },
      queued_fix_tasks: queuedFixTasks,
      loss_findings: lossFindings,
      razor_thin_findings: razorThinFindings,
      cost_drift_alerts: costDriftAlerts,
      prioritized_actions: prioritizedActions,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
