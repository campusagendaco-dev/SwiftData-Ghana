import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

async function verifyKorbaSignature(
  secretKey: string,
  transactionId: string,
  status: string,
  message: string,
  receivedSignature: string
): Promise<boolean> {
  const messageToSign = `${transactionId}:${status}:${message}`;
  
  const keyData = new TextEncoder().encode(secretKey);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const messageData = new TextEncoder().encode(messageToSign);
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const computedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
    
  return computedSignature.toLowerCase() === receivedSignature.toLowerCase();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Parse parameters from query string or request body
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "mandate_creation"; // mandate_creation or debit

  let transactionId = url.searchParams.get("transaction_id") || "";
  let status = (url.searchParams.get("status") || "").toUpperCase();
  let message = url.searchParams.get("message") || "";
  let signature = url.searchParams.get("signature") || "";
  let mandateId = url.searchParams.get("mandate_id") || "";
  let amount = url.searchParams.get("amount") || "";

  if (req.method === "POST") {
    try {
      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = await req.json();
        if (body.transaction_id) transactionId = body.transaction_id;
        if (body.status) status = String(body.status).toUpperCase();
        if (body.message) message = body.message;
        if (body.signature) signature = body.signature;
        if (body.mandate_id) mandateId = body.mandate_id;
        if (body.amount) amount = String(body.amount);
      } else {
        const bodyText = await req.text();
        const params = new URLSearchParams(bodyText);
        if (params.get("transaction_id")) transactionId = params.get("transaction_id") || "";
        if (params.get("status")) status = (params.get("status") || "").toUpperCase();
        if (params.get("message")) message = params.get("message") || "";
        if (params.get("signature")) signature = params.get("signature") || "";
        if (params.get("mandate_id")) mandateId = params.get("mandate_id") || "";
        if (params.get("amount")) amount = params.get("amount") || "";
      }
    } catch (e) {
      console.error("[direct-debit-webhook] Error parsing POST body:", e);
    }
  }

  // Verify HMAC signature to protect from fake callbacks
  const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || "";
  if (KORBA_SECRET_KEY && signature) {
    const isSignatureValid = await verifyKorbaSignature(KORBA_SECRET_KEY, transactionId, status, message, signature);
    if (!isSignatureValid) {
      console.error(`[direct-debit-webhook] Unauthorized callback: signature verification failed. Got signature: ${signature}`);
      return json({ error: "Unauthorized: Signature mismatch" }, 401);
    }
    console.log("[direct-debit-webhook] Signature verified successfully.");
  }

  console.log(`[direct-debit-webhook] Callback received: type=${type}, tx=${transactionId}, status=${status}, msg=${message}, mandate_id=${mandateId}`);

  try {
    if (type === "mandate_creation") {
      if (!transactionId) {
        return json({ error: "Missing transaction_id" }, 400);
      }

      // Find the mandate by transaction_id
      const { data: mandate, error: fetchErr } = await supabaseAdmin
        .from("direct_debit_mandates")
        .select("*")
        .eq("transaction_id", transactionId)
        .maybeSingle();

      if (fetchErr || !mandate) {
        console.error(`[direct-debit-webhook] Mandate not found for transaction_id: ${transactionId}`);
        return json({ error: "Mandate not found" }, 404);
      }

      // If no mandateId was passed directly, try to extract it from the message if it's there
      if (!mandateId && message) {
        // e.g. "Mandate approved: 009" or similar
        const match = message.match(/(?:mandate\s*id|approved|id|mandate)\s*[:\-\s]\s*(\w+)/i);
        if (match && match[1]) {
          mandateId = match[1];
        }
      }

      const isSuccess = status === "SUCCESS";
      const newStatus = isSuccess ? "active" : "failed";

      const updateData: Record<string, any> = {
        status: newStatus,
        updated_at: new Date().toISOString()
      };
      if (mandateId) {
        updateData.mandate_id = mandateId;
      }

      const { error: updateErr } = await supabaseAdmin
        .from("direct_debit_mandates")
        .update(updateData)
        .eq("id", mandate.id);

      if (updateErr) {
        console.error(`[direct-debit-webhook] Mandate update failed:`, updateErr);
        return json({ error: "Failed to update mandate status" }, 500);
      }

      console.log(`[direct-debit-webhook] Mandate ${mandate.id} status updated to ${newStatus}. Mandate ID: ${mandateId || mandate.mandate_id}`);
      return json({ success: true, message: "Mandate status updated" });

    } else if (type === "debit") {
      if (!mandateId) {
        return json({ error: "Missing mandate_id parameter for debit callback" }, 400);
      }

      // Find the mandate by mandate_id
      const { data: mandate, error: fetchErr } = await supabaseAdmin
        .from("direct_debit_mandates")
        .select("*")
        .eq("mandate_id", mandateId)
        .maybeSingle();

      if (fetchErr || !mandate) {
        console.error(`[direct-debit-webhook] Mandate not found for mandate_id: ${mandateId}`);
        return json({ error: "Mandate not found" }, 404);
      }

      const isSuccess = status === "SUCCESS";
      const debitStatus = isSuccess ? "success" : "failed";
      const finalAmount = amount ? Number(amount) : mandate.amount;

      // Log transaction
      const { error: logErr } = await supabaseAdmin
        .from("direct_debit_transactions")
        .insert({
          mandate_id: mandate.id,
          transaction_id: transactionId || `DD-DEBIT-${crypto.randomUUID()}`,
          amount: finalAmount,
          status: debitStatus,
          message: message || (isSuccess ? "Debit successful" : "Debit failed")
        });

      if (logErr) {
        console.error(`[direct-debit-webhook] Failed to log debit transaction:`, logErr);
        return json({ error: "Failed to log transaction" }, 500);
      }

      console.log(`[direct-debit-webhook] Debit logged for mandate ${mandate.id}: status=${debitStatus}, amount=GHS ${finalAmount}`);
      return json({ success: true, message: "Debit transaction logged" });

    } else {
      return json({ error: "Invalid webhook type" }, 400);
    }
  } catch (err: any) {
    console.error("[direct-debit-webhook] Unexpected error:", err);
    return json({ error: err.message }, 200); // Return 200 to prevent retry storms if error is persistent
  }
});
