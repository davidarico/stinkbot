-- Rollback for: add last next snapshot to games
-- Created: 2026-11-14T12:00:00.000Z

ALTER TABLE games
    DROP COLUMN IF EXISTS last_next_snapshot;
