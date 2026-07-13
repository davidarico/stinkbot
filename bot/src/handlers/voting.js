'use strict';

const { EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');

// https://discord.com/developers/docs/topics/permissions
const PIN_PERMISSION = 0x0008000000000000;

module.exports = {

async createVotingMessage(gameId, votingChannel) {
    try {
        // Get the current game to check day number and votes to hang
        const gameResult = await this.db.query('SELECT day_number, votes_to_hang FROM games WHERE id = $1', [gameId]);
        const dayNumber = gameResult.rows[0]?.day_number || 1;
        const votesToHang = gameResult.rows[0]?.votes_to_hang || 4;
        
        // Unpin any existing pinned messages in the voting channel
        try {
            const pinnedMessages = await votingChannel.messages.fetchPinned();
            for (const [messageId, pinnedMessage] of pinnedMessages) {
                if (pinnedMessage.author.bot && 
                    pinnedMessage.embeds.length > 0 && 
                    pinnedMessage.embeds[0].title && 
                    pinnedMessage.embeds[0].title.includes('Voting')) {
                    await pinnedMessage.unpin();
                    console.log(`[DEBUG] Unpinned old voting message ${messageId}`);
                }
            }
        } catch (error) {
            console.error('Error unpinning old voting messages:', error);
            // Continue even if unpinning fails
        }
        
        const embed = new EmbedBuilder()
            .setTitle(`🗳️ Day ${dayNumber} Voting`)
            .setDescription(`Use \`Wolf.vote @user\` to vote for someone.\nUse \`Wolf.retract\` to retract your vote.\n\n**Votes needed to hang: ${votesToHang}**`)
            .addFields({ name: 'Current Votes', value: 'No votes yet.' })
            .setColor(0xE74C3C);

        const votingMessage = await votingChannel.send({ embeds: [embed] });
        
        // Pin the new voting message
        try {
            await votingMessage.pin();
            console.log(`[DEBUG] Pinned new voting message ${votingMessage.id}`);
        } catch (error) {
            console.error('Error pinning voting message:', error);
            // Continue even if pinning fails
        }
        
        // Store the voting message ID in the database
        const updateResult = await this.db.query(
            'UPDATE games SET voting_message_id = $1 WHERE id = $2',
            [votingMessage.id, gameId]
        );
        
        console.log(`[DEBUG] Created voting message ${votingMessage.id} for game ${gameId}, database update affected ${updateResult.rowCount} rows`);
        
    } catch (error) {
        console.error('Error creating voting message:', error);
        throw error;
    }
},

async handleCreateVote(message) {
    const serverId = message.guild.id;

    // Get active game
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'active']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }

    const game = gameResult.rows[0];

    // Check if it's day phase and day 2+ (when voting is allowed)
    if (game.day_phase === 'night') {
        return message.reply('❌ Voting messages can only be created during the day phase.');
    }

    try {
        const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
        
        // Create the new voting message (this will overwrite the stored ID)
        await this.createVotingMessage(game.id, votingChannel);
        
        // Get the updated game data with the new voting message ID
        const updatedGameResult = await this.db.query(
            'SELECT * FROM games WHERE server_id = $1 AND status = $2',
            [serverId, 'active']
        );
        const updatedGame = updatedGameResult.rows[0];
        
        // Immediately update the voting message with current votes
        await this.updateVotingMessage(updatedGame);
        
        await message.reply('✅ Voting message created successfully!');
        
    } catch (error) {
        console.error('Error creating voting message:', error);
        await message.reply('❌ An error occurred while creating the voting message.');
    }
},

async handleGetVotes(message) {
    const serverId = message.guild.id;

    // Get active game
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'active']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }

    const game = gameResult.rows[0];

    // Check if it's day phase
    if (game.day_phase === 'night') {
        return message.reply('❌ Voting is not active during the night phase.');
    }

    if (game.day_number < 2) {
        return message.reply('❌ Voting is not allowed on Day 1.');
    }

    try {
        // Get current votes
        const votesResult = await this.db.query(
            `SELECT v.target_user_id, p.username as target_username, 
                    COUNT(*) as vote_count,
                    STRING_AGG(p2.username, ', ') as voters
             FROM votes v
             JOIN players p ON v.target_user_id = p.user_id AND p.game_id = v.game_id
             JOIN players p2 ON v.voter_user_id = p2.user_id AND p2.game_id = v.game_id
             WHERE v.game_id = $1 AND v.day_number = $2
             GROUP BY v.target_user_id, p.username
             ORDER BY vote_count DESC, p.username`,
            [game.id, game.day_number]
        );

        // Get voting message status
        let votingMessageStatus = '❌ No voting message found';
        if (game.voting_message_id) {
            try {
                const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
                const votingMessage = await votingChannel.messages.fetch(game.voting_message_id);
                if (votingMessage) {
                    votingMessageStatus = `✅ Active voting message: [${game.voting_message_id}]`;
                }
            } catch (error) {
                votingMessageStatus = `⚠️ Stored voting message not found: ${game.voting_message_id}`;
            }
        }

        let voteText = 'No votes cast yet.';
        if (votesResult.rows.length > 0) {
            voteText = votesResult.rows.map(row => {
                const voters = row.voters.split(', ').map(voter => `- ${voter}`).join('\n');
                return `**${row.target_username}** (${row.vote_count})\n${voters}`;
            }).join('\n\n');
        }

        const embed = new EmbedBuilder()
            .setTitle(`🗳️ Day ${game.day_number} Vote Status`)
            .setDescription(`**Game Phase:** ${game.day_phase === 'day' ? '🌞 Day' : '🌙 Night'} ${game.day_number}\n**Votes needed to hang:** ${game.votes_to_hang}\n**Voting Message:** ${votingMessageStatus}`)
            .addFields({ name: 'Current Votes', value: voteText })
            .setColor(0x3498DB)
            .setTimestamp();

        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Error getting vote status:', error);
        await message.reply('❌ An error occurred while retrieving vote status.');
    }
},

