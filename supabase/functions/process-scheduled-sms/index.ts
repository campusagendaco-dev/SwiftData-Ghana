import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, dispatchUnifiedSms, dispatchUnifiedBulkSms } from "../_shared/sms.ts";

declare const Deno: any;

const TOKEN_CONCURRENCY = 4; // Concurrency for token-personalized micro-batches
const TOKEN_SEND_LIMIT = 40;  // Per-invocation chunk limit for token-personalized messages
const BULK_SEND_LIMIT = 200;  // Per-invocation chunk limit for non-token bulk messages (2x 100-chunk batches)
const MAX_WALL_TIME_MS = 20000; // 20-second watchdog to strictly guarantee zero Edge Function timeouts

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
    // 08:30 (Morning commute / workday launch)
    // 13:00 (Midday Lunch)
    // 18:30 (Evening Prime)
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
  }

  return "";
}

type Recipient = { phone: string; name: string; userId: string; isAgent: boolean };

async function getScheduledRecipients(
  supabaseAdmin: any,
  targetType: string,
  resumeOffset: number,
  prevResult: Record<string, any>,
  limit: number
): Promise<{ chunk: Recipient[]; totalRecipients: number; cachedList?: Recipient[] }> {
  // If we already cached the resolved recipient list in the broadcast result, slice from cache directly
  if (Array.isArray(prevResult.cached_recipients) && prevResult.cached_recipients.length > 0) {
    const all: Recipient[] = prevResult.cached_recipients;
    const chunk = all.slice(resumeOffset, resumeOffset + limit);
    return { chunk, totalRecipients: all.length, cachedList: all };
  }

  const unique = new Map<string, Recipient>();

  // For "all" or "all_order_phones", merge completed/fulfilled orders (up to 10,000 orders)
  if (targetType === "all" || targetType === "all_order_phones") {
    const BATCH = 1000;
    const MAX_ORDERS = 10000;
    let offset = 0;
    let hasMore = true;

    while (hasMore && offset < MAX_ORDERS) {
      const { data: orders } = await supabaseAdmin
        .from("orders")
        .select("customer_phone")
        .in("status", ["fulfilled", "completed", "paid", "processing"])
        .not("customer_phone", "is", null)
        .order("created_at", { ascending: false })
        .range(offset, offset + BATCH - 1);

      for (const row of orders || []) {
        const p = normalizePhone(row.customer_phone);
        if (p && !unique.has(p)) {
          unique.set(p, { phone: p, name: "Customer", userId: "", isAgent: false });
        }
      }
      hasMore = (orders || []).length === BATCH;
      offset += BATCH;
    }
  }

  if (targetType === "pending_orders") {
    const { data: orders } = await supabaseAdmin
      .from("orders")
      .select("customer_phone")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(2000);

    for (const row of orders || []) {
      const p = normalizePhone(row.customer_phone);
      if (p && !unique.has(p)) {
        unique.set(p, { phone: p, name: "Customer", userId: "", isAgent: false });
      }
    }
    const all = Array.from(unique.values());
    const chunk = all.slice(resumeOffset, resumeOffset + limit);
    return { chunk, totalRecipients: all.length, cachedList: all };
  }

  // Query profiles table for matching accounts (with deterministic created_at order)
  const BATCH = 1000;
  let pOffset = 0;
  let pHasMore = true;

  while (pHasMore) {
    let q = supabaseAdmin
      .from("profiles")
      .select("user_id, phone, full_name, is_agent, is_sub_agent, sms_opt_out")
      .eq("sms_opt_out", false)
      .not("phone", "is", null)
      .neq("phone", "")
      .order("created_at", { ascending: true })
      .range(pOffset, pOffset + BATCH - 1);

    if (targetType === "agents") {
      q = q.or("is_agent.eq.true,is_sub_agent.eq.true");
    } else if (targetType === "sub_agents") {
      q = q.eq("is_sub_agent", true);
    } else if (targetType === "parent_agents") {
      q = q.eq("is_agent", true).eq("is_sub_agent", false);
    } else if (targetType === "users") {
      q = q.eq("is_agent", false).eq("is_sub_agent", false);
    }

    const { data: rows, error } = await q;
    if (error || !rows) break;

    for (const row of rows) {
      if (row.sms_opt_out) continue;
      const p = normalizePhone(row.phone);
      if (!p) continue;
      // Overwrite or add with profile metadata
      unique.set(p, {
        phone: p,
        name: row.full_name || "Customer",
        userId: row.user_id || "",
        isAgent: Boolean(row.is_agent || row.is_sub_agent),
      });
    }

    pHasMore = rows.length === BATCH;
    pOffset += BATCH;
  }

  const all = Array.from(unique.values());
  const chunk = all.slice(resumeOffset, resumeOffset + limit);
  return { chunk, totalRecipients: all.length, cachedList: all };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const START_TIME = Date.now();
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    let reqBody: any = {};
    try {
      reqBody = await req.json();
    } catch {
      reqBody = {};
    }

    const forceId = reqBody?.force_id || reqBody?.broadcast_id;
    const forceAll = Boolean(reqBody?.force_all || reqBody?.force);

    // 1. Auto-recover any broadcasts that were stuck in "processing" for > 3 minutes (from previous invocation timeout or crash)
    const staleCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from("scheduled_broadcasts")
      .update({ status: "pending" })
      .eq("status", "processing")
      .lte("scheduled_at", staleCutoff);

    let smsConfig: any = null;
    try {
      smsConfig = await getSmsConfig(supabaseAdmin);
    } catch (e) {
      console.warn("[Scheduled] Could not load SMS config:", e);
    }
    const hasSmsConfig = Boolean(smsConfig?.apiKey && smsConfig?.senderId);

    // 2. Query due broadcasts or specific forced broadcast
    const now = new Date().toISOString();
    let dueQuery = supabaseAdmin
      .from("scheduled_broadcasts")
      .select("*");

    if (forceId) {
      dueQuery = dueQuery.eq("id", forceId);
    } else {
      dueQuery = dueQuery
        .in("status", ["pending"])
        .order("scheduled_at", { ascending: true })
        .limit(5);

      if (!forceAll) {
        dueQuery = dueQuery.lte("scheduled_at", now);
      }
    }

    const { data: due, error: fetchErr } = await dueQuery;

    if (fetchErr) throw fetchErr;
    if (!due || due.length === 0) {
      return new Response(JSON.stringify({ message: "No scheduled broadcasts due." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Record<string, unknown>[] = [];

    for (const broadcast of due) {
      // Check execution time watchdog
      if (Date.now() - START_TIME > MAX_WALL_TIME_MS) {
        console.log("[Scheduled] Time budget reached across broadcasts. Deferring remaining to next run.");
        break;
      }

      // Mark as processing to prevent concurrent double-firing
      const prevResult = (broadcast.result || {}) as Record<string, any>;
      const { error: claimErr } = await supabaseAdmin
        .from("scheduled_broadcasts")
        .update({ 
          status: "processing",
          result: { ...prevResult, started_at: new Date().toISOString() }
        })
        .eq("id", broadcast.id)
        .in("status", ["pending", "processing"]);

      if (claimErr) continue;

      try {
        const smsBody = broadcast.title ? `${broadcast.title}\n${broadcast.message}` : broadcast.message;
        const targetType: string = broadcast.target_type || "all";
        const targetFilters = broadcast.target_filters || {};

        // Resume from saved offset (supports chunked sending across cron runs)
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
              signal: AbortSignal.timeout(8000),
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
          isDone = true;
          totalRecipients = 0;
          sent = 0;
        } else if (!hasSmsConfig) {
          failures.push({ phone: "system", reason: "SMS gateway not configured" });
          isDone = true;
        } else {
          const needsTokens = hasTokens(smsBody);
          const chunkLimit = needsTokens ? TOKEN_SEND_LIMIT : BULK_SEND_LIMIT;

          const { chunk, totalRecipients: resolvedTotal, cachedList } = await getScheduledRecipients(
            supabaseAdmin, targetType, resumeOffset, prevResult, chunkLimit
          );
          totalRecipients = resolvedTotal;

          const effectiveSenderId = targetFilters.sender_id || smsConfig.senderId || "SwiftDataGh";

          // Fetch balances for {{balance}} token
          const balanceMap = new Map<string, number>();
          if (needsTokens) {
            const agentIds = chunk.filter((r) => r.isAgent).map((r) => r.userId).filter(Boolean);
            if (agentIds.length > 0) {
              const { data: wallets } = await supabaseAdmin
                .from("wallets").select("agent_id, balance").in("agent_id", agentIds);
              for (const w of wallets || []) balanceMap.set(w.agent_id, Number(w.balance || 0));
            }
          }

          // Dispatch SMS for this chunk with rate-limit pacing and watchdog
          if (needsTokens) {
            for (let i = 0; i < chunk.length; i += TOKEN_CONCURRENCY) {
              if (Date.now() - START_TIME > MAX_WALL_TIME_MS) {
                console.log(`[Scheduled Broadcast ${broadcast.id}] Reached wall time limit. Pausing batch.`);
                break;
              }

              const batch = chunk.slice(i, i + TOKEN_CONCURRENCY);
              await Promise.all(batch.map(async (r) => {
                const body = personalizeMessage(smsBody, r.name, balanceMap.get(r.userId));
                try {
                  await dispatchUnifiedSms(smsConfig.gateway, smsConfig.apiKey, effectiveSenderId, r.phone, body, "broadcast");
                  sent++;
                } catch (e: any) {
                  const errMsg = e instanceof Error ? e.message : String(e);
                  failures.push({ phone: r.phone, reason: errMsg });
                }
              }));

              // 350ms pacing delay between micro-batches to respect SMS provider rate limits
              if (i + TOKEN_CONCURRENCY < chunk.length) {
                await new Promise((resolve) => setTimeout(resolve, 350));
              }
            }
          } else {
            const phones = chunk.map((r) => r.phone);
            if (phones.length > 0) {
              const bulkResult = await dispatchUnifiedBulkSms(smsConfig.gateway, smsConfig.apiKey, effectiveSenderId, phones, smsBody, "broadcast");
              sent = bulkResult.sent;
              failures.push(...bulkResult.failures);
            }
          }

          // Check if rate limiting was detected on gateway
          const rateLimited = failures.some(f => 
            f.reason.toLowerCase().includes("rate") || 
            f.reason.toLowerCase().includes("too many") ||
            f.reason.includes("999") ||
            f.reason.includes("429")
          );

          if (rateLimited) {
            console.warn(`[Scheduled Broadcast ${broadcast.id}] Rate limit detected on gateway. Pausing remaining chunks for next minute cooldown.`);
            isDone = false;
            // Advance ONLY by the recipients that were sent successfully.
            // Do NOT advance past rate-limited recipients so they will be retried next cron tick!
            nextOffset = resumeOffset + sent;
          } else {
            const actuallyProcessedInRun = sent + failures.length;
            nextOffset = resumeOffset + actuallyProcessedInRun;
            isDone = nextOffset >= totalRecipients || chunk.length === 0;
          }

          // Preserve cached recipient list for multi-chunk runs
          const activeCachedList = cachedList || prevResult.cached_recipients;
          if (activeCachedList && activeCachedList.length > 0) {
            prevResult.cached_recipients = activeCachedList;
          }
        }

        // Only count permanent failures in cumulative total (rate-limited ones will be retried)
        const permanentFailures = failures.filter(f => 
          !f.reason.toLowerCase().includes("rate") && 
          !f.reason.toLowerCase().includes("too many") &&
          !f.reason.includes("999") &&
          !f.reason.includes("429")
        );

        const cumulativeSent = totalSentSoFar + sent;
        const cumulativeFailed = totalFailedSoFar + permanentFailures.length;

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
          // More recipients remain — save progress, retain cache, and re-queue for next cron invocation
          result.next_offset = nextOffset;
          result.progress = `${nextOffset}/${totalRecipients}`;
          if (prevResult.cached_recipients) {
            result.cached_recipients = prevResult.cached_recipients;
          }
          await supabaseAdmin.from("scheduled_broadcasts").update({
            status: "pending",
            result,
          }).eq("id", broadcast.id);
        }

        results.push({ id: broadcast.id, ...result });
      } catch (err: any) {
        console.error(`[Scheduled Broadcast ${broadcast.id}] Error:`, err);
        const errMsg = err instanceof Error ? err.message : String(err);
        const isRateLimit = errMsg.toLowerCase().includes("rate") || errMsg.toLowerCase().includes("too many");

        await supabaseAdmin.from("scheduled_broadcasts").update({
          status: isRateLimit ? "pending" : "failed",
          result: { 
            ...prevResult,
            error: errMsg,
            last_error_at: new Date().toISOString()
          },
        }).eq("id", broadcast.id);
        results.push({ id: broadcast.id, error: errMsg });
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
