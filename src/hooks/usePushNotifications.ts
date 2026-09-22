import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

// Static secure VAPID Public Key generated for SwiftData Ghana
const VAPID_PUBLIC_KEY = "BBunKshlnxwoqC83k7a01ApJwKgZ0L-QqEySWnz0EuJL1eS7lneeiKemLOQ9Z7DYD82KptTcbYjeQKaDNN1o5gM";

// Utility to convert base64 string back to Uint8Array for crypto registration
function urlBase64ToUint8Array(base64String: string) {
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

export function usePushNotifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [supported, setSupported] = useState(false);
  const [loading, setLoading] = useState(false);
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

  const subscribeUser = useCallback(async (silent = false) => {
    if (!supported) {
      console.warn("[Push] Notifications are not supported in this browser.");
      return false;
    }

    if (!silent) setLoading(true);
    try {
      let permission = Notification.permission;
      if (permission !== "granted") {
        console.log("[Push] Requesting notification permission...");
        try {
          const reqRes = Notification.requestPermission();
          if (reqRes && typeof reqRes.then === "function") {
            permission = await reqRes;
          } else {
            // Safari legacy callback compatibility
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
        console.warn("[Push] Permission not granted:", permission);
        if (!silent) setLoading(false);
        return false;
      }

      console.log("[Push] Service Worker ready lookup...");
      const registration = await getOrRegisterServiceWorker();

      if (!registration || !registration.pushManager) {
        throw new Error("PushManager is not available on Service Worker registration");
      }
      
      // Get existing subscription or create new
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        console.log("[Push] Subscribing through PushManager...");
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      if (!subscription) {
        throw new Error("Failed to obtain PushSubscription from browser push manager");
      }

      // Safe JSON and key extraction (W3C standard)
      const subJson = subscription.toJSON();
      let p256dh = subJson.keys?.p256dh || "";
      let auth = subJson.keys?.auth || "";

      // Fallback if browser toJSON() omitted keys
      if (!p256dh && typeof subscription.getKey === "function") {
        try {
          const rawP256 = subscription.getKey("p256dh");
          if (rawP256) {
            p256dh = btoa(String.fromCharCode(...new Uint8Array(rawP256)));
          }
        } catch (_err) {
          // Ignore key extraction error and rely on available keys
        }
      }
      if (!auth && typeof subscription.getKey === "function") {
        try {
          const rawAuth = subscription.getKey("auth");
          if (rawAuth) {
            auth = btoa(String.fromCharCode(...new Uint8Array(rawAuth)));
          }
        } catch (_err) {
          // Ignore key extraction error and rely on available keys
        }
      }

      if (!subscription.endpoint) {
        throw new Error("Subscription endpoint is missing");
      }

      console.log("[Push] Saving device token to Supabase...");
      const { error } = await supabase.from("push_subscriptions" as any).upsert({
        user_id: user?.id || null,
        endpoint: subscription.endpoint,
        p256dh: p256dh || null,
        auth: auth || null,
      }, { onConflict: "endpoint" });

      if (error) {
        console.warn("[Push] Upsert warning:", error.message);
      }

      try {
        localStorage.setItem("swift_push_subscribed", "true");
      } catch (_err) {
        // Storage restricted in private browsing modes
      }

      console.log("[Push] Subscription complete & registered successfully.");
      if (!silent) {
        toast({
          title: "Push Notifications Enabled! 🔔",
          description: "You'll now receive instant lock-screen alerts for your orders and wallet updates.",
        });
      }
      if (!silent) setLoading(false);
      return true;
    } catch (err: any) {
      if (silent) {
        console.warn("[Push] Background push sync deferred:", err?.message || err);
      } else {
        console.error("[Push] Error setting up notifications:", err);
      }
      if (!silent) setLoading(false);
      return false;
    }
  }, [supported, user?.id, toast]);

  useEffect(() => {
    if (supported && permissionState === "granted") {
      subscribeUser(true);
    }
  }, [supported, permissionState, subscribeUser]);

  const unsubscribeUser = useCallback(async () => {
    if (!supported || !user) return false;
    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration || !registration.pushManager) {
        setLoading(false);
        return true;
      }
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        await subscription.unsubscribe();
        // Delete matching endpoint subscription from Supabase
        await supabase
          .from("push_subscriptions" as any)
          .delete()
          .eq("user_id", user.id)
          .eq("endpoint", subscription.endpoint);
      }

      setPermissionState(Notification.permission);
      setLoading(false);
      return true;
    } catch (err) {
      console.error("[Push] Unsubscribe failure:", err);
      setLoading(false);
      return false;
    }
  }, [supported, user]);

  return {
    supported,
    loading,
    permissionState,
    subscribeUser,
    unsubscribeUser,
  };
}
