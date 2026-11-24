import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callAiAgent } from "../_shared/ai.ts";
import { timingSafeEqual } from "../_shared/gateway-security.ts";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function parseBase64Input(
  rawBase64: string,
  fallbackMime = "image/jpeg"
): { base64: string; mediaType: string } {
  const trimmed = rawBase64.trim();
  const dataUriMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (dataUriMatch) {
    return {
      mediaType: dataUriMatch[1].toLowerCase(),
      base64: dataUriMatch[2].replace(/\s+/g, ""),
    };
  }
  return {
    mediaType: fallbackMime,
    base64: trimmed.replace(/\s+/g, ""),
  };
}

async function fetchImageAsBase64(imageUrl: string): Promise<{ base64: string; mediaType: string }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    throw new Error("Invalid image_url provided");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("image_url must use https://");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(parsedUrl.toString(), { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Failed to fetch receipt image (HTTP ${res.status})`);
    }
    const contentType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) {
      throw new Error(`Unsupported content-type for receipt: ${contentType}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) {
      throw new Error("Receipt image is empty");
    }
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("Receipt image exceeds 10MB limit");
    }
    return {
      base64: uint8ArrayToBase64(buf),
      mediaType: contentType,
    };
  } finally {
    clearTimeout(timeout);
  }
}

interface AuthResult {
  ok: boolean;
  userId?: string;
  isAdmin?: boolean;
  error?: string;
  status?: number;
}

async function authenticateUserOrAdmin(req: Request, supabaseAdmin: any): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  const userToken = req.headers.get("x-user-access-token");
  const token = userToken || authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return { ok: false, error: "Unauthorized: Missing authentication token", status: 401 };
  }

  const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (serviceRoleKey && timingSafeEqual(token, serviceRoleKey)) {
    return { ok: true, userId: "service-role", isAdmin: true };
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return { ok: false, error: "Unauthorized: Invalid session token", status: 401 };
    }

    const userId = data.user.id;
    let isAdmin = false;
    try {
      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .limit(1);
      isAdmin = Array.isArray(roles) && roles.length > 0;
    } catch {
      isAdmin = false;
    }

    return { ok: true, userId, isAdmin };
  } catch (err) {
    console.error("[verify-momo-receipt] Auth error:", err);
    return { ok: false, error: "Unauthorized", status: 401 };
  }
}

interface ExtractedReceipt {
  is_momo_receipt: boolean;
  provider: string;
  transaction_id: string | null;
  amount: number | null;
  currency: string | null;
  sender_name: string | null;
  sender_phone: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  timestamp: string | null;
  status: string;
  reference: string | null;
  tampering_signals: string[];
  confidence: number;
  visual_notes: string;
}

