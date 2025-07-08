# 🐺 Werewolf Discord Bot

A Discord bot designed to manage Werewolf games across multiple servers. This bot helps organize games without enforcing rules, allowing moderators to manage signups, voting, and game phases.

## ✨ Features

- **Multi-server support** - Each server has its own configuration and games
- **Moderator-only controls** - Only users with moderator permissions can manage games
- **Game organization** - Automatic channel creation and management
- **Vote tracking** - Real-time vote counting and display
- **Phase management** - Easy day/night cycle transitions
- **Player management** - Simple signup and removal system

## 🚀 Quick Start

### Prerequisites

- Node.js (v16 or higher)
- PostgreSQL database
- Discord bot token

### Installation

1. **Clone and setup the project:**
   ```bash
   npm install
   ```

2. **Database setup:**
   ```bash
   # Create a PostgreSQL database named 'werewolf_bot'
   # Then run the setup script:
   psql -d werewolf_bot -f database_setup.sql
   
   # Or use the npm script (requires environment setup first):
   npm run db:refresh
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Discord token and database credentials
   ```

4. **Test your setup:**
   ```bash
   npm test
   ```

5. **Start the bot:**
   ```bash
   npm start
   ```

   For development with auto-restart:
   ```bash
   npm run dev
   ```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# Discord Bot Token (required)
DISCORD_TOKEN=your_discord_bot_token_here

# Database Configuration (required)
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=werewolf_bot
PG_USER=your_db_user
PG_PASSWORD=your_db_password

# Bot Configuration (optional)
BOT_PREFIX=Wolf.
```

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token to your `.env` file
5. Enable the following intents:
   - MESSAGE CONTENT INTENT
   - SERVER MEMBERS INTENT
6. Invite the bot to your server with the following permissions:
   - Manage Channels
   - Send Messages
   - Read Message History
   - Embed Links
   - Read Messages/View Channels

## 🎮 Commands

Commands are divided into two categories: **Player Commands** (available to everyone) and **Moderator Commands** (require Manage Channels or Administrator permissions).

### Player Commands (Everyone Can Use)

| Command | Description | Usage |
|---------|-------------|-------|
| `Wolf.in` | Sign up for the current game | `Wolf.in` |
| `Wolf.out` | Remove yourself from the current game | `Wolf.out` |
| `Wolf.vote @user` | Vote for a player (day phase only) | `Wolf.vote @PlayerName` |
| `Wolf.retract` | Retract your current vote | `Wolf.retract` |
| `Wolf.help` | Show all available commands | `Wolf.help` |

### Moderator Commands (Moderators Only)

| Command | Description | Usage |
|---------|-------------|-------|
| `Wolf.setup` | Configure server settings | `Wolf.setup` |
| `Wolf.roles` | 🎭 Create all game roles | `Wolf.roles` |
| `Wolf.create` | Create a new game | `Wolf.create` |
| `Wolf.start` | Start the game and create channels | `Wolf.start` |
| `Wolf.next` | Move to next phase (day/night) | `Wolf.next` |
| `Wolf.end` | End the current game | `Wolf.end` |
| `Wolf.refresh` | 🔄 **Reset server** (delete channels, reset roles to Spectator) | `Wolf.refresh` |

> ⚠️ **Warning**: The `refresh` command will delete ALL text channels except #general, reset all members to Spectator role, and reset the server to game 1. Use only for testing!

## 🎯 Typical Game Flow

1. **Server Setup** (one-time):
   ```
   Wolf.setup
   # Follow prompts to set prefix, starting number, and game name
   
   Wolf.roles
   # Creates all necessary game roles
   ```

2. **Create Game**:
   ```
   Wolf.create
   # Creates signup channel and category
   ```

3. **Player Signups**:
   ```
   Wolf.in   # Players join
   Wolf.out  # Players leave (if needed)
   ```

4. **Start Game**:
   ```
   Wolf.start
   # Creates all game channels, renames signup to dead-chat
   ```

5. **During Game**:
   ```
   Wolf.vote @player    # Players vote (day phase only)
   Wolf.retract         # Players retract votes
   Wolf.next           # Moderator advances phases
   ```

6. **End Game**:
   ```
   Wolf.end
   # Requires confirmation
   ```

## 🎭 Role System

The bot uses a comprehensive role system to manage permissions and access:

### Roles

| Role | Color | Purpose | Permissions |
|------|-------|---------|-------------|
| **Mod** | 🔴 Red | Moderators/Admins | Can see mod-chat, manage channels |
| **Spectator** | ⚪ Gray | Default for new members | Can see and chat in dead-chat only |
| **Signed Up** | 🟡 Yellow | Players who joined the game | Temporary role during signup phase |
| **Alive** | 🟢 Green | Living players | Can see all game channels, cannot see dead-chat |
| **Dead** | ⚫ Black | Eliminated players | Can see all channels, can only chat in dead-chat |

### Role Flow

1. **Setup**: Run `Wolf.roles` to create all roles
2. **Signup**: Players who use `Wolf.in` get **Signed Up** role
3. **Game Start**: All **Signed Up** players become **Alive**
4. **Elimination**: Players manually change from **Alive** to **Dead** (by moderators)
5. **Spectators**: Non-players get **Spectator** role for watching

### Channel Permissions

- **Dead Chat**: Dead + Spectators can see/chat, Alive cannot see
- **Game Channels**: Alive can see/chat, Dead can see but not chat, Spectators cannot see
- **Mod Chat**: Only Mod role can see and chat

## 📁 Channel Structure

When a game is created, the bot generates:

### During Signup Phase
- `{prefix}{number}-signups` - Player signup channel

### During Active Game
- `{prefix}{number}-dead-chat` - Chat for eliminated players (displays **initial player list** when game starts)
- `{prefix}{number}-town-square` - Main game discussion
- `{prefix}{number}-wolf-chat` - Private wolf communication
- `{prefix}{number}-memos` - Game notes and information
- `{prefix}{number}-results` - Game results and announcements
- `{prefix}{number}-voting-booth` - Voting channel
- `{prefix}{number}-breakdown` - Post-game analysis
- `{prefix}{number}-mod-chat` - Private moderator communication

Example with prefix "g" and game number 1:
- `g1-signups` → `g1-dead-chat`
- `g1-town-square`
- `g1-wolf-chat`
- etc.

## 🗳️ Voting System

The voting system provides real-time vote tracking with several built-in protections:

- Players can only vote during day phases
- Votes must be cast in the voting booth channel
- **Players cannot vote for themselves** (self-voting is blocked)
- Vote counts are updated in real-time with **display names** for clarity
- Players can retract and change votes
- Voting results show both vote counts and who voted for whom
- Votes are cleared each new day

Example vote display:
```
Player1 (2)
- Player2
- Player3

