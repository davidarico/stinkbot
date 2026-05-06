'use strict';

const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage } = require('../helpers/mock-discord');

describe('Game Handlers', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    describe('getServerChannelCapacity', () => {
        it('returns capacity info with correct structure', async () => {
            const guild = {
                channels: {
                    cache: { size: 50 },
                    fetch: jest.fn().mockResolvedValue({ size: 50 }),
                },
            };
            bot.db.query = jest.fn().mockResolvedValue({ rows: [{ total: 0 }] });
            const result = await bot.getServerChannelCapacity('guild-123', guild, 4);
            expect(result).toMatchObject({
                channelLimit: 500,
                currentChannelsCount: 50,
                pendingToCreateCount: 0,
                plannedNewChannels: 4,
                projectedTotal: 54,
                remainingProjected: 446,
                isWithinLimitProjected: true,
            });
        });

        it('flags over-limit when projected total exceeds 500', async () => {
            const guild = {
                channels: {
                    cache: { size: 498 },
                    fetch: jest.fn().mockResolvedValue({ size: 498 }),
                },
            };
            bot.db.query = jest.fn().mockResolvedValue({ rows: [{ total: 0 }] });
            const result = await bot.getServerChannelCapacity('guild-123', guild, 4);
            expect(result.isWithinLimitProjected).toBe(false);
        });
    });

    describe('handleSetup', () => {
        it('saves server config from user response', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [] })  // no existing config
                .mockResolvedValueOnce({ rows: [] }); // INSERT

            const msg = createMockMessage();
            msg.channel.awaitMessages = jest.fn().mockResolvedValue({
                size: 1,
                first: jest.fn().mockReturnValue({ content: 'g 1 Origins' }),
            });

            await bot.handleSetup(msg);

            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO server_configs'),
                expect.arrayContaining(['guild-123', 'g', 1, 'Origins'])
            );
            const lastReply = msg.reply.mock.calls.at(-1)[0];
            expect(lastReply.embeds[0].data.title).toBe('✅ Setup Complete');
        });

        it('times out when user does not respond within 60 seconds', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });
            const msg = createMockMessage(); // default awaitMessages returns { size: 0 }
            await bot.handleSetup(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('timed out'));
        });

        it('shows existing config when server is already set up', async () => {
            const existingConfig = { game_prefix: 'g', game_counter: 5, game_name: 'Origins' };
            bot.db.query = jest.fn().mockResolvedValue({ rows: [existingConfig] });
            const msg = createMockMessage();
            await bot.handleSetup(msg);
            const firstReply = msg.reply.mock.calls[0][0];
            expect(firstReply.embeds[0].data.title).toContain('Already Configured');
        });
    });

    describe('handleCreate', () => {
        it('replies with error when server is not configured', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });
            const msg = createMockMessage({ content: 'Wolf.create' });
            await bot.handleCreate(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Wolf.setup'));
        });

        it('replies with error when an active game already exists', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ game_prefix: 'g', game_counter: 1, game_name: null }] })
                .mockResolvedValueOnce({ rows: [{ id: 42, status: 'active' }] });
            const msg = createMockMessage({ content: 'Wolf.create' });
            await bot.handleCreate(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('active game'));
        });

        it('creates category, channels, and DB entry when no active game', async () => {
            const config = { game_prefix: 'g', game_counter: 1, game_name: null };

            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [config] })        // server config
                .mockResolvedValueOnce({ rows: [] })              // no active game
                .mockResolvedValueOnce({ rows: [{ total: 0 }] }) // capacity: pending channels
                .mockResolvedValueOnce({ rows: [{ id: 99 }] })   // INSERT game RETURNING id
                .mockResolvedValueOnce({ rows: [] })              // UPDATE server config counter
                .mockResolvedValue({ rows: [] });                 // UPDATE signup_message_id + anything else

            let seq = 0;
            const makeCreatedChannel = () => {
                const n = ++seq;
                return {
                    id: `created-${n}`,
                    type: n === 1 ? 4 : 0,
                    position: n,
                    parentId: n === 1 ? null : 'created-1',
                    setPosition: jest.fn().mockResolvedValue(undefined),
                    permissionOverwrites: { create: jest.fn(), edit: jest.fn() },
                    send: jest.fn().mockResolvedValue({ id: `msg-${n}`, pin: jest.fn().mockResolvedValue(undefined) }),
                };
            };

            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockReturnValue({ id: 'mod-role-id', name: 'Mod' });
            msg.guild.channels.create = jest.fn().mockImplementation(() => Promise.resolve(makeCreatedChannel()));
            msg.guild.channels.cache.filter = jest.fn()
                .mockReturnValueOnce({ size: 0, sort: jest.fn().mockReturnValue({ size: 0, first: jest.fn() }) })
                .mockReturnValue({ size: 0 });

            await bot.handleCreate(msg);

            // category + mod-chat + breakdown + signup
            expect(msg.guild.channels.create).toHaveBeenCalledTimes(4);
            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO games'),
                expect.any(Array)
            );
            const lastReply = msg.reply.mock.calls.at(-1)[0];
            expect(lastReply.embeds[0].data.title).toBe('🎮 New Game Created!');
        });
    });

    describe('handleSignUp', () => {
        it('adds user to signups when game is in signup phase', async () => {
            const game = { id: 1, signups_closed: false };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [] })              // not banned
                .mockResolvedValueOnce({ rows: [game] })          // active signup game
                .mockResolvedValueOnce({ rows: [] })              // not already signed up
                .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT player

            bot.ensureUserHasJournal = jest.fn();
            bot.updateSignupMessage = jest.fn().mockResolvedValue(undefined);

            const msg = createMockMessage();
            msg.react = jest.fn().mockResolvedValue(undefined);

            await bot.handleSignUp(msg);

            expect(msg.react).toHaveBeenCalledWith('✅');
            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO players'),
                expect.any(Array)
            );
        });

        it('replies with error when no active signup game', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [] })  // not banned
                .mockResolvedValueOnce({ rows: [] }); // no signup game

            const msg = createMockMessage();
            await bot.handleSignUp(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('No active game'));
        });

        it('replies with error when user is already signed up', async () => {
            const game = { id: 1, signups_closed: false };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [{ id: 'player-1' }] }); // already signed up

            const msg = createMockMessage();
            await bot.handleSignUp(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('already signed up'));
        });
    });

    describe('handleSignOut', () => {
        it('removes user from signups', async () => {
            const game = { id: 1, signups_closed: false };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE succeeded

            bot.updateSignupMessage = jest.fn().mockResolvedValue(undefined);

            const msg = createMockMessage();
            msg.react = jest.fn().mockResolvedValue(undefined);

            await bot.handleSignOut(msg);
            expect(msg.react).toHaveBeenCalledWith('✅');
        });

        it('replies with error when user is not signed up', async () => {
            const game = { id: 1, signups_closed: false };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // nothing deleted

            const msg = createMockMessage();
            await bot.handleSignOut(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('not signed up'));
        });
    });

    describe('handleStart', () => {
        it('replies with error when no signup-phase game exists', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });
            const msg = createMockMessage();
            await bot.handleStart(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('No game in signup phase'));
        });

        it('starts game, assigns roles, and creates player channels', async () => {
            const game = {
                id: 1, game_number: 1, status: 'signup',
                category_id: 'cat-id', signup_channel_id: 'signup-channel-id',
                results_channel_id: null, memos_channel_id: null,
                town_square_channel_id: null, voting_booth_channel_id: null,
                wolf_chat_channel_id: null, signup_message_id: null,
            };
            const config = { game_prefix: 'g', game_counter: 1, game_name: null };

            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })             // signup game
                .mockResolvedValueOnce({ rows: [{ count: '2' }] })  // player count (non-zero to pass guard)
                .mockResolvedValueOnce({ rows: [config] })           // server config
                .mockResolvedValueOnce({ rows: [] })                 // reconciliation: pending game_channels
                .mockResolvedValueOnce({ rows: [{ total: 0 }] })    // capacity: pending count
                .mockResolvedValueOnce({ rows: [] })                 // signedUpPlayers
                .mockResolvedValueOnce({ rows: [] })                 // pending channels to create
                .mockResolvedValueOnce({ rows: [] })                 // invited users
                .mockResolvedValue({ rows: [] });                    // UPDATE games + fallback

            let chanSeq = 0;
            const makeChannel = () => {
                const n = ++chanSeq;
                return {
                    id: `ch-${n}`, name: `channel-${n}`, type: 0,
                    parentId: 'cat-id', position: n,
                    setName: jest.fn().mockResolvedValue(undefined),
                    setPosition: jest.fn().mockResolvedValue(undefined),
                    setParent: jest.fn().mockResolvedValue(undefined),
                    permissionOverwrites: {
                        edit: jest.fn().mockResolvedValue(undefined),
                        set: jest.fn().mockResolvedValue(undefined),
                    },
                    send: jest.fn().mockResolvedValue({ id: `sent-${n}`, pin: jest.fn().mockResolvedValue(undefined) }),
                };
            };

            const mockSignupChannel = makeChannel();
            mockSignupChannel.id = 'signup-channel-id';

            bot.client.channels = {
                fetch: jest.fn()
                    .mockResolvedValueOnce({ id: 'cat-id', type: 4 }) // category
                    .mockResolvedValueOnce(mockSignupChannel),         // signup channel
            };

            bot.sendPlayerListToDeadChat = jest.fn().mockResolvedValue(undefined);
            bot.sendRoleNotificationsToJournals = jest.fn().mockResolvedValue({
                sent: 0, failed: 0, wolvesAddedToChat: 0, wolvesFailedToAdd: 0,
            });

            const msg = createMockMessage();

            const roleMap = [
                { id: 'alive-id', name: 'Alive' },
                { id: 'dead-id', name: 'Dead' },
                { id: 'spectator-id', name: 'Spectator' },
                { id: 'mod-id', name: 'Mod' },
            ];
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn => roleMap.find(fn) || null);

            const mockChannelCollection = {
                size: 10,
                find: jest.fn().mockReturnValue(null),
                filter: jest.fn().mockReturnValue({ size: 0, values: jest.fn().mockReturnValue([]) }),
                get: jest.fn().mockReturnValue(null),
            };
            msg.guild.channels.fetch = jest.fn().mockResolvedValue(mockChannelCollection);
            msg.guild.channels.create = jest.fn().mockImplementation(() => Promise.resolve(makeChannel()));

            await bot.handleStart(msg);

            const updateCall = bot.db.query.mock.calls.find(([sql]) => sql.includes("status = 'active'"));
            expect(updateCall).toBeDefined();
            const lastReply = msg.reply.mock.calls.at(-1)[0];
            expect(lastReply.embeds[0].data.title).toBe('🎮 Game Started!');
        });
    });
});
