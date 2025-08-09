-- Rollback for: add is couple chat

-- Created: 2025-08-09T03:29:57.564Z

-- Add your rollback SQL here
-- Example:
-- DROP TABLE IF EXISTS example;
ALTER TABLE game_channels DROP COLUMN is_couple_chat;