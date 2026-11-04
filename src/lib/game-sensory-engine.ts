// Procedural sound (SwiftArena audio engine), haptics, motion helpers and
// player level/point progression. Sound functions keep their old names so
// every game picks up the new engine without code changes.
import {
  getAudioSettings,
  sfx as arenaSfx,
  ui as arenaUi,
  updateAudioSettings,
} from "@/lib/audio/arenaAudio";

export function setGameSensoryPreferences(opts: {
  sound?: boolean;
  vibration?: boolean;
  soundEnabled?: boolean;
  vibrationEnabled?: boolean;
}) {
  const patch: { enabled?: boolean; vibration?: boolean } = {};
  if (typeof opts.sound === "boolean") patch.enabled = opts.sound;
  if (typeof opts.soundEnabled === "boolean") patch.enabled = opts.soundEnabled;
  if (typeof opts.vibration === "boolean") patch.vibration = opts.vibration;
  if (typeof opts.vibrationEnabled === "boolean") patch.vibration = opts.vibrationEnabled;
  updateAudioSettings(patch);
}

export function getGameSensoryPreferences() {
  const s = getAudioSettings();
  return { soundEnabled: s.enabled, vibrationEnabled: s.vibration };
}

export type HapticPreset =
  | "aim_tick"
  | "pocket_drop"
  | "seed_drop"
  | "dice_roll"
  | "victory"
  | "level_up"
  | "slice"
  | "bomb"
  | "tap"
  | "capture"
  | "win";

export function triggerHapticSensor(pattern: number | number[] | HapticPreset) {
  if (!getAudioSettings().vibration || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    let vibPattern: number | number[] = 15;
    if (typeof pattern === "string") {
      switch (pattern) {
        case "aim_tick":
          vibPattern = 10;
          break;
        case "seed_drop":
          vibPattern = 14;
          break;
        case "slice":
          vibPattern = 18;
          break;
        case "dice_roll":
          vibPattern = [22, 30, 22, 40];
          break;
        case "pocket_drop":
          vibPattern = [38, 42, 70];
          break;
        case "bomb":
          vibPattern = [140, 60, 180];
          break;
        case "level_up":
        case "victory":
          vibPattern = [65, 45, 65, 45, 150];
          break;
      }
    } else {
      vibPattern = pattern;
    }
    navigator.vibrate(vibPattern);
  } catch (_e) {
    // Ignore on unsupported desktop browsers
  }
}

/**
 * Leather cue-tip striking phenolic cue ball (scaled by shot power 15..100)
 */
export function playCueStrikeSound(powerPercent: number) {
  const gainScale = Math.min(1, Math.max(0.25, powerPercent / 100));
  triggerHapticSensor(Math.round(18 + gainScale * 32));
  arenaSfx.cueStrike(gainScale);
}

/**
 * Dual-resonator phenolic resin billiard ball-to-ball collision ("clack")
 * Pitch and volume dynamically scale with relative impact velocity.
 */
export function playBallClackSound(impactSpeed = 8) {
  const intensity = Math.min(1, Math.max(0.12, impactSpeed / 18));
  if (intensity > 0.25) triggerHapticSensor(Math.round(10 + intensity * 22));
  arenaSfx.ballClack(intensity);
}

/**
 * Rubber rail cushion thud
 */
export function playRailBounceSound(impactSpeed = 6) {
  arenaSfx.railBounce(Math.min(1, Math.max(0.15, impactSpeed / 14)));
}

/**
 * Pocket drop + metallic ball-return rail roll
 */
export function playPocketDropSound() {
  triggerHapticSensor("pocket_drop");
  arenaSfx.pocket();
}

/**
 * Foul / Cue ball scratch alert sound + double vibration
 */
export function playFoulAlertSound() {
  triggerHapticSensor([40, 30, 40]);
  arenaSfx.foul();
}

/**
 * Wooden nickernut seed drop in carved Oware terracotta bowl
 */
export function playWoodSeedClack(seedIndex = 0, pan = 0) {
  arenaSfx.seedClack(seedIndex, pan);
}

