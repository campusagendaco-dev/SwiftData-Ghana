/**
 * SwiftArena audio engine.
 *
 * One AudioContext with a proper mix:   sfx ─┐
 *                                        ui ─┼─► master ─► limiter ─► speakers
 *                                     music ─┘      ▲
 *                     (sfx/ui) ─► reverb send ─► room reverb
 *
 * Every sound is synthesised (no downloads) from layered parts: a short noise
 * transient for the attack, tuned partials for the body, and a little room
 * reverb, so wood sounds like wood and fruit sounds wet instead of "beep".
 * Settings (on/off, volumes, music, vibration) persist per device.
 */

export interface ArenaAudioSettings {
  enabled: boolean;
  sfxVolume: number; // 0..1
  musicEnabled: boolean; // off by default
  musicVolume: number; // 0..1
  vibration: boolean;
}

const STORAGE_KEY = "swiftarena_audio_v1";
const DEFAULTS: ArenaAudioSettings = { enabled: true, sfxVolume: 0.8, musicEnabled: false, musicVolume: 0.45, vibration: true };

function loadSettings(): ArenaAudioSettings {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // storage unavailable
  }
  return { ...DEFAULTS };
}

let settings: ArenaAudioSettings = loadSettings();
const listeners = new Set<(s: ArenaAudioSettings) => void>();

export function getAudioSettings(): ArenaAudioSettings {
  return settings;
}

export function updateAudioSettings(patch: Partial<ArenaAudioSettings>) {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
  applyVolumes();
  if (!settings.enabled || !settings.musicEnabled) stopMusic(true);
  else if (musicWanted) startMusic(musicWanted);
  listeners.forEach((l) => l(settings));
}

export function subscribeAudioSettings(fn: (s: ArenaAudioSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ───────────────────────────── graph ───────────────────────────── */

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  ui: GainNode;
  music: GainNode;
  reverbSend: GainNode;
}

let graph: Graph | null = null;

function buildImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function getGraph(): Graph | null {
  if (typeof window === "undefined") return null;
  if (graph) {
    if (graph.ctx.state === "suspended") graph.ctx.resume().catch(() => {});
    return graph;
  }
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    const ctx: AudioContext = new Ctx();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);

    const master = ctx.createGain();
    master.connect(limiter);

    const reverb = ctx.createConvolver();
    reverb.buffer = buildImpulse(ctx, 1.4, 3.2);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.22;
    reverb.connect(reverbReturn);
    reverbReturn.connect(master);
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 1;
    reverbSend.connect(reverb);

    const sfx = ctx.createGain();
    const ui = ctx.createGain();
    const music = ctx.createGain();
    sfx.connect(master);
    ui.connect(master);
    music.connect(master);

    graph = { ctx, master, sfx, ui, music, reverbSend };
    applyVolumes();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return graph;
  } catch {
    return null;
  }
}

function applyVolumes() {
  if (!graph) return;
  const t = graph.ctx.currentTime;
  graph.master.gain.setTargetAtTime(settings.enabled ? 1 : 0, t, 0.02);
  graph.sfx.gain.setTargetAtTime(settings.sfxVolume, t, 0.02);
  graph.ui.gain.setTargetAtTime(settings.sfxVolume * 0.7, t, 0.02);
  graph.music.gain.setTargetAtTime(settings.musicEnabled ? settings.musicVolume * 0.35 : 0, t, 0.1);
}

/** Call from any user gesture so audio is allowed to start on iOS/Android. */
export function unlockArenaAudio() {
  const g = getGraph();
  if (g && g.ctx.state !== "running") g.ctx.resume().catch(() => {});
}

if (typeof document !== "undefined") {
  const unlock = () => {
    unlockArenaAudio();
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("keydown", unlock, true);
  };
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopMusic(true);
    else if (musicWanted && settings.enabled && settings.musicEnabled) startMusic(musicWanted);
  });
}

/* ─────────────────────────── primitives ─────────────────────────── */

type Bus = "sfx" | "ui" | "music";

interface Voice {
  out: AudioNode;
  t: number;
  g: Graph;
}

