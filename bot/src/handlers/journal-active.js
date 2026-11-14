'use strict';

const { ChannelType } = require('discord.js');

// Active journals (feedback #88).
//
// Opt-in per server (Wolf.settings active_journals on). While it is on, the journals of
// everyone in the current game sit together in one "Active Journals" category, and
// everyone else's stay in the regular "Journals" / "Journals (A-L)" categories, which
// act as the archive. A journal moves up when its owner joins a game and back down when
// they leave it or the game ends.
//
// "Active Journals" deliberately doesn't match the "Journals" naming scheme, so the
// alphabetical balancing in journal.js never counts or reshuffles it.

const ACTIVE_JOURNALS_CATEGORY = 'Active Journals';
// Discord's limit on channels in one category
const MAX_CHANNELS_PER_CATEGORY = 50;
// How long a bot-initiated move is remembered so the journal auto-fix watcher ignores it
const BOT_MOVE_MEMORY_MS = 60 * 1000;

const isArchiveJournalCategory = (channel) =>
    channel.type === ChannelType.GuildCategory &&
    (channel.name === 'Journals' || channel.name.startsWith('Journals ('));

const isJournalChannel = (channel) => typeof channel?.name === 'string' && channel.name.endsWith('-journal');

module.exports = {

ACTIVE_JOURNALS_CATEGORY,

async isActiveJournalsEnabled(serverId) {
    try {
        const result = await this.db.query(
            'SELECT active_journals FROM server_configs WHERE server_id = $1',
            [serverId]
        );
        return result.rows[0]?.active_journals === true;
    } catch (error) {
        console.error('Error loading the active journals setting, treating it as off:', error);
        return false;
    }
},

getActiveJournalsCategory(guild) {
    return guild.channels.cache.find(
        channel => channel.type === ChannelType.GuildCategory && channel.name === ACTIVE_JOURNALS_CATEGORY
    ) || null;
},

async ensureActiveJournalsCategory(guild) {
    const existing = this.getActiveJournalsCategory(guild);
    if (existing) return existing;

    // Start from the same permissions as the existing journal categories, and sit just above them
    const firstArchiveCategory = guild.channels.cache
        .filter(isArchiveJournalCategory)
        .sort((a, b) => a.position - b.position)
        .first();
    const permissionOverwrites = firstArchiveCategory?.permissionOverwrites?.cache?.map(overwrite => ({
        id: overwrite.id,
        allow: overwrite.allow.bitfield,
        deny: overwrite.deny.bitfield,
    })) ?? [];

    const category = await guild.channels.create({
        name: ACTIVE_JOURNALS_CATEGORY,
        type: ChannelType.GuildCategory,
        permissionOverwrites,
    });

    if (firstArchiveCategory) {
        try {
            await category.setPosition(firstArchiveCategory.position);
        } catch (error) {
            console.error('Error positioning Active Journals category:', error);
        }
    }

    console.log(`📔 Created "${ACTIVE_JOURNALS_CATEGORY}" category in ${guild.name}`);
    return category;
},

// Moving a journal between categories normally makes the auto-fix watcher
// (handleChannelUpdate) reapply permissions to every journal on the server. These moves
// keep the channel's own overwrites, so there is nothing to fix; remember them so the
// watcher can skip them.
wasJournalMovedByBot(channelId) {
    return Boolean(this.botJournalMoves && this.botJournalMoves.has(channelId));
},

async moveJournalToCategory(journal, category) {
    if (!this.botJournalMoves) {
        this.botJournalMoves = new Set();
    }
    this.botJournalMoves.add(journal.id);
    const timer = setTimeout(() => this.botJournalMoves.delete(journal.id), BOT_MOVE_MEMORY_MS);
    if (typeof timer.unref === 'function') timer.unref();

    // lockPermissions: false keeps the journal's own overwrites instead of syncing to the category
    await journal.setParent(category.id, { lockPermissions: false });
},

async fetchJournalChannel(guild, userId) {
    const journalResult = await this.db.query(
        'SELECT channel_id FROM player_journals WHERE server_id = $1 AND user_id = $2',
        [guild.id, userId]
    );
    if (!journalResult.rows.length) return null;
    return this.client.channels.fetch(journalResult.rows[0].channel_id).catch(() => null);
},

// Moves one player's journal into Active Journals. Returns true if it moved.
// Skips the per-move alphabetizing when `sort` is false (bulk callers sort once at the end).
async activateJournal(guild, userId, { sort = true } = {}) {
    try {
        if (!(await this.isActiveJournalsEnabled(guild.id))) return false;

        const journal = await this.fetchJournalChannel(guild, userId);
        if (!journal) return false;

        const activeCategory = await this.ensureActiveJournalsCategory(guild);
        if (journal.parentId === activeCategory.id) return false;

        const activeCount = guild.channels.cache.filter(channel => channel.parentId === activeCategory.id).size;
        if (activeCount >= MAX_CHANNELS_PER_CATEGORY) {
            console.warn(`"${ACTIVE_JOURNALS_CATEGORY}" is full (${activeCount} channels) - leaving ${journal.name} where it is`);
            return false;
        }

        await this.moveJournalToCategory(journal, activeCategory);
        if (sort) {
            await this.alphabetizeJournalsInCategory(guild, activeCategory);
        }
        console.log(`📔 Moved ${journal.name} to "${ACTIVE_JOURNALS_CATEGORY}"`);
        return true;
    } catch (error) {
        console.error(`Error moving journal of ${userId} to "${ACTIVE_JOURNALS_CATEGORY}":`, error);
        return false;
    }
},

// Moves every journal of a game's players into Active Journals. Returns how many moved.
async activateGameJournals(guild, gameId) {
    const playersResult = await this.db.query(
        'SELECT user_id FROM players WHERE game_id = $1',
        [gameId]
    );

    let moved = 0;
    for (const player of playersResult.rows) {
        if (await this.activateJournal(guild, player.user_id, { sort: false })) {
            moved++;
        }
    }

    if (moved > 0) {
        await this.alphabetizeJournalsInCategory(guild, this.getActiveJournalsCategory(guild));
    }
    return moved;
},

// Puts one journal channel back into the archive category it belongs in alphabetically.
// Returns that category. Callers alphabetize and rebalance afterwards.
async returnJournalToArchive(guild, journal) {
    // Same order as journal creation: make room first, then pick the category
    await this.checkAndProactivelySplitJournals(guild);

    let targetCategory = await this.findAppropriateJournalCategory(guild, journal.name.replace(/-journal$/, ''));
    if (!targetCategory) {
        targetCategory = await guild.channels.create({
            name: 'Journals',
            type: ChannelType.GuildCategory,
        });
    }

    await this.moveJournalToCategory(journal, targetCategory);
    console.log(`📔 Moved ${journal.name} back to "${targetCategory.name}"`);
    return targetCategory;
},

// Moves one player's journal out of Active Journals. Does nothing if it isn't there,
// so it is safe to call whether or not the server uses the feature.
async archiveJournal(guild, userId) {
    try {
        const activeCategory = this.getActiveJournalsCategory(guild);
        if (!activeCategory) return false;

        const journal = await this.fetchJournalChannel(guild, userId);
        if (!journal || journal.parentId !== activeCategory.id) return false;

        const targetCategory = await this.returnJournalToArchive(guild, journal);
        await this.alphabetizeJournalsInCategory(guild, targetCategory);
        await this.checkAndRebalanceJournals(guild);
        return true;
    } catch (error) {
        console.error(`Error moving journal of ${userId} back to the journal archive:`, error);
        return false;
    }
},

// Empties Active Journals back into the archive categories (game over). Returns how many moved.
async archiveAllActiveJournals(guild) {
    let moved = 0;
    try {
        const activeCategory = this.getActiveJournalsCategory(guild);
        if (!activeCategory) return 0;

        const journals = guild.channels.cache.filter(
            channel => channel.parentId === activeCategory.id && isJournalChannel(channel)
        );

        const touchedCategories = new Map();
        for (const journal of journals.values()) {
            try {
                const targetCategory = await this.returnJournalToArchive(guild, journal);
                touchedCategories.set(targetCategory.id, targetCategory);
                moved++;
            } catch (error) {
                console.error(`Error moving ${journal.name} back to the journal archive:`, error);
            }
        }

        for (const category of touchedCategories.values()) {
            await this.alphabetizeJournalsInCategory(guild, category);
        }
        if (moved > 0) {
            await this.checkAndRebalanceJournals(guild);
        }
    } catch (error) {
        console.error('Error emptying the Active Journals category:', error);
    }
    return moved;
},

// Wolf.settings active_journals on|off
async setActiveJournals(message, enabled) {
    const guild = message.guild;

    await this.db.query(
        'UPDATE server_configs SET active_journals = $1 WHERE server_id = $2',
        [enabled, guild.id]
    );

    if (!enabled) {
        const moved = await this.archiveAllActiveJournals(guild);
        return message.reply(`✅ Active journals turned **off**. Moved ${moved} journal${moved === 1 ? '' : 's'} back to the regular journal categories.`);
    }

    // Catch up with a game that is already underway
    const gameResult = await this.db.query(
        "SELECT id FROM games WHERE server_id = $1 AND status IN ('signup', 'active') ORDER BY id DESC LIMIT 1",
        [guild.id]
    );
    const moved = gameResult.rows.length
        ? await this.activateGameJournals(guild, gameResult.rows[0].id)
        : 0;

    return message.reply(
        `✅ Active journals turned **on**. Journals of players in the current game live in **${ACTIVE_JOURNALS_CATEGORY}** and go back to the regular journal categories when the game ends.` +
        (moved > 0 ? ` Moved ${moved} journal${moved === 1 ? '' : 's'} there now.` : '')
    );
},

};
