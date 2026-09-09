-- Allow anonymous and authenticated visitors to insert, update and select push_subscriptions for Web Push PWA support
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'push_subscriptions' 
    AND policyname = 'Anyone can update push subscription'
  ) THEN
    CREATE POLICY "Anyone can update push subscription"
    ON public.push_subscriptions FOR UPDATE
    USING (true)
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'push_subscriptions' 
    AND policyname = 'Anyone can select push subscription'
  ) THEN
    CREATE POLICY "Anyone can select push subscription"
    ON public.push_subscriptions FOR SELECT
    USING (true);
  END IF;
END $$;

GRANT ALL ON public.push_subscriptions TO anon, authenticated;
