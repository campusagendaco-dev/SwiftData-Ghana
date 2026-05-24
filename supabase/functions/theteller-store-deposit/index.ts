import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface RequestBody {
  action: "initiate-deposit" | "check-status";
  amount?: number;
  phone?: string;
  network?: string;
  agent_id?: string;
  transaction_id?: string;
}

const formatAmount = (amount: number): string => {
  const pesewas = Math.round(amount * 100);
  return pesewas.toString().padStart(12, "0");
};

const formatPhone = (phone: string): string => {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = "233" + cleaned.substring(1);
  return cleaned;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const apiUser = Deno.env.get("THETELLER_API_USER");
  const apiKey = Deno.env.get("THETELLER_API_KEY");
  const merchantId = Deno.env.get("THETELLER_MERCHANT_ID");
  
  if (!apiUser || !apiKey || !merchantId) {
    return new Response(JSON.stringify({ error: "API credentials not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const jwt = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body: RequestBody = await req.json();
    const { action, amount, phone, network, agent_id, transaction_id } = body;

    const auth = btoa(`${apiUser}:${apiKey}`);
    const headers = {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "Merchant-Id": merchantId,
    };

    const isTestMode = Deno.env.get("THETELLER_MODE") === "test";
    
    if (action === "initiate-deposit") {
      if (!amount || !phone || !network || !agent_id) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (amount < 1) {
        return new Response(JSON.stringify({ error: "Minimum deposit is GHS 1.00" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const orderId = crypto.randomUUID();
      const tellerRef = orderId.replace(/-/g, "").substring(0, 12);
      const finalNetwork = network === "VOD" ? "VDF" : (network === "TGO" ? "ATL" : network);

      const endpoint = isTestMode ? "https://test.theteller.net/v1.1/transaction/process" : "https://prod.theteller.net/v1.1/transaction/process";
      
      // Add 3% processing fee
      const totalCharge = amount * 1.03;
      
      const payload = {
        merchant_id: merchantId,
        transaction_id: tellerRef,
        amount: formatAmount(totalCharge), // Charge amount + 3% fee
        processing_code: "000200",
        "r-switch": finalNetwork,
        desc: "Store Wallet Deposit",
        subscriber_number: formatPhone(phone),
      };

      const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
      const result = await resp.json();

      const isSuccess = result.code === "000" || result.status === "approved" || result.status === "successful";
      const isPending = result.code === "100" || result.status === "pending";

      // Create pending order
      await supabase.from("orders").insert({
        id: orderId,
        agent_id: agent_id,
        order_type: "store_wallet_topup",
        amount: amount,
        customer_phone: phone,
        status: isSuccess ? "fulfilled" : (isPending ? "pending" : "failed"),
        failure_reason: isSuccess || isPending ? null : (result.reason || result.message || "Failed"),
        metadata: {
          theteller_ref: tellerRef,
          theteller_raw: result,
          customer_id: user.id
        }
      });

      if (isSuccess) {
        await supabase.rpc("fulfill_store_wallet_topup", {
          p_order_id: orderId,
          p_customer_id: user.id,
          p_agent_id: agent_id,
          p_amount: amount
        });
      }

      return new Response(JSON.stringify({ ...result, order_id: orderId }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } else if (action === "check-status") {
      if (!transaction_id) {
        return new Response(JSON.stringify({ error: "Missing transaction_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let orderQuery = supabase.from("orders").select("*");
      if (transaction_id.includes("-") && transaction_id.length === 36) {
        orderQuery = orderQuery.eq("id", transaction_id);
      } else {
        orderQuery = orderQuery.filter("metadata->>theteller_ref", "eq", transaction_id);
      }
      
      const { data: order } = await orderQuery.single();
      
      if (!order) {
        return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (order.status === "fulfilled" || order.status === "failed") {
         return new Response(JSON.stringify({ status: order.status === "fulfilled" ? "successful" : "failed", order }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const tellerRef = order.metadata?.theteller_ref;
      const baseUrl = isTestMode ? "https://test.theteller.net" : "https://prod.theteller.net";
      const endpoint = `${baseUrl}/v1.1/users/transactions/${tellerRef}/status`;

      const resp = await fetch(endpoint, { method: "GET", headers });
      const result = await resp.json();

      const isSuccess = result.code === "000" || result.status === "approved" || result.status === "successful";
      const isFailed = !isSuccess && result.code !== "100" && result.status !== "pending";

      if (isSuccess) {
        await supabase.rpc("fulfill_store_wallet_topup", {
          p_order_id: order.id,
          p_customer_id: order.metadata.customer_id,
          p_agent_id: order.agent_id,
          p_amount: order.amount
        });
        
        await supabase.from("orders").update({
          metadata: { ...order.metadata, theteller_raw: result, fulfilled_at: new Date().toISOString() }
        }).eq("id", order.id);
      } else if (isFailed) {
        await supabase.from("orders").update({
          status: "failed",
          failure_reason: result.reason || result.message || "Transaction failed",
          metadata: { ...order.metadata, theteller_raw: result }
        }).eq("id", order.id);
      }

      return new Response(JSON.stringify({
        status: isSuccess ? "successful" : (isFailed ? "failed" : "pending"),
        reason: result.reason || result.message,
        order_id: order.id
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("Function error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
