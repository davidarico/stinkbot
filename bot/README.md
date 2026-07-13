# StinkBot Discord Bot

A Discord bot for running Werewolf (mafia) games across multiple servers. It manages signups, role assignment, day/night phases, voting, player journals, and message archiving.

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL (migrations live in the `database/` workspace)
- A Discord bot token

### Install and run

From the repo root:

```bash
npm install               # installs all workspaces
npm run db:migrate        # apply migrations (configure database/.env first)
cp bot/.env.example bot/.env   # then fill in your values
npm run bot:start         # or bot:dev for auto-restart
```

In development, database config is loaded from the first existing file among `database/.env`, `.env`, and `bot/.env`, so the bot and the migration runner always see the same `DATABASE_URL`.

### Environment variables

See `.env.example` for the full annotated list. Summary:

| Variable | Required | Purpose |
|----------|----------|---------|
| `DISCORD_TOKEN` | yes | Bot token |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `BOT_PREFIX` | no | Command prefix, defaults to `Wolf.` |
| `WEBSITE_URL` | no | Frontend base URL included in new-game mod messages |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | no | Force strict/relaxed TLS for Postgres; unset uses a dev-friendly heuristic |
| `OPENAI_API_KEY` | no | Joke replies to unknown commands |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | no | S3 image upload during archiving |
| `AWS_S3_BUCKET_NAME` | no | Bucket for JSON archive backups |
| `MEMBER_SYNC_LOG_CHANNEL_ID` | no | Channel that receives member-sync logs |
| `ENABLE_ALIVE_MENTION_DETECTION` | no | Enables @Alive mention rate limiting |

The old `PG_*` variables are deprecated; use `DATABASE_URL`.

### Discord application setup

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications) and add a bot.
2. Copy the bot token into `.env`.
3. Enable the MESSAGE CONTENT and SERVER MEMBERS intents.
4. Under Installation > Guild Install, add the `bot` scope with these permissions: Add Reactions, Embed Links, Manage Channels, Manage Messages, Manage Roles, Pin Messages, Read Message History, Send Messages, View Channels.
5. Open the install link, add the bot to your server.
6. With the bot running, use `Wolf.server_roles` to create the game roles, then grant the bot user the Mod role.

## Commands

Commands use the `Wolf.` prefix by default. Moderator commands require the Manage Channels or Administrator permission (or the Mod role granted through `Wolf.mod`).

### Player commands

| Command | Description |
|---------|-------------|
| `Wolf.in` / `Wolf.out` | Join or leave signups for the current game |
| `Wolf.vote @user` | Vote for a player (voting booth, day phase only) |
| `Wolf.retract` | Retract your current vote |
| `Wolf.votecount` | Vote totals without voter names (Day 2+) |
| `Wolf.alive` | List living players |
| `Wolf.players` | List all players, dead or alive |
| `Wolf.my_journal` | Find your personal journal channel |
| `Wolf.rename_journal <new-name>` | Rename your journal |
| `Wolf.iaself` | Your own message count in town square |
| `Wolf.speed_check` | Message counts since the last phase change |
| `Wolf.feedback <text>` | Submit feedback (stored in the database) |
| `Wolf.help` | Show the command list |

### Super user commands

`Wolf.mod @user` grants the Mod role; restricted to users in the `super_users` table or holders of the Town Council role. `Wolf.unmod` lets super users remove Mod from anyone and lets moderators remove it from themselves (`Wolf.unmod me`).

### Moderator commands

Setup and game management:

| Command | Description |
|---------|-------------|
| `Wolf.setup` | Initial server setup (prefix, starting number, game name) |
| `Wolf.server_roles` | Create the game roles |
| `Wolf.create` | Create a new game with a signup channel |
| `Wolf.start [dark]` | Start the game and create channels; `dark` hides town square, memos, and voting booth from the Alive role |
| `Wolf.signups [open\|close]` | Open or close signups |
| `Wolf.next` | Advance to the next phase (day/night) |
| `Wolf.end` | End the current game (requires confirmation) |
| `Wolf.scuff` | Rewind an active game back to signup (requires confirmation) |
| `Wolf.settings` | View or change game settings (votes to hang, phase messages) |

Channels and voting:

| Command | Description |
|---------|-------------|
| `Wolf.add_channel <name>` | Create an extra channel in the game category |
| `Wolf.channel_config` | View additional channel settings |
| `Wolf.set_voting_booth <channel-name>` | Point the current game at a different voting booth channel |
| `Wolf.create_vote` | Manually create a voting message |
| `Wolf.get_votes` | Current vote counts including who voted for whom |
| `Wolf.not_voted` | Living players who have not voted today |
| `Wolf.lssv [day]` | Longest standing second vote: final votes in cast order, plus when each leader's second vote landed (defaults to today; past days need vote history) |
| `Wolf.lockdown` / `Wolf.lockdown lift` | Prevent/restore Alive players speaking in town square and memos |

Players and roles:

| Command | Description |
|---------|-------------|
| `Wolf.add_in @user` | Add a player to signups on their behalf |
| `Wolf.kill @player` | Swap a player's Alive role for Dead |
| `Wolf.dead` | List dead players |
| `Wolf.inlist` | Mobile-friendly signup list |
| `Wolf.roles_list` | Show assigned roles for the current game |
| `Wolf.role_config` | Show the game's role configuration |
| `Wolf.ratio` | Town / Wolf / Neutral seat counts from the saved role list |
| `Wolf.wolves_alive` | Count living wolves (mods see names) |

Journals:

