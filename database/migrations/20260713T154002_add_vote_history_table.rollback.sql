-- Rollback for: add vote history table
-- Created: 2026-07-13T15:40:02.185Z

DROP INDEX IF EXISTS idx_vote_history_game_day;
DROP TABLE IF EXISTS vote_history;
