import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, sendSmsViaTxtConnect } from "../_shared/sms.ts";

type TargetType = "all" | "agents" | "sub_agents" | "parent_agents" | "users" | "pending_orders";

interface TargetFilters {
  inactive_days?: number;
  min_balance?: number;
  max_balance?: number;
}

interface Recipient {
  phone: string;
  name: string;
  userId: string;
  isAgent: boolean;
}

function personalizeMessage(template: string, recipient: Recipient, balance?: number): string {
  return template
    .replace(/\{\{name\}\}/gi, recipient.name || "Customer")
    .replace(/\{\{balance\}\}/gi, balance !== undefined ? `GHS ${balance.toFixed(2)}` : "GHS 0.00");
}

function hasTokens(msg: string): boolean {
  return /\{\{name\}\}|\{\{balance\}\}/i.test(msg);
}

async function resolveRecipients(
  supabaseAdmin: any,
  targetType: TargetType,
  targetFilters: TargetFilters,
): Promise<{ recipients: Recipient[]; optOutCount: number }> {
  const BATCH = 1000;
  const unique = new Map<string, Recipient>();
  let optOutCount = 0;

  if (targetType === "pending_orders") {
    const { data } = await supabaseAdmin
      .from("orders")
      .select("customer_phone")
      .eq("status", "pending");
    for (const row of data || []) {
      const p = normalizePhone(row.customer_phone);
      if (p && !unique.has(p)) {
        unique.set(p, { phone: p, name: "Customer", userId: "", isAgent: false });
      }
    }
    return { recipients: Array.from(unique.values()), optOutCount: 0 };
  }

  // Build query for profiles
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    let q = supabaseAdmin
      .from("profiles")
      .select("user_id, phone, full_name, is_agent, is_sub_agent, sms_opt_out")
      .range(offset, offset + BATCH - 1);

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
      if (row.sms_opt_out) { optOutCount++; continue; }
      const p = normalizePhone(row.phone);
      if (!p || unique.has(p)) continue;
      unique.set(p, {
        phone: p,
        name: row.full_name || "Customer",
        userId: row.user_id || "",
        isAgent: Boolean(row.is_agent || row.is_sub_agent),
      });
    }

    hasMore = rows.length === BATCH;
    offset += BATCH;
  }

  let recipients = Array.from(unique.values());

  // Post-fetch filter: inactive_days
  if (targetFilters.inactive_days && targetFilters.inactive_days > 0) {
    const cutoff = new Date(Date.now() - targetFilters.inactive_days * 86400_000).toISOString();
    const { data: activeOrders } = await supabaseAdmin
      .from("orders")
      .select("agent_id")
      .gte("created_at", cutoff);
    const activeIds = new Set((activeOrders || []).map((o: any) => o.agent_id).filter(Boolean));
    recipients = recipients.filter((r) => !r.userId || !activeIds.has(r.userId));
  }

  // Post-fetch filter: min_balance / max_balance (agents only)
  if (
    (targetFilters.min_balance !== undefined || targetFilters.max_balance !== undefined) &&
    (targetType === "agents" || targetType === "sub_agents" || targetType === "parent_agents" || targetType === "all")
  ) {
    const agentIds = recipients.filter((r) => r.isAgent).map((r) => r.userId).filter(Boolean);
    if (agentIds.length > 0) {
      const { data: wallets } = await supabaseAdmin
        .from("wallets")
        .select("agent_id, balance")
        .in("agent_id", agentIds);
      const balanceMap = new Map((wallets || []).map((w: any) => [w.agent_id, Number(w.balance || 0)]));
      const minBal: number | null = Number.isFinite(Number(targetFilters.min_balance)) ? Number(targetFilters.min_balance) : null;
      const maxBal: number | null = Number.isFinite(Number(targetFilters.max_balance)) ? Number(targetFilters.max_balance) : null;
      recipients = recipients.filter((r) => {
        if (!r.isAgent) return true;
        const bal: number = Number(balanceMap.get(r.userId) ?? 0);
        if (minBal !== null && bal < minBal) return false;
        if (maxBal !== null && bal > maxBal) return false;
        return true;
      });
    }
  }

  return { recipients, optOutCount };
}

async function fetchBalanceMap(supabaseAdmin: any, userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const { data } = await supabaseAdmin.from("wallets").select("agent_id, balance").in("agent_id", userIds);
  return new Map((data || []).map((w: any) => [w.agent_id, Number(w.balance || 0)]));
}

