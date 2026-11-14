-- Rollback for: add is dead wolf chat
-- Created: 2026-11-14T12:20:00.000Z

ALTER TABLE game_channels
    DROP COLUMN IF EXISTS is_dead_wolf_chat;
