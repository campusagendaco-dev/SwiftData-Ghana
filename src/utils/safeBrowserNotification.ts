/**
 * Safely displays a browser/system notification across both Desktop and Mobile (Android Chrome / iOS PWA).
 *
 * Why this exists:
 * Calling `new Notification(title, options)` directly on the main thread throws an uncaught
 * `TypeError: Failed to construct 'Notification': Illegal constructor` on Android Chrome and
 * mobile PWAs whenever a Service Worker is active.
 *
 * This helper always prefers `ServiceWorkerRegistration.showNotification()` and wraps
 * the fallback `new Notification()` constructor inside a `try/catch`.
 */
export async function showSafeBrowserNotification(
  title: string,
  options?: NotificationOptions & { url?: string }
): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }

  if (Notification.permission !== "granted") {
    return false;
  }

  const safeOptions: NotificationOptions = {
    icon: "/logo.png",
    badge: "/logo.png",
    ...options,
    data: {
      url: options?.url || "/dashboard",
      ...(options?.data || {}),
    },
  };

  // 1. Prefer ServiceWorkerRegistration.showNotification (required on Android/mobile browsers)
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === "function") {
        await reg.showNotification(title, safeOptions);
        return true;
      }
    } catch {
      // Fall through to constructor fallback
    }
  }

  // 2. Fallback to main-thread Notification constructor (Desktop browsers without active SW)
  try {
    new Notification(title, safeOptions);
    return true;
  } catch {
    return false;
  }
}
