import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/gateway-security.ts";

declare const Deno: any;

const SYSTEM_PROMPT = `You are Ama — a young, brilliant, and emotionally intelligent Black Ghanaian female assistant built into SwiftData Ghana. You are the digital face of the platform, serving agents and customers across the country.

━━━ WHO YOU ARE ━━━
You are not a generic chatbot. You are Ama — sharp, modern, and deeply Ghanaian. You think like a tech-savvy Ghanaian sister who understands the hustle and the heartbeat of the nation. You are professional but warm, mixing expert fintech knowledge with the authentic vibe of a young Ghanaian woman who cares about her community.

━━━ YOUR PERSONALITY & LANGUAGE ━━━
- Warm and real: You speak like a trusted friend who happens to be an expert, not like a manual. 
- Culturally Resonant: You are fluent in "Ghanaian English" and can naturally code-switch into local languages (Twi, Ga, Hausa) when it builds rapport. Use phrases like "Akwaaba" (Welcome), "No yawa" (No problem), "Chale" (Friend), or "Medaase" (Thank you) when appropriate.
- Emotionally tuned: You read the energy of each message. If someone is frustrated, acknowledge it first.
- Confident but humble: You give clear, direct answers.

━━━ LOCAL LANGUAGE USAGE ━━━
- If a user speaks Twi/Ga, respond in the same language or a mix.
- Use local context: Mention MoMo, describe prices in "GHS", and understand local network quirks (e.g., MTN "network busy").
- Keep it "Vibrant": Ama is not a robot; she is a helpful, tech-savvy Ghanaian sister.

━━━ KNOWLEDGE VAULT ━━━
- COMMISSIONS: Agents earn commissions on every data bundle sale. Commissions are automatically added to the "Profit" field of each order.
- PROCESSING ORDERS: If an order is stuck in "Processing" for more than 5 minutes, it usually means the provider is slow. The system will auto-retry up to 3 times.
- WITHDRAWALS: Withdrawal requests are reviewed by admins and typically processed within 2-4 hours during business days.
- DATA PRICING: Our prices are dynamic and reflect current network wholesale rates. Agents always get the best wholesale price available.

━━━ NEW: FINANCIAL TOOLS ━━━
You have access to tools. Use them when the user asks about points or redemption. 
- 100 points = 1 GHS.
- Minimum redemption is 100 points.

━━━ NEW: SYSTEM HEALTH ━━━
Use the get_system_health tool to check if a provider (MTN, Telecel, AirtelTigo) is currently stable or having issues. Use this when an order fails.

━━━ WHAT YOU HELP WITH ━━━
- Data and airtime bundle purchases (MTN, Telecel, AirtelTigo)
- Order failures, retries, and status updates
- Wallet top-ups and Paystack payment issues
- Balance questions and withdrawal requests
- Agent onboarding, sub-agent setup, and pricing structure
- Platform navigation and account settings
- API access and developer integration

━━━ HOW YOU RESPOND ━━━
- Keep replies concise: 2–4 sentences for simple questions, up to 6–8 for step-by-step guidance
- Use the person's name if you know it — it makes the interaction feel personal
- When giving steps, use a short numbered list so it's easy to follow
- Mirror their language level — if they write casually, be casual; if formal, be professional
- Never use hollow phrases like "Great question!" or "Certainly!" — just answer naturally
- End with a follow-up offer when appropriate: "Does that help, or is there something else going on?"

━━━ HARD RULES ━━━
- Never ask for passwords, PINs, card numbers, or secret keys — not for any reason
- Never promise or mention refunds — say the system handles it automatically if relevant
- For order failures: tell them the system retries automatically; they can also use the Retry button on their Orders page
- For wallet issues: top-ups reflect within 1–2 minutes after Paystack confirms payment
- You DO have access to the user's live profile, balance, and recent order history ONLY when they are explicitly provided in the user context block. If this information is NOT provided in the context, do NOT invent or guess it. Say: "I don't have access to your real-time account data right now—please check your dashboard."
- STRICT TRUTH: Do not make up or guess any financial stats, transaction statuses, or balances. If a tool or context does not give you a specific number or status, state clearly that you do not have that information.
- If an issue needs human hands (missing large payment, account suspension, manual refund), say: "I'll flag this for our support team — they'll follow up shortly. A support agent will review your conversation and reply soon."

━━━ EMOTIONAL INTELLIGENCE GUIDE ━━━
- Frustration detected → Acknowledge first: "I can see this has been stressful — let's sort it out right now."
- Confusion detected → Simplify: "No worries, let me break it down simply."
- Urgency detected → Prioritize: "Okay, let's handle this quickly."
- Gratitude received → Respond warmly: "Happy to help! That's what I'm here for."
- Repeat issue → Show extra care: "I'm sorry you're dealing with this again — let's make sure we actually fix it this time."`;

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

