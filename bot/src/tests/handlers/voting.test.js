'use strict';

const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage } = require('../helpers/mock-discord');

describe('Voting Handlers', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    describe('handleVote', () => {
        it('replies with error when no active game found', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });
            const msg = createMockMessage({ content: 'Wolf.vote @Someone' });
            await bot.handleVote(msg, ['@Someone']);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('No active game'));
        });

        it('casts a vote for a valid alive player', async () => {
            const game = {
                id: 1, day_phase: 'day', day_number: 2,
                voting_booth_channel_id: 'booth-id', votes_to_hang: 5,
                voting_message_id: 'vote-msg-id',
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })                          // active game
                .mockResolvedValueOnce({ rows: [{ user_id: 'user-123' }] })       // voter in game
                .mockResolvedValueOnce({ rows: [{ user_id: 'target-user-id' }] }) // target in game
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })                 // DELETE existing vote
                .mockResolvedValueOnce({ rows: [], rowCount: 1 });                // INSERT new vote

            bot.updateVotingMessage = jest.fn().mockResolvedValue(undefined);

            const msg = createMockMessage();
            msg.channel.id = 'booth-id';
            msg.member.roles.cache.has = jest.fn().mockReturnValue(true); // voter is alive
            msg.mentions.users.first = jest.fn().mockReturnValue({ id: 'target-user-id' });
            msg.react = jest.fn().mockResolvedValue(undefined);

            const mockTarget = { id: 'target-user-id', roles: { cache: { has: jest.fn().mockReturnValue(true) } } };
            msg.guild.members.fetch = jest.fn().mockResolvedValue(mockTarget);
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [{ id: 'alive-id', name: 'Alive' }].find(fn) || null
            );

            await bot.handleVote(msg);

            expect(msg.react).toHaveBeenCalledWith('✅');
            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO votes'),
                expect.any(Array)
            );
        });

        it('rejects vote when voter is dead', async () => {
            const game = {
                id: 1, day_phase: 'day', day_number: 2,
                voting_booth_channel_id: 'booth-id', votes_to_hang: 5,
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [{ user_id: 'user-123' }] }); // voter in game

            const msg = createMockMessage();
            msg.channel.id = 'booth-id';
            // member.roles.cache.has returns false by default (no Alive role)
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [{ id: 'alive-id', name: 'Alive' }].find(fn) || null
            );

            await bot.handleVote(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('not an alive player'));
        });

        it('replaces an existing vote with a new one', async () => {
            const game = {
                id: 1, day_phase: 'day', day_number: 2,
                voting_booth_channel_id: 'booth-id', votes_to_hang: 5,
                voting_message_id: 'vote-msg-id',
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [{ user_id: 'user-123' }] })
                .mockResolvedValueOnce({ rows: [{ user_id: 'target-user-id' }] })
                .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // DELETE removes old vote
                .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT new vote

            bot.updateVotingMessage = jest.fn().mockResolvedValue(undefined);

            const msg = createMockMessage();
            msg.channel.id = 'booth-id';
            msg.member.roles.cache.has = jest.fn().mockReturnValue(true);
            msg.mentions.users.first = jest.fn().mockReturnValue({ id: 'target-user-id' });
            msg.react = jest.fn().mockResolvedValue(undefined);

            const mockTarget = { id: 'target-user-id', roles: { cache: { has: jest.fn().mockReturnValue(true) } } };
            msg.guild.members.fetch = jest.fn().mockResolvedValue(mockTarget);
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [{ id: 'alive-id', name: 'Alive' }].find(fn) || null
            );

            await bot.handleVote(msg);

            const deleteCall = bot.db.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM votes'));
            const insertCall = bot.db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO votes'));
            expect(deleteCall).toBeDefined();
            expect(insertCall).toBeDefined();
            expect(msg.react).toHaveBeenCalledWith('✅');
        });
    });

    describe('handleRetract', () => {
        it('removes the voter\'s current vote', async () => {
            const game = {
                id: 1, day_phase: 'day', day_number: 2,
                voting_booth_channel_id: 'booth-id', voting_message_id: 'vote-msg-id',
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE found a vote

            bot.updateVotingMessage = jest.fn().mockResolvedValue(undefined);

            const msg = createMockMessage();
            msg.channel.id = 'booth-id';
            msg.react = jest.fn().mockResolvedValue(undefined);

            await bot.handleRetract(msg);
            expect(msg.react).toHaveBeenCalledWith('✅');
        });

        it('replies with error when voter has no active vote', async () => {
            const game = {
                id: 1, day_phase: 'day', day_number: 2,
                voting_booth_channel_id: 'booth-id',
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // DELETE found nothing

            const msg = createMockMessage();
            msg.channel.id = 'booth-id';

            await bot.handleRetract(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('no vote to retract'));
        });
    });

    describe('handleVoteCount', () => {
        it('displays current vote tallies in an embed', async () => {
            const game = {
                id: 1, day_phase: 'day', day_number: 2, votes_to_hang: 5,
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [
                    { target_username: 'Alice', vote_count: 3 },
                    { target_username: 'Bob', vote_count: 1 },
                ] });

            const msg = createMockMessage();
            await bot.handleVoteCount(msg);

            const reply = msg.reply.mock.calls[0][0];
            expect(reply).toMatchObject({ embeds: expect.any(Array) });
            expect(reply.embeds[0].data.title).toContain('Vote totals');
            expect(reply.embeds[0].data.description).toContain('Alice');
        });

        it('replies with error when no active game', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });
            const msg = createMockMessage();
            await bot.handleVoteCount(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('No active game'));
        });
    });

    describe('updateVotingMessage', () => {
        it('edits the pinned voting message with updated tallies', async () => {
            const game = {
                id: 1, day_number: 2, votes_to_hang: 5,
                voting_booth_channel_id: 'booth-id',
                voting_message_id: 'vote-msg-id',
            };

            const mockVotingMessage = { id: 'vote-msg-id', edit: jest.fn().mockResolvedValue(undefined) };
            const mockVotingChannel = {
                messages: { fetch: jest.fn().mockResolvedValue(mockVotingMessage) },
            };
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(mockVotingChannel) };

            bot.db.query = jest.fn().mockResolvedValue({
                rows: [{
                    target_username: 'Alice',
                    vote_count: 2,
                    voters: ['Bob', 'Carol'],
                }],
            });

            await bot.updateVotingMessage(game);

            expect(mockVotingMessage.edit).toHaveBeenCalledWith(
                expect.objectContaining({ embeds: expect.any(Array) })
            );
            const embed = mockVotingMessage.edit.mock.calls[0][0].embeds[0];
            expect(embed.data.fields[0].value).toContain('Alice');
        });
    });

    describe('handleRatio', () => {
        it('replies with the vote-to-alive-player ratio', async () => {
            const game = { id: 1, game_number: 3 };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [
                    { team: 'town', cnt: '8' },
                    { team: 'wolf', cnt: '2' },
                    { team: 'neutral', cnt: '1' },
                ] });

            const msg = createMockMessage();
            await bot.handleRatio(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('8-2-1'));
        });
    });

    describe('handleWolvesAlive', () => {
        it('displays wolf count when called by a moderator', async () => {
            const game = { id: 1, game_number: 1 };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [{ user_id: 'wolf-1', username: 'WolfPlayer' }] });

            const msg = createMockMessage();
            // Grant mod permissions so the access guard passes
            msg.member.permissions.has = jest.fn().mockReturnValue(true);

            const aliveRole = { id: 'alive-id', name: 'Alive' };
            const deadRole = { id: 'dead-id', name: 'Dead' };
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [aliveRole, deadRole].find(fn) || null
            );

            // Wolf player is in cache and has Alive role
            msg.guild.members.cache = new Map([
                ['wolf-1', { roles: { cache: { has: jest.fn().mockReturnValue(true) } } }],
            ]);

            await bot.handleWolvesAlive(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('1'));
        });
    });

    describe('handleNotVoted', () => {
        it('lists alive players who have not voted', async () => {
            const game = { id: 1, day_phase: 'day', day_number: 2 };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [
                    { user_id: 'user-1', username: 'Alice' },
                    { user_id: 'user-2', username: 'Bob' },
                ] })
                .mockResolvedValueOnce({ rows: [{ voter_user_id: 'user-2' }] }); // Bob has voted

            const aliveRole = { id: 'alive-id', name: 'Alive' };
            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [aliveRole].find(fn) || null
            );
            msg.guild.members.cache = new Map([
                ['user-1', { roles: { cache: { has: jest.fn().mockReturnValue(true) } } }],
                ['user-2', { roles: { cache: { has: jest.fn().mockReturnValue(true) } } }],
            ]);

            await bot.handleNotVoted(msg);

            const reply = msg.reply.mock.calls[0][0];
            expect(reply).toMatchObject({ embeds: expect.any(Array) });
            // Alice hasn't voted, Bob has — only Alice should appear
            expect(reply.embeds[0].data.description).toContain('Alice');
            expect(reply.embeds[0].data.description).not.toContain('Bob');
        });
    });
});
