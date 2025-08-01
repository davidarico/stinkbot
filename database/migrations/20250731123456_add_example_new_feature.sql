-- Migration: Add example new feature
-- Created: 2025-07-31T12:34:56.789Z

-- Example migration - you can delete this file
-- This shows how to structure your migrations

-- Add a new column to an existing table
-- ALTER TABLE games ADD COLUMN example_column VARCHAR(50);

-- Create a new table
-- CREATE TABLE example_table (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(100) NOT NULL,
--     created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
-- );

-- Create an index
-- CREATE INDEX idx_example_table_name ON example_table(name);

-- Note: Remember to create the corresponding rollback file!
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    targets VARCHAR(50),
    moves BOOLEAN DEFAULT FALSE,
    description TEXT,
    standard_results_flavor TEXT,
    immunities TEXT,
    special_properties TEXT,
    framer_interaction TEXT,
    -- Can be 'wolf', 'town', 'neutral'
    team VARCHAR(50),
    in_wolf_chat BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);