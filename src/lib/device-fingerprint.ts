/**
 * Hardware Canvas & WebGL Device Fingerprinting + Proof-of-Humanity Token
 * SwiftData Enterprise Anti-Bot Protection Matrix
 */

let lastHumanActivityTimestamp = 0;
let hasHumanInteraction = false;

// Attach passive listeners to track genuine browser interaction
if (typeof window !== "undefined") {
  const recordHumanActivity = () => {
    lastHumanActivityTimestamp = Date.now();
    hasHumanInteraction = true;
  };

  window.addEventListener("mousemove", recordHumanActivity, { passive: true });
  window.addEventListener("keydown", recordHumanActivity, { passive: true });
  window.addEventListener("touchstart", recordHumanActivity, { passive: true });
  window.addEventListener("scroll", recordHumanActivity, { passive: true });
}

/**
 * Generates a deterministic, persistent device hardware fingerprint hash
 */
export function getDeviceFingerprint(): string {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "server_env";
  }

  try {
    const cached = localStorage.getItem("swd_device_fp");
    if (cached && cached.length >= 16) {
      return cached;
    }

    const components: string[] = [];

    // 1. Screen properties
    components.push(`${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`);
    components.push(`dpr:${window.devicePixelRatio || 1}`);

    // 2. Navigator hardware
    components.push(`hc:${navigator.hardwareConcurrency || 4}`);
    components.push(`tz:${Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"}`);
    components.push(`lang:${navigator.language || "en"}`);

    // 3. Canvas Fingerprint
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 50;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.textBaseline = "top";
        ctx.font = "14px 'Arial'";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#f60";
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = "#069";
        ctx.fillText("SwiftData GH🔒", 2, 15);
        ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
        ctx.fillText("SwiftData GH🔒", 4, 17);
        components.push(`canvas:${canvas.toDataURL().slice(-50)}`);
      }
    } catch {
      components.push("canvas:fallback");
    }

    // 4. WebGL GPU vendor / renderer
    try {
      const canvas = document.createElement("canvas");
      const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext;
      if (gl) {
        const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
        if (debugInfo) {
          const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
          const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
          components.push(`gpu:${vendor}_${renderer}`);
        }
      }
    } catch {
      components.push("gpu:fallback");
    }

    // Hash the components with a fast DJB2 variant
    const rawString = components.join("###");
    let hash = 5381;
    for (let i = 0; i < rawString.length; i++) {
      hash = ((hash << 5) + hash) + rawString.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }

    const fpHex = `FP-${Math.abs(hash).toString(16).toUpperCase()}-${Math.abs(rawString.length * 31).toString(16).toUpperCase()}`;
    localStorage.setItem("swd_device_fp", fpHex);
    return fpHex;
  } catch {
    return `FP-GEN-${Date.now().toString(16).toUpperCase()}`;
  }
}

/**
 * Returns a Proof-of-Humanity (PoH) interaction signature
 */
export function getProofOfHumanityToken(): {
  isHuman: boolean;
  interactionAgeMs: number;
  deviceFingerprint: string;
} {
  const now = Date.now();
  const interactionAge = lastHumanActivityTimestamp > 0 ? (now - lastHumanActivityTimestamp) : 999999;
  
  return {
    isHuman: hasHumanInteraction && interactionAge < 120000, // Valid if human acted within last 2 minutes
    interactionAgeMs: interactionAge,
    deviceFingerprint: getDeviceFingerprint(),
  };
}
