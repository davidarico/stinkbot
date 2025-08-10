-- Rollback migration: remove unique constraint from server_users table
-- Created: 2025-08-10T02:30:00.000Z

-- Remove unique constraint from server_users table
ALTER TABLE server_users DROP CONSTRAINT IF EXISTS server_users_user_id_server_id_unique;
