-- Migration: add role linking
-- Created: 2025-08-01T15:49:37.808Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
ALTER TABLE players
ADD COLUMN role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL;

ALTER TABLE players
ADD COLUMN skinned_role VARCHAR(100) DEFAULT NULL;

ALTER TABLE games
ADD COLUMN is_skinned BOOLEAN DEFAULT FALSE;

ALTER TABLE games
ADD COLUMN is_themed BOOLEAN DEFAULT FALSE;

ALTER TABLE games
ADD COLUMN theme_name VARCHAR(100) DEFAULT NULL;