'use strict';

const { ChannelType } = require('discord.js');
const { createTestBot } = require('../helpers/bot-factory');

describe('Active Journals (feedback #88)', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    // Minimal stand-in for guild.channels.cache: an array with the Collection methods used
    function makeGuild(channels) {
        const cache = {
            find: (fn) => channels.find(fn),
            filter: (fn) => {
                const matched = channels.filter(fn);
                return {
                    size: matched.length,
                    values: () => matched.values(),
                    sort: () => ({ first: () => matched[0] }),
                    first: () => matched[0],
                };
            },
        };
        return { id: 'guild-1', name: 'Test Guild', channels: { cache, create: jest.fn() } };
    }

    const activeCategory = { id: 'active-cat', type: ChannelType.GuildCategory, name: 'Active Journals' };
    const archiveCategory = { id: 'archive-cat', type: ChannelType.GuildCategory, name: 'Journals', position: 4 };

    function makeJournal(parentId) {
        return { id: 'journal-1', name: 'alice-journal', parentId, setParent: jest.fn().mockResolvedValue(undefined) };
    }

    describe('activateJournal', () => {
        it('does nothing when the server has not turned the feature on', async () => {
            bot.db.query = jest.fn().mockResolvedValueOnce({ rows: [{ active_journals: false }] });
            const guild = makeGuild([archiveCategory]);

            const moved = await bot.activateJournal(guild, 'user-1');

            expect(moved).toBe(false);
            expect(bot.db.query).toHaveBeenCalledTimes(1);
            expect(guild.channels.create).not.toHaveBeenCalled();
        });

        it('moves the journal into Active Journals without syncing its permissions', async () => {
            const journal = makeJournal('archive-cat');
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ active_journals: true }] })
                .mockResolvedValueOnce({ rows: [{ channel_id: 'journal-1' }] });
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(journal) };
            bot.alphabetizeJournalsInCategory = jest.fn().mockResolvedValue(undefined);
            const guild = makeGuild([activeCategory, archiveCategory, journal]);

            const moved = await bot.activateJournal(guild, 'user-1');

            expect(moved).toBe(true);
            expect(journal.setParent).toHaveBeenCalledWith('active-cat', { lockPermissions: false });
            expect(bot.alphabetizeJournalsInCategory).toHaveBeenCalledWith(guild, activeCategory);
            // The auto-fix watcher must be able to tell this move was the bot's own
            expect(bot.wasJournalMovedByBot('journal-1')).toBe(true);
        });

        it('creates the category with the archive category\'s permissions when it is missing', async () => {
            const journal = makeJournal('archive-cat');
            const archiveWithPerms = {
                ...archiveCategory,
                permissionOverwrites: { cache: { map: (fn) => [{ id: 'role-1', allow: { bitfield: 1n }, deny: { bitfield: 2n } }].map(fn) } },
            };
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ active_journals: true }] })
                .mockResolvedValueOnce({ rows: [{ channel_id: 'journal-1' }] });
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(journal) };
            bot.alphabetizeJournalsInCategory = jest.fn().mockResolvedValue(undefined);
            const guild = makeGuild([archiveWithPerms, journal]);
            const created = { id: 'new-active', setPosition: jest.fn().mockResolvedValue(undefined) };
            guild.channels.create.mockResolvedValue(created);

            await bot.activateJournal(guild, 'user-1');

            expect(guild.channels.create).toHaveBeenCalledWith({
                name: 'Active Journals',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [{ id: 'role-1', allow: 1n, deny: 2n }],
            });
            expect(created.setPosition).toHaveBeenCalledWith(4);
            expect(journal.setParent).toHaveBeenCalledWith('new-active', { lockPermissions: false });
        });

        it('leaves the journal alone when Active Journals is full', async () => {
            const journal = makeJournal('archive-cat');
            const fillers = Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, name: `p${i}-journal`, parentId: 'active-cat' }));
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ active_journals: true }] })
                .mockResolvedValueOnce({ rows: [{ channel_id: 'journal-1' }] });
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(journal) };
            const guild = makeGuild([activeCategory, archiveCategory, journal, ...fillers]);

            const moved = await bot.activateJournal(guild, 'user-1');

            expect(moved).toBe(false);
            expect(journal.setParent).not.toHaveBeenCalled();
        });
    });

    describe('archiveJournal', () => {
        it('does nothing on servers that have never used Active Journals', async () => {
            const guild = makeGuild([archiveCategory]);

            const moved = await bot.archiveJournal(guild, 'user-1');

            expect(moved).toBe(false);
            expect(bot.db.query).not.toHaveBeenCalled();
        });

        it('returns an active journal to the category it belongs in alphabetically', async () => {
            const journal = makeJournal('active-cat');
            bot.db.query = jest.fn().mockResolvedValueOnce({ rows: [{ channel_id: 'journal-1' }] });
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(journal) };
            bot.checkAndProactivelySplitJournals = jest.fn().mockResolvedValue(false);
            bot.findAppropriateJournalCategory = jest.fn().mockResolvedValue(archiveCategory);
            bot.alphabetizeJournalsInCategory = jest.fn().mockResolvedValue(undefined);
            bot.checkAndRebalanceJournals = jest.fn().mockResolvedValue(undefined);
            const guild = makeGuild([activeCategory, archiveCategory, journal]);

            const moved = await bot.archiveJournal(guild, 'user-1');

            expect(moved).toBe(true);
            expect(bot.findAppropriateJournalCategory).toHaveBeenCalledWith(guild, 'alice');
            expect(journal.setParent).toHaveBeenCalledWith('archive-cat', { lockPermissions: false });
            expect(bot.checkAndRebalanceJournals).toHaveBeenCalledWith(guild);
        });

        it('leaves a journal that is already in the archive alone', async () => {
            const journal = makeJournal('archive-cat');
            bot.db.query = jest.fn().mockResolvedValueOnce({ rows: [{ channel_id: 'journal-1' }] });
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(journal) };
            const guild = makeGuild([activeCategory, archiveCategory, journal]);

            expect(await bot.archiveJournal(guild, 'user-1')).toBe(false);
            expect(journal.setParent).not.toHaveBeenCalled();
        });
    });

    describe('journal auto-fix watcher', () => {
        it('ignores category moves the bot made itself', async () => {
            bot.scheduleJournalAutoFix = jest.fn();
            const journal = makeJournal('archive-cat');
            await bot.moveJournalToCategory(journal, activeCategory);

            await bot.handleChannelUpdate(
                { parentId: 'archive-cat', name: 'alice-journal' },
                { id: 'journal-1', name: 'alice-journal', parentId: 'active-cat', guild: { id: 'guild-1' }, type: ChannelType.GuildText }
            );

            expect(bot.scheduleJournalAutoFix).not.toHaveBeenCalled();
        });

        it('still reacts when someone else moves a journal', async () => {
            bot.scheduleJournalAutoFix = jest.fn();

            await bot.handleChannelUpdate(
                { parentId: 'archive-cat', name: 'bob-journal' },
                { id: 'journal-2', name: 'bob-journal', parentId: 'active-cat', guild: { id: 'guild-1' }, type: ChannelType.GuildText }
            );

            expect(bot.scheduleJournalAutoFix).toHaveBeenCalled();
        });
    });
});
