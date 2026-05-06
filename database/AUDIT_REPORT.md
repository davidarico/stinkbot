# Database Audit Report — StinkBot

**Audited:** 2026-05-06  
**Auditor:** Claude (claude-sonnet-4-6)  
**Scope:** `/home/david/git/stinkbot/database/` plus bot/frontend query patterns

---

## P0 — Critical / Data-Loss Risk

### P0-1: `player_journals` table has a duplicate column definition in `current_schema.sql`

**File:** `database/current_schema.sql`, lines 143–144

```sql
server_id VARCHAR(20) NOT NULL,
server_id VARCHAR(20) NOT NULL,   -- duplicate!
```

`current_schema.sql` is generated from the live database by `generate_schema.js`. The generator queries `information_schema.columns` and emits one `CREATE TABLE` line per column row; if PostgreSQL ever returns `server_id` twice (e.g., due to a botched column rename or a schema introspection bug), this file becomes invalid DDL. Running `current_schema.sql` directly against a fresh database (which some developers do as a shortcut) will fail with a duplicate-column error. More importantly, this is a signal that the schema generator's introspection query may be returning duplicate rows for this table—track down why and validate the live schema is consistent.

**Action:** Run `\d player_journals` against the live database; if the column is genuinely duplicated there, drop one. Fix `generate_schema.js` to deduplicate by column name.

---

### P0-2: `night_action.player_id` has no foreign-key constraint to `players.id`

**File:** `database/migrations/20250803T173650_add_night_action_table.sql`, line 12–13; `current_schema.sql`, lines 132–138

```sql
CREATE TABLE night_action (
    ...
    player_id INTEGER NOT NULL,   -- no FK!
    ...
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);
```

`player_id` is described as a player reference but has no `REFERENCES players(id)` constraint. Deleting a player record (e.g., via `Wolf.out` or a game end) will leave orphaned `night_action` rows pointing to a nonexistent player. The frontend queries `night_action` by `player_id` to display and record night actions; those queries will silently operate on ghost data.

**Action:** Add `FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE`.

---

### P0-3: Migration `20260424120000_game_role_slots_and_player_thematic.sql` has **no rollback file**

**File:** `database/migrations/20260424120000_game_role_slots_and_player_thematic.sql`

This is the most recent and most destructive migration in the repository. It:
1. Drops `game_role` and replaces it with `game_role_new` (renamed).
2. Re-seeds all rows using `generate_series` to expand `role_count` into individual slots.
3. Migrates `custom_name` data from `game_role` into `players.thematic_custom_name`.

There is no `.rollback.sql` file for this migration. If it is ever applied and must be undone, the original `game_role` table and its data cannot be recovered without a database-level backup. The migration runner will silently skip rollback with the message "No rollback file found."

**Action:** Write a rollback migration. Note that a true rollback is only possible if the slot-expanded `game_role` can be collapsed back; at minimum document that this migration requires a database snapshot before running.

---

### P0-4: `20250731123456_add_example_new_feature.rollback.sql` contains a SQL syntax error

**File:** `database/migrations/20250731123456_add_example_new_feature.rollback.sql`, line 17

```sql
DELETE TABLE IF EXISTS roles CASCADE;
```

`DELETE TABLE` is not valid SQL; it should be `DROP TABLE`. This rollback file will always fail when executed, meaning rolling back the `roles` table creation is broken. The migration runner will throw an error and leave the schema in an inconsistent state after a failed rollback attempt.

**Action:** Change `DELETE TABLE` to `DROP TABLE`.

---

### ~~P0-5~~ — Vote deletion at day→night transition — INTENTIONAL (resolved)

The DELETE removes all votes for the game at each phase change by design. The votes table is a live working set; vote history lives in the archive. A clarifying comment has been added to `game-phases.js`.

### P0-5 (original): `handleNext` deletes **all votes for the game** at night transition, not just the current day's votes

**File:** `bot/src/handlers/game-phases.js`, line 53

```js
await this.db.query('DELETE FROM votes WHERE game_id = $1', [game.id]);
```

This deletes every vote ever cast in the game, not only the current day's votes. Vote history for earlier days is permanently destroyed at each day→night transition. The `votes` table's `day_number` column exists precisely to allow multi-day history, and queries in `handleGetVotes`, `handleVoteCount`, and `updateVotingMessage` already filter by `day_number`. The deletion should be scoped to `day_number = $2`.

