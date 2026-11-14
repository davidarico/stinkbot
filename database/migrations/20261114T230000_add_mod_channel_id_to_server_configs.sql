-- Migration: add mod channel id to server configs
-- Created: 2026-11-14T23:00:00.000Z

-- Servers that don't want a mod chat created for every game (feedback #91) set this with
-- `Wolf.settings mod_chat off`, run in their standing private mod channel. New games then
-- use that channel as their mod chat (dashboard password, mod alerts). NULL = default:
-- Wolf.create makes a per-game mod chat.
ALTER TABLE server_configs
    ADD COLUMN IF NOT EXISTS mod_channel_id VARCHAR(20);
