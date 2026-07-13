# Stinkwolf Frontend

Next.js web application for the StinkBot Werewolf system. Moderators run games from a per-game dashboard, players browse the role catalog, and anyone can search archived game messages.

## Pages

- `/` - Landing page with links into the app
- `/game/[gameId]` - Password-protected moderator dashboard: player status, role assignment, votes, night actions, channels, game settings
- `/roles` - Role reference (town, wolf, and neutral roles)
- `/archives` - Full-text search over archived Discord messages, with filters and message context
- `/archives/baseball` - Archive browser for the baseball server
- `/admin` - Admin tools: feedback triage and per-server role management

## Stack

- Next.js 16 (App Router) with React 19 and TypeScript
- Tailwind CSS v4; Radix UI primitives with shadcn-style components in `components/ui/`
- PostgreSQL via `pg` - no ORM; all queries live in the `lib/database.ts` service layer
- Deployed on Vercel against a Supabase database

Note: `next.config.mjs` currently ignores TypeScript and ESLint errors during builds, so a passing build does not imply a clean typecheck.

## Getting started

```bash
npm install       # or from the repo root, which installs all workspaces
cp .env.example .env
npm run dev       # http://localhost:3000
```

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `GAME_TOKEN_SECRET` | yes | Signs game dashboard session cookies; generate with `openssl rand -base64 32` |
| `ADMIN_TOKEN_SECRET` | no | Fallback secret if `GAME_TOKEN_SECRET` is unset |
| `NODE_ENV` | no | `development` relaxes Postgres TLS verification for Supabase URLs |

## Game dashboard authentication

Each game gets a cryptographically random dashboard password when the bot creates it; only the scrypt hash is stored. The bot posts a link in mod-chat that pre-fills the password via the `p` query parameter, or it can be entered manually at `/game/[gameId]`.

A successful login sets an HTTP-only, HMAC-signed session cookie (24-hour lifetime) that every game-management API route requires. See `lib/game-auth.ts`. Older games without a generated password temporarily accept their Discord category ID.

## Archives

Archive search runs on Postgres full-text search over the `archive_messages` table, populated by the bot's `Wolf.archive` command. Display names and avatars are joined from `server_users` at query time. The system's design (query flow, jump-to-message, reply previews) is documented in [docs/archives-search-system.md](../docs/archives-search-system.md).

## API routes

Game management (session cookie required):

- `GET/POST /api/games/[gameId]` - Game info; password verification and updates
- `/api/games/[gameId]/players` - Player list and status updates
- `/api/games/[gameId]/roles`, `/player-roles` - Role configuration and assignments
- `/api/games/[gameId]/votes` - Votes per day
- `/api/games/[gameId]/night-actions` - Night action records
- `/api/games/[gameId]/channels` - Game channel management
- `/api/games/[gameId]/info` - Summary info

Public and admin:

- `GET /api/roles` - Role catalog
- `/api/archives/search`, `/context`, `/navigation`, `/message/[messageId]`, `/health` - Archive search and navigation
- `/api/archives/baseball/*` - Baseball archive variants
- `/api/admin/*` - Admin auth, feedback, servers, and roles
- `GET /api/media/oembed` - oEmbed proxy for media previews

## Project structure

```
app/            Pages and API routes (App Router)
components/     Feature components and modals
components/ui/  Base UI components (shadcn-style)
lib/            database.ts (service layer), game-auth.ts, archive-search.ts, media-utils.ts, utils.ts
hooks/          use-mobile, use-toast
public/         Static assets
```

Data access convention: server routes call methods on `lib/database.ts` rather than running SQL inline.

## Design system

Dark-only "Moonwatch" theme defined as CSS tokens in `app/globals.css`. Use the token classes (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`) instead of hardcoded Tailwind colors. Alignment colors: blue for town, red for wolves, amber for neutrals.

## Production build

```bash
npm run build
npm start
```
