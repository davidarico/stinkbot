-- Migration: add server name to server configs
-- Created: 2025-08-10T18:21:20.539Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
ALTER TABLE server_configs ADD COLUMN server_name VARCHAR(255);