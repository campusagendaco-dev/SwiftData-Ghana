import { normalizePhone, sendPaymentSms } from "./sms.ts";
import { fetchViaDb } from "./db_proxy.ts";
import { log } from "./logger.ts";

declare const Deno: any;

export function isBeneficiaryFailure(
  reason: string | null | undefined,
  network?: string | null,
  orderType?: string | null,
  provider?: string | null
): boolean {
  if (!reason) return false;
  const net = String(network || "").toUpperCase();
  if (network && !net.includes("MTN") && !net.includes("YELLO")) return false;

  const type = String(orderType || "").toLowerCase();
  if (orderType && type !== "data" && type !== "sme") return false;

  const prov = String(provider || "").toLowerCase();
  if (provider && (prov === "korba" || prov.includes("korba"))) return false;

  return /beneficiary|daily.*limit|payee_limit|not_allowed|not allowed|not added|not on|whitelist|unregistered|eligibility/i.test(String(reason));
}

export function isGuestOrder(order: any): boolean {
  if (!order) return false;
  const agentId = order.agent_id;
  const isZeroUuid = agentId === "00000000-0000-0000-0000-000000000000";
  const hasNoAgent = !agentId || isZeroUuid;
  
  const paymentMethod = String(order.payment_method || "").toLowerCase().trim();
  const isDirectGatewayPayment = ["paystack", "momo", "card", "direct_pay", "cash"].includes(paymentMethod);
  
  return hasNoAgent || isDirectGatewayPayment;
}

export interface GuestRefundResult {
  success: boolean;
  refunded: boolean;
  gateway: "paystack" | "manual" | "none";
  reference?: string;
  refundId?: string;
  error?: string;
  carrierSubmitted?: boolean;
}

/**
 * Handles a non-beneficiary failure for a guest order WITHOUT triggering an immediate
 * automatic money deduction. Instead, it:
 * 1. Auto-submits the number to the carrier whitelist queue.
 * 2. Marks the order as eligible for manual on-demand refund when tracked.
 * 3. Sends the dedicated Non-Beneficiary SMS with an order tracking link.
 */
