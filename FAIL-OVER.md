# Stinkbot Failover Architecture

## Current Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Vercel (Frontend)                                        │
│  Next.js 16 App Router                                    │
│  Connects directly to Supabase via DATABASE_URL           │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│  Supabase (Database - PostgreSQL)                         │
│  Primary database for all components                      │
│  Tables: games, players, roles, votes, server_users,      │
│          feedback, banned_users, admin_settings, etc.     │
└──────────────────────────────▲───────────────────────────┘
                               │
┌──────────────────────────────┴───────────────────────────┐
│  Oracle VM  (ssh stinkbot)                                │
│  Runs Discord bot via Docker                              │
│  Bot reads/writes directly to Supabase                    │
│  CI/CD: ghcr.io/davidarico/stinkbot:latest               │
│  Cron: member sync 0 4 * * * (daily, UTC)                │
└──────────────────────────────────────────────────────────┘

External integrations (optional, unchanged by this plan):
  - OpenSearch  - message archive index
  - AWS S3      - stinkwolf-images bucket
  - OpenAI      - AI features
  - SQLite      - local alive-mention tracking (bot/data/alive_mentions.db)
```

## Target Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Vercel (Frontend - unchanged)                            │
│  Connects to Supabase (still internet-accessible)         │
│  Only critical page: role assignment (game-running only)  │
└──────────────────────────────┬───────────────────────────┘
                               │  read
                               ▼
┌──────────────────────────────────────────────────────────┐
│  Supabase (Database - near-real-time sync replica)        │
│  Game-critical tables synced every ~1 min from Pi        │
│  Non-critical tables (server_users, feedback, etc.) sync  │
│  nightly. No archive tables. Read target for Vercel.      │
└──────────────────────────────▲───────────────────────────┘
                               │  frequent sync (Pi → Supabase)
                               │  game tables: ~1 min interval
                               │  other tables: nightly
┌──────────────────────────────┴───────────────────────────┐
│  Raspberry Pi  (ssh dp)  ← PRIMARY                        │
│  Local PostgreSQL (full schema, primary source of truth)  │
│  Discord bot (Docker via systemd, uses local PG)          │
│  Sync script: frequent for game tables, nightly for rest  │
│  SQLite for alive-mention tracking                        │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Oracle VM  (ssh stinkbot)  ← PASSIVE FAILOVER            │
│  Heartbeat service: polls Pi every ~90s via SSH           │
│  If Pi unreachable → starts bot (pointing at Supabase)   │
│  Supabase lag: ≤1 min for game state (near-seamless)     │
│  When Pi recovers → stops bot, defers back to Pi         │
└──────────────────────────────────────────────────────────┘
```

### Key Design Decisions

- **Pi is primary:** Local PostgreSQL is the source of truth. Bot writes go there first.
- **Supabase is a near-real-time sync replica:** Game-critical tables (games, players, votes, game_meta, game_speed, game_role, game_channels, roles) sync every ~1 minute so failover picks up almost exactly where the Pi left off. Non-critical tables sync nightly. Archive tables are excluded entirely.
- **Oracle VM is passive:** It does not run the bot unless the Pi is unreachable. When it does, it points at Supabase - which is at most ~1 minute behind, making game continuity seamless.
- **Frontend is game-running only:** The only Vercel page that matters during an active game is role assignment. Admin, kanban, and other features can tolerate nightly-synced data.
- **Bot runs via Docker on Pi:** Consistent with Oracle VM. CI already produces `linux/arm64` images. Managed by systemd.
- **SSH key needed:** Oracle VM does not currently have a key trusted by the Pi. This must be set up before the heartbeat service can work.
- **Single Supabase credential:** The sync script reuses the same `DATABASE_URL` the bot currently uses. No separate service role key needed.
- **No dual-write complexity:** One clear primary (Pi). The failover mode is read-from-Supabase only - no writes race back.
- **SQLite stays local:** The `alive_mentions.db` file is local to whichever bot instance is active. This is ephemeral rate-limiting state, not critical data.

### Tables Excluded from Sync

These tables are either too large, externally managed, or not needed by the frontend:

| Table / System | Reason excluded |
|----------------|-----------------|
| OpenSearch indices | External service, not in PG |
| S3 objects | External service |
| Any future `message_archives` PG table | Expensive, read via OpenSearch |

All other PostgreSQL tables (games, players, roles, game_role, game_channels, game_meta, game_speed, votes, server_users, feedback, banned_users, admin_settings, schema_migrations) **are** included in the sync.

---

## Tasks

### Phase 1 - Raspberry Pi: Local PostgreSQL Setup

- [ ] **1.1** SSH into Pi (`ssh dp`) and install PostgreSQL (e.g. `apt install postgresql`).
- [ ] **1.2** Create a database and user for the bot (e.g. `stinkbot` / `stinkbot`). Note the local `DATABASE_URL`.
- [ ] **1.3** Clone or pull the repo on the Pi (or rsync it). Confirm `database/` and `bot/` are present.
- [ ] **1.4** Create `database/.env` on the Pi pointing at the local PG instance and run `npm run migrate --workspace=database` to apply all migrations.
- [ ] **1.5** Verify schema is correct by running `npm run migrate:status --workspace=database`.

