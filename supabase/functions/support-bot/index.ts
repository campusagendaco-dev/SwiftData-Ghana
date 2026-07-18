import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

declare const Deno: any;

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const BOT_SENDER_ID = "00000000-0000-0000-0000-000000000001";

const ESCALATION_RE = /escalat|human support|support agent|follow up shortly|review.*conversation/i;

const BASE_SYSTEM_PROMPT = `You are SwiftBot — the human-level AI support agent for SwiftData Ghana, a mobile data and airtime reseller platform serving agents and customers across Ghana.

━━━ YOUR IDENTITY ━━━
You are not just a bot. You are SwiftBot — thoughtful, empathetic, and genuinely invested in solving people's problems. You combine the warmth of a great human support agent with the knowledge of a SwiftData expert. People should finish talking to you feeling helped, heard, and respected — not like they just dealt with a machine.

━━━ YOUR PERSONALITY ━━━
- Human first: You read between the lines. If someone says "this is the third time this is happening", you catch the frustration and address it — not just the literal question.
- Calm under pressure: If someone is upset or panicking, you slow things down, stay steady, and reassure them while working toward a solution.
- Precise but warm: You give clear, actionable answers without being robotic or cold. You sound like a smart colleague, not an FAQ page.
- Honest: If you don't know something or can't help, you say so clearly and immediately connect them to someone who can.
- Culturally grounded: You understand the Ghanaian context — MoMo transactions, network behaviors, the real-world pressure of running a data reselling business.

━━━ WHAT YOU HANDLE ━━━
- Data and airtime bundle purchases (MTN, Telecel, AirtelTigo)
- Failed or stuck orders — troubleshooting and retry guidance
- Wallet top-ups, balances, Paystack payment issues
- Withdrawal requests and MoMo payment status
- Agent and sub-agent onboarding, approval, and pricing
- Account settings, PIN resets, API access
- General platform navigation

━━━ HOW YOU RESPOND ━━━
- 2–4 sentences for simple questions; numbered steps for multi-step guidance
- Use the customer's name naturally when you know it
- Acknowledge emotions before jumping to solutions when frustration is present
- Be specific — "check your Orders page" is better than "check your account"
- Never say "Great question!" or "Certainly!" — just respond naturally and helpfully
- Offer a follow-up: "Is there anything else I can help you with?" when appropriate

━━━ ESCALATION ━━━
When a human must handle it (manual refund, account suspension, large missing payment, security issue), say exactly:
"I'll escalate this to a human support agent who will follow up shortly. A support agent will review your conversation and reply soon."

━━━ HARD RULES ━━━
- Never ask for or accept passwords, PINs, card numbers, or secret keys
- Never promise refunds — say the system processes automatically when relevant
- Order failures: system retries automatically; Retry button on Orders page is also available
- Wallet top-ups: reflect within 1–2 minutes after Paystack confirms
- Use the CUSTOMER LIVE CONTEXT (if available) to answer status queries. If an order is failed/pending, explain the status/reason and guide them on what to do (e.g. dial *170# option 6 to approve a pending MoMo checkout).

━━━ EMOTIONAL INTELLIGENCE ━━━
- Anger/frustration → "I completely understand why that's frustrating. Let's fix this right now."
- Worry/panic → "I hear you — let's take this step by step and get it sorted."
- Confusion → "No problem at all — let me explain this more simply."
- Repeated issue → "I'm really sorry you're experiencing this again. Let me make sure we get to the bottom of it."
- Gratitude → "So glad I could help! You're always welcome to reach out."`;