/** A gain → (pan) → bus chain with an optional reverb send, starting at `delay` seconds. */
function voice(bus: Bus, opts: { pan?: number; reverb?: number; delay?: number } = {}): Voice | null {
  if (!settings.enabled) return null;
  const g = getGraph();
  if (!g) return null;
  const target = g[bus];
  let out: AudioNode = target;
  if (opts.pan && typeof g.ctx.createStereoPanner === "function") {
    const p = g.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, opts.pan));
    p.connect(target);
    out = p;
  }
  if (opts.reverb) {
    const send = g.ctx.createGain();
    send.gain.value = opts.reverb;
    send.connect(g.reverbSend);
    const split = g.ctx.createGain();
    split.connect(out);
    split.connect(send);
    out = split;
  }
  return { out, t: g.ctx.currentTime + (opts.delay || 0) + 0.005, g };
}

function tone(
  v: Voice,
  o: { freq: number; freqEnd?: number; type?: OscillatorType; dur: number; gain: number; attack?: number; offset?: number }
) {
  const { ctx } = v.g;
  const t0 = v.t + (o.offset || 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type || "sine";
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + o.dur);
  const a = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + o.dur);
  osc.connect(g);
  g.connect(v.out);
  osc.start(t0);
  osc.stop(t0 + a + o.dur + 0.02);
}

let noiseBuffer: AudioBuffer | null = null;
function getNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const len = ctx.sampleRate;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function noise(
  v: Voice,
  o: { dur: number; gain: number; filter?: BiquadFilterType; freq?: number; freqEnd?: number; q?: number; attack?: number; offset?: number }
) {
  const { ctx } = v.g;
  const t0 = v.t + (o.offset || 0);
  const src = ctx.createBufferSource();
  src.buffer = getNoise(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filter || "bandpass";
  f.frequency.setValueAtTime(o.freq || 1200, t0);
  if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.freqEnd), t0 + o.dur);
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  const a = o.attack ?? 0.002;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + o.dur);
  src.connect(f);
  f.connect(g);
  g.connect(v.out);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + a + o.dur + 0.02);
}

/** Modal "wood" body: inharmonic partials with fast decay (a real wooden knock's spectrum). */
function woodBody(v: Voice, base: number, gain: number, dur = 0.12, offset = 0) {
  const partials: [number, number][] = [
    [1, 1],
    [2.57, 0.45],
    [4.12, 0.22],
  ];
  for (const [mult, amp] of partials) {
    tone(v, { freq: base * mult, dur: dur / mult ** 0.5, gain: gain * amp, type: "sine", attack: 0.0015, offset });
  }
}

/** Bell / marimba partials for chimes and stingers. */
function bell(v: Voice, freq: number, gain: number, dur = 0.9, offset = 0) {
  tone(v, { freq, dur, gain, type: "sine", attack: 0.003, offset });
  tone(v, { freq: freq * 2.0, dur: dur * 0.5, gain: gain * 0.35, type: "sine", attack: 0.003, offset });
  tone(v, { freq: freq * 3.01, dur: dur * 0.25, gain: gain * 0.12, type: "sine", attack: 0.002, offset });
}

const rnd = (spread: number) => 1 + (Math.random() * 2 - 1) * spread;
const note = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12);

/* ──────────────────────────── sound kit ──────────────────────────── */