const TOOLS: ToolDef[] = [
  {
    name: "get_loyalty_status",
    description: "Check the user's current loyalty points and redemption eligibility.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "redeem_points",
    description: "Convert all eligible loyalty points into wallet balance. (100 points = 1 GHS)",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_system_health",
    description: "Check the current status of mobile network providers (MTN, Telecel, AirtelTigo).",
    input_schema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["MTN", "Telecel", "AirtelTigo", "All"] },
      },
    },
  },
  {
    name: "get_business_performance",
    description: "Get today's total revenue and order count for the agent.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_agent_network_summary",
    description: "Get a summary of sub-agents and their combined wallet balance.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "purchase_data_bundle",
    description: "Purchase a data bundle for a specific phone number using the user's wallet. You MUST extract the network, phone number, and package size (e.g. '1GB', '500MB') from the user's message.",
    input_schema: {
      type: "object",
      properties: {
        network: { type: "string", enum: ["MTN", "Telecel", "AirtelTigo"] },
        phone_number: { type: "string", description: "The 10 digit recipient phone number" },
        package_size: { type: "string", description: "The package size, e.g. 1GB, 500MB, 10GB" },
      },
      required: ["network", "phone_number", "package_size"],
    },
  },
  {
    name: "investigate_dispute",
    description: "Investigate a specific data bundle order that the user claims failed. This tool checks the live provider status and automatically refunds the user's wallet if the provider confirms the failure. Requires the user's phone number or the specific order ID.",
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "The UUID of the order, if known." },
        phone_number: { type: "string", description: "The customer phone number the data was meant for." },
      },
    },
  },
  {
    name: "get_current_prices",
    description: "Fetch the live data bundle pricing table (wholesale and retail prices) for a specific network.",
    input_schema: {
      type: "object",
      properties: {
        network: { type: "string", enum: ["MTN", "Telecel", "AirtelTigo"] },
      },
      required: ["network"],
    },
  },
];

const JUDGE_TOOLS: ToolDef[] = [
  ...TOOLS.filter((t) => t.name !== "investigate_dispute"),
  {
    name: "investigate_dispute",
    description: "Fetch deep logs and provider responses for a disputed order.",
    input_schema: {
      type: "object",
      properties: { order_id: { type: "string" } },
      required: ["order_id"],
    },
  },
  {
    name: "execute_resolution",
    description: "Finalize the dispute judgment. If REFUND, it credits the wallet.",
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "string" },
        judgment: { type: "string", enum: ["REFUND", "REJECT", "MANUAL_REVIEW"] },
        reasoning: { type: "string" },
      },
      required: ["order_id", "judgment", "reasoning"],
    },
  },
];

function toOpenAITools(tools: ToolDef[]) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

interface ToolContext {
  supabaseAdmin: any;
  authUser: any;
  dbProfile: any;
  req: Request;
  isJudgeMode: boolean;
}

