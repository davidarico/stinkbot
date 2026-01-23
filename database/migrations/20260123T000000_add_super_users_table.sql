-- Add super_users table to track users who can grant/revoke Mod role
CREATE TABLE super_users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial super users
INSERT INTO super_users (user_id) VALUES
    ('162675596772638720'),
    ('193883917055557642');

