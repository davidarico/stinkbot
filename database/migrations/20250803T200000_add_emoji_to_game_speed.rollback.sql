-- Rollback Migration: Remove emoji column from game_speed table
-- Created: 2025-08-03T20:00:00.000Z

-- Remove emoji column from game_speed table
ALTER TABLE game_speed DROP COLUMN IF EXISTS emoji; 