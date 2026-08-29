import { describe, expect, it } from 'vitest';

import {
    assertTrustedGarminCallbackURL,
    InvalidGarminCallbackUrlError,
    normalizeTrustedGarminCallbackURL,
    parseTrustedGarminCallbackURL,
} from './garmin-callback-url';

describe('Garmin callback URL validation', () => {
    it('allows Garmin Health API HTTPS callback URLs', () => {
        const callbackURL = 'https://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1760000000&uploadEndTimeInSeconds=1760003600&token=token-1';

        expect(normalizeTrustedGarminCallbackURL(callbackURL)).toBe(callbackURL);
        expect(assertTrustedGarminCallbackURL(callbackURL, 'sleeps')).toBe(callbackURL);
        expect(parseTrustedGarminCallbackURL(callbackURL, 'sleeps')).toEqual({
            callbackURL,
            summaryType: 'sleeps',
            uploadStartTimeMs: 1_760_000_000_000,
            uploadEndTimeMs: 1_760_003_600_000,
        });
    });

    it('accepts an exact Phase 1 or Phase 2 family path', () => {
        const callbackURL = 'https://apis.garmin.com/wellness-api/rest/stressDetails?uploadStartTimeInSeconds=1760000000&uploadEndTimeInSeconds=1760086400&token=token-1';

        expect(normalizeTrustedGarminCallbackURL(callbackURL, 'stressDetails')).toBe(callbackURL);
        expect(normalizeTrustedGarminCallbackURL(callbackURL, 'dailies')).toBeNull();
    });

    it.each([
        ['pulseox', 'pulseOx'],
        ['allDayRespiration', 'respiration'],
    ] as const)('normalizes the %s payload family from its %s REST path', (
        summaryType,
        endpointPath,
    ) => {
        const callbackURL = `https://apis.garmin.com/wellness-api/rest/${endpointPath}?uploadStartTimeInSeconds=1760000000&uploadEndTimeInSeconds=1760086400&token=token-1`;

        expect(parseTrustedGarminCallbackURL(callbackURL, summaryType)).toEqual({
            callbackURL,
            summaryType,
            uploadStartTimeMs: 1_760_000_000_000,
            uploadEndTimeMs: 1_760_086_400_000,
        });
    });

    it.each([
        ['missing', undefined],
        ['invalid URL', 'not-a-url'],
        ['non-HTTPS URL', 'http://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1&uploadEndTimeInSeconds=2&token=token-1'],
        ['non-Garmin host', 'https://attacker.example/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1&uploadEndTimeInSeconds=2&token=token-1'],
        ['Garmin-looking attacker host', 'https://apis.garmin.com.attacker.example/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1&uploadEndTimeInSeconds=2&token=token-1'],
        ['custom port', 'https://apis.garmin.com:444/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1&uploadEndTimeInSeconds=2&token=token-1'],
        ['userinfo URL', 'https://user:pass@apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1&uploadEndTimeInSeconds=2&token=token-1'],
        ['non-Health API path', 'https://apis.garmin.com/tools/login'],
        ['unknown family', 'https://apis.garmin.com/wellness-api/rest/workouts?uploadStartTimeInSeconds=1&uploadEndTimeInSeconds=2&token=token-1'],
        ['missing upload end', 'https://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1&token=token-1'],
        ['missing pull token', 'https://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1&uploadEndTimeInSeconds=2'],
        ['duplicate upload start', 'https://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1&uploadStartTimeInSeconds=1&uploadEndTimeInSeconds=2&token=token-1'],
        ['window over 24 hours', 'https://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1&uploadEndTimeInSeconds=86402&token=token-1'],
        ['fragment', 'https://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1&uploadEndTimeInSeconds=2&token=token-1#fragment'],
    ])('rejects %s', (_caseName, callbackURL) => {
        expect(normalizeTrustedGarminCallbackURL(callbackURL as string | undefined)).toBeNull();
        expect(() => assertTrustedGarminCallbackURL(callbackURL as string | undefined))
            .toThrow(InvalidGarminCallbackUrlError);
    });
});
