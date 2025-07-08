-- Werewolf Discord Bot Database Setup
-- This script will completely refresh the database structure
-- WARNING: This will delete ALL existing data!

-- Drop existing triggers first
DROP TRIGGER IF EXISTS update_games_updated_at ON games;
DROP TRIGGER IF EXISTS update_server_configs_updated_at ON server_configs;

-- Drop existing function
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop existing indexes
DROP INDEX IF EXISTS idx_votes_game_day;
DROP INDEX IF EXISTS idx_players_game_status;
DROP INDEX IF EXISTS idx_games_server_status;

-- Drop existing tables (CASCADE will drop dependent objects)
DROP TABLE IF EXISTS votes CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS games CASCADE;
DROP TABLE IF EXISTS server_configs CASCADE;

-- Table to store server configurations
CREATE TABLE server_configs (
    server_id VARCHAR(20) PRIMARY KEY,
    game_prefix VARCHAR(10) NOT NULL DEFAULT 'g',
    game_counter INTEGER NOT NULL DEFAULT 1,
    game_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table to store active games
CREATE TABLE games (
    id SERIAL PRIMARY KEY,
    server_id VARCHAR(20) NOT NULL,
    game_number INTEGER NOT NULL,
    game_name VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'signup', -- signup, active, ended
    day_phase VARCHAR(10) NOT NULL DEFAULT 'night', -- day, night
    day_number INTEGER NOT NULL DEFAULT 1,
    day_message TEXT DEFAULT 'WAKE UP! Time to bully your fellow villagers and vote them out.',
    night_message TEXT DEFAULT 'Night falls. Someone is snoring really loudly.',
    signup_channel_id VARCHAR(20),
    town_square_channel_id VARCHAR(20),
    wolf_chat_channel_id VARCHAR(20),
    memos_channel_id VARCHAR(20),
    results_channel_id VARCHAR(20),
    voting_booth_channel_id VARCHAR(20),
    category_id VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, game_number)
);

-- Table to store player signups
CREATE TABLE players (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL,
    username VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'alive', -- alive, dead
    signed_up_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, user_id)
);

-- Table to store votes
CREATE TABLE votes (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    voter_user_id VARCHAR(20) NOT NULL,
    target_user_id VARCHAR(20) NOT NULL,
    day_number INTEGER NOT NULL,
    voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, voter_user_id, day_number)
);

-- Table to store additional game channels
CREATE TABLE game_channels (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    channel_id VARCHAR(20) NOT NULL,
    channel_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, channel_id)
);

-- Indexes for better performance
CREATE INDEX idx_games_server_status ON games(server_id, status);
CREATE INDEX idx_players_game_status ON players(game_id, status);
CREATE INDEX idx_votes_game_day ON votes(game_id, day_number);
CREATE INDEX idx_game_channels_game ON game_channels(game_id);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to automatically update the updated_at column
CREATE TRIGGER update_server_configs_updated_at 
    BEFORE UPDATE ON server_configs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_games_updated_at 
    BEFORE UPDATE ON games 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
