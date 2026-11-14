'use strict';

const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage } = require('../helpers/mock-discord');
const { expectedForChannel } = require('../../handlers/permissions-audit');

describe('Wolf Dead Chat (feedback #46)', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    function makeMockChannel() {
        return { permissionOverwrites: { edit: jest.fn().mockResolvedValue(undefined) } };
    }

    describe('grantDeadWolfChatAccess', () => {
        it('lets a dead wolf see and talk in the wolf dead chat', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ id: 1 }] })                                            // active game
                .mockResolvedValueOnce({ rows: [{ channel_id: 'wolf-dead-id', channel_name: 'g1-wolf-dead' }] })
                .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });                                   // is a wolf
            const channel = makeMockChannel();
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(channel) };

            await bot.grantDeadWolfChatAccess({ id: 'guild-123' }, 'wolf-user');

            expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith('wolf-user', {
                ViewChannel: true,
                SendMessages: true,
            });
        });

        it('does nothing for a dead villager', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ id: 1 }] })
                .mockResolvedValueOnce({ rows: [{ channel_id: 'wolf-dead-id', channel_name: 'g1-wolf-dead' }] })
                .mockResolvedValueOnce({ rows: [] });                                                    // not a wolf
            bot.client.channels = { fetch: jest.fn() };

            await bot.grantDeadWolfChatAccess({ id: 'guild-123' }, 'town-user');

            expect(bot.client.channels.fetch).not.toHaveBeenCalled();
        });

        it('does nothing when the game has no wolf dead chat', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ id: 1 }] })
                .mockResolvedValueOnce({ rows: [] });
            bot.client.channels = { fetch: jest.fn() };

            await bot.grantDeadWolfChatAccess({ id: 'guild-123' }, 'wolf-user');

            expect(bot.db.query).toHaveBeenCalledTimes(2);
            expect(bot.client.channels.fetch).not.toHaveBeenCalled();
        });
    });

    describe('handleWolfDead', () => {
        it('refuses to create a second wolf dead chat', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ id: 1, game_number: 1, category_id: 'cat' }] })
                .mockResolvedValueOnce({ rows: [{ channel_id: 'existing-id' }] });
            const msg = createMockMessage();

            await bot.handleWolfDead(msg);

            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('already has a wolf dead chat'));
            expect(msg.guild.channels.create).not.toHaveBeenCalled();
        });

        it('creates the channel hidden from the living and adds wolves who are already dead', async () => {
            const roles = [
                { id: 'alive-id', name: 'Alive' }, { id: 'dead-id', name: 'Dead' },
                { id: 'spectator-id', name: 'Spectator' }, { id: 'mod-id', name: 'Mod' },
            ];
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ id: 1, game_number: 3, category_id: 'cat', wolf_chat_channel_id: null }] })
                .mockResolvedValueOnce({ rows: [] })                                   // no existing chat
                .mockResolvedValueOnce({ rows: [{ game_prefix: 'g' }] })               // server config
                .mockResolvedValueOnce({ rows: [] })                                   // INSERT game_channels
                .mockResolvedValueOnce({ rows: [{ user_id: 'dead-wolf' }, { user_id: 'live-wolf' }] });

            const newChannel = { id: 'new-id', ...makeMockChannel(), setPosition: jest.fn() };
            bot.client.channels = { fetch: jest.fn().mockResolvedValue({ id: 'cat' }) };

            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn => roles.find(fn) || null);
            msg.guild.channels.create = jest.fn().mockResolvedValue(newChannel);
            const withDead = (dead) => ({ id: dead ? 'dead-wolf' : 'live-wolf', roles: { cache: { has: jest.fn().mockImplementation(id => dead && id === 'dead-id') } } });
            msg.guild.members.cache = new Map([['dead-wolf', withDead(true)], ['live-wolf', withDead(false)]]);

            await bot.handleWolfDead(msg);

            const created = msg.guild.channels.create.mock.calls[0][0];
            expect(created.name).toBe('g3-wolf-dead');
            expect(created.permissionOverwrites.find(o => o.id === 'alive-id').deny).toContain('ViewChannel');

            const insert = bot.db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO game_channels'));
            expect(insert[0]).toContain('is_dead_wolf_chat');

            expect(newChannel.permissionOverwrites.edit).toHaveBeenCalledTimes(1);
            expect(newChannel.permissionOverwrites.edit).toHaveBeenCalledWith('dead-wolf', { ViewChannel: true, SendMessages: true });
        });
    });

    describe('permission matrix', () => {
        it('keeps the wolf dead chat hidden from Alive and read-only for Dead and Spectator', () => {
            const expected = expectedForChannel('dead_wolf_chat', { phase: 'day', dayNumber: 2 });
            expect(expected.Alive.ViewChannel).toEqual({ value: false, strict: true });
            expect(expected.Alive.SendMessages).toBeUndefined();
            expect(expected.Dead.SendMessages.value).toBe(false);
            expect(expected.Spectator.ViewChannel.value).toBe(true);
            expect(expected.Mod.SendMessages.value).toBe(true);
        });
    });
});
