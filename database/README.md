# StinkBot Database

Database migrations and setup scripts for StinkBot.

## Files

- `database_setup.sql` - Legacy initial database schema setup (use migrations instead)
- `migrate.js` - Migration runner script
- `migrations/` - Directory containing all migration files
- `.env.example` - Example environment configuration

## Setup

### Prerequisites
- PostgreSQL installed and running
- Node.js for running migrations

### Environment Configuration
1. Copy `.env.example` to `.env`
2. Update the database credentials in `.env`

### Install Dependencies
```bash
npm install
```

## Usage

### Database Migrations

#### Apply All Pending Migrations
```bash
npm run migrate
# or
npm run migrate:up
```

#### Check Migration Status
```bash
npm run migrate:status
```

#### Rollback Last Migration
```bash
npm run migrate:down
# or
npm run migrate:rollback
```

#### Rollback Multiple Migrations
```bash
node migrate.js rollback 3  # rollback last 3 migrations
```

#### Create New Migration
```bash
npm run migrate:create "add user preferences table"
# or
node migrate.js create "add user preferences table"
```

This will create two files:
- `YYYYMMDDHHMMSS_add_user_preferences_table.sql` - The migration
- `YYYYMMDDHHMMSS_add_user_preferences_table.rollback.sql` - The rollback

#### Reset Database (Development Only)
```bash
npm run db:reset
```
⚠️ **Warning**: This will destroy all data!

### Migration File Structure

Each migration consists of two files:
1. `*.sql` - The forward migration
2. `*.rollback.sql` - The reverse migration

Example migration file (`20250731120000_add_user_settings.sql`):
```sql
-- Migration: Add user settings
-- Created: 2025-07-31T12:00:00.000Z

CREATE TABLE user_settings (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, setting_key)
);

CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);
```

Example rollback file (`20250731120000_add_user_settings.rollback.sql`):
```sql
-- Rollback for: Add user settings
-- Created: 2025-07-31T12:00:00.000Z

DROP INDEX IF EXISTS idx_user_settings_user_id;
DROP TABLE IF EXISTS user_settings;
```

### Best Practices

1. **Always create rollback files** - Every migration should have a corresponding rollback
2. **Use descriptive names** - Migration names should clearly describe what they do
3. **Test rollbacks** - Always test that your rollbacks work correctly
4. **Keep migrations atomic** - Each migration should be a single logical change
5. **Don't modify existing migrations** - Once applied, never modify a migration file
6. **Use transactions** - The migration runner wraps each migration in a transaction

### Migration Naming Convention

Migrations are named with the format:
`YYYYMMDDHHMMSS_descriptive_name.sql`

Where:
- `YYYY` - Year (4 digits)
- `MM` - Month (2 digits) 
- `DD` - Day (2 digits)
- `HH` - Hour (2 digits)
- `MM` - Minute (2 digits)
- `SS` - Second (2 digits)
- `descriptive_name` - Snake_case description

### Legacy Setup (Deprecated)
```bash
npm run setup  # Uses database_setup.sql - only for initial development
```

## Schema

The database uses PostgreSQL and includes tables for:
- Server configurations
- Game instances  
- Player management
- Voting records
- Game channels
- Player journals

See the migration files in `migrations/` directory for the complete schema.

## Environment Variables

The migration system supports two ways to configure database connections:

### Option 1: DATABASE_URL (Recommended)
Use a single connection string that includes all connection details:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Full PostgreSQL connection string | `postgresql://user:pass@host:port/db` |

Example DATABASE_URL formats:
```bash
# Local development
DATABASE_URL=postgresql://postgres:password@localhost:5432/stinkbot

# Production with SSL (common on hosted services like Heroku, Railway, etc.)
DATABASE_URL=postgresql://user:pass@host.com:5432/dbname?sslmode=require

# Local with SSL disabled
DATABASE_URL=postgresql://postgres:password@localhost:5432/stinkbot?sslmode=disable
```

### Option 2: Individual Environment Variables
If `DATABASE_URL` is not set, these individual variables will be used:

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `5432` |
| `DB_NAME` | Database name | `stinkbot` |
| `DB_USER` | Database user | `postgres` |
| `DB_PASSWORD` | Database password | _(empty)_ |

**Note:** `DATABASE_URL` takes priority over individual environment variables. This is the recommended approach for production deployments and when dealing with SSL connections.
