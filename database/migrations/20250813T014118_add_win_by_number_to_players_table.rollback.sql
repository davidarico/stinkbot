-- Rollback for: add win by number to players table
-- Created: 2025-08-13T01:41:18.282Z

-- Add your rollback SQL here
-- Example:
-- DROP TABLE IF EXISTS example;
ALTER TABLE players
DROP COLUMN win_by_number;