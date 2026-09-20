'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { createTestBot } = require('../helpers/bot-factory');
const { createMockMessage } = require('../helpers/mock-discord');
const { expectedForChannel } = require('../../handlers/permissions-audit');

const PIN_PERMISSION = 0x0008000000000000n;

// Wolf.perms_audit (feedback #30). The matrix itself is the source of truth shared with
// handleStart/handleAddChannel/handleNext, so these cover the comparison and repair
// behaviour rather than restating every cell.
describe('Permission audit', () => {
    let bot;

    const ROLE_IDS = {
        everyone: 'guild-1',
        Alive: 'alive-id',
        Dead: 'dead-id',
        Spectator: 'spectator-id',
        Mod: 'mod-id',
    };

    // Builds a channel whose overwrites match `state`: { targetId: { Perm: true|false } }
    function makeChannel(name, state = {}) {
        const cache = new Map();
        for (const [targetId, perms] of Object.entries(state)) {
            let allow = 0n;
            let deny = 0n;
            for (const [perm, value] of Object.entries(perms)) {
                const bit = perm === 'PinMessages' ? PIN_PERMISSION : PermissionFlagsBits[perm];
                if (value) allow |= bit; else deny |= bit;
            }
            cache.set(targetId, {
                allow: { has: (bit) => (allow & BigInt(bit)) === BigInt(bit) },
                deny: { has: (bit) => (deny & BigInt(bit)) === BigInt(bit) },
            });
        }
        return {
            id: `${name}-id`,
            name,
            permissionOverwrites: { cache, edit: jest.fn().mockResolvedValue(undefined) },
        };
    }

    // A results channel with every strict rule satisfied.
    const healthyResults = () => makeChannel('g1-results', {
        [ROLE_IDS.everyone]: { ViewChannel: false, SendMessages: false },
        [ROLE_IDS.Alive]: { ViewChannel: true, SendMessages: false },
        [ROLE_IDS.Dead]: { ViewChannel: true, SendMessages: false },
        [ROLE_IDS.Spectator]: { ViewChannel: true, SendMessages: false },
        [ROLE_IDS.Mod]: { ViewChannel: true, SendMessages: true },
    });

    function setup(channel, game = {}) {
        bot = createTestBot({
            channels: { fetch: jest.fn().mockResolvedValue(channel) },
        });
        bot.db.query = jest.fn().mockResolvedValue({ rows: [] }); // no custom channels
        const guild = {
            id: 'guild-1',
            roles: {
                everyone: { id: ROLE_IDS.everyone },
                cache: {
                    find: (fn) => [
                        { id: ROLE_IDS.Alive, name: 'Alive' },
                        { id: ROLE_IDS.Dead, name: 'Dead' },
                        { id: ROLE_IDS.Spectator, name: 'Spectator' },
                        { id: ROLE_IDS.Mod, name: 'Mod' },
                    ].find(fn) || null,
                },
            },
        };
        return { guild, game: { id: 1, game_number: 1, day_phase: 'night', day_number: 1, results_channel_id: 'g1-results-id', ...game } };
    }

    describe('expectedForChannel', () => {
        it('opens the voting booth to the living only on day 2 and later', () => {
            expect(expectedForChannel('voting_booth', { phase: 'day', dayNumber: 2 }).Alive.SendMessages.value).toBe(true);
            expect(expectedForChannel('voting_booth', { phase: 'day', dayNumber: 1 }).Alive.SendMessages.value).toBe(false);
            expect(expectedForChannel('voting_booth', { phase: 'night', dayNumber: 3 }).Alive.SendMessages.value).toBe(false);
        });

        it('keeps couple chat night-only regardless of the open_at flags', () => {
            const day = expectedForChannel('couple_chat', { phase: 'day', openAtDawn: true, openAtDusk: true });
            const night = expectedForChannel('couple_chat', { phase: 'night', openAtDawn: false, openAtDusk: false });

            expect(day.Alive.SendMessages.value).toBe(false);
            expect(night.Alive.SendMessages.value).toBe(true);
        });

        it('drives custom channels from open_at_dawn / open_at_dusk', () => {
            expect(expectedForChannel('custom', { phase: 'day', openAtDawn: true }).Alive.SendMessages.value).toBe(true);
            expect(expectedForChannel('custom', { phase: 'day', openAtDawn: false }).Alive.SendMessages.value).toBe(false);
            expect(expectedForChannel('custom', { phase: 'night', openAtDusk: false }).Alive.SendMessages.value).toBe(false);
        });

        it('marks town square and memos Alive rules as not strictly auditable', () => {
            expect(expectedForChannel('town_square').Alive.SendMessages.strict).toBe(false);
            expect(expectedForChannel('memos').Alive.SendMessages.strict).toBe(false);
            // but the roles that lockdown/dark mode never touch stay strict
            expect(expectedForChannel('town_square').Dead.ViewChannel.strict).toBe(true);
        });
    });

    describe('auditGamePermissions', () => {
        it('reports no drift when the channel matches the matrix', async () => {
            const channel = healthyResults();
            const { guild, game } = setup(channel);

            const result = await bot.auditGamePermissions(guild, game);

            expect(result.checked).toBe(1);
            expect(result.drift).toHaveLength(0);
        });

        it('flags a role that can talk where it should not', async () => {
            const channel = healthyResults();
            // Dead gained SendMessages on results
            channel.permissionOverwrites.cache.set(ROLE_IDS.Dead, {
                allow: { has: (bit) => BigInt(bit) === PermissionFlagsBits.ViewChannel || BigInt(bit) === PermissionFlagsBits.SendMessages },
                deny: { has: () => false },
            });
            const { guild, game } = setup(channel);

            const result = await bot.auditGamePermissions(guild, game);

            expect(result.drift).toHaveLength(1);
            expect(result.drift[0]).toMatchObject({
                role: 'Dead',
                permission: 'SendMessages',
                expected: false,
                actual: true,
                fixed: false,
            });
            expect(channel.permissionOverwrites.edit).not.toHaveBeenCalled();
        });

        it('treats a missing overwrite as inherited drift', async () => {
            const channel = healthyResults();
            channel.permissionOverwrites.cache.delete(ROLE_IDS.Mod);
            const { guild, game } = setup(channel);

            const result = await bot.auditGamePermissions(guild, game);

            expect(result.drift).toHaveLength(2); // Mod ViewChannel + SendMessages
            expect(result.drift.every(d => d.actual === null)).toBe(true);
        });

        it('repairs drift in fix mode', async () => {
            const channel = healthyResults();
            channel.permissionOverwrites.cache.delete(ROLE_IDS.Mod);
            const { guild, game } = setup(channel);

            const result = await bot.auditGamePermissions(guild, game, { fix: true });

            expect(result.drift.every(d => d.fixed)).toBe(true);
            expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith(ROLE_IDS.Mod, { ViewChannel: true });
            expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith(ROLE_IDS.Mod, { SendMessages: true });
        });

        it('never repairs the advisory town square / memos cells', async () => {
            const channel = makeChannel('g1-townsquare', {
                [ROLE_IDS.everyone]: { ViewChannel: false, SendMessages: false },
                [ROLE_IDS.Alive]: { ViewChannel: false, SendMessages: false }, // looks like a lockdown
                [ROLE_IDS.Dead]: { ViewChannel: true, SendMessages: false },
                [ROLE_IDS.Spectator]: { ViewChannel: true, SendMessages: false },
                [ROLE_IDS.Mod]: { ViewChannel: true, SendMessages: true },
            });
            const { guild, game } = setup(channel, {
                results_channel_id: null,
                town_square_channel_id: 'g1-townsquare-id',
            });

            const result = await bot.auditGamePermissions(guild, game, { fix: true });

            expect(result.drift).toHaveLength(0);
            expect(channel.permissionOverwrites.edit).not.toHaveBeenCalled();
            // still surfaced for a human to eyeball
            expect(result.advisories.some(a => a.role === 'Alive' && a.actual === false)).toBe(true);
        });

        it('flags a couple chat member who lost view or pin access', async () => {
            const channel = makeChannel('g1-couple-chat', {
                [ROLE_IDS.everyone]: { ViewChannel: false, SendMessages: false },
                [ROLE_IDS.Alive]: { ViewChannel: false, SendMessages: true },
                [ROLE_IDS.Dead]: { ViewChannel: true, SendMessages: false },
                [ROLE_IDS.Spectator]: { ViewChannel: true, SendMessages: false },
                [ROLE_IDS.Mod]: { ViewChannel: true, SendMessages: true },
                'partner-a': { ViewChannel: true, PinMessages: true },
                'partner-b': { ViewChannel: true }, // can see, cannot pin
            });
            const { guild, game } = setup(channel, { results_channel_id: null });
            bot.db.query = jest.fn().mockResolvedValue({
                rows: [{
                    channel_id: 'g1-couple-chat-id',
                    channel_name: 'g1-couple-chat',
                    open_at_dawn: true,
                    open_at_dusk: true,
                    is_couple_chat: true,
                    invited_users: ['partner-a', 'partner-b'],
                }],
            });

            const result = await bot.auditGamePermissions(guild, game);

            expect(result.drift).toHaveLength(1);
            expect(result.drift[0]).toMatchObject({ role: '<@partner-b>', permission: 'PinMessages' });
        });

        it('records channels it cannot fetch instead of throwing', async () => {
            const { guild, game } = setup(null);

            const result = await bot.auditGamePermissions(guild, game);

            expect(result.checked).toBe(0);
            expect(result.missing).toHaveLength(1);
        });
    });

    describe('handlePermsAudit', () => {
        it('tells the mod when there is no active game', async () => {
            bot = createTestBot();
            bot.db.query = jest.fn().mockResolvedValue({ rows: [] });
            const msg = createMockMessage();

            await bot.handlePermsAudit(msg, []);

            expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('No active game'));
        });
    });
});
