import { describe, expect, it } from 'vitest';
import { inactivityAdminRequest } from './inactivity-admin';
describe('inactivity admin request boundary', () => {
    it.each(['queued', 'warned', 'cancelled', 'pending-deletion'])('accepts the bounded %s view', view => {
        expect(inactivityAdminRequest({ view, afterUid: 'synthetic-user' })).toEqual({ view, afterUid: 'synthetic-user' });
    });
    it.each([null, [], {}, { view: 'all' }, { view: 'queued', afterUid: '' }, { view: 'queued', afterUid: '../users' },
        { view: 'queued', afterUid: '.' }, { view: 'queued', afterUid: 1 }, { view: 'queued', afterUid: 'a'.repeat(129) },
        { view: 'queued', limit: 10000 }, { view: 'queued', mode: 'enforce' }])('rejects malformed or widened requests %j', input => {
        expect(() => inactivityAdminRequest(input)).toThrow();
    });
});