function parseExtractedReceipt(rawText: string): ExtractedReceipt {
  const fallback: ExtractedReceipt = {
    is_momo_receipt: false,
    provider: "Unknown",
    transaction_id: null,
    amount: null,
    currency: null,
    sender_name: null,
    sender_phone: null,
    recipient_name: null,
    recipient_phone: null,
    timestamp: null,
    status: "unknown",
    reference: null,
    tampering_signals: [],
    confidence: 0,
    visual_notes: "Unable to parse AI vision response.",
  };

  try {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return fallback;
    const obj = JSON.parse(rawText.slice(start, end + 1));

    const parsedAmount =
      obj.amount === null || obj.amount === undefined || obj.amount === ""
        ? null
        : Number(String(obj.amount).replace(/[^0-9.-]/g, ""));

    return {
      is_momo_receipt: Boolean(obj.is_momo_receipt),
      provider: String(obj.provider || "Unknown"),
      transaction_id: obj.transaction_id ? String(obj.transaction_id).trim() : null,
      amount: parsedAmount !== null && Number.isFinite(parsedAmount) ? parsedAmount : null,
      currency: obj.currency ? String(obj.currency).trim().toUpperCase() : "GHS",
      sender_name: obj.sender_name ? String(obj.sender_name).trim() : null,
      sender_phone: obj.sender_phone ? String(obj.sender_phone).trim() : null,
      recipient_name: obj.recipient_name ? String(obj.recipient_name).trim() : null,
      recipient_phone: obj.recipient_phone ? String(obj.recipient_phone).trim() : null,
      timestamp: obj.timestamp ? String(obj.timestamp).trim() : null,
      status: String(obj.status || "unknown").toLowerCase(),
      reference: obj.reference ? String(obj.reference).trim() : null,
      tampering_signals: Array.isArray(obj.tampering_signals)
        ? obj.tampering_signals.map((s: unknown) => String(s).trim()).filter(Boolean)
        : [],
      confidence: Number.isFinite(Number(obj.confidence)) ? Math.max(0, Math.min(1, Number(obj.confidence))) : 0.5,
      visual_notes: String(obj.visual_notes || ""),
    };
  } catch {
    return fallback;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Server configuration missing" }, 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const auth = await authenticateUserOrAdmin(req, supabaseAdmin);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error || "Unauthorized" }, auth.status || 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      image_url,
      image_base64,
      image_media_type,
      order_id,
      expected_amount,
    } = body;

    if (!image_url && !image_base64) {
      return jsonResponse({ error: "Either image_url or image_base64 is required" }, 400);
    }

    // 1. Optional order lookup & ownership check
    let targetOrder: any = null;
    if (order_id) {
      const { data: orderRow, error: orderErr } = await supabaseAdmin
        .from("orders")
        .select("id, agent_id, amount, status, customer_phone, payment_method, paystack_verified_amount, created_at, metadata")
        .eq("id", String(order_id))
        .maybeSingle();

      if (orderErr) {
        console.error("[verify-momo-receipt] Order lookup failed:", orderErr.message);
        return jsonResponse({ error: "Failed to lookup order" }, 500);
      }
      if (!orderRow) {
        return jsonResponse({ error: "Order not found" }, 404);
      }
      if (!auth.isAdmin && orderRow.agent_id !== auth.userId) {
        return jsonResponse({ error: "Forbidden: You do not have access to this order" }, 403);
      }
      targetOrder = orderRow;
    }

    // 2. Load image bytes as base64
    let imageBase64 = "";
    let imageMediaType = String(image_media_type || "image/jpeg");
    try {
      if (image_base64) {
        const parsed = parseBase64Input(String(image_base64), imageMediaType);
        imageBase64 = parsed.base64;
        imageMediaType = parsed.mediaType;
      } else {
        const fetched = await fetchImageAsBase64(String(image_url));
        imageBase64 = fetched.base64;
        imageMediaType = fetched.mediaType;
      }
    } catch (imgErr: any) {
      return jsonResponse({ error: imgErr?.message || "Invalid receipt image" }, 400);
    }

    // 3. Extract MoMo receipt fields & tampering signals via OpenAI Vision (gpt-4o-mini)
    const systemPrompt = `You are a forensic Ghanaian Mobile Money (MTN MoMo, Telecel Cash / Vodafone Cash, AirtelTigo Money / AT Money) receipt verification expert.
Inspect the provided screenshot/photo carefully and return ONLY a strict JSON object with:
{
  "is_momo_receipt": boolean,
  "provider": "MTN MoMo" | "Telecel Cash" | "AirtelTigo Money" | "Bank Transfer" | "Unknown",
  "transaction_id": string | null,
  "amount": number | null,
  "currency": "GHS" | string | null,
  "sender_name": string | null,
  "sender_phone": string | null,
  "recipient_name": string | null,
  "recipient_phone": string | null,
  "timestamp": string | null,
  "status": "successful" | "pending" | "failed" | "unknown",
  "reference": string | null,
  "tampering_signals": string[],
  "confidence": number (0.0 to 1.0),
  "visual_notes": string
}

Forensic tampering checks to report in tampering_signals (empty array if clean):
- Font mismatches, inconsistent weight/spacing, or misaligned text on the amount, date, or transaction ID
- Blurred, smudged, cloned, or mismatched background patches behind edited numbers
- Cropped-out transaction ID, cropped status banner, or suspicious overlays
- Screenshot of a non-payment confirmation (e.g. balance screen, USSD prompt before approval, or pending/failed alert)
- Non-GHS currency or mathematically inconsistent fee/balance math if visible`;

    const userMessage = [
      "Analyze this payment receipt image and extract all MoMo transaction fields plus any tampering or fraud indicators as JSON.",
      expected_amount !== undefined && expected_amount !== null ? `Expected amount (GHS): ${Number(expected_amount)}` : "",
      targetOrder ? `Order amount (GHS): ${Number(targetOrder.amount)}` : "",
    ].filter(Boolean).join("\n");

    const aiRes = await callAiAgent(
      supabaseAdmin,
      "receipt_verifier",
      systemPrompt,
      userMessage,
      900,
      {
        imageBase64,
        imageMediaType,
        forceModel: "gpt-4o-mini",
        responseJson: true,
      }
    );

    const extracted = parseExtractedReceipt(aiRes.text);
    const fraudFlags: string[] = [];

    // 4. Fraud & consistency checks
    if (!extracted.is_momo_receipt) {
      fraudFlags.push("NOT_A_MOMO_RECEIPT: Image does not appear to be a valid Mobile Money payment receipt.");
    }

    if (extracted.status === "failed" || extracted.status === "pending") {
      fraudFlags.push(`PAYMENT_NOT_SUCCESSFUL: Receipt status is "${extracted.status}".`);
    }

    if (!extracted.transaction_id) {
      fraudFlags.push("MISSING_TRANSACTION_ID: Could not extract a MoMo transaction ID from the receipt.");
    }

    if (extracted.tampering_signals.length > 0) {
      for (const sig of extracted.tampering_signals) {
        fraudFlags.push(`TAMPERING_SIGNAL: ${sig}`);
      }
    }

    if (extracted.confidence < 0.6) {
      fraudFlags.push(`LOW_CONFIDENCE: Extraction confidence is ${(extracted.confidence * 100).toFixed(0)}%.`);
    }

    // 5. Expected amount cross-check
    const targetAmount =
      expected_amount !== undefined && expected_amount !== null && Number.isFinite(Number(expected_amount))
        ? Number(expected_amount)
        : targetOrder
        ? Number(targetOrder.amount)
        : null;

    if (targetAmount !== null && targetAmount > 0) {
      if (extracted.amount === null) {
        fraudFlags.push(`MISSING_AMOUNT: Expected GH₵${targetAmount.toFixed(2)}, but amount could not be read.`);
      } else {
        const diff = Math.abs(extracted.amount - targetAmount);
        if (diff > 0.05) {
          const direction = extracted.amount < targetAmount ? "underpayment" : "overpayment";
          fraudFlags.push(
            `AMOUNT_MISMATCH: Receipt shows GH₵${extracted.amount.toFixed(2)} vs expected GH₵${targetAmount.toFixed(2)} (${direction}).`
          );
        }
      }
    }

    // 6. Cross-check `orders` for duplicate / reused MoMo transaction IDs
    const duplicateOrderIds: string[] = [];
    if (extracted.transaction_id) {
      const cleanTxId = extracted.transaction_id.replace(/[^A-Za-z0-9_-]/g, "");
      if (cleanTxId.length >= 6) {
        try {
          let dupQuery = supabaseAdmin
            .from("orders")
            .select("id, status, amount, created_at, customer_phone")
            .or(
              [
                `metadata->>momo_transaction_id.eq.${cleanTxId}`,
                `metadata->>transaction_id.eq.${cleanTxId}`,
                `metadata->>client_reference.eq.${cleanTxId}`,
                `metadata->>momo_ref.eq.${cleanTxId}`,
              ].join(",")
            )
            .limit(5);

          if (targetOrder?.id) {
            dupQuery = dupQuery.neq("id", targetOrder.id);
          }

          const { data: dupOrders, error: dupErr } = await dupQuery;
          if (dupErr) {
            console.warn("[verify-momo-receipt] Duplicate order check error:", dupErr.message);
          } else if (Array.isArray(dupOrders) && dupOrders.length > 0) {
            for (const o of dupOrders) {
              duplicateOrderIds.push(String(o.id));
            }
            fraudFlags.push(
              `DUPLICATE_TRANSACTION_ID: Transaction ID "${cleanTxId}" was already used on order(s): ${duplicateOrderIds.join(", ")}.`
            );
          }
        } catch (dupCheckErr) {
          console.warn("[verify-momo-receipt] Duplicate check exception:", dupCheckErr);
        }
      }
    }

    // 7. Compute risk level & verification verdict
    const hasHighRiskFlag = fraudFlags.some(
      (f) =>
        f.startsWith("DUPLICATE_TRANSACTION_ID") ||
        f.startsWith("NOT_A_MOMO_RECEIPT") ||
        f.startsWith("PAYMENT_NOT_SUCCESSFUL") ||
        f.startsWith("TAMPERING_SIGNAL") ||
        f.startsWith("AMOUNT_MISMATCH")
    );

    const risk_level: "low" | "medium" | "high" = hasHighRiskFlag
      ? "high"
      : fraudFlags.length > 0
      ? "medium"
      : "low";

    const verified =
      risk_level === "low" &&
      fraudFlags.length === 0 &&
      extracted.is_momo_receipt &&
      Boolean(extracted.transaction_id);

    const summary = verified
      ? `Verified ${extracted.provider} receipt (${extracted.transaction_id}) for GH₵${extracted.amount !== null ? extracted.amount.toFixed(2) : "N/A"}. No tampering or duplicate transaction IDs detected.`
      : `Receipt flagged (${risk_level.toUpperCase()} risk) with ${fraudFlags.length} issue(s): ${fraudFlags[0] || "Manual review required."}`;

    return jsonResponse({
      verified,
      risk_level,
      extracted,
      fraud_flags: fraudFlags,
      summary,
      duplicate_order_ids: duplicateOrderIds,
      order_id: targetOrder?.id || order_id || null,
      expected_amount: targetAmount,
      ai_provider: aiRes.provider,
      ai_model: aiRes.model,
    });
  } catch (error: any) {
    console.error("[verify-momo-receipt] Error:", error);
    return jsonResponse({ error: "Failed to verify MoMo receipt" }, 500);
  }
});
