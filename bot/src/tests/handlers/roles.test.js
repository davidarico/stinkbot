'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage, createMockMember } = require('../helpers/mock-discord');

describe('Roles Handlers', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    describe('isSuperUser', () => {
        it('returns false when userId is null', async () => {
            const result = await bot.isSuperUser(null);
            expect(result).toBe(false);
        });

        it('returns true when user exists in super_users table', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
            const result = await bot.isSuperUser('some-user-id');
            expect(result).toBe(true);
            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('super_users'),
                ['some-user-id']
            );
        });

        it('returns false when user is not in super_users table', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });
            const result = await bot.isSuperUser('some-user-id');
            expect(result).toBe(false);
        });

        it('returns false on DB error', async () => {
            bot.db.query = jest.fn().mockRejectedValue(new Error('DB error'));
            const result = await bot.isSuperUser('some-user-id');
            expect(result).toBe(false);
        });
    });

    describe('hasModeratorPermissions', () => {
        it('returns true for ManageChannels permission', () => {
            const member = createMockMember();
            member.permissions.has = jest.fn((perm) => perm === PermissionFlagsBits.ManageChannels);
            expect(bot.hasModeratorPermissions(member)).toBe(true);
        });

        it('returns true for Administrator permission', () => {
            const member = createMockMember();
            member.permissions.has = jest.fn((perm) => perm === PermissionFlagsBits.Administrator);
            expect(bot.hasModeratorPermissions(member)).toBe(true);
        });

        it('returns false when no mod permissions', () => {
            const member = createMockMember();
            member.permissions.has = jest.fn().mockReturnValue(false);
            expect(bot.hasModeratorPermissions(member)).toBe(false);
        });
    });

    describe('hasTownCouncilRole', () => {
        it('returns true when member has Town Council role', () => {
            const member = createMockMember();
            member.roles.cache.some = jest.fn((fn) => fn({ name: 'Town Council' }));
            expect(bot.hasTownCouncilRole(member)).toBe(true);
        });

        it('returns false when member does not have Town Council role', () => {
            const member = createMockMember();
            member.roles.cache.some = jest.fn().mockReturnValue(false);
            expect(bot.hasTownCouncilRole(member)).toBe(false);
        });
    });

    describe('isPublicChannel', () => {
        it('returns true for a regular channel', () => {
            const msg = createMockMessage();
            msg.channel.name = 'town-square';
            expect(bot.isPublicChannel(msg)).toBe(true);
        });

        it('returns false for dead-chat', () => {
            const msg = createMockMessage();
            msg.channel.name = 'g1-dead-chat';
            expect(bot.isPublicChannel(msg)).toBe(false);
        });

        it('returns false for mod-chat', () => {
            const msg = createMockMessage();
            msg.channel.name = 'g1-mod-chat';
            expect(bot.isPublicChannel(msg)).toBe(false);
        });
    });

    describe('handleMod', () => {
        it('replies with usage error when no user is mentioned', async () => {
            const msg = createMockMessage({ content: 'Wolf.mod' });
            await bot.handleMod(msg, []);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Usage'));
        });

        it('assigns Mod role to mentioned user', async () => {
            const targetMember = { id: 'target-id', toString: () => '<@target-id>' };
            const msg = createMockMessage();
            msg.mentions.members = { first: jest.fn().mockReturnValue(targetMember) };
            bot.assignRole = jest.fn().mockResolvedValue(undefined);

            await bot.handleMod(msg, []);

            expect(bot.assignRole).toHaveBeenCalledWith(targetMember, 'Mod');
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Mod'));
        });
    });

    describe('handleUnmod', () => {
        it('removes Mod role from mentioned user (super user)', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }); // super user
            const targetMember = { id: 'other-id', toString: () => '<@other-id>' };
            const msg = createMockMessage();
            msg.mentions.members = { first: jest.fn().mockReturnValue(targetMember) };
            bot.removeRole = jest.fn().mockResolvedValue(undefined);

            await bot.handleUnmod(msg, []);

            expect(bot.removeRole).toHaveBeenCalledWith(targetMember, 'Mod');
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Mod'));
        });

        it('allows moderator to remove their own Mod role with "me"', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] }); // not super user
            const msg = createMockMessage();
            msg.mentions.members = { first: jest.fn().mockReturnValue(null) };
            msg.member.permissions.has = jest.fn().mockReturnValue(true); // has mod perms
            // msg.member.id === msg.author.id === 'user-123' by default
            bot.removeRole = jest.fn().mockResolvedValue(undefined);

            await bot.handleUnmod(msg, ['me']);

            expect(bot.removeRole).toHaveBeenCalledWith(msg.member, 'Mod');
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Mod'));
        });

        it('allows Town Council member to remove Mod from others', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] }); // not super user
            const targetMember = { id: 'other-id', toString: () => '<@other-id>' };
            const msg = createMockMessage();
            msg.mentions.members = { first: jest.fn().mockReturnValue(targetMember) };
            msg.member.roles.cache.some = jest.fn().mockReturnValue(true); // has Town Council role
            bot.removeRole = jest.fn().mockResolvedValue(undefined);

            await bot.handleUnmod(msg, []);

            expect(bot.removeRole).toHaveBeenCalledWith(targetMember, 'Mod');
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Mod'));
        });

        it('prevents non-super-user from removing Mod from others', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] }); // not super user
            const targetMember = { id: 'other-user-id' }; // different from author
            const msg = createMockMessage();
            msg.mentions.members = { first: jest.fn().mockReturnValue(targetMember) };
            // member.permissions.has and roles.cache.some return false by default

            await bot.handleUnmod(msg, []);

            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Only super users'));
        });
    });
});
