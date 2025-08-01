-- Migration: Initial schema setup
-- Created: 2025-07-31T00:00:00.000Z
-- Safe to run on existing databases

-- Table to store server configurations
CREATE TABLE IF NOT EXISTS server_configs (
    server_id VARCHAR(20) PRIMARY KEY,
    game_prefix VARCHAR(10) NOT NULL DEFAULT 'g',
    game_counter INTEGER NOT NULL DEFAULT 1,
    game_name VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Table to store active games
CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    server_id VARCHAR(20) NOT NULL,
    game_number INTEGER NOT NULL,
    game_name VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'signup', -- signup, active, ended
    day_phase VARCHAR(10) NOT NULL DEFAULT 'night', -- day, night
    day_number INTEGER NOT NULL DEFAULT 1,
    votes_to_hang INTEGER NOT NULL DEFAULT 4,
    day_message TEXT DEFAULT 'WAKE UP! Time to bully your fellow villagers and vote them out.',
    night_message TEXT DEFAULT 'Night falls. Someone is snoring really loudly.',
    wolf_day_message TEXT, -- Custom day message for wolf chat (optional)
    wolf_night_message TEXT, -- Custom night message for wolf chat (optional)
    signup_channel_id VARCHAR(20),
    signup_message_id VARCHAR(20), -- ID of the current signup message
    town_square_channel_id VARCHAR(20),
    wolf_chat_channel_id VARCHAR(20),
    memos_channel_id VARCHAR(20),
    results_channel_id VARCHAR(20),
    voting_booth_channel_id VARCHAR(20),
    voting_message_id VARCHAR(20), -- ID of the current voting message
    mod_chat_channel_id VARCHAR(20),
    category_id VARCHAR(20),
    phase_change_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, game_number)
);

-- Table to store player signups
CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL,
    username VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'alive', -- alive, dead
    role VARCHAR(100), -- Player's assigned role (Werewolf, Villager, Seer, etc.)
    is_wolf BOOLEAN DEFAULT FALSE, -- True if player has a wolf role
    signed_up_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, user_id)
);

-- Table to store votes
CREATE TABLE IF NOT EXISTS votes (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    voter_user_id VARCHAR(20) NOT NULL,
    target_user_id VARCHAR(20) NOT NULL,
    day_number INTEGER NOT NULL,
    voted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, voter_user_id, day_number)
);

-- Table to store additional game channels
CREATE TABLE IF NOT EXISTS game_channels (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    channel_id VARCHAR(20) NOT NULL,
    channel_name VARCHAR(100) NOT NULL,
    day_message TEXT,
    night_message TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, channel_id)
);

-- Table to store speed vote information
CREATE TABLE IF NOT EXISTS game_speed (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    message_id VARCHAR(20) NOT NULL,
    channel_id VARCHAR(20) NOT NULL,
    target_reactions INTEGER NOT NULL,
    current_reactions INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id)
);

-- Table to store player journals
CREATE TABLE IF NOT EXISTS player_journals (
    id SERIAL PRIMARY KEY,
    server_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    channel_id VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, user_id),
    UNIQUE(server_id, channel_id)
);

-- Indexes for better performance (CREATE INDEX IF NOT EXISTS is PostgreSQL 9.5+)
CREATE INDEX IF NOT EXISTS idx_games_server_status ON games(server_id, status);
CREATE INDEX IF NOT EXISTS idx_players_game_status ON players(game_id, status);
CREATE INDEX IF NOT EXISTS idx_votes_game_day ON votes(game_id, day_number);
CREATE INDEX IF NOT EXISTS idx_game_channels_game ON game_channels(game_id);
CREATE INDEX IF NOT EXISTS idx_game_speed_game ON game_speed(game_id);
CREATE INDEX IF NOT EXISTS idx_player_journals_server_user ON player_journals(server_id, user_id);
CREATE INDEX IF NOT EXISTS idx_player_journals_channel ON player_journals(channel_id);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to automatically update the updated_at column
-- Drop and recreate to ensure they exist
DROP TRIGGER IF EXISTS update_server_configs_updated_at ON server_configs;
CREATE TRIGGER update_server_configs_updated_at 
    BEFORE UPDATE ON server_configs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_games_updated_at ON games;
CREATE TRIGGER update_games_updated_at 
    BEFORE UPDATE ON games 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