export const sfx = {
  /** A wooden piece set down on a board (Dame move). */
  piecePlace(pan = 0, weight = 1) {
    const v = voice("sfx", { pan, reverb: 0.25 });
    if (!v) return;
    noise(v, { dur: 0.018, gain: 0.35 * weight, filter: "highpass", freq: 2200 });
    woodBody(v, 420 * rnd(0.06), 0.42 * weight, 0.11);
    tone(v, { freq: 110, freqEnd: 70, dur: 0.07, gain: 0.25 * weight, type: "sine" });
  },
  /** Piece sliding across the board. */
  pieceSlide(pan = 0) {
    const v = voice("sfx", { pan, reverb: 0.1 });
    if (!v) return;
    noise(v, { dur: 0.16, gain: 0.08, filter: "bandpass", freq: 900, freqEnd: 1600, q: 0.7, attack: 0.03 });
  },
  /** Jump + capture: knock, lift, and the captured piece clattering off. */
  capture(pan = 0) {
    const v = voice("sfx", { pan, reverb: 0.3 });
    if (!v) return;
    woodBody(v, 520 * rnd(0.05), 0.45, 0.12);
    noise(v, { dur: 0.05, gain: 0.3, filter: "highpass", freq: 1800 });
    woodBody(v, 680 * rnd(0.05), 0.28, 0.09, 0.07);
    woodBody(v, 760 * rnd(0.05), 0.18, 0.08, 0.12);
    tone(v, { freq: 95, freqEnd: 55, dur: 0.12, gain: 0.3, type: "sine" });
  },
  /** Promotion to king: rising bell triad. */
  crown() {
    const v = voice("sfx", { reverb: 0.45 });
    if (!v) return;
    [0, 4, 7, 12].forEach((s, i) => bell(v, note(3 + s), 0.16, 0.8, i * 0.07));
  },
  /** Oware seed dropped into a carved bowl; pitch varies, panned by bowl. */
  seedClack(index = 0, pan = 0) {
    const v = voice("sfx", { pan, reverb: 0.22 });
    if (!v) return;
    const pitch = 1600 * rnd(0.12) * (1 + (index % 4) * 0.03);
    noise(v, { dur: 0.012, gain: 0.28, filter: "bandpass", freq: 3200, q: 2 });
    woodBody(v, pitch / 2.6, 0.22, 0.06);
    tone(v, { freq: pitch, dur: 0.035, gain: 0.08, type: "triangle" });
  },
  /** A handful of seeds harvested (capture in Oware). */
  harvest(count = 4) {
    const v = voice("sfx", { reverb: 0.3 });
    if (!v) return;
    for (let i = 0; i < Math.min(8, count); i++) {
      noise(v, { dur: 0.015, gain: 0.18, filter: "bandpass", freq: 2600 * rnd(0.2), q: 2, offset: i * 0.035 });
      woodBody(v, 600 * rnd(0.15), 0.12, 0.05, i * 0.035);
    }
    bell(v, note(7), 0.1, 0.5, Math.min(8, count) * 0.035);
  },
  /** Blade through fruit: airy swish + wet splat; brighter for bigger combos. */
  slice(combo = 1, pan = 0) {
    const v = voice("sfx", { pan, reverb: 0.15 });
    if (!v) return;
    const lift = Math.min(6, combo - 1) * 0.08;
    noise(v, { dur: 0.13, gain: 0.32, filter: "bandpass", freq: 5200 * (1 + lift), freqEnd: 1400, q: 0.9, attack: 0.006 });
    noise(v, { dur: 0.09, gain: 0.3, filter: "lowpass", freq: 900, freqEnd: 300, q: 0.7, offset: 0.03 });
    tone(v, { freq: 180, freqEnd: 90, dur: 0.06, gain: 0.18, offset: 0.03 });
  },
  /** Fruit landing / juice splash. */
  splat(pan = 0) {
    const v = voice("sfx", { pan, reverb: 0.1 });
    if (!v) return;
    noise(v, { dur: 0.12, gain: 0.22, filter: "lowpass", freq: 1200, freqEnd: 250, q: 0.8 });
  },
  /** Bomb: sub drop, crack, rumble tail. */
  bomb() {
    const v = voice("sfx", { reverb: 0.5 });
    if (!v) return;
    tone(v, { freq: 90, freqEnd: 28, dur: 0.9, gain: 0.7, type: "sine", attack: 0.002 });
    noise(v, { dur: 0.08, gain: 0.55, filter: "highpass", freq: 900 });
    noise(v, { dur: 1.1, gain: 0.4, filter: "lowpass", freq: 700, freqEnd: 90, q: 0.5, attack: 0.01 });
  },
  /** Combo stinger; climbs a pentatonic scale with the combo size. */
  combo(level = 3) {
    const v = voice("sfx", { reverb: 0.35 });
    if (!v) return;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    const steps = Math.min(scale.length, Math.max(2, level));
    for (let i = 0; i < steps; i++) bell(v, note(3 + scale[i]), 0.1, 0.35, i * 0.045);
  },
  /** Stage cleared. */
  stageClear() {
    const v = voice("sfx", { reverb: 0.4 });
    if (!v) return;
    [0, 4, 7, 12, 16].forEach((s, i) => bell(v, note(s), 0.14, 0.7, i * 0.09));
  },
  /** Dice rattle (Ludo). */
  diceRattle() {
    const v = voice("sfx", { reverb: 0.2 });
    if (!v) return;
    for (let i = 0; i < 7; i++) woodBody(v, 900 * rnd(0.25), 0.14, 0.04, i * 0.045 + Math.random() * 0.02);
  },
  /** Cue strike (Pool). */
  cueStrike(power = 0.6) {
    const v = voice("sfx", { reverb: 0.15 });
    if (!v) return;
    noise(v, { dur: 0.02, gain: 0.3 * power, filter: "highpass", freq: 2500 });
    woodBody(v, 300, 0.4 * power, 0.07);
  },
  /** Ball-on-ball clack (Pool). */
  ballClack(intensity = 0.6, pan = 0) {
    const v = voice("sfx", { pan, reverb: 0.15 });
    if (!v) return;
    tone(v, { freq: 2600 * rnd(0.05), dur: 0.03, gain: 0.3 * intensity, type: "sine" });
    tone(v, { freq: 3900 * rnd(0.05), dur: 0.02, gain: 0.15 * intensity, type: "sine" });
    noise(v, { dur: 0.01, gain: 0.2 * intensity, filter: "highpass", freq: 4000 });
  },
  railBounce(intensity = 0.5) {
    const v = voice("sfx", { reverb: 0.1 });
    if (!v) return;
    tone(v, { freq: 140, freqEnd: 90, dur: 0.08, gain: 0.35 * intensity });
    noise(v, { dur: 0.04, gain: 0.12 * intensity, filter: "lowpass", freq: 600 });
  },
  pocket() {
    const v = voice("sfx", { reverb: 0.25 });
    if (!v) return;
    woodBody(v, 220, 0.35, 0.15);
    noise(v, { dur: 0.25, gain: 0.12, filter: "lowpass", freq: 500, freqEnd: 150, offset: 0.03 });
  },
  candyPop(combo = 1) {
    const v = voice("sfx", { reverb: 0.2 });
    if (!v) return;
    tone(v, { freq: 600 * (1 + Math.min(6, combo) * 0.06), freqEnd: 1100, dur: 0.06, gain: 0.25, type: "sine" });
    noise(v, { dur: 0.03, gain: 0.12, filter: "bandpass", freq: 3000, q: 3 });
  },
  foul() {
    const v = voice("sfx", { reverb: 0.2 });
    if (!v) return;
    tone(v, { freq: note(-5), dur: 0.18, gain: 0.2, type: "triangle" });
    tone(v, { freq: note(-9), dur: 0.25, gain: 0.2, type: "triangle", offset: 0.14 });
  },
};

