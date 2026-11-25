// Reads an ECG prepaid token from a Korba response. Customers are texted this token, so a wrong
// one is a real problem:
//   - Korba's own prepaid-token fields are trusted as sent (any format Korba uses)
//   - generic "token" fields must look like a meter token (they could be a session token)
//   - free text is only used when Korba says the order is delivered AND the number comes right
//     after the word "token" (a bare 20-digit number could be a transaction reference)

const TOKEN_SHAPE = /^\d{16,24}$/;

function nonEmpty(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function tokenShaped(v: unknown): string | null {
  const s = nonEmpty(v);
  return s && TOKEN_SHAPE.test(s.replace(/[\s-]/g, "")) ? s : null;
}

export function extractPrepaidToken(parsed: any, opts: { delivered: boolean }): string | null {
  if (!parsed || typeof parsed !== "object") return null;

  const explicit = [
    parsed.prepaid_token, parsed.prepaidToken,
    parsed.data?.prepaid_token, parsed.results?.prepaid_token, parsed.results?.data?.prepaid_token,
  ];
  for (const f of explicit) {
    const t = nonEmpty(f);
    if (t) return t;
  }

  const generic = [parsed.token, parsed.data?.token, parsed.results?.token, parsed.results?.data?.token];
  for (const f of generic) {
    const t = tokenShaped(f);
    if (t) return t;
  }

  if (!opts.delivered) return null;
  const text = [parsed.message, parsed.results?.message, parsed.description]
    .filter((x) => typeof x === "string").join(" ");
  const m = text.match(/token\b[^0-9]{0,40}?(\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}|\d{20})\b/i);
  return m ? m[1].replace(/[-\s]/g, "") : null;
}