Player2 (1)
- Player1
```

## 🔧 Development

### Project Structure
```
werewolf-discord-bot/
├── src/
│   ├── index.js          # Main bot entry point
│   ├── werewolf-bot.js   # Core bot logic
│   └── database.js       # Database connection
├── test/
│   └── test-bot.js       # Test suite
├── database_setup.sql    # Database schema
├── package.json
└── README.md
```

### Testing

Run the test suite to verify your setup:
```bash
npm test
```

The test suite checks:
- Database connectivity
- Database schema integrity
- Discord bot connection

### Available NPM Scripts

```bash
npm start        # Start the bot in production mode
npm run dev      # Start with auto-restart (development)
npm test         # Run the test suite
npm run db:refresh  # Refresh database schema (⚠️ deletes all data!)
```

### Database Management

**Refresh Database Schema:**
```bash
npm run db:refresh
```
⚠️ **Warning**: This completely wipes and recreates all database tables. All game data will be lost!

**Manual Database Setup:**
```bash
psql -h $PG_HOST -p $PG_PORT -U $PG_USER -d $PG_DATABASE -f database_setup.sql
```
- Environment configuration

### Database Schema

The bot uses 4 main tables:
- `server_configs` - Server-specific settings
- `games` - Game instances and metadata
- `players` - Player signups and status
- `votes` - Voting records

## ✨ New Features & Improvements

### Role-Based Permission System
- **`Wolf.roles` command** creates comprehensive role system for game management
- **Automatic role assignment**: Players get appropriate roles during signup and game phases
- **Channel permissions**: Each role has specific access to game channels
- **Roles include**: Mod (admin), Spectator (observers), Signed Up, Alive, Dead
- **Mod-chat channel**: Private communication for moderators in each game

### Display Names
- **Player lists and voting** now show Discord display names instead of usernames for better readability
- Display names are used in signup lists, voting sheets, and player rosters
- System falls back to username if display name is not available

### Anti-Self-Voting
- **Players cannot vote for themselves** - the bot will reject self-votes with a clear error message
- Helps prevent accidental votes and maintains game integrity

### Enhanced Game Start
- **Player list is automatically posted** to the dead chat channel when a game starts
- Provides a reference for all participants at the beginning of the game

### Server Refresh for Testing
- **`Wolf.refresh` command** resets a server for quick iteration
- Deletes all text channels except #general, removes all categories, and cleans database
- **Resets all members to Spectator role** (except bots)
- Requires confirmation to prevent accidental use
- Perfect for testing and development environments

### Database Management
- **Complete database refresh script** - `npm run db:refresh` completely wipes and recreates schema
- Useful for development and testing environments
- ⚠️ **Destroys all existing data** - use with caution!

## 🛠️ Troubleshooting

### Common Issues

**Bot not responding:**
- Check if bot token is correct
- Verify bot has necessary permissions
- Ensure bot is online in Discord

**Database errors:**
- Verify PostgreSQL is running
- Check database credentials in `.env`
- Ensure `database_setup.sql` was executed

**Permission errors:**
- Ensure users have Manage Channels or Administrator permissions
- Check bot permissions in Discord server

**Channel creation fails:**
- Verify bot has Manage Channels permission
- Check if Discord server has channel limit

### Debug Mode

For detailed logging during development:
```bash
NODE_ENV=development npm run dev
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

If you encounter issues:
1. Run `npm test` to verify your setup
2. Check the troubleshooting section
3. Review Discord bot permissions
4. Verify database configuration

For additional help, please create an issue with:
- Error messages
- Steps to reproduce
- Your environment details
