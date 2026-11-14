-- Rollback for: add winning team to games
-- Created: 2026-11-14T12:10:00.000Z

ALTER TABLE games
    DROP COLUMN IF EXISTS winning_team;
