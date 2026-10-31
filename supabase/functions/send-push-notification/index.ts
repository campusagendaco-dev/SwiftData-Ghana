import "../deno.d.ts";

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";

declare const Deno: any;

// SwiftData Secure VAPID Credentials
const DEFAULT_VAPID_PUBLIC = "BBunKshlnxwoqC83k7a01ApJwKgZ0L-QqEySWnz0EuJL1eS7lneeiKemLOQ9Z7DYD82KptTcbYjeQKaDNN1o5gM";

const cleanKey = (val: string | undefined): string =>
  (val || "").trim().replace(/^["']+|["']+$/g, "").trim();

const VAPID_PUBLIC_KEY = cleanKey(Deno.env.get("VAPID_PUBLIC_KEY")) || DEFAULT_VAPID_PUBLIC;
const VAPID_PRIVATE_KEY = cleanKey(Deno.env.get("VAPID_PRIVATE_KEY"));

let vapidInitialized = false;
let vapidInitError: string | null = null;

if (VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(
      "mailto:admin@swiftdatagh.shop",
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
    vapidInitialized = true;
  } catch (vapidErr: any) {
    vapidInitError = vapidErr?.message || String(vapidErr);
    console.error("[Push] Failed to initialize VAPID credentials:", vapidErr);
  }
} else {
  console.warn("[Push] VAPID_PRIVATE_KEY environment secret is not configured.");
}

let supabaseAdminInstance: any = null;
function getSupabaseAdmin() {
  if (!supabaseAdminInstance) {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    supabaseAdminInstance = createClient(url, key);
  }
  return supabaseAdminInstance;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUuid = (val: any): boolean => typeof val === "string" && UUID_REGEX.test(val.trim());

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const START_TIME = Date.now();
  // Supabase Edge Functions enforce strict CPU/wall-time limits.
  // We cap processing to 2500ms to guarantee clean exit before WORKER_RESOURCE_LIMIT (546).
  const MAX_EXECUTION_MS = 2500;

  try {
    const body = await req.json().catch(() => ({}));
    const {
      action,
      endpoint,
      p256dh,
      auth,
      user_id,
      user_ids,
      broadcast,
      title,
      body: messageBody,
      url,
      icon,
      id,
      tag,
      requireInteraction,
    } = body;

    const authHeader = req.headers.get("Authorization");
    const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    const cronSecret = (Deno.env.get("CRON_SECRET") || "").trim();
    const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim() || "";
    const headerCronSecret = (req.headers.get("x-cron-secret") || "").trim();

    // ── Action: Public/Authenticated Device Subscription Registration ──
    if (action === "subscribe") {
      if (!endpoint || typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
        return new Response(JSON.stringify({ success: false, error: "Valid HTTPS push endpoint is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let resolvedUserId: string | null = null;
      if (token && token !== anonKey && token !== serviceRoleKey) {
        try {
          const { data: authData } = await supabaseAdmin.auth.getUser(token);
          if (authData?.user?.id) {
            resolvedUserId = authData.user.id;
          }
        } catch (_e) {
          // Guest or expired token — allow anonymous device registration
        }
      }
      if (!resolvedUserId && isValidUuid(user_id)) {
        resolvedUserId = user_id.trim();
      }

      const cleanEndpoint = endpoint.trim();
      const { data: existingRows } = await supabaseAdmin
        .from("push_subscriptions")
        .select("id, user_id")
        .eq("endpoint", cleanEndpoint)
        .limit(1);

      let dbErr: { message: string } | null = null;

      if (existingRows && existingRows.length > 0) {
        const existing = existingRows[0];
        const { error: updateErr } = await supabaseAdmin
          .from("push_subscriptions")
          .update({
            user_id: resolvedUserId ?? existing.user_id,
            p256dh: p256dh || null,
            auth: auth || null,
          })
          .eq("endpoint", cleanEndpoint);
        dbErr = updateErr;
      } else {
        const { error: insertErr } = await supabaseAdmin
          .from("push_subscriptions")
          .insert({
            user_id: resolvedUserId,
            endpoint: cleanEndpoint,
            p256dh: p256dh || null,
            auth: auth || null,
          });
        dbErr = insertErr;
      }

      if (dbErr) {
        // If guest registration hits a legacy NOT NULL constraint on user_id, defer cleanly without 500 error
        if (!resolvedUserId && dbErr.message?.toLowerCase().includes("user_id")) {
          return new Response(
            JSON.stringify({
              success: true,
              deferred: true,
              vapid_public_key: VAPID_PUBLIC_KEY,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        console.error("[Push] Subscription save error:", dbErr);
        return new Response(JSON.stringify({ success: false, error: dbErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          user_id: resolvedUserId,
          vapid_public_key: VAPID_PUBLIC_KEY,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Action: Device Subscription Removal ──
    if (action === "unsubscribe") {
      if (!endpoint || typeof endpoint !== "string") {
        return new Response(JSON.stringify({ success: false, error: "Endpoint is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseAdmin
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", endpoint.trim());

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Action: Return Public VAPID Key ──
    if (action === "vapid-public-key") {
      return new Response(JSON.stringify({ success: true, vapid_public_key: VAPID_PUBLIC_KEY }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isBroadcast = Boolean(broadcast);
    const hasEndpoint = typeof endpoint === "string" && endpoint.trim().length > 0;
    const validUserIds = Array.isArray(user_ids) ? user_ids.filter(isValidUuid) : [];
    const validUserId = isValidUuid(user_id) ? user_id.trim() : null;
    const batchOffset = typeof body.offset === "number" && !isNaN(body.offset) ? Math.max(0, Math.floor(body.offset)) : 0;
    const requestedLimit = typeof body.limit === "number" && !isNaN(body.limit) ? Math.floor(body.limit) : 50;
    const batchLimit = Math.min(100, Math.max(1, requestedLimit));

    // Security Auth Verification (P1-7)
    const isServiceRole = Boolean(serviceRoleKey && token === serviceRoleKey);
    const isCron = Boolean(cronSecret && (token === cronSecret || headerCronSecret === cronSecret));
    let isAdmin = false;
    let authUserId: string | null = null;

    if (!isServiceRole && !isCron && token && token !== anonKey) {
      const adminCheck = await verifyAdmin(req, supabaseAdmin);
      if (adminCheck.success) {
        isAdmin = true;
        authUserId = adminCheck.user?.id || null;
      } else {
        const { data: authData } = await supabaseAdmin.auth.getUser(token);
        if (authData?.user) {
          authUserId = authData.user.id;
        }
      }
    }

    const syncWhatsapp = body.sync_whatsapp === true;

    if (isBroadcast || syncWhatsapp || validUserIds.length > 0) {
      if (!isServiceRole && !isCron && !isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden: Admin, cron, or service role privileges required for broadcast or WhatsApp-synced push notifications." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      // Single user/endpoint target
      const isSelf = Boolean(authUserId && validUserId && authUserId === validUserId);
      if (!isServiceRole && !isCron && !isAdmin && !isSelf) {
        // Check if this is an authentic database trigger event with an existing user_notifications row
        let isDbTrigger = false;
        if (id && validUserId) {
          const { data: notifRow } = await supabaseAdmin
            .from("user_notifications")
            .select("id")
            .eq("id", id)
            .eq("user_id", validUserId)
            .maybeSingle();
          if (notifRow?.id) {
            isDbTrigger = true;
          }
        }

        if (!isDbTrigger) {
          return new Response(JSON.stringify({ error: "Unauthorized: Valid authentication required to send push notifications." }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    if (!VAPID_PRIVATE_KEY || !vapidInitialized) {
      return new Response(
        JSON.stringify({
          success: false,
          error: vapidInitError
            ? `Invalid VAPID configuration: ${vapidInitError}`
            : "Server misconfigured: missing VAPID_PRIVATE_KEY secret",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!hasEndpoint && !validUserId && validUserIds.length === 0 && !isBroadcast) {
      if (user_id) {
        console.warn(`[Push] Non-UUID user_id provided: "${user_id}". Handled gracefully.`);
        return new Response(JSON.stringify({
          success: true,
          sent: 0,
          message: `Invalid or non-UUID user_id: ${user_id}`,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Missing endpoint, valid user_id, user_ids or broadcast flag" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Push] Processing request. Broadcast: ${isBroadcast}, Endpoint: ${hasEndpoint}, Valid User: ${validUserId || "none"}, Multiple: ${validUserIds.length}, Offset: ${batchOffset}, Limit: ${batchLimit}`);

    // 1. Fetch relevant subscriptions
    let query = supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth, user_id");

    if (hasEndpoint) {
      query = query.eq("endpoint", endpoint.trim()).limit(1);
    } else if (isBroadcast) {
      // Fetch window of subscribers ordered by newest first
      query = query
        .order("created_at", { ascending: false })
        .range(batchOffset, batchOffset + batchLimit - 1);
    } else if (validUserIds.length > 0) {
      const slice = validUserIds.slice(batchOffset, batchOffset + batchLimit);
      if (slice.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          sent: 0,
          devices: 0,
          cleaned: 0,
          offset: batchOffset,
          limit: batchLimit,
          has_more: false,
          message: "All target users processed",
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      query = query.in("user_id", slice);
    } else if (validUserId) {
      query = query.eq("user_id", validUserId).limit(20);
    }

    const { data: subscriptions, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    if (!subscriptions || subscriptions.length === 0) {
      console.log(`[Push] No subscriptions found at offset ${batchOffset}.`);
      const isSingleTarget = !isBroadcast && validUserIds.length === 0;
      return new Response(JSON.stringify({
        success: !isSingleTarget,
        sent: 0,
        devices: 0,
        cleaned: 0,
        offset: batchOffset,
        limit: batchLimit,
        has_more: false,
        error: isSingleTarget
          ? "No active push subscription found for this device/user. Please enable push notifications on your device first."
          : undefined,
        message: "No active subscriptions in this range",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduplicate endpoints across subscriptions
    const uniqueSubsMap = new Map<string, any>();
    for (const s of subscriptions) {
      if (s.endpoint && !uniqueSubsMap.has(s.endpoint)) {
        uniqueSubsMap.set(s.endpoint, s);
      }
    }
    const uniqueSubs = Array.from(uniqueSubsMap.values());

    // 2. Universal JSON payload
    const resolvedIcon = !icon || icon === "/pwa-192x192.png" ? "/logo.png" : icon;
    const payload = JSON.stringify({
      title: title || "SwiftData Ghana",
      body: messageBody || "New update from SwiftData",
      url: url || "/dashboard",
      icon: resolvedIcon,
      id: id || undefined,
      tag: tag || (id ? `swiftdata-order-${id}` : `swiftdata-alert-${Date.now()}`),
      requireInteraction: requireInteraction !== undefined ? Boolean(requireInteraction) : true,
    });

    let sentCount = 0;
    let otherFailureCount = 0;
    const failedEndpoints: string[] = [];
    const errorReasons: string[] = [];

    // 3. Batch send in chunks of 25 for controlled concurrency and CPU safety
    const CHUNK_SIZE = 25;
    for (let i = 0; i < uniqueSubs.length; i += CHUNK_SIZE) {
      // Check execution time budget before scheduling next chunk
      if (Date.now() - START_TIME > MAX_EXECUTION_MS) {
        console.warn(`[Push] Execution time budget reached (${Date.now() - START_TIME}ms). Yielding response.`);
        break;
      }

      const chunk = uniqueSubs.slice(i, i + CHUNK_SIZE);
      await Promise.allSettled(
        chunk.map(async (sub: any) => {
          try {
            if (!sub.p256dh || !sub.auth) {
              failedEndpoints.push(sub.endpoint);
              errorReasons.push("Subscription missing encryption keys (p256dh/auth)");
              return;
            }

            const pushSubscription = {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            };

            // Wrap each notification in a 2.5s individual timeout
            const sendPromise = webpush.sendNotification(pushSubscription, payload, {
              TTL: 86400, // 24 hours
              urgency: "high",
            });
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Push send timeout")), 2500)
            );

            await Promise.race([sendPromise, timeoutPromise]);
            sentCount++;
          } catch (err: any) {
            const statusCode = Number(err?.statusCode || 0);
            const errBody = String(err?.body || err?.message || "");
            console.warn(`[Push] Delivery failed (${statusCode || "ERR"}):`, errBody);

            if (
              statusCode === 410 ||
              statusCode === 404 ||
              (statusCode === 403 && errBody.toLowerCase().includes("vapid")) ||
              (statusCode === 401 && errBody.toLowerCase().includes("vapid")) ||
              errBody.includes("410") ||
              errBody.includes("404") ||
              errBody.includes("NotRegistered") ||
              errBody.includes("expired")
            ) {
              failedEndpoints.push(sub.endpoint);
            } else {
              otherFailureCount++;
            }

            if (errorReasons.length < 3) {
              errorReasons.push(`HTTP ${statusCode || "ERR"}: ${errBody.slice(0, 120)}`);
            }
          }
        })
      );
    }

    console.log(`[Push] Delivery summary: ${sentCount} sent, ${failedEndpoints.length} expired, ${otherFailureCount} failed out of ${uniqueSubs.length} devices in ${Date.now() - START_TIME}ms.`);

    // 4. Clean up expired/invalid endpoints asynchronously without blocking
    if (failedEndpoints.length > 0) {
      console.log(`[Push] Cleaning up ${failedEndpoints.length} expired/invalid subscription tokens.`);
      const delChunk = failedEndpoints.slice(0, 100);
      Promise.resolve(
        supabaseAdmin
          .from("push_subscriptions")
          .delete()
          .in("endpoint", delChunk)
      ).catch((delErr: any) => console.warn("[Push] Cleanup error:", delErr?.message));
    }

    const totalFailures = failedEndpoints.length + otherFailureCount;
    const errorSummary =
      errorReasons.length > 0
        ? errorReasons.join(" | ")
        : failedEndpoints.length > 0
        ? `${failedEndpoints.length} device token(s) expired and cleaned up`
        : null;

    // 5. Persist audit log
    try {
      await supabaseAdmin.from("push_notification_logs").insert({
        user_id: validUserId || null,
        title: title || "SwiftData Ghana",
        body: messageBody || "New update from SwiftData",
        url: url || "/dashboard",
        device_count: uniqueSubs.length,
        success_count: sentCount,
        failure_count: totalFailures,
        status: sentCount > 0 ? "delivered" : totalFailures > 0 ? "failed" : "no_devices",
        error_details: errorSummary,
      });
    } catch (logErr) {
      console.warn("[Push] Failed to insert log:", logErr);
    }

    // 6. Synchronize broadcast push notifications with WhatsApp blast notification only if explicitly requested on first batch
    if (body.sync_whatsapp === true && batchOffset === 0) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        fetch(`${supabaseUrl}/functions/v1/admin-broadcast-whatsapp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            title: title || "SwiftData Ghana",
            message: messageBody || "New update from SwiftData",
            site_url: url ? `https://swiftdatagh.shop${url.startsWith("/") ? url : `/${url}`}` : "https://swiftdatagh.shop",
            broadcast_to_channel: true,
          }),
        }).catch((waErr: any) => console.warn("[Push] WhatsApp broadcast sync error:", waErr?.message));
      } catch (err) {
        console.warn("[Push] Sync trigger error:", err);
      }
    }

    const isSingleTarget = !isBroadcast && validUserIds.length === 0;
    const hasMore = uniqueSubs.length >= batchLimit;

    return new Response(JSON.stringify({
      success: isSingleTarget ? sentCount > 0 : true,
      sent: sentCount,
      devices: uniqueSubs.length,
      cleaned: failedEndpoints.length,
      failed: totalFailures,
      offset: batchOffset,
      limit: batchLimit,
      has_more: hasMore,
      next_offset: batchOffset + uniqueSubs.length,
      duration_ms: Date.now() - START_TIME,
      error: isSingleTarget && sentCount === 0
        ? errorSummary || "Device subscription expired or rejected the notification. Please re-enable push notifications on the device."
        : undefined,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[Push] Fatal execution error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
