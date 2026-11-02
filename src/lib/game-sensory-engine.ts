// Procedural Web Audio API Sound Synthesizer, Haptic Vibration Sensor Controller,
// DeviceOrientation Motion Sensor Helper & Human-Sense Level/Point Progression Engine

let audioCtx: AudioContext | null = null;
let soundEnabled = true;
let vibrationEnabled = true;

function getAudioContext(): AudioContext | null {
  if (!soundEnabled || typeof window === "undefined") return null;
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch (_e) {
    return null;
  }
}

export function setGameSensoryPreferences(opts: {
  sound?: boolean;
  vibration?: boolean;
  soundEnabled?: boolean;
  vibrationEnabled?: boolean;
}) {
  if (typeof opts.sound === "boolean") soundEnabled = opts.sound;
  if (typeof opts.soundEnabled === "boolean") soundEnabled = opts.soundEnabled;
  if (typeof opts.vibration === "boolean") vibrationEnabled = opts.vibration;
  if (typeof opts.vibrationEnabled === "boolean") vibrationEnabled = opts.vibrationEnabled;
}

export function getGameSensoryPreferences() {
  return { soundEnabled, vibrationEnabled };
}

export type HapticPreset =
  | "aim_tick"
  | "pocket_drop"
  | "seed_drop"
  | "dice_roll"
  | "victory"
  | "level_up"
  | "slice"
  | "bomb";

export function triggerHapticSensor(pattern: number | number[] | HapticPreset) {
  if (!vibrationEnabled || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
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

  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(240 + gainScale * 140, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.065);

    gain.gain.setValueAtTime(0.42 * gainScale, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.075);
  } catch (_e) {}
}

/**
 * Dual-resonator phenolic resin billiard ball-to-ball collision ("clack")
 * Pitch and volume dynamically scale with relative impact velocity.
 */
export function playBallClackSound(impactSpeed = 8) {
  const intensity = Math.min(1, Math.max(0.12, impactSpeed / 18));
  if (intensity > 0.25) {
    triggerHapticSensor(Math.round(10 + intensity * 22));
  }

  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "triangle";
    const jitter = (Math.random() - 0.5) * 120;
    osc1.frequency.setValueAtTime(1820 + intensity * 280 + jitter, now);
    osc1.frequency.exponentialRampToValueAtTime(620, now + 0.038);

    osc2.frequency.setValueAtTime(3150 + jitter, now);
    osc2.frequency.exponentialRampToValueAtTime(1100, now + 0.025);

    gain.gain.setValueAtTime(0.34 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.042);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.045);
    osc2.stop(now + 0.03);
  } catch (_e) {}
}

/**
 * Rubber rail cushion thud
 */
export function playRailBounceSound(impactSpeed = 6) {
  const intensity = Math.min(1, Math.max(0.15, impactSpeed / 16));
  triggerHapticSensor(12);

  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(145 + intensity * 40, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.06);

    gain.gain.setValueAtTime(0.26 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  } catch (_e) {}
}

/**
 * Pocket drop + metallic ball-return rail roll
 */
export function playPocketDropSound() {
  triggerHapticSensor([40, 45, 75]);

  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const oscDrop = ctx.createOscillator();
    const gainDrop = ctx.createGain();
    oscDrop.type = "sine";
    oscDrop.frequency.setValueAtTime(190, now);
    oscDrop.frequency.exponentialRampToValueAtTime(62, now + 0.14);
    gainDrop.gain.setValueAtTime(0.38, now);
    gainDrop.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    oscDrop.connect(gainDrop);
    gainDrop.connect(ctx.destination);
    oscDrop.start(now);
    oscDrop.stop(now + 0.16);

    const oscChime = ctx.createOscillator();
    const gainChime = ctx.createGain();
    oscChime.type = "triangle";
    oscChime.frequency.setValueAtTime(587.33, now + 0.09); // D5
    oscChime.frequency.setValueAtTime(880, now + 0.17); // A5
    gainChime.gain.setValueAtTime(0.22, now + 0.09);
    gainChime.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    oscChime.connect(gainChime);
    gainChime.connect(ctx.destination);
    oscChime.start(now + 0.09);
    oscChime.stop(now + 0.35);
  } catch (_e) {}
}

/**
 * Foul / Cue ball scratch alert sound + double vibration
 */
export function playFoulAlertSound() {
  triggerHapticSensor([110, 55, 110]);
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(155, now + 0.22);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch (_e) {}
}

/**
 * Wooden nickernut seed drop in carved Oware terracotta bowl
 */
export function playWoodSeedClack(seedIndex = 0) {
  triggerHapticSensor(14);
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    const baseFreq = 640 + (seedIndex % 6) * 42;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(210, now + 0.045);
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  } catch (_e) {}
}

/**
 * 3D Dice roll rattle & bounce for Ghana Ludo
 */
export function playDiceRattleSound() {
  triggerHapticSensor([25, 35, 25, 45]);
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    [0, 0.06, 0.13].forEach((offset, idx) => {
      const now = ctx.currentTime + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(920 + idx * 180, now);
      osc.frequency.exponentialRampToValueAtTime(340, now + 0.04);
      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    });
  } catch (_e) {}
}

/**
 * Market Slash: Crisp blade swoosh + juicy fruit pop/squish (matches game_play_2_.mp4)
 */
