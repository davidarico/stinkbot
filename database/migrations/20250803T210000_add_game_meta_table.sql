-- Add game_meta table for tracking cross-night information
CREATE TABLE game_meta (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL,
    night INTEGER NOT NULL,
    meta_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, user_id, night)
);

-- Add index for efficient queries
CREATE INDEX idx_game_meta_game_user ON game_meta(game_id, user_id);
CREATE INDEX idx_game_meta_game_night ON game_meta(game_id, night);

-- Add comment to table
COMMENT ON TABLE game_meta IS 'Stores cross-night game information like hypnotist effects, auraseer balls, etc.'; 