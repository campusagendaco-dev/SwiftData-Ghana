import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, sendSmsViaTxtConnect, formatTemplate } from "../_shared/sms.ts";

declare const Deno: any;

async function sendManualCreditSms(supabaseAdmin: any, userId: string, amount: number) {
  try {
    const { data: profile } = await supabaseAdmin.from("profiles").select("phone").eq("user_id", userId).maybeSingle();
    if (!profile?.phone) return;

    const { apiKey, senderId, templates } = await getSmsConfig(supabaseAdmin);
    const recipient = normalizePhone(profile.phone);
    
    if (!apiKey || !recipient) return;

    const message = formatTemplate(templates.manual_credit, {
      amount: amount.toFixed(2)
    });

    await sendSmsViaTxtConnect(apiKey, senderId, recipient, message);
  } catch (error) {
    console.error("sendManualCreditSms error:", error);
  }
}

async function sendWithdrawalCompletedSms(supabaseAdmin: any, userId: string, amount: number) {
  try {
    const { data: profile } = await supabaseAdmin.from("profiles").select("phone").eq("user_id", userId).maybeSingle();
    if (!profile?.phone) return;

    const { apiKey, senderId, templates } = await getSmsConfig(supabaseAdmin);
    const recipient = normalizePhone(profile.phone);
    
    if (!apiKey || !recipient) return;

    const message = formatTemplate(templates.withdrawal_completed, {
      amount: amount.toFixed(2)
    });

    await sendSmsViaTxtConnect(apiKey, senderId, recipient, message);
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
  | "update_system_settings"
  | "confirm_withdrawal"
  | "get_provider_balance"
  | "update_credit_limit"
  | "approve_by_email"
  | "find_user"
  | "get_system_errors"
  | "purge_test_accounts"
  | "bulk_suspend_users"
  | "manage_blacklist";




serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = (Deno as any).env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = (Deno as any).env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const {
      data: { user: actor },
      error: actorError,
    } = await supabaseAdmin.auth.getUser(authHeader.replace(/^Bearer\s+/i, "").trim());

    if (actorError || !actor) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", actor.id)
      .eq("role", "admin")
      .limit(1);

    if (!roles || roles.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, user_id, email, redirect_path, new_password } = body;

    if (!action) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isValidUuid = (id: string) => id && UUID_RE.test(id);

    switch (action as AdminUserAction) {
      case "get_api_users": {
        // Include both legacy plaintext keys and new hashed keys (api_key_prefix set)
        const { data: users, error: userError } = await supabaseAdmin
          .from("profiles")
          .select("user_id, full_name, email, api_key_prefix, api_key_hash, api_access_enabled, api_rate_limit, api_allowed_actions, api_ip_whitelist, api_webhook_url, api_requests_today, api_requests_total, api_last_used_at, agent_approved, sub_agent_approved, api_custom_prices")
          .or("api_key_prefix.not.is.null,api_key_hash.not.is.null")
          .order("full_name");

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
        if (typeof amount !== "number" || amount <= 0) {
          return new Response(JSON.stringify({ error: "Invalid amount" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: result, error: rpcError } = await supabaseAdmin.rpc("credit_wallet", {
          p_agent_id: user_id,
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

        await sendManualCreditSms(supabaseAdmin, user_id, amount);

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
        const filteredSettings: Record<string, any> = {};
        
        Object.keys(settings).forEach(key => {
          if (validKeys.includes(key)) {
            filteredSettings[key] = settings[key];
          } else {
            console.warn(`Skipping unknown setting key: ${key}`);
          }
        });

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

      case "confirm_withdrawal": {
        const { withdrawal_id } = body;
        if (!withdrawal_id) {
          return new Response(JSON.stringify({ error: "Missing withdrawal_id" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Use the new atomic RPC to finalize withdrawal and deduct balance
        const { data: result, error: rpcError } = await supabaseAdmin.rpc("finalize_withdrawal", {
          p_withdrawal_id: withdrawal_id
        });

        if (rpcError || !result?.success) {
          return new Response(JSON.stringify({ error: rpcError?.message || result?.error || "Failed to finalize withdrawal" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Fetch withdrawal details to send SMS (the RPC already confirmed it)
        const { data: withdrawal } = await supabaseAdmin
          .from("withdrawals")
          .select("agent_id, amount")
          .eq("id", withdrawal_id)
          .maybeSingle();
        
        if (withdrawal) {
          await sendWithdrawalCompletedSms(supabaseAdmin, withdrawal.agent_id, withdrawal.amount);
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
        // Fetch from DB if available
        const { data: dbSettings } = await supabaseAdmin.from("system_settings").select("*").eq("id", 1).maybeSingle();
        
        const apiKey = (Deno as any).env.get("DATA_PROVIDER_API_KEY") || (Deno as any).env.get("PRIMARY_DATA_PROVIDER_API_KEY") || dbSettings?.data_provider_api_key || "";
        const baseUrl = ((Deno as any).env.get("DATA_PROVIDER_BASE_URL") || (Deno as any).env.get("PRIMARY_DATA_PROVIDER_BASE_URL") || dbSettings?.data_provider_base_url || "").replace(/\/+$/, "");
        
        const airtimeKey = (Deno as any).env.get("AIRTIME_PROVIDER_API_KEY") || dbSettings?.airtime_provider_api_key || apiKey;
        
        const mask = (key: string) => key ? `${key.slice(0, 8)}...${key.slice(-4)}` : "not set";

        if (!apiKey || !baseUrl) {
          return new Response(JSON.stringify({ 
            error: "Provider not configured",
            diagnostics: {
              DATA_PROVIDER_API_KEY: mask((Deno as any).env.get("DATA_PROVIDER_API_KEY") || ""),
              PRIMARY_DATA_PROVIDER_API_KEY: mask((Deno as any).env.get("PRIMARY_DATA_PROVIDER_API_KEY") || ""),
              baseUrl: baseUrl || "not set"
            }
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const balanceUrls = [
          `${baseUrl}/api/balance`,
          `${baseUrl}/balance`,
          `${baseUrl}/api/user/balance`,
          `${baseUrl}/user/balance`,
        ];

        let lastError = "Could not fetch balance";
        for (const url of balanceUrls) {
          try {
            console.log("Checking provider balance at:", url);
            const res = await fetch(url, {
              headers: {
                "X-API-Key": apiKey,
                "Authorization": `Bearer ${apiKey}`,
                "Accept": "application/json",
              }
            });
            const text = await res.text();
            if (res.ok) {
              try {
                const data = JSON.parse(text);
                const balance = data.balance ?? data.data?.balance ?? data.wallet_balance;
                if (balance !== undefined) {
                  return new Response(JSON.stringify({ 
                    success: true, 
                    balance: Number(balance),
                    diagnostics: {
                      DATA_PROVIDER_API_KEY: mask((Deno as any).env.get("DATA_PROVIDER_API_KEY") || ""),
                      PRIMARY_DATA_PROVIDER_API_KEY: mask((Deno as any).env.get("PRIMARY_DATA_PROVIDER_API_KEY") || ""),
                      AIRTIME_PROVIDER_API_KEY: mask((Deno as any).env.get("AIRTIME_PROVIDER_API_KEY") || ""),
                      baseUrl: baseUrl,
                      activeKey: mask(apiKey),
                      activeAirtimeKey: mask(airtimeKey)
                    }
                  }), {
                    status: 200,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                  });
                }
              } catch { /* ignore parse error */ }
            }
            lastError = `Provider returned ${res.status}: ${text.slice(0, 100)}`;
          } catch (e) {
            lastError = e instanceof Error ? e.message : "Network error";
          }
        }

        return new Response(JSON.stringify({ error: lastError }), {
          status: 400,
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

      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), {
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
