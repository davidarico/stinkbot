'use strict';

const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage, createMockMember } = require('../helpers/mock-discord');

describe('Journal Handlers', () => {
    let bot;

    beforeEach(() => {
        bot = createTestBot();
    });

    describe('handleJournal', () => {
        it('creates a journal channel for a specified player', async () => {
            const targetUser = { id: 'target-id' };
            const targetMember = { id: 'target-id', displayName: 'Alice', toString: () => '<@target-id>' };
            const game = { id: 1, category_id: 'cat-id' };
            const mockCategory = { id: 'journals-cat-id', name: 'Journals', type: 4 };
            const journalChannel = {
                id: 'journal-id',
                send: jest.fn().mockResolvedValue({}),
            };

            bot.checkAndProactivelySplitJournals = jest.fn().mockResolvedValue(false);
            bot.findAppropriateJournalCategory = jest.fn().mockResolvedValue(mockCategory);
            bot.alphabetizeJournalsInCategory = jest.fn().mockResolvedValue(undefined);
            bot.checkAndRebalanceJournals = jest.fn().mockResolvedValue(undefined);

            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [game] })  // SELECT games
                .mockResolvedValueOnce({ rows: [] });      // INSERT player_journals

            const msg = createMockMessage();
            msg.mentions.users.first = jest.fn().mockReturnValue(targetUser);
            msg.guild.members.fetch = jest.fn().mockResolvedValue(targetMember);
            msg.guild.channels.cache.find = jest.fn().mockReturnValue(null); // no existing journal
            msg.guild.channels.create = jest.fn().mockResolvedValue(journalChannel);

            const roleMap = [
                { id: 'mod-id', name: 'Mod' },
                { id: 'spectator-id', name: 'Spectator' },
                { id: 'dead-id', name: 'Dead' },
            ];
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn => roleMap.find(fn) || null);

            await bot.handleJournal(msg, []);

            expect(msg.guild.channels.create).toHaveBeenCalled();
            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO player_journals'),
                expect.arrayContaining(['guild-123', 'target-id'])
            );
            expect(msg.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
        });

        it('replies with error when player already has a journal', async () => {
            const targetUser = { id: 'target-id' };
            const targetMember = { id: 'target-id', displayName: 'Alice' };
            const game = { id: 1, category_id: 'cat-id' };
            const mockCategory = { id: 'journals-cat-id', name: 'Journals', type: 4 };
            const existingJournal = { id: 'existing-journal-id', name: 'alice-journal', parent: { id: 'journals-cat-id' } };

            bot.checkAndProactivelySplitJournals = jest.fn().mockResolvedValue(false);
            bot.findAppropriateJournalCategory = jest.fn().mockResolvedValue(mockCategory);

            bot.db.query = jest.fn().mockResolvedValue({ rows: [game] });

            const msg = createMockMessage();
            msg.mentions.users.first = jest.fn().mockReturnValue(targetUser);
            msg.guild.members.fetch = jest.fn().mockResolvedValue(targetMember);
            msg.guild.channels.cache.find = jest.fn().mockReturnValue(existingJournal);

            await bot.handleJournal(msg, []);

            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('already exists'));
        });

        it('replies with error when no target user is mentioned', async () => {
            const msg = createMockMessage();
            msg.mentions.users.first = jest.fn().mockReturnValue(null);

            await bot.handleJournal(msg, []);

            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('mention'));
        });
    });

    describe('ensureUserHasJournal', () => {
        it('returns early when the user already has a valid journal channel', async () => {
            const user = { id: 'user-1' };
            const existingChannel = { id: 'journal-ch-id', name: 'alice-journal' };

            bot.db.query = jest.fn().mockResolvedValue({
                rows: [{ channel_id: 'journal-ch-id' }],
            });
            bot.client.channels = { fetch: jest.fn().mockResolvedValue(existingChannel) };

            const msg = createMockMessage();
            await bot.ensureUserHasJournal(msg, user);

            // No channel creation
            expect(msg.guild.channels.create).not.toHaveBeenCalled();
        });

        it('creates a new journal channel if none exists in DB', async () => {
            const user = { id: 'user-1' };
            const targetMember = { id: 'user-1', displayName: 'Alice', toString: () => '<@user-1>' };
            const mockCategory = { id: 'journals-cat-id', name: 'Journals', type: 4 };
            const journalChannel = { id: 'new-journal-id', send: jest.fn().mockResolvedValue({}) };

            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [] })         // no existing journal
                .mockResolvedValueOnce({ rows: [] })         // SELECT games
                .mockResolvedValueOnce({ rows: [] });         // INSERT player_journals

            bot.checkAndProactivelySplitJournals = jest.fn().mockResolvedValue(false);
            bot.findAppropriateJournalCategory = jest.fn().mockResolvedValue(mockCategory);
            bot.alphabetizeJournalsInCategory = jest.fn().mockResolvedValue(undefined);
            bot.checkAndRebalanceJournals = jest.fn().mockResolvedValue(undefined);

            const msg = createMockMessage();
            msg.guild.members.fetch = jest.fn().mockResolvedValue(targetMember);
            msg.guild.channels.cache.find = jest.fn().mockReturnValue(null);
            msg.guild.channels.create = jest.fn().mockResolvedValue(journalChannel);

            const roleMap = [{ id: 'mod-id', name: 'Mod' }];
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn => roleMap.find(fn) || null);

            await bot.ensureUserHasJournal(msg, user);

            expect(msg.guild.channels.create).toHaveBeenCalled();
        });

        it('places journal in the correct alphabetical category', async () => {
            const user = { id: 'user-1' };
            const targetMember = { id: 'user-1', displayName: 'Alice', toString: () => '<@user-1>' };
            const mockCategory = { id: 'a-m-cat-id', name: 'Journals (A-M)', type: 4 };
            const journalChannel = { id: 'new-journal-id', send: jest.fn().mockResolvedValue({}) };

            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] });

            bot.checkAndProactivelySplitJournals = jest.fn().mockResolvedValue(false);
            bot.findAppropriateJournalCategory = jest.fn().mockResolvedValue(mockCategory);
            bot.alphabetizeJournalsInCategory = jest.fn().mockResolvedValue(undefined);
            bot.checkAndRebalanceJournals = jest.fn().mockResolvedValue(undefined);

            const msg = createMockMessage();
            msg.guild.members.fetch = jest.fn().mockResolvedValue(targetMember);
            msg.guild.channels.cache.find = jest.fn().mockReturnValue(null);
            msg.guild.channels.create = jest.fn().mockResolvedValue(journalChannel);
            msg.guild.roles.cache.find = jest.fn().mockReturnValue(null);

            await bot.ensureUserHasJournal(msg, user);

            expect(bot.findAppropriateJournalCategory).toHaveBeenCalledWith(
                msg.guild, targetMember.displayName
            );
            // Channel should be created in the category returned by findAppropriateJournalCategory
            const createCall = msg.guild.channels.create.mock.calls[0][0];
            expect(createCall.parent).toBe(mockCategory.id);
        });
    });

    describe('handleMyJournal', () => {
        it("replies with a link to the calling user's journal channel", async () => {
            bot.db.query = jest.fn().mockResolvedValue({
                rows: [{ channel_id: 'journal-ch-id' }],
            });
            const journalChannel = { id: 'journal-ch-id', name: 'alice-journal' };

            const msg = createMockMessage();
            msg.guild.channels.fetch = jest.fn().mockResolvedValue(journalChannel);

            await bot.handleMyJournal(msg);

            const reply = msg.reply.mock.calls[0][0];
            expect(reply).toMatchObject({ embeds: expect.any(Array) });
        });

        it('replies with error when user has no journal', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });

            const msg = createMockMessage();
            await bot.handleMyJournal(msg);

            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining("don't have a journal"));
        });
    });

    describe('handleRenameJournal', () => {
        it("renames the calling user's journal channel", async () => {
            bot.db.query = jest.fn().mockResolvedValue({
                rows: [{ channel_id: 'journal-ch-id' }],
            });

            const journalChannel = {
                id: 'journal-ch-id', name: 'alice-journal',
                parent: { id: 'journals-cat-id' },
                setName: jest.fn().mockResolvedValue(undefined),
            };
            const msg = createMockMessage();
            msg.guild.channels.fetch = jest.fn().mockResolvedValue(journalChannel);
            msg.guild.channels.cache.find = jest.fn().mockReturnValue(null); // no existing same-name

            await bot.handleRenameJournal(msg, ['bob']);

            expect(journalChannel.setName).toHaveBeenCalledWith('bob-journal');
            const reply = msg.reply.mock.calls[0][0];
            expect(reply).toMatchObject({ embeds: expect.any(Array) });
        });

        it('replies with error when the calling user has no journal to rename', async () => {
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });

            const msg = createMockMessage();
            await bot.handleRenameJournal(msg, ['newname']);

            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining("don't have a journal"));
        });
    });

    describe('handleBalanceJournals', () => {
        it('redistributes journals evenly across categories', async () => {
            const mockCategory = {
                id: 'journals-cat-id', name: 'Journals', type: 4,
                children: {
                    cache: {
                        size: 0,
                        filter: jest.fn().mockReturnValue({ size: 0, values: () => [] }),
                    },
                },
            };

            const msg = createMockMessage();
            msg.member.permissions.has = jest.fn().mockReturnValue(true); // mod
            msg.guild.channels.cache.filter = jest.fn().mockReturnValue({
                size: 1,
                values: () => [mockCategory],
                first: jest.fn().mockReturnValue(mockCategory),
            });

            bot.alphabetizeJournalsInCategory = jest.fn().mockResolvedValue(undefined);

            await bot.handleBalanceJournals(msg);

            expect(bot.alphabetizeJournalsInCategory).toHaveBeenCalled();
        });
    });

    describe('handleFixJournals', () => {
        it('fixes permission overwrites on journal channels', async () => {
            const mockJournalChannel = {
                id: 'j-id', name: 'alice-journal',
                permissionOverwrites: { edit: jest.fn().mockResolvedValue(undefined) },
                parent: { id: 'cat-id' },
            };
            const mockCategory = { id: 'cat-id', name: 'Journals', type: 4 };

            const msg = createMockMessage();
            // guild.channels.cache.filter returns categories first, then child channels
            let filterCallCount = 0;
            msg.guild.channels.cache.filter = jest.fn().mockImplementation(() => {
                filterCallCount++;
                if (filterCallCount === 1) {
                    // categories filter
                    return {
                        size: 1,
                        values: () => [mockCategory],
                    };
                }
                // child channels filter
                return {
                    size: 1,
                    values: () => [mockJournalChannel],
                };
            });

            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ channel_id: 'j-id', user_id: 'user-1' }] }) // all journals query
                .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] });                      // per-journal user lookup

            const mockMember = { id: 'user-1' };
            msg.guild.members.fetch = jest.fn().mockResolvedValue(mockMember);

            const roleMap = [
                { id: 'mod-id', name: 'Mod' },
                { id: 'spectator-id', name: 'Spectator' },
                { id: 'dead-id', name: 'Dead' },
                { id: 'alive-id', name: 'Alive' },
                { id: 'signed-up-id', name: 'Signed Up' },
            ];
            msg.guild.roles.cache.find = jest.fn().mockImplementation(fn => roleMap.find(fn) || null);

            await bot.handleFixJournals(msg);

            expect(mockJournalChannel.permissionOverwrites.edit).toHaveBeenCalled();
        });
    });

    describe('findAppropriateJournalCategory', () => {
        it('returns the single category when there is room', async () => {
            const mockCategory = { id: 'cat-id', name: 'Journals', type: 4 };

            const guild = {
                channels: {
                    cache: {
                        filter: jest.fn().mockImplementation(() => ({
                            size: 1,
                            values: () => [mockCategory],
                            first: jest.fn().mockReturnValue(mockCategory),
                            find: jest.fn().mockReturnValue(null),
                        })),
                    },
                },
            };

            // Override filter to return journal channels count (< 50)
            let filterCount = 0;
            guild.channels.cache.filter = jest.fn().mockImplementation(() => {
                filterCount++;
                if (filterCount === 1) {
                    // categories filter
                    return {
                        size: 1,
                        values: () => [mockCategory],
                        first: jest.fn().mockReturnValue(mockCategory),
                        find: jest.fn().mockReturnValue(null),
                    };
                }
                // journal channels filter (for channel count)
                return { size: 5, values: () => [] };
            });

            const result = await bot.findAppropriateJournalCategory(guild, 'Alice');
            expect(result).toBe(mockCategory);
        });

        it('returns null when no journal categories exist', async () => {
            const guild = {
                channels: {
                    cache: {
                        filter: jest.fn().mockReturnValue({ size: 0, values: () => [] }),
                    },
                },
            };

            const result = await bot.findAppropriateJournalCategory(guild, 'Alice');
            expect(result).toBeNull();
        });
    });

    describe('checkAndRebalanceJournals', () => {
        it('calls performJournalRebalancing when categories have journal channels', async () => {
            const mockCategory = { id: 'cat-id', name: 'Journals', type: 4 };
            const mockJournal = { id: 'j-id', name: 'alice-journal', parent: { id: 'cat-id' } };

            bot.performJournalRebalancing = jest.fn().mockResolvedValue(undefined);

            const guild = { channels: { cache: { filter: jest.fn() } } };
            let filterCount = 0;
            guild.channels.cache.filter = jest.fn().mockImplementation(() => {
                filterCount++;
                if (filterCount === 1) {
                    return {
                        size: 1,
                        values: () => [mockCategory],
                    };
                }
                return { size: 1, values: () => [mockJournal] };
            });

            await bot.checkAndRebalanceJournals(guild);

            expect(bot.performJournalRebalancing).toHaveBeenCalled();
        });
    });

    describe('handleJournalLink', () => {
        function makeFilterableMap(entries) {
            const map = new Map(entries);
            map.filter = (fn) => makeFilterableMap([...map.entries()].filter(([, v]) => fn(v)));
            return map;
        }

        it('replies that all journals are already linked when none are unlinked', async () => {
            // DB reports the channel is already linked
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ user_id: 'u1', channel_id: 'journal-ch-id' }] }); // existing journals

            const unlinkeddChannel = {
                id: 'journal-ch-id', name: 'alice-journal', type: 0,
            };

            const msg = createMockMessage();
            msg.guild.channels.fetch = jest.fn().mockResolvedValue(
                makeFilterableMap([['journal-ch-id', unlinkeddChannel]])
            );
            msg.guild.members.fetch = jest.fn().mockResolvedValue(new Map());

            await bot.handleJournalLink(msg);

            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('linked'));
        });

        it('replies when all journal channels are already linked to users', async () => {
            bot.db.query = jest.fn().mockResolvedValue({
                rows: [{ user_id: 'u1', channel_id: 'journal-ch-id' }],
            });

            const msg = createMockMessage();
            msg.guild.channels.fetch = jest.fn().mockResolvedValue(
                makeFilterableMap([['journal-ch-id', { id: 'journal-ch-id', name: 'alice-journal', type: 0 }]])
            );

            await bot.handleJournalLink(msg);

            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('already linked'));
        });
    });

    describe('handleJournalUnlink', () => {
        it('removes journal record from DB without deleting the channel', async () => {
            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] })  // check journal exists
                .mockResolvedValueOnce({ rows: [] });                        // DELETE

            const msg = createMockMessage();
            msg.channel.name = 'alice-journal';
            msg.guild.members.fetch = jest.fn().mockResolvedValue({
                id: 'user-1', displayName: 'Alice',
                user: { tag: 'Alice#0001' },
            });
            msg.channel.awaitMessages = jest.fn().mockResolvedValue({
                size: 1,
                first: jest.fn().mockReturnValue({ content: 'confirm' }),
            });

            await bot.handleJournalUnlink(msg);

            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM player_journals'),
                ['guild-123', 'channel-123']
            );
            expect(msg.channel.delete).not.toBeDefined(); // channel not deleted
        });
    });

    describe('handleJournalAssign', () => {
        it('assigns a journal channel to a different user', async () => {
            const targetUser = { id: 'new-user-id', tag: 'NewUser#0001', displayAvatarURL: jest.fn().mockReturnValue('https://cdn.discordapp.com/avatars/new-user-id/abc.png') };
            const targetMember = { id: 'new-user-id', displayName: 'NewUser' };

            bot.db.query = jest.fn()
                .mockResolvedValueOnce({ rows: [] })  // check current journal assignment (none)
                .mockResolvedValueOnce({ rows: [] })  // check target user's existing journal (none)
                .mockResolvedValueOnce({ rows: [] }); // INSERT assignment

            const msg = createMockMessage();
            msg.channel.name = 'alice-journal';
            msg.channel.send = jest.fn().mockResolvedValue({});
            msg.mentions.users.first = jest.fn().mockReturnValue(targetUser);
            msg.guild.members.fetch = jest.fn().mockResolvedValue(targetMember);

            await bot.handleJournalAssign(msg, []);

            expect(bot.db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO player_journals'),
                ['guild-123', 'new-user-id', 'channel-123']
            );
            const reply = msg.reply.mock.calls[0][0];
            expect(reply).toMatchObject({ embeds: expect.any(Array) });
        });
    });
});
