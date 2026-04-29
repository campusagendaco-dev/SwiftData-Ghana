import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

async function resolveLocation(ip: string): Promise<string | null> {
  // Skip private/local IPs
  if (!ip || ip === "::1" || ip.startsWith("127.") || ip.startsWith("192.168.") || ip.startsWith("10.")) {
    return "Local Network";
  }
  try {
    // Adding 'district' for more specific town/neighborhood names
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city,district,regionName`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "success") return null;
    
    // Format: District (if different from city), City, Region, Country
    const parts = [
      data.district && data.district !== data.city ? data.district : null,
      data.city,
      data.regionName,
      data.country
    ].filter(Boolean);
    
    return parts.length > 0 ? parts.join(", ") : null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Extract real client IP — Cloudflare > nginx > forwarded chain
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    null;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // Run auth check and geolocation lookup in parallel
  const [userResult, location] = await Promise.all([
    supabaseUser.auth.getUser(),
    ip ? resolveLocation(ip) : Promise.resolve(null),
  ]);

  const { data: { user }, error } = userResult;
  if (error || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  await supabaseAdmin.rpc("log_user_activity", {
    p_user_id: user.id,
    p_ip: ip,
    p_location: location,
  });

  return new Response(JSON.stringify({ ok: true, location }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
