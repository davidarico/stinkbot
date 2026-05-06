# Bot Audit Report

**Date:** 2026-05-06  
**Scope:** `/home/david/git/stinkbot/bot/src` and related files  
**Auditor:** Automated code review

---

## P0 — Critical / Crash

### P0-1 — Hardcoded undefined variable `PIN_PERMISSION` in `utils.js` / `permsTest`

**File:** `src/handlers/utils.js`, line 221  
**File:** `src/handlers/voting.js`, line 541 (in `sendRoleNotificationsToJournals`)

`PIN_PERMISSION` is defined only in `src/handlers/journal.js` as a module-level `const`. When `permsTest` (in `utils.js`) and `sendRoleNotificationsToJournals` (in `voting.js`) reference it, the variable is `undefined` in their module scope — it is never exported or imported. Any call to `Wolf.perms_test` or a game start where wolves exist will throw a `ReferenceError: PIN_PERMISSION is not defined`, crashing those code paths silently (the outer `try/catch` in `handleMessage` turns it into an `❌ An error occurred` reply, hiding the true cause).

**Fix:** Export the constant from `journal.js` and import it where needed, or duplicate it into a shared constants file.

---

### P0-2 — `handleCreate` crashes when `modRole` is not found

**File:** `src/handlers/game.js`, lines 212–230  
**Function:** `handleCreate`

`modRole` is looked up with `message.guild.roles.cache.find(r => r.name === 'Mod')`. If the role does not exist, `modRole` is `undefined`. It is then unconditionally used in `permissionOverwrites` (`id: modRole.id`), throwing `TypeError: Cannot read properties of undefined (reading 'id')`. The same crash can happen in `handleStart` with `aliveRole`, `deadRole`, `spectatorRole`, and `modRole` — all fetched from cache without null guards before being used in `permissionOverwrites`.

**Fix:** Guard with early-return replies (e.g., `if (!modRole) return message.reply('❌ Mod role not found. Run Wolf.server_roles first.')`).

---

### ~~P0-3~~ — `handleNext` vote deletion — INTENTIONAL (resolved)

The DELETE removes all votes for the game at each day→night transition by design. The votes table is a live working set; historical per-day data is captured in the archive. A comment has been added to the code to document this intent.

### P0-3 (original) — `handleNext` deletes **all** votes for the game, not just the current day's

**File:** `src/handlers/game-phases.js`, line 53  
```js
await this.db.query('DELETE FROM votes WHERE game_id = $1', [game.id]);
```
This purges every vote record ever cast in the game rather than only the current day's. If historical vote data is needed for auditing, LSSV tracking (Feedback #75), or any future analysis, it is permanently destroyed every time the mod calls `Wolf.next`.

**Fix:** Change to `WHERE game_id = $1 AND day_number = $2` with `game.day_number`.

---

### P0-4 — `handleStart` may assign roles twice (double-role update loop)

**File:** `src/handlers/game.js`, lines 1052–1079  
**Function:** `handleStart`

The code attempts a bulk `guild.members.fetch()`. If it **fails**, the `catch` block runs individual member fetches and assigns roles. However, after the `catch` block, code execution **continues** into the loop below it (lines 1069–1079), which runs the role assignment loop again for all cached members. If the bulk fetch throws but partially updates the cache, some players may have `removeRole`/`assignRole` called twice, causing redundant Discord API calls and potential rate limit hits. If the bulk fetch **succeeds**, roles are assigned only once (the lower loop), which is correct — but the fallback loop is then entirely dead code (since `guild.members.fetch()` resolves before reaching the catch).

**Fix:** Use a proper `try/finally` or a flag variable to prevent the second loop from running after the fallback already ran.

---

### P0-5 — `handleServer` double-counts `aliveCount` when bulk fetch succeeds

**File:** `src/handlers/utils.js`, lines 750–774  
**Function:** `handleServer`

