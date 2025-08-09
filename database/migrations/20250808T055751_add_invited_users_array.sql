-- Migration: add invited users array
-- Created: 2025-08-08T05:57:51.490Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
ALTER TABLE game_channels ADD COLUMN invited_users JSONB;