### Phase 2 - Raspberry Pi: Bot Service (Docker via systemd)

- [ ] **2.1** Install Docker on the Pi if not already present.
- [ ] **2.2** Authenticate to GitHub Container Registry on the Pi: `docker login ghcr.io` (use a GitHub PAT with `read:packages` scope).
- [ ] **2.3** Pull the image: `docker pull ghcr.io/davidarico/stinkbot:latest` (arm64 image is already built by CI).
- [ ] **2.4** Create `bot/.env` on the Pi with all required variables. Set `DATABASE_URL` to the local PostgreSQL instance (not Supabase). Add `SUPABASE_DATABASE_URL` set to the existing Supabase connection string (used by the sync script).
- [ ] **2.5** Write a systemd unit file `/etc/systemd/system/stinkbot.service` on the Pi:
  ```ini
  [Unit]
  Description=Stinkbot Discord Bot
  After=network.target postgresql.service docker.service
  Requires=docker.service

  [Service]
  Type=simple
  User=<pi-user>
  ExecStartPre=-/usr/bin/docker rm -f stinkbot
  ExecStart=/usr/bin/docker run --rm --name stinkbot \
    --env-file /path/to/stinkbot/bot/.env \
    -v /path/to/stinkbot/bot/data:/usr/src/app/data \
    ghcr.io/davidarico/stinkbot:latest
  ExecStop=/usr/bin/docker stop stinkbot
  Restart=on-failure
  RestartSec=10

  [Install]
  WantedBy=multi-user.target
  ```
- [ ] **2.6** Enable and start the service: `sudo systemctl enable --now stinkbot`.
- [ ] **2.7** Confirm bot connects to Discord and local PG (`systemctl status stinkbot`, `docker logs stinkbot`).
- [ ] **2.8** Stop the bot on the Oracle VM once Pi bot is confirmed healthy.

### Phase 3 - Sync Script (Pi → Supabase)

The sync is split into two tiers based on criticality:

**Tier 1 - Game-critical tables** (sync every ~1 minute):
`games`, `players`, `roles`, `game_role`, `game_channels`, `game_meta`, `game_speed`, `votes`

**Tier 2 - Non-critical tables** (sync nightly):
`server_users`, `feedback`, `banned_users`, `admin_settings`, `schema_migrations`

**Excluded entirely:** OpenSearch indices, S3 objects, any future `message_archives` PG table.

- [ ] **3.1** Create `scripts/sync-to-supabase.js` in the repo. It should accept a `--tier` argument (`game` or `all`):
  - Connect to local PG (source) and Supabase (destination) via their respective `DATABASE_URL` / `SUPABASE_DATABASE_URL` env vars.
  - For each table in the requested tier, upsert all rows from local PG into Supabase using `INSERT ... ON CONFLICT DO UPDATE SET ...` across all columns. For Tier 1, sync the entire table (game data is small); for Tier 2, filter to rows modified in the last 25 hours.
  - Log rows upserted per table, duration, and any errors to stdout.
- [ ] **3.2** Test the sync script manually for both tiers: `node scripts/sync-to-supabase.js --tier game` and `node scripts/sync-to-supabase.js --tier all`.
- [ ] **3.3** Add two cron entries on the Pi:
  ```
  # Game-critical sync - every minute
  * * * * * cd /path/to/stinkbot && node scripts/sync-to-supabase.js --tier game >> /var/log/stinkbot-sync-game.log 2>&1

  # Full sync - nightly at 3:30 AM UTC (before member-sync at 4 AM)
  30 3 * * * cd /path/to/stinkbot && node scripts/sync-to-supabase.js --tier all >> /var/log/stinkbot-sync-full.log 2>&1
  ```
- [ ] **3.4** Add log rotation for both sync log files (e.g. `logrotate` config or truncate weekly) so they don't grow unbounded.
- [ ] **3.5** Confirm game-critical Supabase data is updating within ~1 minute of a local write. Verify the frontend role assignment page still works.

### Phase 4 - SSH Key Setup (prerequisite for heartbeat)

- [ ] **4.1** On the Oracle VM, generate a dedicated key pair for the heartbeat service if one doesn't exist: `ssh-keygen -t ed25519 -f ~/.ssh/stinkbot_heartbeat -N ""`.
- [ ] **4.2** Copy the public key to the Pi's `authorized_keys`: `ssh-copy-id -i ~/.ssh/stinkbot_heartbeat.pub dp` (run this once manually while logged into the Oracle VM).
- [ ] **4.3** Verify the keyless check works: `ssh -i ~/.ssh/stinkbot_heartbeat -o ConnectTimeout=10 -o BatchMode=yes dp exit` - should return exit code 0 with no password prompt.

### Phase 5 - Oracle VM: Heartbeat & Passive Failover

