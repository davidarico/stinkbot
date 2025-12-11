-- Rollback for: add_server_id_to_roles
-- Created: 2025-12-11T04:24:57.023Z

-- Drop the partial unique index
DROP INDEX IF EXISTS roles_name_unique_general;

-- Restore the unique constraint on name
ALTER TABLE roles
ADD CONSTRAINT roles_name_key UNIQUE (name);

-- Remove server_id column from roles table
ALTER TABLE roles
DROP COLUMN IF EXISTS server_id;
