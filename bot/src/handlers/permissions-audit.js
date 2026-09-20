'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

// Discord's PinMessages flag (1 << 51) is missing from discord.js 14's PermissionFlagsBits,
// so it is referenced by raw value here, matching journal.js/voting.js/utils.js/game.js.
const PIN_PERMISSION = 0x0008000000000000n;

// ---------------------------------------------------------------------------
// Expected permission matrix (feedback #30)
//
// Channel permissions are written in three different places - handleStart
// (game.js), handleAddChannel (channels.js) and the phase logic in handleNext
// (game-phases.js) - so drift has been the most recurring bug class in this
// repo. This module is the one place that says what the permissions are
// *supposed* to be, and Wolf.perms_audit compares reality against it.
//
// Only ViewChannel and SendMessages are modelled. Thread/reaction flags are set
// at creation but never toggled afterwards, and auditing them produces noise
// without catching the failures players actually hit.
//
// Every rule is either:
//   strict   - fully determined by game state, so a mismatch is real drift and
//              `Wolf.perms_audit fix` will repair it.
//   advisory - depends on state the bot never persists, so it is reported for
//              information and never counted as drift or "fixed". Two things
//              land here: `Wolf.start dark` (dark mode is an argument, not a
//              column) and `Wolf.lockdown` (also not persisted). Both move the
//              same cells: the Alive role on town square, memos, and Alive's
//              ViewChannel on the voting booth.
// ---------------------------------------------------------------------------

const VIEW = 'ViewChannel';

const strict = (view, send) => ({ ViewChannel: { value: view, strict: true }, SendMessages: { value: send, strict: true } });

function advisory(reason) {
    return {
        ViewChannel: { value: null, strict: false, reason },
        SendMessages: { value: null, strict: false, reason },
    };
}

const DARK_OR_LOCKDOWN = 'depends on `Wolf.start dark` / `Wolf.lockdown`, neither of which is persisted';
const DARK_ONLY = 'depends on `Wolf.start dark`, which is not persisted';

/**
 * Expected role -> permission map for one channel.
 *
 * @param {string} kind        results | memos | town_square | voting_booth | wolf_chat | dead_chat | mod_chat | custom | couple_chat
 * @param {object} state       { phase: 'day'|'night', dayNumber: number, openAtDawn: bool, openAtDusk: bool }
 * @returns {object} roleName -> { PermissionName: { value: bool|null, strict: bool, reason?: string } }
 */
function expectedForChannel(kind, state = {}) {
    const phase = state.phase === 'day' ? 'day' : 'night';
    const dayNumber = Number(state.dayNumber) || 1;

    switch (kind) {
        case 'results':
            return {
                '@everyone': strict(false, false),
                Alive: strict(true, false),
                Dead: strict(true, false),
                Spectator: strict(true, false),
                Mod: strict(true, true),
            };

        case 'memos':
            return {
                '@everyone': strict(false, false),
                Alive: advisory(DARK_OR_LOCKDOWN),
                Dead: strict(true, false),
                Spectator: strict(true, false),
                Mod: strict(true, true),
            };

        case 'town_square':
            return {
                '@everyone': strict(false, false),
                Alive: advisory(DARK_OR_LOCKDOWN),
                Dead: strict(true, false),
                Spectator: strict(true, false),
                Mod: strict(true, true),
            };

        case 'voting_booth':
            return {
                '@everyone': strict(false, false),
                Alive: {
                    // Dark mode hides the booth from the living; otherwise they can read it.
                    ViewChannel: { value: null, strict: false, reason: DARK_ONLY },
                    // Voting opens on day 2+ only - day 1 has no vote (game-phases.js).
                    SendMessages: { value: phase === 'day' && dayNumber >= 2, strict: true },
                },
                Dead: strict(true, false),
                Spectator: strict(true, false),
                Mod: strict(true, true),
            };

        case 'wolf_chat':
            return {
                '@everyone': strict(false, false),
                // Wolves get a per-user ViewChannel overwrite; the role itself stays denied.
                Alive: strict(false, true),
                Dead: strict(true, false),
                Spectator: strict(true, false),
                Mod: strict(true, true),
            };

        case 'dead_chat':
            return {
                // @everyone is deliberately left untouched on dead chat (game.js), so it
                // is not audited here.
                Alive: { ViewChannel: { value: false, strict: true } },
                Dead: strict(true, true),
                Spectator: strict(true, true),
                Mod: strict(true, true),
            };

        case 'mod_chat':
            return {
                '@everyone': strict(false, false),
                Mod: strict(true, true),
            };

        case 'couple_chat':
            return {
                '@everyone': strict(false, false),
                // Couple chat is night-only regardless of the open_at_* flags (feedback #82).
                Alive: {
                    ViewChannel: { value: false, strict: true },
                    SendMessages: { value: phase === 'night', strict: true },
                },
                Dead: strict(true, false),
                Spectator: strict(true, false),
                Mod: strict(true, true),
            };

        case 'custom':
            return {
                '@everyone': strict(false, false),
                Alive: {
                    ViewChannel: { value: false, strict: true },
                    SendMessages: {
                        value: phase === 'day' ? state.openAtDawn !== false : state.openAtDusk !== false,
                        strict: true,
                    },
                },
                Dead: strict(true, false),
                Spectator: strict(true, false),
                Mod: strict(true, true),
            };

        default:
            return {};
    }
}

