import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

// Static secure VAPID Public Key generated for SwiftData Ghana
const VAPID_PUBLIC_KEY = "BBunKshlnxwoqC83k7a01ApJwKgZ0L-QqEySWnz0EuJL1eS7lneeiKemLOQ9Z7DYD82KptTcbYjeQKaDNN1o5gM";

// Utility to convert base64url string back to Uint8Array for crypto registration
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  try {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  } catch (err) {
    console.error("[Push] Failed to parse VAPID key to Uint8Array:", err);
    return new Uint8Array(0);
  }
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function keysMatch(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return true; // Some browsers don't expose options.applicationServerKey
  const viewA = new Uint8Array(a);
  if (viewA.byteLength !== b.byteLength) return false;
  for (let i = 0; i < viewA.byteLength; i++) {
    if (viewA[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Safely resolves an active ServiceWorkerRegistration for push notifications.
 * If no service worker is registered (e.g. in dev mode or before VitePWA registers),
 * it attempts to register the production SW (/sw.js) or fall back to /push-sw.js.
 */
async function getOrRegisterServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    throw new Error("Service Worker is not supported in this browser");
  }

  // 1. Check existing registration first
  let registration = await navigator.serviceWorker.getRegistration();

  // 2. If none exists, proactively register
  if (!registration) {
    try {
      registration = await navigator.serviceWorker.register("/sw.js");
    } catch (_err) {
      // In development mode or standalone push setups, fallback to /push-sw.js
      try {
        registration = await navigator.serviceWorker.register("/push-sw.js");
      } catch (fallbackErr) {
        console.warn("[Push] Fallback registration failed:", fallbackErr);
      }
    }
  }

  // 3. If the registration has an active worker, return immediately
  if (registration?.active) {
    return registration;
  }

  // 4. If a worker is installing or waiting, listen for activation
  const candidate = registration?.installing || registration?.waiting;
  if (candidate) {
    await new Promise<void>((resolve) => {
      if (candidate.state === "activated") {
        resolve();
        return;
      }
      const onStateChange = () => {
        if (candidate.state === "activated") {
          candidate.removeEventListener("statechange", onStateChange);
          resolve();
        }
      };
      candidate.addEventListener("statechange", onStateChange);
      setTimeout(resolve, 3000); // 3-second safety window
    });
  }

  if (registration?.active) {
    return registration;
  }

  // 5. Wrap navigator.serviceWorker.ready with a 5s timeout
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Service Worker readiness timed out")), 5000)
  );

  return await Promise.race([navigator.serviceWorker.ready, timeoutPromise]);
}

// Module-level deduplication so multiple mounted components using usePushNotifications()
// do not fire parallel duplicate registration requests on page load
let inFlightSyncPromise: Promise<boolean> | null = null;
let lastSyncedSignature: string | null = null;

async function persistSubscriptionToBackend(params: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userId: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { endpoint, p256dh, auth, userId } = params;
  const syncSig = `${endpoint}::${userId || "anon"}`;

  if (lastSyncedSignature === syncSig) {
    return { ok: true };
  }

  // Tier 1: Edge Function action="subscribe" (uses service_role key on server, zero RLS or missing-RPC 404 issues)
  try {
    const { data: fnData, error: fnErr } = await supabase.functions.invoke("send-push-notification", {
      body: {
        action: "subscribe",
        endpoint,
        p256dh,
        auth,
        user_id: userId,
      },
    });
    if (!fnErr && fnData?.success) {
      lastSyncedSignature = syncSig;
      return { ok: true };
    }
  } catch (_fnEx) {
    // Fall through to Tier 2
  }

  // Tier 2: Direct table upsert fallback
  try {
    const { error: upsertErr } = await supabase.from("push_subscriptions" as any).upsert(
      {
        user_id: userId,
        endpoint,
        p256dh: p256dh || null,
        auth: auth || null,
      },
      { onConflict: "endpoint" }
    );
    if (!upsertErr) {
      lastSyncedSignature = syncSig;
      return { ok: true };
    }
    return { ok: false, error: upsertErr.message };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Failed to save subscription" };
  }
}

export function usePushNotifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [supported, setSupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permissionState, setPermissionState] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    try {
      const isSupported =
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window &&
        typeof ServiceWorkerRegistration !== "undefined" &&
        "showNotification" in ServiceWorkerRegistration.prototype;

      setSupported(isSupported);
      if (isSupported) {
        setPermissionState(Notification.permission);
      } else {
        setPermissionState("unsupported");
      }
    } catch (err) {
      console.warn("[Push] Detection failure — marking unsupported instead of crashing:", err);
      setSupported(false);
      setPermissionState("unsupported");
    }
  }, []);

  // Guard: silentArg might be a React SyntheticEvent if passed directly to onClick={subscribeUser}
  const subscribeUser = useCallback(
    async (silentArg: boolean | unknown = false) => {
      const silent = silentArg === true;

      if (!supported) {
        if (!silent) {
          toast({
            title: "Push Not Supported",
            description: "Your current browser tab does not support Web Push. On iPhone/iPad, tap Share → Add to Home Screen first.",
            variant: "destructive",
          });
        }
        return false;
      }

      // Deduplicate concurrent silent background syncs across multiple mounted components
      if (silent && inFlightSyncPromise) {
        const ok = await inFlightSyncPromise;
        if (ok) setIsSubscribed(true);
        return ok;
      }

      if (!silent) setLoading(true);

      const runSubscription = async (): Promise<boolean> => {
        try {
          let permission = Notification.permission;
          if (permission !== "granted") {
            try {
              const reqRes = Notification.requestPermission();
              if (reqRes && typeof reqRes.then === "function") {
                permission = await reqRes;
              } else {
                permission = await new Promise<NotificationPermission>((resolve) => {
                  Notification.requestPermission((p) => resolve(p));
                });
              }
            } catch (permErr) {
              console.warn("[Push] Error during requestPermission call:", permErr);
              permission = Notification.permission;
            }
            setPermissionState(permission);
          } else {
            setPermissionState("granted");
          }

          if (permission !== "granted") {
            if (!silent) {
              toast({
                title: permission === "denied" ? "Notifications Blocked in Browser" : "Permission Not Granted",
                description:
                  permission === "denied"
                    ? "Click the lock icon (🔒) in your browser address bar and set Notifications to Allow."
                    : "Please allow notifications when prompted by your browser.",
                variant: "destructive",
              });
              setLoading(false);
            }
            return false;
          }

          const registration = await getOrRegisterServiceWorker();
          if (!registration || !registration.pushManager) {
            throw new Error("PushManager is not available on Service Worker registration");
          }

          const expectedServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
          let subscription = await registration.pushManager.getSubscription();

          // If an existing subscription uses a different VAPID key, unsubscribe and re-create
          if (subscription && !keysMatch(subscription.options?.applicationServerKey, expectedServerKey)) {
            console.log("[Push] Existing subscription has mismatched VAPID key — rotating subscription...");
            try {
              await subscription.unsubscribe();
            } catch (_unsubErr) {
              // Ignore unsubscribe error
            }
            subscription = null;
          }

          if (!subscription) {
            try {
              subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: expectedServerKey,
              });
            } catch (_subErr: any) {
              // Handle InvalidStateError if browser had a stale subscription
              const stale = await registration.pushManager.getSubscription();
              if (stale) {
                await stale.unsubscribe().catch(() => {});
              }
              subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: expectedServerKey,
              });
            }
          }

          if (!subscription || !subscription.endpoint) {
            throw new Error("Failed to obtain PushSubscription from browser push manager");
          }

          // Extract W3C encryption keys (p256dh and auth)
          const subJson = subscription.toJSON();
          let p256dh = subJson.keys?.p256dh || "";
          let auth = subJson.keys?.auth || "";

          if (!p256dh && typeof subscription.getKey === "function") {
            try {
              const rawP256 = subscription.getKey("p256dh");
              if (rawP256) {
                p256dh = arrayBufferToBase64Url(rawP256);
              }
            } catch (_err) {
              // Ignore fallback error
            }
          }
          if (!auth && typeof subscription.getKey === "function") {
            try {
              const rawAuth = subscription.getKey("auth");
              if (rawAuth) {
                auth = arrayBufferToBase64Url(rawAuth);
              }
            } catch (_err) {
              // Ignore fallback error
            }
          }

          const saveResult = await persistSubscriptionToBackend({
            endpoint: subscription.endpoint,
            p256dh,
            auth,
            userId: user?.id || null,
          });

          if (!saveResult.ok) {
            throw new Error(saveResult.error || "Could not register push token with server");
          }

          setIsSubscribed(true);
          try {
            localStorage.setItem("swift_push_subscribed", "true");
          } catch (_err) {
            // Storage restricted in private browsing modes
          }

          if (!silent) {
            toast({
              title: "Push Notifications Enabled! 🔔",
              description: "You'll now receive instant lock-screen alerts for your orders and wallet updates.",
            });
            setLoading(false);
          }
          return true;
        } catch (err: any) {
          if (silent) {
            console.warn("[Push] Background push sync deferred:", err?.message || err);
          } else {
            console.error("[Push] Error setting up notifications:", err);
            toast({
              title: "Could Not Enable Push Alerts",
              description: err?.message || "Please check your browser notification settings and try again.",
              variant: "destructive",
            });
            setLoading(false);
          }
          return false;
        }
      };

      if (silent) {
        inFlightSyncPromise = runSubscription().finally(() => {
          inFlightSyncPromise = null;
        });
        return await inFlightSyncPromise;
      }

      return await runSubscription();
    },
    [supported, user?.id, toast]
  );

  // Sync existing granted permission to backend on mount or when user logs in
  useEffect(() => {
    if (supported && permissionState === "granted") {
      subscribeUser(true);
    }
  }, [supported, permissionState, user?.id, subscribeUser]);

  const unsubscribeUser = useCallback(async () => {
    if (!supported) return false;
    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration || !registration.pushManager) {
        setIsSubscribed(false);
        setLoading(false);
        return true;
      }
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        lastSyncedSignature = null;

        // Remove from backend via Edge Function or direct delete
        try {
          await supabase.functions.invoke("send-push-notification", {
            body: { action: "unsubscribe", endpoint },
          });
        } catch (_e) {
          if (user?.id) {
            await supabase
              .from("push_subscriptions" as any)
              .delete()
              .eq("user_id", user.id)
              .eq("endpoint", endpoint);
          }
        }
      }

      setIsSubscribed(false);
      try {
        localStorage.removeItem("swift_push_subscribed");
      } catch (_e) {}
      setPermissionState(Notification.permission);
      setLoading(false);
      return true;
    } catch (err) {
      console.error("[Push] Unsubscribe failure:", err);
      setLoading(false);
      return false;
    }
  }, [supported, user?.id]);

  return {
    supported,
    loading,
    isSubscribed,
    permissionState,
    subscribeUser,
    unsubscribeUser,
  };
}
