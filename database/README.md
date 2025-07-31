# StinkBot Database

Database migrations and setup scripts for StinkBot.

## Files

- `database_setup.sql` - Initial database schema setup

## Usage

### Setup Database
```bash
npm run setup
```

### Run Migrations (Coming Soon)
```bash
npm run migrate
```

### Seed Database (Coming Soon)
```bash
npm run seed
```

## Schema

The database uses PostgreSQL and includes tables for:
- Server configurations
- Game instances
- Player management
- Voting records
- Game channels
- Player journals

See `database_setup.sql` for the complete schema.