async handleVoteCount(message) {
    const serverId = message.guild.id;
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'active']
    );
    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }
    const game = gameResult.rows[0];
    if (game.day_phase === 'night') {
        return message.reply('❌ Voting is not active during the night phase.');
    }
    if (game.day_number < 2) {
        return message.reply('❌ Voting counts are not shown on Day 1.');
    }
    try {
        const votesResult = await this.db.query(
            `SELECT p.username as target_username, COUNT(*)::int as vote_count
             FROM votes v
             JOIN players p ON v.target_user_id = p.user_id AND p.game_id = v.game_id
             WHERE v.game_id = $1 AND v.day_number = $2
             GROUP BY v.target_user_id, p.username
             ORDER BY vote_count DESC, p.username`,
            [game.id, game.day_number]
        );
        let lines = 'No votes cast yet.';
        if (votesResult.rows.length > 0) {
            lines = votesResult.rows
                .map((row) => `**${row.target_username}**: ${row.vote_count}`)
                .join('\n');
        }
        const embed = new EmbedBuilder()
            .setTitle(`🗳️ Vote totals — Day ${game.day_number}`)
            .setDescription(`Hang threshold: **${game.votes_to_hang}** votes\n\n${lines}`)
            .setFooter({ text: 'Who voted for whom is hidden here on purpose — ask a mod if you need the full breakdown.' })
            .setColor(0x3498DB)
            .setTimestamp();
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in handleVoteCount:', error);
        await message.reply('❌ Could not load vote counts.');
    }
},

async handleRatio(message) {
    const serverId = message.guild.id;
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'active']
    );
    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }
    const game = gameResult.rows[0];
    try {
        const rows = await this.db.query(
            `SELECT LOWER(COALESCE(NULLIF(TRIM(r.team), ''), 'unknown')) AS team,
                    COUNT(*)::bigint AS cnt
             FROM game_role gr
             JOIN roles r ON gr.role_id = r.id
             WHERE gr.game_id = $1
             GROUP BY LOWER(COALESCE(NULLIF(TRIM(r.team), ''), 'unknown'))`,
            [game.id]
        );
        let town = 0;
        let wolf = 0;
        let neutral = 0;
        for (const row of rows.rows) {
            if (row.team === 'wolf') wolf = Number(row.cnt);
            else if (row.team === 'neutral') neutral = Number(row.cnt);
            else if (row.team === 'town') town = Number(row.cnt);
        }
        const total = town + wolf + neutral;
        await message.reply(
            `📊 **Role list ratio** (game ${game.game_number}): **${town}-${wolf}-${neutral}** (Town-Wolf-Neutral) — ${total} seats in setup.`
        );
    } catch (error) {
        console.error('Error in handleRatio:', error);
        await message.reply('❌ Could not compute ratio (is the game role list saved on the site?).');
    }
},

async handleWolvesAlive(message) {
    const serverId = message.guild.id;
    const deadRole = message.guild.roles.cache.find((r) => r.name === 'Dead');
    const isDead = deadRole && message.member?.roles?.cache?.has(deadRole.id);
    if (!this.hasModeratorPermissions(message.member) && !isDead) {
        return message.reply('❌ Only moderators or **Dead** players can use this command.');
    }
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'active']
    );
    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }
    const game = gameResult.rows[0];
    const aliveRole = message.guild.roles.cache.find((r) => r.name === 'Alive');
    if (!aliveRole) {
        return message.reply('❌ Alive role not found.');
    }
    try {
        await message.guild.members.fetch().catch(() => null);
        const wolves = await this.db.query(
            `SELECT p.user_id, p.username FROM players p
             WHERE p.game_id = $1 AND p.is_wolf = TRUE`,
            [game.id]
        );
        let aliveWolves = 0;
        const names = [];
        for (const row of wolves.rows) {
            const mem = message.guild.members.cache.get(row.user_id);
            if (mem && mem.roles.cache.has(aliveRole.id)) {
                aliveWolves++;
                names.push(row.username);
            }
        }
        const isMod = this.hasModeratorPermissions(message.member);
        const detail = isMod && names.length ? `\n_${names.join(', ')}_` : '';
        await message.reply(`🐺 **Wolves still alive:** ${aliveWolves}${detail}`.trim());
    } catch (error) {
        console.error('Error in handleWolvesAlive:', error);
        await message.reply('❌ Could not count wolves.');
    }
},

