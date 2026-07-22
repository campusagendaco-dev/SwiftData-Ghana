/**
 * Utility to generate and persist a unique device identifier (fingerprint)
 * to track clients and enforce suspended account blocks.
 */

const DEVICE_ID_KEY = "swift_device_id";

/**
 * Generates a cryptographically secure UUID v4 fallback
 */
function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  
  // Cryptographically secure fallback
  const array = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(array);
  } else {
    // Pseudo-random fallback if crypto is not supported
    for (let i = 0; i < 16; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }

  // Adjust version and variant bits
  array[6] = (array[6] & 0x0f) | 0x40; // v4
  array[8] = (array[8] & 0x3f) | 0x80; // variant 1

  const hex = Array.from(array).map(b => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-");
}

/**
 * Gets a cookie value by name
 */
/**
 * Gets a cookie value by name
 */
function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(";").shift() || null;
  }
  return null;
}

/**
 * Sets a cookie with a 10 year expiry
 */
function setCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 10);
  document.cookie = `${name}=${value}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Lax; Secure`;
}

/**
 * Helper to get a value from IndexedDB
 */
function getIndexedDBItem(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open("swift_db", 1);
      request.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("device_meta")) {
          db.createObjectStore("device_meta");
        }
      };
      request.onsuccess = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("device_meta")) {
          resolve(null);
          return;
        }
        const transaction = db.transaction("device_meta", "readonly");
        const store = transaction.objectStore("device_meta");
        const getReq = store.get(key);
        getReq.onsuccess = () => {
          resolve(getReq.result || null);
        };
        getReq.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

/**
 * Helper to set a value in IndexedDB
 */
function setIndexedDBItem(key: string, value: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open("swift_db", 1);
      request.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("device_meta")) {
          db.createObjectStore("device_meta");
        }
      };
      request.onsuccess = (e: any) => {
        const db = e.target.result;
        const transaction = db.transaction("device_meta", "readwrite");
        const store = transaction.objectStore("device_meta");
        const putReq = store.put(value, key);
        putReq.onsuccess = () => resolve(true);
        putReq.onerror = () => resolve(false);
      };
      request.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

/**
 * Retrieves the existing device ID or creates a new one,
 * keeping it in sync across localStorage, sessionStorage, and cookies.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";

  let deviceId = "";

  try {
    deviceId = localStorage.getItem(DEVICE_ID_KEY) || "";
  } catch (e) {
    console.warn("Failed to read device ID from localStorage:", e);
  }

  if (!deviceId) {
    deviceId = getCookie(DEVICE_ID_KEY) || "";
  }

  if (!deviceId) {
    try {
      deviceId = sessionStorage.getItem(DEVICE_ID_KEY) || "";
    } catch (e) {
      console.warn("Failed to read device ID from sessionStorage:", e);
    }
  }

  if (!deviceId) {
    deviceId = generateUUID();
  }

  // Sync to standard synchronous storage layers
  try {
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  } catch (e) {
    console.warn("Failed to write device ID to localStorage:", e);
  }

  try {
    setCookie(DEVICE_ID_KEY, deviceId);
  } catch (e) {
    console.warn("Failed to write device ID to cookies:", e);
  }

  try {
    sessionStorage.setItem(DEVICE_ID_KEY, deviceId);
  } catch (e) {
    console.warn("Failed to write device ID to sessionStorage:", e);
  }

  return deviceId;
}

/**
 * Performs deep self-healing device ID synchronization, retrieving/restoring
 * the device ID across localStorage, cookies, sessionStorage, and IndexedDB.
 */
export async function syncDeviceIdWithIndexedDB(): Promise<string> {
  if (typeof window === "undefined") return "";

  let deviceId = "";

  // 1. Try reading from localStorage
  try {
    deviceId = localStorage.getItem(DEVICE_ID_KEY) || "";
  } catch (e) {
    console.warn("Failed to read device ID from localStorage:", e);
  }

  // 2. Try reading from cookie
  if (!deviceId) {
    deviceId = getCookie(DEVICE_ID_KEY) || "";
  }

  // 3. Try reading from sessionStorage
  if (!deviceId) {
    try {
      deviceId = sessionStorage.getItem(DEVICE_ID_KEY) || "";
    } catch (e) {
      console.warn("Failed to read device ID from sessionStorage:", e);
    }
  }

  // 4. Try reading from IndexedDB (deepest storage layer)
  if (!deviceId) {
    deviceId = await getIndexedDBItem(DEVICE_ID_KEY) || "";
  }

  // 5. Generate new if not found anywhere
  if (!deviceId) {
    deviceId = generateUUID();
  }

  // 6. Restore/sync to all layers (self-healing)
  try {
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  } catch (e) {
    console.warn("Failed to write device ID to localStorage:", e);
  }

  try {
    setCookie(DEVICE_ID_KEY, deviceId);
  } catch (e) {
    console.warn("Failed to write device ID to cookies:", e);
  }

  try {
    sessionStorage.setItem(DEVICE_ID_KEY, deviceId);
  } catch (e) {
    console.warn("Failed to write device ID to sessionStorage:", e);
  }

  try {
    await setIndexedDBItem(DEVICE_ID_KEY, deviceId);
  } catch (e) {
    console.warn("Failed to write device ID to IndexedDB:", e);
  }

  return deviceId;
}

/**
 * Generates a stable, high-entropy hardware and canvas browser fingerprint
 * that remains identical even if user clears standard cookies, cache, and storage.
 */
export function getBrowserFingerprint(): string {
  if (typeof window === "undefined") return "";

  const parts: string[] = [
    navigator.userAgent || "",
    navigator.language || "",
    `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    String(navigator.hardwareConcurrency || 0),
    String((navigator as any).deviceMemory || 0),
    navigator.platform || ""
  ];

  // Add canvas fingerprint
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx) {
      canvas.width = 200;
      canvas.height = 50;
      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial'";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("SwiftDataSecurity,🤖ban-exploit", 2, 15);
      ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
      ctx.fillText("SwiftDataSecurity,🤖ban-exploit", 4, 17);
      
      const dataUrl = canvas.toDataURL();
      parts.push(dataUrl);
    }
  } catch (e) {
    // Ignore canvas errors
  }

  // WebGL fingerprint
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl) {
      const debugInfo = (gl as any).getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        parts.push(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || "");
        parts.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "");
      }
    }
  } catch (e) {
    // Ignore WebGL errors
  }

  // Generate a hash of the combined elements using djb2 algorithm
  let hash = 0;
  const str = parts.join("||");
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  return `sd_fp_${Math.abs(hash).toString(16)}`;
}

