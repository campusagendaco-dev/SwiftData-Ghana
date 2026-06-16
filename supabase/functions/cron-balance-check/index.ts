import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPaymentSms } from "../_shared/sms.ts";

// Cron: runs every 15 minutes
// Checks all active provider balances, alerts if below threshold, auto-disables if configured

serve(async (_req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: providers, error } = await supabase
    .from("providers")
    .select("*")
    .eq("is_active", true)
    .in("handler_type", ["datamart", "datahub", "spendless", "qhowmenzconsult"]);

  if (error || !providers?.length) {
    console.log("[cron-balance-check] No active providers or error:", error?.message);
    return new Response(JSON.stringify({ checked: 0 }), { status: 200 });
  }

  const results: any[] = [];

  for (const provider of providers) {
    const apiKey = provider.api_key;
    const baseUrl = (provider.base_url || "").replace(/\/+$/, "");
    if (!apiKey || !baseUrl) continue;

    let balance: number | null = null;

    try {
      // Build balance URL based on handler type
      const balanceUrls = provider.handler_type === "datahub" || provider.handler_type === "qhowmenzconsult"
        ? [`${baseUrl}/balance`]
        : [`${baseUrl}/balance`, `${baseUrl}/api/balance`];

      for (const url of balanceUrls) {
        const res = await fetch(url, {
          headers: { "X-API-Key": apiKey, "Accept": "application/json" },
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const data = await res.json();
          const raw = data?.data?.balance ?? data?.data?.rawBalance ?? data?.balance;
          if (raw !== undefined) {
            balance = typeof raw === "string" ? parseFloat(raw.replace(/[^\d.]/g, "")) : Number(raw);
            break;
          }
        }
      }

      if (balance === null) {
        console.warn(`[cron-balance-check] Could not fetch balance for ${provider.name}`);
        continue;
      }

      // Update balance in DB
      await supabase.from("providers").update({
        balance,
        balance_checked_at: new Date().toISOString(),
      }).eq("id", provider.id);

      const threshold = Number(provider.balance_alert_threshold || 500);
      const isCritical = balance < threshold;
      const isAutoDisable = provider.auto_disable_on_low_balance && balance < threshold * 0.2; // < 20% of threshold

      results.push({ provider: provider.name, balance, threshold, alert: isCritical });

      if (isCritical) {
        console.warn(`[cron-balance-check] LOW BALANCE: ${provider.name} = GHS ${balance} (threshold: ${threshold})`);

        // Log alert
        await supabase.from("system_logs").insert({
          level: isAutoDisable ? "error" : "warn",
          source: "cron-balance-check",
          event: isAutoDisable ? "provider.auto_disabled" : "provider.low_balance",
          message: `${provider.name} balance GHS ${balance.toFixed(2)} ${isAutoDisable ? "— AUTO-DISABLED" : `(below GHS ${threshold} threshold)`}`,
          provider_id: provider.id,
          data: { balance, threshold, provider_name: provider.name, auto_disabled: isAutoDisable },
        });

        // Auto-disable if critically low
        if (isAutoDisable) {
          await supabase.from("providers").update({
            is_active: false,
            disabled_reason: `Auto-disabled: balance GHS ${balance.toFixed(2)} is critically low`,
          }).eq("id", provider.id);
        }

        // Notify all admins
        const { data: admins } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
        if (admins?.length) {
          await supabase.from("user_notifications").insert(admins.map((a: any) => ({
            user_id: a.user_id,
            title: isAutoDisable ? `🚨 Provider Disabled: ${provider.name}` : `⚠️ Low Balance: ${provider.name}`,
            message: `${provider.name} balance is GHS ${balance!.toFixed(2)}${isAutoDisable ? ". Provider has been auto-disabled." : `. Top up now (threshold: GHS ${threshold}).`}`,
            type: isAutoDisable ? "error" : "warning",
            data: { provider_id: provider.id, balance, threshold, link: "/admin/system-logs" },
          })));

          // SMS admin phones
          const adminIds = admins.map((a: any) => a.user_id);
          const { data: adminProfiles } = await supabase
            .from("profiles").select("phone").in("user_id", adminIds).not("phone", "is", null);

          for (const profile of adminProfiles || []) {
            if (!profile.phone) continue;
            try {
              await sendPaymentSms(supabase, profile.phone, "custom" as any, {
                message: `SwiftData: ${provider.name} balance is GHS ${balance!.toFixed(2)}${isAutoDisable ? " — DISABLED. Top up urgently!" : `. Top up now (min GHS ${threshold}).`}`,
              });
            } catch { /* ignore SMS failure */ }
          }
        }
      }
    } catch (e: any) {
      console.error(`[cron-balance-check] Error for ${provider.name}:`, e.message);
      await supabase.from("system_logs").insert({
        level: "error", source: "cron-balance-check", event: "error",
        message: `Failed to check balance for ${provider.name}: ${e.message}`,
        provider_id: provider.id, data: { error: e.message },
      });
    }
  }

  return new Response(JSON.stringify({ checked: results.length, results }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