async handleAddIn(message, args) {
    const targetMember = message.mentions?.members?.first?.() || null;
    if (!targetMember) {
        return message.reply(`❌ Usage: \`${this.prefix}add_in @player\``);
    }
    const serverId = message.guild.id;
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'signup']
    );
    if (!gameResult.rows.length) {
        return message.reply('❌ No game in signup phase.');
    }
    const game = gameResult.rows[0];
    if (game.signups_closed) {
        return message.reply('❌ Signups are closed — cannot add players.');
    }
    const bannedUser = await this.db.query('SELECT * FROM banned_users WHERE user_id = $1', [targetMember.id]);
    if (bannedUser.rows.length > 0) {
        return message.reply('❌ That user is banned from signing up.');
    }
    const existingPlayer = await this.db.query(
        'SELECT * FROM players WHERE game_id = $1 AND user_id = $2',
        [game.id, targetMember.id]
    );
    if (existingPlayer.rows.length > 0) {
        return message.reply('❌ That user is already signed up.');
    }
    const displayName = targetMember.displayName || targetMember.user.username;
    await this.db.query(
        'INSERT INTO players (game_id, user_id, username) VALUES ($1, $2, $3)',
        [game.id, targetMember.id, displayName]
    );
    await this.ensureUserHasJournal(message, targetMember.user);
    await this.assignRole(targetMember, 'Signed Up');
    await this.removeRole(targetMember, 'Spectator');
    await this.updateSignupMessage(game);
    await message.reply(`✅ Added **${displayName}** to the signup list.`);
},

async handleNotVoted(message) {
    const serverId = message.guild.id;
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'active']
    );
    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }
    const game = gameResult.rows[0];
    if (game.day_phase === 'night') {
        return message.reply('❌ Use this during the day phase.');
    }
    if (game.day_number < 2) {
        return message.reply('❌ Not applicable on Day 1.');
    }
    const aliveRole = message.guild.roles.cache.find((r) => r.name === 'Alive');
    if (!aliveRole) {
        return message.reply('❌ Alive role not found.');
    }
    try {
        await message.guild.members.fetch().catch(() => null);
        const players = await this.db.query(
            'SELECT user_id, username FROM players WHERE game_id = $1',
            [game.id]
        );
        const voted = await this.db.query(
            'SELECT DISTINCT voter_user_id FROM votes WHERE game_id = $1 AND day_number = $2',
            [game.id, game.day_number]
        );
        const votedSet = new Set(voted.rows.map((r) => r.voter_user_id));
        const notVoted = [];
        for (const p of players.rows) {
            const mem = message.guild.members.cache.get(p.user_id);
            if (!mem || !mem.roles.cache.has(aliveRole.id)) continue;
            if (!votedSet.has(p.user_id)) {
                notVoted.push(p.username);
            }
        }
        notVoted.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        const body = notVoted.length ? notVoted.map((n, i) => `${i + 1}. ${n}`).join('\n') : 'Everyone alive has cast a vote today (or no alive players).';
        const embed = new EmbedBuilder()
            .setTitle(`🤐 Alive with no vote — Day ${game.day_number}`)
            .setDescription(body)
            .setColor(0xe67e22)
            .setTimestamp();
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in handleNotVoted:', error);
        await message.reply('❌ Could not build the list.');
    }
},

// Append a vote/retract event to vote_history. Never throws: history is a
// best-effort audit trail and must not block the vote itself.
async logVoteAction(gameId, dayNumber, voterUserId, targetUserId, action) {
    try {
        await this.db.query(
            'INSERT INTO vote_history (game_id, day_number, voter_user_id, target_user_id, action) VALUES ($1, $2, $3, $4, $5)',
            [gameId, dayNumber, voterUserId, targetUserId, action]
        );
    } catch (error) {
        console.error('Error logging vote action to vote_history:', error);
    }
},