export async function handleGuestBeneficiaryFailure(
  supabaseAdmin: any,
  order: any,
  failureReason: string
): Promise<{ success: boolean; carrierSubmitted: boolean }> {
  const orderId = order.id;
  const customerPhone = normalizePhone(order.customer_phone || order.recipient || order.phone);
  const nowIso = new Date().toISOString();

  // Fresh check from database to prevent overwriting an already fulfilled or active processing order
  if (orderId && supabaseAdmin) {
    const { data: freshOrder } = await supabaseAdmin
      .from("orders")
      .select("id, status, provider_order_id, provider_id")
      .eq("id", orderId)
      .maybeSingle();

    if (freshOrder?.status === "fulfilled" || freshOrder?.status === "completed") {
      console.warn(`[guest-refund] Cannot mark order ${orderId} as non-beneficiary failed: already ${freshOrder.status}`);
      return { success: false, carrierSubmitted: false };
    }

    const hasActiveProviderRef = freshOrder?.provider_order_id &&
      freshOrder.provider_order_id !== "" &&
      freshOrder.provider_order_id !== "failed_api_call" &&
      freshOrder.provider_order_id !== "timeout";

    if (freshOrder?.status === "processing" && (hasActiveProviderRef || (freshOrder.provider_id && freshOrder.provider_order_id !== "failed_api_call"))) {
      console.warn(`[guest-refund] Cannot mark order ${orderId} as non-beneficiary failed: already in transit with provider (${freshOrder.provider_order_id || freshOrder.provider_id})`);
      return { success: false, carrierSubmitted: false };
    }
  }

  // Guard: MTN SME Beneficiary Whitelist ONLY applies to MTN SME Data packages, NEVER for Korba, Airtime, or other carriers
  const net = String(order.network || "").toUpperCase();
  const isMtn = net.includes("MTN") || net.includes("YELLO");
  const orderType = String(order.order_type || "data").toLowerCase();
  const isData = orderType === "data" || orderType === "sme";
  const isKorba = String(order.provider_id || "").toLowerCase().includes("korba") || 
                  order.metadata?.category === "korba" || 
                  order.metadata?.package_category === "korba" || 
                  order.metadata?.is_korba === true ||
                  order.metadata?.provider_type === "korba";

  if (!isMtn || !isData || isKorba) {
    console.log(`[guest-refund] Order ${orderId} is non-MTN, non-SME, or Korba (${order.network || 'unknown'}, ${orderType}). Skipping MTN whitelist logic.`);
    await supabaseAdmin.from("orders").update({
      status: "fulfillment_failed",
      provider_order_id: "failed_api_call",
      failure_reason: failureReason || "Carrier declined transaction for this recipient number.",
      updated_at: nowIso,
    }).eq("id", orderId);
    return { success: true, carrierSubmitted: false };
  }

  console.log(`[guest-refund] Handling guest non-beneficiary failure for order ${orderId} (${customerPhone}). Setting up tracking resolution...`);

  // 1. Update order status and metadata
  const existingMetadata = order.metadata || {};
  const updatedMetadata = {
    ...existingMetadata,
    is_guest_order: true,
    non_beneficiary_failed: true,
    guest_refund_eligible: true,
    in_beneficiary_queue: true,
    carrier_submission_queued_at: nowIso,
  };

  await supabaseAdmin.from("orders").update({
    status: "fulfillment_failed",
    failure_reason: "MTN Beneficiary Error: Recipient line is not registered on carrier whitelist.",
    metadata: updatedMetadata,
    updated_at: nowIso,
  }).eq("id", orderId);

  // 2. Submit number to carrier whitelist (beneficiary_submissions + DataHub)
  let carrierSubmitted = false;
  if (customerPhone) {
    try {
      const cleanDigits = customerPhone.replace(/\D/g, "");
      let localPhone = cleanDigits;
      if (cleanDigits.startsWith("233") && cleanDigits.length === 12) {
        localPhone = "0" + cleanDigits.slice(3);
      } else if (cleanDigits.length === 9) {
        localPhone = "0" + cleanDigits;
      }

      await supabaseAdmin.from("beneficiary_submissions").upsert({
        phone_number: localPhone,
        network: "MTN",
        status: "submitted",
        source: "guest_beneficiary_failure",
        submitted_by: "System Sentinel",
        notes: `Auto-submitted after failed guest order ${orderId.slice(0, 8)}`,
      }, { onConflict: "phone_number" });

      const { data: provider } = await supabaseAdmin
        .from("providers")
        .select("api_key, base_url")
        .eq("handler_type", "datahub")
        .eq("is_active", true)
        .maybeSingle();

      const dhApiKey = Deno.env.get("DATAHUB_API_KEY") || provider?.api_key || "";
      const dhBaseUrl = (Deno.env.get("DATAHUB_BASE_URL") || provider?.base_url || "https://user.datahubgh.com/api/external").trim().replace(/\/+$/, "");
      const submitUrl = dhBaseUrl.endsWith("/submit-numbers")
        ? dhBaseUrl
        : dhBaseUrl.includes("/purchases")
        ? `${dhBaseUrl}/submit-numbers`
        : `${dhBaseUrl}/purchases/submit-numbers`;

      if (dhApiKey) {
        fetchViaDb(supabaseAdmin, submitUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": dhApiKey,
            "Authorization": `Bearer ${dhApiKey}`,
          },
          body: JSON.stringify({ numbers: localPhone }),
          disableFallback: true,
        }, 10).catch((err: any) => console.error("[guest-refund] Background DataHub submit error:", err));
        carrierSubmitted = true;
      }
    } catch (e) {
      console.error("[guest-refund] Carrier submit error:", e);
    }
  }

  // 3. Send Dedicated Non-Beneficiary SMS with Tracking Link
  if (customerPhone) {
    try {
      const trackingUrl = `https://swiftdatagh.shop/order-status?id=${orderId}`;
      const smsMessage = `SwiftData Notice: Your order for ${customerPhone} could not deliver because this recipient number has reached its daily MTN data transfer limit, belongs to an unsupported plan (e.g. corporate SIM), or has promotional messages blocked.\n\n` +
        `Track order or request refund:\n` +
        `${trackingUrl}`;

      await sendPaymentSms(
        supabaseAdmin,
        customerPhone,
        "custom",
        {
          message: smsMessage,
          reason: "Reached daily limit / unsupported plan / promo blocked",
          order_id: orderId,
          reference: order.reference || orderId,
          network: "MTN",
        },
        order.agent_id || undefined
      );
    } catch (smsErr) {
      console.error("[guest-refund] Failed to send non-beneficiary SMS:", smsErr);
    }
  }

  return { success: true, carrierSubmitted };
}