/**
 * 3D Dice roll rattle & bounce for Ghana Ludo
 */
export function playDiceRattleSound() {
  triggerHapticSensor("dice_roll");
  arenaSfx.diceRattle();
}

/**
 * Market Slash: Crisp blade swoosh + juicy fruit pop/squish (matches game_play_2_.mp4)
 */
export function playFruitSliceSound(comboCount = 1) {
  triggerHapticSensor("slice");
  arenaSfx.slice(comboCount);
}

/**
 * Market Slash: Bomb explosion deep boom + shockwave vibration
 */
export function playBombExplosionSound() {
  triggerHapticSensor("bomb");
  arenaSfx.bomb();
}

/**
 * Market Slash: Stall Cleared celebratory chime (+150 / +300 / +450 bonus)
 */
export function playStallClearedSound() {
  arenaSfx.stageClear();
}

/**
 * Celebratory Level-Up / Target Data Bundle Unlocked Fanfare
 */
export function playLevelUpFanfare() {
  // A short sparkle: the full win stinger plays once from the result screen.
  triggerHapticSensor("victory");
  arenaUi.reward();
}

/**
 * Distinct, pleasant two-tone chime when the active turn switches to the next player!
 * - When `isMyTurn === true`: bright ascending chime (G5 -> D6) + alert vibration
 * - When `isMyTurn === false`: soft warm handoff tone (E5 -> B4)
 */
export function playTurnNotificationSound(isMyTurn = true) {
  if (isMyTurn) triggerHapticSensor("tap");
  arenaUi.turn(isMyTurn);
}

/**
 * Ultra-crisp mechanical precision tick when scrolling the Pool Fine-Aiming Tray wheel
 */
export function playFineAimTickSound() {
  arenaUi.tick();
}

// ── Human-Sense Challenger Personas & Progressive Level / Point System ───────

export function playCandyPopSound(combo = 1) {
  triggerHapticSensor("tap");
  arenaSfx.candyPop(combo);
}

export interface HumanChallengerPersona {
  name: string;
  city: string;
  humanSensePercent: number;
  styleTag: string;
  avatarInitials: string;
}

const PERSONA_MAP: Record<
  "oware" | "ludo" | "dame" | "pool" | "slash" | "candy" | "buggy",
  HumanChallengerPersona
> = {
  oware: {
    name: "Nana Kwame Asante",
    city: "Kumasi",
    humanSensePercent: 93,
    styleTag: "Kumasi Cultural Centre Master",
    avatarInitials: "NK",
  },
  ludo: {
    name: "Abena Osei",
    city: "Accra (Osu)",
    humanSensePercent: 91,
    styleTag: "Osu Night Market Tactician",
    avatarInitials: "AO",
  },
  dame: {
    name: "Kofi Mensah",
    city: "Cape Coast",
    humanSensePercent: 94,
    styleTag: "Victoria Park Draughts Pro",
    avatarInitials: "KM",
  },
  pool: {
    name: "Yaw Boateng",
    city: "East Legon",
    humanSensePercent: 92,
    styleTag: "Snooker & 8-Ball Club Striker",
    avatarInitials: "YB",
  },
  slash: {
    name: "Auntie Ama Serwaa",
    city: "Makola & Kejetia",
    humanSensePercent: 94,
    styleTag: "Makola Fruit Stall Queen",
    avatarInitials: "AS",
  },
  candy: {
    name: "Efua Mensah",
    city: "Osu Oxford Street",
    humanSensePercent: 93,
    styleTag: "Oxford Street Sweet Cascade Pro",
    avatarInitials: "EM",
  },
  buggy: {
    name: "Kwame 'Suame Turbo' Mensah",
    city: "Labadi & Aburi Ridge",
    humanSensePercent: 93,
    styleTag: "Labadi Coast & Aburi Hairpin Rally Pro",
    avatarInitials: "KT",
  },
};

