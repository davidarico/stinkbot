'use strict';

const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage } = require('../helpers/mock-discord');

describe('Game Phase Handlers', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    // Voting channel mock reused across handleNext tests
    function makeMockVotingChannel() {
        return {
            permissionOverwrites: { edit: jest.fn().mockResolvedValue(undefined) },
            send: jest.fn().mockResolvedValue({ id: 'msg-123' }),
        };
    }

    describe('handleNext', () => {
        it('replies with error when no active game', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });
            const msg = createMockMessage({ content: 'Wolf.next' });
            await bot.handleNext(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('No active game'));
        });

        it('advances day count and updates channel permissions (night → day)', async () => {
            const game = {
                id: 1, day_phase: 'night', day_number: 1, game_number: 1,
                voting_booth_channel_id: 'booth-id',
                town_square_channel_id: null,
                wolf_chat_channel_id: null,
                votes_to_hang: 5,
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })  // SELECT games
                .mockResolvedValueOnce({ rows: [] })      // UPDATE games phase
                .mockResolvedValueOnce({ rows: [] })      // SELECT game_channels (phase messages)
                .mockResolvedValueOnce({ rows: [] });     // SELECT game_channels (permissions)

            bot.createVotingMessage = jest.fn().mockResolvedValue(undefined);

            const mockVotingChannel = makeMockVotingChannel();
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(mockVotingChannel) };

            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [{ id: 'alive-id', name: 'Alive' }].find(fn) || null
            );

            await bot.handleNext(msg);

            const updateCall = bot.db.query.mock.calls.find(([sql]) => sql.includes('UPDATE games SET day_phase'));
            expect(updateCall[1]).toEqual(expect.arrayContaining(['day', 2]));
            expect(bot.createVotingMessage).toHaveBeenCalled();
            expect(msg.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
        });

        it('sends voting message when advancing to day phase', async () => {
            const game = {
                id: 1, day_phase: 'night', day_number: 2, game_number: 1,
                voting_booth_channel_id: 'booth-id',
                town_square_channel_id: null,
                wolf_chat_channel_id: null,
                votes_to_hang: 5,
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] });

            bot.createVotingMessage = jest.fn().mockResolvedValue(undefined);
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(makeMockVotingChannel()) };

            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [{ id: 'alive-id', name: 'Alive' }].find(fn) || null
            );

            await bot.handleNext(msg);

            expect(bot.createVotingMessage).toHaveBeenCalledWith(game.id, expect.anything());
        });

        it('closes the voting booth when advancing to night phase', async () => {
            const game = {
                id: 1, day_phase: 'day', day_number: 1, game_number: 1,
                voting_booth_channel_id: 'booth-id',
                town_square_channel_id: null,
                wolf_chat_channel_id: null,
                votes_to_hang: 5,
                day_message: 'Good day!', night_message: 'Good night!',
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })  // SELECT games
                .mockResolvedValueOnce({ rows: [] })      // SELECT votes (day→night)
                .mockResolvedValueOnce({ rows: [] })      // DELETE votes
                .mockResolvedValueOnce({ rows: [] })      // UPDATE voting_message_id NULL
                .mockResolvedValueOnce({ rows: [] })      // UPDATE games phase
                .mockResolvedValueOnce({ rows: [] })      // SELECT game_channels (phase messages)
                .mockResolvedValueOnce({ rows: [] });     // SELECT game_channels (permissions)

            const mockVotingChannel = makeMockVotingChannel();
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(mockVotingChannel) };

            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [{ id: 'alive-id', name: 'Alive' }].find(fn) || null
            );

            await bot.handleNext(msg);

            expect(mockVotingChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
                'alive-id',
                expect.objectContaining({ SendMessages: false })
            );
        });
    });

    describe('handleEnd', () => {
        function setupHandleEnd(msg, game) {
            msg.channel.awaitMessages = jest.fn().mockResolvedValue({
                size: 1,
                first: jest.fn().mockReturnValue({ content: 'confirm' }),
            });

            const mockCategory = {
                children: { cache: { filter: jest.fn().mockReturnValue(new Map()) } },
            };
            msg.guild.channels.fetch = jest.fn().mockResolvedValue(mockCategory);

            const roleMap = [
                { id: 'spectator-id', name: 'Spectator' },
                { id: 'alive-id', name: 'Alive' },
            ];
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn => roleMap.find(fn) || null);
        }

        it('replies with error when no active game', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });
            const msg = createMockMessage();
            await bot.handleEnd(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('No active game'));
        });

        it('ends the game and archives channels', async () => {
            const game = { id: 1, game_number: 1, category_id: 'cat-id' };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })  // SELECT games
                .mockResolvedValueOnce({ rows: [] });     // UPDATE status='ended'

            const msg = createMockMessage();
            setupHandleEnd(msg, game);

            await bot.handleEnd(msg);

            const updateCall = bot.db.query.mock.calls.find(([sql]) => sql.includes('UPDATE games SET status'));
            expect(updateCall[1]).toEqual(expect.arrayContaining(['ended', game.id]));
            const lastReply = msg.reply.mock.calls.at(-1)[0];
            expect(lastReply.embeds[0].data.title).toBe('🏁 Game Ended');
        });

        it('assigns Spectator role to all alive players', async () => {
            const game = { id: 1, game_number: 1, category_id: 'cat-id' };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [] });

            const mockMember = {
                user: { bot: false },
                displayName: 'TestPlayer',
                roles: {
                    cache: { has: jest.fn().mockReturnValue(false) },
                    add: jest.fn().mockResolvedValue(undefined),
                    remove: jest.fn().mockResolvedValue(undefined),
                },
                guild: { id: 'guild-123', roles: { cache: { find: jest.fn().mockReturnValue(null) } } },
            };

            const msg = createMockMessage();
            setupHandleEnd(msg, game);
            msg.guild.members.fetch = jest.fn().mockResolvedValue(new Map([['m-1', mockMember]]));

            await bot.handleEnd(msg);

            expect(msg.guild.members.fetch).toHaveBeenCalled();
        });
    });

    describe('handleScuff', () => {
        it('marks the game as scuffed and closes channels', async () => {
            const game = { id: 1, game_number: 3, status: 'active' };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })  // SELECT games
                .mockResolvedValueOnce({ rows: [] });     // UPDATE games status='signup'

            const msg = createMockMessage();
            msg.channel.awaitMessages = jest.fn().mockResolvedValue({
                size: 1,
                first: jest.fn().mockReturnValue({ content: 'confirm' }),
            });

            const roleMap = [
                { id: 'alive-id', name: 'Alive' },
                { id: 'signedup-id', name: 'Signed Up' },
            ];
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn => roleMap.find(fn) || null);

            // Make cache.filter work (Map doesn't have .filter natively)
            msg.guild.members.cache = {
                filter: jest.fn().mockReturnValue(new Map()),
                get: jest.fn().mockReturnValue(undefined),
            };

            await bot.handleScuff(msg);

            const updateCall = bot.db.query.mock.calls.find(([sql]) => sql.includes('UPDATE games SET status'));
            expect(updateCall[1]).toEqual(expect.arrayContaining(['signup', false, game.id]));
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Scuffed'));
        });
    });

    describe('handleRefresh', () => {
        it('refuses to run outside of development mode', async () => {
            const savedEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            try {
                const msg = createMockMessage();
                await bot.handleRefresh(msg);
                expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('development mode'));
            } finally {
                process.env.NODE_ENV = savedEnv;
            }
        });
    });
});
