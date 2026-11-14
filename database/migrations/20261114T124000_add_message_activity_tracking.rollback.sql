-- Rollback for: add message activity tracking
-- Created: 2026-11-14T12:40:00.000Z

ALTER TABLE server_configs
    DROP COLUMN IF EXISTS ia_reset_time;

ALTER TABLE games
    DROP COLUMN IF EXISTS activity_tracked_since;

DROP TABLE IF EXISTS message_activity;
