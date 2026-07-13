'use strict';

const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage } = require('../helpers/mock-discord');

describe('LSSV Handler', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    const activeGame = {
        id: 1,
        day_phase: 'day',
        day_number: 3,
        voting_booth_channel_id: 'booth-id',
        votes_to_hang: 4,
    };

    const players = [
        { user_id: 'v1', username: 'Alice' },
        { user_id: 'v2', username: 'Bob' },
        { user_id: 'v3', username: 'Carol' },
        { user_id: 't1', username: 'Dave' },
        { user_id: 't2', username: 'Eve' },
    ];

    describe('handleLssv', () => {
        it('replies with error when no active game found', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });
            const msg = createMockMessage();
            await bot.handleLssv(msg, []);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('No active game'));
        });

        it('rejects an invalid day argument', async () => {
            bot.db.query = jest.fn().mockResolvedValueOnce({ rows: [activeGame] });
            const msg = createMockMessage();
            await bot.handleLssv(msg, ['7']);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('between 1 and 3'));
        });

        it('reports when no votes have been cast today', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [activeGame] })
                .mockResolvedValueOnce({ rows: [] }); // live votes
            const msg = createMockMessage();
            await bot.handleLssv(msg, []);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('No votes have been cast yet today'));
        });

        it('lists current-day standing votes in cast order with LSSV winner', async () => {
            const standingVotes = [
                { voter_user_id: 'v1', target_user_id: 't1', cast_at: '2026-07-13T10:00:00Z' },
                { voter_user_id: 'v2', target_user_id: 't1', cast_at: '2026-07-13T10:05:00Z' },
                { voter_user_id: 'v3', target_user_id: 't2', cast_at: '2026-07-13T10:10:00Z' },
            ];
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [activeGame] })
                .mockResolvedValueOnce({ rows: standingVotes })
                .mockResolvedValueOnce({ rows: players });

            const msg = createMockMessage();
            await bot.handleLssv(msg, []);

            expect(msg.reply).toHaveBeenCalledWith({ embeds: [expect.anything()] });
            const embed = msg.reply.mock.calls[0][0].embeds[0];
            expect(embed.data.title).toContain('Day 3');

            const castOrderField = embed.data.fields[0].value;
            const lines = castOrderField.split('\n');
            expect(lines[0]).toContain('Alice');
            expect(lines[0]).toContain('Dave');
            expect(lines[1]).toContain('Bob');
            expect(lines[2]).toContain('Carol');

            // Dave has 2 standing votes; his second landed at 10:05 - LSSV holder
            const lssvField = embed.data.fields[1].value;
            expect(lssvField).toContain('Dave');
            expect(lssvField).toContain('2 votes');
            expect(lssvField).toContain('🏆');
            expect(lssvField).not.toContain('Eve');

            // Current day must read from the live votes table
            expect(bot.db.query.mock.calls[1][0]).toContain('FROM votes');
        });

        it('reconstructs a past day from vote_history and drops retracted voters', async () => {
            // DISTINCT ON gives each voter's final action; Carol retracted, so she has no standing vote.
            // Rows arrive unsorted to verify chronological re-sort.
            const historyRows = [
                { voter_user_id: 'v2', target_user_id: 't1', action: 'vote', cast_at: '2026-07-12T15:30:00Z' },
                { voter_user_id: 'v3', target_user_id: null, action: 'retract', cast_at: '2026-07-12T16:00:00Z' },
                { voter_user_id: 'v1', target_user_id: 't1', action: 'vote', cast_at: '2026-07-12T14:00:00Z' },
            ];
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [activeGame] })
                .mockResolvedValueOnce({ rows: historyRows })
                .mockResolvedValueOnce({ rows: players });

            const msg = createMockMessage();
            await bot.handleLssv(msg, ['2']);

            const embed = msg.reply.mock.calls[0][0].embeds[0];
            expect(embed.data.title).toContain('Day 2');

            const castOrderField = embed.data.fields[0].value;
            const lines = castOrderField.split('\n');
            expect(lines).toHaveLength(2);
            expect(lines[0]).toContain('Alice'); // 14:00 before 15:30
            expect(lines[1]).toContain('Bob');
            expect(castOrderField).not.toContain('Carol');

            // Past day must read from vote_history
            expect(bot.db.query.mock.calls[1][0]).toContain('FROM vote_history');
        });

        it('reports missing history for a past day', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [activeGame] })
                .mockResolvedValueOnce({ rows: [] });
            const msg = createMockMessage();
            await bot.handleLssv(msg, ['1']);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('No final votes recorded for Day 1'));
        });
    });

    describe('logVoteAction', () => {
        it('inserts a vote event into vote_history', async () => {
            await bot.logVoteAction(1, 3, 'v1', 't1', 'vote');
            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO vote_history'),
                [1, 3, 'v1', 't1', 'vote']
            );
        });

        it('inserts a retract event with null target', async () => {
            await bot.logVoteAction(1, 3, 'v1', null, 'retract');
            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO vote_history'),
                [1, 3, 'v1', null, 'retract']
            );
        });

        it('swallows database errors so voting is not blocked', async () => {
            bot.db.query = jest.fn().mockRejectedValue(new Error('db down'));
            await expect(bot.logVoteAction(1, 3, 'v1', 't1', 'vote')).resolves.toBeUndefined();
        });
    });
});
