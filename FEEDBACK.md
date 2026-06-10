# Feedback Analysis

All feedback submitted via the bot's feedback command. Analyzed against the current codebase and prioritized below.

---

## Summary

| Total | Relevant | Not Relevant | Duplicates | Already Fixed |
|-------|----------|--------------|------------|---------------|
| 30    | 25       | 2            | 3          | 1             |

---

## Bugs — High Priority

These are confirmed bugs affecting gameplay or fairness.

---

### Wolves Not Added to Wolf Chat
**IDs: 80, 69** | *Dragon, Dragonversary* | *2026-04-27, 2026-03-31*

> "not all players are getting added to wolf chat recently. mods should be notified who didn't get added when this happens"
> "sometimes the bot doesnt add wolves to wolf chat"

Wolves occasionally fail to get added to the wolf chat channel during game setup. This is a critical gameplay issue — wolves who don't get wolf chat have no private communication. Reported twice by the same user, suggesting it's recurring and not edge-case. The secondary ask (notify mods of who was missed) is a good mitigation even before the root cause is fixed.

**Relevance:** ✅ Relevant | **Priority:** 🔴 Critical

---

### Suspended Players Can Sign Up
**IDs: 78, 77** | *Dragon, Roxy* | *2026-04-17*

> "suspended players can still sign up"
> "people with the suspended role should not be able to wolf.in"

Players who hold the "Suspended" Discord role can still use `Wolf.in` to join games. The sign-up handler in `bot/src/handlers/game.js` does not check for a suspended role before adding the player. Reported by two different users on the same day, likely observed during the same game.

**Relevance:** ✅ Relevant | **Priority:** 🔴 Critical

---

### Couple Chat Open During the Day
**ID: 82** | *Roxy* | *2026-05-04*

> "couple chat is open during the day"

The couple chat channel (`is_couple_chat` flag in `game_channels`) is not being restricted correctly when day phase begins. In `channels.js`, couple chat is handled as a special case around line 668, but the channel permissions are not being locked at dawn. This exposes private couple communication to the wrong phase.

**Relevance:** ✅ Relevant | **Priority:** 🔴 Critical

---

### Dead Players Cannot See Couple Chat
**ID: 31** | *Fletch* | *2025-10-10*

> "dead cannot see couple chat"

When a player dies and transitions from Alive to Dead role, they lose access to couple chat. Couple members who die should retain view access to their couple channel. Likely a permission-override issue during the death transition — the Alive role is removed, and there's no Dead-specific permission grant for couple chat.

**Relevance:** ✅ Relevant | **Priority:** 🔴 Critical

---

## Language / Sensitivity

---

### Remove "lynch" from Bot Vocabulary
**IDs: 84, 85** | *Roxy* | *2026-05-25, 2026-06-08*

> "the bot used the world 'lynch' when replying to Wolf.ln which is highly controversial and ideally not used due to the connotation and history of the word"
> "I am once again requesting we take the word 'lynch' out of the bot's vocabulary"

The bot outputs the word "lynch" somewhere in its messaging (likely the voting/execution flow). Roxy has submitted this twice — once reporting it, once following up that it still hasn't been fixed. The word carries significant historical weight and should be replaced with neutral alternatives like "eliminate," "vote out," or "hang" (if the game's theme permits). No instances of "lynch" were found in the current bot source files, so this may live in a dynamic message string or database-stored template.

**Relevance:** ✅ Relevant | **Priority:** 🔴 High

---

## Features — High Priority

---

### Game Number in Role DM + Wolf Roles in Journals
**ID: 79** | *Roxy* | *2026-04-20*

> "put the game number in the message that gives out roles so when I'm looking at my journal later I can easily tell what game it was. Also put wolf roles in journals for the same reason."

When players receive their role DM, the game number is not clearly included. `roles.js` builds a `gameTitle` including `game_number` for embeds displayed in mod channels (line 347), but it's unclear whether this title is included in the role DM sent to each player. Additionally, wolf-side roles (e.g., which other players are wolves) are not written into the player journal, making it hard to review past games.

