-- Migration: add unique constraint to server_users table
-- Created: 2025-08-10T02:30:00.000Z

-- Add unique constraint to server_users table to support ON CONFLICT in upsert operations
ALTER TABLE server_users ADD CONSTRAINT server_users_user_id_server_id_unique UNIQUE (user_id, server_id);
