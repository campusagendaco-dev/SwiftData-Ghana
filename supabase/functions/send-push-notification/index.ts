import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush";
import { corsHeaders } from "../_shared/cors.ts";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

// SwiftData Secure VAPID Credentials (Defaults loaded during installation)
const DEFAULT_VAPID_PUBLIC = "BBunKshlnxwoqC83k7a01ApJwKgZ0L-QqEySWnz0EuJL1eS7lneeiKemLOQ9Z7DYD82KptTcbYjeQKaDNN1o5gM";
const DEFAULT_VAPID_PRIVATE = "tlBnrV4TPdLoHwzOlBCG10RMlDdwy9o9PZkXsIUzcgM";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || DEFAULT_VAPID_PUBLIC;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || DEFAULT_VAPID_PRIVATE;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function base64urlToBuf(b64url: string): Uint8Array {
  const base64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padLen);
  const binary = atob(padded);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf;
}

function convertRawToJwk(pubStr: string, privStr: string) {
  const pubBuf = base64urlToBuf(pubStr);
  const privBuf = base64urlToBuf(privStr);

  const x = btoa(String.fromCharCode(...pubBuf.slice(1, 33)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const y = btoa(String.fromCharCode(...pubBuf.slice(33, 65)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const d = btoa(String.fromCharCode(...privBuf))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  return {
    publicKey: {
      kty: "EC",
      crv: "P-256",
      x,
      y,
    },
    privateKey: {
      kty: "EC",
      crv: "P-256",
      x,
      y,
      d,
    },
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user_id, title, body, url, icon } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ error: "Missing user_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Push] Processing request for user: ${user_id}`);

    // 1. Fetch all registered device subscriptions for this user
    const { data: subscriptions, error: fetchError } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", user_id);

    if (fetchError) throw fetchError;

    if (!subscriptions || subscriptions.length === 0) {
      console.log(`[Push] No active subscriptions found for user ${user_id}. skipping.`);
      return new Response(JSON.stringify({ success: true, sent: 0, message: "No active subscriptions" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Setup VAPID Application Server Credentials
    console.log("[Push] Generating VAPID Cryptography...");
    const jwkKeys = convertRawToJwk(VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    const keys = await webpush.importVapidKeys(jwkKeys);

    const appServer = new webpush.ApplicationServer({
      subject: "mailto:admin@swiftdatagh.shop",
      keys: keys,
    });

    // 3. Build universal JSON notification payload
    const payload = JSON.stringify({
      title: title || "SwiftData Ghana",
      body: body || "New update from SwiftData",
      url: url || "/dashboard",
      icon: icon || "/logo.png",
    });

    let sentCount = 0;
    const failedEndpoints: string[] = [];

    // 4. Deliver to each device in parallel
    console.log(`[Push] Broadcasting payload to ${subscriptions.length} device endpoints...`);
    await Promise.all(
      subscriptions.map(async (sub: any) => {
        try {
          const webPushSubscription = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          };

          await appServer.sendNotification(webPushSubscription, payload);
          sentCount++;
          console.log(`[Push] Success to endpoint: ${sub.endpoint.substring(0, 40)}...`);
        } catch (err: any) {
          console.error(`[Push] Failure for endpoint ${sub.endpoint.substring(0, 40)}:`, err.message);
          
          // Handle stale subscriptions (410 Gone or 404 Not Found means user unsubscribed in browser settings)
          if (err.message && (err.message.includes("410") || err.message.includes("404"))) {
            failedEndpoints.push(sub.endpoint);
          }
        }
      })
    );

    // 5. Automatically clean up stale devices to keep DB optimized and fast
    if (failedEndpoints.length > 0) {
      console.log(`[Push] Cleaning up ${failedEndpoints.length} expired subscription tokens from database.`);
      await supabaseAdmin
        .from("push_subscriptions")
        .delete()
        .eq("user_id", user_id)
        .in("endpoint", failedEndpoints);
    }

    return new Response(JSON.stringify({ success: true, sent: sentCount, cleaned: failedEndpoints.length }), {
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
