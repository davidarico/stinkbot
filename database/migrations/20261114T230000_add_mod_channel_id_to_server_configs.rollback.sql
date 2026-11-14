-- Rollback for: add mod channel id to server configs
-- Created: 2026-11-14T23:00:00.000Z

ALTER TABLE server_configs
    DROP COLUMN IF EXISTS mod_channel_id;
