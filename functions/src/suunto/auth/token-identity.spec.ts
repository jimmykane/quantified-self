import { describe, expect, it } from 'vitest';
import {
    resolveSuuntoProviderUserIdFromTokenResponse,
    SuuntoTokenIdentityError,
} from './token-identity';

function accessTokenWithUser(user: unknown): string {
    return [
        Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify({ user })).toString('base64url'),
        'provider-signature',
    ].join('.');
}

describe('Suunto token identity', () => {
    it('reads the documented user claim when the token response omits raw user', () => {
        expect(resolveSuuntoProviderUserIdFromTokenResponse({
            access_token: accessTokenWithUser('provider-1'),
        })).toBe('provider-1');
    });

    it('preserves a matching legacy raw user response', () => {
        expect(resolveSuuntoProviderUserIdFromTokenResponse({
            access_token: 'opaque-test-token',
            user: 'provider-1',
        }, 'provider-1')).toBe('provider-1');
    });

    it('rejects raw and claim disagreement without exposing either identity', () => {
        expect(() => resolveSuuntoProviderUserIdFromTokenResponse({
            access_token: accessTokenWithUser('provider-1'),
            user: 'different-provider',
        })).toThrow(SuuntoTokenIdentityError);
    });

    it('rejects a refresh identity that differs from the canonical account', () => {
        expect(() => resolveSuuntoProviderUserIdFromTokenResponse({
            access_token: accessTokenWithUser('different-provider'),
        }, 'provider-1')).toThrow(SuuntoTokenIdentityError);
    });

    it.each([
        {},
        { access_token: 'not-a-jwt' },
        { access_token: 'header.invalid-json.signature' },
        { access_token: accessTokenWithUser(' provider-1 ') },
    ])('rejects missing or malformed provider identity evidence', (tokenResponse) => {
        expect(() => resolveSuuntoProviderUserIdFromTokenResponse(tokenResponse))
            .toThrow(SuuntoTokenIdentityError);
    });
});
