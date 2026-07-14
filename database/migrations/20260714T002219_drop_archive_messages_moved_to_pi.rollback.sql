-- Rollback for: drop archive messages moved to pi
-- Created: 2026-07-14T00:22:19.364Z

-- Recreates the archive_messages table (schema only - data lives in the
-- dedicated archive database on the Pi; restore from
-- ~/stinkbot-archive/archive_messages.sql there if needed).
CREATE TABLE archive_messages (
    id SERIAL PRIMARY KEY,
    message_id VARCHAR(20) NOT NULL UNIQUE,
    content TEXT,
    user_id VARCHAR(20) NOT NULL,
    username VARCHAR(100) NOT NULL,
    display_name VARCHAR(255),
    timestamp TIMESTAMPTZ NOT NULL,
    channel_id VARCHAR(20) NOT NULL,
    channel_name VARCHAR(100) NOT NULL,
    category_id VARCHAR(20) NOT NULL,
    category VARCHAR(100) NOT NULL,
    reply_to_message_id VARCHAR(20),
    attachments JSONB DEFAULT '[]',
    embeds JSONB DEFAULT '[]',
    reactions JSONB DEFAULT '[]',
    archived_at TIMESTAMPTZ NOT NULL,
    archived_by JSONB NOT NULL DEFAULT '{}',
    content_length INTEGER DEFAULT 0,
    has_attachments BOOLEAN DEFAULT FALSE,
    has_embeds BOOLEAN DEFAULT FALSE,
    has_reactions BOOLEAN DEFAULT FALSE,
    is_reply BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_archive_messages_category ON archive_messages(category);
CREATE INDEX idx_archive_messages_channel_name ON archive_messages(channel_name);
CREATE INDEX idx_archive_messages_user_id ON archive_messages(user_id);
CREATE INDEX idx_archive_messages_timestamp ON archive_messages(timestamp DESC);
CREATE INDEX idx_archive_messages_channel_timestamp ON archive_messages(channel_id, timestamp);
CREATE INDEX idx_archive_messages_content_search ON archive_messages USING gin(to_tsvector('english', coalesce(content, '')));

COMMENT ON TABLE archive_messages IS 'Archived Discord messages from Werewolf game categories for search and browse';
