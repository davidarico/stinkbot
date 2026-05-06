'use strict';

const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage } = require('../helpers/mock-discord');

describe('Archive Handlers', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    describe('handleArchive', () => {
        it('replies with error when no category name arg provided', async () => {
            const msg = createMockMessage({ content: 'Wolf.archive' });
            await bot.handleArchive(msg, []);
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('category'));
        });

        it('notifies that S3 image processing is enabled when S3 is configured', async () => {
            bot.s3Client = { send: jest.fn().mockResolvedValue({}) };

            const mockCategory = { id: 'cat-id', name: 'Game 1', type: 4 };
            const msg = createMockMessage();
            msg.guild.channels.cache.find = jest.fn().mockReturnValue(mockCategory);
            msg.guild.channels.cache.filter = jest.fn().mockReturnValue({ size: 0, values: () => [] });

            await bot.handleArchive(msg, ['Game 1']);

            const channelSends = msg.channel.send.mock.calls.map(([text]) => text);
            expect(channelSends.some(t => t.includes('S3'))).toBe(true);
        });

        it('notifies when S3 is not configured and uses original URLs', async () => {
            bot.s3Client = null;

            const mockCategory = { id: 'cat-id', name: 'Game 1', type: 4 };
            const msg = createMockMessage();
            msg.guild.channels.cache.find = jest.fn().mockReturnValue(mockCategory);
            msg.guild.channels.cache.filter = jest.fn().mockReturnValue({ size: 0, values: () => [] });

            await bot.handleArchive(msg, ['Game 1']);

            const channelSends = msg.channel.send.mock.calls.map(([text]) => text);
            expect(channelSends.some(t => t.includes('S3 not configured'))).toBe(true);
        });

        it('archives all text channels in the specified category', async () => {
            bot.s3Client = null;

            const mockCategory = { id: 'cat-id', name: 'Game 1', type: 4 };
            const mockChannel = {
                id: 'ch-1', name: 'town-square', type: 0, parentId: 'cat-id',
                messages: { fetch: jest.fn().mockResolvedValue({ size: 0 }) },
            };

            const msg = createMockMessage();
            msg.guild.channels.cache.find = jest.fn().mockReturnValue(mockCategory);
            msg.guild.channels.cache.filter = jest.fn().mockReturnValue({
                size: 1, values: () => [mockChannel],
            });

            await bot.handleArchive(msg, ['Game 1']);

            // Completion embed should mention the category
            const lastReply = msg.reply.mock.calls.at(-1)[0];
            expect(lastReply).toMatchObject({ embeds: expect.any(Array) });
            expect(lastReply.embeds[0].data.title).toBe('✅ Archive Complete');
        });
    });

    describe('handleArchiveLocal', () => {
        it('saves channel messages to a local JSON file', async () => {
            const savedEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            const fs = require('fs');
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

            const mockCategory = { id: 'cat-id', name: 'Game 1', type: 4 };
            const mockChannel = {
                id: 'ch-1', name: 'town-square', type: 0, parentId: 'cat-id',
                messages: { fetch: jest.fn().mockResolvedValue({ size: 0 }) },
            };

            const msg = createMockMessage();
            msg.guild.channels.cache.find = jest.fn().mockReturnValue(mockCategory);
            msg.guild.channels.cache.filter = jest.fn().mockReturnValue(
                new Map([['ch-1', mockChannel]])
            );

            await bot.handleArchiveLocal(msg, ['Game 1']);

            expect(fs.writeFileSync).toHaveBeenCalled();
            const lastReply = msg.reply.mock.calls.at(-1)[0];
            expect(lastReply).toMatchObject({ embeds: expect.any(Array) });
            expect(lastReply.embeds[0].data.title).toBe('✅ Local Archive Complete');

            fs.existsSync.mockRestore();
            fs.writeFileSync.mockRestore();
            process.env.NODE_ENV = savedEnv;
        });
    });

    describe('syncServerMembers', () => {
        it('upserts all guild members into the database', async () => {
            const mockMember = {
                user: { id: 'u1', bot: false, username: 'Alice', displayAvatarURL: jest.fn().mockReturnValue('http://avatar.png') },
                displayName: 'Alice',
            };
            const mockGuild = {
                id: 'guild-1',
                name: 'Test Guild',
                members: {
                    fetch: jest.fn().mockResolvedValue(undefined),
                    cache: new Map([['u1', mockMember]]),
                },
            };
            bot.client.guilds = { cache: new Map([['guild-1', mockGuild]]) };
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });

            await bot.syncServerMembers();

            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO server_users'),
                ['u1', 'guild-1', 'Alice', 'http://avatar.png']
            );
        });
    });

    describe('handleSyncMembers', () => {
        it('triggers syncServerMembers and confirms completion', async () => {
            bot.syncServerMembers = jest.fn().mockResolvedValue(undefined);

            const msg = createMockMessage();
            await bot.handleSyncMembers(msg);

            expect(bot.syncServerMembers).toHaveBeenCalled();
            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('completed'));
        });
    });
});
