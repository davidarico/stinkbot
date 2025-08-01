-- Fix game_role table to have proper composite primary key
-- This migration fixes the issue with dual primary keys

-- Drop and recreate the table with proper constraints
DROP TABLE IF EXISTS game_role;

CREATE TABLE game_role (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    role_count INTEGER NOT NULL DEFAULT 1,
    custom_name TEXT,
    PRIMARY KEY (game_id, role_id)
);

-- Add comment
COMMENT ON TABLE game_role IS 'Table to store roles assigned to games, allowing for custom names and theme overrides';
