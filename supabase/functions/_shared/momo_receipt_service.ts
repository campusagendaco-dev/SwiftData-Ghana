// MoMo receipt check service for verify-momo-receipt (staff only). Every check is saved in
// momo_receipt_checks so a transaction ID can be spotted again and accepted only once (the
// database enforces that). Accepting records an admin's decision; it credits nothing.

import {
  cleanTransactionId,
  evaluateReceipt,
  normalizeGhPhone,
  parseExtractedReceipt,
  RECEIPT_SYSTEM_PROMPT,
} from "./momo_receipt.ts";

export const MAX_CHECKS_PER_HOUR = 60;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const SERVICE_ROLE_USER_ID = "00000000-0000-0000-0000-000000000000";

type Res = { status: number; body: Record<string, unknown> };
export type ReceiptReader = (system: string, user: string, image: { base64: string; mediaType: string }) => Promise<{ text: string; model: string }>;

export async function checkReceipt(
  db: any,
  input: { adminId: string; image: { base64: string; mediaType: string }; orderId: string | null; expectedAmount: number | null },
  deps: { readReceipt: ReceiptReader; now: Date },
): Promise<Res> {
  if (!input.adminId || input.adminId === SERVICE_ROLE_USER_ID) return { status: 403, body: { error: "Only a signed-in admin can check receipts" } };

  const mediaType = String(input.image.mediaType || "").toLowerCase();
  if (!IMAGE_TYPES.has(mediaType)) return { status: 400, body: { error: "Upload a JPG, PNG or WEBP picture of the receipt" } };
  const base64 = String(input.image.base64 || "").replace(/\s+/g, "");
  const bytes = Math.floor((base64.length * 3) / 4);
  if (!bytes) return { status: 400, body: { error: "The picture is empty" } };
  if (bytes > MAX_IMAGE_BYTES) return { status: 400, body: { error: "The picture is larger than 5 MB" } };

  // Each check is a paid AI image read; keep one admin from using up the shared AI budget.
  const hourAgo = new Date(deps.now.getTime() - 3_600_000).toISOString();
  const { data: recent } = await db.from("momo_receipt_checks").select("id").eq("checked_by", input.adminId).gte("created_at", hourAgo).limit(MAX_CHECKS_PER_HOUR + 1);
  if ((recent || []).length >= MAX_CHECKS_PER_HOUR) {
    return { status: 429, body: { error: `You've checked ${MAX_CHECKS_PER_HOUR} receipts in the last hour. Try again later.` } };
  }

  let order: { id: string; amount: number; created_at: string } | null = null;
  if (input.orderId) {
    const { data } = await db.from("orders").select("id, amount, status, created_at").eq("id", input.orderId).maybeSingle();
    if (!data) return { status: 404, body: { error: "Order not found" } };
    order = { id: data.id, amount: Number(data.amount || 0), created_at: data.created_at };
  }

  const { data: accounts } = await db.from("momo_receiving_accounts").select("phone, account_name").eq("is_active", true);

  const userMsg = [
    "Read this payment receipt and return the JSON described.",
    order ? `It is meant to pay for an order of GH₵${order.amount.toFixed(2)}.` : "",
  ].filter(Boolean).join("\n");
  const ai = await deps.readReceipt(RECEIPT_SYSTEM_PROMPT, userMsg, { base64, mediaType });
  const extracted = parseExtractedReceipt(ai.text);
  const txId = cleanTransactionId(extracted.transaction_id);

  const { data: prior } = txId
    ? await db.from("momo_receipt_checks").select("transaction_id, order_id, decision").eq("transaction_id", txId).limit(50)
    : { data: [] };

  const result = evaluateReceipt({
    extracted,
    orderAmount: order ? order.amount : null,
    expectedAmount: order ? null : input.expectedAmount,
    orderId: order?.id ?? null,
    receivingAccounts: accounts || [],
    priorChecks: prior || [],
    now: deps.now,
  });

  const { data: saved, error } = await db.from("momo_receipt_checks").insert({
    checked_by: input.adminId,
    order_id: order?.id ?? null,
    transaction_id: txId,
    amount: extracted.amount,
    recipient_phone: normalizeGhPhone(extracted.recipient_phone),
    verdict: result.verdict,
    risk_level: result.risk_level,
    flags: result.flags,
    extracted,
    ai_model: ai.model,
    decision: null,
  }).select("id").single();
  if (error) return { status: 500, body: { error: `Check done but not saved: ${error.message}` } };

  return {
    status: 200,
    body: { check_id: saved?.id ?? null, ...result, extracted, order_amount: order?.amount ?? null, expected_amount: order ? null : input.expectedAmount, ai_model: ai.model },
  };
}

export async function decideReceipt(db: any, input: { adminId: string; checkId: string; decision: "accepted" | "rejected" }): Promise<Res> {
  if (!input.adminId || input.adminId === SERVICE_ROLE_USER_ID) return { status: 403, body: { error: "Only a signed-in admin can decide" } };
  if (input.decision !== "accepted" && input.decision !== "rejected") return { status: 400, body: { error: "decision must be accepted or rejected" } };

  const { data, error } = await db
    .from("momo_receipt_checks")
    .update({ decision: input.decision, decided_by: input.adminId, decided_at: new Date().toISOString() })
    .eq("id", input.checkId)
    .is("decision", null)
    .select("id, transaction_id, order_id, verdict")
    .maybeSingle();
  if (error?.code === "23505") return { status: 409, body: { error: "This transaction ID was already accepted on another check" } };
  if (error) return { status: 500, body: { error: error.message } };
  if (!data) return { status: 409, body: { error: "This check was already decided" } };

  await db.from("audit_logs").insert({
    admin_id: input.adminId,
    action: input.decision === "accepted" ? "momo_receipt_accepted" : "momo_receipt_rejected",
    details: { check_id: data.id, transaction_id: data.transaction_id, order_id: data.order_id, verdict: data.verdict },
  });
  return { status: 200, body: { ok: true, decision: input.decision } };
}
