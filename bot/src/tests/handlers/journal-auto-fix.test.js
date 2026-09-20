'use strict';

const { createTestBot } = require('../helpers/bot-factory');

// Journal permissions are reapplied automatically when journals move between categories
// (feedback #93). These cover the event filtering and the debounce, not the permission
// matrix itself - that is exercised through handleFixJournals in journal.test.js.
describe('Journal auto-fix watcher', () => {
    let bot;
    let guild;

    const CATEGORY = 4;
    const TEXT = 0;

    const makeChannel = (overrides = {}) => ({
        name: 'alice-journal',
        type: TEXT,
        parentId: 'cat-a',
        guild,
        ...overrides,
    });

    beforeEach(() => {
        jest.useFakeTimers();
        bot = createTestBot();
        guild = { id: 'guild-1', name: 'Test Guild' };
        bot.fixJournalPermissions = jest.fn().mockResolvedValue({ total: 3, failed: [] });
        bot.reportJournalAutoFix = jest.fn().mockResolvedValue(undefined);
        delete process.env.ENABLE_JOURNAL_AUTO_FIX;
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        delete process.env.ENABLE_JOURNAL_AUTO_FIX;
    });

    it('reapplies permissions when a journal moves to another category', async () => {
        await bot.handleChannelUpdate(
            makeChannel({ parentId: 'cat-a' }),
            makeChannel({ parentId: 'cat-b' })
        );

        expect(bot.fixJournalPermissions).not.toHaveBeenCalled();

        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(bot.fixJournalPermissions).toHaveBeenCalledWith(guild);
    });

    it('ignores edits to non-journal channels', async () => {
        const before = makeChannel({ name: 'g1-townsquare', parentId: 'cat-a' });
        const after = makeChannel({ name: 'g1-townsquare', parentId: 'cat-b' });

        await bot.handleChannelUpdate(before, after);
        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(bot.fixJournalPermissions).not.toHaveBeenCalled();
    });

    it('ignores a journal edit that does not change the category', async () => {
        await bot.handleChannelUpdate(
            makeChannel({ parentId: 'cat-a' }),
            makeChannel({ parentId: 'cat-a' })
        );
        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(bot.fixJournalPermissions).not.toHaveBeenCalled();
    });

    it('debounces a batch of moves into a single run', async () => {
        for (const name of ['alice-journal', 'bob-journal', 'carol-journal']) {
            await bot.handleChannelUpdate(
                makeChannel({ name, parentId: 'cat-a' }),
                makeChannel({ name, parentId: 'cat-b' })
            );
        }

        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(bot.fixJournalPermissions).toHaveBeenCalledTimes(1);
    });

    it('fires when a journal category is renamed', async () => {
        await bot.handleChannelUpdate(
            { name: 'Journals (A-M)', type: CATEGORY, parentId: null, guild },
            { name: 'Journals (A-L)', type: CATEGORY, parentId: null, guild }
        );

        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(bot.fixJournalPermissions).toHaveBeenCalledWith(guild);
    });

    it('fires when a new journal category is created', async () => {
        await bot.handleChannelCreate({ name: 'Journals (N-Z)', type: CATEGORY, guild });

        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(bot.fixJournalPermissions).toHaveBeenCalledWith(guild);
    });

    it('ignores creation of a non-journal category', async () => {
        await bot.handleChannelCreate({ name: 'Game 12', type: CATEGORY, guild });

        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(bot.fixJournalPermissions).not.toHaveBeenCalled();
    });

    it('does nothing when ENABLE_JOURNAL_AUTO_FIX is false', async () => {
        process.env.ENABLE_JOURNAL_AUTO_FIX = 'false';

        await bot.handleChannelUpdate(
            makeChannel({ parentId: 'cat-a' }),
            makeChannel({ parentId: 'cat-b' })
        );
        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(bot.fixJournalPermissions).not.toHaveBeenCalled();
    });

    it('skips the mod chat report when there are no journals to fix', async () => {
        bot.fixJournalPermissions = jest.fn().mockResolvedValue({ error: 'No journal categories found.' });

        await bot.handleChannelUpdate(
            makeChannel({ parentId: 'cat-a' }),
            makeChannel({ parentId: 'cat-b' })
        );
        jest.runOnlyPendingTimers();
        await Promise.resolve();
        await Promise.resolve();

        expect(bot.reportJournalAutoFix).not.toHaveBeenCalled();
    });
});
