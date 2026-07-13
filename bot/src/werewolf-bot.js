'use strict';

const { Client } = require('@opensearch-project/opensearch');
const { createAwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const { S3Client } = require('@aws-sdk/client-s3');
const OpenAI = require('openai');

class WerewolfBot {
    constructor(client, db) {
        this.client = client;
        this.db = db;
        this.prefix = process.env.BOT_PREFIX || 'Wolf.';

        // Initialize OpenAI client if API key is available
        if (process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
        } else {
            this.openai = null;
        }

        // Initialize S3 client if credentials are available
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_REGION) {
            this.s3Client = new S3Client({
                region: process.env.AWS_REGION,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
                }
            });
        } else {
            this.s3Client = null;
        }

        // Initialize OpenSearch client if endpoint is available
        if (process.env.OPENSEARCH_DOMAIN_ENDPOINT) {
            const endpoint = process.env.OPENSEARCH_DOMAIN_ENDPOINT;

            // Check if this is a local endpoint (no AWS authentication needed)
            if (endpoint.includes('localhost') || endpoint.includes('127.0.0.1') || endpoint.startsWith('http://')) {
                // Local OpenSearch instance - check for basic authentication
                const clientConfig = {
                    node: endpoint
                };

                if (process.env.OS_BASIC_USER && process.env.OS_BASIC_PASS) {
                    clientConfig.auth = {
                        username: process.env.OS_BASIC_USER,
                        password: process.env.OS_BASIC_PASS
                    };
                }

                this.openSearchClient = new Client(clientConfig);
            } else {
                // AWS OpenSearch instance - use AWS authentication
                if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_REGION) {
                    this.openSearchClient = new Client({
                        ...createAwsSigv4Signer({
                            region: process.env.AWS_REGION,
                            service: 'es',
                            getCredentials: () => {
                                return Promise.resolve({
                                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                                });
                            },
                        }),
                        node: endpoint,
                    });
                } else {
                    console.warn('⚠️ OpenSearch endpoint provided but AWS credentials missing for remote endpoint');
                    this.openSearchClient = null;
                }
            }
        } else {
            this.openSearchClient = null;
        }
    }

    async handleMessage(message) {
        // Check if message starts with prefix (case insensitive)
        const prefix = process.env.BOT_PREFIX || 'Wolf.';
        if (!message.content.toLowerCase().startsWith(prefix.toLowerCase())) {
            return;
        }

        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // Commands that anyone can use
        const playerCommands = ['in', 'out', 'vote', 'retract', 'alive', 'peed', 'help', 'meme', 'wolf_list', 'mylo', 'feedback', 'my_journal', 'players', 'rename_journal', 'speed_check', 'votecount', 'iaself'];
        const superUserCommands = ['mod'];

        // Check permissions for admin-only commands
        if (superUserCommands.includes(command)) {
            const allowed = await this.isSuperUser(message.author?.id) || this.hasTownCouncilRole(message.member);
            if (!allowed) {
                await message.reply('❌ You do not have permission to use this command.');
                return;
            }
        } else if (command === 'unmod') {
            const allowedUnmod = await this.isSuperUser(message.author?.id) || this.hasTownCouncilRole(message.member) || this.hasModeratorPermissions(message.member);
            if (!allowedUnmod) {
                await message.reply('❌ You do not have permission to use this command.');
                return;
            }
        } else if (!playerCommands.includes(command) && !this.hasModeratorPermissions(message.member)) {
            const funnyResponse = await this.generateFunnyResponse(message.content.slice(prefix.length).trim().split(/ +/), message.author.displayName);
            if (funnyResponse) {
                await message.reply(funnyResponse);
            } else {
                await message.reply('❓ Unknown command bozo. (Or you fuckers used up all the tokens)');
            }
            return;
        }

        try {
            switch (command) {
                case 'mod':
                    await this.handleMod(message, args);
                    break;
                case 'unmod':
                    await this.handleUnmod(message, args);
                    break;
                case 'setup':
                    await this.handleSetup(message, args);
                    break;
                case 'create':
                    await this.handleCreate(message);
                    break;
                case 'in':
                    await this.handleSignUp(message);
                    break;
                case 'out':
                    await this.handleSignOut(message);
                    break;
                case 'remove_signup':
                    await this.handleRemoveSignup(message, args);
                    break;
                case 'start':
                    await this.handleStart(message, args);
                    break;
                case 'vote':
                    await this.handleVote(message, args);
                    break;
                case 'retract':
                    await this.handleRetract(message);
                    break;
                case 'next':
                    await this.handleNext(message);
                    break;
                case 'end':
                    await this.handleEnd(message);
                    break;
                case 'help':
                    await this.handleHelp(message);
                    break;
                case 'refresh':
                    await this.handleRefresh(message);
                    break;
                case 'server_roles':
                    await this.handleServerRoles(message);
                    break;
                case 'alive':
                    await this.handleAlive(message);
                    break;
                case 'dead':
                    await this.handleDead(message);
                    break;
                // <fletch> helpful for making memos after some players have died without manually grabbing dead names
                case 'players':
                    await this.handleAlive(message, true);
                    break;
                // Mod utility which simply removes "Alive" and adds "Dead" from a player
                case 'kill':
                    await this.killPlayer(message)
                    break;
                // </fletch>
                case 'inlist':
                    await this.handleInList(message, args);
                    break;
                case 'signups':
                    await this.handleSignups(message, args);
                    break;
                case 'add_channel':
                    await this.handleAddChannel(message, args);
                    break;
                case 'recovery':
                    await this.handleRecovery(message);
                    break;
                case 'journal':
                    await this.handleJournal(message, args);
                    break;
                case 'journal_link':
                    await this.handleJournalLink(message);
                    break;
                case 'journal_owner':
                    await this.handleJournalOwner(message);
                    break;
                case 'journal_unlink':
                    await this.handleJournalUnlink(message);
                    break;
                case 'journal_assign':
                    await this.handleJournalAssign(message, args);
                    break;
                case 'journal_grant_pin':
                    await this.handleJournalPinPerms(message);
                    break;
                case 'fix_journals':
                    await this.handleFixJournals(message);
                    break;
                case 'server':
                    await this.handleServer(message);
                    break;
                case 'roles_list':
                    await this.handleRolesList(message);
                    break;
                case 'my_journal':
                    await this.handleMyJournal(message);
                    break;
                case 'rename_journal':
                    await this.handleRenameJournal(message, args);
                    break;
                case 'balance_journals':
                    await this.handleBalanceJournals(message);
                    break;
                case 'populate_journals':
                    await this.handlePopulateJournals(message, args);
                    break;
                case 'ia':
                    await this.handleIA(message, args);
                    break;
                case 'iaself':
                    await this.handleIA(message, args, { onlyUserId: message.author.id });
                    break;
                case 'speed':
                    await this.handleSpeed(message, args);
                    break;
                case 'speed_check':
                    await this.handleSpeedCheck(message);
                    break;
                case 'settings':
                    await this.handleSettings(message, args);
                    break;
                case 'create_vote':
                    await this.handleCreateVote(message);
                    break;
                case 'get_votes':
                    await this.handleGetVotes(message);
                    break;
                case 'votecount':
                    await this.handleVoteCount(message);
                    break;
                case 'ratio':
                    await this.handleRatio(message);
                    break;
                case 'wolves_alive':
                    await this.handleWolvesAlive(message);
                    break;
                case 'add_in':
                    await this.handleAddIn(message, args);
                    break;
                case 'not_voted':
                    await this.handleNotVoted(message);
                    break;
                case 'lssv':
                    await this.handleLssv(message, args);
                    break;
                case 'archive':
                    await this.handleArchive(message, args);
                    break;
                case 'archive_local':
                    await this.handleArchiveLocal(message, args);
                    break;
                case 'sync_members':
                    await this.handleSyncMembers(message);
                    break;
                case 'role_config':
                    await this.handleRoleConfiguration(message);
                    break;
                case 'channel_config':
                    await this.handleChannelConfig(message);
                    break;
                case 'feedback':
                    await this.handleFeedback(message, args);
                    break;
                case 'set_voting_booth':
                    await this.handleSetVotingBooth(message, args);
                    break;

                // Meme commands
                case 'meme':
                    await this.handleMeme(message);
                    break;
                case 'peed':
                    await message.reply('💦 IM PISSING REALLY HARD AND ITS REALLY COOL 💦');
                    break;
                case 'mylo':
                    await message.reply('Mylo can maybe backpedal to Orphan if we need to if this doesn\'t land');
                    break;
                case 'wolf_list':
                    await message.reply('The wolf list? Are we still doing this? Stop talking about the wolf list.');
                    break;
                case 'lockdown':
                    await this.handleLockdown(message, args);
                    break;
                case 'perms_test':
                    await this.permsTest(message, args);
                    break;
                case 'scuff':
                    await this.handleScuff(message);
                    break;
                case 'delete_category':
                    await this.handleDeleteCategory(message, args);
                    break;
                default:
                    const funnyResponse = await this.generateFunnyResponse(message.content.slice(prefix.length).trim().split(/ +/), message.author.displayName);
                    if (funnyResponse) {
                        await message.reply(funnyResponse);
                    } else {
                        await message.reply('❓ Unknown command bozo. (Or you fuckers used up all the tokens)');
                    }
            }
        } catch (error) {
            console.error('Error handling command:', error);
            await message.reply('❌ An error occurred while processing your command.');
        }
    }
}

// Mix in all handler modules
Object.assign(WerewolfBot.prototype,
    require('./handlers/image'),
    require('./handlers/roles'),
    require('./handlers/game'),
    require('./handlers/game-phases'),
    require('./handlers/voting'),
    require('./handlers/players'),
    require('./handlers/journal'),
    require('./handlers/archive'),
    require('./handlers/channels'),
    require('./handlers/recovery'),
    require('./handlers/speed-vote'),
    require('./handlers/utils'),
);

module.exports = WerewolfBot;
