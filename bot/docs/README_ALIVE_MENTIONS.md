# Alive Role Mention Detection System

## Overview

This system automatically detects and penalizes excessive mentions of the "Alive" role in Discord servers. It's designed to prevent spam and abuse while maintaining a fair gaming environment.

## Quick Start

### 1. Installation

The system is already integrated into your bot. Just install dependencies:

```bash
npm install
```

### 2. Testing

Test the SQLite database:
```bash
npm run test:sqlite
```

Test the full system (requires Discord token):
```bash
npm run test:alive-mentions
```

### 3. Running

Start the bot normally:
```bash
npm start
```

The system will automatically:
- Create the SQLite database
- Detect "Alive" roles in all servers
- Start monitoring messages
- Apply penalties as needed

## How It Works

### Detection
- Monitors all messages for mentions of the "Alive" role
- Supports both role mentions (`@Alive`) and role ID mentions (`<@&roleId>`)
- Tracks mentions per user per server

### Penalty System
| Mentions in 1 Hour | Action | Duration |
|-------------------|--------|----------|
| 2 | Warning | - |
| 3 | Timeout | 1 minute |
| 4 | Timeout | 5 minutes |
| 5 | Timeout | 20 minutes |
| 6 | Timeout | 1 hour |
| 7 | Timeout | 2 hours |
| 8 | Timeout | 4 hours |
| 9 | Timeout | 8 hours |
| 10+ | Timeout | 24 hours |

### Database
- Uses SQLite for lightweight, local storage
- Database file: `data/alive_mentions.db`
- Automatic cleanup every 30 minutes
- Records older than 1 hour are automatically removed

## Commands

### Available Scripts

```bash
# Test SQLite functionality
npm run test:sqlite

# Test full system (requires Discord token)
npm run test:alive-mentions

# View current status and statistics
npm run alive-status

# Start the bot
npm start

# Development mode with auto-restart
npm run dev
```

### Status Report

Run `npm run alive-status` to see:
- Recent mentions in the last 24 hours
- User violation counts
- Database statistics
- Cleanup status

## Configuration

### Environment Variables

No additional configuration required. The system uses:
- `DISCORD_TOKEN` - Your bot token
- `BOT_PREFIX` - Bot command prefix (default: "Wolf.")

### Permissions Required

The bot needs these permissions:
- `Send Messages` - To send warnings
- `Timeout Members` - To apply timeouts
- `Read Message History` - To monitor messages
- `Use External Emojis` - For embed messages

## Monitoring

### Console Logs

Watch for these log messages:
```
✅ SQLite database connected
✅ alive_mentions table ready
✅ Found Alive role for [Server]: [RoleID]
📢 User [username] mentioned alive role (count: X)
⚠️ Alive Role Mention Warning
🔇 Timed out user [username] for X minutes
🧹 Cleaned up old alive mention records
```

### Status Monitoring

Regular status checks:
```bash
npm run alive-status
```

## Troubleshooting

### Common Issues

1. **"No Alive role found"**
   - Ensure your server has a role named exactly "Alive"
   - Check bot permissions to see roles

2. **"Timeout Failed"**
   - Bot needs "Timeout Members" permission
   - User might be above bot in role hierarchy

3. **Database errors**
   - Check `data/` directory permissions
   - Ensure disk space is available

### Debug Mode

For detailed logging, set environment variable:
```bash
DEBUG=alive-mentions npm start
```

## Docker Deployment

The system works seamlessly with Docker:

```dockerfile
# Already included in Dockerfile
RUN apk add --no-cache sqlite
RUN mkdir -p /usr/src/app/data
```

### Docker Commands

```bash
# Build image
docker build -t werewolf-bot .

# Run container
docker run -d \
  --name werewolf-bot \
  -e DISCORD_TOKEN=your_token \
  -v ./data:/usr/src/app/data \
  werewolf-bot
```

## Security

### Data Privacy
- Only stores user IDs, server IDs, and timestamps
- No message content or personal data
- Local SQLite database (not shared)

### Rate Limiting
- Respects Discord's rate limits
- Automatic cleanup prevents database bloat
- Graceful error handling

### Audit Trail
- All timeouts include descriptive reasons
- Logs all actions for moderation review
- Database records for compliance

## Maintenance

### Database Cleanup
- Automatic: Every 30 minutes
- Manual: `npm run alive-status` shows cleanup status
- Records older than 1 hour are automatically removed

### Backup
- SQLite database: `data/alive_mentions.db`
- Backup before major updates
- Database is self-contained and portable

### Updates
- System updates automatically with bot restarts
- No manual migration required
- Backward compatible with existing data

## Support

### Getting Help
1. Check console logs for error messages
2. Run `npm run alive-status` for system health
3. Verify bot permissions in Discord
4. Test with `npm run test:sqlite`

### Reporting Issues
Include:
- Error messages from console
- Output from `npm run alive-status`
- Steps to reproduce
- Server configuration details

## Development

### Adding Features
- Modify `alive-mention-detector.js` for detection logic
- Update `sqlite-manager.js` for database changes
- Test with `npm run test:sqlite`

### Customization
- Penalty levels: Edit `penaltyLevels` in `AliveMentionDetector`
- Cleanup frequency: Modify cron schedule in `setupCleanupTask()`
- Warning messages: Customize embeds in `sendWarning()` and `applyTimeout()`
