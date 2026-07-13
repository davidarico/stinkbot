'use strict';

const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage, createMockMember } = require('../helpers/mock-discord');

describe('Couple Chat Permissions', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    function makeMockChannel(name) {
        return {
            name,
            permissionOverwrites: { edit: jest.fn().mockResolvedValue(undefined) },
            send: jest.fn().mockResolvedValue({ id: 'msg-123' }),
        };
    }

    describe('handleNext phase permissions (feedback #82 - couple chat is night-only)', () => {
        it('revokes couple chat send permission at day start even when open_at_dawn is true', async () => {
            const game = {
                id: 1, day_phase: 'night', day_number: 1, game_number: 1,
                voting_booth_channel_id: 'booth-id',
                town_square_channel_id: null,
                wolf_chat_channel_id: null,
                votes_to_hang: 5,
                day_message: 'Wake up!', night_message: 'Sleep!',
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })  // SELECT games
                .mockResolvedValueOnce({ rows: [] })      // UPDATE games phase
                .mockResolvedValueOnce({ rows: [] })      // SELECT game_channels (phase messages)
                .mockResolvedValueOnce({ rows: [        // SELECT game_channels (permissions)
                    // open_at_dawn defaults to TRUE in the schema - couple chat must be
                    // forced shut during the day regardless of the flag.
                    { channel_id: 'couple-id', open_at_dawn: true, open_at_dusk: true, is_couple_chat: true },
                    { channel_id: 'memes-id', open_at_dawn: true, open_at_dusk: true, is_couple_chat: false },
                ] });

            bot.createVotingMessage = jest.fn().mockResolvedValue(undefined);

            const votingChannel = makeMockChannel('voting-booth');
            const coupleChannel = makeMockChannel('g1-couple-chat');
            const memesChannel = makeMockChannel('g1-memes');
            const channelsById = {
                'booth-id': votingChannel,
                'couple-id': coupleChannel,
                'memes-id': memesChannel,
            };
            bot.client.channels = {
                fetch: jest.fn().mockImplementation(id => Promise.resolve(channelsById[id] || null)),
            };

            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [{ id: 'alive-id', name: 'Alive' }].find(fn) || null
            );

            await bot.handleNext(msg);

            // Couple chat: closed during the day
            expect(coupleChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
                'alive-id',
                expect.objectContaining({ SendMessages: false, AddReactions: false })
            );
            // Regular channel with open_at_dawn=true still opens during the day
            expect(memesChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
                'alive-id',
                expect.objectContaining({ SendMessages: true, AddReactions: true })
            );
        });

        it('restores couple chat send permission at night start', async () => {
            const game = {
                id: 1, day_phase: 'day', day_number: 2, game_number: 1,
                voting_booth_channel_id: 'booth-id',
                town_square_channel_id: null,
                wolf_chat_channel_id: null,
                votes_to_hang: 5,
                day_message: 'Wake up!', night_message: 'Sleep!',
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })  // SELECT games
                .mockResolvedValueOnce({ rows: [] })      // SELECT votes (day→night)
                .mockResolvedValueOnce({ rows: [] })      // DELETE votes
                .mockResolvedValueOnce({ rows: [] })      // UPDATE voting_message_id NULL
                .mockResolvedValueOnce({ rows: [] })      // UPDATE games phase
                .mockResolvedValueOnce({ rows: [] })      // SELECT game_channels (phase messages)
                .mockResolvedValueOnce({ rows: [        // SELECT game_channels (permissions)
                    // Even if open_at_dusk was somehow unset, couple chat opens at night.
                    { channel_id: 'couple-id', open_at_dawn: false, open_at_dusk: false, is_couple_chat: true },
                ] });

            const votingChannel = makeMockChannel('voting-booth');
            const coupleChannel = makeMockChannel('g1-couple-chat');
            const channelsById = {
                'booth-id': votingChannel,
                'couple-id': coupleChannel,
            };
            bot.client.channels = {
                fetch: jest.fn().mockImplementation(id => Promise.resolve(channelsById[id] || null)),
            };

            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [{ id: 'alive-id', name: 'Alive' }].find(fn) || null
            );

            await bot.handleNext(msg);

            expect(coupleChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
                'alive-id',
                expect.objectContaining({ SendMessages: true, AddReactions: true })
            );
        });
    });

    describe('killPlayer couple chat access (feedback #31 - dead can still see couple chat)', () => {
        function setupKill(bot, msg, { invitedUsers, userId = 'couple-user-id' }) {
            const aliveRole = { id: 'alive-id', name: 'Alive' };
            const deadRole = { id: 'dead-id', name: 'Dead' };

            msg.mentions.users.first = jest.fn().mockReturnValue({ id: userId });

            const targetMember = createMockMember({ id: userId, displayName: 'CoupleMember' });
            targetMember.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [aliveRole, deadRole].find(fn) || null
            );
            // Member currently has the Alive role only
            targetMember.roles.cache.has = jest.fn().mockImplementation(id => id === 'alive-id');
            msg.guild.members.fetch = jest.fn().mockResolvedValue(targetMember);

            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ id: 1 }] })  // active game
                .mockResolvedValueOnce({ rows: [              // couple chats for game
                    { channel_id: 'couple-id', channel_name: 'g1-couple-chat', invited_users: invitedUsers },
                ] });

            const coupleChannel = makeMockChannel('g1-couple-chat');
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(coupleChannel) };

            return { targetMember, coupleChannel, aliveRole, deadRole };
        }

        it('keeps ViewChannel for a dead couple member (send access removed)', async () => {
            const msg = createMockMessage();
            const { targetMember, coupleChannel, aliveRole, deadRole } = setupKill(bot, msg, {
                invitedUsers: ['couple-user-id', 'partner-id'],
            });

            await bot.killPlayer(msg);

            // Death role swap happened
            expect(targetMember.roles.remove).toHaveBeenCalledWith(aliveRole);
            expect(targetMember.roles.add).toHaveBeenCalledWith(deadRole);

            // Dead couple member retains view access but cannot talk
            expect(coupleChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
                'couple-user-id',
                { ViewChannel: true, SendMessages: false }
            );
        });

        it('does not touch couple chat overwrites when the dead player is not a couple member', async () => {
            const msg = createMockMessage();
            const { coupleChannel } = setupKill(bot, msg, {
                invitedUsers: ['someone-else-id', 'partner-id'],
            });

            await bot.killPlayer(msg);

            expect(coupleChannel.permissionOverwrites.edit).not.toHaveBeenCalled();
        });

        it('preserveCoupleChatAccess does nothing when there is no active game', async () => {
            bot.db.query = jest.fn().mockResolvedValueOnce({ rows: [] });
            bot.client.channels = { fetch: jest.fn() };

            await bot.preserveCoupleChatAccess({ id: 'guild-123' }, 'couple-user-id');

            expect(bot.client.channels.fetch).not.toHaveBeenCalled();
        });
    });
});
