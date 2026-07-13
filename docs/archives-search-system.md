# Archives Search System - Technical Documentation

## Overview

The archives search system allows users to search through Discord messages stored in Postgres (the `archive_messages` table). It provides full-text search, filtering by game/channel/user, pagination, inline reply previews, and a "jump to message" feature for navigating to specific messages (like reply threads).

> Historical note: this system originally ran on OpenSearch. It was migrated to Postgres full-text search, and the OpenSearch client, indexing scripts, and response shapes have been removed.

## Architecture

```
┌─────────────┐
│   Browser   │
│  (React)    │
└──────┬──────┘
       │
       │ HTTP Request
       │
┌──────▼──────────────────────────────────┐
│  Next.js API Route                      │
│  /api/archives/search/route.ts          │
│                                         │
│  - Parse query parameters               │
│  - Delegate to db.searchArchiveMessages │
│  - Calculate target page (if jumping)   │
│  - Enrich with current user data        │
└──────┬──────────────────────────────────┘
       │
┌──────▼──────────────────────────────────┐
│  Postgres                               │
│  - archive_messages (search + count)    │
│  - server_users (display name/avatar)   │
└─────────────────────────────────────────┘
```

## Core Components

### 1. Frontend (`frontend/app/archives/page.tsx`)

The React component that provides the user interface for searching messages.

**Key Features:**
- Search filters (query, game, channel, user)
- Debounced free-text input (300 ms) so a search fires per pause, not per keystroke
- Pagination controls
- "Jump to Message" functionality for navigating to replies
- Reply previews rendered from data already included in search results
- Auto-scroll to target messages

**State Management:**
```typescript
filters: {
  query: string,      // Full-text search (debounced from the input field)
  game: string,       // Category filter
  channel: string,    // Channel name filter
  user: string,       // Display name filter
  page: number        // Current page
}
```

### 2. Backend API (`frontend/app/api/archives/search/route.ts`)

Thin Next.js API route. All query construction lives in `db.searchArchiveMessages` (`frontend/lib/database.ts`).

### 3. Supporting routes

