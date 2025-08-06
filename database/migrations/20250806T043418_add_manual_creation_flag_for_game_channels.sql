-- Migration: add manual creation flag for game channels
-- Created: 2025-08-06T04:34:18.827Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
ALTER TABLE game_channels ADD COLUMN is_created BOOLEAN DEFAULT FALSE;