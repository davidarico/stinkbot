-- Migration: add message activity tracking
-- Created: 2026-11-14T12:40:00.000Z

-- Live message counters for active games (feedback #26, #27, #49, #67). The bot adds to
-- these as messages arrive, so Wolf.ia / Wolf.speed_check / Wolf.ia_history / Wolf.silent
-- read a table instead of paging the Discord API.
--
-- One row per player per channel per half hour, tagged with the game day and phase the
-- messages were sent in. Half-hour buckets let the IA window start at any HH:00 or HH:30.
CREATE TABLE message_activity (
    id BIGSERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    channel_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    day_number INTEGER NOT NULL,
    day_phase VARCHAR(10) NOT NULL,
    bucket_start TIMESTAMPTZ NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE (game_id, channel_id, user_id, day_number, day_phase, bucket_start)
);

CREATE INDEX idx_message_activity_game_channel_bucket ON message_activity(game_id, channel_id, bucket_start);

-- When counting began for a game. Readers fall back to the Discord API for any window
-- that starts before this (games already running when tracking shipped).
ALTER TABLE games
    ADD COLUMN IF NOT EXISTS activity_tracked_since TIMESTAMPTZ;

-- Time of day (America/New_York, HH:MM on a half hour) the IA window resets.
-- Was hardcoded to 09:30 (feedback #49). Change with Wolf.settings ia_reset.
ALTER TABLE server_configs
    ADD COLUMN IF NOT EXISTS ia_reset_time VARCHAR(5) NOT NULL DEFAULT '09:30';
