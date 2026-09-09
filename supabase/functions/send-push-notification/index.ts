/// <reference path="../deno.d.ts" />

// @ts-ignore: Deno URL import
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore: Deno URL import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore: Deno npm import
import webpush from "npm:web-push";
import { corsHeaders } from "../_shared/cors.ts";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

// SwiftData Secure VAPID Credentials (Defaults loaded during installation)
const DEFAULT_VAPID_PUBLIC = "BBunKshlnxwoqC83k7a01ApJwKgZ0L-QqEySWnz0EuJL1eS7lneeiKemLOQ9Z7DYD82KptTcbYjeQKaDNN1o5gM";
const DEFAULT_VAPID_PRIVATE = "tlBnrV4TPdLoHwzOlBCG10RMlDdwy9o9PZkXsIUzcgM";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || DEFAULT_VAPID_PUBLIC;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || DEFAULT_VAPID_PRIVATE;

try {
  webpush.setVapidDetails(
    "mailto:admin@swiftdatagh.shop",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} catch (vapidErr) {
  console.error("[Push] Failed to initialize VAPID credentials:", vapidErr);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const START_TIME = Date.now();
  // Supabase Edge Functions enforce strict CPU/wall-time limits.
  // We cap processing to 2500ms to guarantee clean exit before WORKER_RESOURCE_LIMIT (546).
  const MAX_EXECUTION_MS = 2500;

  try {
    const body = await req.json();
    const { 
      user_id, 
      user_ids, 
      broadcast, 
      title, 
      body: messageBody, 
      url, 
      icon, 
      id, 
      tag, 
      requireInteraction 
    } = body;

    const isBroadcast = Boolean(broadcast);
    const hasMultipleUsers = Array.isArray(user_ids) && user_ids.length > 0;

    if (!user_id && !hasMultipleUsers && !isBroadcast) {
      return new Response(JSON.stringify({ error: "Missing user_id, user_ids or broadcast flag" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Push] Processing request. Broadcast: ${isBroadcast}, Multiple: ${hasMultipleUsers}, Single User: ${user_id || "none"}`);

    // 1. Fetch relevant subscriptions
    let query = supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth, user_id");

    if (isBroadcast) {
      // Prioritize most recent active devices up to a safe batch size
      query = query.order("created_at", { ascending: false }).limit(200);
    } else if (hasMultipleUsers) {
      query = query.in("user_id", user_ids).limit(100);
    } else if (user_id) {
      query = query.eq("user_id", user_id).limit(20);
    }

    const { data: subscriptions, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    if (!subscriptions || subscriptions.length === 0) {
      console.log(`[Push] No active subscriptions found. Skipping.`);
      try {
        await supabaseAdmin.from("push_notification_logs").insert({
          user_id: user_id || null,
          title: title || "SwiftData Ghana",
          body: messageBody || "New update from SwiftData",
          url: url || "/dashboard",
          device_count: 0,
          success_count: 0,
          failure_count: 0,
          status: "no_devices",
          error_details: "No active browser push subscriptions found",
        });
      } catch (logErr) {
        console.warn("[Push] Failed to insert log:", logErr);
      }

      return new Response(JSON.stringify({ success: true, sent: 0, message: "No active subscriptions" }), {
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
    const payload = JSON.stringify({
      title: title || "SwiftData Ghana",
      body: messageBody || "New update from SwiftData",
      url: url || "/dashboard",
      icon: icon || "/logo.png",
      id: id || undefined,
      tag: tag || (id ? `swiftdata-order-${id}` : `swiftdata-alert-${Date.now()}`),
      requireInteraction: requireInteraction !== undefined ? Boolean(requireInteraction) : true,
    });

    let sentCount = 0;
    const failedEndpoints: string[] = [];

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
              urgency: "high"
            });
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error("Push send timeout")), 2500)
            );

            await Promise.race([sendPromise, timeoutPromise]);
            sentCount++;
          } catch (err: any) {
            const errStr = String(err.statusCode || err.message || "");
            if (err.statusCode === 410 || err.statusCode === 404 || errStr.includes("410") || errStr.includes("404")) {
              failedEndpoints.push(sub.endpoint);
            }
          }
        })
      );
    }

    console.log(`[Push] Delivery summary: ${sentCount} sent, ${failedEndpoints.length} expired out of ${uniqueSubs.length} devices in ${Date.now() - START_TIME}ms.`);

    // 4. Clean up expired endpoints asynchronously without blocking
    if (failedEndpoints.length > 0) {
      console.log(`[Push] Cleaning up ${failedEndpoints.length} expired subscription tokens.`);
      const delChunk = failedEndpoints.slice(0, 100);
      supabaseAdmin
        .from("push_subscriptions")
        .delete()
        .in("endpoint", delChunk)
        .then(() => {})
        .catch((delErr: any) => console.warn("[Push] Cleanup error:", delErr?.message));
    }

    // 5. Persist audit log
    try {
      await supabaseAdmin.from("push_notification_logs").insert({
        user_id: user_id || null,
        title: title || "SwiftData Ghana",
        body: messageBody || "New update from SwiftData",
        url: url || "/dashboard",
        device_count: uniqueSubs.length,
        success_count: sentCount,
        failure_count: failedEndpoints.length,
        status: sentCount > 0 ? "delivered" : (failedEndpoints.length > 0 ? "failed" : "no_devices"),
        error_details: failedEndpoints.length > 0 ? `${failedEndpoints.length} device tokens expired and cleaned up` : null,
      });
    } catch (logErr) {
      console.warn("[Push] Failed to insert log:", logErr);
    }

    return new Response(JSON.stringify({
      success: true,
      sent: sentCount,
      devices: uniqueSubs.length,
      cleaned: failedEndpoints.length,
      duration_ms: Date.now() - START_TIME
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[Push] Fatal execution error:", error);
    return new Response(JSON.stringify({ error: error.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
