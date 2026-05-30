import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

declare const Deno: any;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Require admin JWT
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
  const supabaseUser = createClient((Deno as any).env.get("SUPABASE_URL")!, (Deno as any).env.get("SUPABASE_ANON_KEY")!);
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser(token);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
  const supabaseAdmin = createClient(
    (Deno as any).env.get("SUPABASE_URL")!,
    (Deno as any).env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("user_id", user.id).maybeSingle();
  if (profile?.role !== "admin") {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
  }

  try {
    const { page = 1, limit = 50, auto_fix = true } = await req.json().catch(() => ({}));
    
    // 1. Get DataMart Credentials
    const { data: settings } = await supabaseAdmin
      .from("v_system_settings_with_secrets").select("data_provider_api_key, data_provider_base_url")
      .eq("id", 1)
      .maybeSingle();

    const apiKey = Deno.env.get("DATAMART_API_KEY") || settings?.data_provider_api_key;
    const baseUrl = (Deno.env.get("DATAMART_BASE_URL") || settings?.data_provider_base_url || "").replace(/\/+$/, "");

    if (!apiKey) throw new Error("DataMart API Key not configured");

    // 2. Fetch Transactions from DataMart
    const res = await fetch(`${baseUrl}/transactions?page=${page}&limit=${limit}`, {
      headers: { "X-API-Key": apiKey }
    });

    if (!res.ok) throw new Error(`DataMart API failed with status ${res.status}`);
    const { data } = await res.json();
    const transactions = data?.transactions || [];

    const results = {
      total_checked: transactions.length,
      fixed: 0,
      already_correct: 0,
      not_found: 0,
      details: [] as any[]
    };

    // 3. Sync with Database
    
    // --- 2. FORCE COMPLETE STUCK ORDERS (> 20 mins) ---
    const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const { data: stuckOrders } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("status", "processing")
      .lt("created_at", twentyMinsAgo);

    if (stuckOrders && stuckOrders.length > 0) {
      console.log(`Force completing ${stuckOrders.length} orders older than 20 mins...`);
      for (const order of stuckOrders) {
        await supabaseAdmin.from("orders").update({ 
          status: "fulfilled",
          failure_reason: "Auto-fulfilled (Timeline threshold met)"
        }).eq("id", order.id);
        await supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id });
      }
    }

    for (const tx of transactions) {
      const reference = tx.reference;
      if (!reference) continue;

      const { data: order } = await supabaseAdmin
        .from("orders")
        .select("id, status")
        .eq("id", reference)
        .maybeSingle();

      if (!order) {
        results.not_found++;
        continue;
      }

      const txStatus = tx.status?.toLowerCase();
      const isDelivered = txStatus === "completed" || txStatus === "success" || txStatus === "delivered";
      const isFailed = txStatus === "failed" || txStatus === "refunded" || txStatus === "rejected";

      if (isDelivered && order.status !== "fulfilled") {
        if (auto_fix) {
          await supabaseAdmin.from("orders").update({ 
            status: "fulfilled",
            updated_at: new Date().toISOString()
          }).eq("id", reference);
          
          await supabaseAdmin.rpc("credit_order_profits", { p_order_id: reference });
          results.fixed++;
          results.details.push({ id: reference, from: order.status, to: "fulfilled" });
        }
      } else if (isFailed && order.status !== "fulfillment_failed") {
        if (auto_fix) {
          await supabaseAdmin.from("orders").update({ 
            status: "fulfillment_failed",
            failure_reason: `DataMart reported ${txStatus}`,
            updated_at: new Date().toISOString()
          }).eq("id", reference);
          results.fixed++;
          results.details.push({ id: reference, from: order.status, to: "fulfillment_failed" });
        }
      } else {
        results.already_correct++;
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
