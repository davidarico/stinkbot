-- Rollback for fixing game_role table
DROP TABLE IF EXISTS game_role;

-- Recreate the old table structure (even though it was incorrect)
CREATE TABLE game_role (
    game_id INTEGER NOT NULL PRIMARY KEY,
    role_id INTEGER NOT NULL PRIMARY KEY,
    role_count INTEGER NOT NULL DEFAULT 1,
    custom_name TEXT
);
