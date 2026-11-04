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
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";

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

  const issues: { type: string; order_id: string; detail: string }[] = [];
  const nonUuidRefs = [...paidByOrder.keys()].filter((id) => !uuidRe.test(id));
  for (const ref of nonUuidRefs) issues.push({ type: "paid_without_order", order_id: ref, detail: `GH₵${paidByOrder.get(ref)!.toFixed(2)} paid, reference is not an order id` });
  for (const id of orderIds) {
    const o = orders.get(id);
    const paid = paidByOrder.get(id) || 0;
    if (!o) {
      issues.push({ type: "paid_without_order", order_id: id, detail: `GH₵${paid.toFixed(2)} paid, no order found` });
      continue;
    }
    if (o.order_type === "wallet_topup" && o.status !== "fulfilled") {
      issues.push({ type: "paid_not_credited", order_id: id, detail: `GH₵${paid.toFixed(2)} paid, top-up status is ${o.status}` });
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
        issues.push({ type: "credited_without_payment", order_id: id, detail: `GH₵${credited.toFixed(2)} credited, no successful Paystack payment in the last ${hours}h` });
      } else if (credited > paid + 0.01) {
        issues.push({ type: "credit_exceeds_payment", order_id: id, detail: `GH₵${credited.toFixed(2)} credited, GH₵${paid.toFixed(2)} paid` });
      }
    }
  }

  const ok = issues.length === 0;
  const summary = {
    ok,
    window_hours: hours,
    paystack_transactions: txs.length,
    paystack_total: Number([...paidByOrder.values()].reduce((s, v) => s + v, 0).toFixed(2)),
    topup_credits_checked: creditedByOrder.size,
    issues: issues.length,
    by_type: issues.reduce((m: Record<string, number>, i) => ((m[i.type] = (m[i.type] || 0) + 1), m), {}),
  };

  await admin.from("wallet_reconciliation_runs").insert({
    kind: "paystack",
    ok,
    issues: issues.length,
    details: { ...summary, sample: issues.slice(0, 100) },
  });
  if (!ok) {
    await admin.rpc("notify_admins", {
      p_title: "Paystack reconciliation found issues",
      p_message: `${issues.length} item(s) need review: ${Object.entries(summary.by_type).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ")}.`,
      p_link: "/admin/wallet-ledger",
    });
  }
  return json(summary);
});
