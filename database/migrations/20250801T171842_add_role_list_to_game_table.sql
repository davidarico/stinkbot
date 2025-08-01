-- Migration: add role list to game table
-- Created: 2025-08-01T17:18:42.557Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
CREATE TABLE game_role (
  game_id       INT   NOT NULL  REFERENCES games(id),
  role_id       INT   NOT NULL  REFERENCES roles(id),
  role_count    INT   NOT NULL DEFAULT 1,  -- Number of this role in the game
  custom_name   TEXT,            -- NULL when there’s no theme override
  PRIMARY KEY (game_id, role_id)
);

COMMENT ON TABLE game_role IS 'Table to store roles assigned to games, allowing for custom names and theme overrides';
