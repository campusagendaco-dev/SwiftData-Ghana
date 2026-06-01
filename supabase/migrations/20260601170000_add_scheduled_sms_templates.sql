-- Migration: Add Scheduled SMS Notification Templates
-- Description: Adds templates for scheduled order success and failure notifications to system_settings.

ALTER TABLE public.system_settings 
ADD COLUMN IF NOT EXISTS scheduled_success_sms_message TEXT DEFAULT 'Your scheduled {package} bundle to {phone} has been successfully renewed. Thank you for using SwiftData!',
ADD COLUMN IF NOT EXISTS scheduled_failed_sms_message TEXT DEFAULT 'Failed to renew your scheduled {package} bundle to {phone} due to insufficient wallet balance. Please top up to resume.';
