// Shared AI Agent Client with Dynamic Routing & Self-Healing Failover
// Supports both Google Gemini (3.6-flash / flash-latest) and Anthropic Claude models.

declare const Deno: any;

export interface AiAgentResult {
  text: string;
  provider: "anthropic" | "google" | "heuristic";
  model: string;
}

export function normalizeModelName(rawModel: string): string {
  const m = (rawModel || "").trim();
  if (!m || m.includes("claude-haiku-4-5") || m.includes("gemini-1.5-flash") || m.includes("gemini-2.5-flash")) {
    return "gemini-3.6-flash";
  }
  if (m === "claude-haiku") {
    return "claude-3-5-haiku-20241022";
  }
  return m;
}

export async function callAiAgent(
  supabaseAdmin: any,
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 1500
): Promise<AiAgentResult> {
  // 1. Fetch active model from registry
  let rawModel = "gemini-3.6-flash"; // default high-speed intelligent model
  try {
    const { data: agent } = await supabaseAdmin
      .from("ai_agent_registry")
      .select("active_model")
      .eq("name", agentName)
      .maybeSingle();

    if (agent && agent.active_model) {
      rawModel = agent.active_model;
    }
  } catch (err) {
    console.error(`[AI Router] Failed to load agent settings for ${agentName}:`, err);
  }

  const model = normalizeModelName(rawModel);

  // 2. Perform execution with self-healing fallback cascade
  try {
    return await executeModelCall(model, systemPrompt, userMessage, maxTokens);
  } catch (err: any) {
    const isGemini = model.startsWith("gemini-");
    const fallbackModel = isGemini ? "gemini-flash-latest" : "gemini-3.6-flash";
    
    console.warn(`[AI Failover] Agent "${agentName}" primary model "${model}" failed (${err.message || err}). Retrying with fallback "${fallbackModel}"...`);
    
    try {
      await supabaseAdmin.from("system_logs").insert({
        level: "warning",
        source: "system",
        event: "ai.failover",
        message: `AI Agent "${agentName}" primary model "${model}" failed. Fallback to "${fallbackModel}" triggered.`,
        data: { error: err.message || String(err), primary: model, fallback: fallbackModel }
      });
    } catch (logErr) {
      console.error("[AI Router] Failed to insert failover log:", logErr);
    }

    try {
      return await executeModelCall(fallbackModel, systemPrompt, userMessage, maxTokens);
    } catch (fallbackErr: any) {
      console.error(`[AI Failover Critical] Sibling fallback model "${fallbackModel}" also failed! Engaging Local Heuristic Brain...`, fallbackErr);

      // 3. Resilient Heuristic Tactical Fallback
      return generateHeuristicFallback(agentName, systemPrompt, userMessage);
    }
  }
}

async function executeModelCall(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number
): Promise<AiAgentResult> {
  const isGemini = model.startsWith("gemini-");

  if (isGemini) {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("Missing GEMINI_API_KEY in environment variables");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const requiresJson = systemPrompt.toLowerCase().includes("json") || userMessage.toLowerCase().includes("json");
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userMessage }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: maxTokens,
          ...(requiresJson ? { responseMimeType: "application/json" } : {}),
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Google Gemini API Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p: any) => p.text || "").filter(Boolean).join("\n");

    if (!text) {
      const finishReason = data?.candidates?.[0]?.finishReason;
      throw new Error(`Empty response from Gemini model (finishReason: ${finishReason}): ${JSON.stringify(data)}`);
    }

    return {
      text: text.trim(),
      provider: "google",
      model
    };
  } else {
    // Anthropic Claude
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("Missing ANTHROPIC_API_KEY in environment variables");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Anthropic Claude API Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text;
    if (!text) {
      throw new Error(`Empty response from Claude model: ${JSON.stringify(data)}`);
    }

    return {
      text: text.trim(),
      provider: "anthropic",
      model
    };
  }
}

/**
 * Deterministic Heuristic Engine used as a zero-downtime safety net
 * if all cloud LLM API calls are temporarily throttled or unavailable.
 */
function generateHeuristicFallback(agentName: string, systemPrompt: string, userMessage: string): AiAgentResult {
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
              params: { network: net.network, reason: "Heuristic: Over 60% failure rate detected on network" }
            });
          }
        }
      }
    }

    if (userMessage.includes("Providers:")) {
      const provMatch = userMessage.match(/Providers:\s*(\[[^\]]+\])/);
      if (provMatch) {
        const providers = JSON.parse(provMatch[1]);
        const prio1 = providers.find((p: any) => p.priority === 1);
        if (prio1 && (prio1.balance < 50 || prio1.status !== "active")) {
          const alternative = providers
            .filter((p: any) => p.status === "active" && p.id !== prio1.id)
            .sort((a: any, b: any) => (b.balance || 0) - (a.balance || 0))[0];
          
          if (alternative && alternative.balance > 100) {
            findings.push(`Heuristic: Priority 1 provider ${prio1.name} has low balance/inactive. Switching to ${alternative.name}.`);
            actions.push({
              type: "switch_priority",
              target: alternative.id,
              params: { provider_id: alternative.id, provider_name: alternative.name, new_priority: 1, reason: `Heuristic: Rebalancing to higher balance provider (${alternative.balance})` }
            });
          }
        }
      }
    }
  } catch (e) {
    console.error("[Heuristic Brain] Error in rule evaluation:", e);
  }

  const fallbackPayload = JSON.stringify({
    findings: findings.length ? findings : ["All systems operating within normal parameters."],
    actions,
    insights: insights.length ? insights : [{ type: "system", text: "Autonomous Sentinel heuristic patrol completed." }]
  });

  return {
    text: fallbackPayload,
    provider: "heuristic",
    model: "sentinel-heuristic-v1"
  };
}
