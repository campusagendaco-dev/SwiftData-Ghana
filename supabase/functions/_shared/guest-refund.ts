import { normalizePhone, sendPaymentSms } from "./sms.ts";
import { fetchViaDb } from "./db_proxy.ts";
import { log } from "./logger.ts";

declare const Deno: any;

export function isBeneficiaryFailure(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return /beneficiary|payee|limit|not_allowed|not allowed|not added|not on|whitelist|unregistered|recipient/i.test(String(reason));
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
      const smsMessage = `SwiftData Notice: Your order for ${customerPhone} could not deliver because this number is not on the MTN beneficiary list.\n\n` +
        `We have queued your number for carrier approval. Track order or request refund:\n` +
        `${trackingUrl}`;

      await sendPaymentSms(
        supabaseAdmin,
        customerPhone,
        "custom",
        {
          message: smsMessage,
          reason: "Not on MTN beneficiary list",
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
  const customerPhone = normalizePhone(order.customer_phone || order.recipient || order.phone);
  const orderAmount = Number(order.amount || 0);
  const targetRef = order.payment_reference || order.reference || orderId;

  console.log(`[guest-refund] Executing on-demand refund for order ${orderId} (Amount: GHS ${orderAmount}, Ref: ${targetRef})`);

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

  if (paystackKey && orderAmount > 0 && targetRef) {
    try {
      gatewayUsed = "paystack";
      const amountInPesewas = Math.round(orderAmount * 100);
      const refundPayload = {
        transaction: targetRef,
        amount: amountInPesewas,
        currency: "GHS",
        customer_note: `SwiftData: Refund for order ${orderId.slice(0, 8)} - recipient number not on MTN beneficiary list.`,
        merchant_note: `Requested refund for non-beneficiary guest order ${orderId}`,
      };

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

      if (response.ok && resData.status) {
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
  const existingMetadata = order.metadata || {};
  
  const updatedMetadata = {
    ...existingMetadata,
    is_guest_order: true,
    non_beneficiary_failed: true,
    guest_refund_gateway: gatewayUsed,
    guest_refund_status: refundSuccess ? "completed" : "needs_manual_payout",
    guest_refund_id: refundId || null,
    guest_refund_error: refundSuccess ? null : refundError,
    guest_refund_timestamp: nowIso,
  };

  const updatePatch: Record<string, any> = {
    metadata: updatedMetadata,
    failure_reason: `MTN Beneficiary Error: Recipient is not registered on carrier whitelist. ${refundSuccess ? 'GHS ' + orderAmount.toFixed(2) + ' refunded to Mobile Money via Paystack.' : 'Refund queued for manual payout.'}`,
    updated_at: nowIso,
  };

  if (refundSuccess) {
    updatePatch.status = "refunded";
    updatePatch.auto_refunded = true;
    updatePatch.refund_amount = orderAmount;
    updatePatch.refund_reason = "Requested refund: MTN number not on beneficiary list. Refunded to Mobile Money via Paystack.";
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

  // Send Refund Confirmation SMS
  if (customerPhone && refundSuccess) {
    try {
      const trackingUrl = `https://swiftdatagh.shop/order-status?id=${orderId}`;
      const smsMessage = `SwiftData Alert: GHS ${orderAmount.toFixed(2)} for ${customerPhone} has been refunded to your Mobile Money account via Paystack! Ref: ${String(targetRef).slice(0, 8)}. Track: ${trackingUrl}`;

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
        order.agent_id || undefined
      );
    } catch (smsErr) {
      console.error("[guest-refund] Failed to send customer refund SMS:", smsErr);
    }
  }

  return {
    success: refundSuccess,
    refunded: refundSuccess,
    gateway: gatewayUsed,
    reference: targetRef,
    refundId: refundId || undefined,
    error: refundError || undefined,
  };
}
