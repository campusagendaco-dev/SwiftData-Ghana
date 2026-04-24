import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type AdminUserAction = "get_api_users" | "send_reset_link" | "reset_password" | "delete_user";

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

    // ── get_api_users: returns all profiles that have an API key ──────────────
    if (action === "get_api_users") {
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

      // Fetch stats separately to avoid join issues with views
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
        // Match the expected stats[0] structure if needed, or just use total_sales_volume
        stats: [{ total_sales_volume: statsMap[u.user_id] || 0 }]
      }));

      return new Response(JSON.stringify({ users: enrichedUsers }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // All other actions require a valid user_id
    if (!user_id) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(user_id)) {
      return new Response(JSON.stringify({ error: "Invalid user ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["send_reset_link", "reset_password", "delete_user"].includes(action as AdminUserAction)) {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "send_reset_link") {
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

    if (action === "reset_password") {
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

    // delete_user
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
