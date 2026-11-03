-- ============================================================================
-- SwiftGram privacy (Phase 0) + private KYC documents
--
-- 1. game_community_messages was readable by everyone (USING (true)), so every
--    private DM (channel 'dm:<a>__<b>') was exposed through the REST API and
--    Realtime. Public channels stay readable; DM rows are now readable only by
--    the two participants (their user ids, dashes removed, form the channel).
-- 2. game_community_presence stored players' raw phone numbers and was
--    readable by everyone. The edge function no longer writes them; wipe them.
-- 3. The kyc-documents bucket (national IDs, business certificates) was
--    public. Make it private: owners and admins read via signed URLs.
-- ============================================================================

-- 1. DMs readable only by participants -------------------------------------
DROP POLICY IF EXISTS "Anyone can view game community messages" ON public.game_community_messages;
DROP POLICY IF EXISTS "Public channels are readable" ON public.game_community_messages;
DROP POLICY IF EXISTS "DM participants can read their messages" ON public.game_community_messages;

CREATE POLICY "Public channels are readable"
  ON public.game_community_messages FOR SELECT
  USING (channel NOT LIKE 'dm:%');

CREATE POLICY "DM participants can read their messages"
  ON public.game_community_messages FOR SELECT
  TO authenticated
  USING (
    channel LIKE 'dm:%'
    AND position(replace(auth.uid()::text, '-', '') IN channel) > 0
  );

-- 2. No phone numbers in presence ------------------------------------------
UPDATE public.game_community_presence SET raw_phone = NULL WHERE raw_phone IS NOT NULL;

-- 3. Private KYC bucket ------------------------------------------------------
UPDATE storage.buckets SET public = false WHERE id = 'kyc-documents';

DROP POLICY IF EXISTS "Public Read KYC Docs" ON storage.objects;
DROP POLICY IF EXISTS "Admins read KYC docs" ON storage.objects;
CREATE POLICY "Admins read KYC docs"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'kyc-documents' AND public.has_role(auth.uid(), 'admin'));
-- Owners keep access through the existing "Owner Manage KYC Docs" policy.
