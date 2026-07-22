import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

serve(async () => {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch Scheduled SMS templates from system settings
    const { data: settings } = await supabaseAdmin
      .from("v_system_settings_with_secrets").select("scheduled_success_sms_message, scheduled_failed_sms_message")
      .eq("id", 1)
      .maybeSingle();

    const successTemplate = settings?.scheduled_success_sms_message || 'Your scheduled {package} bundle to {phone} has been successfully renewed. Thank you for using SwiftData!';
    const failedTemplate = settings?.scheduled_failed_sms_message || 'Failed to renew your scheduled {package} bundle to {phone} due to insufficient wallet balance. Please top up to resume.';

    // 1. Fetch all active subscriptions that are due to run today
    // We assume scheduled_orders has: id, agent_id, customer_phone, network, package_size, frequency (daily/weekly/monthly), next_run_at, status (active/paused)
    const { data: subs, error: subsError } = await supabaseAdmin
      .from("scheduled_orders")
      .select("*")
      .eq("status", "active")
      .lte("next_run_at", new Date().toISOString());

    if (subsError) throw subsError;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ message: "No subscriptions due" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Fetch pricing settings
    const { data: allPkgs } = await supabaseAdmin.from("global_package_settings").select("*");

    let processedCount = 0;
    const failures = [];

    for (const sub of subs) {
      try {
        const pkg = allPkgs?.find(p => p.network === sub.network && p.package_size.replace(/\s+/g,"").toUpperCase() === sub.package_size.replace(/\s+/g,"").toUpperCase());
        if (!pkg) throw new Error("Package not found");

        // Calculate next run date based on frequency
        const nextRun = new Date(sub.next_run_at);
        if (sub.frequency === "daily") nextRun.setDate(nextRun.getDate() + 1);
        else if (sub.frequency === "weekly") nextRun.setDate(nextRun.getDate() + 7);
        else if (sub.frequency === "monthly") nextRun.setMonth(nextRun.getMonth() + 1);
        
        while (nextRun <= new Date()) {
          if (sub.frequency === "daily") nextRun.setDate(nextRun.getDate() + 1);
          else if (sub.frequency === "weekly") nextRun.setDate(nextRun.getDate() + 7);
          else if (sub.frequency === "monthly") nextRun.setMonth(nextRun.getMonth() + 1);
        }

        // Fetch Agent profile for pricing and notifications
        const { data: profile } = await supabaseAdmin.from("profiles").select("is_sub_agent, parent_agent_id, phone").eq("user_id", sub.agent_id).maybeSingle();
        if (!profile) throw new Error("Agent profile not found");

        const requestedAmount = profile.is_sub_agent ? Number(pkg.sub_agent_price || pkg.agent_price) : Number(pkg.agent_price || pkg.public_price);
        const adminBase = Number(pkg.agent_price);
        if (!adminBase || adminBase <= 0 || !requestedAmount || requestedAmount <= 0) {
          throw new Error("No valid price configured for this package");
        }
        const resolvedCostPrice = Number(pkg.cost_price || 0) > 0 ? Number(pkg.cost_price) : adminBase;

        let parentAgentId = null;
        let parentProfit = 0;
        let agentProfit = 0;

        if (profile.is_sub_agent && profile.parent_agent_id && adminBase > 0) {
          parentAgentId = profile.parent_agent_id;
          parentProfit = Math.max(0, requestedAmount - adminBase);
        } else if (resolvedCostPrice > 0) {
          agentProfit = Math.max(0, requestedAmount - resolvedCostPrice);
        }

        // Debit Wallet
        const { data: debitResult, error: debitError } = await supabaseAdmin.rpc("debit_wallet", {
          p_agent_id: sub.agent_id,
          p_amount: requestedAmount
        });

        if (debitError || !debitResult?.success) {
           // Send Failure SMS to the Agent if they have a phone number on profile
           if (profile.phone) {
             const failedMsg = failedTemplate
               .replace("{package}", `${sub.package_size} (${sub.network})`)
               .replace("{phone}", sub.customer_phone);
               
             await supabaseAdmin.from("sms_logs").insert({
               recipient: profile.phone,
               body: failedMsg,
               status: 'pending'
             });
           }
           // Skip if insufficient balance, don't update next_run_at so it tries again tomorrow (or we can just pause it)
           throw new Error("Insufficient wallet balance for auto-renewal");
        }

        // Insert Order
        const orderId = crypto.randomUUID();
        const { error: insertError } = await supabaseAdmin.from("orders").insert({
          id: orderId,
          agent_id: sub.agent_id,
          customer_phone: sub.customer_phone,
          network: sub.network,
          package_size: sub.package_size,
          amount: requestedAmount,
          payment_method: "wallet",
          cost_price: resolvedCostPrice > 0 ? resolvedCostPrice : undefined,
          profit: agentProfit,
          parent_agent_id: parentAgentId,
          parent_profit: parentProfit,
          status: "paid",
          source: "subscription"
        });

        if (insertError) {
          // Refund
          await supabaseAdmin.rpc("credit_wallet", { p_agent_id: sub.agent_id, p_amount: requestedAmount });
          throw new Error("Failed to insert order");
        }

        // Update the next run time
        await supabaseAdmin.from("scheduled_orders").update({ next_run_at: nextRun.toISOString() }).eq("id", sub.id);
        processedCount++;

        // Send Success SMS to the Agent if they have a phone number on profile
        if (profile.phone) {
          const successMsg = successTemplate
            .replace("{package}", `${sub.package_size} (${sub.network})`)
            .replace("{phone}", sub.customer_phone);
            
          await supabaseAdmin.from("sms_logs").insert({
            recipient: profile.phone,
            body: successMsg,
            status: 'pending'
          });
        }

      } catch (err: any) {
        failures.push({ id: sub.id, error: err.message });
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      processed: processedCount, 
      failures: failures.length > 0 ? failures : undefined 
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
