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
 * Retrieves the existing device ID or creates a new one,
 * keeping it in sync across localStorage and cookies to prevent bypass.
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
    deviceId = generateUUID();
  }

  // Sync to both storage layers
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

  return deviceId;
}