async handleLssv(message, args) {
    const serverId = message.guild.id;
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'active']
    );
    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }
    const game = gameResult.rows[0];

    // Optional day argument, defaults to the current day
    let day = game.day_number;
    if (args.length) {
        day = parseInt(args[0], 10);
        if (Number.isNaN(day) || day < 1 || day > game.day_number) {
            return message.reply(`❌ Day must be a number between 1 and ${game.day_number}.`);
        }
    }

    try {
        // Standing votes with the time each was cast, earliest first.
        // Current day: the live votes table is exactly the standing set.
        // Past days: reconstruct from vote_history (votes are wiped at phase change) —
        // each voter's last action for that day stands, unless it was a retract.
        let standing;
        if (day === game.day_number) {
            const votesResult = await this.db.query(
                'SELECT voter_user_id, target_user_id, voted_at AS cast_at FROM votes WHERE game_id = $1 AND day_number = $2 ORDER BY voted_at ASC, id ASC',
                [game.id, day]
            );
            standing = votesResult.rows;
        } else {
            const historyResult = await this.db.query(
                `SELECT DISTINCT ON (voter_user_id) voter_user_id, target_user_id, action, created_at AS cast_at
                 FROM vote_history
                 WHERE game_id = $1 AND day_number = $2
                 ORDER BY voter_user_id, created_at DESC, id DESC`,
                [game.id, day]
            );
            standing = historyResult.rows
                .filter((row) => row.action === 'vote')
                .sort((a, b) => new Date(a.cast_at) - new Date(b.cast_at));
        }

        if (!standing.length) {
            const note = day === game.day_number
                ? 'No votes have been cast yet today.'
                : `No final votes recorded for Day ${day}. Note: vote history only exists for votes cast after the history feature was added.`;
            return message.reply(`📭 ${note}`);
        }

        // Map user ids to usernames
        const playersResult = await this.db.query(
            'SELECT user_id, username FROM players WHERE game_id = $1',
            [game.id]
        );
        const names = new Map(playersResult.rows.map((p) => [p.user_id, p.username]));
        const nameOf = (userId) => names.get(userId) || `<@${userId}>`;

        // Final votes in the order they were cast
        const castOrder = standing
            .map((v, i) => {
                const unix = Math.floor(new Date(v.cast_at).getTime() / 1000);
                return `${i + 1}. **${nameOf(v.voter_user_id)}** → **${nameOf(v.target_user_id)}** — <t:${unix}:t> (<t:${unix}:R>)`;
            })
            .join('\n');

        // LSSV: for each target with 2+ standing votes, when their second vote landed.
        // Earliest second vote = longest standing second vote.
        const votesByTarget = new Map();
        for (const v of standing) {
            if (!votesByTarget.has(v.target_user_id)) {
                votesByTarget.set(v.target_user_id, []);
            }
            votesByTarget.get(v.target_user_id).push(v);
        }
        const secondVotes = [];
        for (const [targetId, votes] of votesByTarget) {
            if (votes.length >= 2) {
                secondVotes.push({ targetId, voteCount: votes.length, secondAt: votes[1].cast_at });
            }
        }
        secondVotes.sort((a, b) => new Date(a.secondAt) - new Date(b.secondAt));

        const lssvLines = secondVotes.length
            ? secondVotes
                .map((s, i) => {
                    const unix = Math.floor(new Date(s.secondAt).getTime() / 1000);
                    const marker = i === 0 ? ' 🏆' : '';
                    return `${i + 1}. **${nameOf(s.targetId)}** (${s.voteCount} votes) — second vote at <t:${unix}:t> (<t:${unix}:R>)${marker}`;
                })
                .join('\n')
            : 'No player has two or more standing votes.';

        const embed = new EmbedBuilder()
            .setTitle(`🗳️ LSSV — Day ${day}`)
            .setDescription('Longest standing second vote. Standing votes only — retracted and changed votes count from when the current vote was cast.')
            .addFields(
                { name: 'Final votes in cast order', value: castOrder, inline: false },
                { name: 'Second votes (earliest first)', value: lssvLines, inline: false }
            )
            .setColor(0x9B59B6)
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in handleLssv:', error);
        await message.reply('❌ Could not build the LSSV report.');
    }
},

async sendPlayerListToDeadChat(gameId, deadChatChannel) {
    const playersResult = await this.db.query(
        `SELECT p.username,
                LOWER(COALESCE(NULLIF(TRIM(r.team), ''), CASE WHEN p.is_wolf THEN 'wolf' ELSE 'town' END)) AS team
         FROM players p
         LEFT JOIN roles r ON p.role_id = r.id
         WHERE p.game_id = $1
         ORDER BY p.username`,
        [gameId]
    );

    if (playersResult.rows.length === 0) {
        return;
    }

    const counts = { town: 0, wolf: 0, neutral: 0 };
    for (const row of playersResult.rows) {
        const t = row.team || 'town';
        if (t === 'wolf') counts.wolf++;
        else if (t === 'neutral') counts.neutral++;
        else counts.town++;
    }

    const titleParts = [];
    if (counts.town > 0) titleParts.push(`TOWN (${counts.town})`);
    if (counts.wolf > 0) titleParts.push(`WOLF (${counts.wolf})`);
    if (counts.neutral > 0) titleParts.push(`NEUTRAL (${counts.neutral})`);
    const factionTitle = titleParts.length ? titleParts.join(' · ') : 'Faction counts pending';

    const playerList = playersResult.rows.map((player) => `• ${player.username}`).join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`👥 Player List — ${factionTitle}`)
        .setDescription(`Here are all the players in this game:\n\n${playerList}`)
        .setColor(0x9B59B6);

    const listMessage = await deadChatChannel.send({ embeds: [embed] });
    try {
        await listMessage.pin('Player list at game start');
    } catch (pinErr) {
        console.warn('[sendPlayerListToDeadChat] Could not pin player list:', pinErr?.message || pinErr);
    }
},

