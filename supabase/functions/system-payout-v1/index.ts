import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, sendSmsViaTxtConnect, formatTemplate } from "../_shared/sms.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { fetchViaDb } from "../_shared/db_proxy.ts";
import https from "node:https";
import { HttpsProxyAgent } from "npm:https-proxy-agent";


declare const Deno: any;

// Initialised once at cold-start — not rebuilt on every request
const SUPABASE_URL = (Deno as any).env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = (Deno as any).env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (id: string) => id && typeof id === "string" && UUID_RE.test(id.trim());
const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

async function sendManualCreditSms(userId: string, amount: number) {
  try {
    const [profileRes, smsConfig] = await Promise.all([
      supabaseAdmin.from("profiles").select("phone").eq("user_id", userId).maybeSingle(),
      getSmsConfig(supabaseAdmin),
    ]);
    const recipient = normalizePhone(profileRes.data?.phone);
    if (!smsConfig.apiKey || !recipient) return;
    let message = "";
    if (amount < 0) {
      message = `Your account has been manually debited with GHS ${Math.abs(amount).toFixed(2)}.`;
    } else {
      message = formatTemplate(smsConfig.templates.manual_credit, { amount: amount.toFixed(2) });
    }
    await sendSmsViaTxtConnect(smsConfig.apiKey, smsConfig.senderId, recipient, message);
  } catch (error) {
    console.error("sendManualCreditSms error:", error);
  }
}

async function sendManualApiCreditSms(userId: string, amount: number) {
  try {
    const [profileRes, smsConfig] = await Promise.all([
      supabaseAdmin.from("profiles").select("phone").eq("user_id", userId).maybeSingle(),
      getSmsConfig(supabaseAdmin),
    ]);
    const recipient = normalizePhone(profileRes.data?.phone);
    if (!smsConfig.apiKey || !recipient) return;
    const absAmount = Math.abs(amount).toFixed(2);
    const message = amount < 0
      ? `Your SwiftData API Wallet has been manually debited with GHS ${absAmount} by admin.`
      : `Your SwiftData API Wallet has been manually credited with GHS ${absAmount} by admin. Thanks for your business.`;
    await sendSmsViaTxtConnect(smsConfig.apiKey, smsConfig.senderId, recipient, message);
  } catch (error) {
    console.error("sendManualApiCreditSms error:", error);
  }
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sendWithdrawalCompletedSms(userId: string, amount: number) {
  try {
    const [profileRes, smsConfig] = await Promise.all([
      supabaseAdmin.from("profiles").select("phone").eq("user_id", userId).maybeSingle(),
      getSmsConfig(supabaseAdmin),
    ]);
    const recipient = normalizePhone(profileRes.data?.phone);
    if (!smsConfig.apiKey || !recipient) return;
    const message = formatTemplate(smsConfig.templates.withdrawal_completed, { amount: amount.toFixed(2) });
    await sendSmsViaTxtConnect(smsConfig.apiKey, smsConfig.senderId, recipient, message);
  } catch (error) {
    console.error("sendWithdrawalCompletedSms error:", error);
  }
}

async function triggerPushNotification(supabaseAdmin: any, payload: { user_id: string; title: string; body: string; url?: string; icon?: string }) {
  try {
    const url = `${SUPABASE_URL}/functions/v1/send-push-notification`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error("[Push Webhook] Trigger failed in system-payout:", text);
    }
  } catch (e) {
    console.error("[Push Webhook] Trigger error in system-payout:", e);
  }
}

type AdminUserAction = 
  | "get_api_users" 
  | "send_reset_link" 
  | "reset_password" 
  | "delete_user" 
  | "toggle_api_access" 
  | "revoke_api_key" 
  | "update_api_settings"
  | "approve_agent"
  | "revoke_agent" 
  | "approve_sub_agent" 
  | "manual_topup"
  | "manual_api_topup"
  | "update_system_settings"
  | "confirm_withdrawal"
  | "get_admin_secrets"
  | "get_provider_balance"
  | "get_korba_balance"
  | "get_korba_packages"
  | "check_proxy_health"
  | "update_credit_limit"
  | "approve_by_email"
  | "find_user"
  | "get_system_errors"
  | "purge_test_accounts"
  | "bulk_suspend_users"
  | "manage_blacklist"
  | "paystack_payout"
  | "reject_withdrawal"
  | "impersonate_user"
  | "get_providers"
  | "update_provider"
  | "get_paystack_transactions"
  | "bulk_fulfill_api_orders"
  | "generate_api_key"
  | "save_package_settings"
  | "approve_all_pending_agents"
  | "reset_user_mfa"
  | "get_admins"
  | "grant_admin_role"
  | "revoke_admin_role"
  | "verify_paystack_transfer"
  | "get_korba_transactions";

