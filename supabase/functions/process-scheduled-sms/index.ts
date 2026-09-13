import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, dispatchUnifiedSms, dispatchUnifiedBulkSms } from "../_shared/sms.ts";

declare const Deno: any;

const CONCURRENCY = 5;
const SEND_LIMIT = 200; // max recipients per invocation to stay under resource limits

function personalizeMessage(template: string, name: string, balance?: number): string {
  return template
    .replace(/\{\{name\}\}/gi, name || "Customer")
    .replace(/\{\{balance\}\}/gi, balance !== undefined ? `GHS ${balance.toFixed(2)}` : "GHS 0.00");
}

function hasTokens(msg: string): boolean {
  return /\{\{name\}\}|\{\{balance\}\}/i.test(msg);
}

function calculateNextRunTime(recurringType: string, currentScheduledAt: string): string {
  const now = new Date();

  if (recurringType === "every_hour") {
    return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  }

  if (recurringType === "every_3h") {
    return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
  }

  if (recurringType === "every_6h") {
    return new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
  }

  if (recurringType === "every_12h") {
    return new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
  }

  if (recurringType === "daily") {
    const prev = new Date(currentScheduledAt);
    let next = new Date(prev.getTime() + 24 * 60 * 60 * 1000);
    while (next.getTime() <= now.getTime() + 5 * 60 * 1000) {
      next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
    }
    return next.toISOString();
  }

  if (recurringType === "peak_hours") {
    // Recommended Ghana Peak Hours (GMT):
    // 08:30 (Morning commute / workday launch - Airtime & Commute)
    // 13:00 (Midday Lunch - Data Top-Up & Quick Purchases)
    // 18:30 (Evening Prime - ECG Prepaid Recharge & DStv/GOtv Renewals)
    const peakSlots = [
      { h: 8, m: 30 },
      { h: 13, m: 0 },
      { h: 18, m: 30 },
    ];
    const minTimestamp = now.getTime() + 15 * 60 * 1000;
    for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
      for (const slot of peakSlots) {
        const candidate = new Date(now);
        candidate.setUTCDate(candidate.getUTCDate() + dayOffset);
        candidate.setUTCHours(slot.h, slot.m, 0, 0);
        if (candidate.getTime() > minTimestamp) {
          return candidate.toISOString();
        }
      }
    }
    return new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
  }

  return "";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    let smsConfig: any = null;
    try {
      smsConfig = await getSmsConfig(supabaseAdmin);
    } catch (e) {
      console.warn("[Scheduled] Could not load SMS config:", e);
    }
    const hasSmsConfig = Boolean(smsConfig?.apiKey && smsConfig?.senderId);

    // Claim all due pending broadcasts atomically
    const now = new Date().toISOString();
    const { data: due, error: fetchErr } = await supabaseAdmin
      .from("scheduled_broadcasts")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", now)
      .order("scheduled_at", { ascending: true })
      .limit(10);

    if (fetchErr) throw fetchErr;
    if (!due || due.length === 0) {
      return new Response(JSON.stringify({ message: "No scheduled broadcasts due." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Record<string, unknown>[] = [];

    for (const broadcast of due) {
      // Mark as processing to prevent double-firing
      const { error: claimErr } = await supabaseAdmin
        .from("scheduled_broadcasts")
        .update({ status: "processing" })
        .eq("id", broadcast.id)
        .eq("status", "pending");
      if (claimErr) continue;

      try {
        const smsBody = broadcast.title ? `${broadcast.title}\n${broadcast.message}` : broadcast.message;
        const targetType: string = broadcast.target_type || "all";
        const targetFilters = broadcast.target_filters || {};

        // Resume from saved offset (supports chunked sending across cron runs)
        const prevResult = (broadcast.result || {}) as Record<string, any>;
        const resumeOffset: number = Number(prevResult.next_offset ?? 0);
        const totalSentSoFar: number = Number(prevResult.sent ?? 0);
        const totalFailedSoFar: number = Number(prevResult.failed ?? 0);

        // 1. Send Native Web Push on first chunk (offset 0) if enabled
        let pushResult: any = null;
        if (resumeOffset === 0 && targetFilters.send_push !== false) {
          try {
            const pushRes = await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({
                broadcast: true,
                title: broadcast.title || "SwiftData Ghana Alert",
                body: broadcast.message || "",
                url: targetFilters.url || "/utilities",
              }),
            });
            pushResult = await pushRes.json().catch(() => ({}));
            console.log(`[Scheduled Broadcast ${broadcast.id}] Web push sent:`, pushResult);
          } catch (pushErr) {
            console.warn(`[Scheduled Broadcast ${broadcast.id}] Push invoke failed:`, pushErr);
          }

          // Record in notifications table for user dashboard / in-app history
          try {
            await supabaseAdmin.from("notifications").insert({
              title: broadcast.title || "SwiftData Alert",
              message: broadcast.message || "",
              target_type: targetType,
              created_by: broadcast.created_by || null,
            });
          } catch (notifErr) {
            console.warn("[Scheduled Broadcast] Could not record notification row:", notifErr);
          }
        }

        // 2. Process SMS if enabled
        let sent = 0;
        const failures: Array<{ phone: string; reason: string }> = [];
        let totalRecipients = 0;
        let isDone = true;
        let nextOffset = resumeOffset;

        const shouldSendSms = targetFilters.send_sms !== false;

        if (!shouldSendSms) {
          // Push-only broadcast: finished immediately
          isDone = true;
          totalRecipients = 0;
          sent = 0;
        } else if (!hasSmsConfig) {
          failures.push({ phone: "system", reason: "SMS gateway not configured" });
          isDone = true;
        } else {
          // Fetch recipient chunk from DB
          let q = supabaseAdmin
            .from("profiles")
            .select("user_id, phone, full_name, is_agent, is_sub_agent")
            .eq("sms_opt_out", false)
            .range(resumeOffset, resumeOffset + SEND_LIMIT - 1);

          if (targetType === "agents") q = q.or("is_agent.eq.true,is_sub_agent.eq.true");
          else if (targetType === "sub_agents") q = q.eq("is_sub_agent", true);
          else if (targetType === "parent_agents") q = q.eq("is_agent", true).eq("is_sub_agent", false);
          else if (targetType === "users") q = q.eq("is_agent", false).eq("is_sub_agent", false);

          const { data: rows } = await q;
          type Recipient = { phone: string; name: string; userId: string; isAgent: boolean };
          const chunk: Recipient[] = (rows || [])
            .map((row: any) => ({
              phone: normalizePhone(row.phone) || "",
              name: row.full_name || "Customer",
              userId: row.user_id || "",
              isAgent: Boolean(row.is_agent || row.is_sub_agent),
            }))
            .filter((r: Recipient) => r.phone);

          totalRecipients = resumeOffset + chunk.length + (chunk.length === SEND_LIMIT ? 1 : 0);

          // Fetch balances for {{balance}} token
          const balanceMap = new Map<string, number>();
          if (hasTokens(smsBody)) {
            const agentIds = chunk.filter((r) => r.isAgent).map((r) => r.userId).filter(Boolean);
            if (agentIds.length > 0) {
              const { data: wallets } = await supabaseAdmin
                .from("wallets").select("agent_id, balance").in("agent_id", agentIds);
              for (const w of wallets || []) balanceMap.set(w.agent_id, Number(w.balance || 0));
            }
          }

          // Dispatch SMS for this chunk
          const needsTokens = hasTokens(smsBody);
          if (needsTokens) {
            for (let i = 0; i < chunk.length; i += CONCURRENCY) {
              const batch = chunk.slice(i, i + CONCURRENCY);
              await Promise.all(batch.map(async (r) => {
                const body = personalizeMessage(smsBody, r.name, balanceMap.get(r.userId));
                try {
                  await dispatchUnifiedSms(smsConfig.gateway, smsConfig.apiKey, smsConfig.senderId, r.phone, body, "broadcast");
                  sent++;
                } catch (e) {
                  failures.push({ phone: r.phone, reason: e instanceof Error ? e.message : "Unknown" });
                }
              }));
            }
          } else {
            const phones = chunk.map((r) => r.phone);
            if (phones.length > 0) {
              const bulkResult = await dispatchUnifiedBulkSms(smsConfig.gateway, smsConfig.apiKey, smsConfig.senderId, phones, smsBody, "broadcast");
              sent = bulkResult.sent;
              failures.push(...bulkResult.failures);
            }
          }

          nextOffset = resumeOffset + chunk.length;
          isDone = nextOffset >= totalRecipients;
        }

        const cumulativeSent = totalSentSoFar + sent;
        const cumulativeFailed = totalFailedSoFar + failures.length;

        const result: Record<string, any> = {
          total_recipients: totalRecipients,
          sent: cumulativeSent,
          failed: cumulativeFailed,
          push_result: pushResult || prevResult.push_result || null,
          failures: failures.slice(0, 20),
        };

        if (isDone) {
          const recurringType = targetFilters.recurring;
          const nextRunAt = recurringType ? calculateNextRunTime(recurringType, broadcast.scheduled_at) : null;

          if (recurringType && nextRunAt) {
            // Auto-recurring schedule: reset to pending with next recommended hour or interval
            await supabaseAdmin.from("scheduled_broadcasts").update({
              status: "pending",
              scheduled_at: nextRunAt,
              result: {
                ...result,
                last_executed_at: new Date().toISOString(),
                last_run_sent: cumulativeSent,
                next_scheduled_at: nextRunAt,
                next_offset: 0,
              },
            }).eq("id", broadcast.id);
          } else {
            // One-time schedule completed
            await supabaseAdmin.from("scheduled_broadcasts").update({
              status: "sent",
              result,
            }).eq("id", broadcast.id);
          }
        } else {
          // More recipients remain — save progress and re-queue for next cron invocation
          result.next_offset = nextOffset;
          result.progress = `${nextOffset}/${totalRecipients}`;
          await supabaseAdmin.from("scheduled_broadcasts").update({
            status: "pending",
            result,
          }).eq("id", broadcast.id);
        }

        results.push({ id: broadcast.id, ...result });
      } catch (err) {
        await supabaseAdmin.from("scheduled_broadcasts").update({
          status: "failed",
          result: { error: err instanceof Error ? err.message : "Unknown error" },
        }).eq("id", broadcast.id);
        results.push({ id: broadcast.id, error: err instanceof Error ? err.message : "Unknown" });
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("process-scheduled-sms error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
