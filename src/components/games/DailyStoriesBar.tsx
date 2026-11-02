import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";
import {
  triggerHapticSensor,
  playTurnNotificationSound,
  playLevelUpFanfare,
} from "@/lib/game-sensory-engine";
import {
  Plus,
  Camera,
  Video,
  Type,
  X,
  Eye,
  Swords,
  Send,
  Sparkles,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Check,
  Volume2,
  VolumeX,
  Upload,
  Flame,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

// ── 1. 20 GLOSSY 3D EMOJI GAMER AVATARS ───────────────────────────────────────
export interface GamerAvatarSpec {
  id: string;
  label: string;
  emoji: string;
  sphereBase: string;
  sphereDark: string;
  sphereCrescent: string;
  ringColor: string;
  eyes: "curve" | "dots" | "flat";
  mouth: "smile" | "neutral";
  accessory?: "dark_band" | "light_band" | "top_bun" | "gold_band";
}

export const GAMER_AVATAR_CATALOG: GamerAvatarSpec[] = [
  // Row 1
  {
    id: "royal_headband",
    label: "Royal Striker",
    emoji: "😎",
    sphereBase: "#1e6ae1",
    sphereDark: "#1449a6",
    sphereCrescent: "#5496ff",
    ringColor: "#7cb0ff",
    eyes: "curve",
    mouth: "smile",
    accessory: "dark_band",
  },
  {
    id: "teal_calm",
    label: "Teal Tactician",
    emoji: "🥷",
    sphereBase: "#147c8c",
    sphereDark: "#0c5663",
    sphereCrescent: "#3fa4b5",
    ringColor: "#75cad6",
    eyes: "curve",
    mouth: "neutral",
  },
  {
    id: "orange_beam",
    label: "Amber Lion King",
    emoji: "🦁",
    sphereBase: "#d96b12",
    sphereDark: "#9e4806",
    sphereCrescent: "#f5923e",
    ringColor: "#fbbd84",
    eyes: "curve",
    mouth: "smile",
  },
  {
    id: "red_wink",
    label: "Coral Ace",
    emoji: "🤩",
    sphereBase: "#e03e2d",
    sphereDark: "#a62416",
    sphereCrescent: "#f76d5e",
    ringColor: "#fca197",
    eyes: "flat",
    mouth: "smile",
  },
  // Row 2
  {
    id: "purple_joy",
    label: "Violet Legend",
    emoji: "👑",
    sphereBase: "#6938e6",
    sphereDark: "#491eb8",
    sphereCrescent: "#9065ff",
    ringColor: "#b89cff",
    eyes: "curve",
    mouth: "smile",
  },
  {
    id: "emerald_zen",
    label: "Emerald Master",
    emoji: "🐲",
    sphereBase: "#14854e",
    sphereDark: "#0a5c33",
    sphereCrescent: "#3eb078",
    ringColor: "#7cd4a7",
    eyes: "curve",
    mouth: "neutral",
  },
  {
    id: "sky_bun",
    label: "Sky Samurai",
    emoji: "🤖",
    sphereBase: "#2276c9",
    sphereDark: "#155291",
    sphereCrescent: "#54a0ec",
    ringColor: "#8bc1f7",
    eyes: "flat",
    mouth: "smile",
    accessory: "top_bun",
  },
  {
    id: "crimson_smile",
    label: "Crimson Blaze",
    emoji: "🔥",
    sphereBase: "#e03e2d",
    sphereDark: "#a32214",
    sphereCrescent: "#f76d5e",
    ringColor: "#fca197",
    eyes: "curve",
    mouth: "smile",
  },
  // Row 3
  {
    id: "magenta_cool",
    label: "Orchid Mystic",
    emoji: "😈",
    sphereBase: "#9b30d9",
    sphereDark: "#6e1ba1",
    sphereCrescent: "#be5ef5",
    ringColor: "#da99ff",
    eyes: "dots",
    mouth: "neutral",
  },
  {
    id: "cobalt_band",
    label: "Cobalt Sheriff",
    emoji: "🤠",
    sphereBase: "#1e6ae1",
    sphereDark: "#1449a6",
    sphereCrescent: "#5496ff",
    ringColor: "#7cb0ff",
    eyes: "dots",
    mouth: "smile",
    accessory: "dark_band",
  },
  {
    id: "jade_grin",
    label: "Jade Fox",
    emoji: "🦊",
    sphereBase: "#167c8c",
    sphereDark: "#0d5561",
    sphereCrescent: "#43a5b5",
    ringColor: "#7dcad6",
    eyes: "dots",
    mouth: "smile",
  },
  {
    id: "violet_laugh",
    label: "Indigo Spark",
    emoji: "⚡",
    sphereBase: "#6938e6",
    sphereDark: "#491eb8",
    sphereCrescent: "#9065ff",
    ringColor: "#b89cff",
    eyes: "curve",
    mouth: "smile",
  },
  // Row 4
  {
    id: "indigo_bun",
    label: "Amethyst Shogun",
    emoji: "🐼",
    sphereBase: "#6938e6",
    sphereDark: "#491eb8",
    sphereCrescent: "#9065ff",
    ringColor: "#b89cff",
    eyes: "dots",
    mouth: "smile",
    accessory: "top_bun",
  },
  {
    id: "ocean_band",
    label: "Ocean Tiger",
    emoji: "🐯",
    sphereBase: "#2378cc",
    sphereDark: "#165494",
    sphereCrescent: "#56a2ed",
    ringColor: "#8ec4f7",
    eyes: "flat",
    mouth: "smile",
    accessory: "light_band",
  },
  {
    id: "amethyst_zen",
    label: "Royal Unicorn",
    emoji: "🦄",
    sphereBase: "#6938e6",
    sphereDark: "#491eb8",
    sphereCrescent: "#9065ff",
    ringColor: "#b89cff",
    eyes: "curve",
    mouth: "neutral",
  },
  {
    id: "cerulean_bun",
    label: "Cerulean Party",
    emoji: "🥳",
    sphereBase: "#2176c7",
    sphereDark: "#15518c",
    sphereCrescent: "#539fe8",
    ringColor: "#8bc1f7",
    eyes: "curve",
    mouth: "smile",
    accessory: "top_bun",
  },
  // Row 5
  {
    id: "scarlet_crown",
    label: "Scarlet Eagle",
    emoji: "🦅",
    sphereBase: "#de4331",
    sphereDark: "#9e2619",
    sphereCrescent: "#f57062",
    ringColor: "#fba398",
    eyes: "curve",
    mouth: "smile",
    accessory: "gold_band",
  },
  {
    id: "orchid_spark",
    label: "Cosmic Alien",
    emoji: "👽",
    sphereBase: "#9c32db",
    sphereDark: "#6e1ca1",
    sphereCrescent: "#c062f7",
    ringColor: "#dc9cff",
    eyes: "curve",
    mouth: "smile",
  },
  {
    id: "azure_visor",
    label: "Azure Champion",
    emoji: "🏆",
    sphereBase: "#2479cc",
    sphereDark: "#165494",
    sphereCrescent: "#57a3ed",
    ringColor: "#8ec4f7",
    eyes: "dots",
    mouth: "smile",
    accessory: "light_band",
  },
  {
    id: "turquoise_pro",
    label: "Lagoon Racer",
    emoji: "🏎️",
    sphereBase: "#157d8c",
    sphereDark: "#0c5661",
    sphereCrescent: "#42a6b5",
    ringColor: "#7dcad6",
    eyes: "curve",
    mouth: "smile",
    accessory: "dark_band",
  },
];

const AVATAR_LOOKUP = new Map<string, GamerAvatarSpec>(
  GAMER_AVATAR_CATALOG.map((item) => [item.id, item])
);

export function resolveAvatarSpec(avatarIdOrSeed?: string | null): GamerAvatarSpec {
  if (!avatarIdOrSeed) return GAMER_AVATAR_CATALOG[0];
  const exact = AVATAR_LOOKUP.get(avatarIdOrSeed);
  if (exact) return exact;
  const byEmoji = GAMER_AVATAR_CATALOG.find((item) => item.emoji === avatarIdOrSeed);
  if (byEmoji) return byEmoji;
  let hash = 0;
  for (let i = 0; i < avatarIdOrSeed.length; i++) {
    hash = (hash * 31 + avatarIdOrSeed.charCodeAt(i)) >>> 0;
  }
  const base = GAMER_AVATAR_CATALOG[hash % GAMER_AVATAR_CATALOG.length];
  // If a literal single emoji was passed, preserve it on top of the hashed sphere
  if (avatarIdOrSeed.length <= 4 && /[^\u0000-\u007f]/.test(avatarIdOrSeed)) {
    return { ...base, emoji: avatarIdOrSeed };
  }
  return base;
}

// ── 2. GLOSSY 3D VERIFIED GAMER AVATAR COMPONENT ─────────────────────────────
interface VerifiedGamerAvatarProps {
  avatarId?: string | null;
  customImageUrl?: string | null;
  seedName?: string;
  size?: number;
  showVerifiedBadge?: boolean;
  showOuterBezel?: boolean;
  glow?: boolean;
  className?: string;
}

export const VerifiedGamerAvatar: React.FC<VerifiedGamerAvatarProps> = ({
  avatarId,
  customImageUrl,
  seedName = "Ghana Gamer",
  size = 44,
  showVerifiedBadge = true,
  showOuterBezel = true,
  glow = false,
  className = "",
}) => {
  const isDataOrHttp =
    avatarId &&
    (avatarId.startsWith("data:image/") ||
      avatarId.startsWith("http://") ||
      avatarId.startsWith("https://"));

  const finalCustomUrl = customImageUrl || (isDataOrHttp ? avatarId : null);
  const spec = useMemo(
    () => resolveAvatarSpec(isDataOrHttp ? seedName : avatarId || seedName),
    [avatarId, isDataOrHttp, seedName]
  );

  const badgeSize = Math.max(14, Math.round(size * 0.36));
  const emojiFontSize = Math.max(14, Math.round(size * 0.56));

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 select-none ${className}`}
      style={{
        width: size,
        height: size,
        filter: glow ? `drop-shadow(0 0 12px ${spec.sphereCrescent}66)` : undefined,
      }}
    >
      <div
        className="w-full h-full rounded-full overflow-hidden relative flex items-center justify-center"
        style={{
          border: showOuterBezel
            ? `${Math.max(2, Math.round(size * 0.06))}px solid #0b0b12`
            : undefined,
          boxShadow: showOuterBezel
            ? "0 4px 12px rgba(0,0,0,0.45), inset 0 1px 2px rgba(255,255,255,0.25)"
            : undefined,
          background: spec.sphereBase,
        }}
      >
        {finalCustomUrl ? (
          <img
            src={finalCustomUrl}
            alt={seedName}
            className="w-full h-full object-cover"
          />
        ) : (
          <>
            <svg
              viewBox="0 0 100 100"
              className="w-full h-full block absolute inset-0"
              aria-hidden="true"
            >
              {/* Base Sphere */}
              <circle cx="50" cy="50" r="50" fill={spec.sphereBase} />

              {/* Top-Right Glossy Crescent Highlight */}
              <path
                d="M 52 0 A 50 50 0 0 1 100 52 C 82 54 54 32 52 0 Z"
                fill={spec.sphereCrescent}
                opacity="0.75"
              />

              {/* Subtle Bottom Rim Shadow */}
              <path
                d="M 12 82 A 50 50 0 0 0 88 82 C 74 93 26 93 12 82 Z"
                fill={spec.sphereDark}
                opacity="0.7"
              />

              {/* Inner Concentric Glossy Ring */}
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={spec.ringColor}
                strokeWidth="2.4"
                opacity="0.45"
              />
            </svg>
            {/* Real Full-Color Native Emoji Centered on Glossy Sphere */}
            <span
              role="img"
              aria-label={spec.label}
              className="relative z-10 flex items-center justify-center leading-none select-none"
              style={{
                fontSize: `${emojiFontSize}px`,
                fontFamily:
                  "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif",
                filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.42))",
                transform: "translateY(1px)",
              }}
            >
              {spec.emoji}
            </span>
          </>
        )}
      </div>

      {/* Cyan Scalloped Verified Badge at bottom-right */}
      {showVerifiedBadge && (
        <div
          className="absolute -bottom-0.5 -right-0.5 z-20 rounded-full flex items-center justify-center bg-[#00b4d8] shadow-md"
          style={{
            width: badgeSize,
            height: badgeSize,
            border: `${Math.max(1.8, Math.round(size * 0.05))}px solid #0b0b12`,
          }}
          title="Verified Arena Gamer"
        >
          <svg viewBox="0 0 24 24" className="w-[78%] h-[78%] block">
            {/* Scalloped White Seal Ring */}
            <path
              d="M12 2.2l2.1 1.4 2.5-.3 1.1 2.2 2.3 1.1-.3 2.5 1.4 2.1-1.4 2.1.3 2.5-2.3 1.1-1.1 2.2-2.5-.3-2.1 1.4-2.1-1.4-2.5.3-1.1-2.2-2.3-1.1.3-2.5-1.4-2.1 1.4-2.1-.3-2.5 2.3-1.1 1.1-2.2 2.5.3z"
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            {/* Checkmark */}
            <path
              d="M8.8 12.3l2.1 2.1 4.5-4.5"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
    </div>
  );
};

