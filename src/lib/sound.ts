// Reusable Audio Effects Utility for SwiftData Ghana
// Allows triggering premium UI sounds (e.g., Cha-ching, chime alerts) across any component

export const SOUNDS = {
  SUCCESS_CHIME: "/sounds/success.mp3", // Crisp digital chime
  SYSTEM_NOTIF: "/sounds/notification_system.mp3", // Modern system chime
  GLASS_TING: "synth:glass_ting",
  MARIMBA: "synth:marimba",
  LASER: "synth:laser",
  SOFT_ALERT: "synth:soft_alert",
  CASH_REGISTER: "synth:cash",
};

let audioContextUnlocked = false;
let synthContext: AudioContext | null = null;
let userHasInteracted = false;

const markInteracted = () => {
  userHasInteracted = true;
  document.removeEventListener("click", markInteracted, true);
  document.removeEventListener("touchstart", markInteracted, true);
  document.removeEventListener("keydown", markInteracted, true);
};
document.addEventListener("click", markInteracted, true);
document.addEventListener("touchstart", markInteracted, true);
document.addEventListener("keydown", markInteracted, true);

// Pre-unlock web audio to prevent browser autoplay restriction errors on click
export function unlockAudio() {
  if (audioContextUnlocked) return;
  const unlock = () => {
    audioContextUnlocked = true;
    if (!synthContext) {
      synthContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (synthContext.state === 'suspended') {
      synthContext.resume();
    }
    document.removeEventListener("click", unlock);
    document.removeEventListener("touchstart", unlock);
  };
  document.addEventListener("click", unlock);
  document.addEventListener("touchstart", unlock);
}

/**
 * Calls navigator.vibrate only after the user has interacted with the page.
 * Chrome blocks vibration until a user gesture has occurred in the frame.
 */
export function safeVibrate(pattern: number | number[]): boolean {
  if (!userHasInteracted) return false;
  if (typeof navigator === "undefined" || !navigator.vibrate) return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

const playSynth = (type: string, volume: number) => {
  if (!synthContext) {
    synthContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (synthContext.state === 'suspended') synthContext.resume();

  const ctx = synthContext;
  const t = ctx.currentTime;
  
  const playOsc = (freq: number, type: OscillatorType, start: number, duration: number, vol = 1, sweep = 0) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (sweep !== 0) {
      osc.frequency.exponentialRampToValueAtTime(freq * sweep, start + duration);
    }
    
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume * vol, start + duration * 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration);
  };

  switch (type) {
    case "glass_ting":
      playOsc(1200, "sine", t, 0.4, 0.5);
      playOsc(2400, "sine", t, 0.3, 0.3);
      break;
    case "marimba":
      playOsc(600, "sine", t, 0.3, 0.8);
      playOsc(1200, "sine", t + 0.1, 0.3, 0.6);
      break;
    case "laser":
      playOsc(800, "triangle", t, 0.3, 0.6, 0.1);
      break;
    case "soft_alert":
      playOsc(440, "sine", t, 0.2, 0.5);
      playOsc(554, "sine", t + 0.15, 0.4, 0.5);
      break;
    case "cash":
      playOsc(800, "square", t, 0.1, 0.3);
      playOsc(1200, "square", t + 0.05, 0.2, 0.3);
      playOsc(1600, "square", t + 0.1, 0.4, 0.4);
      break;
  }
};

export function playSound(path: string, volume = 0.4) {
  try {
    if (path.startsWith("synth:")) {
      playSynth(path.replace("synth:", ""), volume);
      return;
    }

    const audio = new Audio(path);
    audio.crossOrigin = "anonymous";
    audio.volume = volume;
    const playPromise = audio.play();
    
    if (playPromise !== undefined) {
      playPromise.catch((error) => {
        // Browser autoplay block fallback
        console.log("[Audio] Playback paused until user interaction.", error.message);
      });
    }
  } catch (err) {
    console.error("[Audio] Fatal audio execution failure:", err);
  }
}

export function playSuccessSound() {
  playSound(SOUNDS.SUCCESS_CHIME, 0.5);
}

export function playAlertSound() {
  playSound(SOUNDS.SYSTEM_NOTIF, 0.4);
}
