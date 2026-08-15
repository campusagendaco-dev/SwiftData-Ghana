import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Escapes text for safe interpolation into raw HTML strings (e.g. templates
 * fed to innerHTML/document.write outside React's own JSX auto-escaping).
 * Use this anywhere user- or agent-controlled text is built into an HTML
 * string by hand — the flyer generator and receipt/PDF builders in
 * particular, since neither goes through JSX.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch] as string));
}

/**
 * Strips characters that are structural in PostgREST's embedded filter
 * grammar (used by supabase-js's `.or()`/`.filter()`) — commas separate
 * conditions and parentheses group them, with no escape syntax for literal
 * occurrences in an unquoted value. Any raw comma/paren in a user-typed
 * search term (pasted phone numbers, names, etc.) corrupts the filter string
 * and the request fails with a 400/500. None of these characters are ever
 * meaningful in a phone/name/email search, so stripping them is safe.
 * Apply this once, right where free-text search input is captured, before
 * it's used to build any `.or(...)`/`.filter(...)` string.
 */
export function sanitizeSearchTerm(value: string): string {
  return value.replace(/[,()]/g, " ").trim();
}

/** Returns Tailwind classes for data-package cards based on network name */
export function getNetworkCardColors(network: string): {
  card: string;
  label: string;
  price: string;
  size: string;
  btn: string;
} {
  switch (network) {
    case "Telecel":
      return {
        card: "bg-red-600",
        label: "text-white/70",
        price: "text-white/70",
        size: "text-white",
        btn: "bg-red-800 hover:bg-red-900 text-white",
      };
    case "AirtelTigo":
      return {
        card: "bg-blue-600",
        label: "text-white/70",
        price: "text-white/70",
        size: "text-white",
        btn: "bg-blue-800 hover:bg-blue-900 text-white",
      };
    default: // MTN
      return {
        card: "bg-amber-400",
        label: "text-black/70",
        price: "text-black/70",
        size: "text-black",
        btn: "bg-amber-100 hover:bg-white text-black",
      };
  }
}

/**
 * Detects the network provider based on Ghanaian phone number prefixes.
 */
export function detectNetwork(phone: string): "MTN" | "Telecel" | "AirtelTigo" | null {
  const digits = phone.replace(/\D+/g, "");
  if (digits.length < 3) return null;
  
  // Normalize to 10 digits if possible (e.g. 23324... -> 024...)
  let prefix = "";
  if (digits.startsWith("233") && digits.length >= 6) {
    prefix = digits.slice(3, 6);
  } else if (digits.startsWith("0") && digits.length >= 3) {
    prefix = digits.slice(1, 3);
  } else if (digits.length >= 2) {
    prefix = digits.slice(0, 2);
  }

  // Prepend 0 if it's just 2 digits
  if (prefix.length === 2) prefix = "0" + prefix;
  else if (prefix.length === 3 && !prefix.startsWith("0")) prefix = "0" + prefix.slice(1);

  const mtn = ["024", "054", "055", "059", "025", "053"];
  const telecel = ["020", "050"];
  const at = ["027", "057", "026", "056"];

  if (mtn.some(p => prefix.startsWith(p))) return "MTN";
  if (telecel.some(p => prefix.startsWith(p))) return "Telecel";
  if (at.some(p => prefix.startsWith(p))) return "AirtelTigo";

  return null;
}

/**
 * Returns a high-quality FlagCDN URL mapping common team names, abbreviations,
 * or emoji characters to their corresponding ISO two-letter country flag.
 */
export function getFlagUrl(val: string): string | null {
  if (!val) return null;
  const clean = val.trim().toLowerCase();

  // Emoji to ISO code mapping
  const emojiToIso: Record<string, string> = {
    "🇬🇭": "gh", "🇺🇾": "uy", "🇧🇷": "br", "🇫🇷": "fr", "🏴󠁧󠁢󠁥󠁮󠁧󠁿": "gb-eng", "🇸🇳": "sn",
    "🇲🇽": "mx", "🇿🇦": "za", "🇦🇷": "ar", "🇭🇷": "hr", "🇺🇸": "us", "🇩🇪": "de",
    "🇪🇸": "es", "🇵🇹": "pt", "🇮🇹": "it", "🇳🇱": "nl", "🇧🇪": "be", "🇲🇦": "ma",
    "🇯🇵": "jp", "🇰🇷": "kr", "🇳🇬": "ng", "🇨🇲": "cm", "🇨🇦": "ca", "🇶🇦": "qa",
    "🇪🇨": "ec", "🇸🇦": "sa", "🇮🇷": "ir", "🇼🇸": "ws", "🇦🇺": "au", "🇩🇰": "dk",
    "🇹🇳": "tn", "🇨🇷": "cr", "🇵🇪": "pe", "🇨🇱": "cl", "🇨🇴": "co", "🇵🇾": "py",
    "🇻🇪": "ve", "🇧🇴": "bo", "🇩🇿": "dz", "🇨🇮": "ci", "🇪🇬": "eg", "🇿🇲": "zm",
    "🇺🇬": "ug", "🇰🇪": "ke"
  };

  if (emojiToIso[val]) {
    return `https://flagcdn.com/w80/${emojiToIso[val]}.png`;
  }

  // Common team names, abbreviations, or codes to ISO mapping
  const nameToIso: Record<string, string> = {
    ghana: "gh", gha: "gh",
    uruguay: "uy", uru: "uy",
    brazil: "br", bra: "br",
    france: "fr", fra: "fr",
    england: "gb-eng", eng: "gb-eng",
    senegal: "sn", sen: "sn",
    mexico: "mx", mex: "mx",
    "south africa": "za", sa: "za", rsa: "za",
    argentina: "ar", arg: "ar",
    croatia: "hr", cro: "hr",
    usa: "us", "united states": "us", "united states of america": "us",
    germany: "de", ger: "de", deutschland: "de",
    spain: "es", esp: "es", espana: "es",
    portugal: "pt", por: "pt",
    italy: "it", ita: "it", italia: "it",
    netherlands: "nl", ned: "nl", holland: "nl",
    belgium: "be", bel: "be",
    morocco: "ma", mar: "ma",
    japan: "jp", jpn: "jp",
    "south korea": "kr", kor: "kr", korea: "kr",
    nigeria: "ng", nga: "ng",
    cameroon: "cm", cmr: "cm",
    canada: "ca", can: "ca",
    qatar: "qa", qat: "qa",
    ecuador: "ec", ecu: "ec",
    "saudi arabia": "sa", ksa: "sa",
    iran: "ir", irn: "ir",
    wales: "gb-wls", wls: "gb-wls",
    poland: "pl", pol: "pl",
    tunisia: "tn", tun: "tn",
    "costa rica": "cr", crc: "cr",
    denmark: "dk", den: "dk",
    switzerland: "ch", sui: "ch", che: "ch",
    serbia: "rs", srb: "rs",
    australia: "au", aus: "au",
    colombia: "co", col: "co",
    peru: "pe", per: "pe",
    chile: "cl", chi: "cl",
    egypt: "eg", egy: "eg",
    algeria: "dz", alg: "dz",
    "ivory coast": "ci", civ: "ci", "côte d'ivoire": "ci",
    kenya: "ke", ken: "ke"
  };

  const code = nameToIso[clean];
  if (code) {
    return `https://flagcdn.com/w80/${code}.png`;
  }

  // Fallback: if it's a clean 2-letter ISO code itself
  if (clean.length === 2 && /^[a-z]{2}$/.test(clean)) {
    return `https://flagcdn.com/w80/${clean}.png`;
  }

  return null;
}
