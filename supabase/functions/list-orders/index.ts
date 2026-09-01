import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAdmin } from "../_shared/auth.ts";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
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

    if (!phone && isGuest) {
      return new Response(JSON.stringify({ orders: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawInput = (phone || "").trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawInput);
    const isReference = isUuid || rawInput.length >= 15 || rawInput.includes("-") || rawInput.toLowerCase().startsWith("trx") || rawInput.toLowerCase().startsWith("sdg");

    let query = supabaseAdmin
      .from("orders")
      .select("id, customer_phone, network, package_size, amount, status, created_at, order_type, metadata")
      .order("created_at", { ascending: false });

    if (!rawInput && user) {
      // Logged-in reseller/agent with no filter: fetch their own recent orders
      query = query.eq("agent_id", user.id);
    } else if (isReference) {
      if (isUuid) {
        query = query.eq("id", rawInput);
      } else {
        query = query.filter("metadata->>client_reference", "eq", rawInput);
      }
    } else {
      // Normalize all Ghana phone number format permutations
      const digits = rawInput.replace(/\D+/g, "");
      const searchPhones = [digits, `+${digits}`];
      
      if (digits.startsWith("0") && digits.length === 10) {
        searchPhones.push("233" + digits.slice(1));
        searchPhones.push("+233" + digits.slice(1));
        searchPhones.push(digits.slice(1));
      } else if (digits.startsWith("233") && digits.length === 12) {
        searchPhones.push("0" + digits.slice(3));
        searchPhones.push(digits.slice(3));
        searchPhones.push("+" + digits);
      } else if (digits.length === 9) {
        searchPhones.push("0" + digits);
        searchPhones.push("233" + digits);
        searchPhones.push("+233" + digits);
      }

      query = query.in("customer_phone", searchPhones);
    }

    // Allow fetching up to 30 days of recent orders (max 50 items)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    query = query.gte("created_at", thirtyDaysAgo.toISOString()).limit(50);

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
