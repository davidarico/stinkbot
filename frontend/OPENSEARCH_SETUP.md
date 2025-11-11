# OpenSearch Setup for Frontend

## Problem
Getting `ResponseError` from OpenSearch endpoints:
- `/api/archives/aggregations` 
- `/api/archives/search`

## Root Cause
The frontend Next.js app needs environment variables to connect to OpenSearch, but they may be missing or incorrect in the frontend's `.env.local` file.

## Solution

### 1. Create Frontend Environment File

Create `/home/david/git/stinkbot/frontend/.env.local` with:

```env
# OpenSearch Configuration (copy from root .env)
OPENSEARCH_DOMAIN_ENDPOINT=http://localhost:9200
OS_BASIC_USER=user1
OS_BASIC_PASS=your_password_here

# Database (required)
DATABASE_URL=postgresql://user:password@localhost:5432/werewolf_bot
```

### 2. Verify OpenSearch is Running

Check if OpenSearch is accessible:
```bash
curl -u user1:password http://localhost:9200
```

Should return cluster info JSON.

### 3. Verify Messages Index Exists

From the bot directory:
```bash
cd /home/david/git/stinkbot/bot
npm run test-opensearch
```

Should show "✅ Messages index exists"

If not, create it:
```bash
npm run setup-opensearch
```

### 4. Restart Frontend Dev Server

After adding `.env.local`, restart:
```bash
cd /home/david/git/stinkbot/frontend
npm run dev
```

### 5. Test the Connection

Visit the health check endpoint:
```
http://localhost:3000/api/archives/health
```

Should return:
```json
{
  "status": "healthy",
  "opensearch": {
    "connected": true,
    "version": "...",
    "cluster_name": "..."
  },
  "index": {
    "exists": true,
    "name": "messages"
  }
}
```

## Troubleshooting

### Error: "Failed to get aggregations"

**Check:**
1. Is OpenSearch running? `curl http://localhost:9200`
2. Are credentials correct in `.env.local`?
3. Does `messages` index exist? (run `npm run test-opensearch` in bot/)

### Error: "Connection refused"

**Check:**
1. OpenSearch endpoint in `.env.local` matches actual running instance
2. For local: `http://localhost:9200` (not `https`)
3. For AWS: Use full HTTPS URL

### Error: "Authentication failed"

**Check:**
1. `OS_BASIC_USER` and `OS_BASIC_PASS` match OpenSearch credentials
2. Password is plain text (not hashed)
3. User has permissions on OpenSearch cluster

### Index doesn't exist

**Fix:**
```bash
cd /home/david/git/stinkbot/bot
npm run setup-opensearch
```

## Architecture

```
Frontend (Next.js)
  ↓ reads .env.local
lib/opensearch.ts
  ↓ creates client
API Routes
  ↓ query
OpenSearch (localhost:9200)
  └─ messages index
```

## Common Issues

1. **Forgot to create `.env.local`** - Environment variables from root `.env` don't automatically propagate to subdirectories
2. **Wrong endpoint protocol** - Local OpenSearch uses `http://`, not `https://`
3. **Index not created** - Must run `npm run setup-opensearch` from bot directory first
4. **Server not restarted** - Changes to `.env.local` require dev server restart

## Verification Checklist

- [ ] `.env.local` exists in frontend directory
- [ ] `OPENSEARCH_DOMAIN_ENDPOINT` is set
- [ ] `OS_BASIC_USER` is set  
- [ ] `OS_BASIC_PASS` is set
- [ ] OpenSearch is running (test with curl)
- [ ] `messages` index exists (test with bot script)
- [ ] Frontend dev server restarted
- [ ] Health check endpoint returns "healthy"