async sendRoleNotificationsToJournals(gameId, serverId) {
    let sent = 0;
    let failed = 0;
    let wolvesAddedToChat = 0;
    let wolvesFailedToAdd = 0;
    const wolfChatAddFailures = [];

    try {
        // Get game information including theme flags
        const gameResult = await this.db.query(
            'SELECT is_skinned, is_themed, wolf_chat_channel_id, mod_chat_channel_id FROM games WHERE id = $1',
            [gameId]
        );

        if (!gameResult.rows.length) {
            console.error('Game not found:', gameId);
            return { sent, failed, wolvesAddedToChat, wolvesFailedToAdd };
        }

        const game = gameResult.rows[0];

        // Resolve the game's guild and wolf chat channel once up front so a single
        // transient fetch failure can't silently skip individual wolves below.
        let guild = null;
        try {
            guild = await this.client.guilds.fetch(serverId);
        } catch (error) {
            console.error(`Error fetching guild ${serverId} for wolf chat adds:`, error);
        }

        let wolfChannel = null;
        if (game.wolf_chat_channel_id) {
            try {
                wolfChannel = await this.client.channels.fetch(game.wolf_chat_channel_id);
            } catch (error) {
                console.error('Error fetching wolf chat channel:', error);
            }
        }

        // Get all players in the game with their role information
        const playersResult = await this.db.query(
            `SELECT p.user_id, p.username, p.role_id, p.is_wolf, 
                    r.name as role_name, r.in_wolf_chat, r.team,
                    COALESCE(NULLIF(TRIM(p.thematic_custom_name), ''), (
                      SELECT gr.custom_name FROM game_role gr
                      WHERE gr.game_id = p.game_id AND gr.role_id = p.role_id
                      ORDER BY gr.sort_index NULLS LAST
                      LIMIT 1
                    )) as custom_name,
                    p.charges_left, p.win_by_number
             FROM players p
             LEFT JOIN roles r ON p.role_id = r.id
             WHERE p.game_id = $1`,
            [gameId]
        );

        // Collect wolf team information for wolf chat message
        const wolfTeam = [];
        const wolfRolesNotInChat = [];

        console.log(`[DEBUG] Processing ${playersResult.rows.length} players for role notifications`);

        for (const player of playersResult.rows) {
            try {
                // Skip players without assigned roles
                if (!player.role_id) {
                    failed++;
                    console.log(`Skipping ${player.username} - no role assigned`);
                    continue;
                }

                console.log(`[DEBUG] Processing ${player.username}: role=${player.role_name}, is_wolf=${player.is_wolf}, in_wolf_chat=${player.in_wolf_chat}`);

                // Determine what role name to display based on theme flags
                let displayRoleName = player.role_name;
                let fullRoleDescription = player.role_name;

                if (game.is_themed && player.custom_name) {
                    // Themed mode: show custom name with actual role in parens
                    displayRoleName = `${player.custom_name} (${player.role_name})`;
                    fullRoleDescription = `${player.custom_name} (${player.role_name})`;
                } else if (game.is_skinned && player.custom_name) {
                    // Skinned mode: only show custom name
                    displayRoleName = player.custom_name;
                    fullRoleDescription = player.custom_name;
                } else {
                    // Normal mode: show actual role name
                    displayRoleName = player.role_name;
                    fullRoleDescription = player.role_name;
                }

                // Check if this is a wolf role that should be added to wolf chat
                if (player.is_wolf && player.in_wolf_chat) {
                    console.log(`[DEBUG] Adding ${player.username} to wolf chat as ${displayRoleName}`);
                    
                    // Add to wolf team list for wolf chat message
                    wolfTeam.push({
                        username: player.username,
                        roleName: displayRoleName,
                        fullRoleDescription: fullRoleDescription,
                        charges: player.charges_left,
                        winByNumber: player.win_by_number
                    });

                    // Add player to wolf chat channel. Each add is individually
                    // try/caught so one failure never skips the remaining wolves.
                    if (!game.wolf_chat_channel_id) {
                        wolvesFailedToAdd++;
                        wolfChatAddFailures.push({ username: player.username, userId: player.user_id, reason: 'wolf chat channel not configured' });
                        console.error(`Error adding ${player.username} to wolf chat: wolf_chat_channel_id not set`);
                    } else if (!wolfChannel) {
                        wolvesFailedToAdd++;
                        wolfChatAddFailures.push({ username: player.username, userId: player.user_id, reason: 'wolf chat channel not found' });
                        console.error(`Error adding ${player.username} to wolf chat: wolf channel not found`);
                    } else if (!guild) {
                        wolvesFailedToAdd++;
                        wolfChatAddFailures.push({ username: player.username, userId: player.user_id, reason: 'guild not found' });
                        console.error(`Error adding ${player.username} to wolf chat: guild not found`);
                    } else {
                        try {
                            // Fetch the member from the game's guild (not the cache) so
                            // cache misses or multi-guild bots don't break the add.
                            const member = await guild.members.fetch(player.user_id);
                            if (member) {
                                await wolfChannel.permissionOverwrites.edit(member.id, {
                                    ViewChannel: true,
                                    [PIN_PERMISSION]: true
                                });
                                wolvesAddedToChat++;
                                console.log(`[DEBUG] Successfully added ${player.username} to wolf chat`);
                            } else {
                                wolvesFailedToAdd++;
                                wolfChatAddFailures.push({ username: player.username, userId: player.user_id, reason: 'member not found in server' });
                                console.error(`Error adding ${player.username} to wolf chat: member not found`);
                            }
                        } catch (error) {
                            wolvesFailedToAdd++;
                            wolfChatAddFailures.push({ username: player.username, userId: player.user_id, reason: error?.message || 'unknown error' });
                            console.error(`Error adding ${player.username} to wolf chat:`, error);
                        }
                    }

                    // Skip sending role notification to journal since they're in wolf chat
                    console.log(`Skipping role notification for ${player.username} - added to wolf chat`);
                    continue;
                }

                // Check if this is a wolf role that's NOT in wolf chat
                if (player.is_wolf && !player.in_wolf_chat) {
                    console.log(`[DEBUG] Found wolf role not in chat: ${player.username} as ${displayRoleName}`);
                    wolfRolesNotInChat.push({
                        roleName: displayRoleName,
                        fullRoleDescription: fullRoleDescription,
                        charges: player.charges_left,
                        winByNumber: player.win_by_number
                    });
                }

                // Check if player has a journal
                const journalResult = await this.db.query(
                    'SELECT channel_id FROM player_journals WHERE server_id = $1 AND user_id = $2',
                    [serverId, player.user_id]
                );

                if (journalResult.rows.length === 0) {
                    failed++;
                    console.log(`Skipping ${player.username} - no journal found`);
                    continue;
                }

                const channelId = journalResult.rows[0].channel_id;

                // Verify the journal channel still exists
                const journalChannel = await this.client.channels.fetch(channelId);
                if (!journalChannel) {
                    // Journal channel was deleted, clean up database
                    await this.db.query(
                        'DELETE FROM player_journals WHERE server_id = $1 AND user_id = $2',
                        [serverId, player.user_id]
                    );
                    failed++;
                    console.log(`Skipping ${player.username} - journal channel deleted`);
                    continue;
                }

                // Create role notification embed
                const roleEmbed = new EmbedBuilder()
                    .setTitle('🎭 Your Role Assignment')
                    .setDescription(`**${displayRoleName}**!`)
                    .setColor(0x9B59B6)
                    .setTimestamp()
                    .setFooter({ text: 'Good luck and have fun!' });

                // Add charges information if the player has charges
                if (player.charges_left !== null && player.charges_left !== undefined && player.charges_left > 0) {
                    roleEmbed.addFields({
                        name: '⚡ Charges',
                        value: `You have **${player.charges_left} charges**.`,
                        inline: true
                    });
                }

                // Add win by number information if the player has a win condition
                if (player.win_by_number !== null && player.win_by_number !== undefined && player.win_by_number > 0) {
                    roleEmbed.addFields({
                        name: '🎯 Win Condition',
                        value: `You need to achieve **${player.win_by_number}** to win.`,
                        inline: true
                    });
                }

                // Send the role notification to the journal
                await journalChannel.send({
                    content: `<@${player.user_id}>`,
                    embeds: [roleEmbed]
                });

                sent++;
                console.log(`Sent role notification to ${player.username}: ${displayRoleName}`);

            } catch (error) {
                console.error(`Error sending role notification to ${player.username}:`, error);
                failed++;
            }
        }

        console.log(`[DEBUG] Wolf team: ${wolfTeam.length} players, Wolf roles not in chat: ${wolfRolesNotInChat.length} roles`);

        // Send wolf team information to wolf chat if there are wolves
        if (wolfTeam.length > 0 && game.wolf_chat_channel_id) {
            try {
                if (wolfChannel) {
                    // Create wolf team list message
                    const wolfTeamList = wolfTeam.map(wolf => {
                        let wolfInfo = `• **${wolf.roleName}** - ${wolf.username}`;
                        
                        // Add charges if available
                        if (wolf.charges !== null && wolf.charges !== undefined && wolf.charges > 0) {
                            wolfInfo += ` (⚡ ${wolf.charges} charges)`;
                        }
                        
                        // Add win condition if available
                        if (wolf.winByNumber !== null && wolf.winByNumber !== undefined && wolf.winByNumber > 0) {
                            wolfInfo += ` (🎯 win by ${wolf.winByNumber})`;
                        }
                        
                        return wolfInfo;
                    }).join('\n');

                    const wolfEmbed = new EmbedBuilder()
                        .setTitle('🐺 Wolf Team')
                        .setDescription(`Hope you wanted to be a wolf! Here are your fellow wolves:\n\n${wolfTeamList}`)
                        .setColor(0xE74C3C)
                        .setTimestamp();

                    const wolfTeamMessage = await wolfChannel.send({ embeds: [wolfEmbed] });
                    try {
                        await wolfTeamMessage.pin('Pin wolf team role info for easy reference');
                    } catch (error) {
                        // Pinning requires Manage Messages; don't fail the whole notification flow if it's missing.
                        console.warn('[DEBUG] Failed to pin wolf team message in wolf chat:', error?.message || error);
                    }

                    // If there are wolf roles not in chat, alert the team
                    if (wolfRolesNotInChat.length > 0) {
                        const notInChatList = wolfRolesNotInChat.map(role => {
                            let roleInfo = `• **${role.roleName}**`;
                            
                            // Add charges if available
                            if (role.charges !== null && role.charges !== undefined && role.charges > 0) {
                                roleInfo += ` (⚡ ${role.charges} charges)`;
                            }
                            
                            // Add win condition if available
                            if (role.winByNumber !== null && role.winByNumber !== undefined && role.winByNumber > 0) {
                                roleInfo += ` (🎯 win by ${role.winByNumber})`;
                            }
                            
                            return roleInfo;
                        }).join('\n');

                        const alertEmbed = new EmbedBuilder()
                            .setTitle('⚠️ Major Wolf Alert!')
                            .setDescription(`You appear to have some helpers working in the shadows:\n\n${notInChatList}`)
                            .setColor(0xF39C12)
                            .setTimestamp();

                        await wolfChannel.send({ embeds: [alertEmbed] });
                    }
                }
            } catch (error) {
                console.error('Error sending wolf team message to wolf chat:', error);
            }
        }

        // Notify mods about any players that could not be added to wolf chat so
        // they can add them manually.
        if (wolfChatAddFailures.length > 0 && game.mod_chat_channel_id) {
            try {
                const modChannel = await this.client.channels.fetch(game.mod_chat_channel_id);
                if (modChannel) {
                    const failureList = wolfChatAddFailures
                        .map(f => `• **${f.username}** (<@${f.userId}>) — ${f.reason}`)
                        .join('\n');

                    const modAlertEmbed = new EmbedBuilder()
                        .setTitle('⚠️ Wolf Chat Add Failures')
                        .setDescription(`The following players could **not** be added to wolf chat and need to be added manually:\n\n${failureList}`)
                        .setColor(0xE74C3C)
                        .setTimestamp();

                    await modChannel.send({ embeds: [modAlertEmbed] });
                }
            } catch (error) {
                console.error('Error notifying mod chat about wolf chat add failures:', error);
            }
        }

    } catch (error) {
        console.error('Error in sendRoleNotificationsToJournals:', error);
    }

    return { sent, failed, wolvesAddedToChat, wolvesFailedToAdd };
},

