-- Migration: add win by number to players table
-- Created: 2025-08-13T01:41:18.282Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
ALTER TABLE players
ADD COLUMN win_by_number INTEGER DEFAULT 0;