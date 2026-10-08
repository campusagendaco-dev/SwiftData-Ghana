declare const Deno: any;

export function getFirstEnv(...keys: string[]): string {
  for (const key of keys) {
    const v = Deno.env.get(key)?.trim();
    if (v) return v;
  }
  return "";
}

export function normalizeRecipient(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return phone.trim();
}

export function parseCapacity(packageSize: string | null | undefined): number {
  if (!packageSize) return 0;
  const cleaned = packageSize.replace(/\s+/g, "").toUpperCase();
  
  // Handle specific Korba Product IDs
  if (cleaned === "MTNDLY20MB" || cleaned === "AIRDLY20MB" || cleaned.includes("20MB") || cleaned.includes("20 MB")) {
    return 20 / 1024;
  }
  if (cleaned === "MTNMIDNIGHT" || cleaned === "MTNMIDNGT3G" || cleaned === "AIRMIDNGT3G" || cleaned === "AIRMIDNIGHT" || cleaned.includes("MIDNIGHT") || cleaned.includes("MIDNGT")) {
    return 3;
  }
  if (cleaned === "MTNMTH200GB" || cleaned === "AIRMTH200GB" || cleaned.includes("200GB")) {
    return 200;
  }
  
  let parseTarget = cleaned;
  const parenMatch = cleaned.match(/\(([^)]+)\)/);
  if (parenMatch) {
    parseTarget = parenMatch[1];
  }
  
  const match = parseTarget.match(/([\d.]+)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (parseTarget.includes("TB")) {
    return num * 1024;
  }
  if (parseTarget.includes("MB") && !parseTarget.includes("GB")) {
    return num / 1024;
  }
  return num;
}

export function mapDataNetworkKey(network: string): string {
  const raw = (network || "").trim().toUpperCase();
  const cleaned = raw.replace(/[\s\-_]+/g, "_");

  if (cleaned.includes("XPRESS") || cleaned.includes("EXPRESS")) return "MTN_XPRESS";
  if (cleaned.includes("BIGTIME") || cleaned.includes("BIG_TIME")) return "AT_BIGTIME";
  if (cleaned.includes("TELECEL") || cleaned.includes("VODA") || cleaned.includes("RED") || cleaned === "VOD") return "TELECEL";
  if (cleaned.includes("AIRTEL") || cleaned.includes("TIGO") || cleaned.includes("AT") || cleaned.includes("PREMIUM") || cleaned.includes("BLUE")) return "AT_PREMIUM";
  if (cleaned === "YELLO" || cleaned.includes("MTN") || cleaned.includes("KOKRO") || cleaned.includes("MASH") || cleaned.includes("DATA")) return "YELLO";

  return raw || "YELLO";
}

export function mapAirtimeNetworkKey(network: string): string {
  const n = (network || "").trim().toUpperCase();
  if (n.includes("MTN") || n === "YELLO") return "MTN";
  if (n.includes("VOD") || n.includes("TELECEL") || n === "RED") return "VOD";
  if (n.includes("AT") || n.includes("AIRTEL") || n.includes("TIGO") || n.includes("BLUE")) return "AT";
  if (n.includes("GLO")) return "GLO";
  return n;
}

export function isHtmlResponse(contentType: string | null, body: string): boolean {
  const preview = body.trim().slice(0, 200).toLowerCase();
  return Boolean(
    preview.startsWith("<!doctype html") ||
    preview.startsWith("<html") ||
    preview.includes("<title>"),
  );
}

