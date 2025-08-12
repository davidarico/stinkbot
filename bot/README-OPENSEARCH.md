# OpenSearch Integration for Discord Message Archiving

This document describes the OpenSearch integration for archiving Discord messages from channel categories.

## Overview

The bot now supports archiving Discord messages directly to OpenSearch instead of saving large JSON files locally. This provides:

- **Searchable archives**: Full-text search across all archived messages
- **Scalable storage**: No local file size limitations
- **Structured data**: Optimized schema for efficient querying
- **Real-time indexing**: Messages are indexed as they're archived

## Setup

### 1. Environment Variables

Add the following environment variables to your `.env` file:

#### For AWS OpenSearch:
```bash
# AWS credentials
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1

# OpenSearch domain endpoint (get this from AWS OpenSearch Service)
OPENSEARCH_DOMAIN_ENDPOINT=https://your-domain.region.es.amazonaws.com

# Optional: S3 bucket for archive summaries
AWS_S3_BUCKET_NAME=your-archive-bucket
```

#### For Local OpenSearch Container:
```bash
# Local OpenSearch endpoint (no AWS credentials needed)
OPENSEARCH_DOMAIN_ENDPOINT=http://localhost:9200

# Optional: Basic authentication if your local instance requires it
# OPENSEARCH_USERNAME=admin
# OPENSEARCH_PASSWORD=admin
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up OpenSearch Domain

#### For AWS OpenSearch:
Run the setup script to create the index and verify connectivity:

```bash
npm run setup-opensearch
```

#### For Local OpenSearch Container:
1. **Start your local OpenSearch container** (example with Docker):
   ```bash
   docker run -d \
     --name opensearch \
     -p 9200:9200 \
     -p 9600:9600 \
     -e "discovery.type=single-node" \
     -e "OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m" \
     opensearchproject/opensearch:latest
   ```

2. **Wait for the container to start** (usually 30-60 seconds):
   ```bash
   curl http://localhost:9200
   ```

3. **Run the setup script**:
   ```bash
   npm run setup-opensearch
   ```

The setup script will:
- Create the `messages` index with optimized mapping
- Configure analyzers for better text search
- Test the connection and indexing
- Create a sample document

## Usage

### Archiving Channels

Use the existing archive command:

```
Wolf.archive <category-name>
```

The bot will now:
1. Fetch all messages from channels in the specified category
2. Index each message individually to OpenSearch
3. Skip bot messages automatically
4. Create a summary file in S3 (if configured)
5. Provide detailed statistics on the archiving process

### Searching Archived Messages

Use the search utility script:

```bash
# Basic search
npm run search-messages "werewolf game"

# Search with filters
npm run search-messages "vote" --channel general --size 10

# Search by user
npm run search-messages "role" --username alice --start-date 2024-01-01

# Search for messages with attachments
npm run search-messages "image" --has-attachments

# Search replies only
npm run search-messages "response" --is-reply
```

### Search Options

- `--channel <name>`: Filter by channel name
- `--username <name>`: Filter by username
- `--category <name>`: Filter by category name
- `--start-date <date>`: Filter by start date (ISO format)
- `--end-date <date>`: Filter by end date (ISO format)
- `--has-attachments`: Filter for messages with attachments
- `--has-embeds`: Filter for messages with embeds
- `--is-reply`: Filter for reply messages
- `--size <number>`: Number of results (default: 20)
- `--from <number>`: Starting offset (default: 0)

## Data Structure

Each message is indexed with the following structure:

```json
{
  "messageId": "discord_message_id",
  "content": "message content",
  "userId": "discord_user_id",
  "username": "username",
  "displayName": "display name",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "channelId": "discord_channel_id",
  "channelName": "channel-name",
  "categoryId": "discord_category_id",
  "categoryName": "category-name",
  "replyToMessageId": "parent_message_id_or_null",
  "attachments": [
    {
      "id": "attachment_id",
      "name": "filename.jpg",
      "url": "https://cdn.discordapp.com/...",
      "size": 12345
    }
  ],
  "embeds": [
    {
      "title": "embed title",
      "description": "embed description",
      "url": "https://example.com"
    }
  ],
  "reactions": [
    {
      "emoji": "👍",
      "count": 5
    }
  ],
  "archivedAt": "2024-01-01T12:00:00.000Z",
  "archivedBy": {
    "userId": "archiver_user_id",
    "username": "archiver_username",
    "displayName": "Archiver Display Name"
  },
  "contentLength": 150,
  "hasAttachments": true,
  "hasEmbeds": false,
  "hasReactions": true,
  "isReply": false
}
```

## Search Features

### Full-Text Search
- Searches across message content, usernames, and display names
- Fuzzy matching for typos and variations
- Highlighted search results

### Filtering
- Filter by channel, user, category, or date range
- Filter by message type (attachments, embeds, replies)
- Boolean filters for message properties

### Sorting
- Results are sorted by timestamp (newest first)
- Relevance scoring for search queries

## Performance Considerations

### Indexing
- Messages are indexed in batches of 100 for efficiency
- Rate limiting prevents overwhelming the OpenSearch cluster
- Bulk indexing reduces network overhead

### Search
- Index is optimized for common search patterns
- Analyzers improve text search quality
- Pagination supports large result sets

## Monitoring

### Archive Process
- Real-time progress updates in Discord
- Detailed statistics on indexed vs failed messages
- Error reporting for failed channels or batches

### Search Performance
- Query execution time logging
- Result count and relevance scoring
- Error handling for search failures

## Troubleshooting

### Common Issues

1. **Connection Errors**
   - Verify AWS credentials are correct
   - Check OpenSearch domain endpoint
   - Ensure domain is accessible from your network

2. **Indexing Errors**
   - Check OpenSearch cluster health
   - Verify index mapping is correct
   - Monitor cluster resource usage

3. **Search Errors**
   - Validate search query syntax
   - Check filter parameter values
   - Ensure index exists and is accessible

### Debug Commands

```bash
# Test OpenSearch connection
npm run setup-opensearch

# Check index health
curl -X GET "https://your-domain.region.es.amazonaws.com/_cat/indices?v"

# View index mapping
curl -X GET "https://your-domain.region.es.amazonaws.com/messages/_mapping"
```

## Migration from Local Files

If you have existing local archive files, you can create a migration script to index them to OpenSearch. The data structure is compatible with the new format.

## Security

- AWS IAM credentials are used for authentication
- OpenSearch domain should be configured with appropriate access policies
- Consider using VPC endpoints for enhanced security
- Regular credential rotation is recommended
