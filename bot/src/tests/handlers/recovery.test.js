'use strict';

const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage } = require('../helpers/mock-discord');

describe('Recovery Handlers', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    describe('handleRecovery', () => {
        it('initiates the interactive recovery wizard', async () => {
            // When user cancels at first prompt, wizard exits cleanly
            bot.awaitResponse = jest.fn().mockResolvedValue('cancel');
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });

            const msg = createMockMessage();
            await bot.handleRecovery(msg);

            // First reply should be the setup-check embed
            const firstReply = msg.reply.mock.calls[0][0];
            expect(firstReply).toMatchObject({ embeds: expect.any(Array) });

            // Should then be told recovery was cancelled
            const lastReply = msg.reply.mock.calls.at(-1)[0];
            expect(lastReply).toMatch(/cancel/i);
        });

        it('re-links channels and players to an existing game record', async () => {
            const config = { game_prefix: 'g', game_counter: 3, game_name: 'Origins' };

            // Stub the interactive helpers so we can drive the wizard
            // awaitResponse calls: setup-check, game-status, player-confirm, day/night, final-confirm
            let awaitResponseCallCount = 0;
            const awaitResponseAnswers = ['yes', 'active', 'yes', 'day', 'confirm'];
            bot.awaitResponse = jest.fn().mockImplementation(() =>
                Promise.resolve(awaitResponseAnswers[awaitResponseCallCount++] ?? 'cancel')
            );

            // awaitTextResponse calls: category-name, day-number, then 6 core channel names, then 'done'
            let awaitTextCallCount = 0;
            const textAnswers = ['Game 1', '2', 'ts', 'booth', 'wolf', 'memos', 'results', 'dead', 'done'];
            bot.awaitTextResponse = jest.fn().mockImplementation(() =>
                Promise.resolve(textAnswers[awaitTextCallCount++] ?? '')
            );

            bot.saveRecoveryData = jest.fn().mockResolvedValue({
                gameId: 42,
                dashboardPassword: 'test-dashboard-password',
            });

            bot.db.query = jest.fn()
                .mockResolvedValue({ rows: [config] }); // server config

            const mockCategory = { id: 'cat-id', name: 'Game 1', type: 4 };
            const msg = createMockMessage();
            msg.guild.channels.cache.find = jest.fn().mockReturnValue(mockCategory);
            msg.guild.channels.cache.get = jest.fn().mockReturnValue({ name: 'voting-booth', id: 'vb-id' });

            const mockAliveMember = { id: 'u1', displayName: 'Alice' };
            const aliveRole = { id: 'alive-id', name: 'Alive', members: new Map([['u1', mockAliveMember]]) };
            const deadRole = { id: 'dead-id', name: 'Dead', members: new Map() };
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [aliveRole, deadRole].find(fn) || null
            );
            msg.guild.members.fetch = jest.fn().mockResolvedValue(new Map());

            await bot.handleRecovery(msg);

            // Verify recovery data was saved
            expect(bot.saveRecoveryData).toHaveBeenCalled();
        });
    });

    describe('awaitResponse', () => {
        it('resolves with the user response when a valid response is received', async () => {
            const msg = createMockMessage();
            msg.channel.awaitMessages = jest.fn().mockResolvedValue({
                first: jest.fn().mockReturnValue({ content: 'yes' }),
            });

            const result = await bot.awaitResponse(msg, ['yes', 'no'], 5000);
            expect(result).toBe('yes');
        });

        it('resolves with null on timeout', async () => {
            const msg = createMockMessage();
            msg.channel.awaitMessages = jest.fn().mockRejectedValue(new Error('time'));

            const result = await bot.awaitResponse(msg, ['yes', 'no'], 5000);
            expect(result).toBeNull();
        });
    });

    describe('awaitTextResponse', () => {
        it('resolves with text content of user response', async () => {
            const msg = createMockMessage();
            msg.channel.awaitMessages = jest.fn().mockResolvedValue({
                first: jest.fn().mockReturnValue({ content: '  some text  ' }),
            });

            const result = await bot.awaitTextResponse(msg, 5000);
            expect(result).toBe('some text');
        });

        it('resolves with null on timeout', async () => {
            const msg = createMockMessage();
            msg.channel.awaitMessages = jest.fn().mockRejectedValue(new Error('time'));

            const result = await bot.awaitTextResponse(msg, 5000);
            expect(result).toBeNull();
        });
    });

    describe('saveRecoveryData', () => {
        it('persists recovery snapshot to DB', async () => {
            const serverId = 'guild-123';
            const config = { game_prefix: 'g', game_counter: 3, game_name: 'Origins' };
            const recoveryData = {
                category_id: 'cat-id',
                game_status: 'active',
                day_phase: 'day',
                day_number: 2,
                players: [
                    { user_id: 'u1', username: 'Alice', status: 'alive' },
                    { user_id: 'u2', username: 'Bob', status: 'dead' },
                ],
                channels: {
                    signup_channel_id: 'signup-id',
                    town_square_channel_id: 'ts-id',
                    wolf_chat_channel_id: null,
                    memos_channel_id: null,
                    results_channel_id: null,
                    voting_booth_channel_id: 'vb-id',
                },
            };

            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [] })            // UPDATE games ended
                .mockResolvedValueOnce({ rows: [{ id: 99 }] }) // INSERT game RETURNING id
                .mockResolvedValueOnce({ rows: [] })            // INSERT player Alice
                .mockResolvedValueOnce({ rows: [] });           // INSERT player Bob

            const { gameId, dashboardPassword } = await bot.saveRecoveryData(serverId, config, recoveryData);

            expect(gameId).toBe(99);
            expect(dashboardPassword).toHaveLength(24);
            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE games SET status'),
                expect.arrayContaining(['ended', serverId])
            );
            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO games'),
                expect.any(Array)
            );
            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO players'),
                expect.arrayContaining([99, 'u1', 'Alice', 'alive'])
            );
        });
    });
});
