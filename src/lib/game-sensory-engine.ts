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

export function setGameSensoryPreferences(opts: { sound?: boolean; vibration?: boolean }) {
  if (typeof opts.sound === "boolean") soundEnabled = opts.sound;
  if (typeof opts.vibration === "boolean") vibrationEnabled = opts.vibration;
}

export function getGameSensoryPreferences() {
  return { soundEnabled, vibrationEnabled };
}

export function triggerHapticSensor(pattern: number | number[]) {
  if (!vibrationEnabled || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
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

    // Primary resin click (1750 - 2200 Hz)
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
    // 1. Hollow leather pocket drop
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

    // 2. Pleasant reward chime on the chrome return rail
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

// ── Human-Sense Challenger Personas & Progressive Level / Point System ───────

export interface HumanChallengerPersona {
  name: string;
  city: string;
  humanSensePercent: number;
  styleTag: string;
  avatarInitials: string;
}

export const HUMAN_CHALLENGER_PERSONAS: HumanChallengerPersona[] = [
  {
    name: "Kwame Asante",
    city: "Kumasi",
    humanSensePercent: 92,
    styleTag: "Tactical Club Player",
    avatarInitials: "KA",
  },
  {
    name: "Kojo Mensah",
    city: "Accra (Osu)",
    humanSensePercent: 94,
    styleTag: "Sharp Cut-Shot Specialist",
    avatarInitials: "KM",
  },
  {
    name: "Nana Yaw Boateng",
    city: "Takoradi",
    humanSensePercent: 91,
    styleTag: "Smooth Pace & Control",
    avatarInitials: "NY",
  },
  {
    name: "Ebo Quansah",
    city: "Cape Coast",
    humanSensePercent: 93,
    styleTag: "Aggressive Break & Run",
    avatarInitials: "EQ",
  },
  {
    name: "Ibrahim Mohammed",
    city: "Tamale",
    humanSensePercent: 95,
    styleTag: "Regional Champion",
    avatarInitials: "IM",
  },
];

export const DATA_TARGET_CATALOG: Record<
  "1GB" | "2GB" | "5GB",
  { size: "1GB" | "2GB" | "5GB"; pointsRequired: number; badge: string; desc: string }
> = {
  "1GB": {
    size: "1GB",
    pointsRequired: 1000,
    badge: "Starter Goal (Lvl 3)",
    desc: "Accumulate 1,000 Arena Points across matches & potted balls to unlock 1GB Free Data!",
  },
  "2GB": {
    size: "2GB",
    pointsRequired: 2000,
    badge: "Pro Goal (Lvl 6)",
    desc: "Accumulate 2,000 Arena Points across levels to unlock a 2GB Data Bundle!",
  },
  "5GB": {
    size: "5GB",
    pointsRequired: 4500,
    badge: "Master Goal (Lvl 10)",
    desc: "Accumulate 4,500 Arena Points to claim a massive 5GB Non-Expiry Data Bundle!",
  },
};

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
    1: "Level 1 • Club Contender (Medium)",
    2: "Level 2 • Rising Striker (Medium)",
    3: "Level 3 • Regional Hustler (Medium+)",
    4: "Level 4 • Division Specialist",
    5: "Level 5 • Kumasi Open Semi-Finalist",
    6: "Level 6 • Accra Premier Contender",
    7: "Level 7 • National Tour Pro",
    8: "Level 8 • Gold Coast Master",
    9: "Level 9 • Supreme Arena Tactician",
    10: "Level 10 • Ghana Legend",
  };

  // Medium difficulty starts with natural human hand-eye variance (0.032 rad ~= 1.8 deg)
  // so the opponent makes normal shots (~75%) while missing ~30-35% of tough thin cuts!
  const aiErrorSigmaRad = Math.max(0.014, 0.034 - (level - 1) * 0.0022);
  const persona = HUMAN_CHALLENGER_PERSONAS[(level - 1) % HUMAN_CHALLENGER_PERSONAS.length];

  return {
    level,
    title: titles[level] || `Level ${level} • Arena Pro`,
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
