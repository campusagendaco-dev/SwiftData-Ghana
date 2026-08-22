import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, sendSmsViaTxtConnect, formatTemplate } from "../_shared/sms.ts";
import { verifyAdmin } from "../_shared/auth.ts";

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
  | "get_provider_balance"
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
  | "refund_order"
  | "force_fulfill_order"
  | "heal_stuck_orders"
  | "bulk_update_order_status"
  | "purge_bot_spam";




serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const authResult = await verifyAdmin(req, supabaseAdmin);
  if (!authResult.success) {
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: authResult.status,
      headers: JSON_HEADERS,
    });
  }
  const actor = authResult.user;

  try {
    const body = await req.json();
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
          .select("user_id, full_name, email, api_key_prefix, api_key_hash, api_secret_key_hash, api_access_enabled, api_rate_limit, api_allowed_actions, api_ip_whitelist, api_webhook_url, api_requests_today, api_requests_total, api_last_used_at, agent_approved, sub_agent_approved, api_custom_prices")
          .or("api_key_prefix.not.is.null,api_key_hash.not.is.null,api_access_enabled.eq.true")
          .order("full_name");

        if (newError) {
          console.warn("Falling back to legacy API user query:", newError.message);
          // Fallback to legacy columns if migration hasn't been run
          const { data: legacyData, error: legacyError } = await supabaseAdmin
            .from("profiles")
            .select("user_id, full_name, email, api_key_prefix, api_key_hash, api_access_enabled, api_rate_limit, api_allowed_actions, api_ip_whitelist, api_webhook_url, api_requests_today, api_requests_total, api_last_used_at, agent_approved, sub_agent_approved, api_custom_prices")
            .or("api_key_prefix.not.is.null,api_key_hash.not.is.null,api_access_enabled.eq.true")
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
        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({ api_access_enabled: !!enabled })
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
        
        // Update profile
        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({
            is_agent: true,
            agent_approved: true,
            sub_agent_approved: false,
            onboarding_complete: true,
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
            .select("user_id")
            .ilike("email", email.trim())
            .maybeSingle();

          if (findError) throw findError;
          if (!profile) {
             return new Response(JSON.stringify({ error: `User ${email} not found in profiles.` }), {
               status: 404,
               headers: { ...corsHeaders, "Content-Type": "application/json" },
             });
          }

          const targetId = profile.user_id;
          console.log("APPROVE_BY_EMAIL_TARGET", targetId);

          const { error: updError } = await supabaseAdmin
            .from("profiles")
            .update({
              is_agent: true,
              agent_approved: true,
              sub_agent_approved: false,
              onboarding_complete: true,
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
        const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
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
          .select("parent_agent_id")
          .eq("user_id", user_id)
          .maybeSingle();

        if (!profile?.parent_agent_id) {
          return new Response(JSON.stringify({ error: "User is not a sub-agent or missing parent" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

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
        const pricesToAssign = hasSubPrices ? subPrices : (parent?.agent_prices || {});

        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({
            is_agent: true,
            agent_approved: true,
            onboarding_complete: true,
            sub_agent_approved: true,
            agent_prices: pricesToAssign,
          })
          .eq("user_id", user_id);

        if (updateError) throw updateError;
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

        if (rpcError) throw rpcError;
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

        if (orderError) throw orderError;

        sendManualCreditSms(user_id, amount).catch(console.error);

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

        if (rpcError) throw rpcError;
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

        if (orderError) throw orderError;

        sendManualApiCreditSms(user_id, amount).catch(console.error);

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
          .from("v_system_settings_with_secrets").select("*")
          .limit(1)
          .maybeSingle();

        if (fetchError) throw fetchError;

        // Filter settings to only include keys that exist in the DB
        const validKeys = existing ? Object.keys(existing) : [];

        // Define expected types for known sensitive settings
        const BOOLEAN_KEYS = new Set(["disable_ordering", "maintenance_mode", "auto_failover_enabled", "holiday_mode_enabled", "show_scrolling_ad", "home_page_video_muted", "auto_refund_enabled", "beneficiary_verification_enabled", "allow_non_beneficiary_continue"]);
        const NUMERIC_KEYS = new Set(["min_order_amount", "max_order_amount", "agent_activation_fee", "sub_agent_activation_fee", "wassce_price", "bece_price", "wassce_cost_price", "bece_cost_price", "background_brightness", "background_contrast", "background_blueness"]);
        const STRING_KEYS = new Set(["holiday_message", "data_provider_base_url", "secondary_data_provider_base_url", "whatsapp_bot_prompt", "site_name", "scrolling_ad_text", "home_page_video_url"]);

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

        return new Response(JSON.stringify({ 
          success: true, 
          skipped: Object.keys(settings).filter(k => !validKeys.includes(k)) 
        }), {
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

        const PAYSTACK_SECRET = (Deno as any).env.get("PAYSTACK_SECRET_KEY");
        if (!PAYSTACK_SECRET) {
          return new Response(JSON.stringify({ error: "Paystack Secret Key not configured in Edge Functions" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // 1. Fetch withdrawal and agent details
        const { data: withdrawal, error: fetchErr } = await supabaseAdmin
          .from("withdrawals")
          .select(`
            *,
            profiles:agent_id (
              full_name,
              momo_number,
              momo_network,
              momo_account_name
            )
          `)
          .eq("id", withdrawal_id)
          .maybeSingle();

        if (fetchErr || !withdrawal) {
          return new Response(JSON.stringify({ error: "Withdrawal request not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (withdrawal.status !== "pending") {
          return new Response(JSON.stringify({ error: `Withdrawal is already ${withdrawal.status}` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const profile = withdrawal.profiles;
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
              account_number: normalizePhone(profile.momo_number),
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
        const isSuspend = !!suspend;
        const { data: result, error: rpcError } = await supabaseAdmin.rpc("bulk_suspend_users", {
          p_user_ids: user_ids,
          p_suspend: isSuspend
        });
        if (rpcError) throw rpcError;

        // Also sync Supabase Auth GoTrue banned_until status so active session tokens are revoked immediately
        Promise.all(user_ids.map((uid: string) => 
          supabaseAdmin.auth.admin.updateUserById(uid, { ban_duration: isSuspend ? "876000h" : "none" }).catch(() => null)
        )).catch(() => null);

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

        if (!wd || wd.status !== "pending") {
          return new Response(JSON.stringify({ error: "Withdrawal is not pending" }), {
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

        // 2. Check the public database (profiles table)
        const { data: existingProfile, error: findErr } = await supabaseAdmin
          .from("profiles")
          .select("user_id, email, full_name")
          .ilike("email", targetEmail)
          .maybeSingle();
        
        if (findErr) throw findErr;

        let activeProfile = existingProfile;

        // 3. GHOST PROFILE ALIGNMENT ALGORITHM
        // If a profile exists but contains an old/mismatched User ID, it must be purged and aligned!
        if (existingProfile && existingProfile.user_id !== realUserId) {
          console.warn(`[Ghost Purge] ID Mismatch detected! Master=${realUserId}, Profile=${existingProfile.user_id}. Initiating repair...`);
          
          // Purge the stale orphaned profile row
          const { error: purgeErr } = await supabaseAdmin
            .from("profiles")
            .delete()
            .eq("user_id", existingProfile.user_id);

          if (purgeErr) {
            console.error("[Ghost Purge] Stale row delete failed:", purgeErr);
          } else {
            console.log("[Ghost Purge] Obsolete profile record successfully wiped.");
          }
          
          activeProfile = null; // Reset reference to trigger fresh injection below
        }

        // 4. INJECT MISSING OR REPAIRED PROFILE ROW
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

      case "refund_order": {
        const { orderId, reason } = body;
        if (!isValidUuid(orderId)) throw new Error("Invalid or missing orderId");
        
        // 1. Fetch order details
        const { data: order, error: fetchErr } = await supabaseAdmin
          .from("orders")
          .select("id, status, amount, agent_id, order_type, payment_method")
          .eq("id", orderId)
          .maybeSingle();

        if (fetchErr || !order) {
          throw new Error(fetchErr?.message || `Order ${orderId} not found.`);
        }

        if (order.status === "refunded") {
          return new Response(JSON.stringify({ success: true, message: "Order is already refunded" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // 2. Perform wallet/balance refund if there is a valid agent
        if (order.agent_id && order.agent_id !== "00000000-0000-0000-0000-000000000000") {
          if (order.order_type === "api") {
            const { error: refundErr } = await supabaseAdmin
              .schema("api")
              .rpc("credit_api_wallet", { p_user_id: order.agent_id, p_amount: order.amount });
            if (refundErr) throw refundErr;
          } else {
            const { error: refundErr } = await supabaseAdmin
              .rpc("credit_wallet", { p_agent_id: order.agent_id, p_amount: order.amount });
            if (refundErr) throw refundErr;
          }
        }

        // 3. Mark the order as refunded in the database
        const { error: updateErr } = await supabaseAdmin
          .from("orders")
          .update({
            status: "refunded",
            auto_refunded: true,
            refund_amount: order.amount,
            refunded_at: new Date().toISOString(),
            refund_reason: reason || "Manual refund by admin",
            updated_at: new Date().toISOString()
          })
          .eq("id", orderId);

        if (updateErr) throw updateErr;

        // Log the action to admin audit logs
        await supabaseAdmin.from("admin_action_log").insert({
          admin_email: actor.email || "system",
          action: "refund_order",
          target_email: order.agent_id,
          metadata: { order_id: orderId, reason, amount: order.amount }
        });

        return new Response(JSON.stringify({ success: true, message: "Order refunded to wallet successfully!" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "force_fulfill_order": {
        const { orderId } = body;
        if (!isValidUuid(orderId)) throw new Error("Invalid or missing orderId");

        // 1. Fetch order details
        const { data: order, error: fetchErr } = await supabaseAdmin
          .from("orders")
          .select("id, status, agent_id, amount, order_type")
          .eq("id", orderId)
          .maybeSingle();

        if (fetchErr || !order) {
          throw new Error(fetchErr?.message || `Order ${orderId} not found.`);
        }

        if (order.status === "fulfilled" || order.status === "completed") {
          return new Response(JSON.stringify({ success: true, message: "Order is already fulfilled" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // 2. Mark order as fulfilled
        const { error: updateErr } = await supabaseAdmin
          .from("orders")
          .update({
            status: "fulfilled",
            provider_order_id: "force_fulfilled_by_admin",
            updated_at: new Date().toISOString()
          })
          .eq("id", orderId);

        if (updateErr) throw updateErr;

        // Log the action to admin audit logs
        await supabaseAdmin.from("admin_action_log").insert({
          admin_email: actor.email || "system",
          action: "force_fulfill_order",
          target_email: order.agent_id,
          metadata: { order_id: orderId }
        });

        return new Response(JSON.stringify({ success: true, message: "Order force-fulfilled successfully!" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "heal_stuck_orders": {
        // Forward/Invoke heal-processing-orders Edge Function
        const { data, error } = await supabaseAdmin.functions.invoke("heal-processing-orders");
        if (error) {
          console.error("Failed to invoke heal-processing-orders:", error);
          throw error;
        }

        // Log the action to admin audit logs
        await supabaseAdmin.from("admin_action_log").insert({
          admin_email: actor.email || "system",
          action: "heal_stuck_orders",
          target_email: actor.id,
          metadata: { result: data }
        });

        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "bulk_update_order_status": {
        const { orderIds, status } = body;
        if (!Array.isArray(orderIds) || orderIds.length === 0) {
          throw new Error("Invalid or missing orderIds array");
        }
        if (!status) {
          throw new Error("Missing target status");
        }

        // Clean and validate order IDs
        const validIds = orderIds.filter(id => isValidUuid(id));
        if (validIds.length === 0) {
          throw new Error("No valid UUIDs found in orderIds");
        }

        const { error: updateErr } = await supabaseAdmin
          .from("orders")
          .update({
            status,
            updated_at: new Date().toISOString()
          })
          .in("id", validIds);

        if (updateErr) throw updateErr;

        // Log the action to admin audit logs
        await supabaseAdmin.from("admin_action_log").insert({
          admin_email: actor.email || "system",
          action: "bulk_update_order_status",
          target_email: actor.id,
          metadata: { count: validIds.length, status, order_ids: validIds }
        });

        return new Response(JSON.stringify({ success: true, message: `Successfully updated ${validIds.length} orders to ${status}` }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "purge_bot_spam": {
        const { data: spamOrders, error: findError } = await supabaseAdmin
          .from("orders")
          .select("id")
          .in("status", ["fulfillment_failed", "pending", "awaiting_payment"])
          .is("paystack_verified_amount", null)
          .or("failure_reason.ilike.%FAILED%,failure_reason.ilike.%Prompt Expired%,failure_reason.eq.TRANSACTION_NOT_FOUND,failure_reason.ilike.%not approved%,failure_reason.ilike.%Payment failed%,failure_reason.ilike.%LOW_BALANCE_OR_PAYEE_LIMIT%");

        if (findError) throw findError;

        if (!spamOrders || spamOrders.length === 0) {
          return new Response(JSON.stringify({ success: true, count: 0, message: "No uncompleted spam orders found." }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const ids = spamOrders.map((o: any) => o.id);
        const { error: delError } = await supabaseAdmin
          .from("orders")
          .delete()
          .in("id", ids);

        if (delError) throw delError;

        await supabaseAdmin.from("admin_action_log").insert({
          admin_email: actor.email || "system",
          action: "purge_bot_spam",
          target_email: actor.id,
          metadata: { count: ids.length, order_ids: ids }
        }).catch(() => {});

        return new Response(JSON.stringify({ success: true, count: ids.length, message: `Successfully purged ${ids.length} unpaid spam order(s).` }), {
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
        error: error instanceof Error ? error.message : "Internal error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
