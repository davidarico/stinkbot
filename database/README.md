# StinkBot Database

PostgreSQL migrations and schema tooling shared by the bot and frontend.

## Files

- `migrate.js` - Migration runner
- `migrations/` - Migration files (forward + rollback pairs)
- `generate_schema.js` - Dumps the live schema to `current_schema.sql`
- `current_schema.sql` - Generated snapshot of the full schema
- `.env.example` - Example environment configuration

## Setup

1. Install and start PostgreSQL, and make sure Node.js is available.
2. Copy `.env.example` to `.env` and set your connection details.
3. `npm install` (or `npm install` from the repo root, which covers all workspaces).

## Usage

### Migrations

```bash
npm run migrate            # apply all pending migrations (alias: migrate:up)
npm run migrate:status     # show applied/pending migrations
npm run migrate:down       # roll back the last migration (alias: migrate:rollback)
node migrate.js rollback 3 # roll back the last 3 migrations
```

### Creating a migration

```bash
npm run migrate:create "add user preferences table"
```

This creates two files in `migrations/`:

- `YYYYMMDDTHHMMSS_add_user_preferences_table.sql` - the forward migration
- `YYYYMMDDTHHMMSS_add_user_preferences_table.rollback.sql` - the rollback

Guidelines:

1. Every migration gets a rollback file, and test that the rollback works.
2. Keep each migration to a single logical change.
3. Never modify a migration that has already been applied; write a new one.
4. The runner wraps each migration in a transaction.

### Schema snapshot

```bash
npm run schema:generate
```

Regenerates `current_schema.sql` from the connected database. Run this after applying new migrations so the snapshot stays accurate - it is the file other tooling (and `.cursor/rules`) points at as the schema reference. If it disagrees with the migrations directory, trust the migrations.

### Reset (development only)

```bash
npm run db:reset
```

Drops and recreates the `stinkbot` database, then reapplies all migrations. This destroys all data.

## Schema overview

Core game tables: `games`, `players`, `votes`, `game_channels`, `game_role`, `roles`, `game_meta`, `game_speed`, `night_action`, `player_journals`. Server and admin tables: `server_configs`, `server_users`, `super_users`, `banned_users`, `admin_settings`, `feedback`. Archives: `archive_messages`. See `current_schema.sql` or the migration files for details.

## Environment variables

The migration runner supports two configurations:

### Option 1: DATABASE_URL (recommended)

```bash
# Local development
DATABASE_URL=postgresql://postgres:password@localhost:5432/stinkbot

# Hosted with SSL (Supabase, Railway, etc.)
DATABASE_URL=postgresql://user:pass@host.com:5432/dbname?sslmode=require

# Local with SSL disabled
DATABASE_URL=postgresql://postgres:password@localhost:5432/stinkbot?sslmode=disable
```

### Option 2: Individual variables

Used only when `DATABASE_URL` is not set:

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `5432` |
| `DB_NAME` | Database name | `stinkbot` |
| `DB_USER` | Database user | `postgres` |
| `DB_PASSWORD` | Database password | (empty) |
