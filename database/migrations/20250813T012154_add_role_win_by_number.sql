-- Migration: add role win by number
-- Created: 2025-08-13T01:21:54.971Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
ALTER TABLE roles 
ADD COLUMN has_win_by_number BOOLEAN DEFAULT FALSE,
ADD COLUMN default_win_by_number INTEGER DEFAULT 0;

ALTER TABLE game_role
ADD COLUMN win_by_number INTEGER DEFAULT 0;

UPDATE roles
SET 
    has_win_by_number = TRUE, 
    default_win_by_number = 3
WHERE name IN ('Arsonist', 'Murderer', 'Serial Killer');

UPDATE roles
SET 
    has_win_by_number = TRUE, 
    default_win_by_number = 2
WHERE name IN ('Housekeeper');