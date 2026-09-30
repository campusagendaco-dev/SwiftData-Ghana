-- ==============================================================================
-- INDEX OPTIMIZATIONS FOR USER NOTIFICATIONS
-- Resolves PostgREST 500 Statement Timeout errors caused by unindexed sequential
-- scans across 440,000+ rows on user_notifications table.
-- ==============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' 
      AND tablename = 'user_notifications' 
      AND indexname = 'idx_user_notifications_user_id_created_at'
  ) THEN
    CREATE INDEX idx_user_notifications_user_id_created_at 
      ON public.user_notifications (user_id, created_at DESC);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' 
      AND tablename = 'user_notifications' 
      AND indexname = 'idx_user_notifications_created_at'
  ) THEN
    CREATE INDEX idx_user_notifications_created_at 
      ON public.user_notifications (created_at DESC);
  END IF;
END $$;
