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
const PUSH_ICON = "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png";

async function sendWebPush(payload: Record<string, unknown>) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        icon: PUSH_ICON,
        ...payload,
      }),
    });
  } catch (err) {
    console.warn("[auto-ticket-resolver] Push dispatch failed:", err);
  }
}

async function notifyAllAdmins(
  supabase: any,
  title: string,
  body: string,
  tag: string,
  requireInteraction = true
) {
  try {
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    const adminUserIds = [...new Set((adminRoles || []).map((r: any) => r.user_id).filter(Boolean))];
    if (adminUserIds.length === 0) return;

    await sendWebPush({
      user_ids: adminUserIds,
      title,
      body: body.length > 140 ? body.substring(0, 137) + "..." : body,
      url: "/admin/tickets",
      tag,
      requireInteraction,
    });
  } catch (err) {
    console.warn("[auto-ticket-resolver] Failed to alert admins:", err);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const cronSecret = (Deno.env.get("CRON_SECRET") || "").trim();
  const providedCron = (req.headers.get("x-cron-secret") || "").trim();
  const bearerToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  const isServiceRole = Boolean(
    SUPABASE_SERVICE_ROLE_KEY && bearerToken && timingSafeEqual(bearerToken, SUPABASE_SERVICE_ROLE_KEY)
  );
  const isCronAuthed = Boolean(
    isServiceRole || (cronSecret && providedCron && timingSafeEqual(providedCron, cronSecret))
  );

  try {
    const payload = await req.json().catch(() => ({}));

    // ── Action: Admin quick-reply / resolve with instant user Web Push notification ──
    if (payload?.action === "admin_reply") {
      if (!isCronAuthed) {
        const authRes = await verifyAdmin(req, supabase);
        if (!authRes.success) {
          return new Response(JSON.stringify({ error: authRes.error || "Unauthorized" }), {
            status: authRes.status || 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const ticketId = String(payload?.ticket_id || "").trim();
      const responseText = String(payload?.response || "").trim();
      const nextStatus = ["open", "in_progress", "resolved", "closed"].includes(payload?.status)
        ? payload.status
        : "resolved";

      if (!ticketId || !responseText) {
        return new Response(JSON.stringify({ error: "ticket_id and response are required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existingTicket, error: fetchErr } = await supabase
        .from("support_tickets")
        .select("id, user_id, subject")
        .eq("id", ticketId)
        .maybeSingle();

      if (fetchErr || !existingTicket) {
        return new Response(JSON.stringify({ error: "Ticket not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: updatedTicket, error: updateErr } = await supabase
        .from("support_tickets")
        .update({
          admin_response: responseText,
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", ticketId)
        .select("*")
        .single();

      if (updateErr) throw updateErr;

      if (existingTicket.user_id) {
        await sendWebPush({
          user_id: existingTicket.user_id,
          title: nextStatus === "resolved" ? "✅ Support Ticket Resolved" : "💬 Support Team Replied",
          body: responseText.length > 110 ? responseText.substring(0, 107) + "..." : responseText,
          url: "/dashboard/report-issue",
          tag: `ticket-reply-${ticketId}`,
          requireInteraction: true,
        });
      }

      return new Response(JSON.stringify({ success: true, ticket: updatedTicket }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Mode B: Auto-triage new ticket (Service Role, Admin, or Ticket Owner) ──
    const incomingTicketId = String(payload?.ticket_id || payload?.record?.id || "").trim();
    if (!incomingTicketId) {
      return new Response(JSON.stringify({ error: "Invalid payload: ticket_id or record.id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load authoritative ticket row from DB
    const { data: dbTicket } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("id", incomingTicketId)
      .maybeSingle();

    const ticket = dbTicket || payload?.record;
    if (!ticket || !ticket.id) {
      return new Response(JSON.stringify({ error: "Ticket not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorize caller: service role / cron, admin, OR the authenticated owner of this ticket
    if (!isCronAuthed) {
      let authorized = false;
      if (bearerToken) {
        const { data: authData } = await supabase.auth.getUser(bearerToken);
        if (authData?.user?.id && ticket.user_id && authData.user.id === ticket.user_id) {
          authorized = true;
        }
      }
      if (!authorized) {
        const authRes = await verifyAdmin(req, supabase);
        if (!authRes.success) {
          return new Response(JSON.stringify({ error: authRes.error || "Unauthorized" }), {
            status: authRes.status || 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Idempotency: skip if already resolved or already triaged by AI (unless force=true)
    if (!payload?.force && (ticket.status === "resolved" || ticket.status === "closed" || (ticket.status === "in_progress" && ticket.admin_response))) {
      return new Response(JSON.stringify({ success: true, skipped: true, status: ticket.status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    // If AI keys are not configured, still notify all admins immediately so no ticket is missed
    if (!OPENAI_API_KEY && !ANTHROPIC_API_KEY) {
      await notifyAllAdmins(
        supabase,
        "🚨 New Support Ticket",
        `${customerName}: ${ticket.subject}`,
        `ticket-urgent-${ticket.id}`,
        true
      );
      return new Response(JSON.stringify({ success: true, status: "open", admins_alerted: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch recent orders for forensic lookup (last 5)
    let recentOrdersText = "No recent orders found.";
    if (ticket.user_id) {
      const { data: orders } = await supabase
        .from("orders")
        .select("id, network, package_size, customer_phone, amount, status, created_at")
        .eq("agent_id", ticket.user_id)
        .order("created_at", { ascending: false })
        .limit(5);

      if (orders && orders.length > 0) {
        recentOrdersText = orders.map((o: any) =>
          `- Order ID: ${o.id}, Network: ${o.network || "N/A"} ${o.package_size || ""}, Phone: ${o.customer_phone || "N/A"}, Amount: GHS ${o.amount}, Status: ${o.status}, Date: ${new Date(o.created_at).toLocaleString()}`
        ).join("\n");
      }
    }

    // 3. Build the AI prompt
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
- If you find an order matching their complaint whose Status is exactly "refunded":
  * Tell them that order was refunded to their wallet and they can safely resubmit it, and set should_resolve to true.
- If the matching order's Status is failed or fulfillment_failed (NOT refunded):
  * Do NOT say it was refunded. Tell them the failure is recorded and the support team will review it, and set should_resolve to false.
- Otherwise, draft an intelligent, helpful next-step reply (e.g. telling them how to check Paystack top-up status, or telling them the support team has been alerted and is reviewing it now) and set should_resolve to false.
- Keep the response concise (2-4 sentences max).`;

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
              data: base64,
            },
          };
          console.log(`[auto-ticket-resolver] Base64 encoding succeeded. Media type: ${contentType}`);
        } else {
          console.error(`[auto-ticket-resolver] Failed to download image. Status: ${imageRes.status}`);
        }
      } catch (e) {
        console.error("[auto-ticket-resolver] Error base64 encoding image:", e);
      }
    }

    // 4. Call Unified AI Router
    const jsonSystemPrompt = `${systemPrompt}\n\n━━━ OUTPUT FORMAT ━━━\nRespond with RAW JSON only: {"reply":"your concise Ghanaian-style response","should_resolve":true|false}`;
    const userPromptText = imageBlock
      ? `Analyze the attached screenshot of the user's transaction/failed order, extract any transaction reference, status, amount, or error message, cross-reference with recent orders, and output JSON for ticket ID: ${ticket.id}`
      : `Generate the automated JSON response for ticket ID: ${ticket.id}`;

    let reply = "Hello! We have received your ticket and alerted our support team right away. An admin will respond shortly.";
    let shouldResolve = false;

    try {
      const aiRes = await callAiAgent(
        supabase,
        "auto_ticket_resolver",
        jsonSystemPrompt,
        userPromptText,
        600,
        {
          // Same model as on main; its own agent name so it doesn't use the ops worker's settings.
          forceModel: "claude-sonnet-4-5-20250929",
          responseJson: true,
          imageBase64: imageBlock?.source?.data,
          imageMediaType: imageBlock?.source?.media_type,
        }
      );

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
    } catch (aiErr) {
      console.error("[auto-ticket-resolver] AI triage error (falling back to admin alert):", aiErr);
    }

    // 5. Update Ticket in Database
    const finalStatus = shouldResolve ? "resolved" : "in_progress";
    const { error: updateErr } = await supabase
      .from("support_tickets")
      .update({
        admin_response: reply,
        status: finalStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticket.id);

    if (updateErr) throw updateErr;

    // 6. Send Web Push Notification to User + Alert ALL Admins
    const pushTasks: Promise<any>[] = [];

    if (ticket.user_id) {
      pushTasks.push(
        sendWebPush({
          user_id: ticket.user_id,
          title: shouldResolve ? "✅ Ticket Auto-Resolved" : "💬 Support Team Alerted",
          body: reply.length > 100 ? reply.substring(0, 97) + "..." : reply,
          url: "/dashboard/report-issue",
          tag: `ticket-user-${ticket.id}`,
          requireInteraction: shouldResolve,
        })
      );
    }

    if (shouldResolve) {
      pushTasks.push(
        notifyAllAdmins(
          supabase,
          "🤖 AI Auto-Resolved Ticket",
          `${customerName}: ${ticket.subject}`,
          `ticket-resolved-${ticket.id}`,
          false
        )
      );
    } else {
      pushTasks.push(
        notifyAllAdmins(
          supabase,
          "🚨 New Support Ticket Needs Action",
          `${customerName}: ${ticket.subject}`,
          `ticket-urgent-${ticket.id}`,
          true
        )
      );
    }

    await Promise.allSettled(pushTasks);

    return new Response(
      JSON.stringify({
        success: true,
        status: finalStatus,
        resolved_by_ai: shouldResolve,
        admins_alerted: true,
        reply,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("[auto-ticket-resolver] Fatal Error:", err);
    return new Response(JSON.stringify({ error: err?.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
