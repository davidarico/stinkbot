# Stinkwolf Frontend

## Overview

The Stinkwolf Frontend is a Next.js-based web application that provides a comprehensive management interface for Discord-based Werewolf games. This application allows game moderators to manage active werewolf games running on Discord servers through an intuitive web interface.

## Features

### Game Management
- **Real-time Game State**: View and manage current game phase (signup, day, night)
- **Player Management**: Track player status (alive/dead), assign roles, and manage player actions
- **Role Assignment**: Comprehensive role system with town, wolf, and neutral alignments
- **Voting System**: Track and manage player votes during day phases
- **Phase Control**: Seamlessly transition between game phases

### Role System
The application supports a wide variety of Werewolf roles including:
- **Town Roles**: Villager, Seer, Doctor, Bartender, Sleepwalker, and more
- **Wolf Roles**: Werewolf, Alpha Wolf, and specialized wolf variants
- **Neutral Roles**: Turncoat and other independent roles

### Database Integration
- **PostgreSQL Backend**: Connects to a PostgreSQL database for persistent game state
- **Real-time Updates**: Synchronizes with Discord bot data in real-time
- **Game History**: Maintains historical data of games and player statistics

### Message Archives
- **OpenSearch Integration**: Full-text search through archived Discord messages
- **Advanced Filtering**: Filter by game, channel, user, and content
- **Message Context**: View messages in chronological context
- **User Name Sync**: Automatically updates display names from Discord
- **Pagination**: Efficient browsing of large message archives

## Technology Stack

- **Framework**: Next.js 15 with React 19
- **Language**: TypeScript
- **Styling**: Tailwind CSS with custom UI components
- **UI Components**: Radix UI primitives with custom styling
- **Database**: PostgreSQL (via Supabase)
- **Search Engine**: OpenSearch for message archives
- **Authentication**: Session-based authentication per game

## Project Structure

```
frontend/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   │   └── database/      # Database API endpoints
│   ├── game/              # Game management pages
│   │   └── [gameId]/      # Dynamic game pages
│   └── roles/             # Role information pages
├── components/            # Reusable React components
│   ├── ui/               # Base UI components (buttons, cards, etc.)
│   └── role-info-components.tsx
├── lib/                   # Utility libraries
│   ├── database.ts        # Database service layer
│   └── utils.ts          # General utilities
├── hooks/                 # Custom React hooks
├── public/               # Static assets
└── styles/               # Global styles
```

## Database Schema

The application connects to a PostgreSQL database with the following key tables:

- **games**: Core game information including status, phase, channels, and configuration
- **players**: Player information including roles, status, and game participation
- **votes**: Voting records for each game day
- **server_configs**: Discord server configuration and settings

## Getting Started

### Prerequisites
- Node.js 18+ and npm
- PostgreSQL database (or Supabase instance)
- Environment variables configured

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables:
   ```bash
   # Create .env.local file
   DATABASE_URL=your_postgresql_connection_string
   NODE_ENV=development
   
   # OpenSearch Configuration (if using archives feature)
   OPENSEARCH_DOMAIN_ENDPOINT=http://localhost:9200
   OS_BASIC_USER=your_username
   OS_BASIC_PASS=your_plain_text_password
   ```

3. Set up OpenSearch (if using archives feature):
   ```bash
   npm run setup-opensearch
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Message Archives

The archives feature allows users to search through archived Discord messages from Werewolf games. This feature requires:

### Prerequisites
- OpenSearch instance running on localhost:9200 (or configure the endpoint in the API routes)
- Discord messages indexed in OpenSearch with the correct schema

### Features
- **Full-text Search**: Search through message content with fuzzy matching
- **Filter by Game**: Filter messages by specific game categories
- **Filter by Channel**: Filter messages by Discord channels
- **Filter by User**: Filter messages by specific users
- **Message Context**: Click on any message to view surrounding context
- **Pagination**: Browse through large result sets efficiently
- **User Name Sync**: Display names are automatically updated from the database

### API Endpoints
- `GET /api/archives/search` - Search messages with filters and pagination
- `GET /api/archives/aggregations` - Get available filter options
- `GET /api/archives/context` - Get message context around a specific message

### Production Build

```bash
npm run build
npm start
```

## Usage

### Accessing Game Management

*Note: "Access Test Game Management" seems to be deprecated. Instructions updated accordingly*

1. Navigate to `[SITE_URL]/game/[GAME_ID]`
   - SITE_URL defaults to localhost:3000
   - GAME_ID can be found in mod-chat embed after starting a game
2. Enter the game password (category ID from the database)
   - Should be automatically inserted as `?p=<id>` if clicked from admin embed
3. Use the management interface to:
   - Assign roles to players
   - Track game phases
   - Monitor voting
   - Update player statuses

### Game Authentication

Each game is protected by a password system where the password is the category ID stored in the games table. This ensures only authorized moderators can access game management features.

## API Endpoints

### Games
- `GET /api/games/[gameId]` - Retrieve game information
- `POST /api/games/[gameId]` - Verify game password

### Players
- `GET /api/games/[gameId]/players` - Get players for a game
- `POST /api/games/[gameId]/players` - Assign roles or update player status

### Votes
- `GET /api/games/[gameId]/votes?dayNumber={day}` - Get votes for a specific day
- `POST /api/games/[gameId]/votes` - Add a vote

### Roles
- `GET /api/roles` - Get available roles

## Contributing

This project is part of the Stinkbot monorepo. When contributing:

1. Follow TypeScript best practices
2. Use the established UI component patterns
3. Ensure database operations are properly handled
4. Test with real game scenarios

## Integration with Discord Bot

The frontend works in conjunction with a Discord bot that handles:
- Player signups via Discord
- Channel management
- Real-time game notifications
- Vote collection through Discord interactions

The web interface provides the administrative layer while the Discord bot handles player-facing interactions.
