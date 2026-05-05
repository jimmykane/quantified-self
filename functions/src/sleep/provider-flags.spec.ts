import { describe, expect, it } from 'vitest';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import {
    getAllowedSleepSyncUserIds,
    getDisabledSleepProviders,
    isSleepProviderEnabled,
    isSleepSyncUserAllowed,
    SLEEP_SYNC_ALLOWED_USER_IDS,
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

    it('enables sleep sync for all users when the source-controlled allowlist is empty', () => {
        expect(SLEEP_SYNC_ALLOWED_USER_IDS).toEqual([]);
        expect(getAllowedSleepSyncUserIds()).toBe(SLEEP_SYNC_ALLOWED_USER_IDS);
        expect(isSleepSyncUserAllowed('xcsAolLDDTWTgtRN9eYF3lW2YKL2')).toBe(true);
        expect(isSleepSyncUserAllowed('other-user')).toBe(true);
        expect(isSleepSyncUserAllowed(null)).toBe(true);
    });
});
