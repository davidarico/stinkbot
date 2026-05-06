'use strict';

const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage } = require('../helpers/mock-discord');

describe('Utility Methods', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    describe('calculateSimilarity', () => {
        it('returns 100 for identical strings', () => {
            expect(bot.calculateSimilarity('hello', 'hello')).toBe(100);
        });

        it('returns 0 for completely different strings of the same length', () => {
            expect(bot.calculateSimilarity('abc', 'xyz')).toBe(0);
        });

        it('returns a value between 0 and 100 for partially similar strings', () => {
            const result = bot.calculateSimilarity('hello', 'help');
            expect(result).toBeGreaterThan(0);
            expect(result).toBeLessThan(100);
        });
    });

    describe('generateFunnyResponse', () => {
        it('returns null when openai is not configured', async () => {
            bot.openai = null;
            const result = await bot.generateFunnyResponse('unknowncmd', 'TestUser');
            expect(result).toBeNull();
        });

        it('returns trimmed string from openai when configured', async () => {
            bot.openai = {
                chat: {
                    completions: {
                        create: jest.fn().mockResolvedValue({
                            choices: [{ message: { content: '"funny response"' } }],
                        }),
                    },
                },
            };
            const result = await bot.generateFunnyResponse('unknowncmd', 'TestUser');
            expect(result).toBe('funny response');
        });

        it('returns null on openai error', async () => {
            bot.openai = {
                chat: {
                    completions: {
                        create: jest.fn().mockRejectedValue(new Error('API error')),
                    },
                },
            };
            const result = await bot.generateFunnyResponse('unknowncmd', 'TestUser');
            expect(result).toBeNull();
        });
    });

    describe('handleHelp', () => {
        it('replies with an embed listing all commands', async () => {
            const msg = createMockMessage();
            await bot.handleHelp(msg);
            const reply = msg.reply.mock.calls[0][0];
            expect(reply).toMatchObject({ embeds: expect.any(Array) });
            expect(reply.embeds[0].data.title).toContain('Werewolf');
        });
    });

    describe('handleIA', () => {
        beforeAll(() => { global.moment = require('moment-timezone'); });
        afterAll(() => { delete global.moment; });

        it('displays inactivity report for all players', async () => {
            const game = {
                id: 1, status: 'active', day_number: 2, day_phase: 'day',
                town_square_channel_id: 'town-sq-id',
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [{ user_id: 'user-1', username: 'Alice' }] });

            const mockChannel = {
                id: 'town-sq-id', name: 'town-square',
                isTextBased: () => true,
                messages: { fetch: jest.fn().mockResolvedValue({ size: 0 }) },
            };
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(mockChannel) };

            const aliveRole = { id: 'alive-id', name: 'Alive' };
            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [aliveRole].find(fn) || null
            );
            msg.guild.members.cache = new Map([
                ['user-1', { roles: { cache: { has: jest.fn().mockReturnValue(true) } } }],
            ]);
            msg.guild.members.fetch = jest.fn().mockResolvedValue(new Map());

            await bot.handleIA(msg, []);

            expect(msg.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
        });

        it("displays only the calling user's activity with iaself", async () => {
            const game = {
                id: 1, status: 'active', day_number: 2, day_phase: 'day',
                town_square_channel_id: 'town-sq-id',
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [{ '1': 1 }] })  // selfInGame check
                .mockResolvedValueOnce({ rows: [{ user_id: 'user-123', username: 'Alice' }] });

            const mockChannel = {
                id: 'town-sq-id', name: 'town-square',
                isTextBased: () => true,
                messages: { fetch: jest.fn().mockResolvedValue({ size: 0 }) },
            };
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(mockChannel) };

            const aliveRole = { id: 'alive-id', name: 'Alive' };
            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [aliveRole].find(fn) || null
            );
            msg.guild.members.cache = new Map([
                ['user-123', { roles: { cache: { has: jest.fn().mockReturnValue(true) } } }],
            ]);
            msg.guild.members.fetch = jest.fn().mockResolvedValue(new Map());

            await bot.handleIA(msg, [], { onlyUserId: 'user-123' });

            const reply = msg.reply.mock.calls.at(-1)[0];
            expect(reply).toMatchObject({ embeds: expect.any(Array) });
            expect(reply.embeds[0].data.title).toBe('📊 Your activity (IA)');
        });
    });

    describe('handleServer', () => {
        it('displays server stats and active game info', async () => {
            const config = { game_prefix: 'g', game_counter: 5, game_name: 'Origins' };
            const game = {
                id: 1, status: 'active', game_number: 5, game_name: 'Origins',
                day_phase: 'day', day_number: 3,
                town_square_channel_id: null, voting_booth_channel_id: null,
                wolf_chat_channel_id: null, signup_channel_id: null,
                memos_channel_id: null, results_channel_id: null,
            };

            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [config] })              // server_configs
                .mockResolvedValueOnce({ rows: [game] })                // active game
                .mockResolvedValueOnce({ rows: [{ total: '3' }] })     // player count
                .mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] }) // all players for alive count
                .mockResolvedValueOnce({ rows: [] })                    // game_channels
                .mockResolvedValueOnce({ rows: [{ total: '5' }] })     // total games
                .mockResolvedValue({ rows: [{ '1': 1 }] });             // SELECT 1 + fallback

            bot.getServerChannelCapacity = jest.fn().mockResolvedValue({
                channelLimit: 500, currentChannelsCount: 50, pendingToCreateCount: 0,
                plannedNewChannels: 0, projectedTotal: 50, remainingProjected: 450,
                isWithinLimitProjected: true,
            });

            const aliveRole = { id: 'alive-id', name: 'Alive' };
            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [aliveRole].find(fn) || null
            );
            msg.guild.members.cache = new Map([
                ['u1', { roles: { cache: { has: jest.fn().mockReturnValue(true) } } }],
            ]);
            msg.guild.members.fetch = jest.fn().mockResolvedValue(new Map());

            await bot.handleServer(msg);

            const reply = msg.reply.mock.calls.at(-1)[0];
            expect(reply).toMatchObject({ embeds: expect.any(Array) });
            expect(reply.embeds[0].data.title).toContain('Server Information');
        });
    });
});
