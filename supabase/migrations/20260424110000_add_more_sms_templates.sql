ALTER TABLE system_settings 
  ADD COLUMN IF NOT EXISTS wallet_topup_sms_message TEXT DEFAULT 'Your wallet has been credited with GHS {amount}. New balance: GHS {balance}.',
  ADD COLUMN IF NOT EXISTS withdrawal_request_sms_message TEXT DEFAULT 'Withdrawal request of GHS {amount} received. It will be processed shortly.',
  ADD COLUMN IF NOT EXISTS withdrawal_completed_sms_message TEXT DEFAULT 'Your withdrawal of GHS {amount} has been completed. Thanks for using SwiftData.',
  ADD COLUMN IF NOT EXISTS order_failed_sms_message TEXT DEFAULT 'Order for {package} to {phone} failed. GHS {amount} has been refunded to your wallet.',
  ADD COLUMN IF NOT EXISTS manual_credit_sms_message TEXT DEFAULT 'Your account has been manually credited with GHS {amount} by admin.';
