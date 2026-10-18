'use strict';

const { buildResolutionEmbed, resolveFeedback, CANNOT_DM_USER } = require('../feedback-resolver');

describe('Feedback resolver', () => {
    const feedbackRow = {
        id: 42,
        user_id: 'user-1',
        display_name: 'Alice',
        feedback_text: 'add wolf speed to wolf help',
        server_id: 'server-1',
        created_at: '2026-10-15T20:13:11Z',
    };

    const createDb = (rows = [feedbackRow]) => ({
        query: jest.fn(async (sql, params) => {
            if (sql.startsWith('SELECT')) {
                return { rows: rows.filter((r) => r.id === params[0]) };
            }
            return { rows: [] };
        }),
    });

    const createRest = () => ({
        post: jest.fn(async (route) => (route === '/users/@me/channels' ? { id: 'dm-channel-1' } : {})),
    });

    const deleteCalls = (db) => db.query.mock.calls.filter(([sql]) => sql.startsWith('DELETE'));

    describe('buildResolutionEmbed', () => {
        it('quotes the original feedback and includes the note', () => {
            const embed = buildResolutionEmbed(
                { ...feedbackRow, feedback_text: 'line one\nline two' },
                'Shipped today!'
            ).toJSON();
            expect(embed.title).toContain('resolved');
            expect(embed.description).toContain('> line one\n> line two');
            expect(embed.description).toContain('Shipped today!');
            expect(embed.footer.text).toContain('#42');
        });

        it('omits the note section when there is no note', () => {
            const embed = buildResolutionEmbed(feedbackRow, '').toJSON();
            expect(embed.description).not.toContain('Note from');
        });

        it('rejects messages over the Discord description limit', () => {
            expect(() => buildResolutionEmbed(feedbackRow, 'x'.repeat(4096))).toThrow('Shorten the note');
        });
    });

    describe('resolveFeedback', () => {
        it('DMs the submitter and then deletes the row', async () => {
            const db = createDb();
            const rest = createRest();
            const results = await resolveFeedback({ db, rest, ids: [42], note: 'Done' });

            expect(rest.post).toHaveBeenCalledWith('/users/@me/channels', { body: { recipient_id: 'user-1' } });
            expect(rest.post).toHaveBeenCalledWith('/channels/dm-channel-1/messages', {
                body: { embeds: [expect.objectContaining({ title: expect.stringContaining('resolved') })] },
            });
            expect(deleteCalls(db)).toEqual([['DELETE FROM feedback WHERE id = $1', [42]]]);
            expect(results).toEqual([expect.objectContaining({ id: 42, status: 'resolved', dmSent: true })]);
        });

        it('keeps the row when the DM fails', async () => {
            const db = createDb();
            const rest = createRest();
            rest.post.mockRejectedValueOnce(Object.assign(new Error('Cannot send messages to this user'), { code: CANNOT_DM_USER }));

            const results = await resolveFeedback({ db, rest, ids: [42] });

            expect(deleteCalls(db)).toHaveLength(0);
            expect(results[0].status).toBe('dm_failed');
            expect(results[0].error).toContain('DMs closed');
        });

        it('deletes without messaging when sendDm is false', async () => {
            const db = createDb();
            const rest = createRest();
            const results = await resolveFeedback({ db, rest, ids: [42], sendDm: false });

            expect(rest.post).not.toHaveBeenCalled();
            expect(deleteCalls(db)).toHaveLength(1);
            expect(results[0]).toEqual(expect.objectContaining({ status: 'resolved', dmSent: false }));
        });

        it('changes nothing on a dry run', async () => {
            const db = createDb();
            const rest = createRest();
            const results = await resolveFeedback({ db, rest, ids: [42], note: 'Done', dryRun: true });

            expect(rest.post).not.toHaveBeenCalled();
            expect(deleteCalls(db)).toHaveLength(0);
            expect(results[0].status).toBe('would_resolve');
            expect(results[0].dm.description).toContain('Done');
        });

        it('reports missing ids and still processes the rest', async () => {
            const db = createDb();
            const rest = createRest();
            const results = await resolveFeedback({ db, rest, ids: [999, 42] });

            expect(results.map((r) => r.status)).toEqual(['not_found', 'resolved']);
        });
    });
});
