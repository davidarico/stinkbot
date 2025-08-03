-- Migration: Add Night Action Table
-- Created: 2025-08-03T17:36:50.871Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
CREATE TABLE night_action (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    night_number INTEGER NOT NULL,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);