async function queryKorbaApi(
  supabaseAdmin: any,
  url: string,
  payload: Record<string, any>
): Promise<{ success: boolean; data?: any; error?: string }> {
  const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || "2419";
  const KORBA_CLIENT_KEY = Deno.env.get("KORBA_CLIENT_KEY") || "";
  const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || "";

  if (!KORBA_CLIENT_KEY || !KORBA_SECRET_KEY) {
    return { success: false, error: "Korba gateway credentials not configured in edge functions." };
  }

  // Generate HMAC signature
  const sortedKeys = Object.keys(payload).sort();
  const messageParts = [];
  for (const key of sortedKeys) {
    messageParts.push(`${key}=${payload[key]}`);
  }
  const message = messageParts.join("&");
  
  const keyData = new TextEncoder().encode(KORBA_SECRET_KEY);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const messageData = new TextEncoder().encode(message);
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const signatureHex = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  let resText = "";
  let success = false;
  let responseData: any = null;
  let proxyError = "";

  // Attempt 1: Query via DB Proxy (static IP database proxy)
  try {
    console.log(`[Korba API Proxy] Fetching ${url} via DB Proxy...`);
    const res = await fetchViaDb(supabaseAdmin, url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `HMAC ${KORBA_CLIENT_KEY}:${signatureHex}`,
      },
      body: JSON.stringify(payload),
      disableFallback: true,
    }, 20); // 20s timeout now that service_role statement_timeout is increased to 30s

    resText = await res.text();
    console.log(`[Korba API Proxy] Response status: ${res.status}`);
    
    // Check if the proxy response itself returned Gateway Timeout or Statement Timeout
    if (res.ok && !resText.includes("Gateway Timeout") && !resText.includes("canceling statement")) {
      try {
        responseData = JSON.parse(resText);
        success = responseData.success || (responseData.error_code === null) || false;
        if (!success) {
          proxyError = responseData.message || responseData.detail || JSON.stringify(responseData);
        }
      } catch {
        console.warn("[Korba API Proxy] Response not JSON:", resText);
        proxyError = "Response not JSON: " + resText;
      }
    } else {
      console.warn("[Korba API Proxy] Request timed out or failed in pg_net:", resText);
      proxyError = resText || `HTTP ${res.status}`;
    }
  } catch (e: any) {
    console.warn(`[Korba API Proxy] Proxy exception: ${e.message}`);
    proxyError = e.message || "Unknown proxy exception";
  }

  // Attempt 2: Direct HTTP Fetch Fallback (if DB Proxy failed or timed out)
  // Fallback is strictly disabled for money payouts to prevent double-charging cashout requests.
  const isFallbackEnabled = true;
  if ((!success || !responseData) && isFallbackEnabled) {
    console.log(`[Korba API Direct] Proxy failed/timed out (${proxyError}). Falling back to Direct edge fetch...`);
    let fallbackError = "";
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout
      
      let client: any = undefined;
      const fetchOpts: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `HMAC ${KORBA_CLIENT_KEY}:${signatureHex}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      };

      if (url.includes("korba365.com")) {
        const proxyUrl = Deno.env.get("KORBA_PROXY_URL") || "http://cvlscvmy:wylckry6fx3o@31.59.20.176:6754/";
        console.log(`[system-payout-v1] Routing direct fetch through proxy: ${proxyUrl}`);
        if (typeof (Deno as any).createHttpClient === "function") {
          client = (Deno as any).createHttpClient({ proxy: { url: proxyUrl } });
          (fetchOpts as any).client = client;
        } else {
          console.warn("[system-payout-v1] Deno.createHttpClient is not available in this environment.");
        }
      }

      let res;
      try {
        res = await fetch(url, fetchOpts);
      } finally {
        if (client) {
          try {
            client.close();
          } catch (closeErr) {
            console.error("[system-payout-v1] Error closing HTTP client proxy:", closeErr);
          }
        }
      }
      
      clearTimeout(timeoutId);
      resText = await res.text();
      console.log(`[Korba API Direct] Response status: ${res.status}`);
      
      try {
        responseData = JSON.parse(resText);
        success = responseData.success || (responseData.error_code === null) || false;
        if (!success) {
          fallbackError = responseData.message || responseData.detail || responseData.error || resText;
        }
      } catch {
        responseData = { error: resText || `HTTP ${res.status}` };
        fallbackError = resText || `HTTP ${res.status}`;
      }
    } catch (e: any) {
      console.error(`[Korba API Direct] Direct fallback failed:`, e);
      fallbackError = e.message || String(e);
      responseData = { error: `Proxy timed out, and direct fallback connection failed: ${e.message || e}` };
    }

    if (!success) {
      const finalError = `Database HTTP Proxy failed: ${proxyError}. Direct fallback got: ${fallbackError}`;
      responseData = {
        success: false,
        error: finalError,
        message: finalError,
        detail: finalError
      };
    }
  }

  return { success, data: responseData };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const authResult = await verifyAdmin(req, supabaseAdmin, { checkMfa: false, checkIp: false });
  if (!authResult.success) {
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: authResult.status,
      headers: JSON_HEADERS,
    });
  }
  const actor = authResult.user;

  try {
    const body = await req.json().catch(() => ({}));
    const { action: rawAction, user_id, email, redirect_path, new_password } = body;
    const action = (rawAction as string)?.trim();

    if (!action) {
      return json({ error: `Missing action. Received body: ${JSON.stringify(body)}` }, 400);
    }

    switch (action as AdminUserAction) {
      case "get_api_users": {
        let users: any[] | null = null;
        let userError: any = null;

        // Try with new security columns first
        const { data: newData, error: newError } = await supabaseAdmin
          .from("profiles")
          .select("user_id, full_name, email, api_key_prefix, api_key_hash, api_secret_key_hash, api_access_enabled, api_rate_limit, api_allowed_actions, api_ip_whitelist, api_webhook_url, api_requests_today, api_requests_total, api_last_used_at, agent_approved, sub_agent_approved, api_custom_prices, api_request_status, api_requested_at")
          .or("api_key_prefix.not.is.null,api_key_hash.not.is.null,api_access_enabled.eq.true,api_request_status.eq.pending")
          .order("full_name");

        if (newError) {
          console.warn("Falling back to legacy API user query:", newError.message);
          // Fallback to legacy columns if migration hasn't been run
          const { data: legacyData, error: legacyError } = await supabaseAdmin
            .from("profiles")
            .select("user_id, full_name, email, api_key_prefix, api_key_hash, api_access_enabled, api_rate_limit, api_allowed_actions, api_ip_whitelist, api_webhook_url, api_requests_today, api_requests_total, api_last_used_at, agent_approved, sub_agent_approved, api_custom_prices, api_request_status, api_requested_at")
            .or("api_key_prefix.not.is.null,api_key_hash.not.is.null,api_access_enabled.eq.true,api_request_status.eq.pending")
            .order("full_name");
          
          users = legacyData;
          userError = legacyError;
        } else {
          users = newData;
        }

        if (userError) {
          return new Response(JSON.stringify({ error: userError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const userIds = (users || []).map((u: any) => u.user_id);
        let statsMap: Record<string, any> = {};
        
        if (userIds.length > 0) {
          const { data: stats } = await supabaseAdmin
            .from("user_sales_stats")
            .select("user_id, total_sales_volume")
            .in("user_id", userIds);
          
          if (stats) {
            statsMap = Object.fromEntries(stats.map((s: any) => [s.user_id, s.total_sales_volume]));
          }
        }

        const enrichedUsers = (users || []).map((u: any) => ({
          ...u,
          total_sales_volume: statsMap[u.user_id] || 0,
          stats: [{ total_sales_volume: statsMap[u.user_id] || 0 }]
        }));

        return new Response(JSON.stringify({ users: enrichedUsers }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "toggle_api_access": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        const { enabled } = body;
        const patch: Record<string, any> = { 
          api_access_enabled: !!enabled,
          api_request_status: enabled ? "approved" : "rejected"
        };
        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update(patch)
          .eq("user_id", user_id);

        if (updateError) throw updateError;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "revoke_api_key": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({ api_key: null, api_key_hash: null, api_key_prefix: null })
          .eq("user_id", user_id);

        if (updateError) throw updateError;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "update_api_settings": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        const { 
          api_rate_limit, 
          api_allowed_actions, 
          api_ip_whitelist, 
          api_webhook_url, 
          api_custom_prices 
        } = body;

        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({
            api_rate_limit,
            api_allowed_actions,
            api_ip_whitelist,
            api_webhook_url,
            api_custom_prices,
          })
          .eq("user_id", user_id);

        if (updateError) throw updateError;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "generate_api_key": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        
        // 1. Generate a random 32-char hex string for the API Key
        const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        
        const newKey = `swft_live_${randomHex}`;
        const keyHash = await sha256Hex(newKey);
        const prefix = newKey.slice(0, 12);

        // 2. Generate a random 32-char hex string for the Secret Signing Key
        const secretHex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        
        // We use the hex itself as the secret, and store its hash
        const secretHash = await sha256Hex(secretHex);

        // 3. Update Database
        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({
            api_key: null, // Ensure old plaintext key is cleared
            api_key_hash: keyHash,
            api_key_prefix: prefix,
            api_secret_key_hash: secretHex, // Store the secret itself to allow HMAC verification
            api_access_enabled: true
          })
          .eq("user_id", user_id);

        if (updateError) {
          console.warn("Retrying generate_api_key without secret key column:", updateError.message);
          // Fallback: Try without the new secret key column if migration hasn't run
          const { error: fallbackError } = await supabaseAdmin
            .from("profiles")
            .update({
              api_key: null,
              api_key_hash: keyHash,
              api_key_prefix: prefix,
              api_access_enabled: true
            })
            .eq("user_id", user_id);
          
          if (fallbackError) throw fallbackError;
        }

        return new Response(JSON.stringify({ 
          success: true, 
          api_key: newKey,
          prefix: prefix
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "approve_agent": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        
        // Fetch current profile to see if they completed onboarding (have store_name and slug)
        const { data: currentProfile } = await supabaseAdmin
          .from("profiles")
          .select("store_name, slug, onboarding_complete")
          .eq("user_id", user_id)
          .maybeSingle();

        const isOnboarded = !!(currentProfile?.store_name && currentProfile?.slug);

        // Update profile
        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({
            is_agent: true,
            agent_approved: true,
            sub_agent_approved: false,
            onboarding_complete: isOnboarded,
            is_sub_agent: false,
            parent_agent_id: null
          })
          .eq("user_id", user_id);

        if (updateError) throw updateError;

        // Mark activation orders as fulfilled
        await supabaseAdmin
          .from("orders")
          .update({ status: "fulfilled", failure_reason: null })
          .eq("agent_id", user_id)
          .in("order_type", ["agent_activation", "sub_agent_activation"])
          .in("status", ["paid", "pending", "processing"]);

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "approve_all_pending_agents": {
        const { data: pending, error: fetchErr } = await supabaseAdmin
          .from("profiles")
          .select("user_id")
          .eq("is_agent", true)
          .eq("onboarding_complete", true)
          .eq("agent_approved", false);

        if (fetchErr) throw fetchErr;
        if (!pending || pending.length === 0) {
          return new Response(JSON.stringify({ success: true, approved: 0 }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const ids = pending.map((p: any) => p.user_id);

        const { error: bulkErr } = await supabaseAdmin
          .from("profiles")
          .update({ is_agent: true, agent_approved: true, onboarding_complete: true, is_sub_agent: false, parent_agent_id: null })
          .in("user_id", ids);

        if (bulkErr) throw bulkErr;

        // Fulfil any pending activation orders for these agents
        await supabaseAdmin
          .from("orders")
          .update({ status: "fulfilled", failure_reason: null })
          .in("agent_id", ids)
          .in("order_type", ["agent_activation", "sub_agent_activation"])
          .in("status", ["paid", "pending", "processing"]);

        return new Response(JSON.stringify({ success: true, approved: ids.length }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "approve_by_email": {
        try {
          console.log("APPROVE_BY_EMAIL_START", email);
          if (!email) throw new Error("Email is required");
          
          const { data: profile, error: findError } = await supabaseAdmin
            .from("profiles")
            .select("user_id, store_name, slug")
            .ilike("email", email.trim())
            .maybeSingle();

          if (findError) throw findError;
          if (!profile) {
             return new Response(JSON.stringify({ error: `User ${email} not found in profiles. Please check the spelling.` }), {
               status: 200,
               headers: { ...corsHeaders, "Content-Type": "application/json" },
             });
          }

          const targetId = profile.user_id;
          console.log("APPROVE_BY_EMAIL_TARGET", targetId);

          const isOnboarded = !!(profile?.store_name && profile?.slug);

          const { error: updError } = await supabaseAdmin
            .from("profiles")
            .update({
              is_agent: true,
              agent_approved: true,
              sub_agent_approved: false,
              onboarding_complete: isOnboarded,
              is_sub_agent: false,
              parent_agent_id: null
            })
            .eq("user_id", targetId);

          if (updError) throw updError;

          await supabaseAdmin
            .from("orders")
            .update({ status: "fulfilled" })
            .eq("agent_id", targetId)
            .in("order_type", ["agent_activation", "sub_agent_activation"])
            .in("status", ["paid", "pending", "processing"]);

          console.log("APPROVE_BY_EMAIL_SUCCESS");
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("APPROVE_BY_EMAIL_FATAL", e);
          return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      case "revoke_agent": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({
            is_agent: false,
            agent_approved: false,
            sub_agent_approved: false,
          })
          .eq("user_id", user_id);

        if (updateError) throw updateError;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "impersonate_user": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        
        // Get user email
        const { data: profile } = await supabaseAdmin.from("profiles").select("email").eq("user_id", user_id).single();
        if (!profile?.email) throw new Error("User email not found");

        const { data, error } = await supabaseAdmin.auth.admin.generateLink({
          type: 'magiclink',
          email: profile.email,
          options: { redirectTo: `${req.headers.get("origin")}/dashboard` }
        });

        if (error) throw error;

        return new Response(JSON.stringify({ success: true, magic_link: data.properties.action_link }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get_providers": {
        const { data, error } = await supabaseAdmin.from("providers").select("*").order("priority");
        if (error) throw error;
        return new Response(JSON.stringify({ providers: data }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get_paystack_transactions": {
        let PAYSTACK_SECRET_KEY = "";
        try {
          const { data: settings } = await supabaseAdmin
            .from("v_system_settings_with_secrets")
            .select("paystack_secret_key")
            .eq("id", 1)
            .maybeSingle();
          PAYSTACK_SECRET_KEY = settings?.paystack_secret_key || "";
        } catch (dbErr) {
          console.error("Failed to fetch paystack_secret_key from DB in system-payout:", dbErr);
        }
        if (!PAYSTACK_SECRET_KEY) {
          PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
        }
        if (!PAYSTACK_SECRET_KEY) throw new Error("Paystack secret key not configured");

        const { from, to, status, page: pPage } = body;
        let url = `https://api.paystack.co/transaction?perPage=50&page=${pPage || 1}`;
        if (from) url += `&from=${from}`;
        if (to) url += `&to=${to}`;
        if (status) url += `&status=${status}`;

        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
        });
        const data = await res.json();

        if (!data.status) throw new Error(data.message || "Failed to fetch Paystack transactions");

        return new Response(JSON.stringify({ 
          success: true, 
          transactions: data.data,
          meta: data.meta
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "approve_sub_agent": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("parent_agent_id, store_name, slug")
          .eq("user_id", user_id)
          .maybeSingle();

        if (!profile) {
          return new Response(JSON.stringify({ error: "User profile not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        let pricesToAssign = {};

        if (profile.parent_agent_id) {
          const { data: parent } = await supabaseAdmin
            .from("profiles")
            .select("sub_agent_prices, agent_prices")
            .eq("user_id", profile.parent_agent_id)
            .single();

          // Seed sub-agent with parent's explicit wholesale prices if set;
          // otherwise use parent's own published selling prices so the sub-agent
          // starts at (or above) the parent's customer-facing prices.
          const subPrices = parent?.sub_agent_prices as Record<string, unknown> | undefined;
          const hasSubPrices = subPrices && Object.keys(subPrices).length > 0;
          pricesToAssign = hasSubPrices ? subPrices : (parent?.agent_prices || {});
        }

        const isOnboarded = !!(profile?.store_name && profile?.slug);

        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({
            is_agent: true,
            agent_approved: true,
            is_sub_agent: true,
            onboarding_complete: isOnboarded,
            sub_agent_approved: true,
            agent_prices: pricesToAssign,
          })
          .eq("user_id", user_id);

        if (updateError) throw updateError;

        // Fulfill any pending activation orders for these agents
        await supabaseAdmin
          .from("orders")
          .update({ status: "fulfilled", failure_reason: null })
          .eq("agent_id", user_id)
          .in("order_type", ["agent_activation", "sub_agent_activation"])
          .in("status", ["paid", "pending", "processing"]);

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "manual_topup": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        const { amount } = body;
        if (typeof amount !== "number" || amount === 0) {
          return new Response(JSON.stringify({ error: "Invalid amount" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const isDeduction = amount < 0;
        const rpcName = isDeduction ? "debit_wallet" : "credit_wallet";
        const rpcParams = {
          p_agent_id: user_id,
          p_amount: Math.abs(amount),
        };

        const { data: result, error: rpcError } = await supabaseAdmin.rpc(rpcName, rpcParams);

        if (rpcError) throw new Error(`${rpcName} RPC Error: ` + JSON.stringify(rpcError));
        if (result?.success === false) {
          throw new Error(result.error || "Transaction failed");
        }
        const newBalance = result?.new_balance ?? 0;

        const { error: orderError } = await supabaseAdmin
          .from("orders")
          .insert({
            agent_id: user_id,
            order_type: "wallet_topup",
            amount,
            profit: 0,
            status: "fulfilled",
          });

        if (orderError) throw new Error("order insert Error: " + JSON.stringify(orderError));

        await sendManualCreditSms(user_id, amount);

        return new Response(JSON.stringify({ success: true, new_balance: newBalance }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "manual_api_topup": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        const { amount } = body;
        if (typeof amount !== "number" || amount === 0) {
          return new Response(JSON.stringify({ error: "Invalid amount" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { data: result, error: rpcError } = await supabaseAdmin.schema("api").rpc("credit_api_wallet", {
          p_user_id: user_id,
          p_amount: amount,
        });

        if (rpcError) throw new Error("credit_api_wallet RPC Error: " + JSON.stringify(rpcError));
        const newBalance = result?.new_balance || 0;

        const { error: orderError } = await supabaseAdmin
          .from("orders")
          .insert({
            agent_id: user_id,
            order_type: "wallet_topup",
            amount,
            profit: 0,
            status: "fulfilled",
          });

        if (orderError) throw new Error("order insert Error: " + JSON.stringify(orderError));

        await sendManualApiCreditSms(user_id, amount);

        return new Response(JSON.stringify({ success: true, new_balance: newBalance }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "update_system_settings": {
        const { settings } = body;
        if (!settings || typeof settings !== "object") {
          return new Response(JSON.stringify({ error: "Invalid settings object" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Dynamically fetch existing columns to avoid crashing on missing columns
        const { data: existing, error: fetchError } = await supabaseAdmin
          .from("system_settings")
          .select("*")
          .limit(1)
          .maybeSingle();

        if (fetchError) throw fetchError;

        // Filter settings to only include keys that exist in the DB
        const validKeys = existing ? Object.keys(existing) : [];

        // Define expected types for known sensitive settings
        const BOOLEAN_KEYS = new Set(["allow_duplicate_purchases", "disable_ordering", "maintenance_mode", "auto_failover_enabled", "holiday_mode_enabled", "show_scrolling_ad", "home_page_video_muted", "mashup_automation_enabled", "auto_refund_enabled", "beneficiary_verification_enabled", "allow_non_beneficiary_continue"]);
        const NUMERIC_KEYS = new Set(["min_order_amount", "max_order_amount", "agent_activation_fee", "sub_agent_activation_fee", "wassce_price", "bece_price", "wassce_cost_price", "bece_cost_price", "vendor_min_transaction", "background_brightness", "background_contrast", "background_blueness", "mashup_export_threshold", "mashup_delivery_delay_mins"]);
        const STRING_KEYS = new Set(["holiday_message", "data_provider_base_url", "secondary_data_provider_base_url", "whatsapp_bot_prompt", "site_name", "scrolling_ad_text", "home_page_video_url", "mashup_whatsapp_number", "active_payment_gateway"]);

        const filteredSettings: Record<string, any> = {};

        for (const key of Object.keys(settings)) {
          if (!validKeys.includes(key)) {
            console.warn(`Skipping unknown setting key: ${key}`);
            continue;
          }
          const val = settings[key];
          // Reject null prototype injection
          if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
          // Type validation for known fields
          if (BOOLEAN_KEYS.has(key) && typeof val !== "boolean") {
            return new Response(JSON.stringify({ error: `Setting '${key}' must be a boolean` }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (NUMERIC_KEYS.has(key)) {
            const n = Number(val);
            if (!Number.isFinite(n) || n < 0 || n > 100000) {
              return new Response(JSON.stringify({ error: `Setting '${key}' must be a non-negative number ≤ 100000` }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }
          if (STRING_KEYS.has(key) && typeof val !== "string") {
            return new Response(JSON.stringify({ error: `Setting '${key}' must be a string` }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          filteredSettings[key] = val;
        }

        const { error: updateError } = await supabaseAdmin
          .from("system_settings")
          .update(filteredSettings)
          .eq("id", 1);

        if (updateError) {
          return new Response(JSON.stringify({ error: updateError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        
        // Handle Secret updates separately
        const SECRET_KEYS = new Set([
          "paystack_secret_key", "hubtel_client_id", "hubtel_client_secret", 
          "txtconnect_api_key", "txtconnect_sender_id", 
          "data_provider_api_key", "data_provider_base_url", 
          "secondary_data_provider_api_key", "secondary_data_provider_base_url", 
          "airtime_provider_api_key", "airtime_provider_base_url"
        ]);
        
        const secretUpdates: Record<string, any> = {};
        for (const key of Object.keys(settings)) {
          if (SECRET_KEYS.has(key) && typeof settings[key] === "string") {
            secretUpdates[key] = settings[key];
          }
        }
        
        if (Object.keys(secretUpdates).length > 0) {
          const { error: secretsError } = await supabaseAdmin.from("system_secrets").update(secretUpdates).eq("id", 1);
          if (secretsError) {
            console.error("Failed to update system_secrets:", secretsError);
            return new Response(JSON.stringify({ error: "Failed to save sensitive settings. Ensure database is updated." }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        // Log update action to audit_logs table
        try {
          await supabaseAdmin.from("audit_logs").insert({
            admin_id: actor?.id,
            action: "update_system_settings",
            details: {
              updated_fields: Object.keys(filteredSettings).concat(Object.keys(secretUpdates)),
              admin_email: actor?.email
            }
          });
        } catch (auditErr) {
          console.error("Failed to insert update_system_settings audit log:", auditErr);
        }

        return new Response(JSON.stringify({ 
          success: true, 
          skipped: Object.keys(settings).filter(k => !validKeys.includes(k) && !SECRET_KEYS.has(k)) 
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      case "get_admin_secrets": {
        const { data: secrets, error: secretsErr } = await supabaseAdmin
          .from("system_secrets")
          .select("*")
          .eq("id", 1)
          .maybeSingle();
          
        if (secretsErr) throw secretsErr;
        
        return new Response(JSON.stringify({ success: true, secrets: secrets || {} }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "paystack_payout": {
        const { withdrawal_id } = body;
        if (!withdrawal_id || !isValidUuid(withdrawal_id)) {
          return new Response(JSON.stringify({ error: "Invalid or missing withdrawal_id" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        let PAYSTACK_SECRET = "";
        try {
          const { data: settings } = await supabaseAdmin
            .from("v_system_settings_with_secrets")
            .select("paystack_secret_key")
            .eq("id", 1)
            .maybeSingle();
          PAYSTACK_SECRET = settings?.paystack_secret_key || "";
        } catch (dbErr) {
          console.error("Failed to fetch paystack_secret_key from DB in system-payout payout:", dbErr);
        }
        if (!PAYSTACK_SECRET) {
          PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
        }
        if (!PAYSTACK_SECRET) {
          return new Response(JSON.stringify({ error: "Paystack Secret Key not configured in Edge Functions" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        console.log(`Processing paystack_payout for ID: "${withdrawal_id}"`);

        // 1. Fetch withdrawal record first
        const { data: withdrawal, error: fetchErr } = await supabaseAdmin
          .from("withdrawals")
          .select("*")
          .eq("id", withdrawal_id.trim())
          .maybeSingle();

        if (fetchErr) {
          console.error("Database fetch error (withdrawals):", fetchErr);
          return new Response(JSON.stringify({ error: `Database error: ${fetchErr.message}` }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!withdrawal) {
          console.error(`Withdrawal NOT FOUND in DB for ID: ${withdrawal_id}`);
          return new Response(JSON.stringify({ error: `Withdrawal request not found in database for ID: ${withdrawal_id}` }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // 2. Fetch profile separately
        const { data: profile, error: profileErr } = await supabaseAdmin
          .from("profiles")
          .select("full_name, momo_number, momo_network, momo_account_name")
          .eq("user_id", withdrawal.agent_id)
          .maybeSingle();

        if (profileErr) {
          console.error("Database fetch error (profiles):", profileErr);
          return new Response(JSON.stringify({ error: `Profile error: ${profileErr.message}` }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!profile) {
          return new Response(JSON.stringify({ error: "Agent profile not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const allowedStatuses = ["pending", "processing", "failed"];
        if (!allowedStatuses.includes(withdrawal.status)) {
          return new Response(JSON.stringify({ error: `Withdrawal is already ${withdrawal.status}` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const netAmount = Number(withdrawal.net_amount || withdrawal.amount);

        // 2. Map Network to Paystack Bank Code
        const network = (profile.momo_network || "").toUpperCase();
        let bankCode = "";
        if (network.includes("MTN")) bankCode = "MTN";
        else if (network.includes("VODA") || network.includes("TELECEL") || network.includes("VDF")) bankCode = "VOD";
        else if (network.includes("AIRTEL") || network.includes("TIGO") || network.includes("AT") || network.includes("ATL")) bankCode = "ATL";

        if (!bankCode || !profile.momo_number) {
          return new Response(JSON.stringify({ error: "Invalid or missing MoMo details for this agent" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // 2b. Paystack Ghana MoMo requires 10-digit number starting with 0
        const normalizeForPaystack = (phone: string) => {
          const digits = phone.replace(/\D/g, "");
          if (digits.startsWith("233") && digits.length > 10) return "0" + digits.slice(3);
          if (!digits.startsWith("0") && digits.length === 9) return "0" + digits;
          return digits;
        };

        try {
          // 3. Create Transfer Recipient
          const recipientRes = await fetch("https://api.paystack.co/transferrecipient", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${PAYSTACK_SECRET}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              type: "mobile_money",
              name: profile.momo_account_name || profile.full_name,
              account_number: normalizeForPaystack(profile.momo_number),
              bank_code: bankCode,
              currency: "GHS"
            })
          });

          const recipientData = await recipientRes.json();
          if (!recipientRes.ok || !recipientData.status) {
            throw new Error(recipientData.message || "Failed to create transfer recipient");
          }

          const recipientCode = recipientData.data.recipient_code;

          // 4. Initiate Transfer
          const transferRes = await fetch("https://api.paystack.co/transfer", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${PAYSTACK_SECRET}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              source: "balance",
              amount: Math.round(netAmount * 100), // Convert to pesewas
              recipient: recipientCode,
              reason: `SwiftData Withdrawal: ${withdrawal_id.slice(0, 8)}`,
              currency: "GHS",
              reference: withdrawal_id, // Idempotency key — prevents double-crediting on retries
            })
          });

          const transferData = await transferRes.json();
          if (!transferRes.ok || !transferData.status) {
            throw new Error(transferData.message || "Transfer initiation failed");
          }

          const transferCode = transferData.data?.transfer_code ?? null;
          const transferReference = transferData.data?.reference ?? withdrawal_id;

          // 5. Mark as processing — wallet debit happens only when webhook confirms transfer.success
          const { error: updateErr } = await supabaseAdmin
            .from("withdrawals")
            .update({
              status: "processing",
              transfer_code: transferCode,
              paystack_transfer_reference: transferReference,
              failure_reason: null, // Clear any previous failure reason
            })
            .eq("id", withdrawal_id);

          if (updateErr) {
            // Transfer is live but DB update failed — log for manual recovery
            console.error("CRITICAL: Transfer initiated but status update failed", {
              withdrawal_id,
              transferCode,
              transferReference,
              error: updateErr.message,
            });
          }

          return new Response(JSON.stringify({
            success: true,
            message: "Transfer initiated. Payout will complete once Paystack confirms via webhook.",
            transfer_code: transferCode,
            transfer_reference: transferReference,
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });

        } catch (paystackErr: any) {
          console.error("PAYSTACK_PAYOUT_ERROR", paystackErr);
          return new Response(JSON.stringify({ error: paystackErr.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      case "verify_paystack_transfer": {
        const { withdrawal_id } = body;
        if (!withdrawal_id || !isValidUuid(withdrawal_id)) {
          return new Response(JSON.stringify({ error: "Invalid or missing withdrawal_id" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        console.log(`Verifying Paystack transfer for withdrawal ID: "${withdrawal_id}"`);

        // 1. Fetch withdrawal record first
        const { data: withdrawal, error: fetchErr } = await supabaseAdmin
          .from("withdrawals")
          .select("*")
          .eq("id", withdrawal_id.trim())
          .maybeSingle();

        if (fetchErr) {
          console.error("Database fetch error (withdrawals):", fetchErr);
          return new Response(JSON.stringify({ error: `Database error: ${fetchErr.message}` }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!withdrawal) {
          console.error(`Withdrawal NOT FOUND in DB for ID: ${withdrawal_id}`);
          return new Response(JSON.stringify({ error: `Withdrawal request not found in database for ID: ${withdrawal_id}` }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        let PAYSTACK_SECRET = "";
        try {
          const { data: settings } = await supabaseAdmin
            .from("v_system_settings_with_secrets")
            .select("paystack_secret_key")
            .eq("id", 1)
            .maybeSingle();
          PAYSTACK_SECRET = settings?.paystack_secret_key || "";
        } catch (dbErr) {
          console.error("Failed to fetch paystack_secret_key from DB in verify:", dbErr);
        }
        if (!PAYSTACK_SECRET) {
          PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
        }
        if (!PAYSTACK_SECRET) {
          return new Response(JSON.stringify({ error: "Paystack Secret Key not configured in Edge Functions" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // We use either the paystack_transfer_reference or withdrawal.id as fallback
        const reference = withdrawal.paystack_transfer_reference || withdrawal.id;

        try {
          // 2. Query Paystack verify transfer endpoint
          console.log(`Querying Paystack for transfer reference: ${reference}`);
          const verifyRes = await fetch(`https://api.paystack.co/transfer/verify/${reference}`, {
            headers: { 
              "Authorization": `Bearer ${PAYSTACK_SECRET}`,
              "Accept": "application/json"
            },
          });

          const verifyData = await verifyRes.json();

          if (!verifyRes.ok || !verifyData.status) {
            const isNotFound = verifyRes.status === 404 || 
                               (verifyData.message && verifyData.message.toLowerCase().includes("not found")) ||
                               (verifyData.message && verifyData.message.toLowerCase().includes("reference"));
            
            if (isNotFound) {
              console.log(`Transfer not found on Paystack for withdrawal ${withdrawal_id}. Marking withdrawal as failed.`);
              const { error: updateError } = await supabaseAdmin
                .from("withdrawals")
                .update({ 
                  status: "failed", 
                  failure_reason: "Transfer not found on Paystack" 
                })
                .eq("id", withdrawal_id);
              
              if (updateError) {
                console.error("Failed to update withdrawal status to failed:", updateError);
                throw new Error(`Transfer not found on Paystack, and failed to update DB: ${updateError.message}`);
              }
              
              return new Response(JSON.stringify({
                success: true,
                status: "failed",
                message: "Transfer not found on Paystack. Withdrawal marked as failed."
              }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            
            throw new Error(verifyData.message || "Failed to verify transfer with Paystack");
          }

          const transferStatus = verifyData.data?.status; // e.g., 'success', 'failed', 'otp', 'pending', 'reversed', 'abandoned'
          const gatewayResponse = verifyData.data?.gateway_response || verifyData.data?.reason || transferStatus;

          console.log(`Paystack returned status '${transferStatus}' for reference: ${reference}`);

          if (transferStatus === "success") {
            // Only finalize if currently processing
            if (withdrawal.status === "processing") {
              const { data: finalizeResult, error: finalizeErr } = await supabaseAdmin.rpc("finalize_withdrawal", {
                p_withdrawal_id: withdrawal_id
              });

              if (finalizeErr || !finalizeResult?.success) {
                throw new Error(finalizeErr?.message || finalizeResult?.error || "Failed to finalize withdrawal in database");
              }

              // Send SMS notification
              try {
                await sendWithdrawalCompletedSms(withdrawal.agent_id, withdrawal.amount);
              } catch (smsErr) {
                console.error("SMS_ERROR", smsErr);
              }

              // Trigger Push Notification for Withdrawal Success
              try {
                await triggerPushNotification(supabaseAdmin, {
                  user_id: withdrawal.agent_id,
                  title: "✅ Withdrawal Successful",
                  body: `Your withdrawal of GHS ${Number(withdrawal.amount).toFixed(2)} has been sent to your MoMo.`,
                  url: "/dashboard/withdrawals",
                  icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png"
                });
              } catch (pushErr) {
                console.error("Push notification error:", pushErr);
              }

              return new Response(JSON.stringify({ 
                success: true, 
                status: "success", 
                message: "Paystack transfer completed successfully. Withdrawal finalized." 
              }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            } else {
              return new Response(JSON.stringify({ 
                success: true, 
                status: "success", 
                message: `Paystack transfer is successful, but withdrawal is already in status '${withdrawal.status}'.` 
              }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          } else if (transferStatus === "failed" || transferStatus === "reversed" || transferStatus === "abandoned") {
            if (withdrawal.status === "processing") {
              const { error: updateError } = await supabaseAdmin
                .from("withdrawals")
                .update({ 
                  status: "failed", 
                  failure_reason: `Paystack Transfer ${transferStatus}: ${gatewayResponse}` 
                })
                .eq("id", withdrawal_id);

              if (updateError) throw updateError;

              return new Response(JSON.stringify({ 
                success: true, 
                status: "failed", 
                message: `Paystack transfer failed with status '${transferStatus}'. Withdrawal marked as failed.` 
              }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            } else {
              return new Response(JSON.stringify({ 
                success: true, 
                status: "failed", 
                message: `Paystack transfer failed/reversed, but withdrawal is already in status '${withdrawal.status}'.` 
              }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          } else {
            // status is 'pending', 'otp', or similar
            let statusMessage = `Paystack transfer is currently '${transferStatus}'.`;
            if (transferStatus === "otp") {
              statusMessage += " Release / OTP confirmation is required on the Paystack dashboard.";
            } else if (transferStatus === "pending") {
              statusMessage += " It is awaiting processing by Paystack.";
            }

            return new Response(JSON.stringify({ 
              success: true, 
              status: transferStatus, 
              message: statusMessage 
            }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

        } catch (err: any) {
          console.error("VERIFY_PAYSTACK_TRANSFER_ERROR", err);
          return new Response(JSON.stringify({ error: err.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      case "confirm_withdrawal": {
        const { withdrawal_id } = body;
        console.log("CONFIRMING_WITHDRAWAL_START", { withdrawal_id });
        
        if (!withdrawal_id || !isValidUuid(withdrawal_id)) {
          console.warn("CONFIRM_WITHDRAWAL_INVALID_ID", { withdrawal_id });
          return new Response(JSON.stringify({ error: "Invalid or missing withdrawal_id" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // If the withdrawal was previously failed, temporarily mark it as processing
        // so that the database RPC function finalize_withdrawal can run successfully
        const { data: wd } = await supabaseAdmin
          .from("withdrawals")
          .select("status")
          .eq("id", withdrawal_id)
          .maybeSingle();

        if (wd && wd.status === "failed") {
          await supabaseAdmin
            .from("withdrawals")
            .update({ status: "processing", failure_reason: null })
            .eq("id", withdrawal_id);
        }

        const { data: result, error: rpcError } = await supabaseAdmin.rpc("finalize_withdrawal", {
          p_withdrawal_id: withdrawal_id
        });

        if (rpcError) {
          console.error("RPC_ERROR_FINALIZE", rpcError);
          return new Response(JSON.stringify({ error: rpcError.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!result?.success) {
          console.warn("FINALIZE_FAILURE", result?.error);
          return new Response(JSON.stringify({ error: result?.error || "Failed to finalize withdrawal" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Fetch details for SMS
        const { data: withdrawal } = await supabaseAdmin
          .from("withdrawals")
          .select("agent_id, amount")
          .eq("id", withdrawal_id)
          .maybeSingle();
        
        if (withdrawal) {
          try {
            await sendWithdrawalCompletedSms(withdrawal.agent_id, withdrawal.amount);
          } catch (smsErr) {
            console.error("SMS_ERROR", smsErr);
            // Don't fail the whole request just because SMS failed
          }
        }

        return new Response(JSON.stringify({ success: true, new_balance: result.new_balance }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      case "update_credit_limit": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        const { credit_limit } = body;
        if (typeof credit_limit !== "number" || credit_limit < 0) {
          return new Response(JSON.stringify({ error: "Invalid credit limit amount" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { error: updateError } = await supabaseAdmin
          .from("wallets")
          .update({ credit_limit })
          .eq("agent_id", user_id);

        if (updateError) throw updateError;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "send_reset_link": {
        if (!email) {
          return new Response(JSON.stringify({ error: "Email is required for reset link" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const appOrigin = (Deno as any).env.get("SITE_URL") || req.headers.get("origin") || "";
        const redirectTo = appOrigin
          ? `${appOrigin}${redirect_path || "/reset-password"}`
          : undefined;
        const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo });

        if (resetError) {
          return new Response(JSON.stringify({ error: resetError.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "reset_password": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        const generatedPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
        const passwordToSet =
          typeof new_password === "string" && new_password.trim().length >= 6
            ? new_password.trim()
            : generatedPassword;

        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
          password: passwordToSet,
        });

        if (updateError) {
          return new Response(JSON.stringify({ error: updateError.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "delete_user": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        if (user_id === actor.id) {
          return new Response(JSON.stringify({ error: "You cannot delete your own account" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user_id);
        if (deleteError) {
          return new Response(JSON.stringify({ error: deleteError.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get_provider_balance": {
        const { data: activeProviders, error: providersError } = await supabaseAdmin
          .from("providers")
          .select("*")
          .eq("is_active", true);

        if (providersError) {
          return new Response(JSON.stringify({ error: providersError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const results = [];

        for (const p of activeProviders || []) {
          const apiKey = p.api_key || "";
          const baseUrl = (p.base_url || "").replace(/\/+$/, "");
          if (!apiKey || !baseUrl) continue;

          let balanceUrls = [
            `${baseUrl}/balance`,
            `${baseUrl}/api/balance`,
            `${baseUrl}/user/balance`,
          ];

          // Specific overrides for known providers
          if (baseUrl.includes("spendless.top")) {
            balanceUrls = [`${baseUrl}/balance`].concat(balanceUrls);
          }

          let fetchedBalance: number | null = null;
          let lastError = "";

          for (const url of balanceUrls) {
            try {
              const res = await fetch(url, {
                method: "GET",
                headers: {
                  "X-API-Key": apiKey,
                  "Authorization": `Bearer ${apiKey}`,
                  "Accept": "application/json",
                  "User-Agent": "SwiftDataGH/2.0",
                },
              });

              const text = await res.text();
              if (res.ok) {
                const parsed = JSON.parse(text);
                const bal = parsed.balance ?? parsed.data?.balance ?? parsed.wallet_balance ?? parsed.walletBalance;
                if (bal !== undefined) {
                  fetchedBalance = Number(bal);
                  break;
                }
              } else {
                lastError = `HTTP ${res.status}: ${text.slice(0, 100)}`;
              }
            } catch (err: any) {
              lastError = err.message || "Network error";
            }
          }

          if (fetchedBalance !== null) {
            // Persist the synced balance in the database
            await supabaseAdmin
              .from("providers")
              .update({ balance: fetchedBalance, last_balance_check: new Date().toISOString() })
              .eq("id", p.id);

            results.push({ id: p.id, name: p.name, balance: fetchedBalance, status: "synced" });
          } else {
            results.push({ id: p.id, name: p.name, status: "failed_to_sync", reason: lastError });
          }
        }

        const primaryBalance = results.find(r => r.status === "synced" && r.name.toLowerCase().includes("datahub"))?.balance 
          ?? results.find(r => r.status === "synced")?.balance 
          ?? 0;

        return new Response(JSON.stringify({
          success: true,
          balance: Number(primaryBalance),
          results,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get_edge_ip": {
        try {
          const res = await fetch("https://api.ipify.org?format=json");
          const data = await res.json();
          return new Response(JSON.stringify({ success: true, ip: data.ip }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ success: false, error: e.message || String(e) }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      case "test_direct_korba": {
        const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || "2419";
        const KORBA_CLIENT_KEY = Deno.env.get("KORBA_CLIENT_KEY") || "";
        const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || "";

        const payload = {
          client_id: parseInt(KORBA_CLIENT_ID) || 2419,
        };
        const sortedKeys = Object.keys(payload).sort();
        const messageParts = [];
        for (const key of sortedKeys) {
          messageParts.push(`${key}=${(payload as any)[key]}`);
        }
        const message = messageParts.join("&");
        
        const keyData = new TextEncoder().encode(KORBA_SECRET_KEY);
        const cryptoKey = await crypto.subtle.importKey(
          'raw',
          keyData,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
        const messageData = new TextEncoder().encode(message);
        const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
        const signatureHex = Array.from(new Uint8Array(signatureBuffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        try {
          const bridgeUrl = Deno.env.get("KORBA_BRIDGE_URL") || "https://swiftdatagh.shop/api/korba";
          const bridgeSecret = Deno.env.get("KORBA_BRIDGE_SECRET") || "swiftdata-korba-bridge-token-2026";
          
          console.log(`[system-payout-v1] Testing Korba request via Vercel bridge: ${bridgeUrl}`);
          const res = await fetch(bridgeUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-bridge-secret": bridgeSecret
            },
            body: JSON.stringify({
              url: "https://xchange.korba365.com/api/v1.0/get_mtndata_product_id/",
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `HMAC ${KORBA_CLIENT_KEY}:${signatureHex}`
              },
              body: JSON.stringify(payload)
            })
          });

          const text = await res.text();
          return new Response(JSON.stringify({ success: true, status: res.status, body: text }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ success: false, error: e.message || String(e) }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      case "get_korba_balance": {
        const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || "2419";
        const balancePayload = {
          client_id: parseInt(KORBA_CLIENT_ID) || 2419,
        };

        const result = await queryKorbaApi(
          supabaseAdmin,
          "https://xchange.korba365.com/api/v1.0/get_ova_balance/",
          balancePayload
        );

        if (result.success && result.data) {
          return new Response(JSON.stringify({
            success: true,
            ova_balance: result.data.ova_balance ?? 0,
            message: result.data.message || "",
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } else {
          const errMsg = result.data?.detail || result.data?.message || result.data?.error || result.error || "Failed to fetch Korba balance";
          return new Response(JSON.stringify({
            success: false,
            error: errMsg,
            message: errMsg,
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      case "get_korba_transactions": {
        const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || "2419";
        const txPayload = {
          client_id: KORBA_CLIENT_ID,
        };

        const result = await queryKorbaApi(
          supabaseAdmin,
          "https://xchange.korba365.com/api/v1.0/client_transactions/",
          txPayload
        );

        if (result.success && result.data) {
          return new Response(JSON.stringify({
            success: true,
            count: result.data.count ?? 0,
            next: result.data.next ?? null,
            previous: result.data.previous ?? null,
            results: result.data.results ?? [],
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } else {
          const errMsg = result.data?.detail || result.data?.message || result.data?.error || result.error || "Failed to fetch Korba transactions";
          return new Response(JSON.stringify({
            success: false,
            error: errMsg,
            message: errMsg,
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      case "get_korba_packages": {
        const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || "2419";
        const balancePayload = {
          client_id: parseInt(KORBA_CLIENT_ID) || 2419,
        };

        const fetchBundlesForUrl = async (endpoint: string, networkName: string) => {
          const result = await queryKorbaApi(supabaseAdmin, endpoint, balancePayload);
          if (result.success && result.data) {
            return (result.data.bundles || []).map((b: any) => ({
              ...b,
              network: networkName,
            }));
          } else {
            console.error(`Failed to fetch bundles for ${networkName}:`, result.data || result.error);
            throw new Error(result.data?.detail || result.data?.message || result.data?.error || result.error || `Failed to fetch ${networkName} bundles`);
          }
        };

        let mtnBundles: any[] = [];
        let telecelBundles: any[] = [];
        let airtelTigoBundles: any[] = [];

        try {
          try {
            console.log("[get_korba_packages] Fetching MTN bundles...");
            mtnBundles = await fetchBundlesForUrl("https://xchange.korba365.com/api/v1.0/get_mtndata_product_id/", "MTN");
          } catch (err: any) {
            console.error("[get_korba_packages] Failed to fetch MTN bundles:", err.message || err);
          }

          try {
            console.log("[get_korba_packages] Fetching Telecel bundles...");
            telecelBundles = await fetchBundlesForUrl("https://xchange.korba365.com/api/v1.0/get_vodafonedata_product_id/", "Vodafone/Telecel");
          } catch (err: any) {
            console.error("[get_korba_packages] Failed to fetch Telecel bundles:", err.message || err);
          }

          try {
            console.log("[get_korba_packages] Fetching AirtelTigo bundles...");
            airtelTigoBundles = await fetchBundlesForUrl("https://xchange.korba365.com/api/v1.0/get_airteltigodata_product_id/", "AirtelTigo");
          } catch (err: any) {
            console.error("[get_korba_packages] Failed to fetch AirtelTigo bundles:", err.message || err);
          }

          const airtimePackages = [
            {
              name: "MTN Airtime",
              product_id: "MTN_AIRTIME",
              amount: "0",
              validity: "Non-expiry",
              network: "MTN",
              category: "Airtime"
            },
            {
              name: "Telecel Airtime",
              product_id: "TELECEL_AIRTIME",
              amount: "0",
              validity: "Non-expiry",
              network: "Vodafone/Telecel",
              category: "Airtime"
            },
            {
              name: "AirtelTigo Airtime",
              product_id: "AIRTELTIGO_AIRTIME",
              amount: "0",
              validity: "Non-expiry",
              network: "AirtelTigo",
              category: "Airtime"
            }
          ];

          const allBundles = [...mtnBundles, ...telecelBundles, ...airtelTigoBundles, ...airtimePackages];
          if (allBundles.length === 0) {
            throw new Error("Failed to fetch packages from all Korba API networks due to timeouts or errors.");
          }

          return new Response(JSON.stringify({
            success: true,
            bundles: allBundles,
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error(`[get_korba_packages] Error:`, e);
          return new Response(JSON.stringify({
            success: false,
            error: e.message || "Failed to fetch Korba packages",
          }), { status: 200, headers: corsHeaders });
        }
      }

      case "check_proxy_health": {
        try {
          console.log("[Proxy Health Check] Running health check on pg_net...");
          const res = await fetchViaDb(
            supabaseAdmin,
            "https://postman-echo.com/get",
            {},
            4
          );
          const resText = await res.text();
          console.log(`[Proxy Health Check] Response status: ${res.status}`);
          
          if (res.ok && !resText.includes("Gateway Timeout") && !resText.includes("canceling statement")) {
            return new Response(JSON.stringify({
              success: true,
              healthy: true
            }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          } else {
            return new Response(JSON.stringify({
              success: true,
              healthy: false,
              error: resText || `HTTP ${res.status}`
            }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        } catch (e: any) {
          console.error(`[Proxy Health Check] Exception:`, e);
          return new Response(JSON.stringify({
            success: true,
            healthy: false,
            error: e.message || "Unknown error"
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      case "find_user": {
        const { search } = body;
        const { data: users, error: findError } = await supabaseAdmin
          .from("profiles")
          .select("user_id, email, full_name, is_agent, agent_approved")
          .or(`email.ilike.%${search}%,full_name.ilike.%${search}%`)
          .limit(10);

        if (findError) throw findError;
        return new Response(JSON.stringify({ users }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get_system_errors": {
        const { data: failedOrders } = await supabaseAdmin
          .from("orders")
          .select("id, order_type, status, failure_reason, created_at, agent_id")
          .eq("status", "failed")
          .order("created_at", { ascending: false })
          .limit(20);

        const { data: recentLogs } = await supabaseAdmin
          .from("audit_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(20);

        return new Response(JSON.stringify({ failedOrders, recentLogs }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "purge_test_accounts": {
        const { data: result, error: rpcError } = await supabaseAdmin.rpc("purge_test_accounts");
        if (rpcError) throw rpcError;
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "bulk_suspend_users": {
        const { user_ids, suspend } = body;
        if (!Array.isArray(user_ids)) throw new Error("user_ids must be an array");
        const { data: result, error: rpcError } = await supabaseAdmin.rpc("bulk_suspend_users", {
          p_user_ids: user_ids,
          p_suspend: !!suspend
        });
        if (rpcError) throw rpcError;
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "manage_blacklist": {
        const { op, type, value, reason } = body;
        if (op === "add") {
          const { error: insError } = await supabaseAdmin.from("security_blacklist").insert({
            type, value, reason, created_by: actor.id
          });
          if (insError) throw insError;
        } else if (op === "remove") {
          const { error: delError } = await supabaseAdmin.from("security_blacklist").delete().eq("value", value);
          if (delError) throw delError;
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "reject_withdrawal": {
        const { withdrawal_id, reason } = body;
        if (!withdrawal_id || !isValidUuid(withdrawal_id)) {
          return new Response(JSON.stringify({ error: "Invalid or missing withdrawal_id" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: wd } = await supabaseAdmin
          .from("withdrawals")
          .select("status")
          .eq("id", withdrawal_id)
          .maybeSingle();

        const allowedStatuses = ["pending", "processing", "failed"];
        if (!wd || !allowedStatuses.includes(wd.status)) {
          return new Response(JSON.stringify({ error: `Withdrawal is already ${wd?.status}` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { error: updateError } = await supabaseAdmin
          .from("withdrawals")
          .update({ status: "failed", failure_reason: reason || "Rejected by admin" })
          .eq("id", withdrawal_id);

        if (updateError) throw updateError;

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "bulk_fulfill_api_orders": {
        // Atomic bulk update for efficiency
        const { data: updatedOrders, error: updateError } = await supabaseAdmin
          .from("orders")
          .update({ status: "fulfilled", failure_reason: null })
          .eq("order_type", "api")
          .in("status", ["paid", "processing", "fulfillment_failed"])
          .select("id");
        
        if (updateError) throw updateError;
        
        const count = updatedOrders?.length || 0;
        
        // Credit profits for all updated orders — run in parallel
        let profitsFailed = 0;
        if (count > 0) {
          const results = await Promise.allSettled(
            updatedOrders!.map((order: { id: string }) =>
              supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id })
            )
          );
          for (const r of results) {
            if (r.status === "rejected" || r.value?.error) {
              profitsFailed++;
              console.error("Profit credit failed:", r.status === "rejected" ? r.reason : r.value.error);
            }
          }
        }

        return new Response(JSON.stringify({ 
          success: true, 
          message: `Successfully fulfilled ${count} API orders.${profitsFailed > 0 ? ` Note: ${profitsFailed} profit calculations skipped/failed.` : ""}`, 
          fulfilled: count,
          profits_failed: profitsFailed
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "save_package_settings": {
        const { packages } = body;
        if (!Array.isArray(packages) || packages.length === 0) {
          return new Response(JSON.stringify({ error: "packages array is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const upserts = packages.map((p: any) => ({
          network: p.network,
          package_size: p.package_size,
          cost_price: p.cost_price ?? null,
          agent_price: p.agent_price ?? null,
          sub_agent_price: p.sub_agent_price ?? null,
          public_price: p.public_price ?? null,
          api_price: p.api_price ?? null,
          is_unavailable: !!p.is_unavailable,
          updated_at: new Date().toISOString(),
        }));

        const { error: upsertError } = await supabaseAdmin
          .from("global_package_settings")
          .upsert(upserts, { onConflict: "network,package_size" });

        if (upsertError) {
          return new Response(JSON.stringify({ error: upsertError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ success: true, saved: upserts.length }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "reset_user_mfa": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        
         // 1. List factors for this user via service-role admin api (using modern v2 API)
        const { data: factorData, error: listError } = await supabaseAdmin.auth.admin.mfa.listFactors({
          userId: user_id
        });

        if (listError) {
          console.error("Error listing MFA factors:", listError);
          throw listError;
        }

        // 2. Loop through and delete all factors safely
        const factors = factorData?.factors || [];
        let deletedCount = 0;
        
        for (const factor of factors) {
          const { error: deleteError } = await supabaseAdmin.auth.admin.mfa.deleteFactor({
            id: factor.id,
            userId: user_id
          });
          if (deleteError) {
            console.error(`Failed to delete factor ${factor.id}:`, deleteError);
          } else {
            deletedCount++;
          }
        }

        return new Response(JSON.stringify({ 
          success: true, 
          reset_count: deletedCount, 
          message: `Successfully cleared ${deletedCount} MFA factor(s) for user.` 
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get_admins": {
        const { data: admins, error: fetchErr } = await supabaseAdmin
          .from("user_roles")
          .select("user_id, role, allowed_ips")
          .eq("role", "admin");

        if (fetchErr) throw fetchErr;

        const ids = (admins || []).map((a: any) => a.user_id);
        let profilesMap: Record<string, any> = {};
        let mfaMap: Record<string, boolean> = {};

        if (ids.length > 0) {
          const [profilesRes, mfaRes] = await Promise.all([
            supabaseAdmin
              .from("profiles")
              .select("user_id, email, full_name, last_seen_at")
              .in("user_id", ids),
            supabaseAdmin
              .from("user_mfa_status")
              .select("user_id, has_mfa")
              .in("user_id", ids)
          ]);

          if (profilesRes.data) {
            profilesMap = Object.fromEntries(profilesRes.data.map((p: any) => [p.user_id, p]));
          }
          if (mfaRes.data) {
            mfaMap = Object.fromEntries(mfaRes.data.map((m: any) => [m.user_id, !!m.has_mfa]));
          }
        }

        const enriched = (admins || []).map((a: any) => {
          const profile = profilesMap[a.user_id] || {};
          return {
            user_id: a.user_id,
            role: a.role,
            allowed_ips: a.allowed_ips,
            email: profile.email || "",
            full_name: profile.full_name || "",
            last_seen_at: profile.last_seen_at || null,
            is_mfa_verified: !!mfaMap[a.user_id]
          };
        });

        return new Response(JSON.stringify({ admins: enriched }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "grant_admin_role": {
        if (!email) throw new Error("Email address is required");
        const targetEmail = email.trim();

        console.log(`[Grant Admin] Resolving identity for: ${targetEmail}`);

        // 1. Query direct Master Auth Directory (auth.users) as the SOURCE OF TRUTH
        const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.listUsers({
          filter: `email = '${targetEmail}'`
        });

        if (authErr) {
          console.error("[Grant Admin] Master Auth fetch failed:", authErr);
          throw authErr;
        }

        const authUser = authData?.users?.[0] || null;

        // If they aren't in global Auth, they definitely haven't registered yet!
        if (!authUser) {
          console.warn(`[Grant Admin] User not found in Master Auth. Fetching suggestions...`);
          
          // Fuzzy query suggestion engine
          const prefix = targetEmail.split("@")[0]?.toLowerCase() || "";
          const { data: matches } = prefix.length > 2
            ? await supabaseAdmin
                .from("profiles")
                .select("email")
                .ilike("email", `%${prefix}%`)
                .limit(5)
            : { data: [] };

          const suggestions = (matches || [])
            .map((m: any) => m.email)
            .filter((e: string) => e && e.toLowerCase() !== targetEmail.toLowerCase());

          const errorMsg = suggestions.length > 0
            ? `User account not found. Did you mean one of these registered accounts: ${suggestions.join(", ")}?`
            : `User account for '${targetEmail}' not found. They must sign up and create a profile on the platform first.`;

          return new Response(JSON.stringify({ error: errorMsg }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const realUserId = authUser.id;
        console.log(`[Grant Admin] Valid Master User ID resolved: ${realUserId}`);

        // 2. Check public profiles by BOTH email and user_id to resolve ghost entries
        const [profileByEmailRes, profileByIdRes] = await Promise.all([
          supabaseAdmin.from("profiles").select("user_id, email, full_name").ilike("email", targetEmail).maybeSingle(),
          supabaseAdmin.from("profiles").select("user_id, email, full_name").eq("user_id", realUserId).maybeSingle()
        ]);

        if (profileByEmailRes.error) throw profileByEmailRes.error;
        if (profileByIdRes.error) throw profileByIdRes.error;

        const profileByEmail = profileByEmailRes.data;
        const profileById = profileByIdRes.data;

        let activeProfile = profileById;

        // 3. GHOST PROFILE ALIGNMENT ALGORITHM
        // If a profile exists with this email but belongs to a different user_id, it is a ghost profile and must be purged!
        if (profileByEmail && profileByEmail.user_id !== realUserId) {
          console.warn(`[Ghost Purge] Stale profile found for email ${targetEmail} with mismatched ID: ${profileByEmail.user_id}. Purging...`);
          const { error: purgeErr } = await supabaseAdmin
            .from("profiles")
            .delete()
            .eq("user_id", profileByEmail.user_id);

          if (purgeErr) {
            console.error("[Ghost Purge] Stale row delete failed:", purgeErr);
          } else {
            console.log("[Ghost Purge] Obsolete profile record successfully wiped.");
          }
        }

        // 4. INJECT OR ALIGN PROFILE ROW
        if (!activeProfile) {
          console.log(`[Identity Restore] Injecting synchronized profile record for user: ${realUserId}`);
          
          const { data: newProfile, error: createErr } = await supabaseAdmin
            .from("profiles")
            .insert({
              user_id: realUserId,
              email: authUser.email || targetEmail,
              full_name: authUser.user_metadata?.full_name || "Administrator"
            })
            .select("user_id, email, full_name")
            .maybeSingle();

          if (createErr) {
            console.error("[Identity Restore] Profile recovery crash:", createErr);
            throw new Error("Failed to synchronize account profile. Technical detail: " + createErr.message);
          }

          if (!newProfile) {
            throw new Error("Critical database pipeline failure. Could not bind new identity row.");
          }

          console.log("[Identity Restore] System data aligned flawlessly!");
          activeProfile = newProfile;
        } else {
          // If the profile exists but the email is mismatching, update it to align
          if (activeProfile.email?.toLowerCase() !== targetEmail.toLowerCase()) {
            console.log(`[Identity Restore] Aligning profile email to match auth email: ${targetEmail}`);
            await supabaseAdmin
              .from("profiles")
              .update({ email: targetEmail })
              .eq("user_id", realUserId);
            activeProfile.email = targetEmail;
          }
        }

        // 5. Grant role to the VALID, ALIGNED User ID
        const { data: existingRole } = await supabaseAdmin
          .from("user_roles")
          .select("id, role")
          .eq("user_id", realUserId)
          .maybeSingle();

        let grantErr;
        if (existingRole) {
          const { error } = await supabaseAdmin
            .from("user_roles")
            .update({ role: "admin" })
            .eq("user_id", realUserId);
          grantErr = error;
        } else {
          const { error } = await supabaseAdmin
            .from("user_roles")
            .insert({
              user_id: realUserId,
              role: "admin"
            });
          grantErr = error;
        }
        
        if (grantErr) throw grantErr;

        await supabaseAdmin.from("admin_action_log").insert({
          admin_email: actor.email || "system",
          action: "grant_admin_role",
          target_email: activeProfile.email,
          metadata: { target_name: activeProfile.full_name, granted_by: actor.id }
        });

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "revoke_admin_role": {
        if (!isValidUuid(user_id)) throw new Error("Invalid target user_id");
        
        if (user_id === actor.id) {
          return new Response(JSON.stringify({ error: "You cannot revoke your own admin access!" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: profile } = await supabaseAdmin.from("profiles").select("email").eq("user_id", user_id).single();

        const { error: revokeErr } = await supabaseAdmin
          .from("user_roles")
          .delete()
          .eq("user_id", user_id)
          .eq("role", "admin");
        
        if (revokeErr) throw revokeErr;

        await supabaseAdmin.from("admin_action_log").insert({
          admin_email: actor.email || "system",
          action: "revoke_admin_role",
          target_email: profile?.email || user_id,
          metadata: { revoked_by: actor.id }
        });

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Invalid action: ${action}. Check if function is deployed with latest code.` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

  } catch (error) {
    console.error("admin-user-actions error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : typeof error === 'object' ? JSON.stringify(error) : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
