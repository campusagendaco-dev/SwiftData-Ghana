import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

declare const Deno: any;

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

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

const TOOLS = [
  {
    name: "get_loyalty_status",
    description: "Check the user's current loyalty points and redemption eligibility.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "redeem_points",
    description: "Convert all eligible loyalty points into wallet balance. (100 points = 1 GHS)",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "get_system_health",
    description: "Check the current status of mobile network providers (MTN, Telecel, AirtelTigo).",
    input_schema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["MTN", "Telecel", "AirtelTigo", "All"] }
      }
    }
  },
  {
    name: "get_business_performance",
    description: "Get today's total revenue and order count for the agent.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "get_agent_network_summary",
    description: "Get a summary of sub-agents and their combined wallet balance.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "purchase_data_bundle",
    description: "Purchase a data bundle for a specific phone number using the user's wallet. You MUST extract the network, phone number, and package size (e.g. '1GB', '500MB') from the user's message.",
    input_schema: {
      type: "object",
      properties: {
        network: { type: "string", enum: ["MTN", "Telecel", "AirtelTigo"] },
        phone_number: { type: "string", description: "The 10 digit recipient phone number" },
        package_size: { type: "string", description: "The package size, e.g. 1GB, 500MB, 10GB" }
      },
      required: ["network", "phone_number", "package_size"]
    }
  },
  {
    name: "investigate_dispute",
    description: "Investigate a specific data bundle order that the user claims failed. This tool checks the live provider status and automatically refunds the user's wallet if the provider confirms the failure. Requires the user's phone number or the specific order ID.",
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "The UUID of the order, if known." },
        phone_number: { type: "string", description: "The customer phone number the data was meant for." }
      }
    }
  },
  {
    name: "get_current_prices",
    description: "Fetch the live data bundle pricing table (wholesale and retail prices) for a specific network.",
    input_schema: {
      type: "object",
      properties: {
        network: { type: "string", enum: ["MTN", "Telecel", "AirtelTigo"] }
      },
      required: ["network"]
    }
  }
];

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Also alias supabaseAdmin as supabase so existing code referencing supabase works.
    const supabase = supabaseAdmin;

    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({
        oracle_opinion: "AI assistant is not configured yet. Please contact support.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const event = body?.event;
    const userMessage: string = body?.context?.userMessage || body?.message || "";
    const history: { role: string; content: string }[] = body?.history || [];
    const context = body?.context || {};
    
    // ━━━ NEW: Event-Driven Triggers (AI Judge) ━━━
    if (event === 'new_dispute') {
      const { order_id, reason } = body;
      console.log(`[Oracle AI] New Dispute Triggered: Order ${order_id}`);
      
      // Construct the internal reasoning prompt for the AI Judge
      const messages = [
        { role: "user", content: `ACT AS AI JUDGE. A new dispute has been filed for Order ID: ${order_id}. Reason: "${reason}". Investigate the logs and provide a final judgment: REFUND, REJECT, or MANUAL_REVIEW.` }
      ];

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 1000,
          system: `${SYSTEM_PROMPT}\n\n━━━ JUDGE DIRECTIVE ━━━\nYou are now in JUDGE MODE. Use the investigate_dispute tool to see the provider logs. If the provider says "Success" but the user says "Failed", check the timestamps. If the provider response is missing, issue a REFUND.`,
          messages,
          tools: [
            ...TOOLS,
            {
              name: "investigate_dispute",
              description: "Fetch deep logs and provider responses for a disputed order.",
              input_schema: {
                type: "object",
                properties: { order_id: { type: "string" } },
                required: ["order_id"]
              }
            },
            {
              name: "execute_resolution",
              description: "Finalize the dispute judgment. If REFUND, it credits the wallet.",
              input_schema: {
                type: "object",
                properties: {
                  order_id: { type: "string" },
                  judgment: { type: "string", enum: ["REFUND", "REJECT", "MANUAL_REVIEW"] },
                  reasoning: { type: "string" }
                },
                required: ["order_id", "judgment", "reasoning"]
              }
            }
          ],
        }),
      });

      const data = await response.json();
      // Handle tool usage in the background loop...
    }

    if (!userMessage && !event) {
      return new Response(JSON.stringify({ error: "userMessage or event required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    const ghanaTime = new Date().toLocaleString("en-GB", { timeZone: "Africa/Accra", dateStyle: "full", timeStyle: "short" });
    let superContext = `\nSYSTEM AWARENESS: The current local time in Ghana is ${ghanaTime}.`;
    
    if (context.profile) {
      const p = context.profile;
      let liveBalance = p.wallet_balance;
      
      // Self-healing database fallback to native wallets table if profiles column is missing
      if (p.user_id) {
        const { data: walletData } = await supabaseAdmin
          .from("wallets")
          .select("balance")
          .eq("agent_id", p.user_id)
          .maybeSingle();
        if (walletData) {
          liveBalance = walletData.balance;
        }
      }
      
      superContext += `\nUSER PROFILE: Name: ${p.full_name || 'Customer'}, Balance: ${liveBalance ?? '0.00'} GHS, Role: ${p.is_agent ? 'Agent' : 'Customer'}.`;
    }
    if (context.recentOrders && context.recentOrders.length > 0) {
      superContext += "\nRECENT TRANSACTIONS:";
      context.recentOrders.forEach((o: any) => {
        superContext += `\n- ${o.type} of ${o.amount} GHS for ${o.phone_number || 'N/A'}. Status: ${o.status}. Created: ${o.created_at}`;
      });
    }
    if (context.failedOrder) {
      const f = context.failedOrder;
      superContext += `\nCRITICAL: A transaction just failed! Type: ${f.type}, Amount: ${f.amount}, Provider: ${f.provider || 'Unknown'}, Error Log: ${f.error_message || 'No details'}. PROMPT: Proactively explain this to the user with empathy and suggest a fix.`;
    }

    const messages = [
      ...history.map((h: any) => ({ role: h.role === "bot" ? "assistant" : "user", content: h.content })),
      { role: "user", content: `${superContext}\n\nUSER MESSAGE: ${userMessage}` },
    ];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages,
        tools: TOOLS,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic error:", err);
      throw new Error(`Anthropic Error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    const message = data.content?.[0];

    // Handle Tool Use (Phase 2: Financial Actions)
    if (data.stop_reason === "tool_use") {
      const toolUse = data.content.find((c: any) => c.type === "tool_use");
      if (toolUse) {
        const { name, input } = toolUse;
        let toolResult = "";

        if (name === "get_current_prices") {
          const { network } = input;
          const { data: pkgs } = await supabaseAdmin.from("global_package_settings")
            .select("package_size, agent_price, public_price, is_unavailable")
            .eq("network", network)
            .order("agent_price", { ascending: true });
            
          if (!pkgs || pkgs.length === 0) {
            toolResult = `No pricing data found for ${network}.`;
          } else {
            toolResult = `Live ${network} Prices:\n` + pkgs.map((p: any) => 
              `- ${p.package_size}: ${p.is_unavailable ? 'UNAVAILABLE' : `Agent Price: ${p.agent_price} GHS, Retail: ${p.public_price} GHS`}`
            ).join('\n');
          }
        }
        else if (name === "get_loyalty_status") {
          const { data: profile } = await supabase.from("profiles").select("loyalty_points").eq("id", context.profile?.id).maybeSingle();
          toolResult = `User has ${profile?.loyalty_points || 0} loyalty points. 100 points = 1 GHS.`;
        } 
        else if (name === "redeem_points") {
          const pointsToRedeem = Math.max(100, Math.floor(context.profile?.loyalty_points || 0));
          if (pointsToRedeem < 100) {
            toolResult = "Redemption failed: User needs at least 100 points.";
          } else {
            const amountGHS = pointsToRedeem / 100;
            // Atomic transaction: Deduct points, add balance
            const { error: rpcError } = await supabase.rpc("redeem_loyalty_points_to_wallet", {
              user_id: context.profile?.id,
              points_amount: pointsToRedeem,
              credit_amount: amountGHS
            });
            toolResult = rpcError ? `Error: ${rpcError.message}` : `Success! Redeemed ${pointsToRedeem} points for ${amountGHS} GHS added to wallet.`;
          }
        }
        else if (name === "get_system_health") {
          // Check for recent failures in the last 15 mins for the provider
          const provider = input.provider || "All";
          const query = supabase.from("orders").select("status").eq("status", "failed").gt("created_at", new Date(Date.now() - 15 * 60000).toISOString());
          if (provider !== "All") query.ilike("description", `%${provider}%`);
          
          const { data: failures } = await query;
          const failureCount = failures?.length || 0;
          
          if (failureCount > 5) {
            toolResult = `${provider} seems to be having major issues (5+ failures in 15m). Suggest Telecel as an alternative.`;
          } else if (failureCount > 2) {
            toolResult = `${provider} is experiencing slight delays. Recommend trying again in a few minutes.`;
          } else {
            toolResult = `${provider} systems appear stable.`;
          }
        }
        else if (name === "get_business_performance") {
          if (!context.profile?.is_agent) {
            toolResult = "Unauthorized: Only Agents can access business performance metrics.";
          } else {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const { data: sales } = await supabase
              .from("orders")
              .select("amount")
              .eq("agent_id", context.profile.id)
              .eq("status", "fulfilled")
              .gt("created_at", today.toISOString());
            
            const totalRevenue = sales?.reduce((sum: number, t: any) => sum + Number(t.amount), 0) || 0;
            const orderCount = sales?.length || 0;
            toolResult = `Today's Stats: Revenue: ${totalRevenue.toFixed(2)} GHS, Orders: ${orderCount}. (Calculated from completed transactions since midnight).`;
          }
        }
        else if (name === "get_agent_network_summary") {
          if (!context.profile?.is_agent) {
            toolResult = "Unauthorized: Only Master Agents can access network summaries.";
          } else {
            const { data: subAgents } = await supabase
              .from("profiles")
              .select("id, full_name")
              .eq("referrer_id", context.profile.id);
            
            const count = subAgents?.length || 0;
            let totalNetworkBalance = 0;
            if (count > 0) {
              const subAgentIds = subAgents.map((a: any) => a.id);
              const { data: wallets } = await supabase
                .from("wallets")
                .select("balance")
                .in("agent_id", subAgentIds);
              totalNetworkBalance = wallets?.reduce((sum: number, w: any) => sum + Number(w.balance), 0) || 0;
            }
            toolResult = `Network Summary: You have ${count} active sub-agents with a combined wallet balance of ${totalNetworkBalance.toFixed(2)} GHS.`;
          }
        }
        else if (name === "purchase_data_bundle") {
          const { network, phone_number, package_size } = input;
          if (!context.profile) {
            toolResult = "Purchase failed: User must be logged in to purchase data.";
          } else {
            try {
              // Get the price
              const { data: pkg } = await supabaseAdmin.from("global_package_settings")
                .select("public_price, agent_price, sub_agent_price")
                .eq("network", network)
                .ilike("package_size", package_size)
                .maybeSingle();

              if (!pkg) {
                toolResult = `Purchase failed: Could not find a package matching "${package_size}" for ${network}.`;
              } else {
                const amount = context.profile.is_agent ? (pkg.agent_price || pkg.public_price) : pkg.public_price;
                
                // Call wallet-buy-data internally
                const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wallet-buy-data`, {
                  method: "POST",
                  headers: {
                    "Authorization": req.headers.get("Authorization") || "",
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    network,
                    package_size,
                    customer_phone: phone_number,
                    amount,
                    reference: crypto.randomUUID()
                  })
                });
                
                const buyData = await res.json();
                if (buyData.error) {
                  toolResult = `Purchase failed: ${buyData.error}`;
                } else {
                  toolResult = `Purchase successful! Order ID: ${buyData.order_id}. The ${network} ${package_size} bundle for ${phone_number} is processing and will be delivered shortly.`;
                }
              }
            } catch (err: any) {
              toolResult = `Purchase failed due to system error: ${err.message}`;
            }
          }
        }
        else if (name === "investigate_dispute") {
          const { order_id, phone_number } = input;
          if (!context.profile?.id) {
            toolResult = "Investigation failed: User not authenticated.";
          } else {
            try {
               let query = supabaseAdmin.from("orders").select("*").eq("agent_id", context.profile.id);
               if (order_id) query = query.eq("id", order_id);
               else if (phone_number) query = query.eq("customer_phone", phone_number).order("created_at", { ascending: false }).limit(1);
               else throw new Error("Need an order ID or phone number to investigate.");
               
               const { data: orders } = await query;
               const order = orders?.[0];
               
               if (!order) {
                 toolResult = "Could not find any recent order matching those details in your account.";
               } else {
                 if (order.status === "fulfilled") {
                   toolResult = `Order ${order.id.slice(0,8)} for ${order.network} ${order.package_size} shows as successfully fulfilled by the provider. No refund can be issued automatically. Please contact support if the customer insists they didn't receive it.`;
                 } else if (order.status === "failed" || order.status === "fulfillment_failed") {
                   // Ensure it's refunded
                   const { data: refundRes, error: refundErr } = await supabaseAdmin.rpc("credit_wallet", { p_agent_id: order.agent_id, p_amount: order.amount });
                   if (!refundErr) {
                     await supabaseAdmin.from("orders").update({ status: "refunded" }).eq("id", order.id);
                     toolResult = `Confirmed! Order ${order.id.slice(0,8)} failed. I have automatically refunded ${order.amount} GHS to your wallet.`;
                   } else {
                     toolResult = `Order ${order.id.slice(0,8)} failed, but I couldn't process the refund automatically. An admin has been notified.`;
                   }
                 } else if (order.status === "refunded") {
                   toolResult = `Order ${order.id.slice(0,8)} has already been refunded to your wallet.`;
                 } else {
                   // Call verify-payment to sync status
                   const verifyRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/verify-payment`, {
                     method: "POST", headers: { "Authorization": req.headers.get("Authorization") || "", "Content-Type": "application/json" },
                     body: JSON.stringify({ reference: order.id })
                   });
                   const verifyData = await verifyRes.json();
                   
                   if (verifyData.status === "fulfilled") {
                     toolResult = `I checked the live provider logs. Order ${order.id.slice(0,8)} was actually successful! The status has been updated.`;
                   } else if (verifyData.status === "failed" || verifyData.status === "fulfillment_failed") {
                     await supabaseAdmin.rpc("credit_wallet", { p_agent_id: order.agent_id, p_amount: order.amount });
                     await supabaseAdmin.from("orders").update({ status: "refunded" }).eq("id", order.id);
                     toolResult = `I checked the live provider logs and the order failed. I have automatically refunded ${order.amount} GHS to your wallet.`;
                   } else {
                     toolResult = `Order ${order.id.slice(0,8)} is still marked as '${verifyData.status || order.status}'. The provider is still processing it. Please check back in a few minutes.`;
                   }
                 }
               }
            } catch (err: any) {
               toolResult = "Investigation failed due to an error: " + err.message;
            }
          }
        }

        // Second pass to get the final response with the tool result
        const secondResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-5-20250929",
            max_tokens: 800,
            system: SYSTEM_PROMPT,
            messages: [
              ...messages,
              { role: "assistant", content: data.content },
              { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: toolResult }] }
            ],
            tools: TOOLS,
          }),
        });
        const secondData = await secondResponse.json();
        const oracle_opinion = secondData.content?.[0]?.text || "I've processed that for you!";
        return new Response(JSON.stringify({ oracle_opinion }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const oracle_opinion = message?.text || "I'm here to help!";

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
