-- Migration: add is couple chat

-- Created: 2025-08-09T03:29:57.564Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
ALTER TABLE game_channels ADD COLUMN is_couple_chat BOOLEAN DEFAULT FALSE;