The same structural bug as P0-4: when `guild.members.fetch()` succeeds, the catch block is skipped, but the post-catch loop (lines 769–774) still runs over the now-populated cache. This means the cached-member loop counts `aliveCount` even though it was never reset. When the bulk fetch fails, the fallback loop runs and `aliveCount` is correct. When it succeeds, the post-catch loop double-counts because the fallback loop ran too (it doesn't in the success case, but the post-catch loop still runs unconditionally). The result is inflated `aliveCount` displayed in `Wolf.server`.

**Fix:** Same structural fix as P0-4 — use a flag or restructure so only one branch runs.

---

### P0-6 — SQL injection risk in `handleSettings` (channel-specific column name)

**File:** `src/handlers/channels.js`, line 442  
```js
const columnName = settingType;
await this.db.query(`UPDATE game_channels SET ${columnName} = $1 WHERE id = $2`, ...);
```
`settingType` is derived from user input (`args[1].toLowerCase()`). Although it is validated to be either `'day_message'` or `'night_message'` in the `if` above, the `columnName` variable is still interpolated directly into a SQL string. If the validation logic is ever changed or bypassed, this becomes a direct SQL injection vector. This is the only place in the codebase that builds queries this way.

**Fix:** Replace with separate `if/else` branches that hardcode the column name string, or use a whitelist mapping.

---

## P1 — High / Bug

### P1-1 — `ensureUserHasJournal` is called without `await` during signup

**File:** `src/handlers/game.js`, line 477  
```js
this.ensureUserHasJournal(message, user);
```
This is an `async` function returning a Promise. Calling it without `await` means journal creation errors are silently swallowed, race conditions may occur (the player is signed up before the journal is even created), and any unhandled rejection will bubble up to the global handler. The same call without `await` exists in `handleAddIn` at line 343 in `voting.js` — though that one actually **does** have `await`. Inconsistency suggests the signup one was simply missed.

**Fix:** Add `await` — `await this.ensureUserHasJournal(message, user)`.

---

### P1-2 — `setupSpeedReactionListener` creates an interval that is never cleared on bot restart / new game

**File:** `src/handlers/speed-vote.js`, lines 464–524  
**Function:** `setupSpeedReactionListener`

Every call to `Wolf.speed` registers a `setInterval` that polls the DB every 2 seconds for the lifetime of the speed vote. The interval is cleared only when the DB row is deleted. However, if the bot **restarts** while a speed vote is active, the interval reference is lost — it cannot be cleared. More critically, if the same game somehow gets a second speed vote created (e.g., after an abort race condition), multiple polling intervals accumulate. Over time this produces unbounded concurrent intervals with identical DB queries.

**Fix:** Store the interval ID in a `Map` keyed by `game.id` on `this` so it can be cleared on abort and on bot startup recovery.

---

### P1-3 — `Wolf.speed` reaction handler removes the bot's own reaction unconditionally on every valid voter

**File:** `src/handlers/speed-vote.js`, line 708  
```js
await reaction.users.remove(this.client.user.id);
```
This is called every time any alive user reacts. After the first alive user reacts, the bot's initial reaction is removed. The second alive user triggers another `reaction.users.remove(this.client.user.id)` even though the bot's reaction is already gone, causing a Discord API error (Unknown Reaction, code 10014). The error is swallowed by the outer `try/catch`, but each extra call wastes an API call and logs a spurious error.

**Fix:** Track whether the bot reaction has been removed and skip the call if so.

---

### P1-4 — `handleSetup` falls through and shows setup instructions even when server is already configured

**File:** `src/handlers/game.js`, lines 62–131  
**Function:** `handleSetup`

When `existingConfig.rows.length > 0`, the embed showing existing configuration is sent and then code does **not** `return` — it falls through to the `Wolf.setup` instructions embed and then starts `awaitMessages`. A pre-configured server will show both the "already configured" embed AND the setup prompts, then wait for user input and potentially **overwrite** the existing config unintentionally. There is a comment `await message.reply('To reconfigure, please use the setup command with new parameters.')` but no `return` statement.

**Fix:** Add `return;` after the "already configured" reply block.

---

### P1-5 — `handleRecovery` references `ChannelType` without importing it

**File:** `src/handlers/recovery.js`, line 55  
```js
const category = message.guild.channels.cache.find(c => 
    c.type === ChannelType.GuildCategory && ...
```
`ChannelType` is not imported in `recovery.js`. There is no `require('discord.js')` destructuring for `ChannelType` at the top of the file. At runtime this throws `ReferenceError: ChannelType is not defined` whenever `Wolf.recovery` is used.

**Fix:** Add `const { ChannelType, EmbedBuilder } = require('discord.js');` to the top of `recovery.js`.

---

### P1-6 — `handleArchive` references `ChannelType` without importing it

**File:** `src/handlers/archive.js`, lines 50, 80, 437, 449  
Same issue as P1-5 — `ChannelType` is used throughout `archive.js` but never imported. `Wolf.archive` and `Wolf.archive_local` both crash with `ReferenceError`.

**Fix:** Add `const { ChannelType, EmbedBuilder } = require('discord.js');` to the top of `archive.js`.

---

### P1-7 — `Wolf.start` role assignments may partially apply if roles are missing

**File:** `src/handlers/game.js`, lines 839–1014  
**Function:** `handleStart`

`aliveRole`, `deadRole`, `spectatorRole`, and `modRole` are obtained via `guild.roles.cache.find(...)` with no null checks. They are used as IDs inside `permissionOverwrites` arrays throughout the entire channel creation block. If any one of these roles does not exist, `role.id` throws and the command partially creates channels before crashing. This leaves the game in a half-started state: some channels exist, the DB is not fully updated, and the game status remains `signup`.

**Fix:** Validate all four roles exist before beginning any channel creation and reply with a descriptive error if any is missing.

---

### P1-8 — Token logged to console in plaintext on startup

**File:** `src/index.js`, line 28  
```js
console.log(`🔑 Using Discord token: ${process.env.DISCORD_TOKEN}`);
```
The full Discord bot token is printed in plaintext to stdout on every startup. Any log aggregation service, stdout capture, or anyone with console access can read it.

**Fix:** Either remove the log entirely, or log only a redacted version (e.g., first 10 chars + `...`).

---

### P1-9 — `handleNext` sends `day_message` / `night_message` even when they are `null`

**File:** `src/handlers/game-phases.js`, lines 71–79  
```js
const phaseMessage = newPhase === 'day' ? game.day_message : game.night_message;
...
.setDescription(`It is now **${newPhase} ${newDay}**.\n\n${phaseMessage}`)
```
`game.day_message` and `game.night_message` can be `NULL` from the database, resulting in embed descriptions with `undefined` or `null` appended. Discord's `EmbedBuilder` stringifies these, producing messages like "It is now **day 2**.\n\nnull" visible to players.

**Fix:** Use nullish coalescing: `game.day_message ?? ''`.

---

### P1-10 — Wolves added to wolf chat use `this.client.guilds.cache.first()` instead of the current guild

**File:** `src/handlers/voting.js`, line 539  
```js
const member = await this.client.guilds.cache.first().members.fetch(player.user_id);
```
This fetches from the **first guild** in the bot's guild cache, not necessarily the guild where the game is running. If the bot is in multiple servers, wolves in non-primary servers will either not be found or be fetched from the wrong guild, causing them to not get wolf chat access (corroborating Feedback #69: "sometimes the bot doesnt add wolves to wolf chat").

**Fix:** Pass the `guild` (or `serverId`) into `sendRoleNotificationsToJournals` and use it to fetch the member.

---

### P1-11 — `handleIA` / `handleSpeedCheck` have an infinite loop risk when all messages are newer than the cutoff

**Files:** `src/handlers/utils.js` lines 564–591; `src/handlers/speed-vote.js` lines 105–131 and 215–241  

In the pagination loop:
```js
while (true) {
    const messages = await activityChannel.messages.fetch(options);
    if (messages.size === 0) break;
    ...
    const oldestMessage = messages.last();
    if (oldestMessage.createdAt < utcDate) break;
    lastMessageId = oldestMessage.id;
}
```
If the channel has thousands of messages that are all newer than `utcDate` (e.g., `Wolf.ia` called with a very old date on a very active channel), the loop will fetch until it hits Discord's pagination limit or rate limit, potentially running for minutes, blocking the event loop for sequential awaits, and consuming significant API quota. There is no maximum-page guard.

**Fix:** Add a page counter (e.g., `const MAX_PAGES = 500`) and break with a warning if exceeded.

---

### P1-12 — `handleJournalLink` inserts into `player_journals` without `ON CONFLICT` — duplicate key crash

**File:** `src/handlers/journal.js`, line 1661  
```js
await this.db.query(
    'INSERT INTO player_journals (server_id, user_id, channel_id) VALUES ($1, $2, $3)',
    ...
);
```
Unlike every other journal insertion in the file (which use `ON CONFLICT ... DO UPDATE`), this bare `INSERT` will throw a unique constraint violation if the user already has a journal. Although the function checks `availableMembers` to exclude users with journals, a race condition (two simultaneous calls) or a bug in the filter could still trigger it.

**Fix:** Use `ON CONFLICT (server_id, user_id) DO UPDATE SET channel_id = EXCLUDED.channel_id`.

---

## P2 — Medium / Stability

### P2-1 — No rate-limit handling on bulk Discord API operations in `handleEnd`

**File:** `src/handlers/game-phases.js`, lines 344–373  
**Function:** `handleEnd`

When a game ends, the bot iterates over every guild member and calls `removeRole`/`assignRole` three times each per member (remove Signed Up, Alive, Dead; assign Spectator). For a 50-player game with 200 server members, this fires 800+ individual role API calls sequentially with no delay or batching. Discord's rate limit is 5 requests per second per endpoint per guild. This will hit rate limits, leading to 429 errors and slow/failed role resets.

**Fix:** Add a small delay (`await new Promise(r => setTimeout(r, 250))`) between members, or batch members into groups and process with a concurrency limit.

---

### P2-2 — Speed vote polling interval is every 2 seconds for every active game — unbounded DB load

**File:** `src/handlers/speed-vote.js`, lines 521–524  
```js
const intervalId = setInterval(checkReactions, 2000);
```
Each active speed vote fires a DB query and a Discord API fetch every 2 seconds indefinitely. With multiple simultaneous speed votes (possible since the per-game uniqueness check passes), this accumulates rapidly. There is no timeout: a speed vote that is never resolved and then forgotten about (e.g., bot restarts without deleting the DB row) will poll forever on the next startup — except there will be no interval on restart, so the DB row is an orphan that blocks future speed votes until manually deleted.

**Fix:** Use `handleReaction` exclusively (already wired up) to trigger updates; the polling interval is redundant and should be removed in favour of the event-driven approach.

---

### P2-3 — `handleBalanceJournals` busy-waits up to 15 seconds blocking the async event loop

**Files:** `src/handlers/journal.js`, lines 825–848 and lines 1420–1445  

Both `handleBalanceJournals` and `performJournalRebalancing` contain:
```js
while (!allMovesConfirmed && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    await message.guild.channels.fetch();
    ...
}
```
This is a polling loop that idles for up to 15 seconds, fetching the entire channel list on each iteration. During this time, all other Discord events for this guild are queued behind it. On a busy guild this introduces perceptible latency spikes.

**Fix:** Discord does not guarantee position confirmation via REST anyway — trust the API success and remove the polling loop.

---

### P2-4 — `handleCreate` category positioning loop also busy-waits up to 10 seconds per journal category

**File:** `src/handlers/game.js`, lines 366–387  

Same issue as P2-3 — a `while` loop polling `await new Promise(resolve => setTimeout(resolve, 1000))` after every journal category move, blocking the event loop for up to 10 × N seconds where N is the number of journal categories.

**Fix:** Remove the polling confirmation loop; Discord's REST guarantees order on success.

---

### P2-5 — `handleArchive` accumulates all messages from all channels in memory before inserting

**File:** `src/handlers/archive.js`, lines 120–276  

For each channel, all messages are pushed into `messagesToIndex` (an in-memory array). On a large game with thousands of messages across many channels, this can exhaust the Node.js heap. The messages are then also duplicated into `processedChannelsData` (another in-memory structure). Two full copies of all message data coexist in memory at the same time.

**Fix:** Process and insert messages in a streaming/batch fashion — insert each batch immediately and discard it before fetching the next, rather than collecting everything first.

---

### P2-6 — `db:refresh` npm script uses shell interpolation with unsanitized environment variables

**File:** `package.json`, line 17  
The `db:refresh` script builds a shell command by directly interpolating `process.env.PG_HOST`, `PG_PORT`, `PG_USER`, and `PG_DATABASE` into `execSync`. Any whitespace or special character in these variables will break the command or cause shell injection. This is a dev-only script but still a footgun.

**Fix:** Use the `pg` library to run the SQL file instead of `execSync psql`.

---

### P2-7 — `handleStart` and `handleNext` do not guard against running concurrently for the same game

**Files:** `src/handlers/game.js`; `src/handlers/game-phases.js`

Both commands are long async operations that take several seconds (channel creation, DB writes, permission setting). If a moderator triggers `Wolf.start` or `Wolf.next` twice in quick succession (e.g., double-click, laggy Discord UI), two concurrent executions start. There is no database-level advisory lock or bot-side in-progress flag. This can result in duplicate channels, double DB inserts, and corrupted game state.

**Fix:** Use a per-game in-memory `Set` of in-progress operations, or use a PostgreSQL advisory lock during the critical section.

---

### P2-8 — `syncServerMembers` issues one DB query per guild member — N+1 query pattern

**File:** `src/handlers/archive.js`, lines 696–730  
**Function:** `syncServerMembers`

For each guild member, a separate `INSERT ... ON CONFLICT` query is issued. On a 500-member server this is 500 sequential round-trips to the database. This is the definition of an N+1 pattern and is the primary reason the cron job runs at 4 AM.

**Fix:** Collect member data into batches and use a multi-row `INSERT ... ON CONFLICT` (e.g., unnest arrays in PostgreSQL).

---

### P2-9 — SQLite `init()` is not awaited — race condition on first mention

**File:** `src/sqlite-manager.js`, lines 12–32  
**Function:** `init`

`init()` is called synchronously in the constructor and is async (returns a promise). The promise is not stored or awaited anywhere. If `handleMessage` is called before SQLite finishes opening, `this.db` is still `null` and the `recordMention` / `getMentionsInLastHour` calls will throw `TypeError: Cannot read properties of null (reading 'run')`.

**Fix:** Make `init()` return a Promise stored on the instance and await it before first use, or handle the `null` case in each method.

---

### P2-10 — `handleSetup` uses `awaitMessages` which can be triggered by any bot in the channel

**File:** `src/handlers/game.js`, lines 96–113  
**Function:** `handleSetup`

The collector `filter` is `(m) => m.author.id === message.author.id && !m.author.bot`. If the invoker has another bot that mirrors their messages, the filter would never match. More practically, if Discord is slow and the mod types the response in a different channel, `awaitMessages` quietly times out and the setup is never completed, but the "please respond with" embed is already sent, confusing users.

**No critical bug, but noted.** The same `awaitMessages` pattern used in `handleEnd`, `handleScuff`, `handleRecovery`, `handleJournalLink`, and `handleJournalUnlink` is all subject to the same interaction pattern risks.

---

### P2-11 — Graceful shutdown does not close the PostgreSQL pool or Discord client

**File:** `src/index.js`, lines 113–123  
```js
process.on('SIGINT', async () => {
    await aliveMentionDetector.close();
    process.exit(0);
});
```
On shutdown, the SQLite database is closed but the PostgreSQL pool (`db`) is not ended (`pool.end()`), and `client.destroy()` is never called. Postgres connections may stay open in a half-close state until the server-side timeout, and in-flight async Discord API calls may fail with unhandled rejections.

**Fix:** Add `await db.end()` and `client.destroy()` before `process.exit(0)`.

---

### P2-12 — `handleRolesList` theme display logic is inverted (`is_themed` shows custom only; `is_skinned` shows custom + actual)

**File:** `src/handlers/roles.js`, lines 256–266  
```js
if (gameTheme.is_themed && player.custom_name) {
    displayRoleName = player.custom_name;          // themed = only custom name
} else if (gameTheme.is_skinned && player.custom_name) {
    displayRoleName = `${player.custom_name} (${player.role_name})`; // skinned = custom + real
}
```
In `sendRoleNotificationsToJournals` (voting.js, lines 506–518), the logic is **reversed**: `is_themed` shows `custom (real)` and `is_skinned` shows only custom. One of these two is wrong. Given the names, "themed" suggests only the thematic name should show (as in `roles_list`) and "skinned" might mean "reskinned name with real name for mod reference" — but the notification logic says the opposite. This inconsistency means players and mods see different formatting rules for the same game flags.

**Fix:** Agree on one canonical interpretation, document it, and make both functions consistent.

---

## P3 — Low / Cleanup

### P3-1 — Unused variable `wolfChatMessage` in `sendRoleNotificationsToJournals`

**File:** `src/handlers/voting.js`, line 452  
```js
let wolfChatMessage = '';
```
This variable is assigned a literal empty string and is never written to or read from after that point. It is pure dead code.

**Fix:** Remove the declaration.

---

### P3-2 — Unused variable `splitPerformed` in `handleJournal` and `ensureUserHasJournal`

**File:** `src/handlers/journal.js`, lines 40 and 185  
```js
const splitPerformed = await this.checkAndProactivelySplitJournals(...);
```
The return value is never used. The variable name exists but is dead after assignment.

**Fix:** Change to `await this.checkAndProactivelySplitJournals(...)` (drop the `const`).

---

### P3-3 — `handleServer` uses `aliveCount` variable that can be double-incremented (P0-5 companion)

**File:** `src/handlers/utils.js`, lines 728–774  
Also noted in P0-5. As a separate cleanup: the fallback `for` loop inside the `catch` block increments `aliveCount`, and then the post-catch loop also increments `aliveCount` for every player in the cache. Even ignoring the double-count, the fallback and the main path count from different data sources, potentially producing inconsistent results.

---

### P3-4 — `calculateSimilarity` function (Levenshtein distance) is defined in `utils.js` but used only in `journal.js`

**File:** `src/handlers/utils.js`, lines 940–975  
`calculateSimilarity` belongs logically with the journal linking code. Its placement in `utils.js` (a catch-all handler) alongside game-management utilities is architecturally inconsistent. This is a cleanup concern, not a bug.

---

### P3-5 — Dead code: `getAliveRoleIds()` and `getModRoleIds()` methods are never called

**File:** `src/alive-mention-detector.js`, lines 247–253  
Both methods are `async` wrappers that return internal Maps. No external code calls them.

**Fix:** Remove if not planned for external use.

---

### P3-6 — Debug `console.log` statements left in production paths

Multiple handlers emit noisy debug output intended for development:
- `src/handlers/voting.js` line 500: `console.log('[DEBUG] Processing ...')` inside per-player loop  
- `src/handlers/game.js` lines 316, 333, 1147: `console.log('[DEBUG] Pinned ...')`, `console.log('[DEBUG] Created channel ...')`
- `src/handlers/speed-vote.js` line 406: `console.log('Speed vote created: ...')`
- `src/handlers/utils.js` lines 383–384: bare `console.log(dateParts)` / `console.log(channelArg)` in `handleIA`
- `src/handlers/utils.js` line 438: `console.log("channelArg:", channelArg)`
- `src/handlers/utils.js` line 484: `console.log("activityChannel:", activityChannel)` — this logs a Discord channel object, which can be enormous
- `src/handlers/recovery.js` line 99: `console.log(aliveRole.members)` — logs entire member collection

**Fix:** Replace with a proper logging library (e.g., `pino`) with log levels, or at minimum wrap debug logs in `if (process.env.NODE_ENV === 'development')`.

---

### P3-7 — `handleIA` message fetching logic is duplicated verbatim three times

**File:** `src/handlers/utils.js` (in both the catch-block fallback path and the main path), `src/handlers/speed-vote.js` (`handleSpeedCheck` main + fallback paths)

The same `while(true)` pagination loop appears at least 4 times across these files. Any bug fix or enhancement must be applied in all four places.

**Fix:** Extract into a shared helper `fetchMessagesSince(channel, sinceDate, authorFilter)`.

---

### P3-8 — `handleRoles*` in `roles.js` checks `isPublicChannel` by channel name — fragile

**File:** `src/handlers/roles.js`, lines 60–63  
```js
isPublicChannel(message) {
    const channelName = message.channel.name.toLowerCase();
    return !channelName.includes('dead-chat') && !channelName.includes('mod-chat');
}
```
This check relies on channel name substrings. A channel named `dead-chat-2` or a localized variant would match. Commands like `Wolf.roles_list` and `Wolf.role_config` are gated on this, so a misconfigured channel name could inadvertently expose the role list in a public channel.

**Fix:** Compare against the stored `mod_chat_channel_id` and `signup_channel_id` (which is renamed to dead-chat after start) from the DB, rather than by name.

---

### P3-9 — `handleFeedback` logs potentially long feedback text as a one-liner with `substring(0, 100)` but appends `...` unconditionally

**File:** `src/handlers/utils.js`, line 1042  
```js
console.log(`Feedback submitted by ... : ${feedbackText.substring(0, 100)}...`);
```
The trailing `...` is always appended even when the full feedback is ≤100 characters, producing misleading logs.

**Fix:** `${feedbackText.length > 100 ? feedbackText.substring(0, 100) + '...' : feedbackText}`

---

### P3-10 — Typo in user-facing error message

**File:** `src/handlers/game.js`, line 437  
```js
return message.reply('❌ It would apear you are banned...');
```
"apear" should be "appear".

---

### P3-11 — `handleSettings` channel name lookup uses `LIKE '%name%'` — ambiguous match

**File:** `src/handlers/channels.js`, line 429  
```js
'SELECT * FROM game_channels WHERE game_id = $1 AND (channel_name LIKE $2 OR channel_name LIKE $3)',
[game.id, `%${channelName}`, `%${channelName}%`]
```
A channel name argument of `e` would match every channel whose name ends in or contains "e". This returns `channelResult.rows[0]` (only the first match), silently applying the setting to a potentially unintended channel.

**Fix:** Require an exact match or prefix match only.

---

### P3-12 — `moment-timezone` used but largely replaceable with native `Temporal` / `Date`

**File:** Multiple files  
`moment-timezone` is a heavy dependency (2.5 MB) used primarily for EST/EDT conversion. Node 18+ has `Intl.DateTimeFormat` and the `Temporal` API (stage 3). This is a cleanup / dependency hygiene note, not a bug.

---

### P3-13 — `handleJournalOwner` uses deprecated `setThumbnail({ dynamic: true })`

**File:** `src/handlers/journal.js`, line 1770  
```js
.setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
```
The `{ dynamic: true }` option was removed in discord.js v14. It is silently ignored by the API, but it produces a misleading code smell. The correct approach is to check if the user has an animated avatar and use `{ extension: 'gif' }` if so.

---

### P3-14 — `handleJournalAssign` uses deprecated `.tag` property

**File:** `src/handlers/journal.js`, lines 1671, 1714, 1921  
`member.user.tag` (e.g., `Username#0000`) was deprecated in Discord.js v14 and the discriminator system was removed. For users on the new username system, `.tag` is just `.username`. Use `member.user.username` or mention the user with `<@id>`.

---

### P3-15 — `handleImage.js` imports `S3Client` and `https`/`http` but the module does not guard against `this.s3Client` being null at every call site

**File:** `src/handlers/image.js`, lines 43–44  
`uploadImageToS3` checks `if (!this.s3Client)` correctly (throws an error), but `downloadImage` does not guard against the caller misusing it and `processDiscordImages` does check `if (!this.s3Client)`. The error thrown from `uploadImageToS3` propagates and is caught in `handleArchive`, so not a crash, but inconsistent guarding is a maintenance risk.

---

### P3-16 — `handleRecovery` `saveRecoveryData` uses `config.game_counter - 1` heuristic — fragile

**File:** `src/handlers/recovery.js`, line 414  
```js
config.game_counter - 1, // Use current counter minus 1 since it was already incremented
```
This comment-as-documentation approach is fragile: if `Wolf.create` ever changes how it increments the counter (e.g., increments only on success), this offset will be wrong and recovery will register the game under the wrong game number.

**Fix:** Ask the user for the game number directly during recovery, or look it up from the category name.

---

## Summary

| Priority | Count |
|----------|-------|
| P0 — Critical / Crash | 6 |
| P1 — High / Bug | 12 |
| P2 — Medium / Stability | 12 |
| P3 — Low / Cleanup | 16 |
| **Total** | **46** |

### Most Urgent Items to Fix First

1. **P0-1** — `PIN_PERMISSION` undefined in `utils.js` / `voting.js` (crashes wolf chat setup)
2. **P0-2** — Null role crash in `handleCreate` (crashes every game create on unprepared servers)
3. **P1-8** — Token logged in plaintext (security)
4. **P0-3** — All votes deleted per day transition (data loss)
5. **P1-10** — Wolves not added to wolf chat due to wrong guild fetch (Feedback #69)
6. **P1-5 / P1-6** — `ChannelType` not imported in `recovery.js` and `archive.js` (crashes those commands)
7. **P1-4** — `handleSetup` falls through and can overwrite config unintentionally
8. **P0-4 / P0-5** — Double role-assignment and double alive-count loops
