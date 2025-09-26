-- Add banned_users table to track users who are banned from playing
CREATE TABLE banned_users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Insert the provided Discord IDs
INSERT INTO banned_users (user_id) VALUES 
    ('406898210804858884'),
    ('162675596772638720'),
    ('150833402453557249');
