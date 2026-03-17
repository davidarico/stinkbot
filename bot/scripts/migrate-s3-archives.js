const path = require('path');
// Load env from repo root / database/.env so DATABASE_URL is available
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'database', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/database');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

const INSERT_SQL = `
INSERT INTO archive_messages (
    message_id, content, user_id, username, display_name,
    timestamp, channel_id, channel_name, category_id, category,
    reply_to_message_id, attachments, embeds, reactions,
    archived_at, archived_by, content_length,
    has_attachments, has_embeds, has_reactions, is_reply
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
ON CONFLICT (message_id) DO UPDATE SET
    content = EXCLUDED.content,
    display_name = EXCLUDED.display_name,
    attachments = EXCLUDED.attachments,
    embeds = EXCLUDED.embeds,
    reactions = EXCLUDED.reactions,
    archived_at = EXCLUDED.archived_at,
    archived_by = EXCLUDED.archived_by
`;

async function migrateS3Archives() {
    console.log('🔄 Starting migration of S3 archive files to database...');

    const requiredEnvVars = ['DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_S3_BUCKET_NAME'];
    for (const envVar of requiredEnvVars) {
        if (!process.env[envVar]) {
            console.error(`❌ Missing required environment variable: ${envVar}`);
            process.exit(1);
        }
    }

    const s3Client = new S3Client({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });

    try {
        console.log(`📁 Scanning S3 bucket: ${process.env.AWS_S3_BUCKET_NAME}/archives/`);

        const listCommand = new ListObjectsV2Command({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Prefix: 'archives/',
            MaxKeys: 1000
        });

        const listResponse = await s3Client.send(listCommand);

        if (!listResponse.Contents || listResponse.Contents.length === 0) {
            console.log('📁 No archive files found in S3 bucket');
            return;
        }

        const jsonFiles = listResponse.Contents.filter(obj =>
            obj.Key && obj.Key.endsWith('.json') && obj.Key.startsWith('archives/')
        );

        if (jsonFiles.length === 0) {
            console.log('📁 No JSON archive files found in S3 bucket');
            return;
        }

        console.log(`📁 Found ${jsonFiles.length} archive files to migrate`);

        let totalArchivesProcessed = 0;
        let totalMessagesIndexed = 0;
        let totalMessagesFailed = 0;

        for (const s3Object of jsonFiles) {
            try {
                const filename = s3Object.Key.split('/').pop();
                console.log(`\n📂 Processing: ${filename}`);

                const getResponse = await s3Client.send(new GetObjectCommand({
                    Bucket: process.env.AWS_S3_BUCKET_NAME,
                    Key: s3Object.Key
                }));
                const fileContent = await getResponse.Body.transformToString('utf8');
                const archiveData = JSON.parse(fileContent);

                if (!archiveData.channels || !Array.isArray(archiveData.channels)) {
                    console.log(`⚠️ Skipping ${filename} - invalid format`);
                    continue;
                }

                let archiveMessagesIndexed = 0;
                let archiveMessagesFailed = 0;

                for (const channel of archiveData.channels) {
                    if (!channel.messages || !Array.isArray(channel.messages)) {
                        continue;
                    }

                    console.log(`  📝 Processing ${channel.messages.length} messages from #${channel.channelName}`);

                    const messagesToInsert = channel.messages.map(msg => ({
                        messageId: msg.messageId,
                        content: msg.content,
                        userId: msg.userId,
                        username: msg.username,
                        displayName: msg.displayName,
                        timestamp: msg.timestamp,
                        channelId: msg.channelId,
                        channelName: msg.channelName,
                        categoryId: archiveData.categoryId,
                        category: archiveData.category,
                        replyToMessageId: msg.replyToMessageId,
                        attachments: msg.attachments || [],
                        embeds: msg.embeds || [],
                        reactions: msg.reactions || [],
                        archivedAt: archiveData.archivedAt,
                        archivedBy: archiveData.archivedBy || {},
                        contentLength: msg.content ? msg.content.length : 0,
                        hasAttachments: !!(msg.attachments && msg.attachments.length > 0),
                        hasEmbeds: !!(msg.embeds && msg.embeds.length > 0),
                        hasReactions: !!(msg.reactions && msg.reactions.length > 0),
                        isReply: !!msg.replyToMessageId
                    }));

                    const batchSize = 100;
                    for (let i = 0; i < messagesToInsert.length; i += batchSize) {
                        const batch = messagesToInsert.slice(i, i + batchSize);
                        const client = await db.connect();
                        try {
                            for (const msg of batch) {
                                try {
                                    await client.query(INSERT_SQL, [
                                        msg.messageId,
                                        msg.content || null,
                                        msg.userId,
                                        msg.username,
                                        msg.displayName || null,
                                        msg.timestamp,
                                        msg.channelId,
                                        msg.channelName,
                                        msg.categoryId,
                                        msg.category,
                                        msg.replyToMessageId || null,
                                        JSON.stringify(msg.attachments),
                                        JSON.stringify(msg.embeds),
                                        JSON.stringify(msg.reactions),
                                        msg.archivedAt,
                                        JSON.stringify(msg.archivedBy),
                                        msg.contentLength,
                                        msg.hasAttachments,
                                        msg.hasEmbeds,
                                        msg.hasReactions,
                                        msg.isReply
                                    ]);
                                    archiveMessagesIndexed++;
                                } catch (err) {
                                    archiveMessagesFailed++;
                                    if (archiveMessagesFailed <= 3) {
                                        console.log(`    ⚠️ Failed to insert message ${msg.messageId}:`, err.message);
                                    }
                                }
                            }
                        } finally {
                            client.release();
                        }
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                }

                console.log(`  ✅ Archive processed: ${archiveMessagesIndexed} indexed, ${archiveMessagesFailed} failed`);

                totalArchivesProcessed++;
                totalMessagesIndexed += archiveMessagesIndexed;
                totalMessagesFailed += archiveMessagesFailed;

            } catch (fileError) {
                console.error(`❌ Error processing ${s3Object.Key}:`, fileError.message);
            }
        }

        console.log(`\n🎉 Migration complete!`);
        console.log(`📊 Summary:`);
        console.log(`  - Archives processed: ${totalArchivesProcessed}`);
        console.log(`  - Messages inserted: ${totalMessagesIndexed}`);
        console.log(`  - Messages failed: ${totalMessagesFailed}`);

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await db.end();
    }
}

if (require.main === module) {
    migrateS3Archives();
}

module.exports = { migrateS3Archives };
