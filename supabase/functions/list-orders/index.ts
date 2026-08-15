import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAdmin } from "../_shared/auth.ts";

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

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let user = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    // Non-fatal if anon key or invalid token is passed; just fallback to guest
    const { data } = await supabaseAdmin.auth.getUser(token);
    user = data?.user || null;
  }
  
  const isGuest = !user;

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

    const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const rateLimitKey = isGuest ? `list_orders_ip:${clientIp}` : `list_orders_user:${user.id}`;
    const rateLimit = isGuest ? 60 : 180; // guests get 60/min, users get 180/min

    // SECURITY: Rate limit (prevents scraping multiple phone numbers)
    const { data: withinLimit } = await supabaseAdmin.rpc("check_generic_rate_limit", {
      p_key: rateLimitKey,
      p_rate_limit: rateLimit
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
    let isAdmin = false;
    if (user) {
      const authResult = await verifyAdmin(req, supabaseAdmin);
      isAdmin = authResult.success;
    }

    let query = supabaseAdmin
      .from("orders")
      .select("id, customer_phone, network, package_size, amount, status, created_at, order_type")
      .in("customer_phone", searchPhones)
      .order("created_at", { ascending: false });

    if (isGuest) {
      // Guests can only see recent orders (last 7 days) and max 5 results to prevent data scraping
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      query = query.gte("created_at", sevenDaysAgo.toISOString()).limit(5);
    } else if (!isAdmin) {
      // Non-admin agents can see all their own orders
      query = query.eq("agent_id", user.id).limit(20);
    } else {
      query = query.limit(20);
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
