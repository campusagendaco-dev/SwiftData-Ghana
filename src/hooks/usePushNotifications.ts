import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

// Static secure VAPID Public Key generated for SwiftData Ghana
const VAPID_PUBLIC_KEY = "BBunKshlnxwoqC83k7a01ApJwKgZ0L-QqEySWnz0EuJL1eS7lneeiKemLOQ9Z7DYD82KptTcbYjeQKaDNN1o5gM";

// Utility to convert base64 string back to Uint8Array for crypto registration
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
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

  const subscribeUser = async (silent = false) => {
    if (!supported || !user) {
      console.warn("[Push] Notifications are not supported or user not logged in.");
      return false;
    }

    setLoading(true);
    try {
      console.log("[Push] Requesting notification permission...");
      const permission = await Notification.requestPermission();
      setPermissionState(permission);

      if (permission !== "granted") {
        console.warn("[Push] Permission not granted.");
        setLoading(false);
        return false;
      }

      console.log("[Push] Service Worker ready lookup...");
      const registration = await navigator.serviceWorker.ready;
      
      // Unsubscribe existing to make sure we refresh token updates
      const oldSub = await registration.pushManager.getSubscription();
      if (oldSub) {
        await oldSub.unsubscribe();
      }

      console.log("[Push] Subscribing through PushManager...");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // Convert native JSON buffers into safe Base64/JSON tokens
      const p256dh = btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey("p256dh")!) as any));
      const auth = btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey("auth")!) as any));
      
      console.log("[Push] Saving device token to Supabase...");
      const { error } = await supabase.from("push_subscriptions" as any).upsert({
        user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh,
        auth,
      }, { onConflict: "user_id,endpoint" });

      if (error) throw error;

      console.log("[Push] Subscription complete & registered successfully.");
      if (!silent) {
        toast({
          title: "Notifications enabled!",
          description: "You'll receive real-time mobile alerts for your order updates.",
        });
      }
      setLoading(false);
      return true;
    } catch (err: any) {
      console.error("[Push] Error setting up notifications:", err);
      setLoading(false);
      return false;
    }
  };

  useEffect(() => {
    if (supported && permissionState === "granted" && user) {
      subscribeUser(true);
    }
  }, [supported, permissionState, user]);

  const unsubscribeUser = async () => {
    if (!supported || !user) return false;
    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
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
  };

  return {
    supported,
    loading,
    permissionState,
    subscribeUser,
    unsubscribeUser,
  };
}