**Relevance:** ✅ Relevant | **Priority:** 🟠 High

---

### Pin Day/Night Start Messages Automatically
**ID: 81** | *Queen dAnney* | *2026-04-30*

> "pin the day start and ends automatically each time for easier time reading back"

When the bot transitions between day and night, the phase announcement message is not pinned. Players and mods frequently need to scroll back to find timestamps. The `game-phases.js` handler sends the phase-change message but has no `.pin()` call. Signup messages are already pinned on creation (line 334 of `game.js`), so the pattern exists — it just needs to be applied to phase transitions too.

**Relevance:** ✅ Relevant | **Priority:** 🟠 High

---

### Alive Players Who Haven't Messaged Today
**ID: 26** | *SortaCreativeDanny* | *2025-10-05*

> "A command that returns a list of alive players who have not messaged in town square or voting booth that day. If that's too hard, a list of alive players voted that day would suffice. The goal here being to have a command that narrows down who hasn't been online for speed purposes."

An IA-adjacent command that returns alive players with zero messages that day (or alternatively, alive players who have cast a vote). This is distinct from `Wolf.ia` — it's a quick moderation tool for identifying who needs a ping, especially in speed games. The message tracking infrastructure already exists for `handleIA`; a filtered query for "zero messages today, still alive" should be feasible.

**Relevance:** ✅ Relevant | **Priority:** 🟠 High

---

### Notify Mods When Wolf Chat Add Fails
*(Tied to IDs 80/69 above)*

This is the secondary part of Dragon's wolf-chat bug report: even if the root add-failure can't always be prevented, mods should receive a notification listing which wolf(ves) were not successfully added, so they can manually add them before the game begins.

**Relevance:** ✅ Relevant | **Priority:** 🟠 High

---

## Features — Medium Priority

---

### LSSV Helper Command
**ID: 75** | *SemiCharmedMike* | *2026-04-12*

> "Build in a function to help figure out LSSV (longest standing second vote). Such as, list all final votes in order of when vote occurred."

LSSV (Longest Standing Second Vote) is a tiebreaker mechanic that determines the winner when multiple players are tied at the vote threshold. A command that lists all final (non-retracted) votes sorted by timestamp would let mods and players quickly identify who cast theirs first. The votes table already exists; this is a new query + display command.

**Relevance:** ✅ Relevant | **Priority:** 🟡 Medium

---

### Wolf IA Tracks Previous Days' Violations
**ID: 67** | *Hannibad Mulligan* | *2026-03-29*

> "the wolf ia command tracks who violated IA standards on previous days"

