import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Replaced node:crypto with Web Crypto API

// SSRF Prevention: Block private/loopback/link-local destinations
const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|fc|fd)/i;
function isSafeWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (PRIVATE_IP_RE.test(parsed.hostname)) return false;
    if (parsed.hostname === "localhost") return false;
    return true;
  } catch { return false; }
}

export async function notifyApiClient(supabaseAdmin: any, orderId: string, status: string) {
  try {
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("agent_id, order_type, metadata")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order || order.order_type !== "api" || !order.agent_id) return;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("api_webhook_url, api_secret_key_hash")
      .eq("user_id", order.agent_id)
      .maybeSingle();

    if (profile?.api_webhook_url && profile?.api_secret_key_hash) {
      if (!isSafeWebhookUrl(profile.api_webhook_url)) {
        console.warn(`[Webhook] Blocked SSRF attempt or insecure protocol to: ${profile.api_webhook_url} for order ${orderId}`);
        return;
      }

      const payload = JSON.stringify({
        event: "order.updated",
        data: {
          order_id: orderId,
          status: status,
          client_reference: order.metadata?.client_reference || null,
          updated_at: new Date().toISOString()
        }
      });

      const enc = new TextEncoder();
      const cryptoKey = await crypto.subtle.importKey(
        "raw", enc.encode(profile.api_secret_key_hash), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(payload));
      const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

      await fetch(profile.api_webhook_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Swift-Signature": signature,
          "User-Agent": "SwiftData-Webhook/1.0"
        },
        body: payload
      });
      
      console.log(`[Webhook] Notified client at ${profile.api_webhook_url} for order ${orderId}`);
    }
  } catch (err) {
    console.error(`[Webhook] Failed to notify client for order ${orderId}:`, err.message);
  }
}

export async function notifyWalletCredit(supabaseAdmin: any, userId: string, amount: number, walletType: "main" | "api" = "api") {
  try {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("api_webhook_url, api_secret_key_hash")
      .eq("user_id", userId)
      .maybeSingle();

    if (profile?.api_webhook_url && profile?.api_secret_key_hash) {
      if (!isSafeWebhookUrl(profile.api_webhook_url)) {
        console.warn(`[Webhook] Blocked SSRF attempt or insecure protocol to: ${profile.api_webhook_url} for wallet credit`);
        return;
      }

      const payload = JSON.stringify({
        event: "wallet.funded",
        data: {
          wallet: walletType,
          amount: amount,
          currency: "GHS",
          updated_at: new Date().toISOString()
        }
      });

      const enc = new TextEncoder();
      const cryptoKey = await crypto.subtle.importKey(
        "raw", enc.encode(profile.api_secret_key_hash), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(payload));
      const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

      await fetch(profile.api_webhook_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Swift-Signature": signature,
          "User-Agent": "SwiftData-Webhook/1.0"
        },
        body: payload
      });
      
      console.log(`[Webhook] Notified client at ${profile.api_webhook_url} for wallet credit of ${amount} to ${walletType}`);
    }
  } catch (err) {
    console.error(`[Webhook] Failed to notify client for wallet credit:`, err.message);
  }
}