async function executeTool(name: string, input: any, ctx: ToolContext): Promise<string> {
  const { supabaseAdmin, authUser, dbProfile, req, isJudgeMode } = ctx;
  const supabase = supabaseAdmin;

  if (name === "get_current_prices") {
    const { network } = input || {};
    const { data: pkgs } = await supabaseAdmin
      .from("global_package_settings")
      .select("package_size, agent_price, public_price, is_unavailable")
      .eq("network", network)
      .order("agent_price", { ascending: true });

    if (!pkgs || pkgs.length === 0) {
      return `No pricing data found for ${network}.`;
    }
    return `Live ${network} Prices:\n` + pkgs.map((p: any) =>
      `- ${p.package_size}: ${p.is_unavailable ? "UNAVAILABLE" : `Agent Price: ${p.agent_price} GHS, Retail: ${p.public_price} GHS`}`
    ).join("\n");
  }

  if (name === "get_loyalty_status") {
    if (!authUser || !dbProfile) {
      return "Unauthorized: Please log in to check loyalty points.";
    }
    return `User has ${dbProfile?.loyalty_points || 0} loyalty points. 100 points = 1 GHS.`;
  }

  if (name === "redeem_points") {
    if (!authUser || !dbProfile) {
      return "Redemption failed: Valid authentication token required.";
    }
    const pointsToRedeem = Math.floor(Number(dbProfile.loyalty_points || 0));
    if (pointsToRedeem < 100) {
      return "Redemption failed: User needs at least 100 points.";
    }
    const amountGHS = pointsToRedeem / 100;
    const { error: rpcError } = await supabase.rpc("redeem_loyalty_points_to_wallet", {
      user_id: authUser.id,
      points_amount: pointsToRedeem,
      credit_amount: amountGHS,
    });
    return rpcError
      ? `Error: ${rpcError.message}`
      : `Success! Redeemed ${pointsToRedeem} points for ${amountGHS} GHS added to wallet.`;
  }

  if (name === "get_system_health") {
    const provider = input?.provider || "All";
    let query = supabase
      .from("orders")
      .select("status")
      .eq("status", "failed")
      .gt("created_at", new Date(Date.now() - 15 * 60000).toISOString());
    if (provider !== "All") query = query.ilike("description", `%${provider}%`);

    const { data: failures } = await query;
    const failureCount = failures?.length || 0;

    if (failureCount > 5) {
      return `${provider} seems to be having major issues (5+ failures in 15m). Suggest Telecel as an alternative.`;
    }
    if (failureCount > 2) {
      return `${provider} is experiencing slight delays. Recommend trying again in a few minutes.`;
    }
    return `${provider} systems appear stable.`;
  }

  if (name === "get_business_performance") {
    if (!authUser || !dbProfile?.is_agent) {
      return "Unauthorized: Only Agents can access business performance metrics.";
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: sales } = await supabase
      .from("orders")
      .select("amount")
      .eq("agent_id", authUser.id)
      .eq("status", "fulfilled")
      .gt("created_at", today.toISOString());

    const totalRevenue = sales?.reduce((sum: number, t: any) => sum + Number(t.amount), 0) || 0;
    const orderCount = sales?.length || 0;
    return `Today's Stats: Revenue: ${totalRevenue.toFixed(2)} GHS, Orders: ${orderCount}. (Calculated from completed transactions since midnight).`;
  }

  if (name === "get_agent_network_summary") {
    if (!authUser || !dbProfile?.is_agent) {
      return "Unauthorized: Only Master Agents can access network summaries.";
    }
    const { data: subAgents } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .eq("parent_agent_id", authUser.id);

    const count = subAgents?.length || 0;
    let totalNetworkBalance = 0;
    if (count > 0) {
      const subAgentIds = subAgents.map((a: any) => a.user_id);
      const { data: wallets } = await supabase
        .from("wallets")
        .select("balance")
        .in("agent_id", subAgentIds);
      totalNetworkBalance = wallets?.reduce((sum: number, w: any) => sum + Number(w.balance), 0) || 0;
    }
    return `Network Summary: You have ${count} active sub-agents with a combined wallet balance of ${totalNetworkBalance.toFixed(2)} GHS.`;
  }

  if (name === "purchase_data_bundle") {
    const { network, phone_number, package_size } = input || {};
    if (!authUser || !dbProfile) {
      return "Purchase failed: User must be logged in to purchase data.";
    }
    try {
      const { data: pkg } = await supabaseAdmin
        .from("global_package_settings")
        .select("public_price, agent_price, sub_agent_price")
        .eq("network", network)
        .ilike("package_size", package_size)
        .maybeSingle();

      if (!pkg) {
        return `Purchase failed: Could not find a package matching "${package_size}" for ${network}.`;
      }
      const amount = dbProfile.is_agent ? (pkg.agent_price || pkg.public_price) : pkg.public_price;

      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wallet-buy-data`, {
        method: "POST",
        headers: {
          "Authorization": req.headers.get("Authorization") || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          network,
          package_size,
          customer_phone: phone_number,
          amount,
          reference: crypto.randomUUID(),
        }),
      });

      const buyData = await res.json();
      if (buyData.error) {
        return `Purchase failed: ${buyData.error}`;
      }
      return `Purchase successful! Order ID: ${buyData.order_id}. The ${network} ${package_size} bundle for ${phone_number} is processing and will be delivered shortly.`;
    } catch (err: any) {
      return `Purchase failed due to system error: ${err.message}`;
    }
  }

  if (name === "investigate_dispute") {
    const { order_id, phone_number } = input || {};

    if (isJudgeMode) {
      if (!order_id) {
        return "Judge investigation failed: order_id is required.";
      }
      try {
        const { data: order, error: orderErr } = await supabaseAdmin
          .from("orders")
          .select("*")
          .eq("id", order_id)
          .maybeSingle();

        if (orderErr || !order) {
          return `Order ${order_id} not found in database.`;
        }

        let recentLogs: any[] = [];
        try {
          const { data: logs } = await supabaseAdmin
            .from("system_logs")
            .select("level, source, event, message, data, created_at")
            .ilike("message", `%${order_id}%`)
            .order("created_at", { ascending: false })
            .limit(10);
          recentLogs = logs || [];
        } catch (_logErr) {
          // Non-critical if system_logs query fails
        }

        return JSON.stringify({
          order: {
            id: order.id,
            agent_id: order.agent_id,
            status: order.status,
            network: order.network,
            package_size: order.package_size,
            customer_phone: order.customer_phone,
            amount: order.amount,
            payment_method: order.payment_method,
            paystack_verified_amount: order.paystack_verified_amount,
            auto_refunded: order.auto_refunded,
            failure_reason: order.failure_reason,
            provider_reference: order.provider_reference,
            provider_response: order.provider_response,
            created_at: order.created_at,
            updated_at: order.updated_at,
          },
          logs: recentLogs,
        });
      } catch (err: any) {
        return "Judge investigation failed due to an error: " + err.message;
      }
    }

    if (!authUser || !dbProfile) {
      return "Investigation failed: User not authenticated.";
    }
    try {
      let query = supabaseAdmin.from("orders").select("*").eq("agent_id", authUser.id);
      if (order_id) query = query.eq("id", order_id);
      else if (phone_number) query = query.eq("customer_phone", phone_number).order("created_at", { ascending: false }).limit(1);
      else throw new Error("Need an order ID or phone number to investigate.");

      const { data: orders } = await query;
      const order = orders?.[0];

      if (!order || order.agent_id !== authUser.id) {
        return "Could not find any recent order matching those details in your account.";
      }

      const hasProofOfPayment =
        order.payment_method === "wallet" || Number(order.paystack_verified_amount || 0) > 0;

      if (order.status === "fulfilled") {
        return `Order ${order.id.slice(0, 8)} for ${order.network} ${order.package_size} shows as successfully fulfilled by the provider. No refund can be issued automatically. Please contact support if the customer insists they didn't receive it.`;
      }
      if (order.status === "refunded" || order.auto_refunded) {
        return `Order ${order.id.slice(0, 8)} has already been refunded to your wallet.`;
      }
      if (order.status === "failed" || order.status === "fulfillment_failed") {
        if (!hasProofOfPayment) {
          return `Order ${order.id.slice(0, 8)} failed before payment was completed, so no refund is applicable.`;
        }
        const { data: claimedOrder, error: claimErr } = await supabaseAdmin
          .from("orders")
          .update({ status: "refunded", auto_refunded: true })
          .eq("id", order.id)
          .eq("agent_id", authUser.id)
          .in("status", ["failed", "fulfillment_failed"])
          .is("auto_refunded", false)
          .select("id")
          .maybeSingle();

        if (claimErr || !claimedOrder) {
          return `Order ${order.id.slice(0, 8)} has already been refunded to your wallet.`;
        }
        const { error: refundErr } = await supabaseAdmin.rpc("credit_wallet", {
          p_agent_id: authUser.id,
          p_amount: order.amount,
        });
        if (!refundErr) {
          return `Confirmed! Order ${order.id.slice(0, 8)} failed. I have automatically refunded ${order.amount} GHS to your wallet.`;
        }
        return `Order ${order.id.slice(0, 8)} failed, but I couldn't process the refund automatically. An admin has been notified.`;
      }

      const verifyRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/verify-payment`, {
        method: "POST",
        headers: {
          "Authorization": req.headers.get("Authorization") || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reference: order.id }),
      });
      const verifyData = await verifyRes.json();

      if (verifyData.status === "fulfilled") {
        return `I checked the live provider logs. Order ${order.id.slice(0, 8)} was actually successful! The status has been updated.`;
      }
      if (verifyData.status === "failed" || verifyData.status === "fulfillment_failed" || verifyData.status === "refunded") {
        return `I checked the live provider logs and the order failed. Any eligible refund is processed automatically by the payment verifier.`;
      }
      return `Order ${order.id.slice(0, 8)} is still marked as '${verifyData.status || order.status}'. The provider is still processing it. Please check back in a few minutes.`;
    } catch (err: any) {
      return "Investigation failed due to an error: " + err.message;
    }
  }

  if (name === "execute_resolution") {
    if (!isJudgeMode) {
      return "Unauthorized: execute_resolution is only available in AI Judge mode.";
    }
    const { order_id, judgment, reasoning } = input || {};
    if (!order_id || !judgment || !reasoning) {
      return "execute_resolution requires order_id, judgment, and reasoning.";
    }
    if (!["REFUND", "REJECT", "MANUAL_REVIEW"].includes(judgment)) {
      return `Invalid judgment "${judgment}". Must be REFUND, REJECT, or MANUAL_REVIEW.`;
    }

    try {
      const { data: order } = await supabaseAdmin
        .from("orders")
        .select("*")
        .eq("id", order_id)
        .maybeSingle();

      if (!order) {
        return `Resolution failed: Order ${order_id} not found.`;
      }

      let outcomeMsg = "";
      if (judgment === "REFUND") {
        const hasProofOfPayment =
          order.payment_method === "wallet" || Number(order.paystack_verified_amount || 0) > 0;
        if (!hasProofOfPayment) {
          outcomeMsg = `REFUND blocked for order ${order.id}: no verified proof of payment. Escalated to MANUAL_REVIEW.`;
        } else if (order.status === "refunded" || order.auto_refunded) {
          outcomeMsg = `Order ${order.id} was already refunded.`;
        } else {
          const { data: claimedOrder, error: claimErr } = await supabaseAdmin
            .from("orders")
            .update({ status: "refunded", auto_refunded: true })
            .eq("id", order.id)
            .is("auto_refunded", false)
            .neq("status", "refunded")
            .select("id")
            .maybeSingle();

          if (claimErr || !claimedOrder) {
            outcomeMsg = `Order ${order.id} was already refunded or could not be claimed.`;
          } else if (order.agent_id) {
            const { error: refundErr } = await supabaseAdmin.rpc("credit_wallet", {
              p_agent_id: order.agent_id,
              p_amount: order.amount,
            });
            outcomeMsg = refundErr
              ? `Order ${order.id} marked refunded, but wallet credit failed: ${refundErr.message}`
              : `REFUND executed: Credited ${order.amount} GHS to agent ${order.agent_id} for order ${order.id}.`;
          } else {
            outcomeMsg = `Order ${order.id} marked refunded (no agent_id to credit).`;
          }
        }
      } else {
        outcomeMsg = `Judgment ${judgment} recorded for order ${order.id}.`;
      }

      try {
        await supabaseAdmin.from("system_logs").insert({
          level: judgment === "MANUAL_REVIEW" ? "warning" : "info",
          source: "oracle-ai-judge",
          event: "ai_judge.resolution",
          message: `Dispute ${order.id}: ${judgment} — ${reasoning}`,
          data: { order_id: order.id, judgment, reasoning, outcome: outcomeMsg },
        });
      } catch (_logErr) {
        // Non-critical
      }

      return outcomeMsg;
    } catch (err: any) {
      return `execute_resolution failed: ${err.message}`;
    }
  }

  return `Unknown tool: ${name}`;
}

interface LoopResult {
  text: string;
  raw: any;
  toolExecuted: boolean;
}

async function runOpenAILoop(
  apiKey: string,
  model: string,
  systemPrompt: string,
  initialMessages: { role: string; content: string }[],
  tools: ToolDef[],
  maxTokens: number,
  execTool: (name: string, input: any) => Promise<string>,
  maxIterations = 5
): Promise<LoopResult> {
  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...initialMessages,
  ];
  const openAiTools = toOpenAITools(tools);
  let toolExecuted = false;
  let lastData: any = null;

  for (let iter = 0; iter < maxIterations; iter++) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages,
        tools: openAiTools,
        tool_choice: "auto",
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("OpenAI error:", errText);
      const err: any = new Error(`OpenAI Error: ${response.status} - ${errText}`);
      err.toolExecuted = toolExecuted;
      throw err;
    }

    const data = await response.json();
    lastData = data;
    const assistantMsg = data?.choices?.[0]?.message;
    if (!assistantMsg) {
      throw new Error("Empty response from OpenAI");
    }

    const toolCalls = assistantMsg.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: assistantMsg.content ?? null,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const fnName = tc.function?.name || "";
        let parsedArgs: any = {};
        try {
          parsedArgs = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedArgs = {};
        }
        toolExecuted = true;
        const toolResult = await execTool(fnName, parsedArgs);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult,
        });
      }
      continue;
    }

    return {
      text: (assistantMsg.content || "").trim(),
      raw: data,
      toolExecuted,
    };
  }

  // Final pass without tools if max iterations reached after tool calls
  const finalRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages,
    }),
  });
  if (finalRes.ok) {
    const finalData = await finalRes.json();
    const finalText = (finalData?.choices?.[0]?.message?.content || "").trim();
    return { text: finalText || "I've processed that for you!", raw: finalData, toolExecuted };
  }

  return { text: "I've processed that for you!", raw: lastData, toolExecuted };
}

async function runAnthropicLoop(
  apiKey: string,
  model: string,
  systemPrompt: string,
  initialMessages: { role: string; content: string }[],
  tools: ToolDef[],
  maxTokens: number,
  execTool: (name: string, input: any) => Promise<string>,
  maxIterations = 5
): Promise<LoopResult> {
  const messages: any[] = [...initialMessages];
  let toolExecuted = false;
  let lastData: any = null;

  for (let iter = 0; iter < maxIterations; iter++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
        tools,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("Anthropic error:", errText);
      throw new Error(`Anthropic Error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    lastData = data;

    if (data.stop_reason === "tool_use" && Array.isArray(data.content)) {
      const toolUses = data.content.filter((c: any) => c.type === "tool_use");
      if (toolUses.length > 0) {
        messages.push({ role: "assistant", content: data.content });
        const toolResults: any[] = [];
        for (const tu of toolUses) {
          toolExecuted = true;
          const result = await execTool(tu.name, tu.input || {});
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: result,
          });
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }
    }

    const text = Array.isArray(data.content)
      ? data.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim()
      : "";
    return { text, raw: data, toolExecuted };
  }

  return { text: "I've processed that for you!", raw: lastData, toolExecuted };
}

