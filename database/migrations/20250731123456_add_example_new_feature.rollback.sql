-- Rollback for: Add example new feature
-- Created: 2025-07-31T12:34:56.789Z

-- Example rollback - you can delete this file
-- This shows how to structure your rollbacks

-- Drop the index first
-- DROP INDEX IF EXISTS idx_example_table_name;

-- Drop the new table
-- DROP TABLE IF EXISTS example_table;

-- Remove the new column
-- ALTER TABLE games DROP COLUMN IF EXISTS example_column;

-- Note: Rollbacks should undo everything the migration does, in reverse order!
DELETE TABLE IF EXISTS roles CASCADE;