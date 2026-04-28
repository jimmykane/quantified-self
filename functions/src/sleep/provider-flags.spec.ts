import { describe, expect, it } from 'vitest';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import {
    getDisabledSleepProviders,
    isSleepProviderEnabled,
    SLEEP_SYNC_DISABLED_PROVIDERS,
} from './provider-flags';

describe('sleep provider flags', () => {
    it('disables Garmin and COROS sleep sync by source-controlled constant', () => {
        expect(SLEEP_SYNC_DISABLED_PROVIDERS).toEqual([
            SLEEP_PROVIDERS.GarminAPI,
            SLEEP_PROVIDERS.COROSAPI,
        ]);
        expect(getDisabledSleepProviders()).toBe(SLEEP_SYNC_DISABLED_PROVIDERS);
    });

    it('keeps Suunto sleep sync enabled', () => {
        expect(isSleepProviderEnabled(SLEEP_PROVIDERS.SuuntoApp)).toBe(true);
    });

    it('blocks disabled provider work', () => {
        expect(isSleepProviderEnabled(SLEEP_PROVIDERS.GarminAPI)).toBe(false);
        expect(isSleepProviderEnabled(SLEEP_PROVIDERS.COROSAPI)).toBe(false);
    });
});
