CREATE TABLE IF NOT EXISTS public.maintenance_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  message TEXT NOT NULL DEFAULT 'We are performing scheduled maintenance. Please check back soon.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL
);

ALTER TABLE public.maintenance_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view maintenance settings"
  ON public.maintenance_settings
  FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage maintenance settings"
  ON public.maintenance_settings
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.maintenance_settings (id, is_enabled, message)
VALUES (1, FALSE, 'We are performing scheduled maintenance. Please check back soon.')
ON CONFLICT (id) DO NOTHING;
