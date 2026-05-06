'use strict';

const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage } = require('../helpers/mock-discord');

describe('Channel & Settings Handlers', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    describe('handleSettings', () => {
        it('displays current server settings', async () => {
            const game = {
                id: 1, game_number: 2, votes_to_hang: 4,
                day_message: 'Wake up!', night_message: 'Sleep!',
                wolf_day_message: null, wolf_night_message: null,
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })  // active game
                .mockResolvedValueOnce({ rows: [] });      // game_channels

            const msg = createMockMessage();
            await bot.handleSettings(msg, []);

            const reply = msg.reply.mock.calls[0][0];
            expect(reply).toMatchObject({ embeds: expect.any(Array) });
            expect(reply.embeds[0].data.title).toBe('⚙️ Game Settings');
        });

        it('updates a setting when key=value is provided', async () => {
            const game = { id: 1, game_number: 2, votes_to_hang: 4 };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })  // active game
                .mockResolvedValueOnce({ rows: [] });      // UPDATE votes_to_hang

            bot.updateVotingMessage = jest.fn().mockResolvedValue(undefined);

            const msg = createMockMessage();
            msg.member.permissions.has = jest.fn().mockReturnValue(true); // mod

            await bot.handleSettings(msg, ['votes_to_hang', '5']);

            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE games SET votes_to_hang'),
                [5, game.id]
            );
            const reply = msg.reply.mock.calls[0][0];
            expect(reply).toMatchObject({ embeds: expect.any(Array) });
        });
    });

    describe('handleAddChannel', () => {
        it('adds a channel to the active game', async () => {
            const game = { id: 1, game_number: 2, category_id: 'cat-id', day_message: 'Wake!', night_message: 'Sleep!' };
            const config = { game_prefix: 'g', game_counter: 2 };

            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })    // active game
                .mockResolvedValueOnce({ rows: [config] })  // server config
                .mockResolvedValueOnce({ rows: [] });        // INSERT game_channels

            const mockCategory = {
                id: 'cat-id',
                children: { cache: { find: jest.fn().mockReturnValue(null) } },
            };
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(mockCategory) };

            const newChannel = {
                id: 'new-ch-id', name: 'g2-memes',
                setPosition: jest.fn().mockResolvedValue(undefined),
            };
            const msg = createMockMessage();
            const roleMap = [
                { id: 'alive-id', name: 'Alive' },
                { id: 'dead-id', name: 'Dead' },
                { id: 'spectator-id', name: 'Spectator' },
                { id: 'mod-id', name: 'Mod' },
            ];
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn => roleMap.find(fn) || null);
            msg.guild.channels.create = jest.fn().mockResolvedValue(newChannel);

            await bot.handleAddChannel(msg, ['memes']);

            expect(msg.guild.channels.create).toHaveBeenCalled();
            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO game_channels'),
                expect.any(Array)
            );
            const reply = msg.reply.mock.calls[0][0];
            expect(reply).toMatchObject({ embeds: expect.any(Array) });
        });

        it('replies with error when no active game', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });
            const msg = createMockMessage();
            await bot.handleAddChannel(msg, ['memes']);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('No active game'));
        });
    });

    describe('handleDeleteCategory', () => {
        it('deletes a category and all its channels after confirmation', async () => {
            const mockChild = {
                id: 'child-id', name: 'town-square', type: 0, parentId: 'cat-id',
                rawPosition: 0,
                delete: jest.fn().mockResolvedValue(undefined),
            };
            const mockCategory = {
                id: 'cat-id', name: 'Game 1', type: 4,
                delete: jest.fn().mockResolvedValue(undefined),
            };

            const mockAllChannels = {
                filter: jest.fn().mockImplementation((fn) => {
                    const filtered = [mockChild, mockCategory].filter(c => fn(c));
                    return {
                        size: filtered.length,
                        find: jest.fn().mockImplementation(fn2 => filtered.find(fn2) ?? null),
                        first: jest.fn().mockReturnValue(filtered[0]),
                        values: () => filtered,
                        sort: jest.fn().mockReturnValue({
                            size: filtered.length,
                            values: () => filtered,
                        }),
                    };
                }),
            };

            const msg = createMockMessage();
            msg.guild.channels.fetch = jest.fn().mockResolvedValue(mockAllChannels);
            msg.channel.awaitMessages = jest.fn().mockResolvedValue({
                size: 1,
                first: jest.fn().mockReturnValue({ content: 'confirm' }),
            });

            await bot.handleDeleteCategory(msg, ['Game 1']);

            expect(mockChild.delete).toHaveBeenCalled();
            expect(mockCategory.delete).toHaveBeenCalled();
        });

        it('aborts deletion when user cancels confirmation', async () => {
            const mockCategory = { id: 'cat-id', name: 'Game 1', type: 4 };
            const mockAllChannels = {
                filter: jest.fn().mockImplementation((fn) => {
                    const filtered = [mockCategory].filter(c => fn(c));
                    return {
                        size: filtered.length,
                        find: jest.fn().mockImplementation(fn2 => filtered.find(fn2) ?? null),
                        first: jest.fn().mockReturnValue(filtered[0]),
                        values: () => filtered,
                        sort: jest.fn().mockReturnValue({
                            size: filtered.length,
                            values: () => filtered,
                        }),
                    };
                }),
            };

            const msg = createMockMessage();
            msg.guild.channels.fetch = jest.fn().mockResolvedValue(mockAllChannels);
            msg.channel.awaitMessages = jest.fn().mockResolvedValue({
                size: 1,
                first: jest.fn().mockReturnValue({ content: 'cancel' }),
            });

            await bot.handleDeleteCategory(msg, ['Game 1']);

            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('cancelled'));
        });
    });

    describe('handleSetVotingBooth', () => {
        it('sets the current channel as the voting booth for the active game', async () => {
            const game = { id: 1, game_number: 2 };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })  // active game
                .mockResolvedValueOnce({ rows: [] });      // UPDATE

            const votingChannel = { id: 'booth-id', name: 'voting-booth' };
            const msg = createMockMessage();
            msg.guild.channels.cache.find = jest.fn().mockReturnValue(votingChannel);

            await bot.handleSetVotingBooth(msg, ['voting-booth']);

            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE games SET voting_booth_channel_id'),
                ['booth-id', game.id]
            );
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('booth-id'));
        });
    });

    describe('handleChannelConfig', () => {
        it('displays current custom channel configuration', async () => {
            const game = { id: 1, game_number: 2, game_name: 'Origins', status: 'active' };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [
                    { channel_name: 'g2-memes', is_created: true, invited_users: [], open_at_dawn: false, open_at_dusk: false, is_couple_chat: false },
                ] })
                .mockResolvedValueOnce({ rows: [] }); // players

            const msg = createMockMessage();
            msg.channel.name = 'g2-mod-chat'; // non-public channel

            await bot.handleChannelConfig(msg);

            const reply = msg.reply.mock.calls[0][0];
            expect(reply).toMatchObject({ embeds: expect.any(Array) });
            expect(reply.embeds[0].data.title).toContain('Channel Configuration');
        });
    });

    describe('handleLockdown', () => {
        it('locks all game channels to prevent message sending', async () => {
            const game = {
                id: 1, town_square_channel_id: 'ts-id', memos_channel_id: 'memos-id',
            };
            bot.db.query = jest.fn().mockResolvedValue({ rows: [game] });

            bot.setChannelPermissions = jest.fn().mockResolvedValue(undefined);

            const aliveRole = { id: 'alive-id', name: 'Alive' };
            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [aliveRole].find(fn) || null
            );
            const mockTownSquare = { send: jest.fn().mockResolvedValue({}) };
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(mockTownSquare) };

            await bot.handleLockdown(msg, []);

            expect(bot.setChannelPermissions).toHaveBeenCalledWith(game, aliveRole, false, msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Lockdown'));
        });

        it('unlocks channels when lockdown is lifted', async () => {
            const game = {
                id: 1, town_square_channel_id: 'ts-id', memos_channel_id: null,
            };
            bot.db.query = jest.fn().mockResolvedValue({ rows: [game] });

            bot.setChannelPermissions = jest.fn().mockResolvedValue(undefined);

            const aliveRole = { id: 'alive-id', name: 'Alive' };
            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [aliveRole].find(fn) || null
            );
            const mockTownSquare = { send: jest.fn().mockResolvedValue({}) };
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(mockTownSquare) };

            await bot.handleLockdown(msg, ['lift']);

            expect(bot.setChannelPermissions).toHaveBeenCalledWith(game, aliveRole, true, msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('lifted'));
        });
    });

    describe('setChannelPermissions', () => {
        it('grants send permissions to alive role when allowMessages is true', async () => {
            const game = { town_square_channel_id: 'ts-id', memos_channel_id: null };
            const aliveRole = { id: 'alive-id', name: 'Alive' };
            const mockChannel = {
                name: 'town-square',
                permissionOverwrites: { edit: jest.fn().mockResolvedValue(undefined) },
            };
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(mockChannel) };

            await bot.setChannelPermissions(game, aliveRole, true, null);

            expect(mockChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
                'alive-id',
                expect.objectContaining({ SendMessages: true })
            );
        });

        it('revokes send permissions from alive role when allowMessages is false', async () => {
            const game = { town_square_channel_id: 'ts-id', memos_channel_id: null };
            const aliveRole = { id: 'alive-id', name: 'Alive' };
            const mockChannel = {
                name: 'town-square',
                permissionOverwrites: { edit: jest.fn().mockResolvedValue(undefined) },
            };
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(mockChannel) };

            await bot.setChannelPermissions(game, aliveRole, false, null);

            expect(mockChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
                'alive-id',
                expect.objectContaining({ SendMessages: false })
            );
        });
    });
});
