-- Migration: add active journals to server configs
-- Created: 2026-11-14T12:50:00.000Z

-- Opt-in per server (Wolf.settings active_journals on, feedback #88): while on, the
-- journals of players in the current game are kept together in an "Active Journals"
-- category and returned to the regular journal categories when the game ends.
ALTER TABLE server_configs
    ADD COLUMN IF NOT EXISTS active_journals BOOLEAN NOT NULL DEFAULT FALSE;
