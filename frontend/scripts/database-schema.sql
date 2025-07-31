-- Extended database schema for Werewolf game management

-- Roles table - stores all available roles
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    alignment VARCHAR(20) NOT NULL CHECK (alignment IN ('town', 'wolf', 'neutral')),
    description TEXT NOT NULL,
    metadata TEXT, -- Additional role information
    has_info_function BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Game roles table - tracks which roles are selected for a specific game
CREATE TABLE game_roles (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    role_id INTEGER REFERENCES roles(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, role_id)
);

-- Player assignments table - tracks role assignments to players
CREATE TABLE player_assignments (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
    role_id INTEGER REFERENCES roles(id),
    assigned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, player_id)
);

-- Player status table - tracks additional player states
CREATE TABLE player_status (
    id SERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
    is_framed BOOLEAN DEFAULT FALSE,
    action_notes TEXT,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(player_id)
);

-- Game authentication table - stores game passwords and access
CREATE TABLE game_auth (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id)
);

-- Insert sample roles
INSERT INTO roles (name, alignment, description, metadata, has_info_function) VALUES
('Villager', 'town', 'A regular townsperson with no special abilities. Their only power is their vote during the day phase.', NULL, FALSE),
('Seer', 'town', 'Each night, the Seer can investigate one player to learn their alignment (Town, Wolf, or Neutral).', NULL, TRUE),
('Doctor', 'town', 'Each night, the Doctor can choose one player to protect from attacks.', NULL, FALSE),
('Bodyguard', 'town', 'The Bodyguard can protect one player each night. If protected player is attacked, both Bodyguard and attacker die.', NULL, FALSE),
('Detective', 'town', 'Each night, the Detective can investigate a player to learn their exact role.', NULL, TRUE),
('Vigilante', 'town', 'The Vigilante has the ability to eliminate one player during the night phase.', NULL, FALSE),
('Mayor', 'town', 'The Mayor''s vote counts as two votes during the day phase.', NULL, FALSE),
('Medium', 'town', 'The Medium can communicate with dead players and learn information from them.', NULL, TRUE),
('Hunter', 'town', 'When the Hunter dies, they can immediately eliminate another player of their choice.', NULL, FALSE),
('Sleepwalker', 'town', 'Each night, the Sleepwalker randomly visits another player.', NULL, TRUE),
('Bartender', 'town', 'The Bartender can learn information about players by serving them drinks.', NULL, TRUE),
('Werewolf', 'wolf', 'The basic wolf role. Each night, all wolves collectively choose one player to eliminate.', NULL, FALSE),
('Alpha Wolf', 'wolf', 'The leader of the wolf pack with additional abilities.', NULL, FALSE),
('Wolf Shaman', 'wolf', 'A wolf with magical abilities and special actions.', NULL, FALSE),
('Traitor', 'wolf', 'Appears as Town to investigative roles but wins with the wolves.', 'Not added to Wolf Chat initially', FALSE),
('Turncoat', 'neutral', 'The Turncoat can choose to join either the Town or Wolf team during the game.', 'Not added to Wolf Chat', FALSE),
('Serial Killer', 'neutral', 'The Serial Killer kills one player each night and wins by being the last player alive.', NULL, FALSE),
('Jester', 'neutral', 'The Jester wins if they are voted out during the day phase.', NULL, FALSE),
('Survivor', 'neutral', 'The Survivor simply needs to survive until the end of the game.', NULL, FALSE),
('Witch', 'neutral', 'The Witch has potions that can save or kill players.', NULL, FALSE);

-- Add indexes for better performance
CREATE INDEX idx_games_server_status ON games(server_id, status);
CREATE INDEX idx_players_game_status ON players(game_id, status);
CREATE INDEX idx_votes_game_day ON votes(game_id, day_number);
CREATE INDEX idx_player_assignments_game ON player_assignments(game_id);
CREATE INDEX idx_game_roles_game ON game_roles(game_id);
