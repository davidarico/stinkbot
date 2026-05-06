'use strict';

const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage } = require('../helpers/mock-discord');

describe('Player Handlers', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    describe('handleAlive', () => {
        it('lists currently alive players', async () => {
            const game = { id: 1 };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [{ user_id: 'user-1', username: 'Alice' }] });

            const aliveRole = { id: 'alive-id', name: 'Alive' };
            const deadRole = { id: 'dead-id', name: 'Dead' };

            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [aliveRole, deadRole].find(fn) || null
            );
            msg.guild.members.cache = new Map([
                ['user-1', { roles: { cache: { has: jest.fn().mockImplementation(id => id === 'alive-id') } } }],
            ]);

            await bot.handleAlive(msg);

            const reply = msg.reply.mock.calls[0][0];
            expect(reply.embeds[0].data.title).toBe('💚 Alive Players');
            expect(reply.embeds[0].data.fields[0].value).toContain('Alice');
        });

        it('includes dead players when isAddDead is true', async () => {
            const game = { id: 1 };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [{ user_id: 'user-1', username: 'Bob' }] });

            const aliveRole = { id: 'alive-id', name: 'Alive' };
            const deadRole = { id: 'dead-id', name: 'Dead' };

            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [aliveRole, deadRole].find(fn) || null
            );
            // Bob has only the Dead role
            msg.guild.members.cache = new Map([
                ['user-1', { roles: { cache: { has: jest.fn().mockImplementation(id => id === 'dead-id') } } }],
            ]);

            await bot.handleAlive(msg, true);

            const reply = msg.reply.mock.calls[0][0];
            expect(reply.embeds[0].data.title).toBe('👥 All Players');
            expect(reply.embeds[0].data.fields[0].value).toContain('Bob');
        });

        it('replies with error when no active game', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });
            const msg = createMockMessage();
            await bot.handleAlive(msg);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('No active game'));
        });
    });

    describe('handleDead', () => {
        it('lists currently dead players', async () => {
            const game = { id: 1 };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [{ user_id: 'user-1', username: 'Carol' }] });

            const deadRole = { id: 'dead-id', name: 'Dead' };

            const msg = createMockMessage();
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn =>
                [deadRole].find(fn) || null
            );
            msg.guild.members.cache = new Map([
                ['user-1', { roles: { cache: { has: jest.fn().mockImplementation(id => id === 'dead-id') } } }],
            ]);

            await bot.handleDead(msg);

            const reply = msg.reply.mock.calls[0][0];
            expect(reply.embeds[0].data.title).toBe('💀 Dead Players');
            expect(reply.embeds[0].data.fields[0].value).toContain('Carol');
        });
    });

    describe('killPlayer', () => {
        it('removes Alive role and assigns Dead role to mentioned player', async () => {
            const targetUser = { id: 'target-id' };
            const targetMember = { id: 'target-id', displayName: 'Dave' };

            bot.removeRole = jest.fn().mockResolvedValue(true);
            bot.assignRole = jest.fn().mockResolvedValue(undefined);

            const msg = createMockMessage();
            msg.mentions.users.first = jest.fn().mockReturnValue(targetUser);
            msg.guild.members.fetch = jest.fn().mockResolvedValue(targetMember);

            await bot.killPlayer(msg);

            expect(bot.removeRole).toHaveBeenCalledWith(targetMember, 'Alive');
            expect(bot.assignRole).toHaveBeenCalledWith(targetMember, 'Dead');
        });

        it('replies with error when mentioned player does not have Alive role', async () => {
            const targetUser = { id: 'target-id' };
            const targetMember = { id: 'target-id', displayName: 'Dave' };

            bot.removeRole = jest.fn().mockResolvedValue(false);

            const msg = createMockMessage();
            msg.mentions.users.first = jest.fn().mockReturnValue(targetUser);
            msg.guild.members.fetch = jest.fn().mockResolvedValue(targetMember);

            await bot.killPlayer(msg);

            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('not Alive'));
        });
    });

    describe('handleInList', () => {
        it('displays the current sign-up list', async () => {
            const game = { id: 1, game_number: 2 };
            const config = { game_name: 'Origins', game_counter: 2 };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [{ username: 'Alice' }, { username: 'Bob' }] })
                .mockResolvedValueOnce({ rows: [config] });

            const msg = createMockMessage();
            await bot.handleInList(msg, []);

            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Alice'));
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Bob'));
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('2'));
        });
    });

    describe('handleSignups', () => {
        it('opens signups and notifies the signup channel', async () => {
            const game = { id: 1, signup_channel_id: 'signup-ch-id' };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [] }); // UPDATE

            const mockSignupChannel = { send: jest.fn().mockResolvedValue({}) };
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(mockSignupChannel) };

            const msg = createMockMessage();
            msg.member.permissions.has = jest.fn().mockReturnValue(true);

            await bot.handleSignups(msg, ['open']);

            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE games SET signups_closed'),
                [false, game.id]
            );
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('opened'));
        });

        it('closes signups when passed "close" arg', async () => {
            const game = { id: 1, signup_channel_id: 'signup-ch-id' };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })
                .mockResolvedValueOnce({ rows: [] });

            bot.client.channels = { fetch: jest.fn().mockResolvedValue({ send: jest.fn() }) };

            const msg = createMockMessage();
            msg.member.permissions.has = jest.fn().mockReturnValue(true);

            await bot.handleSignups(msg, ['close']);

            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE games SET signups_closed'),
                [true, game.id]
            );
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('closed'));
        });

        it('replies with error when caller is not a moderator', async () => {
            const msg = createMockMessage();
            // member.permissions.has returns false by default
            await bot.handleSignups(msg, ['open']);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('moderators'));
        });
    });
});
