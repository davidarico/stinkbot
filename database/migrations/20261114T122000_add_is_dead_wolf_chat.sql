-- Migration: add is dead wolf chat
-- Created: 2026-11-14T12:20:00.000Z

-- Marks the optional per-game channel where eliminated wolves keep talking
-- (Wolf.wolf_dead, feedback #46). Same pattern as is_couple_chat.
ALTER TABLE game_channels
    ADD COLUMN IF NOT EXISTS is_dead_wolf_chat BOOLEAN DEFAULT FALSE;
