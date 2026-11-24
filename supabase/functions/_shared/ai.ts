// Shared AI Agent Client with OpenAI, Google Gemini, Anthropic Claude & Self-Healing Failover
// Prioritizes environment secrets (OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY)
// Tracks token usage, estimated USD cost, daily budget caps, and agent run telemetry.

declare const Deno: any;

export type AiProvider = "openai" | "anthropic" | "google" | "heuristic";
export type AutonomyMode = "autonomous" | "approval_required" | "observe_only";

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
}

export interface AiAgentResult {
  text: string;
  provider: AiProvider;
  model: string;
  usage?: AiUsage;
}

export interface AiAgentConfig {
  name: string;
  active_model: string;
  is_active: boolean;
  autonomy_mode: AutonomyMode;
  daily_budget_usd: number;
}

export interface CallAiOptions {
  imageBase64?: string;
  imageMediaType?: string;
  forceModel?: string;
  skipTelemetry?: boolean;
  responseJson?: boolean;
}

// Conservative USD pricing per 1M tokens
const MODEL_PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60 },
  "gpt-4.1": { input: 2.00, output: 8.00 },
  "o4-mini": { input: 1.10, output: 4.40 },
  "o3-mini": { input: 1.10, output: 4.40 },
  "gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "gemini-2.5-flash": { input: 0.15, output: 0.60 },
  "gemini-1.5-pro": { input: 1.25, output: 5.00 },
  "claude-3-5-haiku-20241022": { input: 0.80, output: 4.00 },
  "claude-sonnet-4-5-20250929": { input: 3.00, output: 15.00 },
};

function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING_PER_1M[model] || { input: 0.50, output: 2.00 };
  const cost = (promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output;
  return Number(cost.toFixed(6));
}

function isOpenAIModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4");
}

function isGeminiModel(model: string): boolean {
  return model.toLowerCase().startsWith("gemini-");
}

export function normalizeModelName(rawModel: string): string {
  const m = (rawModel || "").trim();
  const hasOpenAI = Boolean(Deno.env.get("OPENAI_API_KEY"));
  const hasGemini = Boolean(Deno.env.get("GEMINI_API_KEY"));
  const hasAnthropic = Boolean(Deno.env.get("ANTHROPIC_API_KEY"));

  // Replace empty or broken legacy model identifiers
  if (!m || m === "gemini-3.6-flash" || m === "gemini-1.5-flash") {
    if (hasOpenAI) return "gpt-4o-mini";
    if (hasGemini) return "gemini-2.0-flash";
    if (hasAnthropic) return "claude-3-5-haiku-20241022";
    return "gpt-4o-mini";
  }
  if (m === "claude-haiku" || m.includes("claude-haiku-4-5")) {
    if (hasOpenAI && !hasAnthropic) return "gpt-4o-mini";
    return "claude-3-5-haiku-20241022";
  }
  return m;
}

export async function getAgentConfig(supabaseAdmin: any, agentName: string): Promise<AiAgentConfig> {
  const defaultModel = Deno.env.get("OPENAI_API_KEY") ? "gpt-4o-mini" : "gemini-2.0-flash";
  const fallback: AiAgentConfig = {
    name: agentName,
    active_model: defaultModel,
    is_active: true,
    autonomy_mode: "autonomous",
    daily_budget_usd: 5.0,
  };

  try {
    const { data: agent } = await supabaseAdmin
      .from("ai_agent_registry")
      .select("name, active_model, is_active, autonomy_mode, daily_budget_usd")
      .eq("name", agentName)
      .maybeSingle();

    if (!agent) return fallback;
    return {
      name: agent.name || agentName,
      active_model: normalizeModelName(agent.active_model || defaultModel),
      is_active: agent.is_active !== false,
      autonomy_mode: (agent.autonomy_mode as AutonomyMode) || "autonomous",
      daily_budget_usd: Number(agent.daily_budget_usd ?? 5.0),
    };
  } catch (err) {
    console.error(`[AI Router] Failed to load config for ${agentName}:`, err);
    return fallback;
  }
}

