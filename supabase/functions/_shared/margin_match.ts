// How the margin watchdog matches a bundle to supplier costs (pure, unit-tested).
// MTN Mash Up is its own network, and data + minutes combos (e.g. DataMart's "6GB + 353 Mins" /
// "MTN MashUp ₵63") are never plain data, so they must not set the cost of "MTN 6GB".

export function normalizeNetwork(raw: string | null | undefined): string {
  const s = String(raw || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!s) return "";
  if (s.includes("MASH")) return "MTN_MASHUP";
  if (s.includes("MTN")) return "MTN";
  if (s.includes("TELECEL") || s.includes("VODAFONE")) return "TELECEL";
  if (s.includes("BIGTIME") || s.includes("BIG_TIME")) return "AT_BIGTIME";
  if (s.includes("ISHARE") || s.includes("I_SHARE")) return "AT_ISHARE";
  if (s === "AT" || s.includes("AIRTEL") || s.includes("AT_PREMIUM")) return "AT_PREMIUM";
  return s;
}

export function normalizeSize(raw: string | null | undefined, capacityGb?: number | null): string {
  const s = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  const gbMatch = s.match(/(\d+(?:\.\d+)?)GB/);
  if (gbMatch) return `${Number(gbMatch[1])}GB`;
  const mbMatch = s.match(/(\d+(?:\.\d+)?)MB/);
  if (mbMatch) return `${Number(mbMatch[1])}MB`;
  if (capacityGb && Number.isFinite(Number(capacityGb)) && Number(capacityGb) > 0) {
    return `${Number(capacityGb)}GB`;
  }
  return s;
}

/** A data + minutes combo or a Mash Up bundle: never comparable with plain data. */
export function isComboPackage(name: string | null | undefined): boolean {
  const s = String(name || "");
  return /mash\s*up/i.test(s) || /\+\s*\d+\s*min/i.test(s);
}