| Route | Purpose |
|-------|---------|
| `/api/archives/aggregations` | Filter dropdown options (games, channels, users with counts). Loaded once on page mount. |
| `/api/archives/message/[messageId]` | Fetch a single message by Discord message ID (used when jumping to a reply parent that isn't on the current page). |
| `/api/archives/context` | Messages within ±5 minutes of a timestamp in a channel. |
| `/api/archives/health` | Connectivity check and total message count. |

## How Search Works

### Step 1: Request Parameters

The API accepts these query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Full-text search across message content |
| `game` | string | Filter by game category |
| `channel` | string | Filter by channel name |
| `user` | string | Filter by user display name |
| `page` | number | Page number (1-indexed) |
| `size` | number | Results per page (default: 20) |
| `jumpToMessageId` | string | Discord message ID to jump to |

### Step 2: Building the SQL Query

`searchArchiveMessages` builds a WHERE clause from the provided filters:

```sql
-- Full-text search uses the GIN index defined in the migration
to_tsvector('english', coalesce(m.content, '')) @@ plainto_tsquery('english', $1)

-- Game / channel are simple equality filters
m.category = $2
m.channel_name = $3

-- User filter resolves display name -> user IDs via server_users first,
-- falling back to the display name archived on the message
m.user_id = ANY($4)
```

The data query LEFT JOINs each message's reply parent so reply previews arrive with the page - no follow-up requests:

```sql
SELECT m.*,
       r.message_id   AS reply_message_id,
       r.content      AS reply_content,
       r.username     AS reply_username,
       r.display_name AS reply_display_name,
       r.user_id      AS reply_user_id
FROM archive_messages m
LEFT JOIN archive_messages r ON r.message_id = m.reply_to_message_id
WHERE ...
ORDER BY m.timestamp DESC
LIMIT $n OFFSET $n+1
```

The count query and the data query run in parallel.

### Step 3: Jump to Message Calculation (Optional)

If `jumpToMessageId` is provided, the API counts how many messages sort before the target under the same filters, then derives the page:

```sql
SELECT count(*) FROM archive_messages m
WHERE <same filters>
  AND m.timestamp > (SELECT timestamp FROM archive_messages WHERE message_id = $n)
```

```javascript
targetPage = Math.floor(messagesBeforeTarget / size) + 1
```

**Example:**
- 45 messages before target
- Page size = 20
- Calculation: `Math.floor(45 / 20) + 1 = 3`
- Target is on page 3

### Step 4: Enrich Results with User Data

Messages are archived with the display name at send time, but names and avatars change. The route batches one `server_users` lookup covering both message authors and reply-preview authors, then overwrites `displayName` / `profilePictureLink` with current values.

### Step 5: Response Shape

```json
{
  "messages": [
    {
      "id": "123",
      "messageId": "1378164866073886761",
      "content": "Message text content",
      "userId": "123456789",
      "username": "user123",
      "displayName": "Cool User",
      "profilePictureLink": "https://cdn.discord.com/avatars/...",
      "timestamp": "2025-05-31T00:15:09.137Z",
      "channelId": "987654321",
      "channelName": "deadchat",
      "category": "Game 42",
      "categoryId": "111111111",
      "replyToMessageId": "1373823440389279774",
      "replyPreview": {
        "content": "First 100 chars of the parent message…",
        "userId": "987654321",
        "displayName": "Parent Author"
      },
      "attachments": [],
      "embeds": [],
      "reactions": []
    }
  ],
  "total": 1234,
  "targetPage": null
}
```

`replyPreview` is only present on messages that are replies. If the parent message was never archived, it contains `"[Original message not found]"`.

## Frontend Flow: Jump to Message

### Scenario: User clicks "Jump to Original" on a reply

1. If the target message is already in the current results, scroll to it and flash a highlight ring.
2. Otherwise, fetch the parent via `/api/archives/message/[messageId]`, then re-search its channel with `jumpToMessageId` set.
3. The API returns `targetPage`; the frontend sets filters to that channel/page, which triggers the search effect and renders the page containing the target.

## Key Design Decisions

### 1. Why Postgres instead of OpenSearch?

The archive already lives in Postgres, and `to_tsvector`/`plainto_tsquery` with a GIN index covers the search needs at this scale. Removing OpenSearch eliminates a service dependency, an indexing pipeline, and a second copy of the data.

### 2. Why join reply previews into the search query?

Previously the frontend fetched each reply's parent one request at a time (up to 20 sequential round trips per page). A self-join returns the preview in the same query at negligible cost.

### 3. Why Calculate Page Server-Side?

The server has the full dataset and can efficiently count messages. Doing this client-side would require fetching all messages.

### 4. Why Use Discord Message ID Instead of Row ID?

- Discord message IDs are stable and consistent
- Reply relationships use Discord message IDs

### 5. Why Enrich with Current User Data?

- User display names and avatars change over time
- Messages are archived at send-time with the display name at that moment
- Showing current display names provides better UX

## Indexes (`database/migrations/20260316T000000_add_archive_messages_table.sql`)

- `gin(to_tsvector('english', coalesce(content, '')))` - full-text search
- `category`, `channel_name`, `user_id` - filter columns
- `timestamp DESC` - sort order
- `(channel_id, timestamp)` - context window queries

## Common Queries

### Get all messages in a channel (newest first)

```
GET /api/archives/search?channel=general&page=1&size=20
```

### Search for text across all channels

```
GET /api/archives/search?query=hello+world&page=1&size=20
```

### Get messages from a specific user in a game

```
GET /api/archives/search?user=JohnDoe&game=Game+42&page=1&size=20
```

### Jump to a specific message

```
GET /api/archives/search?channel=general&jumpToMessageId=1378164866073886761
```

This returns `targetPage` in the response, which the frontend uses to navigate.

## Performance Considerations

1. **Debounce**: The query input waits 300 ms after the last keystroke before searching
2. **Parallel queries**: Count and data page run concurrently
3. **Reply previews**: Included via self-join, not per-message requests
4. **Aggregations**: Computed only by `/api/archives/aggregations` on page load, not on every search
5. **User enrichment**: One batched `server_users` lookup per search

## Error Handling

- **Message not found**: Returns page 1 as fallback
- **Database error**: Returns 500 with error message
- **Invalid parameters**: Ignored (default values used)
- **Missing reply parents**: `replyPreview.content` is `"[Original message not found]"`

## Future Improvements

1. **URL state**: Reflect filters/page in the URL for shareable searches and back-button support
2. **Highlighting**: Show search term matches highlighted in results (`ts_headline`)
3. **Date filters**: Add ability to filter by date range
4. **Keyset pagination**: Replace OFFSET if the archive grows large enough for deep pages to slow down
5. **Advanced search**: Boolean operators, exact phrases (`websearch_to_tsquery`)
