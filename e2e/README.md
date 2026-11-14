# e2e harness

A workbench for verifying bot changes for real: a throwaway local Postgres plus a CLI that runs bot
commands against **Dave's Dev Deck** (`1399411876550676531`) and reports everything the bot did. It
is not a test suite with assertions - it exists so a change can be exercised end to end and then
checked by looking at Discord and the database. Unit tests still live in `bot/src/tests/`.

Not a workspace; it uses the hoisted root `node_modules` (`discord.js`, `pg`, `dotenv`).

## How it works

- **Database:** `e2e/docker-compose.yml` runs `postgres:17-alpine` as `stinkbot-e2e-db` on
  `localhost:54329` (named volume, survives `db down`; `db reset` wipes it). Schema comes from the
  real migrations in `database/migrations/`, plus `archive_messages` (dropped from the main schema
  when archives moved to the Pi) so archive commands have somewhere to write.
- **Env guard:** `lib/env.js` runs before any `bot/src` module is loaded. It points `DATABASE_URL`
  at the container, blanks `ARCHIVE_DATABASE_URL` (archive queries fall back to the local DB),
  blanks OpenAI/S3/OpenSearch credentials, clears every `PG*` variable, and refuses any non-local
  database host. The only thing read from `bot/.env` is `DISCORD_TOKEN` (override with
  `E2E_DISCORD_TOKEN`).
- **Discord:** the harness logs in with the production bot token as a second gateway session. It
  registers no command listener, so it never answers real messages. Every command is checked to
  resolve inside the dev guild.
- **Running a command:** `run` posts a visible trigger message as the bot
  (`🧪 e2e as **Stinky**: Wolf.help`, mentions suppressed), wraps it so `author`/`member`/`content`
  look like David typed the command, and passes it to `WerewolfBot.handleMessage`. Replies thread
  onto the trigger. The production bot ignores the trigger because a bot wrote it.
- **Report:** every message the bot created, edited or deleted in the guild or in DMs, its reactions,
  and everything it logged while the handler ran. Handlers swallow errors and reply with something
  generic, so **the captured `console.error` lines are the real signal**. `run` exits 1 if any were
  logged or the handler threw.

## Commands

Run from the repo root:

```bash
npm run e2e -- db reset                      # wipe, migrate, seed base (do this first)
npm run e2e -- db sql "select * from games"  # inspect / tweak local state
npm run e2e -- db seed <name>                # apply e2e/seeds/<name>.sql

npm run e2e -- run "Wolf.help"                                   # as David (admin), in #general
npm run e2e -- run "Wolf.help" --player                          # same, without mod perms / Mod role
npm run e2e -- run "Wolf.create"
npm run e2e -- run "Wolf.in" --channel e1-signups --player
npm run e2e -- run "Wolf.end" --channel e1-signups --answer confirm   # answers the awaitMessages prompt
npm run e2e -- run "Wolf.help" --json                            # full report incl. all log lines

npm run e2e -- messages e1-townsquare --limit 5 [--json]   # what's actually in a channel
npm run e2e -- channels | roles | member [user] | perms <channel>
npm run e2e -- cleanup [--dry-run] [--roles]                # delete "E2E Game N" categories
```

## Typical verification loop

1. `db reset` and `cleanup` so Discord and the DB agree that no e2e game exists.
2. Build the state you need with real commands (`Wolf.create`, `Wolf.in`, `Wolf.start`, `Wolf.next`)
   so the channels exist in Discord *and* the DB. Use `db sql` for anything the commands can't
   reach.
3. Run the changed command, both as mod and with `--player` when the output differs by role.
4. Check the result independently: `messages`, `perms`, `member`, `db sql`.
5. `cleanup` when done. The local DB still has the deleted game afterwards, so `db reset` before the
   next scenario.

## Limits

- **David is the only human member.** `--as` can only pick real members, so a multi-player game
  means one real player plus fake `players` rows inserted with `db sql`. Discord calls against those
  fake user ids (role changes, DMs) will fail and get logged.
- **Whole-guild member fetches come from the cache.** Discord allows one full member list request
  per guild every 30 seconds and the harness spends it at login, so `guild.members.fetch()` with no
  arguments is answered from the cache during a run (otherwise handlers like `Wolf.start` hang for
  120s). Fetching a single member by id still hits the API.
- **`messageCreate` side effects are not driven.** The harness calls `handleMessage` directly, so
  the message activity counters (`recordMessageActivity` in `index.js`) only move if you insert
  `message_activity` rows with `db sql`.
- **Reactions are not driven.** The harness doesn't route `messageReactionAdd` into the bot
  (speed-vote reactions, 📌 pins). If you react by hand in Discord, the production bot handles it,
  using the production DB.
- **Seeds are local SQL only.** Nothing copies production data. `seeds/base.sql` writes the dev
  server's config (prefix `e`, game name `E2E`, so harness games never collide with the
  production-tracked "Test Game 1" / `t1-*` channels) and removes David from `banned_users`, where a
  migration seeds him.
- **Side effects are real.** DMs get sent (feedback notifications included), roles change on David,
  channels are created. Only on the dev server, but `--roles` cleanup also strips the Alive role
  the production-tracked Test Game 1 gave him.
- **Don't run bare `psql` for the local DB.** David's shell aliases `psql` to the production
  Supabase URL. Use `db sql`, or
  `docker exec stinkbot-e2e-db psql -U stinkbot -d stinkbot_e2e`.
