-- Migration: add_server_id_to_roles
-- Created: 2025-12-11T04:24:57.023Z

-- Add server_id column to roles table
-- NULL server_id means the role is general and available on all servers
ALTER TABLE roles
ADD COLUMN server_id VARCHAR(20);

-- Set default server_id for spotlight roles to the specified server
UPDATE roles
SET server_id = '1354597610656366683'
WHERE is_spotlight = TRUE;

-- Drop the unique constraint on name (we'll add a partial unique index instead)
ALTER TABLE roles
DROP CONSTRAINT IF EXISTS roles_name_key;

-- Create a partial unique index to ensure general roles (server_id IS NULL) have unique names
-- Server-specific roles can have duplicate names
CREATE UNIQUE INDEX roles_name_unique_general ON roles (name) WHERE server_id IS NULL;
