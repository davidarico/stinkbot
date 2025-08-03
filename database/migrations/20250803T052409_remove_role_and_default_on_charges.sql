-- Migration: remove role and default on charges
-- Created: 2025-08-03T05:24:09.671Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
ALTER TABLE players DROP COLUMN role;
ALTER TABLE game_role
ALTER COLUMN charges DROP NOT NULL;

