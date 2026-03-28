import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DATA_PROVIDER_BASE_URL = "https://backend.mycledanet.com";

function mapNetworkToApi(network: string): string {
  const map: Record<string, string> = {
    "MTN": "MTN",
    "Telecel": "TELECEL",
    "AirtelTigo": "AIRTELTIGO_ISHARE",
  };
  return map[network] || network;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const DATA_PROVIDER_API_KEY = Deno.env.get("DATA_PROVIDER_API_KEY")?.trim();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DATA_PROVIDER_API_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { network, package_size, customer_phone, amount } = await req.json();

    if (!network || !package_size || !customer_phone || !amount) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get or create wallet
    let { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id, balance")
      .eq("agent_id", user.id)
      .maybeSingle();

    if (!wallet) {
      const { data: newWallet } = await supabaseAdmin
        .from("wallets")
        .insert({ agent_id: user.id, balance: 0 })
        .select()
        .single();
      wallet = newWallet;
    }

    if (!wallet || wallet.balance < amount) {
      return new Response(JSON.stringify({ error: `Insufficient wallet balance. Available: GH₵${(wallet?.balance || 0).toFixed(2)}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduct from wallet
    const newBalance = parseFloat((wallet.balance - amount).toFixed(2));
    await supabaseAdmin.from("wallets").update({ balance: newBalance }).eq("agent_id", user.id);

    // Create order
    const orderId = crypto.randomUUID();
    await supabaseAdmin.from("orders").insert({
      id: orderId,
      agent_id: user.id,
      order_type: "data",
      network,
      package_size,
      customer_phone,
      amount,
      profit: 0,
      status: "paid",
    });

    // Fulfill via API
    let size = 0;
    const gbMatch = package_size.match(/^(\d+(?:\.\d+)?)\s*GB$/i);
    const mbMatch = package_size.match(/^(\d+(?:\.\d+)?)\s*MB$/i);
    if (gbMatch) size = parseFloat(gbMatch[1]);
    else if (mbMatch) size = parseFloat(mbMatch[1]) / 1000;

    const apiNetwork = mapNetworkToApi(network);
    console.log("Wallet buy data:", { network, apiNetwork, package_size, size, customer_phone });

    const fulfillRes = await fetch(`${DATA_PROVIDER_BASE_URL}/api/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": DATA_PROVIDER_API_KEY },
      body: JSON.stringify({ phone: customer_phone, size, network: apiNetwork }),
    });

    const fulfillText = await fulfillRes.text();
    console.log("Fulfillment response:", fulfillRes.status, fulfillText);

    if (fulfillRes.ok) {
      await supabaseAdmin.from("orders").update({ status: "fulfilled" }).eq("id", orderId);
      return new Response(JSON.stringify({ success: true, order_id: orderId, status: "fulfilled" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      let reason = "Data delivery failed";
      try { reason = JSON.parse(fulfillText)?.message || reason; } catch { /* keep fallback reason */ }
      await supabaseAdmin.from("orders").update({ status: "fulfillment_failed", failure_reason: reason }).eq("id", orderId);
      return new Response(JSON.stringify({ success: true, order_id: orderId, status: "fulfillment_failed", failure_reason: reason }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    console.error("Wallet buy data error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
