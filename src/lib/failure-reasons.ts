/**
 * Shared utility for translating internal or carrier error messages into
 * clear, friendly, and actionable explanations for end-users and agents.
 */

export function translateFailureReason(
  reason?: string | null,
  network?: string | null,
  orderType?: string | null
): string {
  if (!reason) return "";
  const r = reason.trim().toUpperCase();

  // 1. Refunds
  if (r.includes("REFUNDED")) {
    return "Delivery could not be completed by the carrier network and the amount has been refunded to your wallet.";
  }

  // 2. Mobile Money / Wallet payment failures
  if (
    r.includes("LOW_BALANCE_OR_PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED") ||
    r.includes("PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED")
  ) {
    return "Mobile Money payment declined: Customer wallet has insufficient funds or reached daily transaction limit.";
  }

  // 3. Carrier Node & API errors
  if (r === "FAILED_API_CALL" || r.includes("FAILED_API_CALL")) {
    return "Carrier gateway node was temporarily unreachable. The order is automatically queued for fallback transmission.";
  }
  if (r.includes("TIMEOUT") || r.includes("ETIMEDOUT") || r.includes("NETWORK TIMEOUT")) {
    return "Carrier network response timed out. The system is actively re-verifying delivery status.";
  }

  // 4. Network-specific SME bundle restrictions
  const net = String(network || "").toUpperCase();
  const isMtn = net.includes("MTN") || net.includes("YELLO");
  const isData = !orderType || orderType === "data" || orderType === "sme";

  if (isMtn && isData) {
    if (r.includes("PAYEE_LIMIT_REACHED") || r.includes("DAILY LIMIT")) {
      return "The recipient's MTN daily transfer limit has been reached. Please try again tomorrow or use another number.";
    }
    if (r.includes("NOT_ALLOWED") || r.includes("NOT ALLOWED") || r.includes("UNSUPPORTED PLAN")) {
      return "This number is not allowed to receive SME data bundles (e.g. corporate or postpaid lines). Please try another number.";
    }
    if (r.includes("BENEFICIARY") || r.includes("WHITELIST") || r.includes("NOT ADDED")) {
      return "Recipient number is not on the carrier's approved beneficiary list. Please submit it for verification.";
    }
  } else {
    if (r.includes("MTN DATA TRANSFER LIMIT") || r.includes("BENEFICIARY ERROR")) {
      return orderType === "airtime"
        ? "Airtime delivery failed by carrier. Please verify recipient number or try another amount."
        : "Delivery could not be completed by carrier network for this recipient line.";
    }
    if (r.includes("NOT_ALLOWED") || r.includes("NOT ALLOWED") || r.includes("UNSUPPORTED")) {
      return "Recipient number or transaction is not supported by carrier network for this service. Please verify number or try another amount.";
    }
  }

  // 5. Checkout / Abandoned
  if (r.includes("CUSTOMER ABANDONED TRANSACTION") || r.includes("CUSTOMER ABANDONED")) {
    return "The checkout payment was cancelled or abandoned. Please try initiating the payment again.";
  }
  if (r.includes("ROUTE NOT FOUND") || r.includes("ORDER NOT FOUND ON PROVIDER")) {
    return "Delivery could not be confirmed with the carrier gateway. Please retry or contact support.";
  }
  if (r.includes("INSUFFICIENT BALANCE") || r.includes("INSUFFICIENT_BALANCE")) {
    return "Fulfillment paused due to insufficient wallet float. Please top up your wallet to retry.";
  }

  // 6. Generic cleaning: remove upstream provider vendor names
  return reason
    .replace(/\b(DataHub|BundleZone|DataMart|Datamart|Xcel|Hubnet|Korba|Korba365|SKDataPlug|SKPlug|Spendless|TxtConnect|Mnotify|Arkesel|Hubtel)\b/gi, "Carrier Network")
    .replace(/Carrier Network reported:\s*/gi, "Carrier reported: ")
    .trim();
}

/**
 * Checks if a failed order requires beneficiary registration on MTN
 */
export function isBeneficiaryFailure(
  status?: string | null,
  message?: string | null,
  network?: string | null,
  orderType?: string | null
): boolean {
  if (status === "fulfilled" || status === "refunded" || status === "processing") return false;
  const net = String(network || "").toUpperCase();
  const isMtn = net.includes("MTN") || net.includes("YELLO");
  const isData = !orderType || orderType === "data" || orderType === "sme";
  if (!isMtn || !isData) return false;

  const msg = (message || "").toUpperCase();
  return (
    msg.includes("BENEFICIARY") ||
    msg.includes("WHITELIST") ||
    msg.includes("NOT ADDED") ||
    msg.includes("APPROVAL NEEDED") ||
    msg.includes("REGISTER")
  );
}
