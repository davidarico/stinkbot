-- Migration: add channel names to games
-- Created: 2026-11-14T12:30:00.000Z

-- Per-game overrides for the names of the channels Wolf.start creates (feedback #43).
-- Keys: results, memos, town_square, voting_booth, wolf_chat, dead_chat. Values are the
-- part after the "<prefix><game number>-", e.g. {"town_square": "village-green"}.
-- Missing keys (or NULL) keep the default name. Edited from the dashboard during signups.
ALTER TABLE games
    ADD COLUMN IF NOT EXISTS channel_names JSONB;