**Action:** Change to `DELETE FROM votes WHERE game_id = $1 AND day_number = $2` (pass `game.day_number`).

---

### P0-6: Hardcoded plaintext password in migration `20250101000000_add_admin_settings.sql`

**File:** `database/migrations/20250101000000_add_admin_settings.sql`, line 11

```sql
INSERT INTO admin_settings (setting_key, setting_value) VALUES ('admin_password', 'imastinker');
```

A plaintext default password is committed to version control. The `admin_settings` table stores the password used to authenticate the frontend management interface; anyone with repo read access has this credential. Additionally, `admin_password` is stored as plaintext in the database — if the database is ever leaked, the password is immediately exposed. The migration timestamp (`20250101T000000`) sorts before `20250731000000_initial_schema_setup.sql` due to alphabetic ordering, which is also a migration ordering hazard (see P1-1).

**Action:** Remove the hardcoded `INSERT` from the migration. Generate the initial password via an environment variable at setup time, or at least hash it before storage. Rotate the credential if this repo has ever been shared.

---

## P1 — High / Correctness

### P1-1: Migration `20250101000000_add_admin_settings.sql` sorts before `20250731000000_initial_schema_setup.sql`

**File:** `database/migrations/20250101000000_add_admin_settings.sql`

The migration runner sorts files lexicographically (filename order). `20250101…` sorts before `20250731…`, so it will be applied before the initial schema migration creates any tables. `admin_settings` does not depend on any other table so this specific migration happens to work, but the out-of-order timestamp creates a maintenance hazard: any future migration that tries to add constraints or data referencing tables created in the "initial schema" migration but with a timestamp earlier than `20250731…` will fail silently or with a confusing error.

**Action:** Rename `20250101000000_add_admin_settings.sql` to a timestamp after `20250731000000` (e.g., `20250731000001_add_admin_settings.sql`) and update the corresponding rollback filename.

---

### P1-2: `roles.framer_interaction` is typed `TEXT DEFAULT FALSE` — boolean default on a text column

**File:** `current_schema.sql`, line 182; `database/migrations/20250731123456_add_example_new_feature.sql`, line 30

```sql
framer_interaction TEXT DEFAULT FALSE,
```

PostgreSQL accepts `FALSE` as a default for a `TEXT` column (it coerces it to the string `'false'`), but this is confusing and unintentional. The column stores prose framer-interaction descriptions (e.g., "If the Bartender's target is framed, the Bartender will receive three lies.") or `NULL`. The default `'false'` string will be returned for any role that hasn't had its `framer_interaction` set, which the application must then differentiate from an actual description string.

**Action:** Change the column default to `NULL`: `ALTER TABLE roles ALTER COLUMN framer_interaction SET DEFAULT NULL;`

---

### P1-3: `server_users` unique constraint direction mismatch between migration and schema

**File:** `database/migrations/20250810T023000_add_unique_constraint_to_server_users.sql`, line 5; `current_schema.sql`, line 211

Migration adds: `UNIQUE (user_id, server_id)`  
Current schema shows: `UNIQUE(server_id, user_id)`

The column order in a composite unique constraint affects which queries can use it as a covering index. More importantly, the archive handler's upsert uses `ON CONFLICT (user_id, server_id)` (user_id first), which will only use the correct index if the constraint column order matches exactly. If the live database has one order and the schema generator shows another, there may be index confusion. Verify against the live database.

**Action:** Check `\d server_users` on live; if the constraint exists with the wrong column order for the `ON CONFLICT` clause in the upsert, drop and recreate with the correct order.

---

### P1-4: `game_role` has no foreign-key constraint on `role_id` in the final migrated table

**File:** `database/migrations/20260424120000_game_role_slots_and_player_thematic.sql`, lines 17–26; `current_schema.sql`, lines 61–71

```sql
CREATE TABLE game_role_new (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL,
    sort_index INTEGER NOT NULL,
    role_id INTEGER NOT NULL,
    ...
);
```

The replacement `game_role_new` (renamed to `game_role`) omits the `REFERENCES roles(id)` foreign key that existed in the intermediate `20250801T180000_fix_game_role_table.sql` version. Roles can be deleted or updated without any constraint preventing dangling `game_role` rows. The `handleRatio` and `sendRoleNotificationsToJournals` functions JOIN on `game_role.role_id = roles.id` — if a role row is deleted, these queries silently drop those slots from results.

