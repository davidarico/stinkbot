-- Migration: Add emoji column to game_speed table
-- Created: 2025-08-03T20:00:00.000Z
-- Safe to run on existing databases

-- Add emoji column to game_speed table
ALTER TABLE game_speed ADD COLUMN emoji VARCHAR(50) DEFAULT '⚡';

-- Add comment to the new column
COMMENT ON COLUMN game_speed.emoji IS 'Custom emoji for speed vote reactions, defaults to lightning bolt'; 