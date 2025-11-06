# Archives Search System - Technical Documentation

## Overview

The archives search system allows users to search through Discord messages stored in OpenSearch. It provides full-text search, filtering by game/channel/user, pagination, and a "jump to message" feature for navigating to specific messages (like reply threads).

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
│  - Build OpenSearch query               │
│  - Execute search                       │
│  - Calculate pagination (if jumping)    │
│  - Enrich with user data from Postgres  │
└──────┬──────────────────────────────────┘
       │
       ├─────────────┬─────────────┐
       │             │             │
┌──────▼────┐  ┌─────▼─────┐  ┌───▼────────┐
│ OpenSearch│  │ Postgres  │  │ OpenSearch │
│  (search) │  │ (users)   │  │  (count)   │
└───────────┘  └───────────┘  └────────────┘
```

## Core Components

### 1. Frontend (`frontend/app/archives/page.tsx`)

The React component that provides the user interface for searching messages.

**Key Features:**
- Search filters (query, game, channel, user)
- Pagination controls
- "Jump to Message" functionality for navigating to replies
- Reply preview fetching
- Auto-scroll to target messages

**State Management:**
```typescript
filters: {
  query: string,      // Full-text search
  game: string,       // Category filter
  channel: string,    // Channel name filter
  user: string,       // Display name filter
  page: number        // Current page
}
```

### 2. Backend API (`frontend/app/api/archives/search/route.ts`)

The Next.js API route that handles search requests and interacts with OpenSearch.

## How Search Works

### Step 1: Request Parameters

The API accepts these query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Full-text search across content, username, displayName |
| `game` | string | Filter by game category |
| `channel` | string | Filter by channel name |
| `user` | string | Filter by user display name |
| `page` | number | Page number (1-indexed) |
| `size` | number | Results per page (default: 20) |
| `jumpToMessageId` | string | Discord message ID to jump to |

### Step 2: Building the OpenSearch Query

The API constructs a boolean query with multiple "must" clauses:

```javascript
const must = []

// Full-text search (if provided)
if (query) {
  must.push({
    multi_match: {
      query,
      fields: ['content', 'username', 'displayName'],
      type: 'best_fields',
      fuzziness: 'AUTO'  // Allows typos
    }
  })
}

// Filter by game category
if (game) {
  must.push({ term: { category: game } })
}

// Filter by channel name
if (channel) {
  must.push({ term: { channelName: channel } })
}

// Filter by user
if (user) {
  // Look up user IDs from Postgres first
  const serverUsers = await db.getServerUsersByDisplayName(user)
  must.push({ terms: { userId: userIds } })
}
```

### Step 3: Sort Order

Sort order depends on whether we're jumping to a specific message:

- **Normal browsing**: `desc` (newest messages first)
- **Jump to message**: `asc` (oldest messages first, for chronological reading)

```javascript
const sortOrder = jumpToMessageId ? 'asc' : 'desc'
```

### Step 4: Execute Main Search

```javascript
const searchBody = {
  query: { bool: { must } },
  sort: [{ timestamp: { order: sortOrder } }],
  from: (page - 1) * size,
  size: size,
  aggs: {
    games: { terms: { field: 'category', size: 100 } },
    channels: { terms: { field: 'channelName', size: 100 } },
    users: { terms: { field: 'displayName.keyword', size: 100 } }
  }
}

const response = await openSearchClient.search({
  index: 'messages',
  body: searchBody
})
```

### Step 5: Jump to Message Calculation (Optional)

If `jumpToMessageId` is provided, the API calculates which page the message is on:

#### 5a. Find the Target Message

```javascript
const targetSearchResponse = await openSearchClient.search({
  index: 'messages',
  body: {
    query: { term: { messageId: jumpToMessageId } },
    size: 1
  }
})

const targetTimestamp = targetMessage._source.timestamp
```

#### 5b. Count Messages Before Target

The key is to count messages that come **before** the target in the current sort order:

```javascript
// For ASC (chronological): count messages with timestamp < target
// For DESC (newest first): count messages with timestamp > target
const countQuery = {
  query: {
    bool: {
      must: [
        ...must,  // Apply same filters
        { 
          range: { 
            timestamp: sortOrder === 'asc' 
              ? { lt: targetTimestamp }  // Less than for ascending
              : { gt: targetTimestamp }  // Greater than for descending
          } 
        }
      ]
    }
  }
}

