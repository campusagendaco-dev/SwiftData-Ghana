// Shared AI Agent Client with Dynamic Routing & Self-Healing Failover
// Supports both Anthropic Claude and Google Gemini models.

declare const Deno: any;

export interface AiAgentResult {
  text: string;
  provider: "anthropic" | "google";
  model: string;
}

export async function callAiAgent(
  supabaseAdmin: any,
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 1500
): Promise<AiAgentResult> {
  // 1. Fetch active model from registry
  let model = "claude-haiku-4-5-20251001"; // default safety backup
  try {
    const { data: agent } = await supabaseAdmin
      .from("ai_agent_registry")
      .select("active_model")
      .eq("name", agentName)
      .maybeSingle();

    if (agent && agent.active_model) {
      model = agent.active_model;
    }
  } catch (err) {
    console.error(`[AI Router] Failed to load agent settings for ${agentName}:`, err);
  }

  // 2. Perform the execution with self-healing fallback
  try {
    return await executeModelCall(model, systemPrompt, userMessage, maxTokens);
  } catch (err: any) {
    const isClaude = model.startsWith("claude-");
    const fallbackModel = isClaude ? "gemini-1.5-flash" : "claude-haiku-4-5-20251001";
    
    console.warn(`[AI Failover] Agent "${agentName}" primary model "${model}" failed (${err.message || err}). Retrying with fallback model "${fallbackModel}"...`);
    
    // Log the failover incident to system logs
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
      console.error(`[AI Failover Critical] Sibling fallback model "${fallbackModel}" also failed!`, fallbackErr);
      throw new Error(`AI Agent execution failed for both primary and fallback models. Primary: ${err.message}, Fallback: ${fallbackErr.message}`);
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
    
    // Auto-enable structured JSON output if prompts indicate JSON requirements
    const requiresJson = systemPrompt.toLowerCase().includes("json") || userMessage.toLowerCase().includes("json");
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: `${systemPrompt}\n\nUser Input:\n${userMessage}` }
            ]
          }
        ],
        generationConfig: {
          temperature: 0,
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
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error(`Empty response from Gemini model: ${JSON.stringify(data)}`);
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
