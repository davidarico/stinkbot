-- Rollback for: Initial schema setup
-- Created: 2025-07-31T00:00:00.000Z

-- Drop triggers first
DROP TRIGGER IF EXISTS update_games_updated_at ON games;
DROP TRIGGER IF EXISTS update_server_configs_updated_at ON server_configs;

-- Drop function
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop indexes
DROP INDEX IF EXISTS idx_votes_game_day;
DROP INDEX IF EXISTS idx_players_game_status;
DROP INDEX IF EXISTS idx_games_server_status;
DROP INDEX IF EXISTS idx_game_channels_game;
DROP INDEX IF EXISTS idx_game_speed_game;
DROP INDEX IF EXISTS idx_player_journals_server_user;
DROP INDEX IF EXISTS idx_player_journals_channel;

-- Drop tables (CASCADE will drop dependent objects)
DROP TABLE IF EXISTS votes CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS games CASCADE;
DROP TABLE IF EXISTS server_configs CASCADE;
DROP TABLE IF EXISTS game_channels CASCADE;
DROP TABLE IF EXISTS game_speed CASCADE;
DROP TABLE IF EXISTS player_journals CASCADE;
