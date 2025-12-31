-- Rollback for: add signups_closed to games table
-- Created: 2025-12-31T20:18:59.000Z

ALTER TABLE games DROP COLUMN signups_closed;