**Action:** Add `REFERENCES roles(id)` to `game_role.role_id`, plus `REFERENCES games(id) ON DELETE CASCADE` to `game_role.game_id` (both were present in previous versions but dropped in the final reshape migration).

---

### P1-5: `players.is_dead` and `players.status` are redundant dead-state flags with no enforcement

**File:** `current_schema.sql`, lines 152–170; `bot/src/handlers/players.js`

The `players` table has both `status VARCHAR(20) NOT NULL DEFAULT 'alive'` and `is_dead BOOLEAN DEFAULT FALSE`. The `killPlayer` handler only updates Discord roles (and doesn't update either column). The `handleAlive` and `handleDead` handlers check Discord role membership, not the database `status` or `is_dead` columns. The two columns can therefore drift from each other and from Discord reality. Furthermore `sendPlayerListToDeadChat` uses `p.is_wolf` to determine team but never uses `is_dead` or `status`.

**Action:** Pick one source of truth for alive/dead state. If Discord role is the canonical source, document that and remove or deprecate the `status` and `is_dead` columns. If the database should be canonical, add a trigger or ensure all kill paths update both. At minimum add a CHECK constraint: `CHECK (NOT (status = 'dead' AND is_dead = FALSE))`.

---

### P1-6: `sendRoleNotificationsToJournals` references undefined `PIN_PERMISSION` constant

**File:** `bot/src/handlers/voting.js`, line 542

```js
await wolfChannel.permissionOverwrites.edit(member.id, {
    ViewChannel: true,
    [PIN_PERMISSION]: true   // <-- PIN_PERMISSION is never defined
});
```

`PIN_PERMISSION` is used as a computed property key but is never declared or imported in `voting.js` or `werewolf-bot.js`. In JavaScript this will throw a `ReferenceError` at runtime when any wolf player is processed during `Wolf.start`, causing the wolf chat addition to fail silently for every wolf. The `wolvesFailedToAdd` counter will increment but no error is surfaced to the moderator running the command.

**Action:** Define `PIN_PERMISSION` (likely `'ManageMessages'` or `PermissionFlagsBits.ManageMessages`) or remove that permission line if not needed.

---

### P1-7: `handleEnd`/game teardown deletes `votes`, `game_channels`, and `players` without a transaction

**File:** `bot/src/handlers/game-phases.js`, lines 575–578

```js
await this.db.query('DELETE FROM votes ...');
await this.db.query('DELETE FROM game_channels ...');
await this.db.query('DELETE FROM players ...');
await this.db.query('DELETE FROM games ...');
```

These four statements execute in sequence without a `BEGIN`/`COMMIT` wrapper. A crash or exception between statements will leave the database in a partially torn-down state (e.g., votes deleted but players still present, or game_channels deleted but games row still active). On the next command the bot may find a game in `active` status but with no players or channels.

**Action:** Wrap these four `DELETE` statements in an explicit transaction.

---

### P1-8: `game_meta` unique constraint column order differs between migration and schema

**File:** `database/migrations/20250803T210000_add_game_meta_table.sql`, line 10; `current_schema.sql`, line 58

Migration: `UNIQUE(game_id, user_id, night)`  
Current schema: `UNIQUE(game_id, night, user_id)`

Same correctness concern as P1-3. If the live database has one order but application code constructs an `ON CONFLICT` clause (or future code does), the wrong index will be used. Verify against live.

---

## P2 — Medium / Performance or Stability

### P2-1: `archive` handler inserts each message individually inside a loop — no batch INSERT

**File:** `bot/src/handlers/archive.js`, lines 286–338

The archive handler processes messages in batches of 100 but still executes individual `INSERT` statements for each message within the batch, inside a `for` loop. For a large game archive with thousands of messages, this generates thousands of round-trips to the database. A single parameterized bulk `INSERT … VALUES ($1,$2,…),($n+1,…)` or `COPY` statement would be orders of magnitude faster.

**Action:** Rewrite the batch loop to construct a single multi-row INSERT per batch (or use `pg-copy-streams` for very large archives).

---

### P2-2: Missing indexes on `game_role.role_id` and `game_meta` lookup columns

**File:** `current_schema.sql`

- `game_role.role_id` — queries like `handleRatio`, `getGameRoles`, and `sendRoleNotificationsToJournals` JOIN `game_role` to `roles` on `role_id`, but there is no index on `game_role.role_id`. Only `idx_game_role_game_id` exists.
- `game_meta(game_id, night)` — a dedicated index exists (`idx_game_meta_game_night`) but `idx_game_meta_game_user(game_id, user_id)` does not cover queries that filter on `night` alone.
- `night_action(game_id, night_number)` — the frontend queries `WHERE game_id = $1 AND night_number = $2` with no composite index on these two columns.

**Action:**
```sql
CREATE INDEX idx_game_role_role_id ON game_role(role_id);
CREATE INDEX idx_night_action_game_night ON night_action(game_id, night_number);
```

---

### P2-3: `votes` table grows unbounded — no cleanup of historical game votes

**File:** `current_schema.sql`, lines 215–223; `bot/src/handlers/game-phases.js`

`votes` rows cascade-delete when the parent `games` row is deleted, but games are never soft-deleted — only status is changed to `ended`. Ended games retain all their vote history indefinitely. With many games across many servers this table will grow without bound. There is no scheduled cleanup, no index on `voted_at`, and no archive pathway.

**Action:** Either hard-delete ended games after a retention period, or add a `created_at` index and a periodic cleanup job for votes older than N days on ended games.

---

### P2-4: `archive_messages.category` and `archive_messages.channel_name` are stored as plain strings with no normalization

**File:** `current_schema.sql`, lines 226–258; migration `20260316T000000_add_archive_messages_table.sql`

Both `category` and `channel_name` are denormalized string values copied at archive time. The GIN index `idx_archive_messages_content_search` supports full-text search on `content`, which is appropriate. However, the `idx_archive_messages_category` and `idx_archive_messages_channel_name` indexes are on mutable display-name strings. If a Discord category or channel is renamed after archiving, the archived rows will have stale names with no way to update them in bulk. There is also no `category_name` / `channel_name` normalization or deduplication.

**Action:** Consider storing category/channel snapshot names as-of-archive-time (acceptable for an immutable archive) but document this clearly. If searchability by current name is needed, add a lookup step.

---

### P2-5: `saveGameRoles` in `frontend/lib/database.ts` falls back to `saveGameRolesIndividually` on constraint error silently

**File:** `frontend/lib/database.ts`, lines 507–510

```ts
} catch (error) {
    console.error('Error saving game roles:', error)
    return this.saveGameRolesIndividually(gameId, gameRoles)
}
```

A constraint violation (e.g., duplicate `sort_index`) in the primary transaction causes a silent fallback to `saveGameRolesIndividually`, which inserts roles one by one and uses `console.warn` for per-row failures. The caller receives `{ success: true }` even if some rows were silently skipped. The UI will show success while the game role list may be partially saved.

**Action:** Remove the fallback; surface the error to the caller. Fix the upstream cause (e.g., deduplicate `sortIndex` before saving).

---

### P2-6: `server_users.user_id` and `server_users.server_id` are `VARCHAR(255)` while all other tables use `VARCHAR(20)`

**File:** `database/migrations/20250810T022807_add_server_user_tables.sql`, lines 10–11; `current_schema.sql`, lines 205–212

Discord IDs are 18–19 digit Snowflakes and fit easily in `VARCHAR(20)`. `server_users` uses `VARCHAR(255)` for both columns. This is inconsistent with every other table (`games`, `players`, `votes`, `game_channels`, etc.) and wastes index space. It also means that a JOIN between `server_users.user_id` and `players.user_id` involves an implicit type mismatch in string length (both are `VARCHAR` but with different declared lengths).

**Action:** Migrate `server_users.user_id` and `server_users.server_id` to `VARCHAR(20)` for consistency.

---

### P2-7: No index on `players.user_id` or `players.role_id`

**File:** `current_schema.sql`, lines 152–170

`players.user_id` is used in nearly every bot query to look up a specific player within a game (e.g., ban checks, vote verification, role notification). The existing `UNIQUE(game_id, user_id)` constraint creates an index on the pair, but there is no standalone index on `user_id` for queries that filter across games (e.g., journal ownership checks). `players.role_id` is used in JOINs in `sendRoleNotificationsToJournals` and `sendPlayerListToDeadChat` with no index.

**Action:**
```sql
CREATE INDEX idx_players_role_id ON players(role_id);
CREATE INDEX idx_players_user_id ON players(user_id);
```

---

### P2-8: `handleVote` executes a `DELETE` + `INSERT` (delete-then-insert) instead of an upsert

**File:** `bot/src/handlers/voting.js`, lines 800–809; `frontend/lib/database.ts`, lines 376–392

Both the bot and the frontend use a DELETE-then-INSERT pattern to update votes. This is two round-trips and opens a race window where a concurrent vote from the same user could produce a duplicate-key error (the UNIQUE constraint on `(day_number, game_id, voter_user_id)` would catch it, but as a hard error). An `INSERT … ON CONFLICT … DO UPDATE` is both safer and faster.

**Action:** Replace DELETE+INSERT with `INSERT INTO votes … ON CONFLICT (game_id, voter_user_id, day_number) DO UPDATE SET target_user_id = EXCLUDED.target_user_id, voted_at = EXCLUDED.voted_at`.

---

## P3 — Low / Cleanup

### P3-1: `20250731123456_add_example_new_feature.sql` is a template file checked into migrations

**File:** `database/migrations/20250731123456_add_example_new_feature.sql`

The file header says "Example migration - you can delete this file" and contains commented-out boilerplate. The actual SQL (`CREATE TABLE IF NOT EXISTS roles`) is real and has been applied. The file cannot be deleted without removing the `schema_migrations` record, but it permanently pollutes the migration history. Future developers may be confused about its purpose.

**Action:** Leave it applied but add a clear comment at the top. Do not create future "example" migrations under timestamp names.

---

### P3-2: `games` table missing `UNIQUE(server_id, game_number)` in `current_schema.sql` but present in initial migration

**File:** `database/migrations/20250731000000_initial_schema_setup.sql`, line 42; `current_schema.sql`, lines 88–119

The initial schema defines `UNIQUE(server_id, game_number)` on `games`. This constraint does not appear in `current_schema.sql`. This is either a schema generator gap (the generator only emits column-level `UNIQUE` constraints, not table-level ones from the original `CREATE TABLE`) or the constraint was dropped. Either way, `current_schema.sql` is not a faithful representation of the live database, undermining its purpose as a reference.

**Action:** Fix `generate_schema.js` to also query and emit table-level constraints (not just `UNIQUE` and `CHECK` constraints that are also listed as column constraints). Verify the live constraint exists.

---

### P3-3: `roles` table `name` unique constraint was dropped and replaced with a partial unique index — not reflected in `current_schema.sql`

**File:** `database/migrations/20251211T042457_add_server_id_to_roles.sql`, lines 14–20; `current_schema.sql`, lines 172–193

The migration drops `roles_name_key` and creates `roles_name_unique_general` (a partial unique index on `name WHERE server_id IS NULL`). The `generate_schema.js` generator does not emit partial indexes, so `current_schema.sql` shows neither the dropped constraint nor the replacement. Running `current_schema.sql` fresh would create a table with a full unique constraint on `name` (`UNIQUE` on the column), which would reject server-specific roles with duplicate names — breaking the intended design.

**Action:** Extend `generate_schema.js` to emit partial indexes via `pg_indexes`.

---

### P3-4: `scripts/` directory is completely empty

**File:** `database/scripts/`

The directory exists but contains no files. `package.json` has a `db:reset` script that calls `psql -f database_setup.sql` but `database_setup.sql` does not exist in the repository. Either the scripts were never written, were deleted, or the reference is stale.

**Action:** Either populate `scripts/` with intended tooling (seed scripts, data backups, etc.) or remove the empty directory and clean up the `package.json` reference to `database_setup.sql`.

---

### P3-5: `kanban_tasks` migration adds a `CHECK` constraint on `status` that is absent from `current_schema.sql`

**File:** `database/migrations/20250912T221615_add_kanban_tasks_table.sql`, line 7; `current_schema.sql`, lines 122–130

```sql
-- Migration:
status VARCHAR(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),

-- current_schema.sql (generated):
status VARCHAR(20) NOT NULL DEFAULT 'todo',   -- CHECK constraint missing
```

The generator does not emit `CHECK` constraints. This means `current_schema.sql` would create the table without the validation constraint on a fresh database, allowing any string to be inserted into `status`.

**Action:** Extend `generate_schema.js` to query and emit `CHECK` constraints.

---

### P3-6: `admin_settings` table has no `updated_at` trigger despite having the column

**File:** `current_schema.sql`, lines 6–13; `database/migrations/20250731000000_initial_schema_setup.sql`

`admin_settings` has an `updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP` column but the `update_updated_at_column()` trigger that auto-updates this column is only installed on `server_configs` and `games`. Any `UPDATE` on `admin_settings` will leave `updated_at` stale (it will show the row's creation time forever).

**Action:** Add `DROP TRIGGER IF EXISTS update_admin_settings_updated_at ON admin_settings; CREATE TRIGGER update_admin_settings_updated_at BEFORE UPDATE ON admin_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`

---

### P3-7: `kanban_tasks` has no `updated_at` trigger either

**File:** `database/migrations/20250912T221615_add_kanban_tasks_table.sql`

Same issue as P3-6. `kanban_tasks.updated_at` will not be automatically maintained.

**Action:** Add an `update_kanban_tasks_updated_at` trigger identical to the one for `games`.

---

### P3-8: `game_channels` unique constraint column order changed between initial schema and current schema

**File:** `database/migrations/20250731000000_initial_schema_setup.sql`, line 78 (`UNIQUE(game_id, channel_id)`); `current_schema.sql`, line 46 (`UNIQUE(channel_id, game_id)`)

A cosmetic inconsistency, but worth noting for the same reason as P1-3 and P1-8: if the migration runner rebuilds the table in a different column order to the generated schema, an `ON CONFLICT` clause targeting `(game_id, channel_id)` may or may not hit the right index.

---

### P3-9: `migrate.js` rollback uses a semicolon-split strategy inconsistent with forward-migration approach

**File:** `database/migrate.js`, lines 129–135

The `applyMigration` function executes the entire migration file as a single string (correct for `$$`-delimited PL/pgSQL). The `rollbackMigration` function splits the SQL on `;` and executes statements individually. This inconsistency means rollback files that contain PL/pgSQL function bodies or dollar-quoted strings will break, while forward migrations handle them correctly.

**Action:** Use the same "execute entire file" strategy in `rollbackMigration` as in `applyMigration`.

---

### P3-10: `banned_users` migration seeds real Discord IDs — user PII in version control

**File:** `database/migrations/20250925T200032_add_banned_users_table.sql`, lines 9–12; `database/migrations/20260123T000000_add_super_users_table.sql`, lines 9–11

Real Discord user IDs (18-digit Snowflakes) are seeded directly in migration files. Discord IDs are considered PII under GDPR and similar regulations. Anyone with read access to the repo can see which users are permanently banned or have super-user access.

**Action:** Move the seed data out of migrations into a separate, gitignored seed script or environment-variable-based initialization. At minimum, document the sensitivity and restrict repository access.

---

### P3-11: `migrate.js` does not call `disconnect()` if `connect()` throws in the `finally` block

**File:** `database/migrate.js`, lines 290–297

```js
} finally {
    await runner.disconnect();
}
```

`runner.disconnect()` calls `this.client.end()`. If `connect()` was never called (or threw before assignment), calling `end()` on an unconnected `Client` can throw a second error that masks the original connection error. This is a minor robustness issue but can make debugging connection failures confusing.

**Action:** Guard the disconnect: `if (runner.client._connected) await runner.disconnect();` or restructure with try/catch inside the connect call.

---

### P3-12: `generate_schema.js` does not include foreign key constraints in emitted DDL

**File:** `database/generate_schema.js`, lines 248–258

The generator queries `information_schema.referential_constraints` to discover FK relationships but only uses the result to annotate individual column lines with `REFERENCES table(col)`. It does not emit the `ON DELETE` action for columns that aren't detected as FK columns via the join. Composite FKs or FKs added via separate `ALTER TABLE` statements are silently dropped from the generated file.

**Action:** Extend the generator to query `pg_constraint` for all constraints (FK, CHECK, partial unique) and emit them faithfully.

---

## Summary

| Priority | Count | Description |
|----------|-------|-------------|
| P0 | 6 | Critical / data-loss risk |
| P1 | 8 | High / correctness bugs |
| P2 | 8 | Medium / performance or stability |
| P3 | 12 | Low / cleanup and technical debt |
| **Total** | **34** | |

### Most Urgent Actions (in order)

1. **P0-5**: Fix `handleNext` vote deletion scope — active data corruption on every day→night transition.
2. **P0-6**: Rotate and stop committing plaintext credentials.
3. **P1-6**: Fix undefined `PIN_PERMISSION` — wolves are silently not being added to wolf chat.
4. **P0-3**: Write rollback for the latest migration.
5. **P0-2**: Add FK on `night_action.player_id`.
6. **P0-4**: Fix the `DELETE TABLE` typo in the rollback file.
7. **P1-7**: Wrap game-end teardown in a transaction.
8. **P1-4**: Restore FK constraints on `game_role`.