async function sendToRecipients(
  apiKey: string,
  senderId: string,
  recipients: Recipient[],
  messageTemplate: string,
  balanceMap: Map<string, number>,
  concurrency = 5,
): Promise<{ sent: number; failures: Array<{ phone: string; reason: string }> }> {
  let sent = 0;
  const failures: Array<{ phone: string; reason: string }> = [];
  const needsTokens = hasTokens(messageTemplate);

  for (let i = 0; i < recipients.length; i += concurrency) {
    const chunk = recipients.slice(i, i + concurrency);
    await Promise.all(chunk.map(async (r) => {
      try {
        const body = needsTokens
          ? personalizeMessage(messageTemplate, r, balanceMap.get(r.userId))
          : messageTemplate;
        await sendSmsViaTxtConnect(apiKey, senderId, r.phone, body);
        sent++;
      } catch (e) {
        failures.push({ phone: r.phone, reason: e instanceof Error ? e.message : "Unknown" });
      }
    }));
  }
  return { sent, failures };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { apiKey: txtApiKey, senderId: txtSenderId } = await getSmsConfig(supabaseAdmin);
  if (!txtApiKey || !txtSenderId) {
    return new Response(JSON.stringify({
      error: "SMS not configured. Please add your TxtConnect API Key in Admin → Settings.",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const { data: { user: actor }, error: actorError } = await supabaseUser.auth.getUser();
    if (actorError || !actor) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", actor.id).eq("role", "admin").limit(1);
    if (!roles || roles.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json();
    const target_type = (payload?.target_type || "all") as TargetType | "test";
    const title = String(payload?.title || "").trim();
    const message = String(payload?.message || "").trim();
    const test_phone = String(payload?.test_phone || "").trim();
    const dry_run = Boolean(payload?.dry_run);
    const retry_phones: string[] = Array.isArray(payload?.retry_phones) ? payload.retry_phones : [];
    const target_filters: TargetFilters = (payload?.target_filters && typeof payload.target_filters === "object")
      ? payload.target_filters : {};

    if (!message) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const smsBody = title ? `${title}\n${message}` : message;

    // Test mode
    if (target_type === "test") {
      const normalized = normalizePhone(test_phone);
      if (!normalized) {
        return new Response(JSON.stringify({ error: "Invalid test phone number" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await sendSmsViaTxtConnect(txtApiKey, txtSenderId, normalized, smsBody);
      return new Response(JSON.stringify({ success: true, sent: 1, target_type: "test", to: normalized }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Retry mode: send only to specific phones
    if (retry_phones.length > 0) {
      const retryRecipients: Recipient[] = retry_phones
        .map((p) => normalizePhone(p))
        .filter((p): p is string => !!p)
        .map((p) => ({ phone: p, name: "Customer", userId: "", isAgent: false }));

      const { sent, failures } = await sendToRecipients(txtApiKey, txtSenderId, retryRecipients, smsBody, new Map());
      return new Response(JSON.stringify({
        success: true,
        target_type: "retry",
        total_recipients: retryRecipients.length,
        valid_numbers: retryRecipients.length,
        sent, failed: failures.length,
        skipped_invalid_or_empty: retry_phones.length - retryRecipients.length,
        failures: failures.slice(0, 20),
        opt_out_count: 0,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Normal / dry-run mode
    const { recipients, optOutCount } = await resolveRecipients(
      supabaseAdmin, target_type as TargetType, target_filters,
    );

    if (dry_run) {
      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        estimated_recipients: recipients.length,
        opt_out_count: optOutCount,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch balances if {{balance}} token used
    const balanceMap = hasTokens(smsBody)
      ? await fetchBalanceMap(supabaseAdmin, recipients.filter((r) => r.isAgent).map((r) => r.userId))
      : new Map<string, number>();

    const { sent, failures } = await sendToRecipients(txtApiKey, txtSenderId, recipients, smsBody, balanceMap);

    return new Response(JSON.stringify({
      success: true,
      target_type,
      total_recipients: recipients.length,
      valid_numbers: recipients.length,
      sent,
      failed: failures.length,
      skipped_invalid_or_empty: 0,
      failures: failures.slice(0, 50),
      opt_out_count: optOutCount,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("admin-send-sms error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
