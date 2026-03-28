
-- Notifications table for admin popup messages to agents/users
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL DEFAULT 'all' CHECK (target_type IN ('all', 'agents', 'users', 'specific')),
  target_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

-- Track which users have dismissed which notifications
CREATE TABLE public.notification_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid REFERENCES public.notifications(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  dismissed_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(notification_id, user_id)
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_dismissals ENABLE ROW LEVEL SECURITY;

-- Notifications policies
CREATE POLICY "Anyone can view notifications" ON public.notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete notifications" ON public.notifications FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Dismissals policies
CREATE POLICY "Users can view own dismissals" ON public.notification_dismissals FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can dismiss notifications" ON public.notification_dismissals FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Add disabled_packages to profiles
ALTER TABLE public.profiles ADD COLUMN disabled_packages jsonb NOT NULL DEFAULT '{}';
