import { SLEEP_PROVIDERS, SleepProvider } from '../../../shared/sleep';

export const SLEEP_SYNC_DISABLED_PROVIDERS: readonly SleepProvider[] = [
    SLEEP_PROVIDERS.GarminAPI,
    SLEEP_PROVIDERS.COROSAPI,
];

export function getDisabledSleepProviders(): readonly SleepProvider[] {
    return SLEEP_SYNC_DISABLED_PROVIDERS;
}

export function isSleepProviderEnabled(provider: SleepProvider): boolean {
    return !SLEEP_SYNC_DISABLED_PROVIDERS.includes(provider);
}