export function playFruitSliceSound(comboCount = 1) {
  triggerHapticSensor(comboCount > 1 ? [18, 25, 28] : 18);
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const pitchBoost = Math.min(360, (comboCount - 1) * 65);

    // 1. Blade swoosh + juicy pop
    const oscPop = ctx.createOscillator();
    const gainPop = ctx.createGain();
    oscPop.type = "sine";
    oscPop.frequency.setValueAtTime(520 + pitchBoost, now);
    oscPop.frequency.exponentialRampToValueAtTime(980 + pitchBoost, now + 0.055);
    gainPop.gain.setValueAtTime(0.32, now);
    gainPop.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
    oscPop.connect(gainPop);
    gainPop.connect(ctx.destination);
    oscPop.start(now);
    oscPop.stop(now + 0.09);

    // 2. Crisp high-frequency slice shimmer
    const oscSlice = ctx.createOscillator();
    const gainSlice = ctx.createGain();
    oscSlice.type = "triangle";
    oscSlice.frequency.setValueAtTime(1650 + pitchBoost, now);
    oscSlice.frequency.exponentialRampToValueAtTime(420, now + 0.045);
    gainSlice.gain.setValueAtTime(0.2, now);
    gainSlice.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    oscSlice.connect(gainSlice);
    gainSlice.connect(ctx.destination);
    oscSlice.start(now);
    oscSlice.stop(now + 0.055);
  } catch (_e) {}
}

/**
 * Market Slash: Bomb explosion deep boom + shockwave vibration
 */
export function playBombExplosionSound() {
  triggerHapticSensor("bomb");
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.38);
    gain.gain.setValueAtTime(0.48, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.45);
  } catch (_e) {}
}

/**
 * Market Slash: Stall Cleared celebratory chime (+150 / +300 / +450 bonus)
 */
export function playStallClearedSound() {
  triggerHapticSensor([50, 35, 85]);
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const notes = [587.33, 783.99, 1046.5]; // D5, G5, C6
    notes.forEach((freq, idx) => {
      const now = ctx.currentTime + idx * 0.075;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.26);
    });
  } catch (_e) {}
}

/**
 * Celebratory Level-Up / Target Data Bundle Unlocked Fanfare
 */
export function playLevelUpFanfare() {
  triggerHapticSensor([70, 45, 70, 45, 160]);
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const now = ctx.currentTime + i * 0.085;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    });
  } catch (_e) {}
}

/**
 * Distinct, pleasant two-tone chime when the active turn switches to the next player!
 * - When `isMyTurn === true`: bright ascending chime (G5 -> D6) + alert vibration
 * - When `isMyTurn === false`: soft warm handoff tone (E5 -> B4)
 */
export function playTurnNotificationSound(isMyTurn = true) {
  triggerHapticSensor(isMyTurn ? [35, 45, 75] : 18);
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const notes = isMyTurn ? [783.99, 1174.66] : [659.25, 493.88];
    notes.forEach((freq, idx) => {
      const now = ctx.currentTime + idx * 0.095;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(isMyTurn ? 0.26 : 0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    });
  } catch (_e) {}
}

/**
 * Ultra-crisp mechanical precision tick when scrolling the Pool Fine-Aiming Tray wheel
 */
export function playFineAimTickSound() {
  triggerHapticSensor(8);
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1480, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.018);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.022);
  } catch (_e) {}
}

// ── Human-Sense Challenger Personas & Progressive Level / Point System ───────

export function playCandyPopSound(combo = 1) {
  triggerHapticSensor(combo > 1 ? [18, 24, 28] : 14);
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(330 + Math.min(8, combo) * 80, now);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.165);
  } catch (_e) {}
}

export interface HumanChallengerPersona {
  name: string;
  city: string;
  humanSensePercent: number;
  styleTag: string;
  avatarInitials: string;
}

const PERSONA_MAP: Record<
  "oware" | "ludo" | "dame" | "pool" | "slash" | "candy",
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
};

export const HUMAN_CHALLENGER_PERSONAS: HumanChallengerPersona[] &
  Record<"oware" | "ludo" | "dame" | "pool" | "slash" | "candy", HumanChallengerPersona> =
  Object.assign(
    [
      PERSONA_MAP.oware,
      PERSONA_MAP.ludo,
      PERSONA_MAP.dame,
      PERSONA_MAP.pool,
      PERSONA_MAP.slash,
      PERSONA_MAP.candy,
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
    pointsRequired: 1000,
    badge: "Starter Goal (Lvl 3)",
    desc: "Accumulate 1,000 Arena Points across matches, sliced fruit & potted balls to unlock 1GB Free Data!",
  },
  {
    size: "2GB",
    label: "2GB Free Data Bundle",
    pointsRequired: 2000,
    badge: "Pro Goal (Lvl 6)",
    desc: "Accumulate 2,000 Arena Points across levels to unlock a 2GB Data Bundle!",
  },
  {
    size: "5GB",
    label: "5GB Non-Expiry Data Bundle",
    pointsRequired: 4500,
    badge: "Master Goal (Lvl 10)",
    desc: "Accumulate 4,500 Arena Points to claim a massive 5GB Non-Expiry Data Bundle!",
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
  const stepPts = 350;
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
