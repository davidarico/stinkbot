-- Rollback for: add manual creation flag for game channels
-- Created: 2025-08-06T04:34:18.827Z

-- Add your rollback SQL here
-- Example:
-- DROP TABLE IF EXISTS example;
ALTER TABLE game_channels DROP COLUMN is_created;