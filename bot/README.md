# Werewolf Discord Bot

A Discord bot for managing Werewolf (mafia) games across multiple servers.

## Features

- Game management (signup, voting, day/night cycles)
- Role management and assignments
- Journal system for players
- Archive functionality for game categories
- **Daily member sync for archive purposes**

## Daily Member Sync

The bot includes an automated daily process that syncs all server members to the database for archive purposes. This feature:

- **Runs automatically** every day at 2 AM UTC
- **Stores member data** in the `server_users` table with:
  - `user_id`: Discord user ID
  - `server_id`: Discord server ID  
  - `display_name`: User's display name (nickname or username)
- **Updates existing records** when display names change
- **Skips bot users** to avoid cluttering the database
- **Provides logging** to a designated channel (if configured)

### Manual Sync Command

Moderators can trigger a manual sync using:
```
Wolf.sync_members
```

### Configuration

To enable logging to a Discord channel, set the environment variable:
```
MEMBER_SYNC_LOG_CHANNEL_ID=your_channel_id_here
```

### Database Schema

The member data is stored in the `server_users` table:
```sql
CREATE TABLE server_users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    server_id VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL
);
```

## Installation

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
# This will change the prefix for commands listed below
BOT_PREFIX=Wolf. 

# OpenAI Configuration (optional)
# For AI-powered responses to unknown commands
OPENAI_API_KEY=your_openai_api_key_here

# AWS S3 Configuration (optional)
# For uploading archive files to S3
AWS_ACCESS_KEY_ID=your_aws_access_key_id_here
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key_here
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=your-s3-bucket-name-here
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

| Command | Description |
|---------|-------------|
| `Wolf.in` | Sign up for the current game |
| `Wolf.out` | Remove yourself from the current game |
| `Wolf.vote @user` | Vote for a player (day phase only) |
| `Wolf.retract` | Retract your current vote |
| `Wolf.alive` | Show all players currently alive in the game |
| `Wolf.inlist` | Show all players signed up for the current game (mobile-friendly format) |
| `Wolf.my_journal` | 📔 Find your personal journal channel |
| `Wolf.help` | Show all available commands |

### Moderator Commands (Moderators Only)

| Command | Description |
|---------|-------------|
| `Wolf.setup` | Configure server settings |
| `Wolf.roles` | 🎭 Create all game roles |
| `Wolf.create` | Create a new game |
| `Wolf.start` | Start the game and create channels |
| `Wolf.next` | Move to next phase (day/night) |
| `Wolf.end` | End the current game |
| `Wolf.add_channel <name>` | Create an additional channel in the game category |
| `Wolf.day <message>` | Set custom day transition message |
| `Wolf.night <message>` | Set custom night transition message |
| `Wolf.journal @user` | 📔 Create a personal journal for a player |
| `Wolf.journal_link` | 🔗 Link existing journal channels to players using intelligent matching |
| `Wolf.journal_owner` | 👤 Show who owns the current journal channel (use in journal) |
| `Wolf.journal_unlink` | 🔓 Unlink the current journal from its owner (use in journal) |
| `Wolf.journal_assign @user` | 🎯 Assign the current journal to a specific user (use in journal) |
| `Wolf.role_assign` | 🎭 Randomly assign roles from a provided list to all signed-up players |
| `Wolf.roles_list` | 📋 Display all assigned roles for players in the current game |
| `Wolf.server` | 🖥️ Display detailed server information for logging and debugging |
| `Wolf.ia <YYYY-MM-DD HH:MM>` | 📊 Get message count per player in town square since specified date/time (EST) |
| `Wolf.speed <number>` | ⚡ Start a speed vote with target number of reactions (use "abort" to cancel) |
| `Wolf.recovery` | 🔄 Recovery mode - migrate from manual game management to bot control |
| `Wolf.issues` | 🐛 Display current known issues and bugs |
| `Wolf.archive <category-name>` | 🗄️ Archive all messages from a game category to JSON (with optional S3 upload) |
| `Wolf.refresh` | 🔄 **Reset server** (delete channels, reset roles to Spectator) |

> ⚠️ **Warning**: The `refresh` command will delete ALL text channels except #general, delete ALL categories, reset game counter to 1, end any active games, and reset all members to Spectator role. This action cannot be undone! Use only for testing!

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
- `{prefix}{number}-townsquare` - Main game discussion
- `{prefix}{number}-wolf-chat` - Private wolf communication
- `{prefix}{number}-memos` - Game notes and information
- `{prefix}{number}-results` - Game results and announcements
- `{prefix}{number}-voting-booth` - Voting channel
- `{prefix}{number}-breakdown` - Roles available in the game
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

## 🗄️ Archive System

The archive system allows moderators to save all messages from a game category to a JSON file for permanent storage.

### Archive Command

**Usage:** `Wolf.archive <category-name>`

The archive command will:
1. Find the specified category by name (case-insensitive)
2. Process all text channels in the category (excluding mod-chat channels)
3. Fetch all messages from each channel with complete metadata
4. Generate a timestamped JSON file with all data
5. Upload to S3 (if configured) and/or save locally

### Archive Data Structure

The generated JSON file includes:
- **Category metadata**: name, ID, archive timestamp, archived by user
- **Channel data**: For each channel, includes all messages with:
  - Message content, author, timestamps
  - User display names and usernames
  - Reply references and attachments
  - Embeds and reactions
  - Complete message threading information

### S3 Integration (Optional)

If AWS S3 is configured, archive files are automatically uploaded to your S3 bucket:

**Required Environment Variables:**
```env
AWS_ACCESS_KEY_ID=your_aws_access_key_id_here
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key_here  
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=your-s3-bucket-name-here
```

**S3 Storage Structure:**
- Files are uploaded to: `archives/archive_<category-name>_<timestamp>.json`
- Public URLs are provided in the completion message
- Local backup is always created regardless of S3 configuration

### Archive Features

- **Complete message history**: All messages from category channels
- **Rich metadata**: User info, timestamps, attachments, reactions
- **Rate limiting**: Built-in delays to respect Discord API limits
- **Error handling**: Continues processing even if individual channels fail
- **Progress updates**: Real-time status messages during processing
- **Dual storage**: S3 upload + local backup for redundancy

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
