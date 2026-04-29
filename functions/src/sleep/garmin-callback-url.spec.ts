import { describe, expect, it } from 'vitest';

import {
    assertTrustedGarminCallbackURL,
    InvalidGarminCallbackUrlError,
    normalizeTrustedGarminCallbackURL,
} from './garmin-callback-url';

describe('Garmin callback URL validation', () => {
    it('allows Garmin Health API HTTPS callback URLs', () => {
        const callbackURL = 'https://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1760000000&token=token-1';

        expect(normalizeTrustedGarminCallbackURL(callbackURL)).toBe(callbackURL);
        expect(assertTrustedGarminCallbackURL(callbackURL)).toBe(callbackURL);
    });

    it.each([
        ['missing', undefined],
        ['invalid URL', 'not-a-url'],
        ['non-HTTPS URL', 'http://apis.garmin.com/wellness-api/rest/sleeps?token=token-1'],
        ['non-Garmin host', 'https://attacker.example/wellness-api/rest/sleeps?token=token-1'],
        ['Garmin-looking attacker host', 'https://apis.garmin.com.attacker.example/wellness-api/rest/sleeps?token=token-1'],
        ['custom port', 'https://apis.garmin.com:444/wellness-api/rest/sleeps?token=token-1'],
        ['userinfo URL', 'https://user:pass@apis.garmin.com/wellness-api/rest/sleeps?token=token-1'],
        ['non-Health API path', 'https://apis.garmin.com/tools/login'],
    ])('rejects %s', (_caseName, callbackURL) => {
        expect(normalizeTrustedGarminCallbackURL(callbackURL as string | undefined)).toBeNull();
        expect(() => assertTrustedGarminCallbackURL(callbackURL as string | undefined))
            .toThrow(InvalidGarminCallbackUrlError);
    });
});
