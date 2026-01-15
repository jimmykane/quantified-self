
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GarminAuthAdapter } from './adapter';
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as api from './api';
import * as crypto from 'crypto';

vi.mock('../../request-helper');
vi.mock('./api');
vi.mock('./auth', () => ({ GarminAPIAuth: vi.fn() }));
vi.mock('firebase-admin', () => ({
    firestore: () => ({
        collectionGroup: () => ({
            where: () => ({
                where: () => ({})
            })
        })
    })
}));

describe('GarminAuthAdapter', () => {
    let adapter: GarminAuthAdapter;

    beforeEach(() => {
        vi.resetAllMocks();
        adapter = new GarminAuthAdapter();
    });

    it('should have correct configuration', () => {
        expect(adapter.serviceName).toBe(ServiceNames.GarminAPI);
        expect(adapter.oAuthScopes).toContain('PARTNER_WRITE');
    });

    describe('processNewToken', () => {
        it('should fetch user ID and permissions', async () => {
            const token: any = { token: { access_token: 'abc', user: 'orig' } };
            vi.mocked(api.getGarminUserId).mockResolvedValue('garmin-id');
            vi.mocked(api.getGarminPermissions).mockResolvedValue(['READ']);

            const result = await adapter.processNewToken(token, 'u1');
            expect(result.uniqueId).toBe('garmin-id');
            expect(result.permissions).toEqual(['READ']);
        });

        it('should throw if getGarminUserId fails', async () => {
            const token: any = { token: { access_token: 'abc' } };
            vi.mocked(api.getGarminUserId).mockRejectedValue(new Error('fail'));

            await expect(adapter.processNewToken(token, 'u1'))
                .rejects.toThrow('Failed to fetch Garmin User ID for user u1');
        });
    });

    describe('convertTokenResponse', () => {
        it('should include permissions if provided in extraData', () => {
            const token: any = {
                token: {
                    access_token: 'at',
                    refresh_token: 'rt',
                    expires_in: 3600,
                    user: 'u1'
                }
            };
            const extraData = { permissions: ['READ', 'WRITE'] };
            const result: any = adapter.convertTokenResponse(token, 'u1', extraData);
            expect(result.permissions).toEqual(['READ', 'WRITE']);
            expect(result.permissionsLastChangedAt).toBeDefined();
        });

        it('should return token without permissions if extraData is missing', () => {
            const token: any = {
                token: {
                    access_token: 'at',
                    refresh_token: 'rt',
                    expires_in: 3600,
                    user: 'u1'
                }
            };
            const result: any = adapter.convertTokenResponse(token, 'u1');
            expect(result.permissions).toBeUndefined();
        });
    });

    describe('deauthorize', () => {
        it('should call API', async () => {
            const token: any = { accessToken: 'at' };
            await adapter.deauthorize(token);
            expect(api.deauthorizeGarminUser).toHaveBeenCalledWith('at');
        });
    });

    describe('getAuthorizationData', () => {
        it('should generate PKCE verifier and challenge', async () => {
            const result = await adapter.getAuthorizationData('http://cb', 'state123');
            expect(result.context.codeVerifier).toBeDefined();
            expect(result.options.code_challenge).toBeDefined();
            expect(result.options.code_challenge_method).toBe('S256');
            expect(result.options.state).toBe('state123');
            expect(result.options.codeVerifier).toBeUndefined();
        });
    });

    describe('getTokenRequestConfig', () => {
        it('should include code_verifier from context', () => {
            const context = { codeVerifier: 'ver123' };
            const config = adapter.getTokenRequestConfig('http://cb', 'code1', context);
            expect(config.code_verifier).toBe('ver123');
            expect(config.code).toBe('code1');
        });

        it('should throw if context is missing codeVerifier', () => {
            expect(() => adapter.getTokenRequestConfig('http://cb', 'code1', {}))
                .toThrow('Garmin auth requires codeVerifier in context');
            expect(() => adapter.getTokenRequestConfig('http://cb', 'code1', undefined))
                .toThrow('Garmin auth requires codeVerifier in context');
        });
    });
});
