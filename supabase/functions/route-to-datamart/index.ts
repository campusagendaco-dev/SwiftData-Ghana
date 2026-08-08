import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";

function parseCapacity(packageSize: string | null | undefined): number {
  if (!packageSize) return 0;
  const cleaned = packageSize.replace(/\s+/g, "").toUpperCase();
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (cleaned.includes("MB") && !cleaned.includes("GB")) {
    return num / 1024;
  }
  return num;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Security check: require admin rights
    const authResult = await verifyAdmin(req, supabaseAdmin);
    if (!authResult.success) {
      return new Response(JSON.stringify({ error: authResult.error }), {
        status: authResult.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { order_ids, target } = await req.json().catch(() => ({ order_ids: null, target: "all_beneficiary" }));

    // 1. Fetch active Datamart provider credentials
    const { data: dmProvider, error: provErr } = await supabaseAdmin
      .from("providers")
      .select("*")
      .eq("handler_type", "datamart")
      .maybeSingle();

    if (provErr || !dmProvider) {
      return new Response(JSON.stringify({
        success: false,
        error: "Datamart provider configuration not found or disabled."
      }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const apiKey = dmProvider.api_key || Deno.env.get("DATAMART_API_KEY") || "";
    if (!apiKey) {
      return new Response(JSON.stringify({
        success: false,
        error: "Datamart API Key is missing in System Settings or Environment Variables."
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. Query target orders to route
    let orders: any[] = [];
    if (Array.isArray(order_ids) && order_ids.length > 0) {
      const { data: fetchOrders } = await supabaseAdmin
        .from("orders")
        .select("*")
        .in("id", order_ids);
      orders = fetchOrders || [];
    } else {
      // Default: fetch non-beneficiary/failed/processing orders created in the last 14 days
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data: fetchOrders } = await supabaseAdmin
        .from("orders")
        .select("*")
        .gte("created_at", cutoff)
        .or("failure_reason.ilike.%beneficiary%,failure_reason.ilike.%not added%,failure_reason.ilike.%payee%,failure_reason.ilike.%limit%,status.eq.fulfillment_failed,provider_order_id.is.null")
        .order("created_at", { ascending: false });
      orders = fetchOrders || [];
    }

    if (orders.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No candidate beneficiary orders found to route.",
        routedCount: 0,
        total: 0
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let routedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const results: any[] = [];

    // 3. Process orders to Datamart API
    for (const ord of orders) {
      try {
        const phone = ord.customer_phone;
        if (!phone) {
          skippedCount++;
          continue;
        }

        const netStr = String(ord.network || "MTN").toUpperCase();
        let dmNetwork = "YELLO";
        if (netStr.includes("TELECEL") || netStr.includes("VODA")) dmNetwork = "TELECEL";
        if (netStr.includes("AT") || netStr.includes("AIRTEL")) dmNetwork = "AT_PREMIUM";

        const capNum = parseCapacity(ord.package_size);
        const planId = `MTN_${capNum > 0 ? capNum : 1}`;

        const payload = {
          phoneNumber: phone,
          recipient: phone,
          network: dmNetwork,
          planId: planId,
          plan: planId,
          capacity: String(capNum > 0 ? capNum : 1),
          orderReference: ord.id,
          reference: ord.id,
          gateway: "wallet",
          bypass_beneficiary: true
        };

        const res = await fetch("https://api.datamartgh.shop/api/developer/purchase", {
          method: "POST",
          headers: {
            "X-API-Key": apiKey,
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        const resData = await res.json().catch(() => null);

        if (res.ok && resData?.status === "success" && resData?.data?.purchaseId) {
          const purchaseId = resData.data.purchaseId;

          // Update database order record
          await supabaseAdmin.from("orders").update({
            provider_id: dmProvider.id,
            provider_order_id: purchaseId,
            status: "processing",
            failure_reason: null,
            auto_refunded: false,
            updated_at: new Date().toISOString()
          }).eq("id", ord.id);

          routedCount++;
          results.push({ id: ord.id, status: "success", purchaseId });
        } else {
          failedCount++;
          const reason = resData?.message || resData?.error || `HTTP ${res.status}`;
          results.push({ id: ord.id, status: "failed", reason });
        }
      } catch (e: any) {
        failedCount++;
        results.push({ id: ord.id, status: "error", error: e.message });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Successfully routed ${routedCount} beneficiary orders to Datamart API!`,
      routedCount,
      failedCount,
      skippedCount,
      total: orders.length,
      results
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[route-to-datamart] Exception:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