async handleVote(message, args) {
    const serverId = message.guild.id;
    const voterId = message.author.id;

    // Get active game
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'active']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }

    const game = gameResult.rows[0];

    // Check if it's day phase
    if (game.day_phase === 'night') {
        return message.reply('❌ Voting is not allowed during the night phase.');
    }

    // Check if in voting booth.
    if (message.channel.id !== game.voting_booth_channel_id) {
        const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
        return message.reply(`❌ Please vote in ${votingChannel} instead.`);
    }

    // Check if voter is in the game and has Alive role
    const voterCheck = await this.db.query(
        'SELECT * FROM players WHERE game_id = $1 AND user_id = $2',
        [game.id, voterId]
    );

    if (!voterCheck.rows.length) {
        return message.reply('❌ You are not in this game.');
    }

    // Check if voter has Alive role
    const voterMember = message.member;
    const aliveRole = message.guild.roles.cache.find(r => r.name === 'Alive');
    if (!aliveRole || !voterMember.roles.cache.has(aliveRole.id)) {
        return message.reply('❌ You are not an alive player in this game.');
    }

    // Parse target
    const target = message.mentions.users.first();
    if (!target) {
        return message.reply('❌ Please mention a user to vote for.');
    }

    // Check if user is trying to vote for themselves
    if (target.id === voterId && process.env.NODE_ENV !== 'development') {
        return message.reply('❌ You cannot vote for yourself.');
    }

    // Check if target is in the game and has Alive role
    const targetCheck = await this.db.query(
        'SELECT * FROM players WHERE game_id = $1 AND user_id = $2',
        [game.id, target.id]
    );

    if (!targetCheck.rows.length) {
        return message.reply('❌ That player is not in this game.');
    }

    // Check if target has Alive role
    const targetMember = await message.guild.members.fetch(target.id).catch(() => null);
    if (!targetMember) {
        return message.reply('❌ Could not find that user in this server.');
    }

    if (!aliveRole || !targetMember.roles.cache.has(aliveRole.id)) {
        return message.reply('❌ That player is not an alive player in this game.');
    }

    // Remove existing vote if any
    await this.db.query(
        'DELETE FROM votes WHERE game_id = $1 AND voter_user_id = $2 AND day_number = $3',
        [game.id, voterId, game.day_number]
    );

    // Add new vote
    await this.db.query(
        'INSERT INTO votes (game_id, voter_user_id, target_user_id, day_number) VALUES ($1, $2, $3, $4)',
        [game.id, voterId, target.id, game.day_number]
    );

    // Durable log: `votes` is wiped at phase change, vote_history is not
    await this.logVoteAction(game.id, game.day_number, voterId, target.id, 'vote');

    // React with checkmark for success
    await message.react('✅');
    
    // Update voting message
    await this.updateVotingMessage(game);
},

