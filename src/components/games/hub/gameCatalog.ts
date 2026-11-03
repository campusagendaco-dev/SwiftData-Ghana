export type GameType = "oware" | "ludo" | "dame" | "pool" | "slash" | "candy" | "buggy";

export type GameGenre = "board" | "strategy" | "reflex" | "puzzle" | "racing";

export interface GameCatalogEntry {
  id: GameType;
  name: string;
  shortTitle: string;
  categoryTag: string;
  statusTag: string;
  statusColor: "gold" | "green";
  subtitle: string;
  /** One-line pitch for the lobby card. */
  tagline: string;
  rulesSummary: string[];
  badge: string;
  emoji: string;
  gradient: string;
  genre: GameGenre;
  players: string;
  /** Typical match length shown on the card. */
  matchLength: string;
  /** Accent colour used for the card glow and chips. */
  accent: string;
  isNew?: boolean;
}

export const GAME_GENRES: { id: "all" | GameGenre; label: string }[] = [
  { id: "all", label: "All games" },
  { id: "board", label: "Board" },
  { id: "strategy", label: "Strategy" },
  { id: "reflex", label: "Reflex" },
  { id: "puzzle", label: "Puzzle" },
  { id: "racing", label: "Racing" },
];

export const GAME_CATALOG: GameCatalogEntry[] = [
  {
    id: "oware",
    name: "Oware",
    shortTitle: "Oware",
    categoryTag: "GHANA'S GAME",
    statusTag: "PLAY ONLINE",
    statusColor: "green",
    subtitle: "Our own board game. Beat Kofi, Ama and Nana, or send a friend a code and play online.",
    tagline: "Sow, count and capture. Ghana's classic mind game.",
    rulesSummary: [
      "Tap any of your 6 bowls on your side to scoop all seeds and sow counter-clockwise.",
      "Nam-Nam mode: relay-sow continuously and harvest whenever a bowl reaches 4 seeds.",
      "Abapa mode: single-lap sowing; capture opponent bowls holding 2 or 3 seeds.",
      "First player to capture 25 or more seeds wins the match!",
    ],
    badge: "Most Popular",
    emoji: "🪨",
    gradient: "from-amber-600/30 via-amber-900/20 to-slate-950 border-amber-500/40",
    genre: "board",
    players: "1v1",
    matchLength: "5–8 min",
    accent: "#f59e0b",
  },
  {
    id: "pool",
    name: "8-Ball Pool",
    shortTitle: "8-Ball Pool",
    categoryTag: "BILLIARDS",
    statusTag: "ONLINE",
    statusColor: "gold",
    subtitle: "Aim the laser cue, fine-tune stick angle on the left tray, and pull the cue stick to strike.",
    tagline: "Line it up, add spin, sink the black.",
    rulesSummary: [
      "Play in Landscape view for full tournament table precision.",
      "Use the Left Fine-Aim Tray to micro-adjust your cue angle and the Right Tray to pull & shoot.",
      "Pot all 7 of your group (Solids 1–7 or Stripes 9–15), then legally sink the Black 8-Ball.",
      "Scratching the white cue ball gives your opponent Ball-in-Hand anywhere on the felt.",
    ],
    badge: "Pro Physics",
    emoji: "🎱",
    gradient: "from-sky-600/30 via-blue-900/25 to-slate-950 border-sky-500/40",
    genre: "strategy",
    players: "1v1",
    matchLength: "6–10 min",
    accent: "#38bdf8",
  },
  {
    id: "slash",
    name: "Market Slash",
    shortTitle: "Market Slash",
    categoryTag: "REFLEX",
    statusTag: "NEW",
    statusColor: "gold",
    subtitle: "Swipe fast to slice flying Makola watermelons, pineapples & papayas while dodging bombs.",
    tagline: "Slice Makola fruit, chain combos, dodge bombs.",
    rulesSummary: [
      "Drag or swipe your finger across flying fruits to slice them with your blade.",
      "Slice 3+ fruits in a single swipe for multi-slice combo bonus points.",
      "Never touch the black explosives — hitting a bomb costs a life and drops your combo!",
      "Clear all 5 market stall stages with a higher score than your challenger to win.",
    ],
    badge: "Swipe & Slice",
    emoji: "🍉",
    gradient: "from-orange-600/35 via-amber-900/25 to-slate-950 border-orange-500/50",
    genre: "reflex",
    players: "Score duel",
    matchLength: "60 sec",
    accent: "#fb923c",
  },
  {
    id: "ludo",
    name: "Ghana Ludo",
    shortTitle: "Ghana Ludo",
    categoryTag: "BOARD",
    statusTag: "ONLINE",
    statusColor: "gold",
    subtitle: "52-cell track Ludo for 2–4 players. Roll a 6 to launch, kick opponents & race home.",
    tagline: "Roll, race and kick rivals back to base.",
    rulesSummary: [
      "Tap the 3D dice on your turn; roll a 6 to bring a token out of your Base onto your start square.",
      "Landing on an opponent token on a non-safe square sends it back to Base and grants a bonus roll.",
      "Rolling a 6, capturing an opponent, or reaching the center Home triangle earns an extra roll.",
      "First player to bring all 4 tokens into the center Home triangle wins!",
    ],
    badge: "2–4 Players",
    emoji: "🎲",
    gradient: "from-rose-600/30 via-amber-900/20 to-slate-950 border-rose-500/40",
    genre: "board",
    players: "2–4",
    matchLength: "10–15 min",
    accent: "#f43f5e",
  },
  {
    id: "dame",
    name: "Ghana Dame",
    shortTitle: "Ghana Dame",
    categoryTag: "STRATEGY",
    statusTag: "ONLINE",
    statusColor: "gold",
    subtitle: "8×8 Ghanaian checkers with mandatory jump captures and crowned Kings.",
    tagline: "Forced jumps, crowned kings, zero luck.",
    rulesSummary: [
      "Tap one of your pieces, then tap a highlighted diagonal square to move.",
      "Mandatory Capture Rule: if a jump over an opponent piece is available, you must take it.",
      "Reach the opponent's back row to crown your piece into a King that moves forward and backward.",
      "Capture all 12 opponent pieces or block all their legal moves to win!",
    ],
    badge: "Pure Skill",
    emoji: "♟️",
    gradient: "from-emerald-600/30 via-teal-900/20 to-slate-950 border-emerald-500/40",
    genre: "strategy",
    players: "1v1",
    matchLength: "8–12 min",
    accent: "#10b981",
  },
  {
    id: "candy",
    name: "Alewa Match",
    shortTitle: "Alewa Match",
    categoryTag: "GHANA SWEETS",
    statusTag: "NEW",
    statusColor: "gold",
    subtitle: "Match 3+ Ghanaian Alewa, Kube & Golden Cocoa Pods — forge Kente Boosters & Calabash Bombs.",
    tagline: "Match Alewa, Kube & cocoa pods in a 75-second rush.",
    rulesSummary: [
      "Swipe or tap two adjacent Ghanaian sweets (Alewa, Kube, Cocoa Pod, Nkate Cake, Sobolo, Bofrot) on the 8×8 wooden tray.",
      "Match 4 sweets to wrap a Red-Gold-Green Kente-Striped Booster that blasts an entire row or column.",
      "Match 5 sweets to forge a Takoradi Calabash Cocoa Bomb that wipes out every sweet of that type.",
      "Outscore Auntie Efua across 10 Ghana Markets (Makola, Osu, Kejetia) to earn up to 3 Stars and Free Data!",
    ],
    badge: "Match-3",
    emoji: "🍬",
    gradient: "from-amber-600/35 via-rose-900/25 to-slate-950 border-amber-500/45",
    genre: "puzzle",
    players: "Score duel",
    matchLength: "75 sec",
    accent: "#e879f9",
    isNew: true,
  },
  {
    id: "buggy",
    name: "Labadi Buggy GP",
    shortTitle: "Labadi Buggy GP",
    categoryTag: "GHANA RACING",
    statusTag: "NEW 3D",
    statusColor: "gold",
    subtitle:
      "Race 3 laps across Labadi Beach, Aburi Hills & Tema Motorway — hit Kente Boost Pads & upgrade at Suame Garage.",
    tagline: "3 laps from Labadi to Aburi. Boost, dodge, upgrade.",
    rulesSummary: [
      "Choose from 4 Ghanaian rides (Labadi Sand Buggy, Yellow-Yellow Pragya, VIP Sprinter Trotro, or Kantanka 4×4) and 3 circuits.",
      "Hit glowing yellow Kente Boost Pads and tap Shito Nitro (N₂) to blast past Kwame Turbo and the 6-racer pack.",
      "Dodge volcanic rocks, coconut palms, and beach huts so your Armor HP never hits 0 before finishing 3 laps.",
      "Collect spinning Gold Ghana Cedi Coins (GH₵) to upgrade your Engine, Nitro & Armor at the Suame Magazine Workshop!",
    ],
    badge: "Suame Turbo",
    emoji: "🏎️",
    gradient: "from-red-600/35 via-amber-900/25 to-slate-950 border-red-500/45",
    genre: "racing",
    players: "6-car race",
    matchLength: "3 laps",
    accent: "#ef4444",
    isNew: true,
  },
];

export const getGameMeta = (id: string | null | undefined) =>
  GAME_CATALOG.find((g) => g.id === id);
