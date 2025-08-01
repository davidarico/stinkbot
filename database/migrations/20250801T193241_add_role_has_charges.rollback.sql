-- Rollback for: add role has charges
-- Created: 2025-08-01T19:32:41.208Z

-- Remove charge-related columns from game_role table
ALTER TABLE game_role
DROP COLUMN IF EXISTS charges;

-- Remove charge-related columns from roles table
ALTER TABLE roles
DROP COLUMN IF EXISTS has_charges,
DROP COLUMN IF EXISTS default_charges;