async function getTodayTotalSpendUsd(supabaseAdmin: any): Promise<number> {
  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { data } = await supabaseAdmin
      .from("ai_agent_runs")
      .select("estimated_cost_usd")
      .gte("created_at", startOfDay.toISOString());

    if (!Array.isArray(data)) return 0;
    return data.reduce((sum: number, r: any) => sum + Number(r.estimated_cost_usd || 0), 0);
  } catch {
    return 0;
  }
}

async function recordAgentRun(
  supabaseAdmin: any,
  payload: {
    agent_name: string;
    provider: AiProvider;
    model: string;
    status: "success" | "fallback" | "budget_capped" | "error";
    prompt_tokens: number;
    completion_tokens: number;
    estimated_cost_usd: number;
    duration_ms: number;
    error_message?: string | null;
  }
): Promise<void> {
  try {
    await supabaseAdmin.from("ai_agent_runs").insert({
      agent_name: payload.agent_name,
      provider: payload.provider,
      model: payload.model,
      status: payload.status,
      prompt_tokens: payload.prompt_tokens,
      completion_tokens: payload.completion_tokens,
      estimated_cost_usd: payload.estimated_cost_usd,
      duration_ms: payload.duration_ms,
      error_message: payload.error_message || null,
    });
  } catch (err) {
    console.warn("[AI Router] Could not log to ai_agent_runs:", err);
  }

  try {
    await supabaseAdmin
      .from("ai_agent_registry")
      .update({
        last_run_at: new Date().toISOString(),
        last_status: payload.status === "error" ? "error" : "healthy",
      })
      .eq("name", payload.agent_name);
  } catch (err) {
    console.warn("[AI Router] Could not update ai_agent_registry heartbeat:", err);
  }
}

export async function callAiAgent(
  supabaseAdmin: any,
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 1500,
  options: CallAiOptions = {}
): Promise<AiAgentResult> {
  const startedAt = Date.now();
  const config = await getAgentConfig(supabaseAdmin, agentName);
  const model = normalizeModelName(options.forceModel || config.active_model);

  // 1. Enforce Daily Spend Budget Cap
  const todaySpend = await getTodayTotalSpendUsd(supabaseAdmin);
  if (config.daily_budget_usd > 0 && todaySpend >= config.daily_budget_usd) {
    console.warn(
      `[AI Budget Guard] Daily spend ($${todaySpend.toFixed(4)}) reached cap ($${config.daily_budget_usd}). Engaging Heuristic Brain for "${agentName}".`
    );
    const heuristic = generateHeuristicFallback(agentName, systemPrompt, userMessage);
    if (!options.skipTelemetry) {
      await recordAgentRun(supabaseAdmin, {
        agent_name: agentName,
        provider: "heuristic",
        model: heuristic.model,
        status: "budget_capped",
        prompt_tokens: 0,
        completion_tokens: 0,
        estimated_cost_usd: 0,
        duration_ms: Date.now() - startedAt,
        error_message: `Daily cap $${config.daily_budget_usd} reached ($${todaySpend.toFixed(4)})`,
      });
    }
    return heuristic;
  }

  // 2. Build Ordered Model Cascade (Primary -> Secondary -> Heuristic)
  const candidates: string[] = [model];
  const hasOpenAI = Boolean(Deno.env.get("OPENAI_API_KEY"));
  const hasGemini = Boolean(Deno.env.get("GEMINI_API_KEY"));
  const hasAnthropic = Boolean(Deno.env.get("ANTHROPIC_API_KEY"));

  if (hasOpenAI && !candidates.includes("gpt-4o-mini")) candidates.push("gpt-4o-mini");
  if (hasGemini && !candidates.includes("gemini-2.0-flash")) candidates.push("gemini-2.0-flash");
  if (hasAnthropic && !candidates.includes("claude-3-5-haiku-20241022")) candidates.push("claude-3-5-haiku-20241022");

  let lastError: string | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const res = await executeModelCall(candidate, systemPrompt, userMessage, maxTokens, options);
      if (!options.skipTelemetry) {
        await recordAgentRun(supabaseAdmin, {
          agent_name: agentName,
          provider: res.provider,
          model: res.model,
          status: i === 0 ? "success" : "fallback",
          prompt_tokens: res.usage?.promptTokens || 0,
          completion_tokens: res.usage?.completionTokens || 0,
          estimated_cost_usd: res.usage?.estimatedCostUsd || 0,
          duration_ms: Date.now() - startedAt,
          error_message: i > 0 ? lastError : null,
        });
      }
      return res;
    } catch (err: any) {
      lastError = err?.message || String(err);
      console.warn(`[AI Failover] Agent "${agentName}" model "${candidate}" failed: ${lastError}`);
      if (i === 0 && candidates.length > 1) {
        try {
          await supabaseAdmin.from("system_logs").insert({
            level: "warning",
            source: "system",
            event: "ai.failover",
            message: `AI Agent "${agentName}" model "${candidate}" failed. Trying fallback "${candidates[1]}".`,
            data: { error: lastError, primary: candidate, fallback: candidates[1] },
          });
        } catch {
          // non-critical
        }
      }
    }
  }

  // 3. Resilient Local Heuristic Brain
  console.error(`[AI Failover Critical] All cloud models failed for "${agentName}". Engaging Heuristic Brain.`);
  const heuristic = generateHeuristicFallback(agentName, systemPrompt, userMessage);
  if (!options.skipTelemetry) {
    await recordAgentRun(supabaseAdmin, {
      agent_name: agentName,
      provider: "heuristic",
      model: heuristic.model,
      status: "fallback",
      prompt_tokens: 0,
      completion_tokens: 0,
      estimated_cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      error_message: lastError,
    });
  }
  return heuristic;
}