const countResponse = await openSearchClient.search({
  index: 'messages',
  body: countQuery
})

const messagesBeforeTarget = countResponse.body.hits.total.value
```

#### 5c. Calculate Page Number

```javascript
targetPage = Math.floor(messagesBeforeTarget / size) + 1
```

**Example:**
- 45 messages before target
- Page size = 20
- Calculation: `Math.floor(45 / 20) + 1 = 3`
- Target is on page 3

### Step 6: Enrich Results with User Data

Messages are indexed with user IDs, but user display names and profile pictures can change. The API fetches current user data from Postgres:

```javascript
const userIds = [...new Set(hits.map(hit => hit._source.userId))]
const serverUsers = await db.getServerUsersByUserIds(userIds)

// Update display names and profile pictures
hits.forEach(hit => {
  const userInfo = userMap.get(hit._source.userId)
  if (userInfo) {
    hit._source.displayName = userInfo.displayName
    hit._source.profilePictureLink = userInfo.profilePictureLink
  }
})
```

### Step 7: Return Response

```javascript
return NextResponse.json({
  hits: response.body.hits,
  aggregations: response.body.aggregations,
  targetPage: jumpToMessageId ? targetPage : null
})
```

## Frontend Flow: Jump to Message

### Scenario: User clicks "Jump to Original" on a reply

```javascript
handleViewOriginal(message)
  ↓
handleJumpToMessage(message)
  ↓
┌────────────────────────────────────┐
│ Check if filters need to change    │
│ - Current channel vs target channel│
│ - Current filters vs clean state   │
└─────────────┬──────────────────────┘
              │
     ┌────────┴─────────┐
     │                  │
  YES│               NO │
     │                  │
     ▼                  ▼
┌─────────────┐   ┌──────────────┐
│ Make API    │   │ Just scroll  │
│ request with│   │ to message   │
│ jumpToMsgId │   │ in current   │
│             │   │ results      │
└──────┬──────┘   └──────────────┘
       │
       ▼
┌──────────────────────┐
│ API calculates page  │
│ where message exists │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Update filters with  │
│ calculated page      │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ useEffect triggers   │
│ new search request   │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Results load with    │
│ target message       │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Auto-scroll to msg   │
│ Add highlight ring   │
└──────────────────────┘
```

## Key Design Decisions

### 1. Why Two Different Sort Orders?

- **DESC (normal)**: Users expect to see newest messages first when browsing
- **ASC (jumping)**: When jumping to a message (like a reply), chronological order makes more sense for reading context

### 2. Why Calculate Page Server-Side?

The server has the full dataset and can efficiently count messages. Doing this client-side would require fetching all messages.

### 3. Why Use Discord Message ID Instead of OpenSearch ID?

- Discord message IDs are stable and consistent
- OpenSearch document IDs (_id) are internal to OpenSearch
- Reply relationships use Discord message IDs

### 4. Why Enrich with Database User Data?

- User display names and avatars change over time
- Messages are indexed at send-time with the display name at that moment
- Showing current display names provides better UX

## Message Schema in OpenSearch

```json
{
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
  "attachments": [],
  "embeds": [],
  "reactions": []
}
```

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

1. **Indexing**: All searchable fields are indexed in OpenSearch for fast querying
2. **Aggregations**: Run alongside the main query to populate filter dropdowns
3. **Pagination**: Only fetches the current page of results, not all matches
4. **User enrichment**: Batches user lookups to minimize database queries
5. **Caching**: Browser caches results; navigating back/forward reuses cached data

## Error Handling

- **Message not found**: Returns page 1 as fallback
- **OpenSearch connection error**: Returns 500 with error message
- **Invalid parameters**: Ignored (default values used)
- **Missing reply messages**: Frontend shows "Original message not found"

## Future Improvements

1. **Caching**: Add Redis caching for frequently accessed pages
2. **Highlighting**: Show search term matches highlighted in results
3. **Date filters**: Add ability to filter by date range
4. **Export**: Allow exporting search results
5. **Advanced search**: Boolean operators, exact phrases, regex
6. **Search within results**: Narrow down results without losing context

