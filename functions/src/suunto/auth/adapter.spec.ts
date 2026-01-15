
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SuuntoAuthAdapter } from './adapter';
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as api from './api';

vi.mock('../../request-helper');
vi.mock('./api');
vi.mock('./auth', () => ({ SuuntoAPIAuth: vi.fn() }));
vi.mock('firebase-admin', () => ({
    firestore: () => ({
        collectionGroup: () => ({
            where: () => ({
                where: () => ({})
            })
        })
    })
}));

describe('SuuntoAuthAdapter', () => {
    let adapter: SuuntoAuthAdapter;

    beforeEach(() => {
        vi.resetAllMocks();
        adapter = new SuuntoAuthAdapter();
    });

    it('should have correct configuration', () => {
        expect(adapter.serviceName).toBe(ServiceNames.SuuntoApp);
        expect(adapter.oAuthScopes).toBe('workout'); 
    });

    describe('processNewToken', () => {
        it('should return uniqueId from token', async () => {
            const token: any = { token: { user: 'user-123' } };
            const result = await adapter.processNewToken(token, 'u1');
            expect(result.uniqueId).toBe('user-123');
        });
    });

    describe('convertTokenResponse', () => {
        it('should use default values for missing fields', () => {
            const token: any = {
                token: {
                    access_token: 'at',
                    refresh_token: 'rt',
                    expires_in: 3600,
                    user: 'u123'
                    // missing token_type and scope
                }
            };

            const result = adapter.convertTokenResponse(token);
            expect(result.tokenType).toBe('bearer');
            expect(result.scope).toBe('workout');
        });
        
         it('should use provided values if present', () => {
            const token: any = {
                token: {
                    access_token: 'at',
                    refresh_token: 'rt',
                    expires_in: 3600,
                    user: 'u123',
                    token_type: 'custom',
                    scope: 'scope'
                }
            };

            const result = adapter.convertTokenResponse(token);
            expect(result.tokenType).toBe('custom');
            expect(result.scope).toBe('scope');
        });
    });

    describe('deauthorize', () => {
        it('should call API', async () => {
            const token: any = { accessToken: 'at' };
            await adapter.deauthorize(token);
            expect(api.deauthorizeSuuntoUser).toHaveBeenCalledWith('at');
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
