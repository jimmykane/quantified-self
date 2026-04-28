import { SLEEP_PROVIDERS, SleepProvider } from '../../../shared/sleep';

export const SLEEP_SYNC_DISABLED_PROVIDERS_ENV = 'SLEEP_SYNC_DISABLED_PROVIDERS';

const PROVIDER_ALIASES: Record<string, SleepProvider> = {
    coros: SLEEP_PROVIDERS.COROSAPI,
    corosapi: SLEEP_PROVIDERS.COROSAPI,
    garmin: SLEEP_PROVIDERS.GarminAPI,
    garminapi: SLEEP_PROVIDERS.GarminAPI,
    suunto: SLEEP_PROVIDERS.SuuntoApp,
    suuntoapp: SLEEP_PROVIDERS.SuuntoApp,
};

const ALL_SLEEP_PROVIDERS = Object.values(SLEEP_PROVIDERS);

function normalizeProviderToken(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function getDisabledSleepProviders(): SleepProvider[] {
    const rawValue = process.env[SLEEP_SYNC_DISABLED_PROVIDERS_ENV] || '';
    const disabled = new Set<SleepProvider>();

    for (const token of rawValue.split(/[\s,]+/)) {
        const normalized = normalizeProviderToken(token);
        if (!normalized || normalized === 'none') {
            continue;
        }
        if (normalized === 'all') {
            ALL_SLEEP_PROVIDERS.forEach((provider) => disabled.add(provider));
            continue;
        }

        const provider = PROVIDER_ALIASES[normalized];
        if (provider) {
            disabled.add(provider);
        }
    }

    return [...disabled];
}

export function isSleepProviderEnabled(provider: SleepProvider): boolean {
    return !getDisabledSleepProviders().includes(provider);
}