- [ ] **5.1** Create `scripts/heartbeat.sh` on the Oracle VM. Logic:
  - Ping the Pi via SSH (non-interactive, short timeout): `ssh -i ~/.ssh/stinkbot_heartbeat -o ConnectTimeout=10 -o BatchMode=yes dp exit`.
  - Track consecutive failures in a state file (e.g. `/var/run/stinkbot-heartbeat/state`).
  - After N=3 consecutive failures (~5 min at 90s interval): start the failover bot via `systemctl start stinkbot-failover`.
  - When Pi is reachable again and failover bot is running: `systemctl stop stinkbot-failover` and reset the failure counter.
  - Log all state transitions with timestamps to `/var/log/stinkbot-heartbeat.log`.
- [ ] **5.2** Create `bot/.env.failover` on the Oracle VM. Same as the existing bot `.env` (which already points at Supabase - this is unchanged from the current Oracle VM setup) plus `FAILOVER_MODE=true`.
- [ ] **5.3** Write a systemd unit `/etc/systemd/system/stinkbot-failover.service` on the Oracle VM (Docker-based, same as current Oracle VM bot setup, but using `.env.failover`). Do **not** enable it on boot - the heartbeat manages it.
- [ ] **5.4** Write a systemd timer pair on the Oracle VM to run the heartbeat every 90 seconds:
  ```ini
  # /etc/systemd/system/stinkbot-heartbeat.service
  [Unit]
  Description=Stinkbot Pi Heartbeat Check

  [Service]
  Type=oneshot
  ExecStart=/path/to/stinkbot/scripts/heartbeat.sh

  # /etc/systemd/system/stinkbot-heartbeat.timer
  [Unit]
  Description=Run Stinkbot heartbeat every 90s

  [Timer]
  OnActiveSec=0
  OnUnitActiveSec=90s

  [Install]
  WantedBy=timers.target
  ```
- [ ] **5.5** Enable and start the timer: `sudo systemctl enable --now stinkbot-heartbeat.timer`.
- [ ] **5.6** Test the failover path end-to-end:
  - Stop the Pi bot (`sudo systemctl stop stinkbot` on Pi) or block the SSH port temporarily.
  - Confirm heartbeat detects the outage after 3 checks (~5 min) and starts the Oracle VM bot.
  - With game-critical sync running every minute, Supabase should be at most ~1 min stale - game state should be nearly seamless.
  - Restart the Pi bot; confirm heartbeat stops Oracle VM bot within one check cycle.

### Phase 6 - Hardening & Observability

- [ ] **6.1** Add a Discord webhook notification in `heartbeat.sh` when failover state changes: post "⚠️ Pi bot unreachable - Oracle VM taking over" on failover start, and "✅ Pi bot recovered - Oracle VM stepping down" on recovery.
- [ ] **6.2** Update the GitHub Actions workflow (`.github/workflows/bot.yml`) so the Pi pulls the new image on deploy. Options: (a) add a deploy step that SSHes into the Pi and runs `docker pull && systemctl restart stinkbot`, or (b) document a manual pull process. The Oracle VM should also be updated at the same time.
- [ ] **6.3** Review PostgreSQL `max_connections` on the Pi - default is 100, which is fine for the bot pool (max 20) plus the sync script connections. Confirm after setup.
- [ ] **6.4** Set up basic PostgreSQL backups on the Pi (`pg_dump` cron to a local file or S3) so a Pi hardware failure doesn't lose the window between syncs. Even a daily `pg_dump` to S3 is a sufficient safety net given the ~1 min Supabase sync.

---

## Key File Locations (after implementation)

| File | Host | Purpose |
|------|------|---------|
| `bot/.env` | Pi | Bot env; `DATABASE_URL` → local PG, `SUPABASE_DATABASE_URL` → Supabase |
| `bot/.env.failover` | Oracle VM | Bot env; `DATABASE_URL` → Supabase (unchanged from current Oracle VM config) |
| `scripts/sync-to-supabase.js` | repo (runs on Pi) | Pi → Supabase tiered sync |
| `scripts/heartbeat.sh` | Oracle VM | Pi health check + failover start/stop |
| `~/.ssh/stinkbot_heartbeat` | Oracle VM | Dedicated SSH key for heartbeat checks |
| `/etc/systemd/system/stinkbot.service` | Pi | Primary bot service (Docker) |
| `/etc/systemd/system/stinkbot-failover.service` | Oracle VM | Passive bot service (managed by heartbeat) |
| `/etc/systemd/system/stinkbot-heartbeat.timer` | Oracle VM | Heartbeat timer (every 90s) |
| `/etc/systemd/system/stinkbot-heartbeat.service` | Oracle VM | Heartbeat oneshot unit |
| `/var/log/stinkbot-sync-game.log` | Pi | Game-critical sync output |
| `/var/log/stinkbot-sync-full.log` | Pi | Nightly full sync output |
| `/var/log/stinkbot-heartbeat.log` | Oracle VM | Heartbeat state transitions |
