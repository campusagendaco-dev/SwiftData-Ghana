import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { timingSafeEqual } from "../_shared/gateway-security.ts";
import { callAiAgent } from "../_shared/ai.ts";

declare const Deno: any;

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!OPENAI_API_KEY && !ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "AI not configured" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const cronSecret = (Deno.env.get("CRON_SECRET") || "").trim();
  const providedCron = (req.headers.get("x-cron-secret") || "").trim();
  const bearerToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  const isServiceRole = Boolean(SUPABASE_SERVICE_ROLE_KEY && bearerToken && timingSafeEqual(bearerToken, SUPABASE_SERVICE_ROLE_KEY));
  const isCronAuthed = Boolean(isServiceRole || (cronSecret && providedCron && timingSafeEqual(providedCron, cronSecret)));
  if (!isCronAuthed) {
    const authRes = await verifyAdmin(req, supabase, { checkMfa: false });
    if (!authRes.success) {
      return new Response(JSON.stringify({ error: authRes.error || "Unauthorized" }), {
        status: authRes.status || 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const payload = await req.json();
    const ticket = payload?.record;

    if (!ticket || !ticket.id) {
      return new Response(JSON.stringify({ error: "Invalid payload: record with id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch user context
    let customerName = "Valued Customer";
    let customerStore = "SwiftData Retailer";
    if (ticket.user_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, store_name")
        .eq("user_id", ticket.user_id)
        .maybeSingle();

      if (profile?.full_name) customerName = profile.full_name;
      if (profile?.store_name) customerStore = profile.store_name;
    }

    // 2. Fetch recent orders for forensic lookup (last 5)
    let recentOrdersText = "No recent orders found.";
    if (ticket.user_id) {
      const { data: orders } = await supabase
        .from("orders")
        .select("id, provider, phone_number, amount, status, created_at")
        .eq("user_id", ticket.user_id)
        .order("created_at", { ascending: false })
        .limit(5);

      if (orders && orders.length > 0) {
        recentOrdersText = orders.map((o: any) => 
          `- Order ID: ${o.id}, Network/Provider: ${o.provider}, Phone: ${o.phone_number}, Amount: GHS ${o.amount}, Status: ${o.status}, Date: ${new Date(o.created_at).toLocaleString()}`
        ).join("\n");
      }
    }

    // 3. Build the Claude prompt
    const systemPrompt = `You are Ama — the intelligent, culturally resonant, and warm Ghanaian AI Support Agent for SwiftData Ghana.
Your job is to automatically resolve and reply to customer support tickets filed via the dashboard.

━━━ CUSTOMER PROFILE ━━━
Name: ${customerName}
Store: ${customerStore}

━━━ RECENT CUSTOMER ORDERS (Last 5) ━━━
${recentOrdersText}

━━━ SUBMITTED TICKET ━━━
Subject: ${ticket.subject}
Description: ${ticket.description}

━━━ OPERATIONAL DIRECTIVES ━━━
- Ghanaian Warmth & Pidgin elements: sound warm, professional, but distinctively Ghanaian ("Chale", "No yawa", "Sorted").
- Check if they are complaining about a failed order. Cross-reference their complaint with the "RECENT CUSTOMER ORDERS" list.
- If you find a failed/refunded order matching their complaint:
  * Inform them that the system has already detected the failure and automatically refunded their wallet.
  * Assure them they can safely resubmit the order.
  * Decide to automatically close/resolve the ticket.
- Otherwise, draft an intelligent, helpful next-step reply (e.g. telling them how to check Paystack top-up status, or telling them the support team is investigating) and set should_resolve to false.
- Keep the response response concise (2-4 sentences max).`;

    // Fetch and base64-encode image if present
    let imageBlock: any = null;
    if (ticket.attachment_url) {
      try {
        console.log(`[auto-ticket-resolver] Downloading attachment: ${ticket.attachment_url}`);
        const imageRes = await fetch(ticket.attachment_url);
        if (imageRes.ok) {
          const arrayBuffer = await imageRes.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
          }
          const base64 = btoa(binary);
          const contentType = imageRes.headers.get("content-type") || "image/png";
          
          imageBlock = {
            type: "image",
            source: {
              type: "base64",
              media_type: contentType.includes("image/jpeg") ? "image/jpeg" : 
                          contentType.includes("image/webp") ? "image/webp" : 
                          contentType.includes("image/gif") ? "image/gif" : "image/png",
              data: base64
            }
          };
          console.log(`[auto-ticket-resolver] Base64 encoding succeeded. Media type: ${contentType}`);
        } else {
          console.error(`[auto-ticket-resolver] Failed to download image. Status: ${imageRes.status}`);
        }
      } catch (e) {
        console.error("[auto-ticket-resolver] Error base64 encoding image:", e);
      }
    }

    // 4. Call Unified AI Router (OpenAI primary with vision support, Anthropic/Gemini fallback)
    const jsonSystemPrompt = `${systemPrompt}\n\n━━━ OUTPUT FORMAT ━━━\nRespond with RAW JSON only: {"reply":"your concise Ghanaian-style response","should_resolve":true|false}`;
    const userPromptText = imageBlock
      ? `Analyze the attached screenshot of the user's transaction/failed order, extract any transaction reference, status, amount, or error message, cross-reference with recent orders, and output JSON for ticket ID: ${ticket.id}`
      : `Generate the automated JSON response for ticket ID: ${ticket.id}`;

    const aiRes = await callAiAgent(
      supabase,
      "ops_worker",
      jsonSystemPrompt,
      userPromptText,
      600,
      {
        responseJson: true,
        imageBase64: imageBlock?.source?.data,
        imageMediaType: imageBlock?.source?.media_type,
      }
    );

    let reply = "Hello! We have received your ticket and our support team is actively looking into it. We will update you shortly.";
    let shouldResolve = false;

    try {
      const raw = aiRes.text || "";
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        if (parsed.reply) reply = String(parsed.reply);
        shouldResolve = Boolean(parsed.should_resolve);
      } else if (raw.trim()) {
        reply = raw.trim();
      }
    } catch (_e) {
      console.error("[auto-ticket-resolver] Failed to parse AI JSON response:", _e);
    }

    // 6. Update Ticket in Database
    const finalStatus = shouldResolve ? "resolved" : "in_progress";
    const { error: updateErr } = await supabase
      .from("support_tickets")
      .update({
        admin_response: reply,
        status: finalStatus,
        updated_at: new Date().toISOString()
      })
      .eq("id", ticket.id);

    if (updateErr) throw updateErr;

    // 7. Send Push Notification to User (Fire and Forget)
    if (ticket.user_id) {
      fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          user_id: ticket.user_id,
          title: shouldResolve ? "🔔 Ticket Auto-Resolved" : "💬 Support Ticket Update",
          body: reply.length > 80 ? reply.substring(0, 77) + "..." : reply,
          url: "/tickets",
          icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png",
        }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ success: true, status: finalStatus, reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[auto-ticket-resolver] Fatal Error:", err);
    return new Response(JSON.stringify({ error: err?.message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