The `Wolf.ia` command shows activity for the current day. Mods need to know if a player was inactive on a *previous* day (e.g., Day 2 history when it's Day 3), likely to issue warnings or take action. The IA handler already supports date arguments; a summary/history view across all past days would serve this use case.

**Relevance:** ✅ Relevant | **Priority:** 🟡 Medium

---

### IA Reset Should Start at 00:01, Morning Talk Counts
**ID: 49** | *500 Games of Mully* | *2026-01-09*

> "set IA reset to start at 0001 — Talking in the morning should count towards it"

The IA tracking window defaults to 09:30 AM EST (see `utils.js` cutoff logic). This means players who talk between midnight and 09:30 get no credit. The request is to start the IA window at 00:01 so all messages after midnight count. This would be a config change to the cutoff in `handleIA`.

**Relevance:** ✅ Relevant | **Priority:** 🟡 Medium

---

### Mods Can Set a Voting Booth Message
**ID: 22** | *ElevatorClassic* | *2025-09-27*

> "let mods set a voting booth message"

Mods want to post a custom sticky/welcome message in the voting booth channel (e.g., rules reminders, current day info). The voting booth channel is already managed by the bot; a `Wolf.set_booth_message` command that posts and pins a mod-authored embed would serve this. The bot already supports `Wolf.set_voting_booth` for channel selection.

**Relevance:** ✅ Relevant | **Priority:** 🟡 Medium

---

### Move Alive Ping Warning to Journals
**ID: 24** | *Fletch* | *2025-09-29*

> "Move alive ping warning into Journals to not fud TS"

When the bot pings alive players (e.g., for inactivity warnings), it sends this to Town Square, cluttering the main game channel. Routing these pings to the player's journal or a mod-only channel would reduce noise. Needs investigation into where the ping is sent and whether journals or a private channel would be the better target.

**Relevance:** ✅ Relevant | **Priority:** 🟡 Medium

---

### "Signed Up" Role for Dead Players
**ID: 57** | *ElevatorClassic* | *2026-02-03*

> "add signed up to all dead players too not just alive"

Dead players lose the "Signed Up" role. Keeping it on dead players as well as alive ones would let mods quickly see who signed up for the current game regardless of alive/dead status, useful for game history and roster reference.

**Relevance:** ✅ Relevant | **Priority:** 🟡 Medium

---

### IA Full Game History / All-Time Inactive List
**ID: 27** | *SlightlyChurnedMitch* | *2025-10-05*

> "An inactive list that includes the entire games history."

Currently IA shows a single day's activity. A persistent, game-scoped IA history showing total messages per day per player across the whole game would help mods identify patterns and support post-game review.

**Relevance:** ✅ Relevant | **Priority:** 🟡 Medium

---

### Rollback Command
**ID: 63** | *Stinky* | *2026-03-18*

> "add rollback command"

A command to undo the last game state action (e.g., undoing a death, reverting to the previous phase). Not currently implemented. Scope is unspecified — could mean rolling back a night action, a death, or a full phase. Would need careful design around what state is rolled back and how far.

**Relevance:** ✅ Relevant | **Priority:** 🟡 Medium

---

### Wolf Dead Channel
**ID: 46** | *Elevator* | *2026-01-03*

> "can we get wolf dead in this game?"

A request for a wolf-team-specific dead channel — a space where eliminated wolves can still chat among themselves (separate from the general dead channel). Not currently implemented. Would require a new channel type in game setup.

**Relevance:** ✅ Relevant | **Priority:** 🟡 Medium

---

### Vote Threshold — Mod Adjustability
**ID: 83** | *Raf* | *2026-05-06*

> "kow has a skill issue not being able to change vote threshold"

Despite the joking tone, this appears to reference a real usability issue: a mod (kow) was unable to change the vote threshold mid-game. The `votes_to_hang` field exists in the games table and is displayed in phase-change messages. If there's no command to update this mid-game, that's a missing feature.

**Relevance:** ✅ Relevant (likely) | **Priority:** 🟡 Medium

---

## Features — Low Priority

---

### Role Shorthand / Acronym Section
**IDs: 36, 33** | *tuck* | *2025-10-18, 2025-10-11*

> "on roles pages include the shorthand for each role — Then also have a common acronym section somewhere too!"
> "common shorthands for roles and a section for other abbreviations"

Submitted twice by the same user. A documentation/UI feature to display role abbreviations (e.g., "VT" for Village Tracker) on the roles reference page, plus a glossary of community shorthand. Frontend work.

**Relevance:** ✅ Relevant | **Priority:** 🟢 Low

---

### Action Priority Section
**ID: 32** | *Hibiscus* | *2025-10-10*

> "we need a section on action priority to complement OoO"

A reference page or embed explaining the order in which night actions resolve (beyond Order of Operations), covering edge cases like what happens when two actions conflict. Documentation/frontend work.

**Relevance:** ✅ Relevant | **Priority:** 🟢 Low

---

### Allow Changing Channel Names on Site Before Game Starts
**ID: 43** | *Stinky* | *2025-12-17*

> "allow changing of all channel names on the site before the game starts"

Currently channel names are set by the bot at game creation. A frontend option to rename channels before the game goes live would give mods more flexibility for themed games.

**Relevance:** ✅ Relevant | **Priority:** 🟢 Low

---

### Villager Separate Themes
**ID: 53** | *SemiCharmedMike* | *2026-01-16*

> "Allow for villagers to have separate themes. Set it so that if Villager x4 is selected, it drops four villager inputs under theme names."

When multiple Villager slots are configured, allow each to have a unique display name/theme (e.g., "Baker," "Farmer") rather than all being "Villager." Frontend role configuration feature.

**Relevance:** ✅ Relevant | **Priority:** 🟢 Low

---

## Vague / Possibly Already Fixed

---

### Fix Custom Message on the Site
**ID: 35** | *Stinky* | *2025-10-17*

> "fix the custom message on the site"

Too vague to investigate fully. No obvious broken custom message feature found in the frontend. May have been fixed in a subsequent commit or may need clarification from the reporter.

**Relevance:** ⚠️ Unclear | **Priority:** 🟢 Low (pending clarification)

---

### Permission Issue
**ID: 30** | *Stinky* | *2025-10-09*

> "please for the love of god actually fix the permission issue"

Extremely vague. Given the urgency in tone, this was likely a real and frustrating bug at the time, but without more context it's impossible to determine what permission issue is meant. May be the same as the channel permission bugs already addressed in refactor commits.

**Relevance:** ⚠️ Unclear | **Priority:** 🟢 Low (pending clarification)

---

## Already Fixed

---

### Sleepwalker Can't Visit Themselves
**ID: 66** | *Elevator Elevator* | *2026-03-27*

> "Sleepwalker cant visit themself when selecting from all alive players"

**Fixed in commit `0614c00` ("Fix Sleepwalker Bug").** The Sleepwalker role's target selection now correctly includes the player themselves in the list of valid targets.

**Relevance:** ✅ Relevant | **Status:** ✅ Fixed

---

## Not Relevant

---

### Wolf.out Mr. Bones Wild Ride
**ID: 76** | *18+vator* | *2026-04-13*

> "Whenever someone types 'wolf.out' reply with 'There is no way off Mr. Bones' Wild Ride'"

A joke feature request. Not a real improvement to the bot.

**Relevance:** ❌ Not Relevant

---

### "kow has a skill issue"
*(Covered under ID 83 above — the underlying vote threshold issue may be real, but the framing is a jab at another user, not a feature request.)*

---

## Priority Order (Actionable Items)

| Priority | ID(s) | Item |
|----------|-------|------|
| 🔴 Critical | 80, 69 | Wolves not added to wolf chat + mod notification |
| 🔴 Critical | 78, 77 | Suspended players can sign up |
| 🔴 Critical | 82 | Couple chat open during day |
| 🔴 Critical | 31 | Dead can't see couple chat |
| 🔴 High | 84, 85 | Remove "lynch" from bot vocabulary |
| 🟠 High | 79 | Game number in role DM + wolf roles in journals |
| 🟠 High | 81 | Auto-pin day/night start messages |
| 🟠 High | 26 | Command: alive players who haven't messaged today |
| 🟡 Medium | 75 | LSSV helper command |
| 🟡 Medium | 67 | Wolf IA tracks previous days |
| 🟡 Medium | 49 | IA window starts at 00:01, morning counts |
| 🟡 Medium | 22 | Mods set a voting booth message |
| 🟡 Medium | 24 | Move alive ping to journals |
| 🟡 Medium | 57 | Signed Up role kept on dead players |
| 🟡 Medium | 27 | IA full game history |
| 🟡 Medium | 63 | Rollback command |
| 🟡 Medium | 46 | Wolf dead channel |
| 🟡 Medium | 83 | Vote threshold changeable mid-game |
| 🟢 Low | 36, 33 | Role shorthand + acronym glossary |
| 🟢 Low | 32 | Action priority reference section |
| 🟢 Low | 43 | Change channel names on site pre-game |
| 🟢 Low | 53 | Villager separate themes |
| 🟢 Low | 35 | Fix custom message (needs clarification) |
| 🟢 Low | 30 | Permission issue (needs clarification) |
| ✅ Done | 66 | Sleepwalker self-visit fix |
