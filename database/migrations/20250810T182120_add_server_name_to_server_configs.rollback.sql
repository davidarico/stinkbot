-- Rollback for: add server name to server configs
-- Created: 2025-08-10T18:21:20.539Z

-- Add your rollback SQL here
-- Example:
-- DROP TABLE IF EXISTS example;
ALTER TABLE server_configs DROP COLUMN server_name;