async function executeModelCall(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  options: CallAiOptions = {}
): Promise<AiAgentResult> {
  if (isOpenAIModel(model)) {
    return await executeOpenAICall(model, systemPrompt, userMessage, maxTokens, options);
  }
  if (isGeminiModel(model)) {
    return await executeGeminiCall(model, systemPrompt, userMessage, maxTokens, options);
  }
  return await executeAnthropicCall(model, systemPrompt, userMessage, maxTokens, options);
}

async function executeOpenAICall(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  options: CallAiOptions = {}
): Promise<AiAgentResult> {
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in environment variables");
  }

  const requiresJson =
    options.responseJson ??
    (systemPrompt.toLowerCase().includes("json") || userMessage.toLowerCase().includes("json"));

  const userContent: any = options.imageBase64
    ? [
        { type: "text", text: userMessage },
        {
          type: "image_url",
          image_url: {
            url: `data:${options.imageMediaType || "image/png"};base64,${options.imageBase64}`,
          },
        },
      ]
    : userMessage;

  const isReasoningModel = model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4");
  const body: Record<string, any> = {
    model,
    messages: [
      { role: isReasoningModel ? "developer" : "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  };

  if (isReasoningModel) {
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
    body.temperature = 0.1;
  }

  if (requiresJson) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenAI API Error (${response.status}): ${errorText.slice(0, 400)}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error(`Empty response from OpenAI model "${model}": ${JSON.stringify(data).slice(0, 300)}`);
  }

  const promptTokens = Number(data?.usage?.prompt_tokens || 0);
  const completionTokens = Number(data?.usage?.completion_tokens || 0);

  return {
    text: String(text).trim(),
    provider: "openai",
    model,
    usage: {
      promptTokens,
      completionTokens,
      estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
    },
  };
}

async function executeGeminiCall(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  options: CallAiOptions = {}
): Promise<AiAgentResult> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY in environment variables");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const requiresJson =
    options.responseJson ??
    (systemPrompt.toLowerCase().includes("json") || userMessage.toLowerCase().includes("json"));

  const userParts: any[] = [{ text: userMessage }];
  if (options.imageBase64) {
    userParts.push({
      inlineData: {
        mimeType: options.imageMediaType || "image/png",
        data: options.imageBase64,
      },
    });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: userParts }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: maxTokens,
        ...(requiresJson ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Google Gemini API Error (${response.status}): ${errorText.slice(0, 400)}`);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p: any) => p.text || "").filter(Boolean).join("\n");

  if (!text) {
    const finishReason = data?.candidates?.[0]?.finishReason;
    throw new Error(`Empty response from Gemini model (finishReason: ${finishReason})`);
  }

  const promptTokens = Number(data?.usageMetadata?.promptTokenCount || 0);
  const completionTokens = Number(data?.usageMetadata?.candidatesTokenCount || 0);

  return {
    text: text.trim(),
    provider: "google",
    model,
    usage: {
      promptTokens,
      completionTokens,
      estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
    },
  };
}

async function executeAnthropicCall(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  options: CallAiOptions = {}
): Promise<AiAgentResult> {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY in environment variables");
  }

  const content: any = options.imageBase64
    ? [
        { type: "text", text: userMessage },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: options.imageMediaType || "image/png",
            data: options.imageBase64,
          },
        },
      ]
    : userMessage;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Anthropic Claude API Error (${response.status}): ${errorText.slice(0, 400)}`);
  }

  const data = await response.json();
  const text = data?.content?.[0]?.text;
  if (!text) {
    throw new Error(`Empty response from Claude model: ${JSON.stringify(data).slice(0, 300)}`);
  }

  const promptTokens = Number(data?.usage?.input_tokens || 0);
  const completionTokens = Number(data?.usage?.output_tokens || 0);

  return {
    text: text.trim(),
    provider: "anthropic",
    model,
    usage: {
      promptTokens,
      completionTokens,
      estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
    },
  };
}

