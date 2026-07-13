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
            // Alice hasn't voted, Bob has - only Alice should appear
            expect(reply.embeds[0].data.description).toContain('Alice');
            expect(reply.embeds[0].data.description).not.toContain('Bob');
        });
    });

    describe('sendRoleNotificationsToJournals (wolf chat adds)', () => {
        const GAME_ID = 1;
        const SERVER_ID = 'guild-123';

        let wolfChannel;
        let modChannel;
        let guild;

        const game = {
            is_skinned: false,
            is_themed: false,
            wolf_chat_channel_id: 'wolf-chat-id',
            mod_chat_channel_id: 'mod-chat-id',
        };

        const wolfPlayer = (n) => ({
            user_id: `wolf-${n}-id`,
            username: `Wolf${n}`,
            role_id: 10,
            is_wolf: true,
            role_name: 'Werewolf',
            in_wolf_chat: true,
            team: 'wolf',
            custom_name: null,
            charges_left: null,
            win_by_number: null,
        });

        beforeEach(() => {
            wolfChannel = {
                id: 'wolf-chat-id',
                permissionOverwrites: { edit: jest.fn().mockResolvedValue(undefined) },
                send: jest.fn().mockResolvedValue({ id: 'msg-1', pin: jest.fn().mockResolvedValue(undefined) }),
            };
            modChannel = {
                id: 'mod-chat-id',
                send: jest.fn().mockResolvedValue({ id: 'msg-2' }),
            };
            guild = {
                id: SERVER_ID,
                members: {
                    fetch: jest.fn().mockImplementation((userId) => Promise.resolve({ id: userId })),
                },
            };
            bot = createTestBot({
                guilds: {
                    cache: new Map(),
                    fetch: jest.fn().mockResolvedValue(guild),
                },
                channels: {
                    fetch: jest.fn().mockImplementation((channelId) => {
                        if (channelId === 'wolf-chat-id') return Promise.resolve(wolfChannel);
                        if (channelId === 'mod-chat-id') return Promise.resolve(modChannel);
                        return Promise.resolve(null);
                    }),
                },
            });
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] }) // game info
                .mockResolvedValueOnce({ rows: [wolfPlayer(1), wolfPlayer(2), wolfPlayer(3)] }); // players
        });

        it('adds all wolves to wolf chat using the game guild', async () => {
            const result = await bot.sendRoleNotificationsToJournals(GAME_ID, SERVER_ID);

            expect(bot.client.guilds.fetch).toHaveBeenCalledWith(SERVER_ID);
            expect(guild.members.fetch).toHaveBeenCalledTimes(3);
            expect(wolfChannel.permissionOverwrites.edit).toHaveBeenCalledTimes(3);
            expect(result.wolvesAddedToChat).toBe(3);
            expect(result.wolvesFailedToAdd).toBe(0);
            // No failures: mods should not be pinged
            expect(modChannel.send).not.toHaveBeenCalled();
        });

        it('still adds remaining wolves when one member fetch fails', async () => {
            guild.members.fetch = jest.fn().mockImplementation((userId) => {
                if (userId === 'wolf-2-id') return Promise.reject(new Error('Unknown Member'));
                return Promise.resolve({ id: userId });
            });

            const result = await bot.sendRoleNotificationsToJournals(GAME_ID, SERVER_ID);

            expect(wolfChannel.permissionOverwrites.edit).toHaveBeenCalledTimes(2);
            expect(wolfChannel.permissionOverwrites.edit).toHaveBeenCalledWith('wolf-1-id', expect.any(Object));
            expect(wolfChannel.permissionOverwrites.edit).toHaveBeenCalledWith('wolf-3-id', expect.any(Object));
            expect(result.wolvesAddedToChat).toBe(2);
            expect(result.wolvesFailedToAdd).toBe(1);
        });

        it('still adds remaining wolves when one permission edit fails', async () => {
            wolfChannel.permissionOverwrites.edit = jest.fn().mockImplementation((userId) => {
                if (userId === 'wolf-1-id') return Promise.reject(new Error('Missing Permissions'));
                return Promise.resolve(undefined);
            });

            const result = await bot.sendRoleNotificationsToJournals(GAME_ID, SERVER_ID);

            expect(wolfChannel.permissionOverwrites.edit).toHaveBeenCalledTimes(3);
            expect(result.wolvesAddedToChat).toBe(2);
            expect(result.wolvesFailedToAdd).toBe(1);
        });

        it('notifies mod chat listing exactly which players failed to be added', async () => {
            guild.members.fetch = jest.fn().mockImplementation((userId) => {
                if (userId === 'wolf-2-id') return Promise.reject(new Error('Unknown Member'));
                return Promise.resolve({ id: userId });
            });

            await bot.sendRoleNotificationsToJournals(GAME_ID, SERVER_ID);

            expect(bot.client.channels.fetch).toHaveBeenCalledWith('mod-chat-id');
            expect(modChannel.send).toHaveBeenCalledTimes(1);
            const payload = modChannel.send.mock.calls[0][0];
            const description = payload.embeds[0].data.description;
            expect(description).toContain('Wolf2');
            expect(description).toContain('wolf-2-id');
            expect(description).not.toContain('Wolf1');
            expect(description).not.toContain('Wolf3');
        });

        it('notifies mod chat when the wolf chat channel itself cannot be fetched', async () => {
            bot.client.channels.fetch = jest.fn().mockImplementation((channelId) => {
                if (channelId === 'wolf-chat-id') return Promise.reject(new Error('Unknown Channel'));
                if (channelId === 'mod-chat-id') return Promise.resolve(modChannel);
                return Promise.resolve(null);
            });

            const result = await bot.sendRoleNotificationsToJournals(GAME_ID, SERVER_ID);

            expect(result.wolvesAddedToChat).toBe(0);
            expect(result.wolvesFailedToAdd).toBe(3);
            expect(modChannel.send).toHaveBeenCalledTimes(1);
            const description = modChannel.send.mock.calls[0][0].embeds[0].data.description;
            expect(description).toContain('Wolf1');
            expect(description).toContain('Wolf2');
            expect(description).toContain('Wolf3');
        });
    });
});
