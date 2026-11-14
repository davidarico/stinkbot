-- Migration: add last next snapshot to games
-- Created: 2026-11-14T12:00:00.000Z

-- Wolf.next stores the phase it is leaving here (day_phase, day_number, phase_change_at,
-- voting_message_id, last_phase_pin_message_id) so Wolf.rollback can undo the most recent
-- phase change (feedback #63). Cleared once a rollback has used it.
ALTER TABLE games
    ADD COLUMN IF NOT EXISTS last_next_snapshot JSONB;