/**
 * Deterministic Heuristic Engine used as a zero-downtime safety net
 * if cloud LLM API calls are temporarily unavailable or budget-capped.
 */
function generateHeuristicFallback(agentName: string, _systemPrompt: string, userMessage: string): AiAgentResult {
  console.log(`[Heuristic Brain] Running autonomous rule engine for "${agentName}"...`);

  const actions: any[] = [];
  const findings: string[] = [];
  const insights: any[] = [];

  try {
    if (userMessage.includes("Networks:")) {
      const netMatch = userMessage.match(/Networks:\s*(\[[^\]]+\])/);
      if (netMatch) {
        const networks = JSON.parse(netMatch[1]);
        for (const net of networks) {
          if (net.failure_rate >= 0.6 && net.total >= 5) {
            findings.push(`Heuristic: Severe failure rate on ${net.network} (${Math.round(net.failure_rate * 100)}%)`);
            actions.push({
              type: "broadcast_outage",
              target: null,
              params: { network: net.network, reason: "Heuristic: Over 60% failure rate detected on network" },
            });
          }
        }
      }
    }

    if (userMessage.includes("Providers:")) {
      const provMatch = userMessage.match(/Providers:\s*(\[[^\]]+\])/);
      if (provMatch) {
        const providers = JSON.parse(provMatch[1]);
        const prio1 = providers.find((p: any) => p.priority === 1 && String(p.handler_type || "").toLowerCase() !== "korba");
        if (prio1 && (prio1.balance < 50 || prio1.status !== "active")) {
          const alternative = providers
            .filter(
              (p: any) =>
                p.status === "active" &&
                p.id !== prio1.id &&
                String(p.handler_type || "").toLowerCase() !== "korba" &&
                !String(p.name || "").toLowerCase().includes("korba")
            )
            .sort((a: any, b: any) => (b.balance || 0) - (a.balance || 0))[0];

          if (alternative && alternative.balance > 100) {
            findings.push(`Heuristic: Priority 1 provider ${prio1.name} has low balance/inactive. Switching to ${alternative.name}.`);
            actions.push({
              type: "switch_priority",
              target: alternative.id,
              params: {
                provider_id: alternative.id,
                provider_name: alternative.name,
                new_priority: 1,
                reason: `Heuristic: Rebalancing to higher balance SME provider (${alternative.balance})`,
              },
            });
          }
        }
      }
    }
  } catch (e) {
    console.error("[Heuristic Brain] Error in rule evaluation:", e);
  }

  const fallbackPayload = JSON.stringify({
    summary: findings.length ? findings.join("; ") : "All systems operating within normal parameters.",
    health_status: findings.length ? "DEGRADED" : "HEALTHY",
    findings: findings.length ? findings : ["All systems operating within normal parameters."],
    actions,
    memory_updates: [],
    insights: insights.length ? insights : [{ type: "system", text: "Autonomous heuristic patrol completed." }],
  });

  return {
    text: fallbackPayload,
    provider: "heuristic",
    model: "sentinel-heuristic-v1",
    usage: { promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 },
  };
}
