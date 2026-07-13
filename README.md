# StinkBot

StinkBot runs Werewolf (mafia) games on Discord. This repo holds the bot, a web frontend for moderators, and the PostgreSQL migrations they share.

## Layout

```
bot/               Discord bot (discord.js)
frontend/          Next.js app: mod dashboard, role reference, message archives
database/          PostgreSQL migrations and schema tooling
engine-generator/  Deterministic night-action engine (standalone, not yet integrated)
docs/              Cross-cutting technical docs
scripts/           Maintenance scripts
FAIL-OVER.md       Planned failover architecture
FEEDBACK.md        Triaged player feedback from the in-bot feedback command
```

## Setup

Requires Node.js 18+, PostgreSQL, and a Discord bot token.

```bash
npm install          # installs the bot, frontend, and database workspaces
```

Copy `.env.example` to `.env` in `bot/`, `frontend/`, and `database/`, fill in your values, then:

```bash
npm run db:migrate   # apply database migrations
npm run bot:start    # start the bot
npm run frontend:dev # start the frontend dev server
```

Detailed setup for each component (Discord permissions, S3, environment variables) lives in its own README:

- [bot/README.md](bot/README.md)
- [frontend/README.md](frontend/README.md)
- [database/README.md](database/README.md)
- [engine-generator/README.md](engine-generator/README.md)

Note: `engine-generator` is not part of the npm workspace. If you need it, run `npm install` inside that directory.

## Root scripts

| Script | Description |
|--------|-------------|
| `npm run bot:start` | Start the Discord bot |
| `npm run bot:dev` | Start the bot with auto-restart (nodemon) |
| `npm run bot:test` | Run the bot's connectivity test script |
| `npm run frontend:dev` | Start the frontend dev server |
| `npm run frontend:build` | Build the frontend for production |
| `npm run db:migrate` | Apply pending database migrations |

Each workspace has additional scripts in its own `package.json` (unit tests, migration rollbacks, schema generation, and so on).

## Deployment

- **Bot**: pushes to `main` that touch `bot/` build a multi-arch Docker image and publish it to `ghcr.io/davidarico/stinkbot:latest` (`.github/workflows/bot.yml`). Production runs this image on a VM.
- **Frontend**: deployed on Vercel.
- **Database**: Supabase PostgreSQL.

See [FAIL-OVER.md](FAIL-OVER.md) for the planned primary/standby setup.

## License

MIT
