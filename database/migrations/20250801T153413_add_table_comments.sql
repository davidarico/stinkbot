-- Migration: add table comments
-- Created: 2025-08-01T15:34:13.777Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
COMMENT ON TABLE server_configs IS 'Table to store server configurations';
COMMENT ON TABLE games IS 'Table to store game information';
COMMENT ON TABLE players IS 'Table to store player information';
COMMENT ON TABLE votes IS 'Table to store votes cast by players';
COMMENT ON TABLE game_channels IS 'Table to store additional game channels (such as couple chat)';
COMMENT ON TABLE game_speed IS 'Table to store speed vote information';
COMMENT ON TABLE player_journals IS 'Table to store player journals for personal notes';
COMMENT ON TABLE roles IS 'Table to store game roles and their properties';