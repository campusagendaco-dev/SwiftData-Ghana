import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders } from "../_shared/cors.ts";

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
  | "confirm_withdrawal";




serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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
        const { data: users, error: userError } = await supabaseAdmin
          .from("profiles")
          .select("user_id, full_name, email, api_key, api_access_enabled, api_rate_limit, api_allowed_actions, api_ip_whitelist, api_webhook_url, api_requests_today, api_requests_total, api_last_used_at, agent_approved, sub_agent_approved, api_custom_prices")
          .not("api_key", "is", null)
          .order("full_name");

        if (userError) {
          return new Response(JSON.stringify({ error: userError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const userIds = (users || []).map(u => u.user_id);
        let statsMap: Record<string, any> = {};
        
        if (userIds.length > 0) {
          const { data: stats } = await supabaseAdmin
            .from("user_sales_stats")
            .select("user_id, total_sales_volume")
            .in("user_id", userIds);
          
          if (stats) {
            statsMap = Object.fromEntries(stats.map(s => [s.user_id, s.total_sales_volume]));
          }
        }

        const enrichedUsers = (users || []).map(u => ({
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
          .update({ api_key: null })
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
        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({ agent_approved: true })
          .eq("user_id", user_id);

        if (updateError) throw updateError;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "revoke_agent": {
        if (!isValidUuid(user_id)) throw new Error("Invalid or missing user_id");
        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({ agent_approved: false })
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
          .single();

        if (!profile?.parent_agent_id) {
          return new Response(JSON.stringify({ error: "User is not a sub-agent or missing parent" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: parent } = await supabaseAdmin
          .from("profiles")
          .select("sub_agent_prices")
          .eq("user_id", profile.parent_agent_id)
          .single();

        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({
            is_agent: true,
            agent_approved: true,
            onboarding_complete: true,
            sub_agent_approved: true,
            agent_prices: parent?.sub_agent_prices || {},
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

        const { data: wallet } = await supabaseAdmin
          .from("wallets")
          .select("balance")
          .eq("agent_id", user_id)
          .maybeSingle();

        const currentBalance = wallet?.balance || 0;
        const newBalance = parseFloat((currentBalance + amount).toFixed(2));

        if (!wallet) {
          const { error: insertError } = await supabaseAdmin
            .from("wallets")
            .insert({ agent_id: user_id, balance: amount });
          if (insertError) throw insertError;
        } else {
          const { error: updateError } = await supabaseAdmin
            .from("wallets")
            .update({ balance: newBalance })
            .eq("agent_id", user_id);
          if (updateError) throw updateError;
        }

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

        // Known-good columns — any field not in this list is silently dropped so
        // a missing column never causes a 500 (e.g. before a migration is applied).
        const ALLOWED_COLUMNS = new Set([
          "auto_api_switch", "preferred_provider", "backup_provider",
          "holiday_mode_enabled", "holiday_message", "disable_ordering",
          "dark_mode_enabled", "customer_service_number", "support_channel_link",
          "sub_agent_base_fee", "txtconnect_api_key", "txtconnect_sender_id",
          "paystack_secret_key", "hubtel_client_id", "hubtel_client_secret",
          "mtn_markup_percentage", "telecel_markup_percentage", "at_markup_percentage",
          "auto_pending_sms_enabled", "auto_pending_sms_message",
          "store_visitor_popup_enabled",
        ]);

        const safeSettings: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(settings)) {
          if (ALLOWED_COLUMNS.has(k)) safeSettings[k] = v;
        }

        const { error: updateError } = await supabaseAdmin
          .from("system_settings")
          .upsert({ id: 1, ...safeSettings, updated_at: new Date().toISOString(), updated_by: actor.id });

        if (updateError) {
          // If a column doesn't exist yet (migration pending), retry without it
          if (updateError.message?.includes("column") && updateError.message?.includes("does not exist")) {
            const col = updateError.message.match(/column "?(\w+)"?/)?.[1];
            if (col) delete safeSettings[col];
            const { error: retryError } = await supabaseAdmin
              .from("system_settings")
              .upsert({ id: 1, ...safeSettings, updated_at: new Date().toISOString(), updated_by: actor.id });
            if (retryError) throw retryError;
          } else {
            throw updateError;
          }
        }

        return new Response(JSON.stringify({ success: true }), {
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

        const { error: updateError } = await supabaseAdmin
          .from("withdrawals")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", withdrawal_id);

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

        const appOrigin = Deno.env.get("SITE_URL") || req.headers.get("origin") || "";
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