/**
 * Executes a Paystack refund for a guest order when explicitly requested
 * (e.g. user clicks "Request Refund to Mobile Money" on tracking page, or admin clicks "Refund MoMo").
 */
export async function executeGuestBeneficiaryRefund(
  supabaseAdmin: any,
  order: any,
  failureReason: string,
  providedPaystackKey?: string
): Promise<GuestRefundResult> {
  const orderId = order.id;

  // 1. Ground truth check: Fetch fresh order details directly from database
  let currentOrder = order;
  if (orderId && supabaseAdmin) {
    const { data: freshOrder, error: freshErr } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();
    if (!freshErr && freshOrder) {
      currentOrder = freshOrder;
    }
  }

  // 2. SAFETY GUARD: Fulfilled or completed orders CAN NEVER be refunded!
  if (currentOrder.status === "fulfilled" || currentOrder.status === "completed") {
    console.warn(`[guest-refund] REFUND BLOCKED: Order ${orderId} has status '${currentOrder.status}' (already delivered).`);
    return {
      success: false,
      refunded: false,
      gateway: "none",
      error: "Order has already been fulfilled and delivered to recipient. Delivered orders cannot be refunded."
    };
  }

  // 3. SAFETY GUARD: Already refunded orders cannot be double refunded
  if (currentOrder.status === "refunded" || currentOrder.auto_refunded === true) {
    console.warn(`[guest-refund] REFUND BLOCKED: Order ${orderId} is already refunded.`);
    return {
      success: false,
      refunded: false,
      gateway: "none",
      error: "Order has already been refunded."
    };
  }

  // 4. SAFETY GUARD: Orders currently in transit with an upstream wholesale provider API CANNOT be refunded!
  const hasActiveProviderRef = currentOrder.provider_order_id &&
    currentOrder.provider_order_id !== "" &&
    currentOrder.provider_order_id !== "failed_api_call" &&
    currentOrder.provider_order_id !== "timeout";

  if (currentOrder.status === "processing" && (hasActiveProviderRef || (currentOrder.provider_id && currentOrder.provider_order_id !== "failed_api_call"))) {
    console.warn(`[guest-refund] REFUND BLOCKED: Order ${orderId} has already gone through carrier provider API (${currentOrder.provider_order_id || currentOrder.provider_id}) and is processing.`);
    return {
      success: false,
      refunded: false,
      gateway: "none",
      error: "Order has already been submitted to the upstream network provider and is currently processing. Orders that have gone through the API cannot be refunded."
    };
  }

  // 5. SAFETY GUARD: Pending/paid orders that haven't attempted fulfillment yet cannot be refunded on-demand
  if (["pending", "paid", "awaiting_payment"].includes(currentOrder.status)) {
    return {
      success: false,
      refunded: false,
      gateway: "none",
      error: `Order is currently in '${currentOrder.status}' state. It cannot be refunded while awaiting initial processing.`
    };
  }

  // 6. SAFETY GUARD: Wallet orders cannot be refunded via Paystack gateway
  const paymentMethod = String(currentOrder.payment_method || "").toLowerCase().trim();
  if (paymentMethod === "wallet" || paymentMethod === "credit") {
    return {
      success: false,
      refunded: false,
      gateway: "none",
      error: "This order was paid using agent wallet balance. It cannot be refunded via Mobile Money gateway; wallet orders must be refunded to agent wallet."
    };
  }

  const customerPhone = normalizePhone(currentOrder.customer_phone || currentOrder.recipient || currentOrder.phone);
  const orderAmount = Number(currentOrder.amount || 0);

  if (orderAmount <= 0) {
    return {
      success: false,
      refunded: false,
      gateway: "none",
      error: "Order has zero refundable amount."
    };
  }

  // Safely parse order metadata
  let meta: Record<string, any> = {};
  if (typeof currentOrder.metadata === "string") {
    try {
      meta = JSON.parse(currentOrder.metadata || "{}");
    } catch {
      meta = {};
    }
  } else if (currentOrder.metadata && typeof currentOrder.metadata === "object") {
    meta = { ...currentOrder.metadata };
  }

  // Gather candidate Paystack transaction references in order of priority:
  const candidateRefs: string[] = Array.from(new Set([
    meta.paystack_reference,
    meta.trxref,
    meta.reference,
    meta.payment_reference,
    meta.paystack_transaction_id,
    meta.transaction_id,
    currentOrder.payment_reference,
    currentOrder.reference,
    orderId,
  ].map((r) => (r !== null && r !== undefined ? String(r).trim() : ""))
   .filter((r) => r.length > 0 && r !== "failed_api_call" && r !== "timeout")));

  console.log(`[guest-refund] Executing on-demand refund for order ${orderId} (Amount: GHS ${orderAmount}, Candidate Refs: ${candidateRefs.join(", ")})`);

  let paystackKey = Deno.env.get("PAYSTACK_SECRET_KEY") || providedPaystackKey || "";
  if (!paystackKey) {
    try {
      const { data: settings } = await supabaseAdmin
        .from("v_system_settings_with_secrets")
        .select("paystack_secret_key")
        .eq("id", 1)
        .maybeSingle();
      paystackKey = settings?.paystack_secret_key || "";
    } catch (e) {
      console.warn("[guest-refund] Could not fetch paystack_secret_key from DB:", e);
    }
  }

  let refundSuccess = false;
  let refundId = "";
  let refundError = "";
  let gatewayUsed: "paystack" | "manual" | "none" = "none";
  let verifiedPaystackTxId: string | number | null = null;
  let verifiedPaystackRef: string | null = null;
  let verifiedPaystackStatus: string | null = null;

  if (paystackKey && orderAmount > 0 && candidateRefs.length > 0) {
    gatewayUsed = "paystack";

    // 1. Verify candidate references against Paystack to locate the exact transaction ID and status
    for (const cand of candidateRefs) {
      try {
        console.log(`[guest-refund] Verifying candidate reference against Paystack: ${cand}`);
        const verifyRes = await fetchViaDb(supabaseAdmin, `https://api.paystack.co/transaction/verify/${encodeURIComponent(cand)}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${paystackKey}`,
          },
        }, 8);

        const verifyData = await verifyRes.json().catch(() => ({}));
        if (verifyRes.ok && verifyData.status === true && verifyData.data) {
          verifiedPaystackTxId = verifyData.data.id;
          verifiedPaystackRef = verifyData.data.reference;
          verifiedPaystackStatus = verifyData.data.status;
          console.log(`[guest-refund] Found Paystack transaction: ID=${verifiedPaystackTxId}, Ref=${verifiedPaystackRef}, Status=${verifiedPaystackStatus}`);
          break;
        }
      } catch (verErr) {
        console.warn(`[guest-refund] Error verifying candidate ref ${cand} with Paystack:`, verErr);
      }
    }

    // Safety guard: If Paystack returned a non-success transaction status (e.g. abandoned, failed, reversed)
    if (verifiedPaystackStatus && verifiedPaystackStatus !== "success") {
      console.warn(`[guest-refund] REFUND BLOCKED: Paystack transaction ${verifiedPaystackRef} status is '${verifiedPaystackStatus}' (not a successful charge).`);
      return {
        success: false,
        refunded: false,
        gateway: "none",
        error: `Cannot process refund: Payment on Paystack has status '${verifiedPaystackStatus}' (not a completed charge).`
      };
    }

    // Target transaction identifier for Paystack /refund (prefer numerical ID, then ref, then candidate)
    const targetTx = verifiedPaystackTxId || verifiedPaystackRef || candidateRefs[0] || orderId;
    const amountInPesewas = Math.round(orderAmount * 100);
    const refundPayload = {
      transaction: targetTx,
      amount: amountInPesewas,
      currency: "GHS",
      customer_note: `SwiftData: Refund for order ${orderId.slice(0, 8)} - MTN recipient limit / whitelist issue.`,
      merchant_note: `Requested guest refund for order ${orderId} (${customerPhone || "guest"})`,
    };

    try {
      console.log(`[guest-refund] Submitting Paystack refund for transaction '${targetTx}' (Amount: ${amountInPesewas} pesewas)`);
      let response: Response;
      try {
        response = await fetch("https://api.paystack.co/refund", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${paystackKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(refundPayload),
        });
      } catch (directErr) {
        console.warn("[guest-refund] Direct fetch failed, trying via fetchViaDb proxy:", directErr);
        response = await fetchViaDb(supabaseAdmin, "https://api.paystack.co/refund", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${paystackKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(refundPayload),
        }, 10);
      }

      const resData = await response.json().catch(() => ({}));
      console.log(`[guest-refund] Paystack refund response (HTTP ${response.status}):`, resData);

      if (response.ok && resData.status === true) {
        refundSuccess = true;
        refundId = String(resData.data?.id || resData.data?.transaction?.id || "paystack_refunded");
      } else {
        refundError = resData.message || `Paystack refund HTTP ${response.status}`;
        if (/already refunded/i.test(refundError)) {
          refundSuccess = true;
          refundId = "already_refunded";
        }
      }
    } catch (err: any) {
      console.error("[guest-refund] Paystack refund exception:", err);
      refundError = err.message || String(err);
    }
  } else {
    refundError = !paystackKey ? "Paystack API key not configured" : "Invalid order amount or missing payment reference";
  }

  const nowIso = new Date().toISOString();
  const existingMetadata = meta;
  
  const updatedMetadata = {
    ...existingMetadata,
    is_guest_order: true,
    non_beneficiary_failed: true,
    guest_refund_gateway: gatewayUsed,
    guest_refund_status: refundSuccess ? "completed" : "needs_manual_payout",
    guest_refund_id: refundId || null,
    guest_refund_error: refundSuccess ? null : refundError,
    guest_refund_timestamp: nowIso,
    paystack_transaction_id: verifiedPaystackTxId || existingMetadata.paystack_transaction_id || null,
    paystack_reference: verifiedPaystackRef || existingMetadata.paystack_reference || candidateRefs[0] || null,
  };

  const updatePatch: Record<string, any> = {
    metadata: updatedMetadata,
    failure_reason: refundSuccess
      ? `Refund Verified & Completed: GHS ${orderAmount.toFixed(2)} sent to Mobile Money via Paystack.`
      : `MTN Beneficiary Error: Recipient line not on carrier whitelist. Refund queued for manual payout (${refundError || 'unverified'}).`,
    updated_at: nowIso,
  };

  if (refundSuccess) {
    updatePatch.status = "refunded";
    updatePatch.auto_refunded = true;
    updatePatch.refund_amount = orderAmount;
    updatePatch.refund_reason = `Requested refund: MTN number not on beneficiary list. Refunded to Mobile Money via Paystack (Refund ID: ${refundId}).`;
    updatePatch.refunded_at = nowIso;
  }

  await supabaseAdmin.from("orders").update(updatePatch).eq("id", orderId);

  log(supabaseAdmin, {
    level: refundSuccess ? "info" : "warn",
    source: "guest-refund",
    event: refundSuccess ? "order.guest_refunded" : "order.guest_refund_failed",
    message: refundSuccess
      ? `Guest non-beneficiary order ${orderId} refunded GHS ${orderAmount.toFixed(2)} via Paystack.`
      : `Guest non-beneficiary order ${orderId} refund failed (${refundError}). Flagged for manual payout.`,
    order_id: orderId,
    data: {
      order_id: orderId,
      customer_phone: customerPhone,
      amount: orderAmount,
      gateway: gatewayUsed,
      refund_id: refundId,
      refund_error: refundError,
      refund_success: refundSuccess
    }
  });

  // Send Refund Confirmation SMS STRICTLY when refund is verified and complete
  if (customerPhone && refundSuccess) {
    try {
      const trackingUrl = `https://swiftdatagh.shop/order-status?id=${orderId}`;
      const smsRef = verifiedPaystackRef || refundId || candidateRefs[0] || orderId;
      const smsMessage = `SwiftData Alert: GHS ${orderAmount.toFixed(2)} for ${customerPhone} has been refunded to your Mobile Money account via Paystack! Ref: ${String(smsRef).slice(0, 10)}. Track: ${trackingUrl}`;

      await sendPaymentSms(
        supabaseAdmin,
        customerPhone,
        "custom",
        {
          message: smsMessage,
          reason: "Refund completed to Mobile Money",
          amount: orderAmount.toFixed(2),
          network: "MTN",
        },
        currentOrder.agent_id || undefined
      );
    } catch (smsErr) {
      console.error("[guest-refund] Failed to send customer refund SMS:", smsErr);
    }
  }

  return {
    success: refundSuccess,
    refunded: refundSuccess,
    gateway: gatewayUsed,
    reference: verifiedPaystackRef || candidateRefs[0] || orderId,
    refundId: refundId || undefined,
    error: refundError || undefined,
  };
}
