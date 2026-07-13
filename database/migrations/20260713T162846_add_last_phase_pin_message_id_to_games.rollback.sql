-- Rollback for: add last phase pin message id to games
-- Created: 2026-07-13T16:28:46.752Z

ALTER TABLE games
    DROP COLUMN IF EXISTS last_phase_pin_message_id;
