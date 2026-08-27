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
  if (cleaned === "MTNMIDNIGHT" || cleaned === "MTNMIDNGT3G" || cleaned === "AIRMIDNGT3G" || cleaned === "AIRMIDNIGHT") {
    return 3;
  }
  
  let parseTarget = cleaned;
  const parenMatch = cleaned.match(/\(([^)]+)\)/);
  if (parenMatch) {
    parseTarget = parenMatch[1];
  }
  
  const match = parseTarget.match(/([\d.]+)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (parseTarget.includes("MB") && !parseTarget.includes("GB")) {
    return num / 1024;
  }
  return num;
}

export function mapDataNetworkKey(network: string): string {
  const n = (network || "").trim().toUpperCase();
  if (n === "AIRTELTIGO" || n === "AIRTEL TIGO" || n === "AIRTEL-TIGO" || n === "AT") return "AT_PREMIUM";
  if (n === "TELECEL" || n === "VODAFONE" || n === "VOD") return "TELECEL";
  if (n === "MTN" || n === "YELLO" || n === "MTN_XPRESS") return "YELLO";
  return n;
}

export function mapAirtimeNetworkKey(network: string): string {
  const n = (network || "").trim().toUpperCase();
  if (n === "MTN" || n === "YELLO") return "MTN";
  if (n === "VOD" || n === "VODAFONE" || n === "TELECEL") return "VOD";
  if (n === "AT" || n === "AIRTELTIGO" || n === "AIRTEL TIGO") return "AT";
  if (n === "GLO") return "GLO";
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
    
    const orderId = String(
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
               parsed?.ok === true;

    if (ok) {
      return { ok: true, id: orderId || undefined, status: effectiveStatus || "processing" };
    }
    
    const isFailed = technicalStatus === "false" || technicalStatus === "error" || technicalStatus === "failed" || technicalStatus === "failure";
    if (isFailed) {
      return { ok: false, reason: message || "Provider rejected this order." };
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
