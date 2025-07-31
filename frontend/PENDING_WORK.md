# Pending Work - Stinkwolf Frontend

## Upcoming Features and Changes

### Real-time Database Integration
- **Supabase Realtime**: Implement Supabase real-time subscriptions to automatically update the frontend when the Discord bot changes game state
- **Auto-refresh Game Data**: Remove manual refresh requirements by listening to database changes
- **Live Player Updates**: Real-time updates when players join/leave games via Discord
- **Phase Synchronization**: Automatically sync game phases when the Discord bot transitions between signup/day/night

### Phase Management
- **Remove Manual Phase Controls**: Phase changes are now handled exclusively by the Discord bot
- **Display-only Phase Information**: Convert phase controls to read-only status indicators
- **Bot-driven Transitions**: All game phase transitions (signup → night → day) managed by Discord bot logic

### Database Synchronization
- **Listen for Game Updates**: Subscribe to changes in the `games` table for status, phase, and day number updates
- **Player Status Sync**: Real-time updates when players are eliminated or revived via Discord commands
- **Vote Tracking**: Live vote updates as players vote through Discord interactions
- **Role Assignment Sync**: Sync role assignments made through the web interface back to the Discord bot

### UI/UX Improvements
- **Real-time Indicators**: Add visual indicators when data is being updated in real-time
- **Connection Status**: Show connection status to Supabase real-time
- **Offline Handling**: Graceful handling when real-time connection is lost

### Technical Implementation
- **Supabase Client Setup**: Configure Supabase client with real-time capabilities
- **WebSocket Connections**: Manage WebSocket connections for real-time updates
- **State Management**: Implement proper state management for real-time data flow
- **Error Handling**: Robust error handling for connection issues and data conflicts

### Bot Integration Points
- **Channel Management**: Display channel information from the database
- **Player Actions**: Show player actions and notes from Discord interactions
- **Game History**: Access to historical game data and statistics
- **Moderator Tools**: Web-based tools that complement Discord bot commands

## Priority Order
1. Remove manual phase change controls (COMPLETED - see removal below)
2. Implement Supabase real-time client
3. Set up database change listeners
4. Update UI to reflect real-time changes
5. Add connection status indicators
6. Test integration with Discord bot

## Notes
- The Discord bot will be the authoritative source for all game state changes
- The web frontend serves as a monitoring and management dashboard
- Real-time updates will ensure moderators always see current game state
- Manual interventions through the web interface should be limited to emergency situations