/** Fire-and-forget push notification to all admin users when bot escalates */
async function notifyAdmins(supabase: any, conversationId: string) {
  try {
    const { data: admins } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("is_admin", true);

    if (!admins?.length) return;

    const notifyUrl = `${SUPABASE_URL}/functions/v1/send-push-notification`;

    for (const admin of admins) {
      fetch(notifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          user_id: admin.user_id,
          title: "🔔 Support Escalation",
          body: "SwiftBot needs human help with a customer query. Check the support inbox.",
          url: "/admin/support",
          icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png",
        }),
      }).catch(() => {/* fire and forget */});
    }

    // Also create in-app notifications
    const notifications = admins.map((a: any) => ({
      user_id: a.user_id,
      title: "🔔 Support Escalation",
      message: `SwiftBot escalated a customer query in conversation ${conversationId}. Your reply is needed.`,
      type: "warning",
      data: { conversation_id: conversationId, url: "/admin/support" },
    }));
    await supabase.from("user_notifications").insert(notifications).catch(() => {});
  } catch (_e) {
    // Non-critical — proceed
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "AI not configured" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { conversation_id } = await req.json();

    if (!conversation_id) {
      return new Response(JSON.stringify({ error: "conversation_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the last 20 messages for context
    const { data: messages, error: msgErr } = await supabase
      .from("support_messages")
      .select("sender_id, content, created_at")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true })
      .limit(20);

    if (msgErr) throw msgErr;
    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ ok: false, reason: "No messages" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only respond if the last message is from the user (not the bot)
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.sender_id === BOT_SENDER_ID) {
      return new Response(JSON.stringify({ ok: false, reason: "Last message is already from bot" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the conversation owner's name for personalisation
    const { data: conv } = await supabase
      .from("support_conversations")
      .select("user_id")
      .eq("id", conversation_id)
      .maybeSingle();

    let userName = "there";
    let userContext = "";
    if (conv?.user_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", conv.user_id)
        .maybeSingle();
      if (profile?.full_name) userName = profile.full_name.split(" ")[0];

      // Fetch live user wallet balance and recent orders
      try {
        const [walletRes, ordersRes] = await Promise.all([
          supabase.from("wallets").select("balance, api_balance").eq("agent_id", conv.user_id).maybeSingle(),
          supabase.from("orders").select("id, status, customer_phone, network, amount, failure_reason, created_at, order_type").eq("agent_id", conv.user_id).order("created_at", { ascending: false }).limit(5)
        ]);

        const wallet = walletRes.data;
        const orders = ordersRes.data || [];

        userContext = `\n\nCUSTOMER LIVE CONTEXT:
* Current Main Wallet Balance: GHS ${wallet?.balance ?? 0}
* Current API Wallet Balance: GHS ${wallet?.api_balance ?? 0}
* Recent Orders:
${orders.map((o: any) => `  - Order ID: ${o.id} | Date: ${o.created_at} | Type: ${o.order_type} | Network: ${o.network} | Phone: ${o.customer_phone || 'N/A'} | Amount: GHS ${o.amount} | Status: ${o.status}${o.failure_reason ? ` | Failure Reason: "${o.failure_reason}"` : ''}`).join("\n")}
`;
      } catch (contextErr: any) {
        console.error("[support-bot] Failed to fetch customer context:", contextErr.message);
      }
    }

    // Fetch learned knowledge from admin replies for contextual accuracy
    let knowledgeContext = "";
    try {
      const { data: knowledge } = await supabase
        .from("ai_support_knowledge")
        .select("question, answer")
        .order("created_at", { ascending: false })
        .limit(6);

      if (knowledge && knowledge.length > 0) {
        knowledgeContext = `\n\nADMIN-VERIFIED ANSWERS (use these when a question is similar):\n${
          knowledge.map((k: any) => `Q: ${k.question}\nA: ${k.answer}`).join("\n\n")
        }`;
      }
    } catch (_e) {/* non-critical */}

    const systemPrompt = BASE_SYSTEM_PROMPT + knowledgeContext + userContext + `\n\nThe user's name is ${userName}.`;

    // Build Claude messages array
    const claudeMessages = messages.map((m: any) => ({
      role: m.sender_id === BOT_SENDER_ID ? "assistant" : "user",
      content: m.content,
    }));

    // Call Claude
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        system: systemPrompt,
        messages: claudeMessages,
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      console.error("[support-bot] Claude API error:", err);
      throw new Error(`Claude API error: ${claudeRes.status}`);
    }

    const claudeData = await claudeRes.json();
    const reply = claudeData?.content?.[0]?.text?.trim();
    if (!reply) throw new Error("Empty reply from Claude");

    // Insert bot reply
    const { error: insertErr } = await supabase
      .from("support_messages")
      .insert({
        conversation_id,
        sender_id: BOT_SENDER_ID,
        content: reply,
        is_bot: true,
      });

    if (insertErr) throw insertErr;

    // Update conversation last_message
    await supabase
      .from("support_conversations")
      .update({ last_message: reply, last_message_at: new Date().toISOString() })
      .eq("id", conversation_id);

    // Detect escalation → notify admins
    if (ESCALATION_RE.test(reply)) {
      notifyAdmins(supabase, conversation_id);
    }

    return new Response(JSON.stringify({ ok: true, reply, escalated: ESCALATION_RE.test(reply) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    console.error("[support-bot] Error:", err);
    return new Response(JSON.stringify({ error: (err as any)?.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
