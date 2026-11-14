-- Migration: add winning team to games
-- Created: 2026-11-14T12:10:00.000Z

-- Who won, recorded at Wolf.end (or later with Wolf.winner). NULL = not recorded.
ALTER TABLE games
    ADD COLUMN IF NOT EXISTS winning_team VARCHAR(20)
        CHECK (winning_team IN ('town', 'wolf', 'neutral', 'draw'));
