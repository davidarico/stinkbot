-- Migration: add server user tables
-- Created: 2025-08-10T02:28:07.110Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
CREATE TABLE server_users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    server_id VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL
);