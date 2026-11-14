-- Rollback for: add channel names to games
-- Created: 2026-11-14T12:30:00.000Z

ALTER TABLE games
    DROP COLUMN IF EXISTS channel_names;
