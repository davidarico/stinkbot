-- Migration: server users profile picture link
-- Created: 2025-08-12T19:41:52.619Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
ALTER TABLE server_users ADD COLUMN profile_picture_link VARCHAR(255);