async handleRetract(message) {
    const serverId = message.guild.id;
    const voterId = message.author.id;

    // Get active game
    const gameResult = await this.db.query(
        'SELECT * FROM games WHERE server_id = $1 AND status = $2',
        [serverId, 'active']
    );

    if (!gameResult.rows.length) {
        return message.reply('❌ No active game found.');
    }

    const game = gameResult.rows[0];

    // Check if in voting booth
    if (message.channel.id !== game.voting_booth_channel_id) {
        const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
        return message.reply(`❌ Please retract your vote in ${votingChannel} instead.`);
    }

    // Remove vote
    const deleteResult = await this.db.query(
        'DELETE FROM votes WHERE game_id = $1 AND voter_user_id = $2 AND day_number = $3',
        [game.id, voterId, game.day_number]
    );

    if (deleteResult.rowCount === 0) {
        return message.reply('❌ You have no vote to retract.');
    }

    await this.logVoteAction(game.id, game.day_number, voterId, null, 'retract');

    // React with checkmark for success
    await message.react('✅');
    
    // Update voting message
    await this.updateVotingMessage(game);
},

async updateVotingMessage(game) {
    try {
        // If we don't have a voting message ID, try to find it the old way as fallback
        if (!game.voting_message_id) {
            const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
            let votingMessage = null;
            let lastMessageId = null;
            let searchAttempts = 0;
            const maxSearchAttempts = 50; // Prevent infinite loops (5000 messages max)
            
            // Keep searching through message history until we find a voting message
            while (!votingMessage && searchAttempts < maxSearchAttempts) {
                const fetchOptions = { limit: 100 };
                if (lastMessageId) {
                    fetchOptions.before = lastMessageId;
                }
                
                const messages = await votingChannel.messages.fetch(fetchOptions);
                if (messages.size === 0) {
                    // No more messages to search
                    break;
                }
                
                // Look for a bot message with embeds that contains voting title
                votingMessage = messages.find(msg => 
                    msg.author.bot && 
                    msg.embeds.length > 0 && 
                    msg.embeds[0].title && 
                    msg.embeds[0].title.includes('Voting')
                );
                
                if (!votingMessage) {
                    // Get the ID of the oldest message in this batch for next iteration
                    lastMessageId = messages.last().id;
                    searchAttempts++;
                }
            }
            
            if (!votingMessage) {
                console.log(`No voting message found in channel history after searching ${searchAttempts * 100} messages`);
                return;
            }
            
            // Store the found message ID for future use
            await this.db.query(
                'UPDATE games SET voting_message_id = $1 WHERE id = $2',
                [votingMessage.id, game.id]
            );
            game.voting_message_id = votingMessage.id;
        }

        const votingChannel = await this.client.channels.fetch(game.voting_booth_channel_id);
        const votingMessage = await votingChannel.messages.fetch(game.voting_message_id);

        if (!votingMessage) {
            console.error('Voting message not found with ID:', game.voting_message_id);
            return;
        }

        // Get current votes
        const votesResult = await this.db.query(
            `SELECT v.target_user_id, p.username as target_username, 
                    COUNT(*) as vote_count,
                    ARRAY_AGG(p2.username) as voters
             FROM votes v
             JOIN players p ON v.target_user_id = p.user_id AND p.game_id = v.game_id
             JOIN players p2 ON v.voter_user_id = p2.user_id AND p2.game_id = v.game_id
             WHERE v.game_id = $1 AND v.day_number = $2
             GROUP BY v.target_user_id, p.username
             ORDER BY vote_count DESC, p.username`,
            [game.id, game.day_number]
        );

        let voteText = 'No votes yet.';
        if (votesResult.rows.length > 0) {
            voteText = votesResult.rows.map(row => {
                const voters = row.voters.map(voter => `- ${voter}`).join('\n');
                return `**${row.target_username}** (${row.vote_count})\n${voters}`;
            }).join('\n\n');
        }

        const embed = new EmbedBuilder()
            .setTitle(`🗳️ Day ${game.day_number} Voting`)
            .setDescription(`Use \`Wolf.vote @user\` to vote for someone.\nUse \`Wolf.retract\` to retract your vote.\n\n**Votes needed to hang: ${game.votes_to_hang}**`)
            .addFields({ name: 'Current Votes', value: voteText })
            .setColor(0xE74C3C);

        await votingMessage.edit({ embeds: [embed] });
    } catch (error) {
        console.error('Error updating voting message:', error);
        // If the stored message ID is invalid, clear it from the database
        if (error.code === 10008) { // Unknown Message error
            await this.db.query(
                'UPDATE games SET voting_message_id = NULL WHERE id = $1',
                [game.id]
            );
        }
    }
},

};
