import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // SECURITY: Require valid user authentication to look up order history
  // Unauthenticated phone lookup allows any attacker to enumerate orders for any number
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized: authentication required" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Verify the user session
  const token = authHeader.slice(7).trim();
  const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized: invalid session" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    let phone = "";
    if (req.method === "GET") {
      const url = new URL(req.url);
      phone = url.searchParams.get("phone") || "";
    } else {
      try {
        const body = await req.json();
        phone = body.phone || "";
      } catch (_e) {
        // Fallback if JSON parsing fails
      }
    }

    if (!phone) {
      return new Response(JSON.stringify({ error: "Phone number required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SECURITY: Rate limit per user (prevents scraping multiple phone numbers)
    const { data: withinLimit } = await supabaseAdmin.rpc("check_generic_rate_limit", {
      p_key: `list_orders:${user.id}`,
      p_rate_limit: 20 // 20 lookups per minute per user
    });

    if (withinLimit === false) {
      return new Response(JSON.stringify({ error: "Too many requests. Please wait." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize phone for searching
    const digits = phone.replace(/\D+/g, "");
    const searchPhones = [digits];
    if (digits.startsWith("0") && digits.length === 10) {
      searchPhones.push("233" + digits.slice(1));
    } else if (digits.startsWith("233") && digits.length === 12) {
      searchPhones.push("0" + digits.slice(3));
    }

    // SECURITY: Scope to the authenticated user's orders only
    // Admin users can look up any phone; regular users only their own agent orders
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    const isAdmin = Boolean(roles);

    let query = supabaseAdmin
      .from("orders")
      .select("id, customer_phone, network, package_size, amount, status, created_at, order_type")
      .in("customer_phone", searchPhones)
      .order("created_at", { ascending: false })
      .limit(20);

    // Non-admin users can only see orders they placed
    if (!isAdmin) {
      query = query.eq("agent_id", user.id);
    }

    const { data: orders, error } = await query;
    if (error) throw error;

    return new Response(JSON.stringify({ orders }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
