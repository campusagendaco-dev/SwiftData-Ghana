import { serve } from "https://raw.githubusercontent.com/denoland/deno_std/0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { dispatchOrderWithFailover } from "../_shared/provider_router.ts";
import { isOrderPausedFromApi } from "../_shared/providers.ts";
import { log } from "../_shared/logger.ts";

declare const Deno: any;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing environment credentials" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  // Verify Admin authorization
  const authResult = await verifyAdmin(req, supabaseAdmin);
  if (!authResult.success) {
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: authResult.status || 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    let body: any = {};
    if (req.method === "POST") {
      body = await req.json().catch(() => ({}));
    }

    const excludedTypes = "(wallet_topup,store_wallet_topup,agent_activation,sub_agent_activation,vendor_activation,free_data_claim)";
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // ── COUNT ONLY MODE ──────────────────────────────────────────────────────────
    if (req.method === "GET" || body.count_only === true) {
      let countQuery = supabaseAdmin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .not("package_size", "is", null)
        .not("order_type", "in", excludedTypes)
        .or("status.in.(paid,processing,pending),paystack_verified_amount.gt.0,payment_method.in.(wallet,credit)")
        .or("provider_id.is.null,provider_order_id.is.null,provider_order_id.eq.failed_api_call,provider_order_id.eq.timeout,provider_order_id.eq.manual_fulfillment_mode,provider_order_id.eq.duplicate_cooldown,provider_order_id.eq.refunded")
        .or("retry_count.is.null,retry_count.lt.5")
        .gte("created_at", cutoffDate);

      if (body.network) {
        countQuery = countQuery.eq("network", body.network);
      }

      const { count: verifiedCount, error: countErr } = await countQuery;

      if (countErr) throw countErr;

      return new Response(JSON.stringify({ success: true, count: verifiedCount || 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── EXECUTE BATCH RETRY ─────────────────────────────────────────────────────
    const { order_ids, limit = 25, days = 30, network } = body;
    let candidateOrders: any[] = [];
    const effectiveCutoff = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : cutoffDate;

    if (Array.isArray(order_ids) && order_ids.length > 0) {
      console.log(`[admin-retry-autorouter] Retrying ${order_ids.length} explicitly requested order IDs...`);
      const { data: explicitOrders, error: fetchErr } = await supabaseAdmin
        .from("orders")
        .select("*")
        .in("id", order_ids);

      if (fetchErr) throw fetchErr;
      candidateOrders = explicitOrders || [];
    } else {
      console.log(`[admin-retry-autorouter] Fetching up to ${limit} verified orders in Auto-Router queue with no provider...`);
      let unroutedQuery = supabaseAdmin
        .from("orders")
        .select("*")
        .not("package_size", "is", null)
        .not("order_type", "in", excludedTypes)
        .or("status.in.(paid,processing,pending),paystack_verified_amount.gt.0,payment_method.in.(wallet,credit)")
        .or("provider_id.is.null,provider_order_id.is.null,provider_order_id.eq.failed_api_call,provider_order_id.eq.timeout,provider_order_id.eq.manual_fulfillment_mode,provider_order_id.eq.duplicate_cooldown,provider_order_id.eq.refunded")
        .or("retry_count.is.null,retry_count.lt.5")
        .gte("created_at", effectiveCutoff)
        .order("retry_count", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: false })
        .limit(limit);

      if (network) {
        unroutedQuery = unroutedQuery.eq("network", network);
      }

      const { data: unroutedOrders, error: fetchErr } = await unroutedQuery;

      if (fetchErr) throw fetchErr;
      candidateOrders = unroutedOrders || [];
    }

    // Strictly ensure only verified telecom orders are processed
    const isExplicit = Array.isArray(order_ids) && order_ids.length > 0;
    const resumeApi = body?.resume_api === true;
    const eligibleOrders = candidateOrders.filter((o: any) => {
      // Never auto-route orders paused by admin unless resume_api: true is explicitly requested
      if (!resumeApi && isOrderPausedFromApi(o)) {
        return false;
      }

      const isPaid = o.payment_method === "wallet" || 
                     o.payment_method === "credit" || 
                     Number(o.paystack_verified_amount || 0) > 0 || 
                     o.status === "paid" || 
                     o.status === "processing" ||
                     o.status === "pending";
      const isNonTelecom = ["wallet_topup", "store_wallet_topup", "agent_activation", "sub_agent_activation", "vendor_activation", "free_data_claim"].includes(String(o.order_type || "").toLowerCase());
      if (!isPaid || isNonTelecom) return false;

      // Duplicate Order Cooldown Check: If order is in duplicate cooldown, verify 60 minutes have passed (unless explicitly triggered by admin)
      if (!isExplicit) {
        const isDuplicateCooldown = 
          o.provider_order_id === "duplicate_cooldown" || 
          o.metadata?.duplicate_delayed === true ||
          /duplicate|identical/i.test(String(o.failure_reason || ""));
        if (isDuplicateCooldown) {
          const delayedUntilTime = o.metadata?.delayed_until ? new Date(o.metadata.delayed_until).getTime() : 0;
          const lastActionTime = new Date(o.last_retry_at || o.updated_at || o.created_at).getTime();
          const sixtyMinTime = lastActionTime + 60 * 60 * 1000;
          const effectiveReadyTime = delayedUntilTime > 0 ? delayedUntilTime : sixtyMinTime;
          if (Date.now() < effectiveReadyTime) {
            return false;
          }
        }
      }
      return true;
    });

    if (eligibleOrders.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No verified orders in Auto-Router queue found to retry.",
        summary: { total: 0, fulfilled: 0, processing: 0, failed: 0 },
        results: [],
        remaining_count: 0
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log(`[admin-retry-autorouter] Found ${eligibleOrders.length} verified unrouted orders. Dispatching through 3-tier cascade (DataHub -> Spendless -> SKPlug)...`);

    const summary = {
      total: eligibleOrders.length,
      fulfilled: 0,
      processing: 0,
      failed: 0,
    };
    const results: any[] = [];

    for (const order of eligibleOrders) {
      const currentRetry = Number(order.retry_count || 0);
      const cleanedMeta = { ...(order.metadata || {}) };
      if (resumeApi) {
        delete cleanedMeta.api_paused;
        delete cleanedMeta.paused_at;
        delete cleanedMeta.paused_by;
        cleanedMeta.resumed_at = new Date().toISOString();
        order.metadata = cleanedMeta;
        order.provider_order_id = null;
      }

      // Claim the order atomically
      const { data: claimed, error: claimErr } = await supabaseAdmin
        .from("orders")
        .update({
          status: "processing",
          retry_count: currentRetry + 1,
          last_retry_at: new Date().toISOString(),
          // Clear fake provider order IDs so router doesn't lock to a failed provider
          provider_order_id: null,
          ...(resumeApi ? { metadata: cleanedMeta, failure_reason: null } : {}),
        })
        .eq("id", order.id)
        .select("id")
        .maybeSingle();

      if (claimErr || !claimed) {
        console.log(`[admin-retry-autorouter] Order ${order.id} was already claimed or updated by another worker. Skipping.`);
        continue;
      }

      console.log(`[admin-retry-autorouter] Dispatching order ${order.id} (${order.network} ${order.package_size} for ${order.customer_phone})...`);

      // Dispatch order through full 3-tier cascade
      const dispatch = await dispatchOrderWithFailover(supabaseAdmin, {
        ...order,
        provider_order_id: null,
        status: "processing"
      });

      if (dispatch.ok || dispatch.status === "processing" || dispatch.provider_order_id === "duplicate_cooldown") {
        const targetStatus = dispatch.status === "fulfilled" ? "fulfilled" : "processing";
        const patch: any = {
          status: targetStatus,
          provider_id: dispatch.provider_id || null,
          provider_order_id: dispatch.provider_order_id || null,
          updated_at: new Date().toISOString()
        };
        if (targetStatus === "fulfilled") {
          patch.failure_reason = null;
        } else if (dispatch.reason) {
          patch.failure_reason = dispatch.reason;
        }
        await supabaseAdmin.from("orders").update(patch).eq("id", order.id);

        if (targetStatus === "fulfilled") {
          summary.fulfilled++;
          await Promise.resolve(supabaseAdmin.rpc("credit_order_profits", { p_order_id: order.id })).catch(() => {});
        } else {
          summary.processing++;
        }

        results.push({
          id: order.id,
          status: targetStatus,
          provider_id: dispatch.provider_id,
          provider_order_id: dispatch.provider_order_id,
          network: order.network,
          package_size: order.package_size,
        });

        log(supabaseAdmin, {
          level: "info",
          source: "admin-retry-autorouter",
          event: "order.autorouted",
          message: `Order ${order.id} routed to provider (${targetStatus}): ${dispatch.provider_order_id}`,
          order_id: order.id,
          provider_id: dispatch.provider_id,
          data: { status: targetStatus, provider_order_id: dispatch.provider_order_id }
        });
      } else {
        summary.failed++;
        const failReason = dispatch.reason || "All active providers rejected this order";
        await supabaseAdmin.from("orders").update({
          status: "processing",
          provider_order_id: "failed_api_call",
          failure_reason: failReason,
          updated_at: new Date().toISOString()
        }).eq("id", order.id);

        results.push({
          id: order.id,
          status: "processing",
          reason: failReason,
          network: order.network,
          package_size: order.package_size,
        });

        log(supabaseAdmin, {
          level: "warn",
          source: "admin-retry-autorouter",
          event: "order.autoroute_failed",
          message: `Order ${order.id} failed auto-routing: ${failReason}`,
          order_id: order.id,
          data: { reason: failReason }
        });
      }
    }

    const { count: remainingCount } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .neq("network", "MTN Mash Up")
      .not("package_size", "is", null)
      .not("order_type", "in", excludedTypes)
      .or("status.in.(paid,processing),paystack_verified_amount.gt.0,payment_method.in.(wallet,credit)")
      .or("provider_id.is.null,provider_order_id.is.null,provider_order_id.eq.failed_api_call,provider_order_id.eq.timeout,provider_order_id.eq.manual_fulfillment_mode")
      .gte("created_at", effectiveCutoff);

    return new Response(JSON.stringify({
      success: true,
      message: `Batch auto-route finished. Processed ${summary.total} orders (Fulfilled: ${summary.fulfilled}, Processing: ${summary.processing}, Failed: ${summary.failed}).`,
      summary,
      results,
      remaining_count: remainingCount || 0
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("[admin-retry-autorouter] Error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
