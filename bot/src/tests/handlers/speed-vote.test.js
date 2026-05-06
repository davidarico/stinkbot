'use strict';

const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage } = require('../helpers/mock-discord');

describe('Speed Vote Handlers', () => {
    let bot;

    beforeAll(() => { global.moment = require('moment-timezone'); });
    afterAll(() => { delete global.moment; });

    beforeEach(() => {
        bot = createTestBot();
    });

    describe('handleSpeedCheck', () => {
        it('displays the current speed vote status for the active game', async () => {
            const game = {
                id: 1, status: 'active',
                phase_change_at: new Date(Date.now() - 60000).toISOString(),
                town_square_channel_id: 'ts-id',
                day_phase: 'day', day_number: 2,
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [{ user_id: 'user-1', username: 'Alice' }] });

            const mockChannel = {
                id: 'ts-id', name: 'town-square',
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

            await bot.handleSpeedCheck(msg);

            expect(msg.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
        });

        it('replies with error when no active game', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });
            const msg = createMockMessage();
            await bot.handleSpeedCheck(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('No active game'));
        });
    });

    describe('handleSpeed', () => {
        it('initiates a speed vote on a specified player', async () => {
            const game = {
                id: 1, status: 'active',
                results_channel_id: 'results-id',
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })   // active game
                .mockResolvedValueOnce({ rows: [] })       // no existing speed vote
                .mockResolvedValueOnce({ rows: [] });      // INSERT game_speed

            const aliveRole = { id: 'alive-id', name: 'Alive', toString: () => '@Alive' };
            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [aliveRole].find(fn) || null
            );

            const mockResultsChannel = {
                id: 'results-id', name: 'results',
                send: jest.fn().mockResolvedValue({
                    id: 'speed-msg-id',
                    react: jest.fn().mockResolvedValue(undefined),
                }),
            };
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(mockResultsChannel) };
            bot.setupSpeedReactionListener = jest.fn();

            await bot.handleSpeed(msg, ['3']);

            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO game_speed'),
                expect.any(Array)
            );
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Speed vote created'));
        });

        it('replies with error when no valid speed target is provided', async () => {
            const game = { id: 1, status: 'active' };
            bot.db.query = jest.fn().mockResolvedValue({ rows: [game] });
            const msg = createMockMessage();

            await bot.handleSpeed(msg, ['abc']); // non-numeric

            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('valid speed target'));
        });

        it('replies with error when a speed vote is already in progress', async () => {
            const game = { id: 1, status: 'active' };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [{ id: 1, game_id: 1 }] }); // existing vote

            const msg = createMockMessage();
            await bot.handleSpeed(msg, ['3']);

            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('already an active speed vote'));
        });
    });

    describe('handleSpeedAbort', () => {
        it('cancels an in-progress speed vote', async () => {
            const game = { id: 1 };
            const speedData = {
                id: 1, game_id: 1, message_id: 'speed-msg-id', channel_id: 'results-id',
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [speedData] }) // SELECT game_speed
                .mockResolvedValueOnce({ rows: [] });          // DELETE game_speed

            const mockSpeedMessage = { edit: jest.fn().mockResolvedValue(undefined) };
            const mockChannel = {
                messages: { fetch: jest.fn().mockResolvedValue(mockSpeedMessage) },
            };
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(mockChannel) };

            const msg = createMockMessage();
            await bot.handleSpeedAbort(msg, game);

            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM game_speed'),
                [game.id]
            );
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('aborted'));
        });
    });

    describe('completeSpeedVote', () => {
        it('notifies mod chat and cleans up when speed vote target is reached', async () => {
            const game = { id: 1, mod_chat_channel_id: 'mod-chat-id' };
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] }); // DELETE

            const modChatChannel = { send: jest.fn().mockResolvedValue({}) };
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(modChatChannel) };

            const speedMessage = {
                guild: { roles: { cache: { find: jest.fn().mockReturnValue(null) } } },
                channel: { id: 'results-channel-id' },
                edit: jest.fn().mockResolvedValue({}),
            };

            await bot.completeSpeedVote(game, speedMessage);

            expect(modChatChannel.send).toHaveBeenCalled();
            expect(speedMessage.edit).toHaveBeenCalled();
            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM game_speed'),
                [game.id]
            );
        });

        it('returns early when mod chat channel is not configured', async () => {
            const game = { id: 1, mod_chat_channel_id: null };
            const speedMessage = {
                edit: jest.fn(),
            };

            await bot.completeSpeedVote(game, speedMessage);

            // Should not edit the message or make DB calls
            expect(speedMessage.edit).not.toHaveBeenCalled();
        });
    });
});