module.exports = {

expectedForChannel,

// Reads the effective value of one permission on one overwrite target:
// true = explicitly allowed, false = explicitly denied, null = inherited.
readOverwrite(channel, targetId, permissionName) {
    const overwrite = channel.permissionOverwrites?.cache?.get(targetId);
    if (!overwrite) return null;
    const bit = PermissionFlagsBits[permissionName];
    if (overwrite.allow?.has?.(bit)) return true;
    if (overwrite.deny?.has?.(bit)) return false;
    return null;
},

// Builds the list of channels belonging to a game, tagged with their kind and
// whatever state their expected permissions depend on.
async collectGameChannels(game) {
    const channels = [];

    const add = (id, kind, label) => {
        if (id) channels.push({ id, kind, label });
    };

    add(game.results_channel_id, 'results', 'Results');
    add(game.memos_channel_id, 'memos', 'Player Memos');
    add(game.town_square_channel_id, 'town_square', 'Town Square');
    add(game.voting_booth_channel_id, 'voting_booth', 'Voting Booth');
    add(game.wolf_chat_channel_id, 'wolf_chat', 'Wolf Chat');
    add(game.signup_channel_id, 'dead_chat', 'Dead Chat');
    add(game.mod_chat_channel_id, 'mod_chat', 'Mod Chat');

    const customResult = await this.db.query(
        'SELECT channel_id, channel_name, open_at_dawn, open_at_dusk, is_couple_chat, invited_users FROM game_channels WHERE game_id = $1 AND channel_id IS NOT NULL AND is_created = true',
        [game.id]
    );

    for (const row of customResult.rows) {
        channels.push({
            id: row.channel_id,
            kind: row.is_couple_chat ? 'couple_chat' : 'custom',
            label: row.channel_name,
            openAtDawn: row.open_at_dawn,
            openAtDusk: row.open_at_dusk,
            invitedUsers: Array.isArray(row.invited_users) ? row.invited_users : [],
        });
    }

    return channels;
},

/**
 * Compares every game channel against the expected matrix.
 *
 * @returns {{ checked: number, drift: Array, advisories: Array, missing: Array }}
 */
async auditGamePermissions(guild, game, { fix = false } = {}) {
    const roleIds = {
        '@everyone': guild.roles.everyone.id,
        Alive: guild.roles.cache.find(r => r.name === 'Alive')?.id || null,
        Dead: guild.roles.cache.find(r => r.name === 'Dead')?.id || null,
        Spectator: guild.roles.cache.find(r => r.name === 'Spectator')?.id || null,
        Mod: guild.roles.cache.find(r => r.name === 'Mod')?.id || null,
    };

    const drift = [];
    const advisories = [];
    const missing = [];
    let checked = 0;

    const gameChannels = await this.collectGameChannels(game);
    const phase = game.day_phase === 'day' ? 'day' : 'night';

    for (const entry of gameChannels) {
        let channel = null;
        try {
            channel = await this.client.channels.fetch(entry.id);
        } catch (error) {
            channel = null;
        }
        if (!channel) {
            missing.push(`${entry.label} (\`${entry.id}\`) could not be fetched`);
            continue;
        }
        checked++;

        const expected = expectedForChannel(entry.kind, {
            phase,
            dayNumber: game.day_number,
            openAtDawn: entry.openAtDawn,
            openAtDusk: entry.openAtDusk,
        });

        for (const [roleName, permissions] of Object.entries(expected)) {
            const roleId = roleIds[roleName];
            if (!roleId) {
                missing.push(`Role **${roleName}** not found in server`);
                continue;
            }

            for (const [permissionName, rule] of Object.entries(permissions)) {
                const actual = this.readOverwrite(channel, roleId, permissionName);

                if (!rule.strict) {
                    advisories.push({
                        channel: channel.name,
                        role: roleName,
                        permission: permissionName,
                        actual,
                        reason: rule.reason,
                    });
                    continue;
                }

                if (actual === rule.value) continue;

                const finding = {
                    channel: channel.name,
                    channelId: channel.id,
                    role: roleName,
                    permission: permissionName,
                    expected: rule.value,
                    actual,
                    fixed: false,
                };

                if (fix) {
                    try {
                        await channel.permissionOverwrites.edit(roleId, { [permissionName]: rule.value });
                        finding.fixed = true;
                    } catch (error) {
                        finding.error = error?.message || String(error);
                    }
                }

                drift.push(finding);
            }
        }

        // Couple chat members need to see their channel and pin in it (feedback #31, #96).
        if (entry.kind === 'couple_chat') {
            for (const userId of entry.invitedUsers || []) {
                const view = this.readOverwrite(channel, userId, VIEW);
                const canPin = this.userCanPin(channel, userId);

                if (view === true && canPin) continue;

                const finding = {
                    channel: channel.name,
                    channelId: channel.id,
                    role: `<@${userId}>`,
                    permission: view !== true ? VIEW : 'PinMessages',
                    expected: true,
                    actual: view !== true ? view : false,
                    fixed: false,
                };

                if (fix) {
                    try {
                        await channel.permissionOverwrites.edit(userId, {
                            ViewChannel: true,
                            [PIN_PERMISSION]: true,
                        });
                        finding.fixed = true;
                    } catch (error) {
                        finding.error = error?.message || String(error);
                    }
                }

                drift.push(finding);
            }
        }
    }

    return { checked, drift, advisories, missing };
},

userCanPin(channel, userId) {
    const overwrite = channel.permissionOverwrites?.cache?.get(userId);
    if (!overwrite) return false;
    return Boolean(overwrite.allow?.has?.(PIN_PERMISSION));
},

async handlePermsAudit(message, args) {
    const serverId = message.guild.id;
    const shouldFix = args.length > 0 && args[0].toLowerCase() === 'fix';

    const gameResult = await this.db.query(
        "SELECT * FROM games WHERE server_id = $1 AND status IN ('signup', 'active') ORDER BY id DESC LIMIT 1",
        [serverId]
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found. `Wolf.perms_audit` checks the channels of the current game.');
    }

    const game = gameResult.rows[0];
    const progress = await message.reply(
        shouldFix ? '🔍 Auditing game channel permissions and repairing drift...' : '🔍 Auditing game channel permissions...'
    );

    let result;
    try {
        result = await this.auditGamePermissions(message.guild, game, { fix: shouldFix });
    } catch (error) {
        console.error('Error auditing game permissions:', error);
        return progress.edit('❌ An error occurred during the permission audit.');
    }

    const describe = (value) => {
        if (value === true) return 'allow';
        if (value === false) return 'deny';
        return 'inherit';
    };

    const embed = new EmbedBuilder()
        .setTitle(shouldFix ? '🔧 Permission Audit (fix mode)' : '🔍 Permission Audit')
        .setColor(result.drift.length > 0 ? 0xE67E22 : 0x00AE86)
        .setTimestamp();

    if (result.drift.length === 0) {
        embed.setDescription(`✅ Checked **${result.checked}** channels for game #${game.game_number}. No drift found.`);
    } else {
        const lines = result.drift.map((d) => {
            const status = d.error ? `❌ ${d.error}` : (d.fixed ? '✅ fixed' : '⚠️');
            return `${status} **#${d.channel}** - ${d.role} \`${d.permission}\`: expected ${describe(d.expected)}, found ${describe(d.actual)}`;
        });

        const fixedCount = result.drift.filter(d => d.fixed).length;
        const header = shouldFix
            ? `Checked **${result.checked}** channels for game #${game.game_number}. Repaired **${fixedCount}** of **${result.drift.length}** problems.`
            : `Checked **${result.checked}** channels for game #${game.game_number}. Found **${result.drift.length}** problems. Run \`${this.prefix}perms_audit fix\` to repair.`;

        embed.setDescription(`${header}\n\n${this.truncateAuditLines(lines)}`);
    }

    if (result.missing.length > 0) {
        embed.addFields({
            name: '⚠️ Could not check',
            value: this.truncateAuditLines(Array.from(new Set(result.missing)), 600),
            inline: false,
        });
    }

    // Surface the cells the bot cannot judge, so a mod can eyeball them rather than
    // being told everything is fine when dark mode or a lockdown is in effect.
    const notableAdvisories = result.advisories.filter(a => a.actual !== true);
    if (notableAdvisories.length > 0) {
        const lines = notableAdvisories.map(a =>
            `• **#${a.channel}** - ${a.role} \`${a.permission}\`: ${describe(a.actual)}`
        );
        embed.addFields({
            name: 'ℹ️ Not auditable (check by eye)',
            value: `${this.truncateAuditLines(lines, 800)}\n\n_These ${DARK_OR_LOCKDOWN}._`,
            inline: false,
        });
    }

    await progress.edit({ content: ' ', embeds: [embed] });
},

truncateAuditLines(lines, limit = 3000) {
    let out = '';
    let shown = 0;
    for (const line of lines) {
        if (out.length + line.length + 1 > limit) break;
        out += `${line}\n`;
        shown++;
    }
    if (shown < lines.length) {
        out += `…and ${lines.length - shown} more`;
    }
    return out.trim();
},

};
