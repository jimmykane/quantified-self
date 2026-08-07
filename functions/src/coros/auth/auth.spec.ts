import { afterEach, describe, it, expect, vi } from 'vitest';

const mockAuthorizationCode = vi.fn();
vi.mock('simple-oauth2', () => ({
    AuthorizationCode: class {
        constructor(config: any) {
            mockAuthorizationCode(config);
        }
    }
}));

import { COROSAPIAuth } from './auth';

describe('COROS Auth Configuration', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('does not read client credentials while the module is loading', async () => {
        delete process.env.COROSAPI_CLIENT_ID;
        delete process.env.COROSAPI_CLIENT_SECRET;
        vi.resetModules();

        await expect(import('./auth')).resolves.toHaveProperty('COROSAPIAuth');
    });

    it('should be configured to use body for authorization method', () => {
        COROSAPIAuth();

        expect(mockAuthorizationCode).toHaveBeenCalled();
        const config = mockAuthorizationCode.mock.calls[0][0];

        expect(config.options).toBeDefined();
        expect(config.options.authorizationMethod).toBe('body');
    });
});