export const HUMAN_CHALLENGER_PERSONAS: HumanChallengerPersona[] &
  Record<"oware" | "ludo" | "dame" | "pool" | "slash" | "candy" | "buggy", HumanChallengerPersona> =
  Object.assign(
    [
      PERSONA_MAP.oware,
      PERSONA_MAP.ludo,
      PERSONA_MAP.dame,
      PERSONA_MAP.pool,
      PERSONA_MAP.slash,
      PERSONA_MAP.candy,
      PERSONA_MAP.buggy,
    ],
    PERSONA_MAP
  );

export type DataTargetTier = "1GB" | "2GB" | "5GB";

export interface DataTargetOption {
  size: DataTargetTier;
  label: string;
  pointsRequired: number;
  badge: string;
  desc: string;
}

const DATA_TARGET_LIST: DataTargetOption[] = [
  {
    size: "1GB",
    label: "1GB Free Data Bundle",
    pointsRequired: 5000,
    badge: "Starter Goal (Lvl 5)",
    desc: "Win 10+ verified timed matches & accumulate 5,000 Arena Points to unlock 1GB Free Data!",
  },
  {
    size: "2GB",
    label: "2GB Free Data Bundle",
    pointsRequired: 9500,
    badge: "Pro Goal (Lvl 8)",
    desc: "Accumulate 9,500 Arena Points across timed victories to unlock a 2GB Data Bundle!",
  },
  {
    size: "5GB",
    label: "5GB Non-Expiry Data Bundle",
    pointsRequired: 20000,
    badge: "Master Goal (Lvl 10)",
    desc: "Accumulate 20,000 Arena Points across verified timed matches to claim a 5GB Non-Expiry Data Bundle!",
  },
];

export const DATA_TARGET_CATALOG: DataTargetOption[] & Record<DataTargetTier, DataTargetOption> =
  Object.assign(DATA_TARGET_LIST, {
    "1GB": DATA_TARGET_LIST[0],
    "2GB": DATA_TARGET_LIST[1],
    "5GB": DATA_TARGET_LIST[2],
  });

export interface PlayerLevelStatus {
  level: number;
  title: string;
  pointsInCurrentLevel: number;
  pointsForNextLevel: number;
  levelProgressPercent: number;
  aiErrorSigmaRad: number; // Medium difficulty Gaussian error spread
  humanSensePercent: number;
  persona: HumanChallengerPersona;
}

export function getPlayerLevelStatus(totalPoints: number): PlayerLevelStatus {
  const safePts = Math.max(0, Math.floor(totalPoints || 0));
  const stepPts = 750;
  const level = Math.min(10, Math.floor(safePts / stepPts) + 1);
  const pointsInCurrentLevel = safePts % stepPts;
  const levelProgressPercent = Math.min(100, Math.round((pointsInCurrentLevel / stepPts) * 100));

  const titles: Record<number, string> = {
    1: "Club Contender (Medium)",
    2: "Rising Striker (Medium)",
    3: "Regional Hustler (Medium+)",
    4: "Division Specialist",
    5: "Kumasi Open Semi-Finalist",
    6: "Accra Premier Contender",
    7: "National Tour Pro",
    8: "Gold Coast Master",
    9: "Supreme Arena Tactician",
    10: "Ghana Legend",
  };

  // Medium difficulty starts with natural human hand-eye variance (0.032 rad ~= 1.8 deg)
  const aiErrorSigmaRad = Math.max(0.014, 0.034 - (level - 1) * 0.0022);
  const persona = HUMAN_CHALLENGER_PERSONAS[(level - 1) % HUMAN_CHALLENGER_PERSONAS.length];

  return {
    level,
    title: titles[level] || `Arena Pro`,
    pointsInCurrentLevel,
    pointsForNextLevel: stepPts,
    levelProgressPercent,
    aiErrorSigmaRad,
    humanSensePercent: persona.humanSensePercent,
    persona,
  };
}

/**
 * Box-Muller Gaussian random number generator (mean 0, standard deviation sigma)
 * Used to simulate realistic human hand-eye coordination spread instead of robotic perfection.
 */
export function sampleGaussianError(sigma: number): number {
  const u1 = Math.max(1e-6, Math.random());
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * sigma;
}
