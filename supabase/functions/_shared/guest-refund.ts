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
  
  // Either no account/agent assigned, or explicitly paid directly via external MoMo/card gateway
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
 * Executes an automated gateway refund (Paystack) for a guest order that failed
 * due to carrier beneficiary / whitelist rejection, automatically submits the recipient
 * number for carrier approval, and sends a transparent notification SMS.
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

  console.log(`[guest-refund] Initiating guest beneficiary refund for order ${orderId} (Amount: GHS ${orderAmount}, Phone: ${customerPhone}, Ref: ${targetRef})`);

  // 1. Resolve Paystack Secret Key prioritizing Environment Secrets
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

  // 2. Execute Paystack Refund if key and amount are valid
  if (paystackKey && orderAmount > 0 && targetRef) {
    try {
      gatewayUsed = "paystack";
      const amountInPesewas = Math.round(orderAmount * 100);
      const refundPayload = {
        transaction: targetRef,
        amount: amountInPesewas,
        currency: "GHS",
        customer_note: `SwiftData: Refund for order ${orderId.slice(0, 8)} - recipient number is not on MTN beneficiary list.`,
        merchant_note: `Auto-refund for non-beneficiary guest order ${orderId}`,
      };

      console.log(`[guest-refund] Calling Paystack Refund API for transaction ${targetRef} (${amountInPesewas} pesewas)...`);

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
        console.warn(`[guest-refund] Paystack refund was not approved: ${refundError}`);
        // If Paystack says already refunded, treat as success
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

  // 3. Update Order Record with Status, Refund Details, and Audit Trail
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
    failure_reason: `MTN Beneficiary Error: Recipient is not registered on carrier whitelist. ${refundSuccess ? 'GHS ' + orderAmount.toFixed(2) + ' automatically refunded to Mobile Money via Paystack.' : 'Refund queued for manual payout.'}`,
    updated_at: nowIso,
  };

  if (refundSuccess) {
    updatePatch.status = "refunded";
    updatePatch.auto_refunded = true;
    updatePatch.refund_amount = orderAmount;
    updatePatch.refund_reason = "Auto-refund: MTN number not on beneficiary list. Refunded to Mobile Money/Card via Paystack.";
    updatePatch.refunded_at = nowIso;
  } else {
    // Keep as fulfillment_failed so admin can easily identify and process manual payout
    updatePatch.status = "fulfillment_failed";
  }

  await supabaseAdmin.from("orders").update(updatePatch).eq("id", orderId);

  // 4. Log System Event
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

  // 5. Automatically Submit Number to Carrier Whitelist (DataHub)
  let carrierSubmitted = false;
  if (customerPhone) {
    try {
      // 5a. Log to beneficiary_submissions table
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
        source: "guest_auto_refund",
        submitted_by: "Guest Auto-Refund Engine",
        notes: `Auto-submitted after failed guest order ${orderId.slice(0, 8)}`,
      }, { onConflict: "phone_number" });

      // 5b. Submit to DataHub API if provider credentials are ready
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
    } catch (carrierErr) {
      console.error("[guest-refund] Carrier submit error:", carrierErr);
    }
  }

  // 6. Send Reassuring SMS to Customer
  if (customerPhone) {
    try {
      const trackingUrl = `https://swiftdatagh.shop/order-status?id=${orderId}`;
      let smsMessage = "";

      if (refundSuccess) {
        smsMessage = `SwiftData Alert: Your GHS ${orderAmount.toFixed(2)} MTN order for ${customerPhone} failed because the number is not on the carrier beneficiary list.\n\n` +
          `GHS ${orderAmount.toFixed(2)} has been refunded directly to your Mobile Money/payment account!\n\n` +
          `We have also submitted your number for carrier approval so your next order will deliver instantly. Track: ${trackingUrl}`;
      } else {
        smsMessage = `SwiftData Alert: Your GHS ${orderAmount.toFixed(2)} MTN order for ${customerPhone} failed because the number is not on the carrier beneficiary list.\n\n` +
          `Our support team has queued your refund for manual payout. Your number is also queued for carrier approval. Track: ${trackingUrl}`;
      }

      await sendPaymentSms(
        supabaseAdmin,
        customerPhone,
        "custom",
        {
          message: smsMessage,
          reason: "Not on MTN beneficiary list",
          amount: orderAmount.toFixed(2),
          network: "MTN",
        },
        order.agent_id || undefined
      );
    } catch (smsErr) {
      console.error("[guest-refund] Failed to send customer SMS:", smsErr);
    }
  }

  return {
    success: true,
    refunded: refundSuccess,
    gateway: gatewayUsed,
    reference: targetRef,
    refundId: refundId || undefined,
    error: refundError || undefined,
    carrierSubmitted,
  };
}
