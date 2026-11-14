-- Rollback for: add active journals to server configs
-- Created: 2026-11-14T12:50:00.000Z

ALTER TABLE server_configs
    DROP COLUMN IF EXISTS active_journals;
