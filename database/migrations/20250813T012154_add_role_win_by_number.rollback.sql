-- Rollback for: add role win by number
-- Created: 2025-08-13T01:21:54.971Z

-- Add your rollback SQL here
-- Example:
-- DROP TABLE IF EXISTS example;
ALTER TABLE roles 
DROP COLUMN has_win_by_number;

ALTER TABLE roles 
DROP COLUMN default_win_by_number;

ALTER TABLE game_role
DROP COLUMN win_by_number;