export const ui = {
  tap() {
    const v = voice("ui", { reverb: 0.05 });
    if (!v) return;
    woodBody(v, 1200, 0.12, 0.03);
  },
  toggle(on = true) {
    const v = voice("ui", { reverb: 0.05 });
    if (!v) return;
    tone(v, { freq: on ? 880 : 660, dur: 0.05, gain: 0.12 });
  },
  tick(urgent = false) {
    const v = voice("ui");
    if (!v) return;
    woodBody(v, urgent ? 1500 : 1100, urgent ? 0.18 : 0.1, 0.03);
  },
  /** Your turn: two-note marimba. Opponent's turn: one soft low note. */
  turn(isMyTurn = true) {
    const v = voice("ui", { reverb: 0.35 });
    if (!v) return;
    if (isMyTurn) {
      bell(v, note(3), 0.16, 0.5);
      bell(v, note(10), 0.14, 0.6, 0.12);
    } else {
      bell(v, note(-2), 0.08, 0.4);
    }
  },
  /** Incoming message / notification. */
  notify() {
    const v = voice("ui", { reverb: 0.3 });
    if (!v) return;
    bell(v, note(15), 0.1, 0.4);
    bell(v, note(19), 0.08, 0.5, 0.08);
  },
  /** Challenge invite: three-note rising call. */
  invite() {
    const v = voice("ui", { reverb: 0.35 });
    if (!v) return;
    [0, 5, 12].forEach((s, i) => bell(v, note(5 + s), 0.13, 0.5, i * 0.1));
  },
  reward() {
    const v = voice("ui", { reverb: 0.4 });
    if (!v) return;
    [0, 4, 7, 11, 14].forEach((s, i) => bell(v, note(7 + s), 0.1, 0.6, i * 0.06));
    noise(v, { dur: 0.6, gain: 0.04, filter: "highpass", freq: 6000, offset: 0.1 });
  },
  error() {
    const v = voice("ui", { reverb: 0.1 });
    if (!v) return;
    tone(v, { freq: 220, dur: 0.12, gain: 0.14, type: "triangle" });
    tone(v, { freq: 180, dur: 0.16, gain: 0.12, type: "triangle", offset: 0.1 });
  },
};