// ── 3. 4×5 AVATAR SELECTOR GRID (MATCHING SCREENSHOT 2) ──────────────────────
interface GamerAvatarPickerGridProps {
  selectedAvatarId: string;
  onSelectAvatar: (avatarId: string) => void;
}

export const GamerAvatarPickerGrid: React.FC<GamerAvatarPickerGridProps> = ({
  selectedAvatarId,
  onSelectAvatar,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCustomPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const targetSize = 240;
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const minSide = Math.min(img.width, img.height);
          const sx = (img.width - minSide) / 2;
          const sy = (img.height - minSide) / 2;
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, targetSize, targetSize);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.84);
          onSelectAvatar(dataUrl);
          triggerHapticSensor("capture");
          toast.success("Custom profile photo saved!");
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-black uppercase tracking-wider text-slate-300">
          Choose Your Glossy Gamer Avatar
        </span>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/30 text-[10px] font-black text-cyan-300 transition"
        >
          <Upload className="w-3 h-3" />
          Upload Photo
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleCustomPhotoUpload}
          className="hidden"
        />
      </div>

      {/* 4x5 Grid on Dark Navy Frame with White Rounded Tiles & Gold Checkmark */}
      <div className="grid grid-cols-4 gap-2.5 p-2.5 rounded-2xl bg-[#0a0c14] border border-white/10 max-h-[290px] overflow-y-auto">
        {GAMER_AVATAR_CATALOG.map((spec) => {
          const isSelected = selectedAvatarId === spec.id;
          return (
            <button
              key={spec.id}
              type="button"
              onClick={() => {
                triggerHapticSensor("tap");
                onSelectAvatar(spec.id);
              }}
              className={`relative aspect-square rounded-[20px] bg-[#f3f5fa] p-2 flex items-center justify-center transition-all duration-150 ${
                isSelected
                  ? "ring-[3px] ring-[#f5b82e] border-2 border-[#d99b16] scale-[1.03] shadow-[0_0_16px_rgba(245,184,46,0.45)]"
                  : "hover:scale-[1.03] opacity-95 hover:opacity-100 border border-transparent"
              }`}
              title={spec.label}
            >
              <VerifiedGamerAvatar
                avatarId={spec.id}
                size={54}
                showVerifiedBadge={false}
                showOuterBezel={false}
              />
              {isSelected && (
                <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[#f5b82e] text-[#11131a] flex items-center justify-center shadow">
                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── 4. DAILY LIFE STORY TYPES & DEFAULT SEEDED VISUAL STORIES ────────────────
export interface GamerStoryItem {
  id: string;
  user_id?: string | null;
  author_name: string;
  author_phone_masked?: string | null;
  avatar_id?: string | null;
  author_level: number;
  author_title: string;
  favorite_game: string;
  media_type: "image" | "video" | "text";
  media_url?: string | null;
  caption?: string | null;
  bg_gradient?: string | null;
  room_code?: string | null;
  game_type?: string | null;
  views_count: number;
  reactions?: Record<string, number>;
  created_at: string;
  expires_at?: string;
}

function createSvgStoryPosterDataUri(config: {
  bg1: string;
  bg2: string;
  accent: string;
  badge: string;
  title: string;
  subtitle: string;
  emoji: string;
}): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280" width="720" height="1280">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${config.bg1}"/>
        <stop offset="100%" stop-color="${config.bg2}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="38%" r="48%">
        <stop offset="0%" stop-color="${config.accent}" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="${config.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="720" height="1280" fill="url(#bg)"/>
    <circle cx="360" cy="480" r="340" fill="url(#glow)"/>
    <circle cx="120" cy="220" r="160" fill="#ffffff" fill-opacity="0.04"/>
    <circle cx="620" cy="1020" r="210" fill="#ffffff" fill-opacity="0.05"/>
    <rect x="70" y="250" width="580" height="680" rx="44" fill="#0b1020" fill-opacity="0.58" stroke="#ffffff" stroke-opacity="0.18" stroke-width="3"/>
    <rect x="210" y="310" width="300" height="54" rx="27" fill="${config.accent}" fill-opacity="0.22" stroke="${config.accent}" stroke-width="2"/>
    <text x="360" y="346" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-size="23" font-weight="800" letter-spacing="2">${config.badge}</text>
    <text x="360" y="520" text-anchor="middle" font-size="140">${config.emoji}</text>
    <text x="360" y="675" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-size="44" font-weight="900">${config.title}</text>
    <text x="360" y="740" text-anchor="middle" fill="#cbd5e1" font-family="system-ui, sans-serif" font-size="27" font-weight="600">${config.subtitle}</text>
    <rect x="150" y="805" width="420" height="68" rx="34" fill="${config.accent}"/>
    <text x="360" y="849" text-anchor="middle" fill="#090d16" font-family="system-ui, sans-serif" font-size="26" font-weight="900">⚡ SWIFTDATA ARENA</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const DEFAULT_COMMUNITY_STORIES: GamerStoryItem[] = [
  {
    id: "seed-story-1",
    author_name: "Nana Kwame",
    author_phone_masked: "0244***891",
    avatar_id: "royal_headband",
    author_level: 6,
    author_title: "Grandmaster",
    favorite_game: "oware",
    media_type: "image",
    media_url: createSvgStoryPosterDataUri({
      bg1: "#1e1b4b",
      bg2: "#0f172a",
      accent: "#f59e0b",
      badge: "OWARE ROYAL STREAK",
      title: "12 Seeds Captured!",
      subtitle: "East Legon Night Tournament • Who's Next?",
      emoji: "👑",
    }),
    caption: "Just cleared 6 pits in a row on Oware Royal! Drop your room code if you dare 🪵🔥",
    views_count: 48,
    reactions: { "🔥": 19, "👑": 11, "⚔️": 6 },
    game_type: "oware",
    created_at: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
  },
  {
    id: "seed-story-2",
    author_name: "Efua Mensah",
    author_phone_masked: "0551***402",
    avatar_id: "cerulean_bun",
    author_level: 5,
    author_title: "Alewa Queen",
    favorite_game: "candy",
    media_type: "image",
    media_url: createSvgStoryPosterDataUri({
      bg1: "#701a75",
      bg2: "#3b0764",
      accent: "#f43f5e",
      badge: "ALEWA & KUBE EDITION",
      title: "5x Kube Bomb Combo!",
      subtitle: "Scored 2,840 pts with 6 moves to spare",
      emoji: "🍬",
    }),
    caption: "This new Ghanaian Alewa & Kube Candy Crash is too addictive! Beat my 2,840 score 🍬✨",
    views_count: 63,
    reactions: { "❤️": 24, "🔥": 15, "😂": 5 },
    game_type: "candy",
    created_at: new Date(Date.now() - 47 * 60 * 1000).toISOString(),
  },
  {
    id: "seed-story-3",
    author_name: "Yaw Boateng",
    author_phone_masked: "0208***319",
    avatar_id: "orange_beam",
    author_level: 7,
    author_title: "8-Ball Sniper",
    favorite_game: "pool",
    media_type: "image",
    media_url: createSvgStoryPosterDataUri({
      bg1: "#064e3b",
      bg2: "#022c22",
      accent: "#10b981",
      badge: "8-BALL POOL CASHOUT",
      title: "Bank Shot on the 8-Ball!",
      subtitle: "Instant MoMo Payout • Zero Fouls",
      emoji: "🎱",
    }),
    caption: "Clean table clearance from break! Online right now for GH₵ 10 1v1 Pool tables 🎱💰",
    views_count: 39,
    reactions: { "🔥": 14, "👑": 9 },
    game_type: "pool",
    created_at: new Date(Date.now() - 85 * 60 * 1000).toISOString(),
  },
  {
    id: "seed-story-4",
    author_name: "Abena Osei",
    author_phone_masked: "0549***772",
    avatar_id: "purple_joy",
    author_level: 4,
    author_title: "Ludo Commander",
    favorite_game: "ludo",
    media_type: "text",
    caption: "Weekend Ludo Royal & Kelewele vibes in Kumasi! 🎲🔥 Tap Challenge if you want a fast 1v1 match!",
    bg_gradient: "from-purple-600 via-fuchsia-600 to-amber-500",
    views_count: 31,
    reactions: { "🔥": 12, "❤️": 8, "⚔️": 7 },
    game_type: "ludo",
    created_at: new Date(Date.now() - 125 * 60 * 1000).toISOString(),
  },
];

const LOCAL_STORIES_STORAGE_KEY = "swiftdata_daily_stories_cache_v1";

const STORY_GRADIENTS = [
  {
    id: "from-indigo-600 via-purple-600 to-pink-600",
    label: "Accra Neon",
  },
  {
    id: "from-emerald-600 via-teal-600 to-cyan-700",
    label: "Emerald Turf",
  },
  {
    id: "from-amber-500 via-orange-600 to-red-600",
    label: "Gold Coast Fire",
  },
  {
    id: "from-blue-600 via-indigo-700 to-slate-900",
    label: "Midnight Royal",
  },
];

interface DailyStoriesBarProps {
  currentUserId?: string | null;
  playerName: string;
  playerPhone: string;
  playerAvatarId: string;
  playerLevel: number;
  playerTitle: string;
  favoriteGame: string;
  activeRoomCode?: string | null;
  onJoinRoomCode?: (roomCode: string) => void;
  onChallengeStoryAuthor?: (author: {
    user_id?: string | null;
    display_name: string;
    favorite_game: string;
  }) => void;
}

export const DailyStoriesBar: React.FC<DailyStoriesBarProps> = ({
  currentUserId,
  playerName,
  playerPhone,
  playerAvatarId,
  playerLevel,
  playerTitle,
  favoriteGame,
  activeRoomCode,
  onJoinRoomCode,
  onChallengeStoryAuthor,
}) => {
  const [stories, setStories] = useState<GamerStoryItem[]>(() => {
    try {
      const cached = localStorage.getItem(LOCAL_STORIES_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return [...parsed, ...DEFAULT_COMMUNITY_STORIES];
        }
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_COMMUNITY_STORIES;
  });

  const [viewedStoryIds, setViewedStoryIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("swiftdata_viewed_stories_v1");
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });

  // Creator Modal State
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [createMode, setCreateMode] = useState<"image" | "video" | "text">("image");
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [bgGradient, setBgGradient] = useState(STORY_GRADIENTS[0].id);
  const [attachRoomCode, setAttachRoomCode] = useState(Boolean(activeRoomCode));
  const [posting, setPosting] = useState(false);

  // Full-Screen Viewer Modal State
  const [activeStoryIndex, setActiveStoryIndex] = useState<number | null>(null);
  const [storyProgress, setStoryProgress] = useState(0);
  const [videoMuted, setVideoMuted] = useState(false);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const invokeStoriesApi = useCallback(async (payload: Record<string, any>) => {
    const { data, error } = await supabase.functions.invoke("challenge-arena", {
      body: payload,
    });
    if (error) throw error;
    return data;
  }, []);

  const fetchStories = useCallback(async () => {
    try {
      const res = await invokeStoriesApi({ action: "get_stories" });
      if (res?.success && Array.isArray(res.stories)) {
        let localCached: GamerStoryItem[] = [];
        try {
          const raw = localStorage.getItem(LOCAL_STORIES_STORAGE_KEY);
          if (raw) localCached = JSON.parse(raw);
        } catch {
          // ignore
        }

        const combinedMap = new Map<string, GamerStoryItem>();
        for (const s of res.stories) combinedMap.set(s.id, s);
        for (const s of localCached) {
          if (!combinedMap.has(s.id)) combinedMap.set(s.id, s);
        }
        for (const s of DEFAULT_COMMUNITY_STORIES) {
          if (!combinedMap.has(s.id)) combinedMap.set(s.id, s);
        }

        setStories(Array.from(combinedMap.values()));
      }
    } catch {
      // Keep local + default stories if offline
    }
  }, [invokeStoriesApi]);

  useEffect(() => {
    fetchStories();
    const uid = `${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`arena-daily-stories-sync-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "game_user_stories" },
          () => {
            fetchStories();
          }
        )
        .subscribe();
    } catch {
      // Prevent duplicate subscription crashes
    }

    const handleLocalStorySync = () => {
      fetchStories();
    };
    window.addEventListener("swiftdata-stories-updated", handleLocalStorySync);

    return () => {
      window.removeEventListener("swiftdata-stories-updated", handleLocalStorySync);
      safeRemoveChannel(channel);
    };
  }, [fetchStories]);

  // Compress selected image into a fast, self-contained Data URL so it ALWAYS renders
  const compressImageFileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read image file"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => resolve(String(reader.result));
        img.onload = () => {
          const maxDim = 960;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(String(reader.result));
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });

  const handleSelectImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressedDataUrl = await compressImageFileToDataUrl(file);
      setSelectedFile(file);
      setMediaPreviewUrl(compressedDataUrl);
      setCreateMode("image");
      triggerHapticSensor("tap");
    } catch {
      toast.error("Could not load selected image.");
    }
  };

  const handleSelectVideo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) {
      toast.error("Please select a short video clip under 16 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSelectedFile(file);
      setMediaPreviewUrl(String(reader.result));
      setCreateMode("video");
      triggerHapticSensor("tap");
    };
    reader.readAsDataURL(file);
  };

  const handlePublishStory = async () => {
    if (createMode !== "text" && !mediaPreviewUrl) {
      toast.error(
        createMode === "image"
          ? "Please pick a photo from your device first!"
          : "Please pick a short video clip first!"
      );
      return;
    }
    if (createMode === "text" && !caption.trim()) {
      toast.error("Write a quick status message for your story!");
      return;
    }

    setPosting(true);
    try {
      let finalMediaUrl = mediaPreviewUrl;

      // Try uploading to Supabase Storage bucket `arena-stories` if a file was picked,
      // while keeping `mediaPreviewUrl` (data URL) as an instant guaranteed fallback!
      if (selectedFile && createMode !== "text") {
        try {
          const ext =
            selectedFile.name.split(".").pop()?.toLowerCase() ||
            (createMode === "video" ? "mp4" : "jpg");
          const path = `stories/${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("arena-stories")
            .upload(path, selectedFile, {
              cacheControl: "3600",
              upsert: false,
            });
          if (!upErr) {
            const { data: pubData } = supabase.storage
              .from("arena-stories")
              .getPublicUrl(path);
            if (pubData?.publicUrl) {
              finalMediaUrl = pubData.publicUrl;
            }
          }
        } catch {
          // Fallback to compressed data URL so the image/video ALWAYS shows
        }
      }

      const maskedPhone =
        playerPhone && playerPhone.trim().length >= 7
          ? `${playerPhone.trim().slice(0, 4)}***${playerPhone.trim().slice(-3)}`
          : "Verified Gamer";

      const localStory: GamerStoryItem = {
        id: `local-${Date.now()}`,
        user_id: currentUserId || null,
        author_name: playerName || "Ghana Champion",
        author_phone_masked: maskedPhone,
        avatar_id: playerAvatarId || "royal_headband",
        author_level: playerLevel || 1,
        author_title: playerTitle || "Arena Challenger",
        favorite_game: favoriteGame || "oware",
        media_type: createMode,
        media_url: createMode === "text" ? null : finalMediaUrl,
        caption: caption.trim() || null,
        bg_gradient: bgGradient,
        room_code: attachRoomCode && activeRoomCode ? activeRoomCode : null,
        game_type: favoriteGame || "oware",
        views_count: 1,
        reactions: { "🔥": 1 },
        created_at: new Date().toISOString(),
      };

      // Save locally first so the user sees their story immediately
      try {
        const existingRaw = localStorage.getItem(LOCAL_STORIES_STORAGE_KEY);
        const existingArr = existingRaw ? JSON.parse(existingRaw) : [];
        const updatedLocal = [localStory, ...existingArr].slice(0, 15);
        localStorage.setItem(LOCAL_STORIES_STORAGE_KEY, JSON.stringify(updatedLocal));
      } catch {
        // ignore quota errors
      }

      setStories((prev) => [localStory, ...prev]);

      // Also persist to Supabase backend for all other users
      try {
        const res = await invokeStoriesApi({
          action: "create_story",
          author_name: localStory.author_name,
          author_phone: playerPhone,
          avatar_id: localStory.avatar_id,
          author_level: localStory.author_level,
          author_title: localStory.author_title,
          favorite_game: localStory.favorite_game,
          media_type: localStory.media_type,
          media_url: localStory.media_url,
          caption: localStory.caption,
          bg_gradient: localStory.bg_gradient,
          room_code: localStory.room_code,
          game_type: localStory.game_type,
        });
        if (res?.success && res.story) {
          setStories((prev) => [
            res.story,
            ...prev.filter((s) => s.id !== localStory.id),
          ]);
        }
      } catch {
        // Already added to state & localStorage
      }

      playLevelUpFanfare();
      triggerHapticSensor("win");
      toast.success("Your Daily Life Story is live in the Arena!");
      setCreatorOpen(false);
      setMediaPreviewUrl(null);
      setSelectedFile(null);
      setCaption("");
      setActiveStoryIndex(0);
    } finally {
      setPosting(false);
    }
  };

  const openStoryAtIndex = (index: number) => {
    const target = stories[index];
    if (!target) return;
    triggerHapticSensor("tap");
    setActiveStoryIndex(index);
    setStoryProgress(0);

    if (!viewedStoryIds.has(target.id)) {
      const nextViewed = new Set(viewedStoryIds);
      nextViewed.add(target.id);
      setViewedStoryIds(nextViewed);
      try {
        localStorage.setItem(
          "swiftdata_viewed_stories_v1",
          JSON.stringify(Array.from(nextViewed))
        );
      } catch {
        // ignore
      }
      if (!target.id.startsWith("seed-") && !target.id.startsWith("local-")) {
        invokeStoriesApi({
          action: "react_story",
          story_id: target.id,
          increment_view: true,
        }).catch(() => {});
      }
    }
  };

  // Auto-advance full-screen story timer
  useEffect(() => {
    if (activeStoryIndex === null) return;
    const currentStory = stories[activeStoryIndex];
    if (!currentStory) {
      setActiveStoryIndex(null);
      return;
    }

    const durationMs = currentStory.media_type === "video" ? 12000 : 6500;
    const stepMs = 100;
    const increment = (stepMs / durationMs) * 100;

    const timer = window.setInterval(() => {
      setStoryProgress((prev) => {
        if (prev + increment >= 100) {
          if (activeStoryIndex < stories.length - 1) {
            setActiveStoryIndex(activeStoryIndex + 1);
            return 0;
          } else {
            setActiveStoryIndex(null);
            return 0;
          }
        }
        return prev + increment;
      });
    }, stepMs);

    return () => window.clearInterval(timer);
  }, [activeStoryIndex, stories]);

  const handleReactToStory = async (story: GamerStoryItem, emoji: string) => {
    triggerHapticSensor("capture");
    playTurnNotificationSound();
    setStories((prev) =>
      prev.map((s) => {
        if (s.id !== story.id) return s;
        const prevReactions = s.reactions || {};
        return {
          ...s,
          reactions: {
            ...prevReactions,
            [emoji]: Number(prevReactions[emoji] || 0) + 1,
          },
        };
      })
    );
    toast.success(`Sent ${emoji} to ${story.author_name}'s story!`);

    if (!story.id.startsWith("seed-") && !story.id.startsWith("local-")) {
      invokeStoriesApi({
        action: "react_story",
        story_id: story.id,
        emoji,
      }).catch(() => {});
    }
  };

  const handleDeleteStory = async (story: GamerStoryItem) => {
    setStories((prev) => prev.filter((s) => s.id !== story.id));
    try {
      const raw = localStorage.getItem(LOCAL_STORIES_STORAGE_KEY);
      if (raw) {
        const filtered = JSON.parse(raw).filter(
          (item: GamerStoryItem) => item.id !== story.id
        );
        localStorage.setItem(LOCAL_STORIES_STORAGE_KEY, JSON.stringify(filtered));
      }
    } catch {
      // ignore
    }
    if (!story.id.startsWith("seed-") && !story.id.startsWith("local-")) {
      invokeStoriesApi({
        action: "delete_story",
        story_id: story.id,
      }).catch(() => {});
    }
    setActiveStoryIndex(null);
    toast.success("Story removed.");
  };

  const formatTimeAgo = (iso: string) => {
    const mins = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  };

  const activeStory =
    activeStoryIndex !== null ? stories[activeStoryIndex] || null : null;

  return (
    <div className="w-full">
      {/* Horizontal Daily Life Stories Bar */}
      <div className="rounded-2xl bg-slate-900/85 border border-white/10 p-3 backdrop-blur-md shadow-xl">
        <div className="flex items-center justify-between mb-2.5 px-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-gradient-to-br from-pink-500 via-amber-400 to-cyan-400 text-slate-950 shadow">
              <Sparkles className="w-3.5 h-3.5" />
            </span>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-1.5">
                Gamer Daily Life Stories
                <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-pink-500/20 text-pink-300 border border-pink-400/30">
                  24H LIVE
                </span>
              </h3>
              <p className="text-[10px] text-slate-400">
                Share photos, videos & win moments or tap a gamer to view & challenge
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              triggerHapticSensor("tap");
              setCreatorOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 text-white font-black text-[11px] shadow-lg shadow-pink-500/20 hover:opacity-95 active:scale-95 transition"
          >
            <Camera className="w-3.5 h-3.5" />
            Post Story
          </button>
        </div>

        {/* Scrollable Story Cards */}
        <div className="flex items-center gap-3 overflow-x-auto pb-1.5 pt-0.5 no-scrollbar">
          {/* 1. "Add Your Story" Card */}
          <button
            type="button"
            onClick={() => {
              triggerHapticSensor("tap");
              setCreatorOpen(true);
            }}
            className="group relative shrink-0 w-[92px] h-[132px] rounded-2xl overflow-hidden bg-gradient-to-b from-slate-800/90 to-slate-950 border-2 border-dashed border-cyan-400/40 hover:border-cyan-400 flex flex-col items-center justify-between p-2.5 text-center transition-all hover:scale-[1.02]"
          >
            <div className="mt-1 relative">
              <VerifiedGamerAvatar
                avatarId={playerAvatarId}
                seedName={playerName}
                size={54}
                showVerifiedBadge={true}
              />
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-gradient-to-r from-pink-500 to-amber-400 text-slate-950 flex items-center justify-center shadow-md">
                <Plus className="w-3.5 h-3.5 stroke-[3]" />
              </span>
            </div>
            <div className="w-full">
              <span className="block text-[10px] font-black text-white leading-tight truncate">
                Your Story
              </span>
              <span className="block text-[9px] font-bold text-cyan-300 mt-0.5">
                + Photo / Video
              </span>
            </div>
          </button>

          {/* 2. Active Community Story Cards with Live Media Thumbnail + Glossy Avatar Badge */}
          {stories.map((story, idx) => {
            const isViewed = viewedStoryIds.has(story.id);
            return (
              <button
                key={story.id}
                type="button"
                onClick={() => openStoryAtIndex(idx)}
                className="group relative shrink-0 w-[96px] h-[132px] rounded-2xl overflow-hidden text-left transition-all hover:scale-[1.03] active:scale-95 shadow-lg"
                style={{
                  padding: "2px",
                  background: isViewed
                    ? "linear-gradient(135deg, rgba(148,163,184,0.45), rgba(71,85,105,0.45))"
                    : "linear-gradient(135deg, #ec4899, #f59e0b, #06b6d4)",
                }}
              >
                <div className="relative w-full h-full rounded-[14px] overflow-hidden bg-slate-950 flex flex-col justify-between">
                  {/* Thumbnail Background (Image, Video, or Text Gradient) */}
                  {story.media_type === "image" && story.media_url ? (
                    <img
                      src={story.media_url}
                      alt={story.caption || story.author_name}
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : story.media_type === "video" && story.media_url ? (
                    <video
                      src={story.media_url}
                      muted
                      playsInline
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className={`absolute inset-0 bg-gradient-to-br ${
                        story.bg_gradient ||
                        "from-indigo-600 via-purple-600 to-pink-600"
                      } p-2 flex items-center justify-center text-center`}
                    >
                      <p className="text-[9px] font-black text-white line-clamp-3 leading-snug drop-shadow">
                        {story.caption}
                      </p>
                    </div>
                  )}

                  {/* Dark Gradient Overlay for readability */}
                  <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/85 pointer-events-none" />

                  {/* Top Row: Glossy Avatar + Media Type Pill */}
                  <div className="relative z-10 flex items-center justify-between p-1.5">
                    <VerifiedGamerAvatar
                      avatarId={story.avatar_id}
                      seedName={story.author_name}
                      size={32}
                      showVerifiedBadge={true}
                    />
                    <span className="px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[8px] font-black text-white uppercase">
                      {story.media_type === "video"
                        ? "🎥"
                        : story.media_type === "image"
                        ? "📸"
                        : "📝"}
                    </span>
                  </div>

                  {/* Bottom Row: Author Name & Time */}
                  <div className="relative z-10 p-2">
                    <p className="text-[10px] font-black text-white truncate leading-tight">
                      {story.author_name}
                    </p>
                    <p className="text-[8px] font-semibold text-amber-300 truncate">
                      {formatTimeAgo(story.created_at)}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── STORY CREATOR MODAL (IMAGE, VIDEO, OR TEXT STATUS) ─────────────── */}
      {creatorOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-white/15 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/10 bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <VerifiedGamerAvatar
                  avatarId={playerAvatarId}
                  seedName={playerName}
                  size={38}
                  showVerifiedBadge={true}
                />
                <div>
                  <h4 className="text-sm font-black text-white">
                    Post Daily Life Story
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Visible to all gamers for 24 hours
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreatorOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="grid grid-cols-3 gap-2 p-3 bg-slate-950/40">
              <button
                type="button"
                onClick={() => setCreateMode("image")}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-black transition ${
                  createMode === "image"
                    ? "bg-gradient-to-r from-pink-500 to-amber-500 text-slate-950 shadow"
                    : "bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                Photo
              </button>
              <button
                type="button"
                onClick={() => setCreateMode("video")}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-black transition ${
                  createMode === "video"
                    ? "bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 shadow"
                    : "bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                Video
              </button>
              <button
                type="button"
                onClick={() => setCreateMode("text")}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-black transition ${
                  createMode === "text"
                    ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow"
                    : "bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
              >
                <Type className="w-3.5 h-3.5" />
                Status
              </button>
            </div>

            <div className="p-4 space-y-3.5">
              {/* Hidden File Inputs */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={handleSelectImage}
                className="hidden"
              />
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                onChange={handleSelectVideo}
                className="hidden"
              />

              {/* Preview Box */}
              {createMode === "image" && (
                <div className="relative rounded-2xl overflow-hidden border-2 border-dashed border-white/15 bg-slate-950 h-60 flex flex-col items-center justify-center">
                  {mediaPreviewUrl ? (
                    <>
                      <img
                        src={mediaPreviewUrl}
                        alt="Story preview"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        className="absolute bottom-3 right-3 px-3 py-1.5 rounded-xl bg-black/75 text-white text-xs font-bold border border-white/20"
                      >
                        Change Photo
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="flex flex-col items-center gap-2 p-6 text-center"
                    >
                      <span className="w-14 h-14 rounded-2xl bg-pink-500/20 border border-pink-400/40 flex items-center justify-center text-pink-300">
                        <ImageIcon className="w-7 h-7" />
                      </span>
                      <span className="text-sm font-black text-white">
                        Tap to Choose a Photo or Screenshot
                      </span>
                      <span className="text-xs text-slate-400">
                        Daily life moment, gaming setup, or win screenshot
                      </span>
                    </button>
                  )}
                </div>
              )}

              {createMode === "video" && (
                <div className="relative rounded-2xl overflow-hidden border-2 border-dashed border-white/15 bg-slate-950 h-60 flex flex-col items-center justify-center">
                  {mediaPreviewUrl ? (
                    <>
                      <video
                        src={mediaPreviewUrl}
                        controls
                        playsInline
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => videoInputRef.current?.click()}
                        className="absolute top-3 right-3 px-3 py-1.5 rounded-xl bg-black/75 text-white text-xs font-bold border border-white/20"
                      >
                        Change Video
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => videoInputRef.current?.click()}
                      className="flex flex-col items-center gap-2 p-6 text-center"
                    >
                      <span className="w-14 h-14 rounded-2xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300">
                        <Video className="w-7 h-7" />
                      </span>
                      <span className="text-sm font-black text-white">
                        Tap to Upload a Short Video Clip
                      </span>
                      <span className="text-xs text-slate-400">
                        Up to 16 MB • Daily life clip or game highlight
                      </span>
                    </button>
                  )}
                </div>
              )}

              {createMode === "text" && (
                <div className="space-y-2">
                  <div
                    className={`rounded-2xl bg-gradient-to-br ${bgGradient} p-5 h-48 flex items-center justify-center text-center shadow-inner`}
                  >
                    <textarea
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      placeholder="Type your daily status, shoutout, or open challenge callout..."
                      maxLength={240}
                      className="w-full bg-transparent text-center text-white placeholder:text-white/60 font-black text-base focus:outline-none resize-none"
                      rows={4}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {STORY_GRADIENTS.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setBgGradient(g.id)}
                        className={`flex-1 py-1.5 rounded-lg bg-gradient-to-r ${g.id} text-[10px] font-black text-white border ${
                          bgGradient === g.id
                            ? "border-white ring-2 ring-amber-400"
                            : "border-transparent opacity-75"
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Caption Input for Photo/Video */}
              {createMode !== "text" && (
                <input
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Add a caption to your story (optional)..."
                  maxLength={200}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                />
              )}

              {/* Optional Attach Active Room Code */}
              {activeRoomCode && (
                <label className="flex items-center justify-between p-2.5 rounded-xl bg-amber-500/10 border border-amber-400/25 cursor-pointer">
                  <span className="text-xs font-bold text-amber-200">
                    Attach Live Match Room #{activeRoomCode} (1-tap Join)
                  </span>
                  <input
                    type="checkbox"
                    checked={attachRoomCode}
                    onChange={(e) => setAttachRoomCode(e.target.checked)}
                    className="rounded accent-amber-400"
                  />
                </label>
              )}

              <button
                type="button"
                disabled={posting}
                onClick={handlePublishStory}
                className="w-full py-3 rounded-2xl bg-gradient-to-r from-pink-500 via-amber-500 to-cyan-500 text-slate-950 font-black text-sm shadow-lg hover:opacity-95 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                {posting ? "Publishing Story..." : "Share to Daily Stories"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FULL-SCREEN STORY VIEWER MODAL ─────────────────────────────────── */}
      {activeStory && activeStoryIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex items-center justify-center p-0 sm:p-4">
          <div className="relative w-full max-w-[420px] h-full sm:h-[86vh] sm:rounded-3xl overflow-hidden bg-slate-950 border border-white/15 flex flex-col justify-between shadow-2xl">
            {/* Segmented Progress Bars */}
            <div className="relative z-20 pt-3 px-3 space-y-2.5 bg-gradient-to-b from-black/80 via-black/40 to-transparent pb-4">
              <div className="flex items-center gap-1">
                {stories.map((s, idx) => (
                  <div
                    key={s.id}
                    className="flex-1 h-1 rounded-full bg-white/25 overflow-hidden"
                  >
                    <div
                      className="h-full bg-gradient-to-r from-amber-400 to-pink-500 transition-all duration-100"
                      style={{
                        width:
                          idx < activeStoryIndex
                            ? "100%"
                            : idx === activeStoryIndex
                            ? `${storyProgress}%`
                            : "0%",
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* Author Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <VerifiedGamerAvatar
                    avatarId={activeStory.avatar_id}
                    seedName={activeStory.author_name}
                    size={42}
                    showVerifiedBadge={true}
                  />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-black text-white">
                        {activeStory.author_name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 text-[9px] font-black">
                        Lv.{activeStory.author_level}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-300">
                      {activeStory.author_title} •{" "}
                      {formatTimeAgo(activeStory.created_at)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {activeStory.media_type === "video" && (
                    <button
                      type="button"
                      onClick={() => setVideoMuted((m) => !m)}
                      className="w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center"
                    >
                      {videoMuted ? (
                        <VolumeX className="w-4 h-4" />
                      ) : (
                        <Volume2 className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  {(activeStory.author_name === playerName ||
                    activeStory.id.startsWith("local-")) && (
                    <button
                      type="button"
                      onClick={() => handleDeleteStory(activeStory)}
                      className="w-8 h-8 rounded-full bg-red-500/25 text-red-300 hover:bg-red-500/40 flex items-center justify-center"
                      title="Delete story"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveStoryIndex(null)}
                    className="w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Center Story Stage */}
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
              {activeStory.media_type === "image" && activeStory.media_url ? (
                <img
                  src={activeStory.media_url}
                  alt={activeStory.caption || activeStory.author_name}
                  className="w-full h-full object-contain bg-black"
                />
              ) : activeStory.media_type === "video" && activeStory.media_url ? (
                <video
                  src={activeStory.media_url}
                  autoPlay
                  playsInline
                  muted={videoMuted}
                  loop
                  className="w-full h-full object-contain bg-black"
                />
              ) : (
                <div
                  className={`w-full h-full bg-gradient-to-br ${
                    activeStory.bg_gradient ||
                    "from-indigo-600 via-purple-600 to-pink-600"
                  } p-8 flex items-center justify-center text-center`}
                >
                  <p className="text-2xl font-black text-white leading-relaxed drop-shadow-md">
                    {activeStory.caption}
                  </p>
                </div>
              )}

              {/* Left / Right Tap Zones for Previous / Next Story */}
              {activeStoryIndex > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveStoryIndex(activeStoryIndex - 1);
                    setStoryProgress(0);
                  }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/75"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}
              {activeStoryIndex < stories.length - 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveStoryIndex(activeStoryIndex + 1);
                    setStoryProgress(0);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/75"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Bottom Caption, Reactions & 1-Tap Challenge CTA */}
            <div className="relative z-20 p-4 space-y-3 bg-gradient-to-t from-black/95 via-black/75 to-transparent">
              {activeStory.caption && activeStory.media_type !== "text" && (
                <p className="text-xs font-bold text-white bg-black/55 backdrop-blur-md px-3.5 py-2 rounded-xl border border-white/10">
                  {activeStory.caption}
                </p>
              )}

              {/* Emoji Reaction Bar & Views */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {["🔥", "❤️", "👑", "😂", "⚔️"].map((emoji) => {
                    const count = Number(activeStory.reactions?.[emoji] || 0);
                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => handleReactToStory(activeStory, emoji)}
                        className="px-2.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-black text-white flex items-center gap-1 active:scale-90 transition"
                      >
                        <span>{emoji}</span>
                        {count > 0 && (
                          <span className="text-[10px] text-amber-300">
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1 text-xs font-bold text-slate-300">
                  <Eye className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{activeStory.views_count || 1}</span>
                </div>
              </div>

              {/* Action Buttons: Join Attached Room or Challenge Story Author */}
              <div className="flex items-center gap-2">
                {activeStory.room_code && onJoinRoomCode && (
                  <button
                    type="button"
                    onClick={() => {
                      const code = activeStory.room_code!;
                      setActiveStoryIndex(null);
                      onJoinRoomCode(code);
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 shadow-lg"
                  >
                    <Flame className="w-4 h-4" />
                    Join Room #{activeStory.room_code}
                  </button>
                )}

                {onChallengeStoryAuthor &&
                  activeStory.author_name !== playerName && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveStoryIndex(null);
                        onChallengeStoryAuthor({
                          user_id: activeStory.user_id,
                          display_name: activeStory.author_name,
                          favorite_game: activeStory.favorite_game || "oware",
                        });
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 shadow-lg"
                    >
                      <Swords className="w-4 h-4" />
                      Challenge {activeStory.author_name.split(" ")[0]}
                    </button>
                  )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DailyStoriesBar;

