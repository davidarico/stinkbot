-- Rollback for: add invited users array
-- Created: 2025-08-08T05:57:51.490Z

-- Add your rollback SQL here
-- Example:
-- DROP TABLE IF EXISTS example;
ALTER TABLE game_channels DROP COLUMN invited_users;