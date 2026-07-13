-- Werewolf Discord Bot Database Schema
-- Generated automatically on 2026-07-13T16:32:27.098Z
-- This file shows the current database structure with table comments
-- Run this after migrations to get the latest schema

CREATE TABLE admin_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(setting_key)
);

-- Archived Discord messages from Werewolf game categories for search and browse
CREATE TABLE archive_messages (
    id SERIAL PRIMARY KEY,
    message_id VARCHAR(20) NOT NULL,
    content TEXT,
    user_id VARCHAR(20) NOT NULL,
    username VARCHAR(100) NOT NULL,
    display_name VARCHAR(255),
    timestamp TIMESTAMPTZ NOT NULL,
    channel_id VARCHAR(20) NOT NULL,
    channel_name VARCHAR(100) NOT NULL,
    category_id VARCHAR(20) NOT NULL,
    category VARCHAR(100) NOT NULL,
    reply_to_message_id VARCHAR(20),
    attachments JSONB DEFAULT '[]',
    embeds JSONB DEFAULT '[]',
    reactions JSONB DEFAULT '[]',
    archived_at TIMESTAMPTZ NOT NULL,
    archived_by JSONB NOT NULL DEFAULT '{}',
    content_length INTEGER DEFAULT 0,
    has_attachments BOOLEAN DEFAULT FALSE,
    has_embeds BOOLEAN DEFAULT FALSE,
    has_reactions BOOLEAN DEFAULT FALSE,
    is_reply BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id)
);

CREATE TABLE banned_users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- Stores user feedback submitted through Discord bot commands
CREATE TABLE feedback (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    feedback_text TEXT NOT NULL,
    server_id VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Table to store additional game channels (such as couple chat)
CREATE TABLE game_channels (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    channel_id VARCHAR(20),
    channel_name VARCHAR(100) NOT NULL,
    day_message TEXT,
    night_message TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    open_at_dawn BOOLEAN DEFAULT TRUE,
    open_at_dusk BOOLEAN DEFAULT TRUE,
    is_created BOOLEAN DEFAULT FALSE,
    invited_users JSONB,
    is_couple_chat BOOLEAN DEFAULT FALSE,
    UNIQUE(channel_id, game_id)
);

-- Stores cross-night game information like hypnotist effects, auraseer balls, etc.
CREATE TABLE game_meta (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL,
    night INTEGER NOT NULL,
    meta_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, night, user_id)
);

CREATE TABLE game_role (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL,
    sort_index INTEGER NOT NULL,
    role_id INTEGER NOT NULL,
    custom_name TEXT,
    charges INTEGER NOT NULL DEFAULT 0,
    win_by_number INTEGER NOT NULL DEFAULT 0,
    UNIQUE(game_id, sort_index)
);

-- Table to store speed vote information
CREATE TABLE game_speed (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    message_id VARCHAR(20) NOT NULL,
    channel_id VARCHAR(20) NOT NULL,
    target_reactions INTEGER NOT NULL,
    current_reactions INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    emoji VARCHAR(50) DEFAULT '⚡',
    UNIQUE(game_id)
);

-- Table to store game information
CREATE TABLE games (
    id SERIAL PRIMARY KEY,
    server_id VARCHAR(20) NOT NULL,
    game_number INTEGER NOT NULL,
    game_name VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'signup',
    day_phase VARCHAR(10) NOT NULL DEFAULT 'night',
    day_number INTEGER NOT NULL DEFAULT 1,
    votes_to_hang INTEGER NOT NULL DEFAULT 4,
    day_message TEXT DEFAULT 'WAKE UP! Time to bully your fellow villagers and vote them out.',
    night_message TEXT DEFAULT 'Night falls. Someone is snoring really loudly.',
    wolf_day_message TEXT,
    wolf_night_message TEXT,
    signup_channel_id VARCHAR(20),
    signup_message_id VARCHAR(20),
    town_square_channel_id VARCHAR(20),
    wolf_chat_channel_id VARCHAR(20),
    memos_channel_id VARCHAR(20),
    results_channel_id VARCHAR(20),
    voting_booth_channel_id VARCHAR(20),
    voting_message_id VARCHAR(20),
    mod_chat_channel_id VARCHAR(20),
    category_id VARCHAR(20),
    phase_change_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_skinned BOOLEAN DEFAULT FALSE,
    is_themed BOOLEAN DEFAULT FALSE,
    theme_name VARCHAR(100) DEFAULT NULL,
    signups_closed BOOLEAN NOT NULL DEFAULT FALSE,
    dashboard_password_hash TEXT,
    last_phase_pin_message_id VARCHAR(20)
);

CREATE TABLE night_action (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    night_number INTEGER NOT NULL
);

-- Table to store player journals for personal notes
CREATE TABLE player_journals (
    id SERIAL PRIMARY KEY,
    server_id VARCHAR(20) NOT NULL,
    server_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    channel_id VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, server_id),
    UNIQUE(server_id, user_id)
);

-- Table to store player information
CREATE TABLE players (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL,
    username VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'alive',
    is_wolf BOOLEAN DEFAULT FALSE,
    signed_up_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    role_id INTEGER,
    skinned_role VARCHAR(100) DEFAULT NULL,
    is_dead BOOLEAN DEFAULT FALSE,
    is_framed BOOLEAN DEFAULT FALSE,
    framed_night INTEGER,
    charges_left INTEGER,
    win_by_number INTEGER DEFAULT 0,
    thematic_custom_name VARCHAR(255),
    UNIQUE(game_id, user_id)
);

-- Table to store game roles and their properties
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    targets VARCHAR(50),
    moves BOOLEAN DEFAULT FALSE,
    description TEXT,
    standard_results_flavor TEXT,
    immunities TEXT,
    special_properties TEXT,
    framer_interaction TEXT DEFAULT FALSE,
    team VARCHAR(50),
    in_wolf_chat BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_spotlight BOOLEAN DEFAULT FALSE,
    has_charges BOOLEAN NOT NULL DEFAULT FALSE,
    default_charges INTEGER NOT NULL DEFAULT 0,
    has_win_by_number BOOLEAN DEFAULT FALSE,
    default_win_by_number INTEGER DEFAULT 0,
    server_id VARCHAR(20)
);

-- Table to store server configurations
CREATE TABLE server_configs (
    server_id VARCHAR(20) NOT NULL PRIMARY KEY,
    game_prefix VARCHAR(10) NOT NULL DEFAULT 'g',
    game_counter INTEGER NOT NULL DEFAULT 1,
    game_name VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    server_name VARCHAR(255)
);

CREATE TABLE server_users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    server_id VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    profile_picture_link VARCHAR(255),
    UNIQUE(server_id, user_id)
);

CREATE TABLE super_users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

CREATE TABLE vote_history (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    day_number INTEGER NOT NULL,
    voter_user_id VARCHAR(20) NOT NULL,
    target_user_id VARCHAR(20),
    action VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table to store votes cast by players
CREATE TABLE votes (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    voter_user_id VARCHAR(20) NOT NULL,
    target_user_id VARCHAR(20) NOT NULL,
    day_number INTEGER NOT NULL,
    voted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(day_number, game_id, voter_user_id)
);

