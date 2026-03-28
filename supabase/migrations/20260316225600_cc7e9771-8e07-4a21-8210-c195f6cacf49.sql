
-- Clear all transactional data
DELETE FROM notification_dismissals;
DELETE FROM notifications;
DELETE FROM withdrawals;
DELETE FROM orders;
UPDATE wallets SET balance = 0, updated_at = now();
DELETE FROM global_package_settings;
