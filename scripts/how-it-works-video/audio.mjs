// Synthesises original background music and interface sounds as a stereo 16-bit WAV.
// Everything is generated here, so there is no third-party music to license.
const SAMPLE_RATE = 44100;
const BPM = 104;
const BEAT = 60 / BPM;
const CHORDS = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
const PLUCK_PATTERN = [0, 1.5, 2, 3, 3.5];
const KEY_SHIFT = { buy: 0, agent: 2, subagent: -3 };

const midiToHz = (note) => 440 * 2 ** ((note - 69) / 12);

const random = (() => {
  let seed = 12345;
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
})();

export function buildTrack(duration, events, pathId) {
  const length = Math.ceil(duration * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const shift = KEY_SHIFT[pathId] ?? 0;

  const add = (start, seconds, pan, sampleAt) => {
    const first = Math.round(start * SAMPLE_RATE);
    const count = Math.round(seconds * SAMPLE_RATE);
    for (let i = 0; i < count && first + i < length; i++) {
      if (first + i < 0) continue;
      const value = sampleAt(i / SAMPLE_RATE);
      left[first + i] += value * (1 - pan);
      right[first + i] += value * (1 + pan);
    }
  };

  const pad = (start, seconds, note, gain) => {
    const hz = midiToHz(note);
    add(start, seconds, 0, (t) => {
      const envelope = Math.min(1, t / 0.45) * Math.min(1, (seconds - t) / 0.45);
      return gain * envelope * (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(2 * Math.PI * hz * 1.003 * t));
    });
  };

  const pluck = (start, note, gain, pan) => {
    const hz = midiToHz(note);
    add(start, 0.9, pan, (t) => {
      const attack = Math.min(1, t / 0.004);
      return gain * attack * Math.exp(-t * 6.5) * (Math.sin(2 * Math.PI * hz * t) + 0.25 * Math.exp(-t * 14) * Math.sin(2 * Math.PI * hz * 4 * t));
    });
  };

  const bass = (start, note, gain) => {
    const hz = midiToHz(note);
    add(start, 0.7, 0, (t) => gain * Math.min(1, t / 0.008) * Math.exp(-t * 4.2) * Math.sin(2 * Math.PI * hz * t));
  };

  const shaker = (start, gain) => {
    let previous = 0;
    add(start, 0.05, 0.15, (t) => {
      const noise = random() * 2 - 1;
      const bright = noise - previous;
      previous = noise;
      return gain * Math.exp(-t * 90) * bright;
    });
  };

  const bars = Math.ceil(duration / (BEAT * 4));
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * BEAT * 4;
    const chord = CHORDS[bar % CHORDS.length].map((note) => note + shift);
    chord.forEach((note) => pad(barStart, BEAT * 4 + 0.3, note, 0.026));
    bass(barStart, chord[0] - 12, 0.17);
    bass(barStart + BEAT * 2.5, chord[0] - 12, 0.12);
    PLUCK_PATTERN.forEach((offset, i) => {
      pluck(barStart + offset * BEAT, chord[i % chord.length] + 12, 0.075, i % 2 ? 0.25 : -0.25);
    });
    for (let eighth = 1; eighth < 8; eighth += 2) shaker(barStart + (eighth * BEAT) / 2, 0.035);
  }

  for (const event of events) {
    if (event.type === "tap") {
      add(event.t, 0.09, 0, (t) => 0.2 * Math.exp(-t * 55) * Math.sin(2 * Math.PI * (1250 - 3500 * t) * t));
    } else {
      [84, 88, 91].forEach((note, i) => pluck(event.t + i * 0.1, note + shift, 0.17, 0));
    }
  }

  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    const fade = Math.min(1, t / 0.8) * Math.min(1, (duration - t) / 2);
    left[i] = Math.tanh(left[i] * fade * 1.4) * 0.72;
    right[i] = Math.tanh(right[i] * fade * 1.4) * 0.72;
  }

  const dataSize = length * 4;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataSize, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24); wav.writeUInt32LE(SAMPLE_RATE * 4, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < length; i++) {
    wav.writeInt16LE(Math.round(left[i] * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(right[i] * 32767), 46 + i * 4);
  }
  return wav;
}
