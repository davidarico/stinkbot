-- Migration: add open and close flags for game channels
-- Created: 2025-08-06T04:09:51.808Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
ALTER TABLE game_channels ADD COLUMN open_at_dawn BOOLEAN DEFAULT TRUE;
ALTER TABLE game_channels ADD COLUMN open_at_dusk BOOLEAN DEFAULT TRUE;