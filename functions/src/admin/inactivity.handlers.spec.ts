import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (_options: unknown, handler: unknown) => handler,
    HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));
vi.mock('../utils', () => ({ ALLOWED_CORS_ORIGINS: ['https://example.invalid'], enforceAppCheck: (request: { app?: unknown }) => {
    if (!request.app) throw new Error('App Check required');
} }));
vi.mock('../users/inactivity-admin', async importOriginal => ({
    ...await importOriginal<typeof import('../users/inactivity-admin')>(), readInactivityAdmin: read,
}));
import { getInactivityAdmin } from './handlers/inactivity.handlers';
const call = getInactivityAdmin as unknown as (request: Partial<CallableRequest>) => Promise<unknown>;
const request = () => ({ app: { appId: 'synthetic' }, auth: { uid: 'admin', token: { admin: true } }, data: { view: 'queued' } });
describe('inactivity admin authorization', () => {
    beforeEach(() => { read.mockReset().mockResolvedValue({ accounts: [] }); });
    it.each(['anonymous', 'member', 'impersonation', 'app-check'])('rejects %s access before reading data', async kind => {
        const input = request();
        if (kind === 'anonymous') input.auth = undefined;
        if (kind === 'member') input.auth.token.admin = false;
        if (kind === 'impersonation') Object.assign(input.auth.token, { impersonatedBy: 'other' });
        if (kind === 'app-check') input.app = undefined;
        await expect(call(input as unknown as CallableRequest)).rejects.toThrow();
        expect(read).not.toHaveBeenCalled();
    });
    it('returns only the read projection for an authenticated administrator', async () => {
        expect(await call(request() as unknown as CallableRequest)).toEqual({ accounts: [] });
        expect(read).toHaveBeenCalledWith(expect.anything(), expect.anything(), { view: 'queued' });
    });
    it('does not expose provider exceptions', async () => {
        read.mockRejectedValue(new Error('private-provider-canary'));
        await expect(call(request() as unknown as CallableRequest)).rejects.toThrow('Unable to load account retention');
    });
});
