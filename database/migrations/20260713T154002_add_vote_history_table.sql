-- Migration: add vote history table
-- Created: 2026-07-13T15:40:02.185Z

-- Append-only log of every vote and retract action. The live `votes` table is a
-- working set that is wiped at each phase change (see game-phases.js), so this
-- table is the only durable record of voting activity. Powers Wolf.lssv
-- (longest standing second vote) for past days and future vote-history features.

CREATE TABLE vote_history (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    day_number INTEGER NOT NULL,
    voter_user_id VARCHAR(20) NOT NULL,
    -- NULL for retracts
    target_user_id VARCHAR(20),
    action VARCHAR(10) NOT NULL CHECK (action IN ('vote', 'retract')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_vote_history_game_day ON vote_history(game_id, day_number);
