-- Migration: add last phase pin message id to games
-- Created: 2026-07-13T16:28:46.752Z

-- Tracks the currently-pinned phase-start embed in town square so Wolf.next can
-- unpin it when posting the next phase's embed (feedback #81, #89).
ALTER TABLE games
    ADD COLUMN IF NOT EXISTS last_phase_pin_message_id VARCHAR(20);
