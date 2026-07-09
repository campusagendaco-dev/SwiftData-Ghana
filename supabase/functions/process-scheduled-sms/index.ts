import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, sendSmsViaTxtConnect, sendBulkSmsViaTxtConnect } from "../_shared/sms.ts";

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
    const { apiKey: txtApiKey, senderId: txtSenderId } = await getSmsConfig(supabaseAdmin);
    if (!txtApiKey || !txtSenderId) {
      return new Response(JSON.stringify({ message: "SMS not configured, skipping." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

        // Resume from saved offset (supports chunked sending across cron runs)
        const prevResult = (broadcast.result || {}) as Record<string, any>;
        const resumeOffset: number = Number(prevResult.next_offset ?? 0);
        const totalSentSoFar: number = Number(prevResult.sent ?? 0);
        const totalFailedSoFar: number = Number(prevResult.failed ?? 0);

        // Fetch only the chunk we need directly from DB (avoids loading all rows into memory)
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

        // If chunk is full (SEND_LIMIT rows returned), more remain; otherwise we're done
        const totalRecipients: number = resumeOffset + chunk.length + (chunk.length === SEND_LIMIT ? 1 : 0);

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

        // Send this chunk
        let sent = 0;
        const failures: Array<{ phone: string; reason: string }> = [];
        const needsTokens = hasTokens(smsBody);

        if (needsTokens) {
          // Personalized — must send individually
          for (let i = 0; i < chunk.length; i += CONCURRENCY) {
            const batch = chunk.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (r) => {
              const body = personalizeMessage(smsBody, r.name, balanceMap.get(r.userId));
              try {
                await sendSmsViaTxtConnect(txtApiKey, txtSenderId, r.phone, body);
                sent++;
              } catch (e) {
                failures.push({ phone: r.phone, reason: e instanceof Error ? e.message : "Unknown" });
              }
            }));
          }
        } else {
          // Same message for all — use bulk API (100 recipients per HTTP call)
          const phones = chunk.map((r) => r.phone);
          const bulkResult = await sendBulkSmsViaTxtConnect(txtApiKey, txtSenderId, phones, smsBody);
          sent = bulkResult.sent;
          failures.push(...bulkResult.failures);
        }

        const nextOffset = resumeOffset + chunk.length;
        const cumulativeSent = totalSentSoFar + sent;
        const cumulativeFailed = totalFailedSoFar + failures.length;
        const isDone = nextOffset >= totalRecipients;

        const result: Record<string, any> = {
          total_recipients: totalRecipients,
          sent: cumulativeSent,
          failed: cumulativeFailed,
          failures: failures.slice(0, 20),
        };

        if (isDone) {
          // All recipients processed — mark as sent
          await supabaseAdmin.from("scheduled_broadcasts").update({
            status: "sent",
            result,
          }).eq("id", broadcast.id);
        } else {
          // More recipients remain — save progress and re-queue for next cron run
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
