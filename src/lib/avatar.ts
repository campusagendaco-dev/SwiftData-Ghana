/**
 * Deterministic Local Emoji & Character Avatar Generator
 * Uses HTML5 Canvas in the browser to bake true, full-color OS Emojis
 * onto glossy 3D spheres (bypassing SVG <img> font sandboxing) with
 * rich vector SVG fallback for SSR/tests.
 */

const PALETTES: Array<[string, string, string]> = [
  ["#1e6ae1", "#1449a6", "#5496ff"], // Royal Blue
  ["#147c8c", "#0c5663", "#3fa4b5"], // Teal
  ["#d96b12", "#9e4806", "#f5923e"], // Amber Orange
  ["#e03e2d", "#a62416", "#f76d5e"], // Coral Red
  ["#6938e6", "#491eb8", "#9065ff"], // Violet
  ["#14854e", "#0a5c33", "#3eb078"], // Emerald
  ["#9b30d9", "#6e1ba1", "#be5ef5"], // Orchid Purple
  ["#2276c9", "#155291", "#54a0ec"], // Sky Blue
  ["#e11d48", "#9f1239", "#fb7185"], // Rose Crimson
  ["#0d9488", "#115e59", "#2dd4bf"], // Lagoon
  ["#d97706", "#92400e", "#fbbf24"], // Gold
  ["#4f46e5", "#312e81", "#818cf8"], // Indigo
];

// 40 distinct real emojis mapped 1-to-1 to ALL_SEEDS in AvatarPicker
export const AVATAR_REAL_EMOJIS = [
  "😎", "🤠", "👑", "🦁", "🥷", "🤩", "🥳", "😈",
  "🤖", "🦊", "🐼", "🐯", "👽", "🦄", "🐲", "🔥",
  "⚡", "🎮", "🏆", "🦅", "🦈", "🐆", "🦍", "🤴",
  "👸", "🧙‍♂️", "🦸‍♂️", "🏎️", "🎱", "🎲", "😜", "😂",
  "🤯", "🤑", "🤓", "😇", "👻", "🎃", "💎", "🚀",
];

const STYLE_EMOJI_SETS: Record<string, string[]> = {
  "fun-emoji": [
    "😎", "🤩", "😍", "🥳", "😜", "😂", "🤠", "😈",
    "🤯", "🤑", "🤓", "😇", "🥰", "🤪", "😏", "🥶",
    "🥵", "🫡", "🤗", "🤭", "🧐", "😤", "😱", "🤠",
    "🤡", "👻", "👽", "🤖", "🎃", "😺", "😸", "😹",
    "😻", "😼", "😽", "🙀", "👑", "🔥", "⚡", "💎",
  ],
  "big-smile": [
    "😄", "😁", "😆", "😃", "😊", "😋", "😎", "😍",
    "😘", "🥰", "🤩", "🥳", "😺", "😸", "🤠", "😇",
    "🤗", "🤭", "🤪", "😝", "😛", "🤑", "🤓", "😏",
    "🫡", "🙌", "👏", "🫶", "💪", "🔥", "✨", "🌟",
    "👑", "🏆", "🎉", "🎊", "🦁", "🐯", "🐼", "🦊",
  ],
  "bottts": [
    "🤖", "👾", "🛸", "🚀", "⚡", "🔋", "🛰️", "🔮",
    "🦾", "🦿", "💻", "🕹️", "🎮", "📡", "⚙️", "🧲",
    "💎", "🛡️", "⚔️", "🧬", "🔬", "🔭", "🌐", "💠",
    "🌀", "💥", "✨", "🌟", "💫", "☄️", "🪐", "🌙",
    "☀️", "🌈", "🔥", "❄️", "🌊", "🌪️", "🎯", "🏆",
  ],
  "adventurer": [
    "🥷", "🤠", "🤴", "👸", "🧙‍♂️", "🦸‍♂️", "🦸‍♀️", "🦹‍♂️",
    "🕵️‍♂️", "🧑‍🚀", "🧑‍✈️", "🧑‍🚒", "🧑‍🎤", "🧑‍🎨", "🧑‍🔬", "🧑‍💻",
    "🦁", "🐯", "🦅", "🐲", "🐺", "🦊", "🐆", "🦈",
    "🦍", "🐼", "🦄", "🦖", "🐉", "凤凰", "⚔️", "🛡️",
    "🏹", "👑", "🏆", "🔥", "⚡", "💎", "🏎️", "🚀",
  ],
  "thumbs": [
    "👍", "🙌", "👏", "🫶", "✌️", "🤞", "🤟", "🤘",
    "🤙", "👌", "🤌", "👊", "✊", "🤝", "🙏", "💪",
    "🫡", "👑", "🔥", "⚡", "💯", "🏆", "🎯", "🚀",
    "💎", "🌟", "✨", "🎉", "🎊", "🥇", "🏅", "🎖️",
    "🦁", "🦅", "🐯", "🐲", "😎", "🤩", "🥳", "🤠",
  ],
};

const SEED_TO_EMOJI_INDEX: Record<string, number> = {
  swift: 0, ghana: 1, data: 2, ace: 3, nova: 4, bolt: 5, zara: 6, finn: 7,
  luna: 8, koda: 9, rex: 10, mia: 11, jade: 12, sage: 13, leo: 14, ivy: 15,
  cole: 16, tara: 17, alex: 18, sam: 19, pat: 20, riley: 21, quinn: 22, drew: 23,
  kai: 24, eden: 25, cruz: 26, skye: 27, juno: 28, wren: 29, noor: 30, blaze: 31,
  dax: 32, arlo: 33, poet: 34, fern: 35, max: 36, beau: 37, cleo: 38, rome: 39,
};

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

