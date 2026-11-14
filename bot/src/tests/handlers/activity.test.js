'use strict';

const moment = require('moment-timezone');
const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage } = require('../helpers/mock-discord');

describe('Message Activity Tracking', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    describe('parseIaResetTime', () => {
        it('accepts times on the hour or half hour, with or without a colon', () => {
            expect(bot.parseIaResetTime('09:30')).toBe('09:30');
            expect(bot.parseIaResetTime('0:00')).toBe('00:00');
            expect(bot.parseIaResetTime('0000')).toBe('00:00');
            expect(bot.parseIaResetTime('2330')).toBe('23:30');
        });

        it('rejects anything that is not on a half-hour bucket boundary', () => {
            expect(bot.parseIaResetTime('0001')).toBeNull();
            expect(bot.parseIaResetTime('24:00')).toBeNull();
            expect(bot.parseIaResetTime('noon')).toBeNull();
            expect(bot.parseIaResetTime(undefined)).toBeNull();
        });
    });

    describe('currentIaWindowStart', () => {
        it('uses today when the reset time has passed', () => {
            const now = moment.tz('2026-11-14 15:00', 'America/New_York');
            expect(bot.currentIaWindowStart('09:30', now).format('YYYY-MM-DD HH:mm')).toBe('2026-11-14 09:30');
        });

        it('uses yesterday before the reset time', () => {
            const now = moment.tz('2026-11-14 08:00', 'America/New_York');
            expect(bot.currentIaWindowStart('09:30', now).format('YYYY-MM-DD HH:mm')).toBe('2026-11-13 09:30');
        });

        it('starts at midnight for a 00:00 reset, so morning messages count (feedback #49)', () => {
            const now = moment.tz('2026-11-14 08:00', 'America/New_York');
            expect(bot.currentIaWindowStart('00:00', now).format('YYYY-MM-DD HH:mm')).toBe('2026-11-14 00:00');
        });
    });

    describe('recordMessageActivity', () => {
        const game = {
            id: 7, category_id: 'game-cat', day_number: 3, day_phase: 'day',
            activity_tracked_since: new Date('2026-11-01T00:00:00Z'),
        };

        function makeMessage(overrides = {}) {
            return {
                guild: { id: 'guild-1' },
                channel: { id: 'town-square', parentId: 'game-cat' },
                author: { id: 'user-1', bot: false },
                createdAt: new Date('2026-11-14T15:47:12Z'),
                ...overrides,
            };
        }

        it('counts a message in the game category into its half-hour bucket', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })  // active game lookup
                .mockResolvedValueOnce({ rows: [] });     // upsert

            await bot.recordMessageActivity(makeMessage());

            const [sql, params] = bot.db.query.mock.calls[1];
            expect(sql).toContain('INSERT INTO message_activity');
            expect(sql).toContain('ON CONFLICT');
            expect(params).toEqual([7, 'town-square', 'user-1', 3, 'day', '2026-11-14T15:30:00.000Z']);
        });

        it('ignores messages outside the game category', async () => {
            bot.db.query = jest.fn().mockResolvedValueOnce({ rows: [game] });

            await bot.recordMessageActivity(makeMessage({ channel: { id: 'general', parentId: 'other-cat' } }));

            expect(bot.db.query).toHaveBeenCalledTimes(1);
        });

        it('ignores bots without touching the database', async () => {
            bot.db.query = jest.fn();

            await bot.recordMessageActivity(makeMessage({ author: { id: 'bot-1', bot: true } }));

            expect(bot.db.query).not.toHaveBeenCalled();
        });

        it('caches the active game between messages and refetches after invalidation', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [game] });

            await bot.recordMessageActivity(makeMessage());
            await bot.recordMessageActivity(makeMessage());
            // 1 game lookup + 2 upserts
            expect(bot.db.query).toHaveBeenCalledTimes(3);

            bot.invalidateActivityGameCache('guild-1');
            await bot.recordMessageActivity(makeMessage());
            // another lookup + upsert
            expect(bot.db.query).toHaveBeenCalledTimes(5);
        });

        it('stamps activity_tracked_since for a game that was already running', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ ...game, activity_tracked_since: null }] })
                .mockResolvedValueOnce({ rows: [{ activity_tracked_since: new Date() }] })
                .mockResolvedValueOnce({ rows: [] });

            await bot.recordMessageActivity(makeMessage());

            expect(bot.db.query.mock.calls[1][0]).toContain('UPDATE games SET activity_tracked_since');
        });

        it('never throws when the database fails', async () => {
            bot.db.query = jest.fn().mockRejectedValue(new Error('DB down'));

            await expect(bot.recordMessageActivity(makeMessage())).resolves.toBeUndefined();
        });
    });

    describe('isActivityTrackedSince', () => {
        it('is false when tracking never started', () => {
            expect(bot.isActivityTrackedSince({ activity_tracked_since: null }, new Date())).toBe(false);
        });

        it('is true when tracking began before the window', () => {
            const game = { activity_tracked_since: '2026-11-14T10:00:00Z' };
            expect(bot.isActivityTrackedSince(game, '2026-11-14T14:30:00Z')).toBe(true);
            expect(bot.isActivityTrackedSince(game, '2026-11-14T09:00:00Z')).toBe(false);
        });

        it('is true when tracking began before the channel existed', () => {
            const game = { activity_tracked_since: '2026-11-14T10:00:00Z' };
            const channel = { createdTimestamp: new Date('2026-11-14T10:00:05Z').getTime() };
            expect(bot.isActivityTrackedSince(game, '2026-11-14T09:00:00Z', channel)).toBe(true);
        });
    });

    describe('handleSilent', () => {
        it('lists alive players with no tracked messages today', async () => {
            const game = {
                id: 1, day_number: 2, day_phase: 'day',
                town_square_channel_id: 'ts', voting_booth_channel_id: 'vb', memos_channel_id: 'memos',
                activity_tracked_since: '2026-11-01T00:00:00Z', phase_change_at: '2026-11-14T00:00:00Z',
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [
                    { user_id: 'u1', username: 'Chatty' },
                    { user_id: 'u2', username: 'Quiet' },
                    { user_id: 'u3', username: 'DeadGuy' },
                ] })
                .mockResolvedValueOnce({ rows: [{ user_id: 'u1', message_count: 12 }] });

            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [{ id: 'alive-id', name: 'Alive' }].find(fn) || null
            );
            const withAlive = (alive) => ({ roles: { cache: { has: jest.fn().mockReturnValue(alive) } } });
            msg.guild.members.cache = new Map([['u1', withAlive(true)], ['u2', withAlive(true)], ['u3', withAlive(false)]]);

            await bot.handleSilent(msg);

            const countCall = bot.db.query.mock.calls[2];
            expect(countCall[1]).toEqual([1, ['ts', 'vb', 'memos'], 2]);
            const description = msg.reply.mock.calls[0][0].embeds[0].data.description;
            expect(description).toContain('1. Quiet');
            expect(description).not.toContain('Chatty');
            expect(description).not.toContain('DeadGuy');
        });
    });
});
