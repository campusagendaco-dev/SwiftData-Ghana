import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  sendWhatsAppMessage,
  sendWaSenderMessage,
  sendWatiFileViaUrl,
  checkIsOnWhatsApp,
  getWaSenderStatus,
  getWaSenderGroups,
  getWaSenderSessions,
  connectWaSenderSession,
  disconnectWaSenderSession,
  normalizePhone
} from "../_shared/whatsapp.ts";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Progressive Queue Batch Processor
async function processQueueBatch(supabaseAdmin: any, targetBroadcastId?: string, maxBatchCycles = 5) {
  let cycle = 0;
  let totalProcessed = 0;

  while (cycle < maxBatchCycles) {
    cycle++;
    // Atomically claim the next batch of 20 items
    const { data: batch, error: claimError } = await supabaseAdmin.rpc(
      "fetch_next_whatsapp_broadcast_batch",
      { p_batch_size: 20 }
    );

    if (claimError) {
      console.error("[WA Queue Worker] Error claiming batch:", claimError);
      break;
    }

    if (!batch || batch.length === 0) {
      console.log("[WA Queue Worker] No more pending items in queue.");
      break;
    }

    console.log(`[WA Queue Worker] Processing batch ${cycle} (${batch.length} items)...`);

    for (const item of batch) {
      const phone = normalizePhone(item.recipient_phone) || item.recipient_phone.replace(/\D/g, "");
      const opts = item.options || {};
      let success = false;
      let errMsg: string | null = null;

      try {
        // Anti-Ban Safeguard 1: Verify user hasn't opted out via STOP
        const { data: optOut } = await supabaseAdmin
          .from("whatsapp_opt_outs")
          .select("phone")
          .or(`phone.eq.${phone},phone.eq.0${phone.slice(3)}`)
          .maybeSingle();

        if (optOut) {
          console.log(`[WA Queue Worker] Skipping opted-out recipient ${phone}`);
          await supabaseAdmin.from("whatsapp_broadcast_queue").update({
            status: "skipped",
            error_message: "User opted out of automated WhatsApp announcements (STOP)",
            updated_at: new Date().toISOString()
          }).eq("id", item.id);
          continue;
        }

        // Anti-Ban Safeguard 2: Include soft opt-out footer to avoid Spam reporting
        let finalMessage = item.message;
        if (!finalMessage.toLowerCase().includes("stop")) {
          finalMessage = `${finalMessage.trim()}\n\n_Reply STOP to unsubscribe_`;
        }

        // 1. Send text message
        const textResult = await sendWhatsAppMessage(phone, finalMessage);
        
        // Check for session disconnection error from Wasender
        if (textResult?.data?.message?.includes?.("Session is not connected") || 
            textResult?.error?.includes?.("Session is not connected")) {
          errMsg = "WhatsApp Session is disconnected in Wasender";
          console.warn(`[WA Queue Worker] Session disconnected detected for ${phone}. Pausing queue.`);
          
          await supabaseAdmin.from("whatsapp_broadcast_queue").update({
            status: "pending", // Revert to pending so it can resume once reconnected
            updated_at: new Date().toISOString()
          }).eq("id", item.id);

          await supabaseAdmin.from("system_logs").insert({
            level: "error",
            source: "whatsapp_broadcast_queue",
            event: "whatsapp.session_disconnected",
            message: "Broadcast paused: WhatsApp Session is disconnected in Wasender. Reconnect in Wasender dashboard.",
            data: { phone, broadcast_id: item.broadcast_id }
          });

          return; // Stop processing further until reconnected
        }

        success = Boolean(textResult);

        // 2. Dispatch Media Attachment if configured
        if (opts.imageUrl || opts.videoUrl || opts.documentUrl || opts.audioUrl || opts.stickerUrl) {
          await sendWaSenderMessage(phone, undefined, {
            imageUrl: opts.imageUrl,
            videoUrl: opts.videoUrl,
            documentUrl: opts.documentUrl,
            fileName: opts.fileName,
            audioUrl: opts.audioUrl,
            stickerUrl: opts.stickerUrl,
          }).catch((mediaErr) => console.warn(`[WA Queue Worker] Media dispatch warning for ${phone}:`, mediaErr));
        }

        // Mark as sent
        await supabaseAdmin.from("whatsapp_broadcast_queue").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq("id", item.id);

        totalProcessed++;

        // Anti-Spam Humanized Pacing: 3200ms - 6800ms randomized jitter between sends
        const jitterMs = 3200 + Math.floor(Math.random() * 3600);
        await new Promise((r) => setTimeout(r, jitterMs));

      } catch (sendErr: any) {
        errMsg = sendErr?.message || String(sendErr);
        console.warn(`[WA Queue Worker] Failed to send to ${phone}:`, errMsg);
        
        await supabaseAdmin.from("whatsapp_broadcast_queue").update({
          status: "failed",
          error_message: errMsg,
          updated_at: new Date().toISOString()
        }).eq("id", item.id);
      }
    }

    // Brief cooldown pause between batches (15 seconds) to avoid Meta rate-limit blocks
    await new Promise((r) => setTimeout(r, 15000));
  }

  console.log(`[WA Queue Worker] Batch run completed. Total processed in cycle: ${totalProcessed}`);

  // Check if there are still pending messages. If so, trigger next worker invocation asynchronously
  const { count: pendingCount } = await supabaseAdmin
    .from("whatsapp_broadcast_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  if (pendingCount && pendingCount > 0) {
    console.log(`[WA Queue Worker] ${pendingCount} pending items remaining. Spawning next cycle...`);
    fetch(`${SUPABASE_URL}/functions/v1/admin-broadcast-whatsapp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ action: "process_queue" })
    }).catch((err) => console.warn("[WA Queue Worker] Error re-triggering queue worker:", err));
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));

    // Action: Live WhatsApp Session Status (from Wasender API)
    if (body.action === "session_status" || body.action === "status") {
      const sessionStatus = await getWaSenderStatus();
      return new Response(JSON.stringify(sessionStatus), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Action: Get Connected WhatsApp Groups (from Wasender API)
    if (body.action === "get_groups" || body.action === "groups") {
      const groupsResult = await getWaSenderGroups();
      return new Response(JSON.stringify(groupsResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Action: List WhatsApp Sessions (via WaSender Personal Access Token)
    if (body.action === "list_sessions" || body.action === "sessions") {
      let personalToken = Deno.env.get("WASENDER_PERSONAL_ACCESS_TOKEN") || Deno.env.get("WASENDER_TOKEN") || body.personal_token || "";
      if (!personalToken) {
        try {
          const { data: dbSecrets } = await Promise.resolve(
            supabaseAdmin.from("system_secrets").select("wasender_personal_token").eq("id", 1).maybeSingle()
          );
          personalToken = dbSecrets?.wasender_personal_token || "";
        } catch (_e) {
          // ignore
        }
      }
      const sessionsResult = await getWaSenderSessions(personalToken);
      return new Response(JSON.stringify(sessionsResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Action: Connect WhatsApp Session (QR Code or Passkey)
    // Endpoint: POST https://wasenderapi.com/api/whatsapp-sessions/{whatsappSession}/connect
    if (body.action === "connect_session" || body.action === "connect") {
      let personalToken = Deno.env.get("WASENDER_PERSONAL_ACCESS_TOKEN") || Deno.env.get("WASENDER_TOKEN") || body.personal_token || "";
      let sessionId = body.session_id || body.whatsappSession || Deno.env.get("WASENDER_SESSION_ID") || "";

      if (!personalToken || !sessionId) {
        try {
          const { data: dbSecrets } = await Promise.resolve(
            supabaseAdmin.from("system_secrets").select("wasender_personal_token, wasender_session_id").eq("id", 1).maybeSingle()
          );
          if (!personalToken && dbSecrets?.wasender_personal_token) {
            personalToken = dbSecrets.wasender_personal_token;
          }
          if (!sessionId && dbSecrets?.wasender_session_id) {
            sessionId = dbSecrets.wasender_session_id;
          }
        } catch (_e) {
          // ignore
        }
      }

      // If user passed a personal token, persist it to system_secrets for future calls
      if (body.personal_token || body.session_id) {
        const updateData: any = {};
        if (body.personal_token) updateData.wasender_personal_token = String(body.personal_token).trim();
        if (body.session_id) updateData.wasender_session_id = String(body.session_id).trim();
        try {
          await Promise.resolve(supabaseAdmin.from("system_secrets").update(updateData).eq("id", 1));
        } catch (_err) {
          // silent fail
        }
      }

      if (!personalToken) {
        return new Response(JSON.stringify({
          success: false,
          error: "Missing Personal Access Token. Please enter your personal access token from wasenderapi.com/settings/tokens."
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      // If session ID is not specified, auto-discover by querying sessions list
      if (!sessionId) {
        const sessionsResult = await getWaSenderSessions(personalToken);
        if (sessionsResult.success && sessionsResult.sessions && sessionsResult.sessions.length > 0) {
          sessionId = sessionsResult.sessions[0].id;
          // Also persist discovered session ID
          try {
            await Promise.resolve(supabaseAdmin.from("system_secrets").update({ wasender_session_id: String(sessionId) }).eq("id", 1));
          } catch (_e) {}
        } else {
          return new Response(JSON.stringify({
            success: false,
            error: "No WhatsApp sessions found on your WaSender account. Please create or verify your session on wasenderapi.com.",
            details: sessionsResult.error,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        }
      }

      const linkMethod = body.linkMethod === "passkey" ? "passkey" : "qr";
      const connectResult = await connectWaSenderSession(sessionId, personalToken, linkMethod);

      return new Response(JSON.stringify({
        ...connectResult,
        sessionId,
        linkMethod,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Action: Disconnect WhatsApp Session
    if (body.action === "disconnect_session" || body.action === "disconnect") {
      let personalToken = Deno.env.get("WASENDER_PERSONAL_ACCESS_TOKEN") || Deno.env.get("WASENDER_TOKEN") || body.personal_token || "";
      let sessionId = body.session_id || body.whatsappSession || Deno.env.get("WASENDER_SESSION_ID") || "";

      if (!personalToken || !sessionId) {
        try {
          const { data: dbSecrets } = await Promise.resolve(
            supabaseAdmin.from("system_secrets").select("*").eq("id", 1).maybeSingle()
          );
          personalToken = personalToken || dbSecrets?.wasender_personal_token || "";
          sessionId = sessionId || dbSecrets?.wasender_session_id || "";
        } catch (_e) {
          // ignore
        }
      }

      const disconnectResult = await disconnectWaSenderSession(sessionId, personalToken);
      return new Response(JSON.stringify(disconnectResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Action: Verify Contact on WhatsApp (Anti-Ban Validator)
    if (body.action === "check_on_whatsapp" || body.action === "check_whatsapp") {
      const targetContact = body.contact || body.phone || body.number || "";
      const checkResult = await checkIsOnWhatsApp(targetContact);
      return new Response(JSON.stringify(checkResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Action: Direct Broadcast to Selected WhatsApp Groups
    if (body.action === "broadcast_groups" || body.target_type === "groups") {
      const groupJids: string[] = Array.isArray(body.group_ids)
        ? body.group_ids
        : (body.group_id ? [body.group_id] : []);

      if (groupJids.length === 0) {
        return new Response(JSON.stringify({ error: "No target groups selected" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }

      const mediaOpts = {
        imageUrl: body.image_url,
        videoUrl: body.video_url,
        documentUrl: body.document_url,
        fileName: body.file_name,
        audioUrl: body.audio_url,
        stickerUrl: body.sticker_url,
      };

      const results = [];
      for (const gJid of groupJids) {
        try {
          const sent = await sendWaSenderMessage(gJid, body.message, mediaOpts);
          results.push({ id: gJid, sent });
        } catch (err: any) {
          results.push({ id: gJid, sent: false, error: err.message });
        }
        await new Promise((r) => setTimeout(r, 1500));
      }

      await supabaseAdmin.from("system_logs").insert({
        level: "info",
        source: "whatsapp_broadcast",
        event: "broadcast.groups_dispatched",
        message: `Dispatched WhatsApp broadcast to ${groupJids.length} groups via WaSender`,
        data: { groupJids, results, message: body.message?.slice(0, 100) }
      });

      return new Response(JSON.stringify({ success: true, count: groupJids.length, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Action: Standard Broadcast Dispatch (with progressive queueing)
    const {
      recipients, // array of phone numbers or user_ids
      title,
      message,
      sticker_url,
      image_url,
      video_url,
      document_url,
      file_name,
      audio_url,
      is_fire_alert,
      channel_url,
      site_url,
      verify_before_send = false,
      broadcast_to_channel = true,
      channel_jid,
    } = body;

    let phoneList: string[] = [];

    if (Array.isArray(recipients) && recipients.length > 0) {
      if (recipients[0].startsWith("0") || recipients[0].startsWith("233") || recipients[0].startsWith("+")) {
        phoneList = recipients;
      } else {
        // Fetch phone numbers for provided user_ids in batches of 500
        for (let i = 0; i < recipients.length; i += 500) {
          const chunk = recipients.slice(i, i + 500);
          const { data: profs } = await supabaseAdmin
            .from("profiles")
            .select("phone_number, whatsapp_number, phone")
            .in("user_id", chunk);

          (profs || []).forEach((p: any) => {
            const ph = p.whatsapp_number || p.phone_number || p.phone;
            if (ph) phoneList.push(ph);
          });
        }
      }
    } else if (body.broadcast_to_users === true || (body.segment && body.segment !== "none")) {
      // Broadcast to ALL users (fetching across all tables) ONLY if explicitly requested
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore && page < 10) {
        const { data: profs } = await supabaseAdmin
          .from("profiles")
          .select("phone_number, whatsapp_number, phone")
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (!profs || profs.length === 0) {
          hasMore = false;
        } else {
          profs.forEach((p: any) => {
            const ph = p.whatsapp_number || p.phone_number || p.phone;
            if (ph) phoneList.push(ph);
          });
          if (profs.length < pageSize) hasMore = false;
          page++;
        }
      }
    } else {
      // Default: Do NOT message individual phone numbers unless explicitly provided
      phoneList = [];
    }

    // Normalize and Deduplicate all recipient phones
    let uniquePhones = Array.from(
      new Set(
        phoneList
          .map((p) => normalizePhone(p) || p.replace(/\D/g, ""))
          .filter((p) => p && p.length >= 9)
      )
    );

    // Pre-Verification Anti-Ban Shield: Filter out numbers not registered on WhatsApp
    if (verify_before_send && uniquePhones.length > 0) {
      console.log(`[WhatsApp Broadcast] Pre-validating ${uniquePhones.length} contacts on WhatsApp...`);
      const validPhones: string[] = [];
      for (const phone of uniquePhones) {
        try {
          const check = await checkIsOnWhatsApp(phone);
          if (check.exists !== false) {
            validPhones.push(phone);
          } else {
            console.log(`[WhatsApp Broadcast] Filtered out non-WhatsApp number: ${phone}`);
          }
        } catch (_err) {
          validPhones.push(phone); // If check temporarily fails, keep phone to be safe
        }
      }
      uniquePhones = validPhones;
    }

    console.log(`[WhatsApp Broadcast] Enqueueing broadcast for ${uniquePhones.length} recipients...`);

    const defaultSiteUrl = site_url || "https://swiftdatagh.shop";
    const defaultChannelUrl = channel_url || "https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40";
    const defaultBotUrl = `https://wa.me/${Deno.env.get("WHATSAPP_BOT_NUMBER") || "233548942122"}?text=Hi`;
    const defaultStickerUrl = sticker_url || (is_fire_alert ? "https://swiftdatagh.shop/stickers/delivery_fire.webp" : undefined);

    // Delivery smoothness check from recent orders (last 60 minutes)
    let deliverySmoothHeader = "";
    if (body.check_delivery_smooth !== false) {
      try {
        const sixtyMinsAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recentOrders } = await supabaseAdmin
          .from("orders")
          .select("status")
          .gte("created_at", sixtyMinsAgo);

        const totalRecent = recentOrders?.length || 0;
        const fulfilled = (recentOrders || []).filter((o: any) => o.status === "fulfilled").length;
        const failed = (recentOrders || []).filter((o: any) => o.status === "fulfillment_failed").length;

        if (totalRecent >= 2 && (failed === 0 || fulfilled / totalRecent >= 0.8)) {
          deliverySmoothHeader = `⚡ *Delivery Status:* 100% Smooth & Instant! 🚀 All networks (MTN, Telecel, AirtelTigo, Korba) are fulfilling without delay.\n\n`;
        }
      } catch (smoothErr) {
        console.warn("[WhatsApp Broadcast] Error evaluating delivery smoothness:", smoothErr);
      }
    }

    const formattedMessage = is_fire_alert
      ? `🔥 *50+ ORDERS DELIVERED & COUNTING!* ⚡🚀\n\n` +
        `Our automated delivery engine is *100% ACTIVE*! Over *50 data bundles & telecom orders* have just been successfully fulfilled in real-time with zero delays! 🇬🇭✨\n\n` +
        `📶 *MTN Bundles* (SME, Retail, MashUp, Social, Midnight)\n` +
        `📶 *Telecel Bundles* (Instant automated top-ups)\n` +
        `📶 *AirtelTigo Bundles* (Instant data delivery)\n` +
        `📱 *Airtime Recharge* (All networks)\n` +
        `💡 *ECG & Utility Bills* (Prepaid tokens & postpaid)\n` +
        `🎓 *WAEC Result Checkers* (WASSCE & BECE PINs)\n\n` +
        `🤖 *Order on WhatsApp:* ${defaultBotUrl}\n` +
        `👉 *Order on Website:* ${defaultSiteUrl}\n` +
        `📢 *Official WhatsApp Channel:* ${defaultChannelUrl}\n\n` +
        `_Place your order now and receive it within seconds! 🚀💨_`
      : `${deliverySmoothHeader}${title ? `*${title}*\n\n` : ""}${message}\n\n🤖 *WhatsApp Bot:* ${defaultBotUrl}\n👉 *Order Website:* ${defaultSiteUrl}\n📢 *WhatsApp Channel:* ${defaultChannelUrl}`;

    // 1. Dispatch to Official WhatsApp Channel IMMEDIATELY
    // WhatsApp Channels have UNLIMITED bandwidth and ZERO risk of ban/disconnection
    let channelSent = false;
    const targetChannelJid = channel_jid || (broadcast_to_channel ? (Deno.env.get("WHATSAPP_CHANNEL_JID") || "120363425720623850@newsletter") : null);
    if (targetChannelJid) {
      try {
        channelSent = await sendWaSenderMessage(targetChannelJid, formattedMessage, {
          imageUrl: image_url,
          videoUrl: video_url,
          documentUrl: document_url,
          fileName: file_name,
          audioUrl: audio_url,
          stickerUrl: defaultStickerUrl,
        });
        console.log(`[WhatsApp Broadcast] Official channel broadcast to ${targetChannelJid}:`, channelSent);
      } catch (err: any) {
        console.warn(`[WhatsApp Broadcast] Failed to post to WhatsApp Channel:`, err?.message || err);
      }
    }

    // Stop here if fire alert or no individual recipients specified — never send to user numbers
    if (is_fire_alert || uniquePhones.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          channelSent,
          totalRecipients: 0,
          message: channelSent
            ? "Dispatched broadcast exclusively to Official WhatsApp Channel. No individual user numbers messaged."
            : "No individual recipients specified. Zero numbers contacted.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // 2. Enqueue all recipients into whatsapp_broadcast_queue in batches of 500
    const broadcastId = crypto.randomUUID();
    const mediaOptions = {
      imageUrl: image_url,
      videoUrl: video_url,
      documentUrl: document_url,
      fileName: file_name,
      audioUrl: audio_url,
      stickerUrl: defaultStickerUrl,
    };

    const queueRecords = uniquePhones.map((phone) => ({
      broadcast_id: broadcastId,
      recipient_phone: phone,
      message: formattedMessage,
      options: mediaOptions,
      status: "pending",
      attempts: 0,
    }));

    for (let i = 0; i < queueRecords.length; i += 500) {
      const chunk = queueRecords.slice(i, i + 500);
      const { error: insertErr } = await supabaseAdmin.from("whatsapp_broadcast_queue").insert(chunk);
      if (insertErr) {
        console.error("[WhatsApp Broadcast] Error enqueuing batch:", insertErr);
      }
    }

    // 3. Launch progressive worker via EdgeRuntime.waitUntil
    if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
      (globalThis as any).EdgeRuntime.waitUntil(processQueueBatch(supabaseAdmin, broadcastId));
    } else {
      processQueueBatch(supabaseAdmin, broadcastId);
    }

    // 4. Log the queued broadcast event
    await supabaseAdmin.from("system_logs").insert({
      level: "info",
      source: "whatsapp_broadcast",
      event: is_fire_alert ? "broadcast.delivery_fire_queued" : "broadcast.whatsapp_queued",
      message: `Enqueued progressive WhatsApp broadcast for ${uniquePhones.length} recipients (Broadcast ID: ${broadcastId}, Channel: ${channelSent ? "posted" : "skipped"})`,
      data: {
        broadcast_id: broadcastId,
        totalRecipients: uniquePhones.length,
        channelSent,
        pacing_seconds: "1.5s - 3.2s per recipient",
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        queued: true,
        broadcast_id: broadcastId,
        totalRecipients: uniquePhones.length,
        channelSent,
        message: `Queued ${uniquePhones.length} recipients for progressive, rate-limited delivery. Channel post ${channelSent ? "dispatched" : "skipped"}.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err: any) {
    console.error("[WhatsApp Broadcast] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
