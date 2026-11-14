# Development Roadmap

Working backlog for agents, built from the `feedback` table snapshot below. It only lists open work. When an
item ships, delete it from this list (do not keep a "shipped" log; git history has that) and resolve its
`feedback` rows with `npm run feedback:resolve` (see CLAUDE.md). Then regenerate the snapshot with
`scripts/regenerate-feedback-md.py`, which keeps everything above the marker line.

Items are ordered easiest first. Size: S = an hour or two, M = a day, L = several days.

## Open items

Nothing open. New feedback lands in the snapshot below.

## Won't do

- **Sending role messages to wolves' journals.** Settled. Wolves get their role in wolf chat only; the
  journal skip in `sendRoleNotificationsToJournals` (`bot/src/handlers/voting.js`) is intentional. The
  "missing unread badge reveals wolves" argument doesn't hold: journals deny ViewChannel to Alive and Signed
  Up, so the only people who could notice a missing badge can already read every journal.

<!-- REGENERATED SNAPSHOT BELOW - do not edit below this line; scripts/regenerate-feedback-md.py overwrites everything under this marker. -->

# Feedback

Snapshot of the `feedback` table. Resolved items (implemented, already covered, out-of-scope, or non-actionable) were **removed from the database** on **2026-11-14**.

**Total entries:** 2

---

## #106 - 2026-11-04T16:03:03.470909+00:00

- **Display name:** Roxy Hurricane 🏆🏆🏆
- **User ID:** `393594178061336576`
- **Server ID:** `1539787007939846216`

**Feedback**

> wolf.add_in is a mod only command so it should work even if signups are closed 🙏

---

## #107 - 2026-11-08T17:54:08.613819+00:00

- **Display name:** Roxy Houricane 🏆🏆🏆
- **User ID:** `393594178061336576`
- **Server ID:** `1539787007939846216`

**Feedback**

> wolf.scuff isn't resetting roles

---
