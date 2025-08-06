-- Migration: allow null channel id on game channels
-- Created: 2025-08-06T05:04:23.747Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
ALTER TABLE game_channels ALTER COLUMN channel_id DROP NOT NULL;