| Command | Description |
|---------|-------------|
| `Wolf.journal @user` | Create a personal journal for a player |
| `Wolf.journal_link` | Link existing journal channels to players by name matching |
| `Wolf.journal_owner` / `Wolf.journal_unlink` / `Wolf.journal_assign @user` | Inspect or change a journal's owner (run inside the journal) |
| `Wolf.journal_grant_pin` | Grant pin permissions across all journals |
| `Wolf.balance_journals` | Rebalance journal categories (Discord's 50-channel limit) |
| `Wolf.fix_journals` | Repair journal permissions |

Analysis, maintenance, and recovery:

| Command | Description |
|---------|-------------|
| `Wolf.ia [channel] <YYYY-MM-DD HH:MM>` | Per-player message counts since a date (EST); both arguments optional |
| `Wolf.server` | Server information for debugging |
| `Wolf.archive <category-name>` | Archive a game category (see below) |
| `Wolf.archive_local <category-name>` | Archive to a local JSON file (dev only) |
| `Wolf.sync_members` | Manually run the member sync |
| `Wolf.recovery` | Migrate a manually run game to bot control |
| `Wolf.delete_category <name>` | Delete a category and all channels in it (requires confirmation) |
| `Wolf.populate_journals [n]` | Create test journals (testing) |
| `Wolf.refresh` | Reset the server: deletes channels and categories, resets roles and the game counter. Testing only; cannot be undone |

## Game flow

1. `Wolf.setup`, then `Wolf.server_roles` (one-time per server).
2. `Wolf.create` makes a signup channel plus mod-chat and breakdown channels; players join with `Wolf.in`.
3. `Wolf.start` creates the game channels and turns the signup channel into dead-chat.
4. During the game, players vote in the voting booth; the moderator advances phases with `Wolf.next`.
5. `Wolf.end` finishes the game; `Wolf.archive` preserves it.

### Roles

`Wolf.server_roles` creates five roles:

| Role | Purpose |
|------|---------|
| Mod | Game moderators; sees mod-chat, manages channels |
| Spectator | Default for non-players; sees and chats in dead-chat only |
| Signed Up | Temporary role during signups |
| Alive | Living players; sees game channels but not dead-chat |
| Dead | Eliminated players; sees everything, chats only in dead-chat |

### Channels

With server prefix `g` and game number 5, `Wolf.create` produces `g5-signups`, `g5-mod-chat`, and `g5-breakdown`. `Wolf.start` renames signups to `g5-dead-chat` and creates `g5-results`, `g5-player-memos`, `g5-townsquare`, `g5-voting-booth`, and `g5-wolf-chat`. Additional channels (including couple chats) can be added with `Wolf.add_channel` and configured via `Wolf.channel_config`.

### Voting

Votes are only accepted in the voting booth during day phases, self-votes are rejected, and counts update in real time with display names. Votes clear at each new day.

## Journals

Every player can get a private journal channel (created at signup or via `Wolf.journal`). Players and mods can write, spectators can read. Because Discord caps categories at 50 channels, the bot automatically splits journals into alphabetized categories ("Journals (A-L)", "Journals (M-Z)") as they grow, and `Wolf.balance_journals` can rebalance manually. Details in [docs/journal-balancing.md](docs/journal-balancing.md).

## Archiving

`Wolf.archive <category-name>` walks every text channel in the category (excluding mod-chat), and:

- inserts all messages into the Postgres `archive_messages` table, which powers the frontend's archive search
- downloads Discord image attachments and re-uploads them to the `stinkwolf-images` S3 bucket (filename is the message ID, so re-archiving does not duplicate), rewriting attachment URLs
- optionally writes a JSON backup to `AWS_S3_BUCKET_NAME` as `archives/<category-name>_<category-id>.json`

Archiving is rate-limited to respect the Discord API and continues past individual channel failures.

Note: archive search used to be backed by OpenSearch. The scripts under `scripts/` are left over from that setup; new work should target the Postgres tables.

## Member sync

In production the bot syncs every server member into the `server_users` table (user ID, server ID, display name) daily at 4 AM UTC and once shortly after startup, skipping bots and updating changed display names. Moderators can run it on demand with `Wolf.sync_members`. Set `MEMBER_SYNC_LOG_CHANNEL_ID` to log results to a channel.

## Development

### Layout

```
src/
  index.js                 Entry point: Discord client, intents, cron jobs
  werewolf-bot.js          Command router and optional service clients
  database.js              pg pool and env loading
  handlers/                All command logic, mixed into WerewolfBot
  utils/                   Shared helpers
  tests/                   Jest unit tests and mock helpers
scripts/                   One-off and legacy maintenance scripts
test/                      Legacy live-connectivity checks
```

To add a command: add a `case` in `werewolf-bot.js` and implement the handler in the matching `handlers/` module. If players should be able to use it, add it to the `playerCommands` list.

### Testing

```bash
npm run test:unit           # Jest suite (src/tests), uses mocks — run this
npm run test:unit:coverage
npm test                    # legacy live check against real Discord/Postgres
```

### Deployment

CI builds and pushes a multi-arch (amd64/arm64) Docker image to `ghcr.io/davidarico/stinkbot:latest` on pushes to `main` that touch `bot/`. The container needs the env vars above and a volume at `/usr/src/app/data` if you want the alive-mentions SQLite database to persist.

## Troubleshooting

- Bot not responding: check the token, that the bot is online, and that the message content intent is enabled.
- Database errors: verify `DATABASE_URL` and that migrations have been applied (`npm run db:migrate` from the repo root). TLS errors against Supabase in local dev can be worked around with `DATABASE_SSL_REJECT_UNAUTHORIZED=false`.
- Permission errors: the bot needs Manage Channels and Manage Roles; command users need moderator permissions or the Mod role.
