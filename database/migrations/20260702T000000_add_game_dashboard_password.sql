-- Store a one-way hash for each game's moderator dashboard password.
-- Existing games remain usable through the temporary category_id fallback in
-- the frontend until they end or receive a generated password.
ALTER TABLE games
    ADD COLUMN IF NOT EXISTS dashboard_password_hash TEXT;

