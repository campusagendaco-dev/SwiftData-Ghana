import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Bell } from "lucide-react";

interface Notification {
  id: string;
  title: string;
  message: string;
  target_type: string;
  created_at: string;
}

const NotificationPopup = () => {
  const { user, profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!user) return;

    const fetchNotifications = async () => {
      // Get dismissed notification IDs
      const { data: dismissals } = await supabase
        .from("notification_dismissals")
        .select("notification_id")
        .eq("user_id", user.id);

      const dismissedIds = (dismissals || []).map((d: any) => d.notification_id);

      // Get active notifications
      const { data: notifs } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false });

      if (!notifs) return;

      // Filter by target type and not dismissed
      const isAgent = profile?.is_agent || false;
      const filtered = notifs.filter((n: any) => {
        if (dismissedIds.includes(n.id)) return false;
        if (n.target_type === "all") return true;
        if (n.target_type === "agents" && isAgent) return true;
        if (n.target_type === "users" && !isAgent) return true;
        if (n.target_type === "specific" && n.target_user_id === user.id) return true;
        return false;
      });

      setNotifications(filtered);
      setCurrentIndex(0);
    };

    fetchNotifications();
  }, [user, profile]);

  const handleDismiss = async () => {
    const current = notifications[currentIndex];
    if (!current || !user) return;

    await supabase.from("notification_dismissals").insert({
      notification_id: current.id,
      user_id: user.id,
    });

    if (currentIndex < notifications.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setNotifications([]);
    }
  };

  if (notifications.length === 0 || currentIndex >= notifications.length) return null;

  const current = notifications[currentIndex];

  return (
    <AlertDialog open={true} onOpenChange={() => handleDismiss()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            {current.title}
          </AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-wrap">
            {current.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={handleDismiss}>
            {currentIndex < notifications.length - 1 ? "Next" : "Close"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default NotificationPopup;
