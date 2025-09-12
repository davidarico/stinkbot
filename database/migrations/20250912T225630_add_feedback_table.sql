-- Migration: add_feedback_table
-- Created: 2025-09-12T22:56:30.834Z

-- Table to store user feedback from Discord bot
CREATE TABLE feedback (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    feedback_text TEXT NOT NULL,
    server_id VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Add comment to the table
COMMENT ON TABLE feedback IS 'Stores user feedback submitted through Discord bot commands';
COMMENT ON COLUMN feedback.user_id IS 'Discord user ID who submitted the feedback';
COMMENT ON COLUMN feedback.display_name IS 'Display name of the user at time of submission';
COMMENT ON COLUMN feedback.feedback_text IS 'The feedback message content';
COMMENT ON COLUMN feedback.server_id IS 'Discord server ID where feedback was submitted';