export const stingers = {
  win() {
    const v = voice("sfx", { reverb: 0.5 });
    if (!v) return;
    [0, 4, 7, 12].forEach((s, i) => bell(v, note(3 + s), 0.18, 1.0, i * 0.11));
    [12, 16, 19, 24].forEach((s, i) => bell(v, note(3 + s), 0.08, 1.2, 0.45 + i * 0.05));
    noise(v, { dur: 1.2, gain: 0.05, filter: "highpass", freq: 7000, offset: 0.4, attack: 0.2 });
  },
  lose() {
    const v = voice("sfx", { reverb: 0.5 });
    if (!v) return;
    [7, 3, 0, -5].forEach((s, i) => bell(v, note(s), 0.12, 0.9, i * 0.16));
  },
  draw() {
    const v = voice("sfx", { reverb: 0.45 });
    if (!v) return;
    bell(v, note(0), 0.12, 0.8);
    bell(v, note(7), 0.12, 0.8, 0.15);
  },
};

/* ──────────────────────────── music ──────────────────────────── */
// Optional, off by default: a soft generated loop (marimba bell pattern over a
// warm bass in a lilting 12/8 feel), scheduled with a lookahead timer.

let musicWanted: string | null = null;
let musicTimer: number | null = null;
let nextBeatTime = 0;
let beat = 0;

const MUSIC_SETS: Record<string, { tempo: number; root: number; mode: number[] }> = {
  default: { tempo: 96, root: -9, mode: [0, 2, 4, 7, 9] },
  oware: { tempo: 84, root: -9, mode: [0, 2, 4, 7, 9] },
  dame: { tempo: 78, root: -7, mode: [0, 3, 5, 7, 10] },
  slash: { tempo: 116, root: -5, mode: [0, 2, 4, 7, 9] },
};

function scheduleBeat(g: Graph, t: number, set: { root: number; mode: number[] }, step: number) {
  const bar = Math.floor(step / 12);
  const pos = step % 12;
  const chordShift = [0, 5, 7, 5][bar % 4];
  // bell pattern (classic West African 12/8 timeline)
  if ([0, 2, 4, 5, 7, 9, 11].includes(pos)) {
    const v: Voice = { out: g.music, t, g };
    tone(v, { freq: note(set.root + 24 + 7), dur: 0.08, gain: 0.05, type: "sine" });
  }
  // marimba melody on strong beats
  if (pos % 3 === 0) {
    const degree = set.mode[(step * 7 + bar) % set.mode.length];
    const v: Voice = { out: g.music, t, g };
    bell(v, note(set.root + 12 + chordShift + degree), 0.07, 0.45);
  }
  // bass
  if (pos === 0 || pos === 6 || pos === 9) {
    const v: Voice = { out: g.music, t, g };
    tone(v, { freq: note(set.root - 12 + chordShift), dur: 0.35, gain: 0.12, type: "triangle" });
  }
}

export function startMusic(key = "default") {
  musicWanted = key;
  if (!settings.enabled || !settings.musicEnabled) return;
  const g = getGraph();
  if (!g || musicTimer !== null) return;
  const set = MUSIC_SETS[key] || MUSIC_SETS.default;
  const stepDur = 60 / set.tempo / 3; // 12/8: three steps per beat
  nextBeatTime = g.ctx.currentTime + 0.1;
  beat = 0;
  musicTimer = window.setInterval(() => {
    while (nextBeatTime < g.ctx.currentTime + 0.25) {
      scheduleBeat(g, nextBeatTime, set, beat++);
      nextBeatTime += stepDur;
    }
  }, 60);
}

/** Stop the loop. `pause` keeps the wish so it resumes when the tab returns. */
export function stopMusic(pause = false) {
  if (musicTimer !== null) {
    window.clearInterval(musicTimer);
    musicTimer = null;
  }
  if (!pause) musicWanted = null;
}

/* ──────────────────────────── haptics ──────────────────────────── */

export function vibrate(pattern: number | number[]) {
  if (!settings.vibration || typeof navigator === "undefined" || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // unsupported
  }
}
