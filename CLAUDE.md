# CLAUDE.md

Context for working in this repo that doesn't belong in the README.

## What this is

A Discord bot ("StinkBot") that runs Werewolf/mafia games, plus a Next.js frontend where moderators manage games and browse message archives. One person project (David). Production traffic is real Discord servers running live games - be careful with anything touching game state.

## Monorepo shape

- npm workspaces: `bot`, `frontend`, `database`. Run workspace scripts from the repo root (`npm run bot:dev`, `npm run db:migrate`, etc.).
- `engine-generator/` is **not** a workspace. It's a standalone TypeScript night-action calculator built to replace the frontend's old OpenAI-based night calculation. It is not wired into the bot or frontend yet.
- The frontend's old OpenAI night-action calculation is gone, but the `openai` dependency in `frontend/package.json` and the root `package.json` still lingers unused.

## Bot (`bot/`)

- Prefix commands only (`Wolf.command`), no slash commands. Prefix comes from `BOT_PREFIX` (default `Wolf.`); the per-server *game/channel* prefix (e.g. `g1-townsquare`) is separate and lives in `server_configs.game_prefix`.
- `src/index.js` is the entry (Discord client, intents, cron). `src/werewolf-bot.js` is a router - a big `switch` over command names plus lazy service clients (OpenAI, S3, OpenSearch, all optional and conditional on env vars). All real logic lives in `src/handlers/*.js`. New commands: add a `case` in werewolf-bot.js and implement in the appropriate handler.
- Daily member sync cron runs at **4 AM UTC** (`0 4 * * *`) and only in `NODE_ENV=production`.
- Two test systems:
  - `npm run test:unit` (from `bot/`) - Jest, tests in `bot/src/tests/`, mocks in `bot/src/tests/helpers/` (mock-discord, mock-db, bot-factory). This is the suite to run and extend.
  - `npm test` runs `bot/test/test-bot.js`, a legacy connectivity check against real Discord/Postgres. Not a unit test suite.
- `src/database.js` loads env from the first existing of `database/.env`, `.env`, `bot/.env` (dev only) so the bot and migrations always see the same `DATABASE_URL`. `DATABASE_URL` is required; the `PG_*` variables are deprecated. Supabase TLS is auto-relaxed in dev when the URL looks like Supabase; override with `DATABASE_SSL_REJECT_UNAUTHORIZED`.
- SQLite (`bot/data/alive_mentions.db`) is only for @Alive mention rate-limiting (`alive-mention-detector.js`, gated by `ENABLE_ALIVE_MENTION_DETECTION`). Ephemeral state, not game data.
- The archive command (`Wolf.archive`) writes messages to the `archive_messages` table in the dedicated archive database (see Archives section), uploads Discord images to the hardcoded S3 bucket `stinkwolf-images` (message ID as filename), and optionally drops a JSON backup in `AWS_S3_BUCKET_NAME`.

## Archives: OpenSearch is legacy

Archive search was migrated from OpenSearch to Postgres full-text search on `archive_messages`. `docs/archives-search-system.md` is the authoritative doc. OpenSearch scripts in `bot/scripts/` and the OpenSearch client setup in werewolf-bot.js are leftovers from before the migration - don't build new features on them.

`archive_messages` lives in a **dedicated archive database**, not Supabase: an isolated Postgres 17 container on the Raspberry Pi (`ssh david@david`, `~/stinkbot-archive/`, container `stinkbot-archive-db`, host port 5433, reachable externally at `dcc-pi.duckdns.org:5433` with a self-signed cert). Both apps use `ARCHIVE_DATABASE_URL` for it (bot: `src/archive-database.js` → `this.archiveDb`; frontend: `archivePool` in `lib/database.ts`) and fall back to `DATABASE_URL` when unset. Everything else (`server_users` enrichment included) stays on the main database - archive queries must never join main-DB tables.

## Database (`database/`)

- Migrations are paired files: `<timestamp>_name.sql` + `.rollback.sql`. Create with `npm run migrate:create "description"` from `database/`. Never edit an applied migration.
- `database/current_schema.sql` is **generated** (`npm run schema:generate`) and can lag behind migrations (it currently still shows `kanban_tasks`, which a July 2026 migration dropped). Regenerate it after adding migrations; when in doubt, trust the migrations directory.
- Schema highlights: `games` (status/phase/day, per-game dashboard password hash), `players`, `votes`, `game_channels`, `game_role` + `roles` (role catalog, per-server via `server_id`), `game_meta` (cross-night JSONB state), `game_speed`, `player_journals`, `server_configs`, `server_users` (member sync), `feedback`, `banned_users`, `admin_settings`, `night_action`.
- `votes` is a live working set - `Wolf.next` deletes all of a game's votes at phase change. `vote_history` is the durable append-only log (every vote/retract event, written by `logVoteAction` in voting.js); use it for anything that needs past days (e.g. `Wolf.lssv`).

## Frontend (`frontend/`)

- Next.js 16 App Router, React 19, TypeScript, Tailwind v4, shadcn/radix components in `components/ui/`.
- No ORM. `lib/database.ts` is the single service layer - server routes call its methods, which run raw `pg` queries. Add data access there, not inline in routes.
- Pages: `/game/[gameId]` (mod dashboard), `/roles` (role reference), `/archives` (message search) plus `/archives/baseball`, `/admin` (feedback triage, server roles).
- Auth: per-game moderator sessions. Game password is scrypt-hashed in the DB; sessions are HMAC-signed cookies (`lib/game-auth.ts`, requires `GAME_TOKEN_SECRET`). Admin routes have their own auth under `app/api/admin/`.
- Design system: dark-only "Moonwatch" theme, tokens in `app/globals.css`. Use token classes (`bg-background`, `bg-card`, `text-muted-foreground`, `border-border`) - never hardcoded Tailwind colors. Alignment color convention: blue = town, red = wolves, amber = neutral (e.g. `text-blue-500 dark:text-blue-400`). `html.dark` is set permanently in `layout.tsx`; the game page toggles it for day/night flavor, so keep `dark:` variants working.

## Infra

- Bot runs as a Docker container on an Oracle VM (`ssh stinkbot`), image `ghcr.io/davidarico/stinkbot:latest`. CI (`.github/workflows/bot.yml`) builds amd64+arm64 on pushes to `main` touching `bot/`, then auto-deploys by triggering `/home/ubuntu/deploy_stinkbot.sh` on the VM (env comes from `/home/ubuntu/stinkbot/.env`).
- Frontend on Vercel; main database on Supabase; message archive database on the Raspberry Pi (see Archives section).
- `FAIL-OVER.md` is a **plan** (Raspberry Pi as primary, Oracle VM as standby with a Supabase sync replica). None of it is implemented yet - `scripts/sync-to-supabase.js` and `heartbeat.sh` don't exist.

## Feedback loop

Players submit feedback via `Wolf.feedback`, which lands in the `feedback` table. `FEEDBACK.md` has two parts: a hand-maintained **Development Roadmap** at the top (the curated to-do list - work from this; when an item ships, remove it there and delete the underlying `feedback` rows), and below a marker line, a raw snapshot of the `feedback` table regenerated by `scripts/regenerate-feedback-md.py` (needs `psql` and `DATABASE_URL`, same env-file lookup order as the bot). The script preserves everything above the marker, so the roadmap survives regeneration.

## Conventions

- Commit messages are short imperative phrases ("Fix Journal Issues", "Add Password to Param").
- Bot code is plain CommonJS JavaScript; frontend and engine-generator are TypeScript. Match what's there.
- The bot logs use emoji prefixes; that's the existing style in bot logging, leave it be.
