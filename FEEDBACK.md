# Development Roadmap

Working backlog for agents, built from the `feedback` table snapshot below. It only lists open work. When an
item ships, delete it from this list (do not keep a "shipped" log; git history has that) and resolve its
`feedback` rows with `npm run feedback:resolve` (see CLAUDE.md). Then regenerate the snapshot with
`scripts/regenerate-feedback-md.py`, which keeps everything above the marker line.

Items are ordered easiest first. Size: S = an hour or two, M = a day, L = several days.

## Open items

Nothing open that doesn't need a decision first (see below).

## Built, waiting on deploy

Code and migrations (`database/migrations/20261114T12*`) are written and tested but not deployed. Apply
the migrations to production **before** pushing the bot, then resolve these rows and delete this section.

- **#63** - `Wolf.rollback` undoes the last `Wolf.next`.
- **#46** - `Wolf.wolf_dead` creates a chat for dead wolves; they join it when killed.
- **#43** - core channel names are editable in the dashboard's Manage Channels modal during signups.
- **#26** - `Wolf.silent`. **#27, #67** - `Wolf.ia_history [channel] [min]`.
- **#49** - `Wolf.settings ia_reset 00:00` (hour or half hour only, so "0001" is `00:00`).
- **#88** - `Wolf.settings active_journals on` (opt-in per server; the archive categories keep the name
  "Journals").

`npm run feedback:resolve -- 63 46 43 26 27 67 49 88 --dry-run` first. #49 and #88 need a note saying which
setting to turn on.

## Needs a decision from David first

- **#57 - give dead players "Signed Up" too.** `Wolf.scuff` only converts Alive on purpose, and its
  confirmation embed says it won't touch Dead. Reversing that is David's call.
- **#91 - no per-game mod chat.** Mod chat is now where the wolf-chat-add failure alert and the journal
  auto-fix summary are posted, so removing it needs a new home for mod alerts first.

## Won't do

- **Sending role messages to wolves' journals.** Settled. Wolves get their role in wolf chat only; the
  journal skip in `sendRoleNotificationsToJournals` (`bot/src/handlers/voting.js`) is intentional. The
  "missing unread badge reveals wolves" argument doesn't hold: journals deny ViewChannel to Alive and Signed
  Up, so the only people who could notice a missing badge can already read every journal.

<!-- REGENERATED SNAPSHOT BELOW - do not edit below this line; scripts/regenerate-feedback-md.py overwrites everything under this marker. -->

# Feedback

Snapshot of the `feedback` table. Resolved items (implemented, already covered, out-of-scope, or non-actionable) were **removed from the database** on **2026-10-20**.

**Total entries:** 10

---

## #26 - 2025-10-05T21:48:46.83244+00:00

- **Display name:** SortaCreativeDanny
- **User ID:** `117857003145134081`
- **Server ID:** `1354597610656366683`

**Feedback**

> A command that returns a list of alive players who have not messaged in townsqure or voting booth that day. If that's too hard, a list of alive players voted that day would suffice -- Whether retracted or otherwise. The goal here being to have a command that narrows down who hasn't been online for speed purposes.

---

## #27 - 2025-10-05T21:49:22.221522+00:00

- **Display name:** SlightlyChurnedMitch
- **User ID:** `376604325973196821`
- **Server ID:** `1354597610656366683`

**Feedback**

> An inactive list that includes the entire games history. Hopefully that is possible

---

## #43 - 2025-12-17T22:56:06.267532+00:00

- **Display name:** Stinky
- **User ID:** `162675596772638720`
- **Server ID:** `1395040693138886857`

**Feedback**

> allow changing of all channel names on the site before the game starts

---

## #46 - 2026-01-03T22:37:14.457753+00:00

- **Display name:** Elevator
- **User ID:** `1248024419201450075`
- **Server ID:** `1395040693138886857`

**Feedback**

> can we get wolf dead in this game?

---

## #49 - 2026-01-09T18:00:09.790594+00:00

- **Display name:** 500 Games of Mully
- **User ID:** `156069627972026368`
- **Server ID:** `1395040693138886857`

**Feedback**

> set IA reset to start at 0001
>
> Talking in the morning should count towards it

---

## #57 - 2026-02-03T02:06:15.433796+00:00

- **Display name:** ElevatorClassic 👻🐪🐪
- **User ID:** `1248024419201450075`
- **Server ID:** `1354597610656366683`

**Feedback**

> add signed up to all dead players too not just alive

---

## #63 - 2026-03-18T00:21:04.783847+00:00

- **Display name:** Stinky
- **User ID:** `162675596772638720`
- **Server ID:** `1466585500314767413`

**Feedback**

> add rollback command

---

## #67 - 2026-03-29T18:10:00.358975+00:00

- **Display name:** Hannibad Mulligan
- **User ID:** `156069627972026368`
- **Server ID:** `1466585500314767413`

**Feedback**

> the wolf ia command tracks who violated IA standards on previous days

---

## #88 - 2026-06-25T13:59:24.427355+00:00

- **Display name:** Oryx the African Antelope 🏆🏆
- **User ID:** `393594178061336576`
- **Server ID:** `1466585500314767413`

**Feedback**

> it would be really neat if the bot put the journals in one section for people in an active game and the other section could be journal archives, then if they sign up for the next game bot couple move them back.

---

## #91 - 2026-07-26T15:33:38.021072+00:00

- **Display name:** Raf👑 👑 🏆🏆🏆🏆
- **User ID:** `410499132755542018`
- **Server ID:** `1466585500314767413`

**Feedback**

> uhhh don’t have a modchat for each game

---
