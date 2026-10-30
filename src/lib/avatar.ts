/**
 * Deterministic Local SVG Avatar Generator
 * Eliminates external `api.dicebear.com` network calls and `ERR_CONNECTION_TIMED_OUT` errors
 * while rendering crisp, instant 0ms SVG avatars for any seed, name, or preset.
 */

const PALETTES: Array<[string, string, string]> = [
  ["#4f46e5", "#7c3aed", "#c4b5fd"], // Indigo -> Violet
  ["#059669", "#0d9488", "#99f6e4"], // Emerald -> Teal
  ["#0284c7", "#2563eb", "#bae6fd"], // Sky -> Blue
  ["#d97706", "#ea580c", "#fed7aa"], // Amber -> Orange
  ["#e11d48", "#db2777", "#fecdd3"], // Rose -> Pink
  ["#7c3aed", "#c026d3", "#f5d0fe"], // Violet -> Fuchsia
  ["#0d9488", "#0284c7", "#a5f3fc"], // Teal -> Cyan
  ["#2563eb", "#4f46e5", "#c7d2fe"], // Blue -> Indigo
  ["#16a34a", "#059669", "#bbf7d0"], // Green -> Emerald
  ["#9333ea", "#4f46e5", "#e9d5ff"], // Purple -> Indigo
  ["#ea580c", "#e11d48", "#fecaca"], // Orange -> Rose
  ["#0891b2", "#3b82f6", "#bfdbfe"], // Cyan -> Blue
];

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}

const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

function extractInitials(seed: string): string | null {
  const clean = seed.trim();
  if (!clean || UUID_LIKE_RE.test(clean)) return null;
  const base = clean.includes("@") ? clean.split("@")[0] : clean;
  const parts = base
    .replace(/[^a-zA-Z0-9\s._-]/g, " ")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

export function generateLocalAvatarDataUri(
  seedInput?: string | null,
  styleInput?: string | null
): string {
  const seed = (seedInput || "swiftdata-user").trim() || "swiftdata-user";
  const style = (styleInput || "avataaars").toLowerCase();
  const h = hashSeed(seed + ":" + style);
  const [c1, c2, accent] = PALETTES[h % PALETTES.length];
  const variant = (h >> 4) % 4;
  const eyeStyle = (h >> 8) % 3;
  const smileCurve = 54 + ((h >> 10) % 5);
  const initials = extractInitials(seed);

  let foregroundSvg = "";

  if (style === "shapes" && initials) {
    foregroundSvg = `
      <circle cx="40" cy="40" r="30" fill="none" stroke="${accent}" stroke-opacity="0.35" stroke-width="1.5" />
      <text x="40" y="46" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-weight="800" font-size="22" letter-spacing="1">${escapeXml(initials)}</text>
    `;
  } else if (style === "bottts") {
    // Sleek cyber bot avatar
    foregroundSvg = `
      <line x1="40" y1="12" x2="40" y2="21" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="40" cy="11" r="3.5" fill="${accent}"/>
      <rect x="20" y="21" width="40" height="36" rx="10" fill="#ffffff" fill-opacity="0.94"/>
      <rect x="25" y="29" width="30" height="12" rx="6" fill="${c1}"/>
      <circle cx="33" cy="35" r="3" fill="${accent}"/>
      <circle cx="47" cy="35" r="3" fill="${accent}"/>
      <rect x="31" y="47" width="18" height="3.5" rx="1.75" fill="${c2}" fill-opacity="0.7"/>
      <path d="M24 68 C24 59 56 59 56 68" fill="#ffffff" fill-opacity="0.88"/>
    `;
  } else {
    // Character / geometric portrait avatar
    const hairPath =
      variant === 0
        ? `<path d="M22 33 C22 19 58 19 58 33 C55 26 25 26 22 33 Z" fill="#1e1b4b" fill-opacity="0.75"/>`
        : variant === 1
        ? `<path d="M21 35 C20 18 60 18 59 35 C52 24 28 24 21 35 Z" fill="${accent}" fill-opacity="0.65"/>`
        : variant === 2
        ? `<circle cx="40" cy="21" r="9" fill="#1e1b4b" fill-opacity="0.55"/>`
        : "";

    const eyesSvg =
      eyeStyle === 0
        ? `<circle cx="33.5" cy="36" r="2.2" fill="${c1}"/><circle cx="46.5" cy="36" r="2.2" fill="${c1}"/>`
        : eyeStyle === 1
        ? `<rect x="30.5" y="34.5" width="6" height="2.6" rx="1.3" fill="${c1}"/><rect x="43.5" y="34.5" width="6" height="2.6" rx="1.3" fill="${c1}"/>`
        : `<path d="M31 36 Q33.5 33.5 36 36" stroke="${c1}" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M44 36 Q46.5 33.5 49 36" stroke="${c1}" stroke-width="2" stroke-linecap="round" fill="none"/>`;

    foregroundSvg = `
      <circle cx="40" cy="40" r="32" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="1.5"/>
      <path d="M18 76 C18 57 62 57 62 76 Z" fill="#ffffff" fill-opacity="0.92"/>
      <circle cx="40" cy="36" r="15.5" fill="#ffffff" fill-opacity="0.96"/>
      ${hairPath}
      ${eyesSvg}
      <path d="M35 43 Q40 ${smileCurve - 7} 45 43" stroke="${c2}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    `;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    <rect width="80" height="80" rx="40" fill="url(#g)"/>
    <circle cx="64" cy="16" r="18" fill="${accent}" fill-opacity="0.18"/>
    ${foregroundSvg}
  </svg>`
    .replace(/\s+/g, " ")
    .trim();

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Safely resolves an avatar URL.
 * - If `avatarUrl` is a non-DiceBear custom URL (e.g. Supabase Storage or data URI), returns it directly.
 * - If `avatarUrl` points to `api.dicebear.com` (which frequently times out with ERR_CONNECTION_TIMED_OUT)
 *   or is null/empty, returns an instant local SVG data URI using the extracted seed or `fallbackSeed`.
 */
export function getSafeAvatarUrl(
  avatarUrl?: string | null,
  fallbackSeed?: string | null,
  preferredStyle?: string
): string {
  const trimmed = (avatarUrl || "").trim();
  if (trimmed && !trimmed.includes("dicebear.com")) {
    return trimmed;
  }

  if (trimmed.includes("dicebear.com")) {
    try {
      const parsed = new URL(trimmed);
      const seedParam = parsed.searchParams.get("seed") || fallbackSeed || "user";
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      // e.g. /7.x/avataaars/svg -> style is pathParts[1]
      const styleFromPath = pathParts.length >= 2 ? pathParts[1] : preferredStyle;
      return generateLocalAvatarDataUri(seedParam, styleFromPath);
    } catch {
      return generateLocalAvatarDataUri(fallbackSeed || "user", preferredStyle);
    }
  }

  return generateLocalAvatarDataUri(fallbackSeed || "user", preferredStyle);
}