export function parseProviderResponse(body: string, contentType: string | null): { ok: boolean; reason?: string; id?: string; status?: string } {
  try {
    const parsed = JSON.parse(body);
    const technicalStatus = String(parsed?.status ?? parsed?.success ?? "").toLowerCase();
    const data = parsed?.data || {};
    const deliveryStatus = String(parsed?.transaction?.status ?? data?.status ?? data?.orderStatus ?? parsed?.delivery_status ?? parsed?.status_message ?? parsed?.transaction_status ?? "").toLowerCase();
    const effectiveStatus = deliveryStatus || technicalStatus;
    const message = typeof parsed?.message === "string"
      ? parsed.message
      : (typeof parsed?.error_message === "string"
        ? parsed.error_message
        : (typeof parsed?.error === "string"
          ? parsed.error
          : undefined));

    if (parsed?.error && typeof parsed.error === "string") {
      return { ok: false, reason: parsed.error };
    }
    
    const orderId = String(
      data?.request_id ??
      data?.order?.order_id ??
      data?.order?.id ??
      data?.order?.request_id ??
      parsed?.results?.operatorRequestID ?? 
      parsed?.results?.operatorRequestId ?? 
      parsed?.korba_trans_id ??
      parsed?.transaction?.reference ?? 
      data?.orderNumber ?? 
      data?.reference ?? 
      data?.purchaseId ?? 
      data?.orderReference ?? 
      data?.transactionId ?? 
      data?.transaction_id ?? 
      parsed?.transaction_id ?? 
      parsed?.order_id ?? 
      parsed?.id ?? 
      parsed?.reference ?? 
      ""
    );

    const isFailed = parsed?.success === false || 
                     technicalStatus === "false" || 
                     technicalStatus === "error" || 
                     technicalStatus === "failed" || 
                     technicalStatus === "failure" ||
                     technicalStatus === "refunded" ||
                     technicalStatus === "reversed" ||
                     deliveryStatus === "failed" ||
                     deliveryStatus === "refunded" ||
                     deliveryStatus === "reversed" ||
                     effectiveStatus === "failed" ||
                     message === "FAILED";

    if (isFailed) {
      const code = parsed?.code || parsed?.error_code || data?.code || parsed?.data?.code;
      const baseReason = message || data?.order?.message || data?.message || (effectiveStatus === "refunded" ? "Provider refunded order" : "Provider rejected this order.");
      const errReason = code ? `${code}: ${baseReason}` : baseReason;
      return { ok: false, id: orderId || undefined, status: effectiveStatus || "fulfillment_failed", reason: errReason };
    }

    const ok = technicalStatus === "success" || 
               technicalStatus === "true" || 
               technicalStatus === "1" || 
               technicalStatus === "200" || 
               technicalStatus === "completed" || 
               technicalStatus === "delivered" || 
               technicalStatus === "processing" || 
               technicalStatus === "pending" || 
               parsed?.success === true || 
               parsed?.status === true || 
               parsed?.status === 200 || 
               parsed?.code === 200 || 
               data?.order?.success === true ||
               data?.order?.status === "processing" ||
               parsed?.ok === true;

    if (ok && parsed?.success !== false) {
      return { ok: true, id: orderId || undefined, status: effectiveStatus || "processing" };
    }

    const statusCode = Number(parsed?.statusCode);
    if (Number.isFinite(statusCode) && statusCode >= 400) {
      return { ok: false, reason: message || "Provider rejected this order." };
    }
    
    if (orderId && orderId !== "undefined" && orderId !== "") return { ok: true, id: orderId, status: effectiveStatus };

  } catch { /* non-JSON */ }

  if (isHtmlResponse(contentType, body)) {
    return { ok: false, reason: "Provider returned an HTML response. Check API URL configuration." };
  }

  return { ok: true };
}

/**
 * Checks whether an order failure reason represents a permanent, non-retryable recipient/client error.
 * These errors MUST NEVER be cascaded to another provider or automatically reprocessed,
 * as doing so wastes API calls, triggers provider penalties, and risks double-debits.
 */
export function isNonRetryableTerminalError(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const r = String(reason).toLowerCase();
  return (
    r.includes("invalid number") ||
    r.includes("invalid recipient") ||
    r.includes("wrong network") ||
    r.includes("not an mtn") ||
    r.includes("not a telecel") ||
    r.includes("not an at") ||
    r.includes("barred") ||
    r.includes("blocked") ||
    r.includes("blacklisted") ||
    r.includes("payee limit") ||
    r.includes("limit reached") ||
    r.includes("daily limit") ||
    r.includes("duplicate") ||
    r.includes("identical") ||
    r.includes("inactive number") ||
    r.includes("suspended") ||
    r.includes("unregistered") ||
    r.includes("line not found") ||
    r.includes("subscriber not found") ||
    r.includes("already placed") ||
    r.includes("currently being processed")
  );
}

