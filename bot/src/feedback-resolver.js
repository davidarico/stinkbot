const { EmbedBuilder, Routes } = require('discord.js');

// Discord caps embed descriptions at 4096 characters
const MAX_DESCRIPTION_LENGTH = 4096;

// Discord API error code for "Cannot send messages to this user"
// (DMs closed, or the bot shares no server with them)
const CANNOT_DM_USER = 50007;

function buildResolutionEmbed(feedback, note) {
    const quoted = feedback.feedback_text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');

    let description = `**Your feedback:**\n${quoted}`;
    if (note) {
        description += `\n\n**Note from Stinky:**\n${note}`;
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
        throw new Error(
            `Message for feedback #${feedback.id} is ${description.length} characters; Discord allows ${MAX_DESCRIPTION_LENGTH}. Shorten the note.`
        );
    }

    const submittedUnix = Math.floor(new Date(feedback.created_at).getTime() / 1000);
    return new EmbedBuilder()
        .setTitle('✅ Your feedback has been resolved')
        .setDescription(description)
        .addFields({ name: 'Submitted', value: `<t:${submittedUnix}:D>`, inline: true })
        .setColor(0x00AE86)
        .setFooter({ text: `Feedback #${feedback.id} - thanks for helping improve StinkBot!` });
}

async function sendResolutionDm(rest, userId, embed) {
    const dmChannel = await rest.post(Routes.userChannels(), { body: { recipient_id: userId } });
    await rest.post(Routes.channelMessages(dmChannel.id), { body: { embeds: [embed.toJSON()] } });
}

/**
 * Resolves feedback rows: DMs each submitter, then deletes the row.
 * A row is only deleted after its DM succeeds (or when sendDm is false),
 * so a failed DM leaves it in place to retry.
 *
 * Returns one result per id: { id, status, ... } where status is
 * 'resolved' | 'would_resolve' | 'not_found' | 'dm_failed'.
 */
async function resolveFeedback({ db, rest, ids, note = '', dryRun = false, sendDm = true }) {
    const results = [];
    for (const id of ids) {
        const rowResult = await db.query(
            'SELECT id, user_id, display_name, feedback_text, server_id, created_at FROM feedback WHERE id = $1',
            [id]
        );
        if (!rowResult.rows.length) {
            results.push({ id, status: 'not_found' });
            continue;
        }
        const feedback = rowResult.rows[0];
        const embed = buildResolutionEmbed(feedback, note);
        const summary = { id, userId: feedback.user_id, displayName: feedback.display_name, feedbackText: feedback.feedback_text };

        if (dryRun) {
            results.push({ ...summary, status: 'would_resolve', dm: sendDm ? embed.toJSON() : null });
            continue;
        }

        if (sendDm) {
            try {
                await sendResolutionDm(rest, feedback.user_id, embed);
            } catch (error) {
                const reason = error.code === CANNOT_DM_USER
                    ? 'user has DMs closed or shares no server with this bot'
                    : error.message;
                results.push({ ...summary, status: 'dm_failed', error: reason });
                continue;
            }
        }

        await db.query('DELETE FROM feedback WHERE id = $1', [id]);
        results.push({ ...summary, status: 'resolved', dmSent: sendDm });
    }
    return results;
}

module.exports = { buildResolutionEmbed, resolveFeedback, CANNOT_DM_USER };
