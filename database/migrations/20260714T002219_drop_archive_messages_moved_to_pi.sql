-- Migration: drop archive messages moved to pi
-- Created: 2026-07-14T00:22:19.364Z

-- Message archives moved to a dedicated self-hosted Postgres (Pi at
-- dcc-pi.duckdns.org:5433, see ARCHIVE_DATABASE_URL). The bot and frontend
-- no longer read archive_messages from this database, so drop it to free
-- Supabase storage. Run this only after verifying the archive database is
-- reachable from production.
DROP TABLE IF EXISTS archive_messages;
