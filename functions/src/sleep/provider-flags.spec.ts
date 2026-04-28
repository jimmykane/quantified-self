import { afterEach, describe, expect, it } from 'vitest';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import {
    getDisabledSleepProviders,
    isSleepProviderEnabled,
    SLEEP_SYNC_DISABLED_PROVIDERS_ENV,
} from './provider-flags';

const originalDisabledProviders = process.env[SLEEP_SYNC_DISABLED_PROVIDERS_ENV];

describe('sleep provider flags', () => {
    afterEach(() => {
        if (originalDisabledProviders === undefined) {
            delete process.env[SLEEP_SYNC_DISABLED_PROVIDERS_ENV];
        } else {
            process.env[SLEEP_SYNC_DISABLED_PROVIDERS_ENV] = originalDisabledProviders;
        }
    });

    it('keeps all sleep providers enabled by default', () => {
        delete process.env[SLEEP_SYNC_DISABLED_PROVIDERS_ENV];

        expect(getDisabledSleepProviders()).toEqual([]);
        expect(isSleepProviderEnabled(SLEEP_PROVIDERS.GarminAPI)).toBe(true);
        expect(isSleepProviderEnabled(SLEEP_PROVIDERS.COROSAPI)).toBe(true);
        expect(isSleepProviderEnabled(SLEEP_PROVIDERS.SuuntoApp)).toBe(true);
    });

    it('supports canonical provider names and common aliases', () => {
        process.env[SLEEP_SYNC_DISABLED_PROVIDERS_ENV] = 'GarminAPI, coros';

        expect(getDisabledSleepProviders().sort()).toEqual([
            SLEEP_PROVIDERS.COROSAPI,
            SLEEP_PROVIDERS.GarminAPI,
        ].sort());
        expect(isSleepProviderEnabled(SLEEP_PROVIDERS.GarminAPI)).toBe(false);
        expect(isSleepProviderEnabled(SLEEP_PROVIDERS.COROSAPI)).toBe(false);
        expect(isSleepProviderEnabled(SLEEP_PROVIDERS.SuuntoApp)).toBe(true);
    });

    it('can disable every sleep provider', () => {
        process.env[SLEEP_SYNC_DISABLED_PROVIDERS_ENV] = 'all';

        expect(isSleepProviderEnabled(SLEEP_PROVIDERS.GarminAPI)).toBe(false);
        expect(isSleepProviderEnabled(SLEEP_PROVIDERS.COROSAPI)).toBe(false);
        expect(isSleepProviderEnabled(SLEEP_PROVIDERS.SuuntoApp)).toBe(false);
    });
});

