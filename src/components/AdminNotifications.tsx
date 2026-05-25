import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { playSound } from "@/lib/sound";

const AdminNotifications = () => {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    let activeTone = "/sounds/notification_system.mp3";
    let isVibeEnabled = true;
    let vibePatternStr = "200,100,200";

    const fetchConfig = async () => {
      const { data } = await supabase
        .from("public_system_settings")
        .select("notification_tone, notification_vibration_enabled, notification_vibration_pattern")
        .eq("id", 1)
        .maybeSingle();
      if (data) {
        if (data.notification_tone) activeTone = data.notification_tone;
        isVibeEnabled = data.notification_vibration_enabled !== false;
        if (data.notification_vibration_pattern) vibePatternStr = data.notification_vibration_pattern;
      }
    };

    fetchConfig();

    const playPing = () => {
      if (activeTone) {
        playSound(activeTone, 0.5);
      }

      if (isVibeEnabled && vibePatternStr) {
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          try {
            const pattern = String(vibePatternStr)
              .split(",")
              .map(Number)
              .filter((num) => !isNaN(num) && num >= 0);

            if (pattern.length > 0) {
              navigator.vibrate(pattern);
            }
          } catch (e) {
            console.warn("[Vibration] Blocked or unsupported in AdminNotifications:", e);
          }
        }
      }
    };

    const notify = (title: string, body: string) => {
      toastRef.current({ title, description: body });
      
      // Play premium chime sound for incoming admin alerts
      playPing();

      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body, icon: "/favicon.png" });
      }
    };

    const ordersChannel = supabase
      .channel("admin-orders-notify")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
        const o = payload.new as any;
        notify(
          `New Order — ${o.network || "Wallet"} ${o.package_size || o.order_type || ""}`.trim(),
          `GH₵${Number(o.amount).toFixed(2)} · ${o.customer_phone || "No phone"}`,
        );
      })
      .subscribe();

    const withdrawalsChannel = supabase
      .channel("admin-withdrawals-notify")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "withdrawals" }, (payload) => {
        const w = payload.new as any;
        notify("New Withdrawal Request", `Amount: GH₵${Number(w.amount).toFixed(2)}`);
      })
      .subscribe();

    const agentsChannel = supabase
      .channel("admin-agents-notify")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles",
        filter: "is_agent=eq.true" }, (payload) => {
        const p = payload.new as any;
        if (p.is_agent && p.onboarding_complete && !p.agent_approved) {
          notify("Agent Pending Approval", `${p.full_name || "An agent"} completed onboarding.`);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(withdrawalsChannel);
      supabase.removeChannel(agentsChannel);
    };
  }, []); // stable — toastRef handles the latest toast reference

  return null;
};

export default AdminNotifications;
