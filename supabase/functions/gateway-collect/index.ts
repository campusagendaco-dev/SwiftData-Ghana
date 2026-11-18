declare const Deno: any;

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as baseCorsHeaders } from "../_shared/cors.ts";
import {
  calculateCollectionAmounts,
  dispatchGatewayWebhook,
  extractClientIp,
  isAllowedClientIp,
  isAllowedRedirectUrl,
  sha256Hex,
  timingSafeEqual,
  verifyGatewayRequestSignature,
} from "../_shared/gateway-security.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    `${baseCorsHeaders["Access-Control-Allow-Headers"]}, x-swift-timestamp, x-swift-nonce, x-swift-signature, x-idempotency-key`,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function randomHex(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeGhPhone(raw: string): string {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return raw.trim();
}

function isValidGhPhone(phone: string): boolean {
  return /^0[235]\d{8}$/.test(phone);
}

function mapMomoProvider(raw: unknown): "mtn" | "vod" | "tgo" | null {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return null;
  if (s === "MTN" || s === "YELLO") return "mtn";
  if (s === "TELECEL" || s === "VODAFONE" || s === "VOD") return "vod";
  if (s === "AIRTELTIGO" || s === "AT" || s === "TGO" || s === "TIGO" || s === "AIRTEL") return "tgo";
  return null;
}

async function getPaystackSecretKey(supabaseAdmin: any): Promise<string> {
  const envKey = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
  if (envKey) return envKey;
  const { data } = await supabaseAdmin
    .from("v_system_settings_with_secrets")
    .select("paystack_secret_key")
    .eq("id", 1)
    .maybeSingle();
  return String(data?.paystack_secret_key || "").trim();
}