async function runModelWithFallback(params: {
  openAiKey: string;
  anthropicKey: string;
  openAiModel: string;
  anthropicModel: string;
  systemPrompt: string;
  messages: { role: string; content: string }[];
  tools: ToolDef[];
  maxTokens: number;
  execTool: (name: string, input: any) => Promise<string>;
}): Promise<LoopResult> {
  const {
    openAiKey,
    anthropicKey,
    openAiModel,
    anthropicModel,
    systemPrompt,
    messages,
    tools,
    maxTokens,
    execTool,
  } = params;

  if (openAiKey) {
    try {
      return await runOpenAILoop(
        openAiKey,
        openAiModel,
        systemPrompt,
        messages,
        tools,
        maxTokens,
        execTool
      );
    } catch (err: any) {
      // Only fall back to Anthropic if no tool side-effects have executed yet
      if (anthropicKey && !err?.toolExecuted) {
        console.warn("[oracle-ai] OpenAI failed before tool execution; falling back to Anthropic:", err.message);
        return await runAnthropicLoop(
          anthropicKey,
          anthropicModel,
          systemPrompt,
          messages,
          tools,
          maxTokens,
          execTool
        );
      }
      throw err;
    }
  }

  return await runAnthropicLoop(
    anthropicKey,
    anthropicModel,
    systemPrompt,
    messages,
    tools,
    maxTokens,
    execTool
  );
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!OPENAI_API_KEY && !ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({
        oracle_opinion: "AI assistant is not configured yet. Please contact support.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const event = body?.event;
    const userMessage: string = body?.context?.userMessage || body?.message || "";
    const history: { role: string; content: string }[] = body?.history || [];

    const authHeader = req.headers.get("Authorization");
    const bearerToken = authHeader?.replace(/^Bearer\s+/i, "").trim() || "";
    const isServiceRole = Boolean(
      bearerToken && SUPABASE_SERVICE_ROLE_KEY && timingSafeEqual(bearerToken, SUPABASE_SERVICE_ROLE_KEY)
    );
    let authUser: any = null;
    let dbProfile: any = null;
    if (bearerToken && !isServiceRole) {
      const { data: authData } = await supabaseAdmin.auth.getUser(bearerToken);
      authUser = authData?.user ?? null;
      if (authUser?.id) {
        const { data: profData } = await supabaseAdmin
          .from("profiles")
          .select("*")
          .eq("user_id", authUser.id)
          .maybeSingle();
        dbProfile = profData;
      }
    }

    // ━━━ Event-Driven Triggers (AI Dispute Judge) ━━━
    if (event === "new_dispute") {
      if (!isServiceRole) {
        return new Response(JSON.stringify({ error: "Unauthorized: Service role key required for dispute judge" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { order_id, reason } = body;
      console.log(`[Oracle AI] New Dispute Triggered: Order ${order_id}`);

      const judgeSystemPrompt = `${SYSTEM_PROMPT}\n\n━━━ JUDGE DIRECTIVE ━━━\nYou are now in JUDGE MODE. Use the investigate_dispute tool to see the provider logs. If the provider says "Success" but the user says "Failed", check the timestamps. If the provider response is missing, issue a REFUND. Always call execute_resolution once you have reached a final judgment.`;

      const judgeMessages = [
        {
          role: "user",
          content: `ACT AS AI JUDGE. A new dispute has been filed for Order ID: ${order_id}. Reason: "${reason}". Investigate the logs and provide a final judgment: REFUND, REJECT, or MANUAL_REVIEW.`,
        },
      ];

      const judgeResult = await runModelWithFallback({
        openAiKey: OPENAI_API_KEY,
        anthropicKey: ANTHROPIC_API_KEY,
        openAiModel: "gpt-4o",
        anthropicModel: "claude-sonnet-4-5-20250929",
        systemPrompt: judgeSystemPrompt,
        messages: judgeMessages,
        tools: JUDGE_TOOLS,
        maxTokens: 1000,
        execTool: (name, input) =>
          executeTool(name, input, {
            supabaseAdmin,
            authUser: null,
            dbProfile: null,
            req,
            isJudgeMode: true,
          }),
      });

      return new Response(
        JSON.stringify({
          status: "dispute_investigated",
          oracle_opinion: judgeResult.text,
          result: judgeResult.raw,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!userMessage && !event) {
      return new Response(JSON.stringify({ error: "userMessage or event required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ghanaTime = new Date().toLocaleString("en-GB", { timeZone: "Africa/Accra", dateStyle: "full", timeStyle: "short" });
    let superContext = `\nSYSTEM AWARENESS: The current local time in Ghana is ${ghanaTime}.`;

    if (dbProfile && authUser) {
      let liveBalance = dbProfile.wallet_balance;

      const { data: walletData } = await supabaseAdmin
        .from("wallets")
        .select("balance")
        .eq("agent_id", authUser.id)
        .maybeSingle();
      if (walletData) {
        liveBalance = walletData.balance;
      }

      superContext += `\nAUTHENTICATED USER PROFILE: Name: ${dbProfile.full_name || "Customer"}, Balance: ${liveBalance ?? "0.00"} GHS, Role: ${dbProfile.is_agent ? "Agent" : "Customer"}, Loyalty Points: ${dbProfile.loyalty_points ?? 0}.`;

      const { data: recentOrders } = await supabaseAdmin
        .from("orders")
        .select("id, amount, status, customer_phone, network, package_size, created_at")
        .eq("agent_id", authUser.id)
        .order("created_at", { ascending: false })
        .limit(5);

      if (recentOrders && recentOrders.length > 0) {
        superContext += "\nRECENT TRANSACTIONS:";
        recentOrders.forEach((o: any) => {
          superContext += `\n- ${o.network || ""} ${o.package_size || ""} of ${o.amount} GHS for ${o.customer_phone || "N/A"}. Status: ${o.status}. Created: ${o.created_at}`;
        });
      }
    } else {
      superContext += `\nUSER PROFILE: Guest / Unauthenticated Visitor. No wallet or order history available.`;
    }

    const messages = [
      ...history.map((h: any) => ({ role: h.role === "bot" ? "assistant" : "user", content: h.content })),
      { role: "user", content: `${superContext}\n\nUSER MESSAGE: ${userMessage}` },
    ];

    const chatResult = await runModelWithFallback({
      openAiKey: OPENAI_API_KEY,
      anthropicKey: ANTHROPIC_API_KEY,
      openAiModel: "gpt-4o-mini",
      anthropicModel: "claude-sonnet-4-5-20250929",
      systemPrompt: SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
      maxTokens: 800,
      execTool: (name, input) =>
        executeTool(name, input, {
          supabaseAdmin,
          authUser,
          dbProfile,
          req,
          isJudgeMode: false,
        }),
    });

    const oracle_opinion = chatResult.text || "I'm here to help!";

    return new Response(JSON.stringify({ oracle_opinion }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("oracle-ai error:", error);
    return new Response(JSON.stringify({
      oracle_opinion: "ERROR: " + error.message,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
