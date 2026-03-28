import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const AdminNotifications = () => {
  const { toast } = useToast();
  const permissionAsked = useRef(false);

  useEffect(() => {
    // Ask for browser notification permission
    if (!permissionAsked.current && "Notification" in window && Notification.permission === "default") {
      permissionAsked.current = true;
      Notification.requestPermission();
    }

    // Subscribe to new orders
    const ordersChannel = supabase
      .channel("admin-orders-notify")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload) => {
          const order = payload.new as any;
          const title = `New Order: ${order.order_type === "afa" ? "AFA Bundle" : `${order.network} ${order.package_size}`}`;
          const body = `Amount: GH₵${Number(order.amount).toFixed(2)} | Phone: ${order.customer_phone || "N/A"}`;

          toast({ title, description: body });

          if ("Notification" in window && Notification.permission === "granted") {
            new Notification(title, { body, icon: "/favicon.png" });
          }
        }
      )
      .subscribe();

    // Subscribe to new withdrawals
    const withdrawalsChannel = supabase
      .channel("admin-withdrawals-notify")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "withdrawals" },
        (payload) => {
          const w = payload.new as any;
          const title = "New Withdrawal Request";
          const body = `Amount: GH₵${Number(w.amount).toFixed(2)}`;

          toast({ title, description: body });

          if ("Notification" in window && Notification.permission === "granted") {
            new Notification(title, { body, icon: "/favicon.png" });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(withdrawalsChannel);
    };
  }, [toast]);

  return null;
};

export default AdminNotifications;
