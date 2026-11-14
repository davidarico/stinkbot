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

        it('pins the new phase message in town square and unpins the previous one', async () => {
            const game = {
                id: 1, day_phase: 'night', day_number: 1, game_number: 1,
                voting_booth_channel_id: 'booth-id',
                town_square_channel_id: 'ts-id',
                wolf_chat_channel_id: null,
                votes_to_hang: 5,
                last_phase_pin_message_id: 'old-pin-id',
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })  // SELECT games
                .mockResolvedValueOnce({ rows: [] })      // UPDATE games phase
                .mockResolvedValueOnce({ rows: [] })      // SELECT game_channels (phase messages)
                .mockResolvedValueOnce({ rows: [] })      // UPDATE games SET last_phase_pin_message_id
                .mockResolvedValueOnce({ rows: [] });     // SELECT game_channels (permissions)

            bot.createVotingMessage = jest.fn().mockResolvedValue(undefined);

            const mockVotingChannel = makeMockVotingChannel();
            const previousPin = { unpin: jest.fn().mockResolvedValue(undefined) };
            const newPinMessage = { id: 'new-pin-id', pin: jest.fn().mockResolvedValue(undefined) };
            const townSquareChannel = {
                send: jest.fn().mockResolvedValue(newPinMessage),
                messages: { fetch: jest.fn().mockResolvedValue(previousPin) },
            };

            bot.client.channels = {
                fetch: jest.fn().mockImplementation((channelId) => {
                    if (channelId === 'ts-id') return Promise.resolve(townSquareChannel);
                    return Promise.resolve(mockVotingChannel);
                }),
            };

            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [{ id: 'alive-id', name: 'Alive' }].find(fn) || null
            );

            await bot.handleNext(msg);

            expect(townSquareChannel.messages.fetch).toHaveBeenCalledWith('old-pin-id');
            expect(previousPin.unpin).toHaveBeenCalled();
            expect(newPinMessage.pin).toHaveBeenCalled();
            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE games SET last_phase_pin_message_id'),
                ['new-pin-id', game.id]
            );
        });
    });

    describe('handleNext rollback snapshot', () => {
        it('stores the phase it is leaving so Wolf.rollback can undo it', async () => {
            const game = {
                id: 1, day_phase: 'night', day_number: 2, game_number: 1,
                voting_booth_channel_id: 'booth-id', town_square_channel_id: null, wolf_chat_channel_id: null,
                votes_to_hang: 5, phase_change_at: '2026-11-13T02:00:00.000Z',
                voting_message_id: null, last_phase_pin_message_id: 'pin-night-2',
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValue({ rows: [] });
            bot.createVotingMessage = jest.fn().mockResolvedValue(undefined);
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(makeMockVotingChannel()) };

            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [{ id: 'alive-id', name: 'Alive' }].find(fn) || null
            );

            await bot.handleNext(msg);

            const updateCall = bot.db.query.mock.calls.find(([sql]) => sql.includes('last_next_snapshot = $5'));
            expect(JSON.parse(updateCall[1][4])).toEqual({
                day_phase: 'night',
                day_number: 2,
                phase_change_at: '2026-11-13T02:00:00.000Z',
                voting_message_id: null,
                last_phase_pin_message_id: 'pin-night-2',
            });
        });
    });

    describe('handleRollback', () => {
        const aliveRole = { id: 'alive-id', name: 'Alive' };

        function setupRollback(game, answer = 'confirm') {
            const votingChannel = {
                permissionOverwrites: { edit: jest.fn().mockResolvedValue(undefined) },
                messages: { fetch: jest.fn().mockResolvedValue({ delete: jest.fn().mockResolvedValue(undefined) }) },
                send: jest.fn().mockResolvedValue({ id: 'msg' }),
            };
            const pins = {
                'pin-current': { pin: jest.fn().mockResolvedValue(undefined), unpin: jest.fn().mockResolvedValue(undefined) },
                'pin-previous': { pin: jest.fn().mockResolvedValue(undefined), unpin: jest.fn().mockResolvedValue(undefined) },
            };
            const townSquare = {
                messages: { fetch: jest.fn().mockImplementation(async (id) => pins[id]) },
                send: jest.fn().mockResolvedValue({ id: 'announce' }),
            };
            bot.client.channels = {
                fetch: jest.fn().mockImplementation(async (id) => (id === 'ts-id' ? townSquare : votingChannel)),
            };
            bot.updateVotingMessage = jest.fn().mockResolvedValue(undefined);

            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn => [aliveRole].find(fn) || null);
            msg.channel.awaitMessages = jest.fn().mockResolvedValue({
                size: 1,
                first: jest.fn().mockReturnValue({ content: answer }),
            });
            return { msg, votingChannel, townSquare, pins };
        }

        const nightGame = {
            id: 1, day_phase: 'night', day_number: 2, game_number: 1,
            voting_booth_channel_id: 'booth-id', town_square_channel_id: 'ts-id',
            voting_message_id: null, last_phase_pin_message_id: 'pin-current',
            last_next_snapshot: {
                day_phase: 'day', day_number: 2, phase_change_at: '2026-11-13T14:00:00.000Z',
                voting_message_id: 'vote-msg-day-2', last_phase_pin_message_id: 'pin-previous',
            },
        };

        it('replies with error when no active game', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });
            const msg = createMockMessage();
            await bot.handleRollback(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('No active game'));
        });

        it('refuses when there is no Wolf.next to undo', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, day_phase: 'night', day_number: 1, last_next_snapshot: null }] });
            const msg = createMockMessage();
            await bot.handleRollback(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Nothing to roll back'));
            expect(bot.db.query).toHaveBeenCalledTimes(1);
        });

        it('changes nothing when the mod cancels', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [nightGame] });
            const { msg } = setupRollback(nightGame, 'cancel');
            await bot.handleRollback(msg);
            expect(msg.reply).toHaveBeenLastCalledWith(expect.stringContaining('Rollback cancelled'));
            expect(bot.db.query).toHaveBeenCalledTimes(1);
        });

        it('undoing nightfall restores the day, its standing votes, the pin and the voting booth', async () => {
            bot.db.query = jest.fn().mockImplementation(async (sql) => {
                if (sql.startsWith('SELECT * FROM games')) return { rows: [nightGame] };
                if (sql.includes('INSERT INTO votes')) return { rows: [], rowCount: 3 };
                return { rows: [], rowCount: 0 };
            });
            const { msg, votingChannel, townSquare, pins } = setupRollback(nightGame);

            await bot.handleRollback(msg);

            const calls = bot.db.query.mock.calls;
            const restoreVotes = calls.find(([sql]) => sql.includes('INSERT INTO votes'));
            expect(restoreVotes[0]).toContain('FROM vote_history');
            expect(restoreVotes[0]).toContain("action = 'vote'");
            expect(restoreVotes[1]).toEqual([1, 2]);

            const updateGame = calls.find(([sql]) => sql.includes('last_next_snapshot = NULL'));
            expect(updateGame[1]).toEqual(['day', 2, '2026-11-13T14:00:00.000Z', 'vote-msg-day-2', 'pin-previous', 1]);

            // vote_history is only pruned when a day start is undone
            expect(calls.some(([sql]) => sql.includes('DELETE FROM vote_history'))).toBe(false);

            expect(votingChannel.permissionOverwrites.edit).toHaveBeenCalledWith('alive-id', { SendMessages: true });
            expect(bot.updateVotingMessage).toHaveBeenCalledWith(expect.objectContaining({ day_phase: 'day', voting_message_id: 'vote-msg-day-2' }));
            expect(pins['pin-current'].unpin).toHaveBeenCalled();
            expect(pins['pin-previous'].pin).toHaveBeenCalled();
            expect(townSquare.send).toHaveBeenCalled();

            const lastReply = msg.reply.mock.calls.at(-1)[0];
            expect(lastReply.embeds[0].data.description).toContain('Restored **3** standing votes');
        });

        it('undoing a day start deletes the new voting message and that day\'s votes', async () => {
            const dayGame = {
                ...nightGame, day_phase: 'day', day_number: 3, voting_message_id: 'vote-msg-day-3',
                last_next_snapshot: {
                    day_phase: 'night', day_number: 2, phase_change_at: '2026-11-14T02:00:00.000Z',
                    voting_message_id: null, last_phase_pin_message_id: 'pin-previous',
                },
            };
            bot.db.query = jest.fn().mockImplementation(async (sql) => (
                sql.startsWith('SELECT * FROM games') ? { rows: [dayGame] } : { rows: [], rowCount: 0 }
            ));
            const { msg, votingChannel } = setupRollback(dayGame);

            await bot.handleRollback(msg);

            const calls = bot.db.query.mock.calls;
            expect(votingChannel.messages.fetch).toHaveBeenCalledWith('vote-msg-day-3');
            expect(calls.find(([sql]) => sql.includes('DELETE FROM vote_history'))[1]).toEqual([1, 3]);
            expect(calls.some(([sql]) => sql.includes('INSERT INTO votes'))).toBe(false);
            expect(calls.find(([sql]) => sql.includes('last_next_snapshot = NULL'))[1].slice(0, 2)).toEqual(['night', 2]);
            expect(votingChannel.permissionOverwrites.edit).toHaveBeenCalledWith('alive-id', { SendMessages: false });
            expect(bot.updateVotingMessage).not.toHaveBeenCalled();
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

    describe('recording the winner', () => {
        function setupEndWithAnswers(msg, answers) {
            const queue = [...answers];
            msg.channel.awaitMessages = jest.fn().mockImplementation(async ({ filter }) => {
                const content = queue.shift();
                // Mirrors discord.js: an answer the filter rejects is never collected
                if (content === undefined || !filter({ author: { id: msg.author.id }, content })) {
                    return { size: 0, first: jest.fn() };
                }
                return { size: 1, first: jest.fn().mockReturnValue({ content }) };
            });
            msg.guild.channels.fetch = jest.fn().mockResolvedValue({
                children: { cache: { filter: jest.fn().mockReturnValue(new Map()) } },
            });
        }

        it('asks who won when an active game ends and stores the answer', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ id: 1, game_number: 1, status: 'active' }] })
                .mockResolvedValue({ rows: [] });
            const msg = createMockMessage();
            setupEndWithAnswers(msg, ['confirm', 'Wolves']);

            await bot.handleEnd(msg);

            const updateCall = bot.db.query.mock.calls.find(([sql]) => sql.includes('UPDATE games SET status'));
            expect(updateCall[1]).toEqual(['ended', 'wolf', 1]);
            expect(msg.reply.mock.calls.at(-1)[0].embeds[0].data.description).toContain('**Winner:** Wolves');
        });

        it('ends the game with no winner when the question goes unanswered', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ id: 1, game_number: 1, status: 'active' }] })
                .mockResolvedValue({ rows: [] });
            const msg = createMockMessage();
            setupEndWithAnswers(msg, ['confirm', 'skip']);

            await bot.handleEnd(msg);

            const updateCall = bot.db.query.mock.calls.find(([sql]) => sql.includes('UPDATE games SET status'));
            expect(updateCall[1]).toEqual(['ended', null, 1]);
            expect(msg.reply.mock.calls.at(-1)[0].embeds[0].data.description).toContain('Wolf.winner');
        });

        it('does not ask for a winner when the game never left signups', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ id: 1, game_number: 1, status: 'signup' }] })
                .mockResolvedValue({ rows: [] });
            const msg = createMockMessage();
            setupEndWithAnswers(msg, ['confirm']);

            await bot.handleEnd(msg);

            expect(msg.channel.awaitMessages).toHaveBeenCalledTimes(1);
        });

        it('Wolf.winner sets the winner of the last ended game', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ id: 9, game_number: 4, game_name: 'Stinkwolf' }] })
                .mockResolvedValueOnce({ rows: [] });
            const msg = createMockMessage();

            await bot.handleWinner(msg, ['town']);

            expect(bot.db.query.mock.calls[1][1]).toEqual(['town', 9]);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Stinkwolf Game 4'));
        });

        it('Wolf.winner rejects an unknown team', async () => {
            const msg = createMockMessage();
            await bot.handleWinner(msg, ['banana']);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Usage'));
            expect(bot.db.query).not.toHaveBeenCalled();
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

    describe('handleScuff with dead players (feedback #57)', () => {
        it('moves Dead players back to Signed Up along with the living', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ id: 1, game_number: 3, status: 'active' }] })
                .mockResolvedValue({ rows: [] });

            const msg = createMockMessage();
            msg.channel.awaitMessages = jest.fn().mockResolvedValue({
                size: 1,
                first: jest.fn().mockReturnValue({ content: 'confirm' }),
            });
            const roleMap = [
                { id: 'alive-id', name: 'Alive' },
                { id: 'dead-id', name: 'Dead' },
                { id: 'signedup-id', name: 'Signed Up' },
            ];
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn => roleMap.find(fn) || null);

            const makeMember = (name, roleIds) => ({
                displayName: name,
                user: { bot: false },
                guild: msg.guild,
                roles: {
                    cache: { has: jest.fn().mockImplementation(id => roleIds.includes(id)) },
                    add: jest.fn().mockResolvedValue(undefined),
                    remove: jest.fn().mockResolvedValue(undefined),
                },
            });
            const alive = makeMember('Alive Anna', ['alive-id']);
            const dead = makeMember('Dead Dan', ['dead-id']);
            const spectator = makeMember('Spectator Sam', []);
            const members = [alive, dead, spectator];
            msg.guild.members.cache = {
                filter: (fn) => new Map(members.filter(fn).map((m, i) => [`m-${i}`, m])),
            };

            await bot.handleScuff(msg);

            expect(dead.roles.remove).toHaveBeenCalledWith(roleMap[1]);
            expect(dead.roles.add).toHaveBeenCalledWith(roleMap[2]);
            expect(alive.roles.remove).toHaveBeenCalledWith(roleMap[0]);
            expect(alive.roles.add).toHaveBeenCalledWith(roleMap[2]);
            expect(spectator.roles.add).not.toHaveBeenCalled();
            expect(msg.reply).toHaveBeenLastCalledWith(expect.stringContaining('**2/2** Alive and Dead members'));
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
