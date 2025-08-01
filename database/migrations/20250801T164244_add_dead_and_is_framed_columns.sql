-- Migration: add dead and is_framed columns
-- Created: 2025-08-01T16:42:44.827Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
alter table players
add column is_dead boolean default false;

alter table players
add column is_framed boolean default false;

alter table players
add column framed_night integer default null;

alter table players
add column charges_left integer default null;