
CREATE TABLE public.global_package_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network text NOT NULL,
  package_size text NOT NULL,
  agent_price numeric,
  public_price numeric,
  is_unavailable boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(network, package_size)
);

ALTER TABLE public.global_package_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view package settings"
  ON public.global_package_settings
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Admins can manage package settings"
  ON public.global_package_settings
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));
