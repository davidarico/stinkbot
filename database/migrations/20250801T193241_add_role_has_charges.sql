-- Migration: add role has charges
-- Created: 2025-08-01T19:32:41.208Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
ALTER TABLE roles
ADD COLUMN has_charges BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN default_charges INTEGER NOT NULL DEFAULT 0;

ALTER TABLE game_role
ADD COLUMN charges INTEGER NOT NULL DEFAULT 0;

UPDATE roles
SET has_charges = TRUE, default_charges = 3
WHERE name IN ('Hunter', 'Veteran', 'Stalker');