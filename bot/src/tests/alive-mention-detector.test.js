'use strict';

jest.mock('../sqlite-manager', () => jest.fn().mockImplementation(() => ({})));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));

const AliveMentionDetector = require('../alive-mention-detector');

function createWarnMessage(journal) {
    return {
        url: 'https://discord.com/channels/guild-123/ts-1/msg-1',
        author: { id: 'user-123' },
        guild: {
            id: 'guild-123',
            channels: { fetch: jest.fn().mockResolvedValue(journal) },
        },
        reply: jest.fn().mockResolvedValue({}),
    };
}

describe('AliveMentionDetector warnings', () => {
    it('sends the warning to the player journal instead of town square', async () => {
        const journal = { send: jest.fn().mockResolvedValue({}) };
        const pool = { query: jest.fn().mockResolvedValue({ rows: [{ channel_id: 'journal-1' }] }) };
        const detector = new AliveMentionDetector({}, pool);
        const msg = createWarnMessage(journal);

        await detector.sendWarning(msg, 2);

        expect(msg.guild.channels.fetch).toHaveBeenCalledWith('journal-1');
        expect(journal.send).toHaveBeenCalledWith(expect.objectContaining({
            content: `<@user-123> ${msg.url}`,
        }));
        expect(msg.reply).not.toHaveBeenCalled();
    });

    it('falls back to replying in channel when the player has no journal', async () => {
        const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        const detector = new AliveMentionDetector({}, pool);
        const msg = createWarnMessage(null);

        await detector.sendWarning(msg, 2);

        expect(msg.reply).toHaveBeenCalled();
    });

    it('falls back to replying in channel when the journal send fails', async () => {
        const journal = { send: jest.fn().mockRejectedValue(new Error('Missing Access')) };
        const pool = { query: jest.fn().mockResolvedValue({ rows: [{ channel_id: 'journal-1' }] }) };
        const detector = new AliveMentionDetector({}, pool);
        const msg = createWarnMessage(journal);
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await detector.sendWarning(msg, 2);

        expect(msg.reply).toHaveBeenCalled();
    });
});
