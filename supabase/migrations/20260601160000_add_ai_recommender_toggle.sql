-- Migration: Add AI Promo Recommender Toggle
-- Description: Adds a column to system_settings to enable or disable the AI Sales Recommender.

ALTER TABLE public.system_settings 
ADD COLUMN IF NOT EXISTS ai_recommender_enabled BOOLEAN DEFAULT true;
