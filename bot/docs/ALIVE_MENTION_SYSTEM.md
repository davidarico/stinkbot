# Alive Role Mention Detection System

## Overview

This system automatically detects and penalizes excessive mentions of the "Alive" role in Discord servers, with special exemptions for moderators.

## Key Features

- **Automatic Detection**: Monitors all messages for mentions of the "Alive" role
- **Progressive Penalties**: Escalating timeouts based on violation frequency
- **Moderator Exemption**: Users with the "Mod" role are completely exempt
- **SQLite Storage**: Lightweight local database for tracking mentions
- **Automatic Cleanup**: Removes old records to maintain performance
- **Docker Ready**: Works seamlessly in containerized environments

## Penalty System

| Mentions in 1 Hour | Action | Duration |
|-------------------|--------|----------|
| 2 | Warning | - |
| 3 | Timeout | 5 minutes |
| 4 | Timeout | 20 minutes |
| 5 | Timeout | 1 hour |
| 6 | Timeout | 2 hours |
| 7 | Timeout | 4 hours |
| 8 | Timeout | 8 hours |
| 9+ | Timeout | 24 hours |

## Moderator Exemption

**Users with the "Mod" role are completely exempt from all penalties.** They can mention the "Alive" role as many times as they want without any restrictions.

## How It Works

1. **Initialization**: When the bot starts, it scans all servers for "Alive" and "Mod" roles
2. **Message Monitoring**: Every message is checked for mentions of the "Alive" role
3. **Mod Check**: If the user has the "Mod" role, their message is ignored
4. **Tracking**: Non-mod mentions are recorded in a SQLite database
5. **Penalty Application**: When thresholds are exceeded, warnings or timeouts are applied
6. **Cleanup**: Old records (older than 1 hour) are automatically removed every 30 minutes

## Database Schema

The system uses a local SQLite database (`data/alive_mentions.db`) with the following table:

```sql
CREATE TABLE alive_mentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    server_id TEXT NOT NULL,
    mentioned_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Installation

### Dependencies

The system requires the `sqlite3` package, which is already included in `package.json`.

### Docker

The Dockerfile has been updated to include SQLite support. The system will work automatically when the container starts.

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the bot:
   ```bash
   npm start
   ```

3. Test the system:
   ```bash
   npm run test:alive-mentions
   ```

## Commands

### Available Scripts

```bash
# Test SQLite functionality
npm run test:sqlite

# Test full system (requires Discord token)
npm run test:alive-mentions

# Test mod role detection
npm run test:mod-detection

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
- Role detection status (Alive and Mod roles)
- Cleanup status

## Configuration

### Environment Variables

No additional configuration required. The system uses:
- `DISCORD_TOKEN` - Your bot token
- `BOT_PREFIX` - Bot command prefix (default: "Wolf.")

### Required Roles

The system looks for these roles in each server:
- **"Alive"** - The role that triggers detection when mentioned
- **"Mod"** - Users with this role are exempt from all penalties

### Permissions Required

The bot needs these permissions:
- `Send Messages` - To send warnings
- `Timeout Members` - To apply timeouts
- `Read Message History` - To monitor messages
- `Use External Emojis` - For embed messages
- `Manage Roles` - To see role information

## Monitoring

### Console Logs

Watch for these log messages:
```
✅ SQLite database connected
✅ alive_mentions table ready
✅ Found Alive role for [Server]: [RoleID]
✅ Found Mod role for [Server]: [RoleID]
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

2. **"No Mod role found"**
   - Ensure your server has a role named exactly "Mod"
   - Without a Mod role, all users are subject to penalties

3. **"Timeout Failed"**
   - Bot needs "Timeout Members" permission
   - User might be above bot in role hierarchy

4. **Database errors**
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

### Moderator Privileges
- Mods are completely exempt from penalties
- No tracking of mod mentions
- Mods can mention alive role unlimited times

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
5. Check role detection with `npm run test:mod-detection`

### Reporting Issues
Include:
- Error messages from console
- Output from `npm run alive-status`
- Steps to reproduce
- Server configuration details
- Role setup information

## Development

### Adding Features
- Modify `alive-mention-detector.js` for detection logic
- Update `sqlite-manager.js` for database changes
- Test with `npm run test:sqlite`

### Customization
- Penalty levels: Edit `penaltyLevels` in `AliveMentionDetector`
- Cleanup frequency: Modify cron schedule in `setupCleanupTask()`
- Warning messages: Customize embeds in `sendWarning()` and `applyTimeout()`
- Role names: Change "Alive" and "Mod" role detection logic

## Examples

### Warning Message
```
⚠️ Alive Role Mention Warning
You have mentioned the alive role 2 times in the last hour. 
Please be mindful of excessive pinging.
Next violation will result in a 5-minute timeout.
```

### Timeout Message
```
🔇 Timeout Applied
You have been timed out for 5 minutes due to excessive 
alive role mentions (3 times in the last hour).
After this timeout, you cannot mention alive for another hour.
```

### Mod Exemption
Moderators can send messages like:
- "@Alive wake up everyone!"
- "@Alive game is starting!"
- "@Alive please check in!"

Without any penalties or warnings.