export function getRealEmojiForSeed(
  seedInput?: string | null,
  styleInput?: string | null
): { emoji: string; c1: string; c2: string; accent: string } {
  const seed = (seedInput || "swift").trim() || "swift";
  const seedLower = seed.toLowerCase();
  const style = (styleInput || "fun-emoji").toLowerCase();
  const h = hashSeed(seed + ":" + style);
  const [c1, c2, accent] = PALETTES[h % PALETTES.length];

  const baseIdx =
    SEED_TO_EMOJI_INDEX[seedLower] !== undefined
      ? SEED_TO_EMOJI_INDEX[seedLower]
      : hashSeed(seed) % AVATAR_REAL_EMOJIS.length;

  let set = AVATAR_REAL_EMOJIS;
  if (style.includes("smile")) set = STYLE_EMOJI_SETS["big-smile"];
  else if (style.includes("bottts")) set = STYLE_EMOJI_SETS["bottts"];
  else if (style.includes("adventurer") || style.includes("lorelei") || style.includes("personas"))
    set = STYLE_EMOJI_SETS["adventurer"];
  else if (style.includes("thumbs")) set = STYLE_EMOJI_SETS["thumbs"];
  else if (style.includes("emoji")) set = STYLE_EMOJI_SETS["fun-emoji"];

  const styleOffset =
    style === "avataaars" || style === "fun-emoji"
      ? 0
      : hashSeed(style) % set.length;

  const emoji = set[(baseIdx + styleOffset) % set.length] || "😎";
  return { emoji, c1, c2, accent };
}

const CANVAS_CACHE = new Map<string, string>();

function renderCanvasEmojiAvatarDataUri(
  emoji: string,
  c1: string,
  c2: string,
  accent: string
): string | null {
  if (typeof document === "undefined") return null;
  const cacheKey = `${emoji}:${c1}:${c2}:${accent}`;
  const cached = CANVAS_CACHE.get(cacheKey);
  if (cached) return cached;

  try {
    const size = 160;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 2;

    // 1. Clip to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // 2. Base 3D Sphere Gradient
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // 3. Top-right glossy crescent highlight
    ctx.beginPath();
    ctx.arc(cx + r * 0.38, cy - r * 0.38, r * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.globalAlpha = 1;

    // 4. Inner concentric ring
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.79, 0, Math.PI * 2);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 5. Real Full-Color Native OS Emoji centered in sphere
    ctx.font =
      "92px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0, 0, 0, 0.38)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.fillText(emoji, cx, cy + 5);

    ctx.restore();

    const dataUrl = canvas.toDataURL("image/png");
    CANVAS_CACHE.set(cacheKey, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

export function generateLocalAvatarDataUri(
  seedInput?: string | null,
  styleInput?: string | null
): string {
  const { emoji, c1, c2, accent } = getRealEmojiForSeed(seedInput, styleInput);

  // Use Canvas PNG in browser so <img src="..."> shows the true full-color OS emoji
  const canvasDataUrl = renderCanvasEmojiAvatarDataUri(emoji, c1, c2, accent);
  if (canvasDataUrl) {
    return canvasDataUrl;
  }

  // Fallback SVG for SSR / Node environments
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    <circle cx="40" cy="40" r="39" fill="url(#bgGrad)"/>
    <path d="M 42 1 A 39 39 0 0 1 79 42 C 64 44 43 26 42 1 Z" fill="${accent}" fill-opacity="0.55"/>
    <circle cx="40" cy="40" r="31" fill="none" stroke="${accent}" stroke-opacity="0.45" stroke-width="2"/>
    <text x="40" y="54" text-anchor="middle" font-size="42" font-family="'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif">${emoji}</text>
  </svg>`
    .replace(/\s+/g, " ")
    .trim();

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Safely resolves an avatar URL.
 * Automatically upgrades any legacy blank-white-silhouette SVG data URIs or DiceBear URLs
 * to our rich, full-color 3D Emoji avatars.
 */
export function getSafeAvatarUrl(
  avatarUrl?: string | null,
  fallbackSeed?: string | null,
  preferredStyle?: string
): string {
  const trimmed = (avatarUrl || "").trim();

  // Upgrade any previously-saved SVG data URI that had the blank white silhouette
  if (trimmed.startsWith("data:image/svg+xml")) {
    return generateLocalAvatarDataUri(fallbackSeed || "swift", preferredStyle || "fun-emoji");
  }

  if (trimmed && !trimmed.includes("dicebear.com")) {
    return trimmed;
  }

  if (trimmed.includes("dicebear.com")) {
    try {
      const parsed = new URL(trimmed);
      const seedParam = parsed.searchParams.get("seed") || fallbackSeed || "swift";
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      const styleFromPath = pathParts.length >= 2 ? pathParts[1] : preferredStyle;
      return generateLocalAvatarDataUri(seedParam, styleFromPath);
    } catch {
      return generateLocalAvatarDataUri(fallbackSeed || "swift", preferredStyle);
    }
  }

  return generateLocalAvatarDataUri(fallbackSeed || "swift", preferredStyle || "fun-emoji");
}
