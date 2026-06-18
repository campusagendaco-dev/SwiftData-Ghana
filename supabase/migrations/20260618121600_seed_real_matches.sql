-- Migration: Seed Real 2026 World Cup Match Data
-- Date: 2026-06-18
-- Cleans up mock/fake match data and seeds actual World Cup matches.

-- Truncate existing predictions and matches to clean up all fake data
TRUNCATE public.world_cup_predictions, public.world_cup_matches CASCADE;

-- Insert real match data
INSERT INTO public.world_cup_matches (id, home_team, home_flag, away_team, away_flag, kickoff, status, result)
VALUES
  -- June 11
  ('wc2026_m1', 'Mexico', '🇲🇽', 'South Africa', '🇿🇦', '2026-06-11T19:00:00Z', 'settled', 'home'),
  ('wc2026_m2', 'South Korea', '🇰🇷', 'Czechia', '🇨🇿', '2026-06-11T22:00:00Z', 'settled', 'home'),
  
  -- June 12
  ('wc2026_m3', 'Canada', '🇨🇦', 'Bosnia and Herzegovina', '🇧🇦', '2026-06-12T17:00:00Z', 'settled', 'draw'),
  ('wc2026_m4', 'USA', '🇺🇸', 'Paraguay', '🇵🇾', '2026-06-12T20:00:00Z', 'settled', 'home'),
  
  -- June 13
  ('wc2026_m5', 'Qatar', '🇶🇦', 'Switzerland', '🇨🇭', '2026-06-13T14:00:00Z', 'settled', 'draw'),
  ('wc2026_m6', 'Brazil', '🇧🇷', 'Morocco', '🇲🇦', '2026-06-13T17:00:00Z', 'settled', 'draw'),
  ('wc2026_m7', 'Scotland', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'Haiti', '🇭🇹', '2026-06-13T20:00:00Z', 'settled', 'home'),
  ('wc2026_m8', 'Australia', '🇦🇺', 'Türkiye', '🇹🇷', '2026-06-13T23:00:00Z', 'settled', 'home'),
  
  -- June 14
  ('wc2026_m9', 'Germany', '🇩🇪', 'Curaçao', '🇨🇼', '2026-06-14T15:00:00Z', 'settled', 'home'),
  ('wc2026_m10', 'Netherlands', '🇳🇱', 'Japan', '🇯🇵', '2026-06-14T18:00:00Z', 'settled', 'draw'),
  ('wc2026_m11', 'Ivory Coast', '🇨🇮', 'Ecuador', '🇪🇨', '2026-06-14T21:00:00Z', 'settled', 'home'),
  ('wc2026_m12', 'Sweden', '🇸🇪', 'Tunisia', '🇹🇳', '2026-06-14T23:00:00Z', 'settled', 'home'),
  
  -- June 15
  ('wc2026_m13', 'Spain', '🇪🇸', 'Cape Verde', '🇨🇻', '2026-06-15T15:00:00Z', 'settled', 'draw'),
  ('wc2026_m14', 'Belgium', '🇧🇪', 'Egypt', '🇪🇬', '2026-06-15T18:00:00Z', 'settled', 'draw'),
  ('wc2026_m15', 'Saudi Arabia', '🇸🇦', 'Uruguay', '🇺🇾', '2026-06-15T21:00:00Z', 'settled', 'draw'),
  ('wc2026_m16', 'Iran', '🇮🇷', 'New Zealand', '🇳🇿', '2026-06-15T23:00:00Z', 'settled', 'draw'),
  
  -- June 16
  ('wc2026_m17', 'Argentina', '🇦🇷', 'Algeria', '🇩🇿', '2026-06-16T18:00:00Z', 'settled', 'home'),
  ('wc2026_m18', 'Austria', '🇦🇹', 'Jordan', '🇯🇴', '2026-06-16T21:00:00Z', 'settled', 'home'),
  
  -- June 17
  ('wc2026_m19', 'Colombia', '🇨🇴', 'Uzbekistan', '🇺🇿', '2026-06-17T17:00:00Z', 'settled', 'home'),
  ('wc2026_m20', 'Ghana', '🇬🇭', 'Panama', '🇵🇦', '2026-06-17T20:00:00Z', 'settled', 'home'),
  
  -- June 18
  ('wc2026_m21', 'Czechia', '🇨🇿', 'South Africa', '🇿🇦', '2026-06-18T16:00:00Z', 'pending', NULL),
  ('wc2026_m22', 'Switzerland', '🇨🇭', 'Bosnia and Herzegovina', '🇧🇦', '2026-06-18T19:00:00Z', 'pending', NULL),
  ('wc2026_m23', 'Canada', '🇨🇦', 'Qatar', '🇶🇦', '2026-06-18T22:00:00Z', 'pending', NULL),
  ('wc2026_m24', 'Mexico', '🇲🇽', 'South Korea', '🇰🇷', '2026-06-18T23:00:00Z', 'pending', NULL),
  
  -- June 19
  ('wc2026_m25', 'USA', '🇺🇸', 'Australia', '🇦🇺', '2026-06-19T19:00:00Z', 'pending', NULL),
  ('wc2026_m26', 'Türkiye', '🇹🇷', 'Paraguay', '🇵🇾', '2026-06-19T21:00:00Z', 'pending', NULL),
  ('wc2026_m27', 'Scotland', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'Morocco', '🇲🇦', '2026-06-19T22:00:00Z', 'pending', NULL),
  ('wc2026_m28', 'Brazil', '🇧🇷', 'Haiti', '🇭🇹', '2026-06-19T23:00:00Z', 'pending', NULL)
ON CONFLICT (id) DO UPDATE SET
  home_team = EXCLUDED.home_team,
  home_flag = EXCLUDED.home_flag,
  away_team = EXCLUDED.away_team,
  away_flag = EXCLUDED.away_flag,
  kickoff = EXCLUDED.kickoff,
  status = EXCLUDED.status,
  result = EXCLUDED.result;
