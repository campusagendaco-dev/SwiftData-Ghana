// Nightly Paystack ↔ wallet reconciliation (read-only).
//
// Compares the last 48h of successful Paystack transactions with orders and
// the wallet ledger, and records any of:
//   paid_without_order      Paystack success with no matching order
//   paid_not_credited       paid wallet top-up that never reached the wallet
//   credited_without_payment top-up credit for a Paystack order with no success
//   credit_exceeds_payment  credited more than Paystack actually received
// Results are stored in wallet_reconciliation_runs; admins are notified on
// issues. It never moves money. Callable by the cron job (service key) or an
// admin.
//
// Also (2026-11-24): orders refunded twice, the same bundle delivered twice within
// 2 minutes, and Paystack orders delivered without full verified payment. Every issue gets
// a plain-language explanation and a safe next step: written by the AI when its words stick
// to the issue's own numbers, otherwise by fixed rules (reconcile_checks.ts). Read-only.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { callAiAgent } from "../_shared/ai.ts";
import { buildExplainPrompt, findLedgerIssues, mergeExplanations, type ReconIssue } from "../_shared/reconcile_checks.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type PaystackTx = { reference: string; amount: number; status: string; paid_at?: string; metadata?: any };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Server misconfigured" }, 500);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Auth: the cron job sends the service key; otherwise require an admin.
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (bearer !== SERVICE_KEY) {
    const auth = await verifyAdmin(req, admin);
    if (!auth.success) return json({ error: auth.error || "Unauthorized" }, auth.status || 401);
  }

  let secret = (Deno.env.get("PAYSTACK_SECRET_KEY") || "").trim();
  if (!secret) {
    const { data } = await admin.from("v_system_settings_with_secrets").select("paystack_secret_key").maybeSingle();
    secret = String((data as any)?.paystack_secret_key || "").trim();
  }
  if (!secret) return json({ error: "Paystack key not configured" }, 500);

  const hours = Math.min(168, Math.max(1, Number(new URL(req.url).searchParams.get("hours") || 48)));
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3600_000);

  // 1. Successful Paystack transactions in the window.
  const txs: PaystackTx[] = [];
  for (let page = 1; page <= 50; page++) {
    const url = `https://api.paystack.co/transaction?status=success&perPage=100&page=${page}&from=${from.toISOString()}&to=${to.toISOString()}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
    if (!res.ok) return json({ error: `Paystack list failed (${res.status})` }, 502);
    const body = await res.json();
    const rows: PaystackTx[] = Array.isArray(body?.data) ? body.data : [];
    txs.push(...rows);
    const pageCount = Number(body?.meta?.pageCount || 1);
    if (page >= pageCount || rows.length === 0) break;
  }

  const refOf = (t: PaystackTx) => {
    const m = typeof t.metadata === "string" ? (() => { try { return JSON.parse(t.metadata); } catch { return {}; } })() : t.metadata || {};
    return String(m?.order_id || t.reference || "");
  };
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const paidByOrder = new Map<string, number>();
  for (const t of txs) {
    const id = refOf(t);
    paidByOrder.set(id, (paidByOrder.get(id) || 0) + Number(t.amount || 0) / 100);
  }
  const orderIds = [...paidByOrder.keys()].filter((id) => uuidRe.test(id));

  // 2. Matching orders (chunked).
  const orders = new Map<string, any>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data } = await admin.from("orders")
      .select("id, order_type, status, amount, payment_method, agent_id")
      .in("id", orderIds.slice(i, i + 200));
    for (const o of data || []) orders.set(o.id, o);
  }

  // 3. Top-up credits in the window from the ledger.
  const { data: credits } = await admin.from("wallet_ledger")
    .select("reference_id, amount, agent_id, created_at")
    .eq("reason", "wallet_topup")
    .gte("created_at", from.toISOString());

  const issues: ReconIssue[] = [];
  const add = (type: string, order_id: string, amount_ghs: number, detail: string) =>
    issues.push({ key: `${type}:${order_id}`, type, order_id, amount_ghs: Number(amount_ghs.toFixed(2)), detail });
  const nonUuidRefs = [...paidByOrder.keys()].filter((id) => !uuidRe.test(id));
  for (const ref of nonUuidRefs) add("paid_without_order", ref, paidByOrder.get(ref)!, `GH₵${paidByOrder.get(ref)!.toFixed(2)} paid, reference is not an order id`);
  for (const id of orderIds) {
    const o = orders.get(id);
    const paid = paidByOrder.get(id) || 0;
    if (!o) {
      add("paid_without_order", id, paid, `GH₵${paid.toFixed(2)} paid, no order found`);
      continue;
    }
    if (o.order_type === "wallet_topup" && o.status !== "fulfilled") {
      add("paid_not_credited", id, paid, `GH₵${paid.toFixed(2)} paid, top-up status is ${o.status}`);
    }
  }
  const creditedByOrder = new Map<string, number>();
  for (const c of credits || []) {
    if (!c.reference_id) continue;
    creditedByOrder.set(c.reference_id, (creditedByOrder.get(c.reference_id) || 0) + Number(c.amount || 0));
  }
  if (creditedByOrder.size) {
    const ids = [...creditedByOrder.keys()].filter((id) => uuidRe.test(id));
    const credOrders = new Map<string, any>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin.from("orders").select("id, payment_method").in("id", ids.slice(i, i + 200));
      for (const o of data || []) credOrders.set(o.id, o);
    }
    for (const [id, credited] of creditedByOrder) {
      const pm = String(credOrders.get(id)?.payment_method || "").toLowerCase();
      if (pm !== "paystack") continue; // Korba / admin credits are verified elsewhere
      const paid = paidByOrder.get(id);
      if (paid === undefined) {
        add("credited_without_payment", id, credited, `GH₵${credited.toFixed(2)} credited, no successful Paystack payment in the last ${hours}h`);
      } else if (credited > paid + 0.01) {
        add("credit_exceeds_payment", id, credited - paid, `GH₵${credited.toFixed(2)} credited, GH₵${paid.toFixed(2)} paid`);
      }
    }
  }

  // 4. Checks Paystack can't show: double refunds, double deliveries, delivered-but-underpaid.
  const [{ data: refunds }, { data: delivered }] = await Promise.all([
    admin.from("wallet_ledger").select("reference_id, amount, agent_id, created_at")
      .eq("reason", "order_refund").gte("created_at", from.toISOString()).limit(5000),
    admin.from("orders")
      .select("id, agent_id, customer_phone, network, package_size, amount, status, payment_method, paystack_verified_amount, created_at")
      .in("status", ["fulfilled", "completed"]).gte("created_at", from.toISOString()).limit(5000),
  ]);
  issues.push(...findLedgerIssues({ orders: (delivered || []) as any[], refunds: (refunds || []) as any[] }));

  // 5. Plain-language explanations (AI words only when they stick to each issue's facts).
  let aiModel: string | null = null;
  let aiOutput: unknown = null;
  if (issues.length) {
    try {
      const prompt = buildExplainPrompt(issues);
      const res = await callAiAgent(admin, "reconciliation_explainer", prompt.system, prompt.user, 2000, { responseJson: true });
      aiModel = res.model;
      const s = res.text.indexOf("{");
      const e = res.text.lastIndexOf("}");
      aiOutput = s !== -1 && e > s ? JSON.parse(res.text.slice(s, e + 1)) : null;
    } catch (err) {
      console.warn("[wallet-reconcile] explanations fell back to rules:", err);
    }
  }
  const explained = mergeExplanations(issues, aiOutput);

  const ok = issues.length === 0;
  const summary = {
    ok,
    window_hours: hours,
    paystack_transactions: txs.length,
    paystack_total: Number([...paidByOrder.values()].reduce((s, v) => s + v, 0).toFixed(2)),
    topup_credits_checked: creditedByOrder.size,
    issues: issues.length,
    issues_total_ghs: Number(issues.reduce((s, i) => s + i.amount_ghs, 0).toFixed(2)),
    by_type: issues.reduce((m: Record<string, number>, i) => ((m[i.type] = (m[i.type] || 0) + 1), m), {}),
    explained_by_ai: explained.filter((i) => i.explained_by === "ai").length,
    ai_model: aiModel,
  };

  await admin.from("wallet_reconciliation_runs").insert({
    kind: "paystack",
    ok,
    issues: issues.length,
    details: { ...summary, sample: explained.slice(0, 100) },
  });

  // Persist reconciliation snapshot & discrepancies into ai_system_memory so
  // ai-fix-proposer and /admin/watchdog always see them (including "Delivered twice").
  try {
    const nowIso = new Date().toISOString();
    const issueTypesList = Object.entries(summary.by_type)
      .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
      .join(", ");
    const latestSummary = ok
      ? `[CLEAN] Reconciled ${txs.length} Paystack tx(s) (${hours}h) — 0 discrepancies.`
      : `[ISSUES] ${issues.length} reconciliation discrepancy(ies) totaling GH₵${summary.issues_total_ghs.toFixed(2)}: ${issueTypesList}`;

    const upsertMemory = async (memoryKey: string, category: string, memSummary: string, data: Record<string, unknown>) => {
      const { data: existing } = await admin
        .from("ai_system_memory")
        .select("id, observations_count")
        .eq("memory_key", memoryKey)
        .maybeSingle();

      if (existing?.id) {
        await admin
          .from("ai_system_memory")
          .update({
            category,
            summary: memSummary.slice(0, 500),
            data,
            confidence: 0.98,
            observations_count: Number(existing.observations_count || 1) + 1,
            last_observed_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", existing.id);
      } else {
        await admin.from("ai_system_memory").insert({
          memory_key: memoryKey,
          category,
          summary: memSummary.slice(0, 500),
          data,
          confidence: 0.98,
          observations_count: 1,
          last_observed_at: nowIso,
        });
      }
    };

    await upsertMemory(
      "reconciliation:latest",
      ok ? "baseline" : "error_signature",
      latestSummary,
      {
        source: "reconciliation_explainer",
        ...summary,
        sample: explained.slice(0, 50),
      }
    );

    if (!ok) {
      for (const [issueType, count] of Object.entries(summary.by_type)) {
        if (!Number(count)) continue;
        const matching = explained.filter((i) => i.type === issueType);
        const typeTotal = Number(matching.reduce((s, i) => s + Number(i.amount_ghs || 0), 0).toFixed(2));
        await upsertMemory(
          `reconciliation:issue:${issueType}`,
          "error_signature",
          `${count} ${issueType.replace(/_/g, " ")} discrepancy(ies) totaling GH₵${typeTotal.toFixed(2)} (${hours}h window)`,
          {
            source: "reconciliation_explainer",
            issue_type: issueType,
            count,
            total_ghs: typeTotal,
            window_hours: hours,
            sample: matching.slice(0, 20),
          }
        );
      }
    }
  } catch (err) {
    console.warn("[wallet-reconcile] Failed to persist reconciliation memory:", err);
  }

  if (!ok) {
    await admin.rpc("notify_admins", {
      p_title: "Paystack reconciliation found issues",
      p_message: `${issues.length} item(s) need review: ${Object.entries(summary.by_type).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ")}.`,
      p_link: "/admin/reconciliation",
    });
  }
  return json(summary);
});