async function paystackRequest(
  paystackSecret: string,
  method: "GET" | "POST",
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: any }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`https://api.paystack.co${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await res.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text.slice(0, 200) };
    }
    return { ok: res.ok && parsed?.status !== false, status: res.status, data: parsed };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return {
      ok: false,
      status: 502,
      data: { message: err?.name === "AbortError" ? "Payment gateway timed out." : String(err?.message || err) },
    };
  }
}

function serializeCollection(c: any) {
  return {
    id: c.id,
    reference: c.reference,
    client_reference: c.client_reference,
    status: c.status,
    currency: c.currency || "GHS",
    channel: c.channel || null,
    amount: {
      base: Number(c.base_amount),
      fee: Number(c.customer_fee),
      platform_fee: Number(c.platform_fee || 0),
      total: Number(c.total_charged),
      net_settlement: Number(c.net_settlement),
    },
    customer_phone: c.customer_phone || null,
    customer_email: c.customer_email || null,
    description: c.description || null,
    failure_reason: c.failure_reason || null,
    paid_at: c.paid_at || null,
    settle_after: c.settle_after || null,
    settled_at: c.settled_at || null,
    created_at: c.created_at,
  };
}

async function getAuthenticatedUser(req: Request, supabaseAdmin: any): Promise<{ userId: string; isAdmin: boolean } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const { data: userRes, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userRes?.user?.id) return null;

  const userId = userRes.user.id;
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  return { userId, isAdmin: Boolean(roles) };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const url = new URL(req.url);
  // Normalize path after /gateway-collect
  const fullPath = url.pathname.replace(/\/+$/, "");
  const fnIdx = fullPath.indexOf("/gateway-collect");
  const subPath = fnIdx >= 0 ? fullPath.slice(fnIdx + "/gateway-collect".length) || "/" : fullPath;

  // =========================================================================
  // 1. INTERNAL / ADMIN / DASHBOARD ROUTES (Supabase JWT or Service Role)
  // =========================================================================

  // POST /v1/merchant/rotate-keys
  if (subPath === "/v1/merchant/rotate-keys" && req.method === "POST") {
    const authUser = await getAuthenticatedUser(req, supabaseAdmin);
    if (!authUser) return json({ success: false, error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const targetMerchantId = typeof body?.merchant_id === "string" ? body.merchant_id : null;
    const rotateApiKey = body?.rotate_api_key !== false;
    const rotateWebhookSecret = body?.rotate_webhook_secret !== false;

    let query = supabaseAdmin.from("gateway_merchants").select("id, user_id, status");
    if (targetMerchantId && authUser.isAdmin) {
      query = query.eq("id", targetMerchantId);
    } else {
      query = query.eq("user_id", authUser.userId);
    }
    const { data: merchant } = await query.maybeSingle();

    if (!merchant) return json({ success: false, error: "Merchant profile not found." }, 404);
    if (!authUser.isAdmin && merchant.user_id !== authUser.userId) {
      return json({ success: false, error: "Forbidden" }, 403);
    }
    if (merchant.status !== "active" && !authUser.isAdmin) {
      return json({ success: false, error: "Your gateway account must be approved by an admin before generating live keys." }, 403);
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    let newSecretKey: string | null = null;
    let newWebhookSecret: string | null = null;

    if (rotateApiKey) {
      newSecretKey = `swft_gsk_live_${randomHex(24)}`;
      updates.secret_key_prefix = `${newSecretKey.slice(0, 18)}...`;
      updates.secret_key_hash = await sha256Hex(newSecretKey);
    }
    if (rotateWebhookSecret) {
      newWebhookSecret = `swft_whsec_${randomHex(24)}`;
      updates.webhook_secret = newWebhookSecret;
    }

    const { error: updErr } = await supabaseAdmin
      .from("gateway_merchants")
      .update(updates)
      .eq("id", merchant.id);

    if (updErr) {
      console.error("[gateway-collect] rotate-keys failed:", updErr);
      return json({ success: false, error: "Could not rotate keys." }, 500);
    }

    return json({
      success: true,
      data: {
        merchant_id: merchant.id,
        secret_key: newSecretKey,
        secret_key_prefix: updates.secret_key_prefix || undefined,
        webhook_secret: newWebhookSecret,
        notice: "Save these secrets securely now. They will not be shown again.",
      },
    });
  }

  // POST /v1/merchant/replay-webhook
  if (subPath === "/v1/merchant/replay-webhook" && req.method === "POST") {
    const authUser = await getAuthenticatedUser(req, supabaseAdmin);
    if (!authUser) return json({ success: false, error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const deliveryId = String(body?.delivery_id || "").trim();
    if (!deliveryId) return json({ success: false, error: "delivery_id is required." }, 400);

    const { data: delivery } = await supabaseAdmin
      .from("gateway_webhook_deliveries")
      .select("id, collection_id, merchant_id, event, payload")
      .eq("id", deliveryId)
      .maybeSingle();

    if (!delivery) return json({ success: false, error: "Webhook delivery not found." }, 404);

    if (!authUser.isAdmin) {
      const { data: owns } = await supabaseAdmin
        .from("gateway_merchants")
        .select("id")
        .eq("id", delivery.merchant_id)
        .eq("user_id", authUser.userId)
        .maybeSingle();
      if (!owns) return json({ success: false, error: "Forbidden" }, 403);
    }

    const result = await dispatchGatewayWebhook(supabaseAdmin, {
      collectionId: delivery.collection_id,
      merchantId: delivery.merchant_id,
      event: delivery.event,
      data: (delivery.payload as any)?.data || {},
      existingDeliveryId: delivery.id,
    });

    return json({ success: result.delivered, data: result });
  }

  // POST /v1/admin/sweep (Service Role or Admin JWT: release matured settlements + retry due webhooks)
  if (subPath === "/v1/admin/sweep" && req.method === "POST") {
    const rawAuth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const isServiceRole = Boolean(SERVICE_ROLE_KEY && rawAuth && timingSafeEqual(rawAuth, SERVICE_ROLE_KEY));
    if (!isServiceRole) {
      const authUser = await getAuthenticatedUser(req, supabaseAdmin);
      if (!authUser?.isAdmin) return json({ success: false, error: "Admin access required." }, 403);
    }

    const { data: sweepRes, error: sweepErr } = await supabaseAdmin.rpc("release_matured_gateway_settlements", {
      p_limit: 100,
    });

    // Notify merchants for newly settled collections
    const settledIds: string[] = Array.isArray(sweepRes?.collection_ids) ? sweepRes.collection_ids : [];
    for (const cid of settledIds) {
      const { data: col } = await supabaseAdmin
        .from("gateway_collections")
        .select("*")
        .eq("id", cid)
        .maybeSingle();
      if (col) {
        await dispatchGatewayWebhook(supabaseAdmin, {
          collectionId: col.id,
          merchantId: col.merchant_id,
          event: "collection.settled",
          data: serializeCollection(col),
        });
      }
    }

    // Retry due webhooks
    const { data: dueDeliveries } = await supabaseAdmin
      .from("gateway_webhook_deliveries")
      .select("id, collection_id, merchant_id, event, payload")
      .eq("status", "pending")
      .lte("next_retry_at", new Date().toISOString())
      .limit(50);

    let retried = 0;
    let deliveredCount = 0;
    for (const d of dueDeliveries || []) {
      retried++;
      const r = await dispatchGatewayWebhook(supabaseAdmin, {
        collectionId: d.collection_id,
        merchantId: d.merchant_id,
        event: d.event,
        data: (d.payload as any)?.data || {},
        existingDeliveryId: d.id,
      });
      if (r.delivered) deliveredCount++;
    }

    return json({
      success: !sweepErr,
      data: {
        settlement_sweep: sweepRes || null,
        webhooks_retried: retried,
        webhooks_delivered: deliveredCount,
      },
    });
  }

  // =========================================================================
  // 2. SERVER-TO-SERVER MERCHANT GATEWAY API AUTHENTICATION
  // =========================================================================
  const authHeader = req.headers.get("Authorization") || "";
  const apiKeyHeader = req.headers.get("X-API-Key") || "";
  const rawSecretKey = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : apiKeyHeader.trim();

  if (!rawSecretKey || !rawSecretKey.startsWith("swft_gsk_live_")) {
    return json(
      { success: false, error: "Missing or invalid gateway secret key. Use Authorization: Bearer swft_gsk_live_..." },
      401,
    );
  }

  const secretHash = await sha256Hex(rawSecretKey);
  const { data: merchant } = await supabaseAdmin
    .from("gateway_merchants")
    .select("*")
    .eq("secret_key_hash", secretHash)
    .maybeSingle();

  if (!merchant) {
    return json({ success: false, error: "Invalid gateway credentials." }, 401);
  }
  if (merchant.status !== "active") {
    return json({ success: false, error: `Merchant gateway is ${merchant.status}.` }, 403);
  }

  // IP Allowlist enforcement
  const clientIp = extractClientIp(req);
  if (!isAllowedClientIp(clientIp, merchant.allowed_ips)) {
    console.warn(`[gateway-collect] Blocked IP ${clientIp} for merchant ${merchant.id}`);
    return json({ success: false, error: "Request IP is not in merchant allowlist." }, 403);
  }

  // Read raw body once for both HMAC verification and JSON parsing
  const rawBody = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();

  // Cryptographic Request Signing + Anti-Replay Protection (mandatory by default)
  if (merchant.require_hmac !== false) {
    if (!merchant.webhook_secret) {
      return json({ success: false, error: "Merchant signing secret is not configured. Rotate keys in dashboard." }, 403);
    }
    const tsHeader = req.headers.get("X-Swift-Timestamp") || "";
    const nonceHeader = req.headers.get("X-Swift-Nonce") || "";
    const sigHeader = req.headers.get("X-Swift-Signature") || "";

    const sigCheck = await verifyGatewayRequestSignature({
      secret: merchant.webhook_secret,
      timestamp: tsHeader,
      nonce: nonceHeader,
      method: req.method,
      path: subPath,
      rawBody,
      providedSignature: sigHeader,
    });

    if (!sigCheck.valid) {
      return json({ success: false, error: sigCheck.reason || "Invalid HMAC signature." }, 401);
    }

    // Consume nonce atomically to prevent replay attacks
    const { data: nonceFresh, error: nonceErr } = await supabaseAdmin.rpc("verify_and_consume_gateway_nonce", {
      p_merchant_id: merchant.id,
      p_nonce: nonceHeader.trim(),
    });
    if (nonceErr || nonceFresh !== true) {
      return json({ success: false, error: "Replay detected: X-Swift-Nonce has already been used." }, 409);
    }
  }

  // Per-merchant rate limit
  const { data: merchantRateOk } = await supabaseAdmin.rpc("check_generic_rate_limit", {
    p_key: `gw_merchant:${merchant.id}`,
    p_rate_limit: Number(merchant.rate_limit_per_min || 30),
  });
  if (merchantRateOk === false) {
    return json({ success: false, error: "Rate limit exceeded. Please slow down." }, 429);
  }

  // =========================================================================
  // 3. GATEWAY COLLECTION ENDPOINTS
  // =========================================================================

  // POST /v1/initialize
  if (subPath === "/v1/initialize" && req.method === "POST") {
    let payload: any = null;
    try {
      payload = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      payload = null;
    }
    if (!payload || typeof payload !== "object") {
      return json({ success: false, error: "Invalid JSON body." }, 400);
    }

    const clientRef = String(
      payload.client_reference || payload.reference || req.headers.get("X-Idempotency-Key") || "",
    ).trim();
    if (!clientRef || clientRef.length > 100) {
      return json({ success: false, error: "client_reference is required (1-100 characters)." }, 400);
    }

    // Idempotency check
    const { data: existingCol } = await supabaseAdmin
      .from("gateway_collections")
      .select("*")
      .eq("merchant_id", merchant.id)
      .eq("client_reference", clientRef)
      .maybeSingle();

    if (existingCol) {
      return json(
        {
          success: false,
          error: "A collection with this client_reference already exists.",
          data: serializeCollection(existingCol),
        },
        409,
      );
    }

    const baseAmountNum = Number(payload.amount);
    if (!Number.isFinite(baseAmountNum) || baseAmountNum < 1) {
      return json({ success: false, error: "amount must be a number >= GHS 1.00." }, 400);
    }

    // Atomic daily/monthly/per-tx volume cap check
    const { data: volCheck, error: volErr } = await supabaseAdmin.rpc("check_gateway_volume_limits", {
      p_merchant_id: merchant.id,
      p_amount: baseAmountNum,
    });
    if (volErr || !volCheck?.allowed) {
      return json(
        {
          success: false,
          error: volCheck?.reason || "Collection limit exceeded.",
          limits: volCheck || undefined,
        },
        403,
      );
    }

    // Payment mode: Direct MoMo STK Push OR Hosted Checkout Redirect
    const paymentPhoneRaw = String(payload.payment_phone || payload.customer_phone || "").trim();
    const paymentPhone = paymentPhoneRaw ? normalizeGhPhone(paymentPhoneRaw) : "";
    if (paymentPhone && !isValidGhPhone(paymentPhone)) {
      return json({ success: false, error: "payment_phone must be a valid Ghana mobile number (e.g. 0241234567)." }, 400);
    }
    const momoProvider = mapMomoProvider(payload.payment_network);
    if (payload.payment_network && !momoProvider) {
      return json({ success: false, error: "payment_network must be MTN, TELECEL, or AIRTELTIGO." }, 400);
    }
    const usePrompt = Boolean(paymentPhone && momoProvider);

    let redirectUrl = "";
    if (payload.redirect_url || payload.callback_url) {
      const candidate = String(payload.redirect_url || payload.callback_url).trim();
      if (!isAllowedRedirectUrl(candidate, merchant.allowed_domains || [])) {
        return json(
          {
            success: false,
            error: "redirect_url must be HTTPS and belong to one of your approved allowed_domains.",
          },
          400,
        );
      }
      redirectUrl = candidate;
    }

    if (!usePrompt && !redirectUrl) {
      return json(
        {
          success: false,
          error: "Provide payment_phone + payment_network for a MoMo prompt, or redirect_url (matching allowed_domains) for hosted checkout.",
        },
        400,
      );
    }

    // Per-phone anti-prompt-bombing velocity limit
    if (paymentPhone) {
      const { data: phoneOk } = await supabaseAdmin.rpc("check_generic_rate_limit", {
        p_key: `gw_phone:${paymentPhone}`,
        p_rate_limit: 2,
      });
      if (phoneOk === false) {
        return json(
          { success: false, error: "A payment prompt was sent to this phone number recently. Please wait a minute." },
          429,
        );
      }
    }

    // Resolve server-side fee rate (customer pays fee)
    let feePercent = merchant.fee_percent != null ? Number(merchant.fee_percent) : NaN;
    if (!Number.isFinite(feePercent)) {
      const { data: sysSettings } = await supabaseAdmin
        .from("system_settings")
        .select("paystack_deposit_fee_percent")
        .eq("id", 1)
        .maybeSingle();
      feePercent = Number(sysSettings?.paystack_deposit_fee_percent ?? 3);
    }

    const amounts = calculateCollectionAmounts({
      baseAmount: baseAmountNum,
      feePercent,
      platformFeePercent: Number(merchant.platform_fee_percent || 0),
    });

    const reference = `SWFT_COL_${crypto.randomUUID()}`;
    const rawEmail = String(payload.customer_email || "").trim();
    const customerEmail =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) && rawEmail.length <= 120
        ? rawEmail
        : `${paymentPhone || "customer"}.${reference.slice(-8)}@pay.swiftdatagh.shop`;

    const description = String(payload.description || `Payment to ${merchant.business_name}`).slice(0, 140);
    const customMeta =
      payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
        ? payload.metadata
        : {};

    const allowedChannels: string[] =
      Array.isArray(merchant.allowed_channels) && merchant.allowed_channels.length > 0
        ? merchant.allowed_channels
        : ["mobile_money"];

    const { data: insertedCol, error: insErr } = await supabaseAdmin
      .from("gateway_collections")
      .insert({
        merchant_id: merchant.id,
        user_id: merchant.user_id,
        reference,
        client_reference: clientRef,
        base_amount: amounts.baseAmount,
        customer_fee: amounts.customerFee,
        platform_fee: amounts.platformFee,
        total_charged: amounts.totalCharged,
        net_settlement: amounts.netSettlement,
        currency: "GHS",
        channel: usePrompt ? "mobile_money" : null,
        customer_phone: paymentPhone || null,
        customer_email: customerEmail,
        description,
        redirect_url: redirectUrl || null,
        metadata: customMeta,
        status: "pending",
      })
      .select("*")
      .single();

    if (insErr || !insertedCol) {
      console.error("[gateway-collect] insert failed:", insErr);
      return json({ success: false, error: "Could not initialize collection." }, 500);
    }

    const paystackSecret = await getPaystackSecretKey(supabaseAdmin);
    if (!paystackSecret) {
      await supabaseAdmin
        .from("gateway_collections")
        .update({ status: "failed", failure_reason: "Payment gateway credentials unavailable" })
        .eq("id", insertedCol.id);
      return json({ success: false, error: "Payment gateway temporarily unavailable." }, 503);
    }

    const paystackMetadata = {
      gateway_collection: true,
      collection_id: insertedCol.id,
      merchant_id: merchant.id,
      merchant_user_id: merchant.user_id,
      client_reference: clientRef,
      custom_fields: [
        { display_name: "Merchant", variable_name: "merchant", value: merchant.business_name },
        { display_name: "Description", variable_name: "description", value: description },
      ],
    };

    const amountPesewas = Math.round(amounts.totalCharged * 100);
    const psRes = usePrompt
      ? await paystackRequest(paystackSecret, "POST", "/charge", {
          email: customerEmail,
          amount: amountPesewas,
          currency: "GHS",
          reference,
          metadata: paystackMetadata,
          mobile_money: { phone: paymentPhone, provider: momoProvider },
        })
      : await paystackRequest(paystackSecret, "POST", "/transaction/initialize", {
          email: customerEmail,
          amount: amountPesewas,
          currency: "GHS",
          reference,
          callback_url: redirectUrl,
          channels: allowedChannels,
          metadata: paystackMetadata,
        });

    if (!psRes.ok) {
      const reason = String(psRes.data?.message || "Payment gateway rejected the request.").slice(0, 300);
      await supabaseAdmin
        .from("gateway_collections")
        .update({ status: "failed", failure_reason: reason, updated_at: new Date().toISOString() })
        .eq("id", insertedCol.id);
      return json({ success: false, error: reason, reference }, 502);
    }

    const chargeStatus = String(psRes.data?.data?.status || "");
    const nextAction = !usePrompt
      ? "redirect"
      : chargeStatus === "send_otp"
        ? "submit_otp"
        : chargeStatus === "success"
          ? "none"
          : "approve_on_phone";

    return json(
      {
        success: true,
        data: {
          ...serializeCollection(insertedCol),
          next_action: nextAction,
          authorization_url: usePrompt ? null : psRes.data?.data?.authorization_url || null,
          access_code: usePrompt ? null : psRes.data?.data?.access_code || null,
          message: usePrompt
            ? psRes.data?.data?.display_text ||
              psRes.data?.data?.otp_message ||
              "A Mobile Money prompt has been sent to the customer's phone."
            : "Redirect the customer to authorization_url to complete payment.",
        },
      },
      201,
    );
  }

  // POST /v1/submit-otp
  if (subPath === "/v1/submit-otp" && req.method === "POST") {
    let payload: any = null;
    try {
      payload = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      payload = null;
    }
    const ref = String(payload?.reference || payload?.client_reference || "").trim();
    const otp = String(payload?.otp || "").trim();
    if (!ref || !/^\d{4,8}$/.test(otp)) {
      return json({ success: false, error: "reference and a 4-8 digit otp are required." }, 400);
    }

    const { data: col } = await supabaseAdmin
      .from("gateway_collections")
      .select("*")
      .eq("merchant_id", merchant.id)
      .or(`reference.eq.${ref},client_reference.eq.${ref}`)
      .maybeSingle();

    if (!col) return json({ success: false, error: "Collection not found." }, 404);
    if (col.status !== "pending") {
      return json({ success: false, error: `Collection is already ${col.status}.`, data: serializeCollection(col) }, 409);
    }

    const paystackSecret = await getPaystackSecretKey(supabaseAdmin);
    const psRes = await paystackRequest(paystackSecret, "POST", "/charge/submit_otp", {
      reference: col.reference,
      otp,
    });
    if (!psRes.ok) {
      return json({ success: false, error: psRes.data?.message || "OTP verification failed." }, 400);
    }

    return json({
      success: true,
      data: {
        reference: col.reference,
        client_reference: col.client_reference,
        gateway_status: psRes.data?.data?.status || "pending",
        message: psRes.data?.data?.display_text || "OTP submitted. Ask customer to approve prompt if required.",
      },
    });
  }

  // GET /v1/status/:reference  OR  POST /v1/verify
  if (
    (req.method === "GET" && subPath.startsWith("/v1/status/")) ||
    (req.method === "POST" && subPath === "/v1/verify")
  ) {
    let ref = "";
    if (req.method === "GET") {
      ref = decodeURIComponent(subPath.slice("/v1/status/".length)).trim();
    } else {
      let payload: any = null;
      try {
        payload = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        payload = null;
      }
      ref = String(payload?.reference || payload?.client_reference || "").trim();
    }
    if (!ref) return json({ success: false, error: "reference is required." }, 400);

    const { data: col } = await supabaseAdmin
      .from("gateway_collections")
      .select("*")
      .eq("merchant_id", merchant.id)
      .or(`reference.eq.${ref},client_reference.eq.${ref}`)
      .maybeSingle();

    if (!col) return json({ success: false, error: "Collection not found." }, 404);

    // If still pending, perform live outbound verification against Paystack
    if (col.status === "pending") {
      const paystackSecret = await getPaystackSecretKey(supabaseAdmin);
      if (paystackSecret) {
        const psVerify = await paystackRequest(
          paystackSecret,
          "GET",
          `/transaction/verify/${encodeURIComponent(col.reference)}`,
        );
        const psStatus = String(psVerify.data?.data?.status || "").toLowerCase();
        const psCurrency = String(psVerify.data?.data?.currency || "").toUpperCase();

        if (psVerify.ok && psStatus === "success" && psCurrency === "GHS") {
          const paidGhs = Number(psVerify.data?.data?.amount || 0) / 100;
          const psFeeGhs = Number(psVerify.data?.data?.fees || 0) / 100;
          const psChannel = String(psVerify.data?.data?.channel || "mobile_money");

          const { data: settleRes } = await supabaseAdmin.rpc("settle_gateway_collection", {
            p_reference: col.reference,
            p_paid_amount: paidGhs,
            p_paystack_fee: psFeeGhs,
            p_channel: psChannel,
          });

          if (settleRes?.success && !settleRes?.duplicate) {
            const { data: refreshed } = await supabaseAdmin
              .from("gateway_collections")
              .select("*")
              .eq("id", col.id)
              .maybeSingle();
            if (refreshed) {
              await dispatchGatewayWebhook(supabaseAdmin, {
                collectionId: refreshed.id,
                merchantId: refreshed.merchant_id,
                event: refreshed.status === "settled" ? "collection.settled" : "collection.success",
                data: serializeCollection(refreshed),
              });
              return json({ success: true, data: serializeCollection(refreshed) });
            }
          }
        } else if (psVerify.ok && (psStatus === "failed" || psStatus === "abandoned")) {
          const reason = String(psVerify.data?.data?.gateway_response || psStatus).slice(0, 300);
          await supabaseAdmin
            .from("gateway_collections")
            .update({ status: "failed", failure_reason: reason, updated_at: new Date().toISOString() })
            .eq("id", col.id)
            .eq("status", "pending");
          const { data: refreshed } = await supabaseAdmin
            .from("gateway_collections")
            .select("*")
            .eq("id", col.id)
            .maybeSingle();
          return json({ success: true, data: serializeCollection(refreshed || col) });
        }
      }
    }

    return json({ success: true, data: serializeCollection(col) });
  }

  // GET /v1/collections
  if (subPath === "/v1/collections" && req.method === "GET") {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 25)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    const statusFilter = url.searchParams.get("status")?.trim();

    let query = supabaseAdmin
      .from("gateway_collections")
      .select("*", { count: "exact" })
      .eq("merchant_id", merchant.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (statusFilter) query = query.eq("status", statusFilter);

    const { data: rows, count, error } = await query;
    if (error) return json({ success: false, error: "Could not fetch collections." }, 500);

    return json({
      success: true,
      data: (rows || []).map(serializeCollection),
      pagination: { total: count ?? 0, limit, offset },
    });
  }

  return json({ success: false, error: `Unknown endpoint: ${req.method} ${subPath}` }, 404);
});
