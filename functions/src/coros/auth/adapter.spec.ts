
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COROSAuthAdapter } from './adapter';
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as api from './api';

vi.mock('../../request-helper');
vi.mock('./api');
vi.mock('./auth', () => ({ COROSAPIAuth: vi.fn() }));
vi.mock('firebase-admin', () => ({
    firestore: () => ({
        collectionGroup: () => ({
            where: () => ({
                where: () => ({})
            })
        })
    })
}));

describe('COROSAuthAdapter', () => {
    let adapter: COROSAuthAdapter;

    beforeEach(() => {
        vi.resetAllMocks();
        adapter = new COROSAuthAdapter();
    });

    it('should have correct configuration', () => {
        expect(adapter.serviceName).toBe(ServiceNames.COROSAPI);
        expect(adapter.oAuthScopes).toBe('workout');
    });

    describe('processNewToken', () => {
        it('should prioritize token.openId', async () => {
            const token: any = { token: { openId: 'oid-1' } };
            const result = await adapter.processNewToken(token, 'u1');
            expect(result.uniqueId).toBe('oid-1');
            expect(api.getCOROSUserId).not.toHaveBeenCalled();
        });

        it('should fallback to API if token.openId is missing', async () => {
            const token: any = { token: { access_token: 'abc' } };
            vi.mocked(api.getCOROSUserId).mockResolvedValue('oid-api');

            const result = await adapter.processNewToken(token, 'u1');
            expect(result.uniqueId).toBe('oid-api');
            expect(api.getCOROSUserId).toHaveBeenCalledWith('abc');
        });

        it('should throw if API fallback fails', async () => {
            const token: any = { token: { access_token: 'abc' } };
            vi.mocked(api.getCOROSUserId).mockRejectedValue(new Error('api fail'));

            await expect(adapter.processNewToken(token, 'u1'))
                .rejects.toThrow('Failed to fetch COROS User ID for user u1');
        });
    });

    describe('convertTokenResponse', () => {
        it('should map openId to uniqueId', async () => {
            const token: any = {
                token: {
                    access_token: 'at',
                    refresh_token: 'rt',
                    expires_in: 3600,
                    openId: 'oid-123'
                }
            };
            const result = adapter.convertTokenResponse(token, 'oid-123');
            expect(result.openId).toBe('oid-123');
        });
    });

    describe('deauthorize', () => {
        it('should call API', async () => {
            const token: any = { accessToken: 'at' };
            await adapter.deauthorize(token);
            expect(api.deauthorizeCOROSUser).toHaveBeenCalledWith('at');
        });
    });

    describe('getAuthorizationData', () => {
        it('should return simple options', async () => {
            const result = await adapter.getAuthorizationData('http://cb', 'state1');
            expect(result.options.redirect_uri).toBe('http://cb');
            expect(result.context).toBeUndefined();
        });
    });

    describe('getTokenRequestConfig', () => {
        it('should return simple config', () => {
            const config = adapter.getTokenRequestConfig('http://cb', 'code1');
            expect(config.code).toBe('code1');
            expect(config.redirect_uri).toBe('http://cb');
        });
    });
});
