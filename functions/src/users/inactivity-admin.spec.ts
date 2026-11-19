import { describe, expect, it } from 'vitest';
import { inactivityAdminRequest } from './inactivity-admin';
describe('inactivity admin request boundary', () => {
    it.each(['queued', 'warned', 'cancelled', 'pending-deletion'])('accepts the bounded %s view', view => {
        expect(inactivityAdminRequest({ view, afterUid: 'synthetic-user' })).toEqual({ view, afterUid: 'synthetic-user' });
    });
    const dryRunId = '0ebed501-25fd-4f1f-9489-1be66e167689';
    it('accepts a first page or a cursor pinned to the dry run being reviewed', () => {
        for (const request of [{ view: 'eligible' }, { view: 'eligible', afterUid: 'owner', dryRunId },
            { view: 'eligible', projection: 'login-order' }, { view: 'eligible', accountUids: ['owner'], dryRunId }])
            expect(inactivityAdminRequest(request)).toEqual(request);
    });
    it.each([{ view: 'eligible', afterUid: 'owner' }, { view: 'eligible', dryRunId: '../reports/private' },
        { view: 'queued', dryRunId }, null, [], {}, { view: 'all' }, { view: 'queued', afterUid: '' }, { view: 'queued', afterUid: '../users' },
        { view: 'queued', afterUid: '.' }, { view: 'queued', afterUid: 1 }, { view: 'queued', afterUid: 'a'.repeat(129) },
        { view: 'eligible', accountUids: ['x'] }, { view: 'warned', accountUids: ['x', 'x'] },
        { view: 'queued', accountUids: ['user/foreign'] }, { view: 'queued', accountUids: 'uid' },
        { view: 'warned', accountUids: Array.from({ length: 26 }, (_, i) => String(i)) },
        { view: 'warned', accountUids: [], afterUid: 'x' }, { view: 'queued', projection: 'all' },
        { view: 'queued', projection: 'login-order', accountUids: ['x'] }, { view: 'queued', limit: 10000 }, { view: 'queued', mode: 'enforce' }])('rejects malformed or widened requests %j', input => {
        expect(() => inactivityAdminRequest(input)).toThrow();
    });
});
