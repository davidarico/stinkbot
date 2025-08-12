-- Rollback for: server users profile picture link
-- Created: 2025-08-12T19:41:52.619Z

-- Add your rollback SQL here
-- Example:
-- DROP TABLE IF EXISTS example;
ALTER TABLE server_users DROP COLUMN profile_picture_link;