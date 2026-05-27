import { SLEEP_PROVIDERS, SleepProvider } from '../../../shared/sleep';

export const SLEEP_SYNC_DISABLED_PROVIDERS: readonly SleepProvider[] = [
    SLEEP_PROVIDERS.COROSAPI,
];

// Empty list means all users; non-empty keeps the rollout scoped without scanning every token.
export const SLEEP_SYNC_ALLOWED_USER_IDS: readonly string[] = [];

export function getDisabledSleepProviders(): readonly SleepProvider[] {
    return SLEEP_SYNC_DISABLED_PROVIDERS;
}

export function isSleepProviderEnabled(provider: SleepProvider): boolean {
    return !SLEEP_SYNC_DISABLED_PROVIDERS.includes(provider);
}

export function getAllowedSleepSyncUserIds(): readonly string[] {
    return SLEEP_SYNC_ALLOWED_USER_IDS;
}

export function isSleepSyncUserAllowed(userID: string | null | undefined): boolean {
    return SLEEP_SYNC_ALLOWED_USER_IDS.length === 0
        || (typeof userID === 'string' && SLEEP_SYNC_ALLOWED_USER_IDS.includes(userID));
}
