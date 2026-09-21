export const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'el'] as const;
export const DEFAULT_APP_LOCALE = 'en-GB';
export const AUTOMATIC_APP_FORMAT_LOCALE = 'auto';
export const APP_FORMAT_LOCALE_STORAGE_KEY = 'appFormatLocale';

export const APP_FORMAT_LOCALE_OPTIONS = [
    { value: AUTOMATIC_APP_FORMAT_LOCALE, label: 'Automatic (browser)' },
    { value: 'en-GB', label: 'English (United Kingdom)' },
    { value: 'en-US', label: 'English (United States)' },
    { value: 'de-DE', label: 'German (Germany)' },
    { value: 'fr-FR', label: 'French (France)' },
    { value: 'es-ES', label: 'Spanish (Spain)' },
    { value: 'it-IT', label: 'Italian (Italy)' },
    { value: 'nl-NL', label: 'Dutch (Netherlands)' },
    { value: 'pl-PL', label: 'Polish (Poland)' },
    { value: 'el-GR', label: 'Greek (Greece)' },
] as const;

export type AppFormatLocalePreference = typeof APP_FORMAT_LOCALE_OPTIONS[number]['value'];

export interface AppFormatLocalePreview {
    date: string;
    number: string;
}

type LocaleWarningLogger = Pick<Console, 'warn'>;
type LocalePreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

const FORMAT_PREVIEW_DATE = new Date(Date.UTC(2026, 8, 21, 13, 45, 6));
const FORMAT_PREVIEW_NUMBER = 1234.56;
const DEFAULT_LOCALE_BY_LANGUAGE: Record<typeof SUPPORTED_LOCALES[number], Exclude<AppFormatLocalePreference, 'auto'>> = {
    en: DEFAULT_APP_LOCALE,
    de: 'de-DE',
    fr: 'fr-FR',
    es: 'es-ES',
    it: 'it-IT',
    nl: 'nl-NL',
    pl: 'pl-PL',
    el: 'el-GR',
};

function isBrowserRuntime(): boolean {
    return typeof globalThis.window !== 'undefined' && typeof globalThis.document !== 'undefined';
}

export function isAppFormatLocalePreference(value: unknown): value is AppFormatLocalePreference {
    return APP_FORMAT_LOCALE_OPTIONS.some(option => option.value === value);
}

export function normalizeAppFormatLocalePreference(value: unknown): AppFormatLocalePreference {
    return isAppFormatLocalePreference(value) ? value : AUTOMATIC_APP_FORMAT_LOCALE;
}

function localeRegion(locale: string): string | null {
    const subtags = locale.split('-');
    for (let index = 1; index < subtags.length; index += 1) {
        const subtag = subtags[index];
        if (subtag.length === 1) break;
        if (/^[a-z]{2}$/i.test(subtag) || /^\d{3}$/.test(subtag)) return subtag.toUpperCase();
    }
    return null;
}

function canonicalizeLocale(locale: unknown): string | null {
    if (typeof locale !== 'string' || !locale.trim()) {
        return null;
    }

    try {
        return Intl.getCanonicalLocales(locale.trim())[0] ?? null;
    } catch {
        return null;
    }
}

function normalizeSupportedLocale(locale: string): string | null {
    const languageCode = locale.split('-')[0]?.toLowerCase();
    if (!SUPPORTED_LOCALES.includes(languageCode as typeof SUPPORTED_LOCALES[number])) {
        return null;
    }

    // Angular only bundles en-US by default. Use the registered international
    // English locale for every other English region so formats never fall back
    // to US month/day ordering merely because a regional data file is absent.
    if (languageCode === 'en') {
        return localeRegion(locale) === 'US' ? 'en-US' : DEFAULT_APP_LOCALE;
    }

    // Only the registry locales have matching Angular and Day.js locale data.
    // Map other regions for the same language to that registered locale so
    // native Intl helpers and Angular pipes cannot disagree within one screen.
    return DEFAULT_LOCALE_BY_LANGUAGE[languageCode as typeof SUPPORTED_LOCALES[number]];
}

function browserLocaleCandidates(): string[] {
    if (!isBrowserRuntime()) {
        // Recent Node runtimes may expose navigator. Browser globals must both
        // exist before client preferences are allowed to affect SSR output.
        return [];
    }

    const browserNavigator = globalThis.navigator;
    if (!browserNavigator) {
        // Server and prerender processes must not leak their host locale into output.
        return [];
    }

    const candidates: string[] = [];
    if (Array.isArray(browserNavigator.languages)) {
        candidates.push(...browserNavigator.languages);
    }
    if (browserNavigator.language) {
        candidates.push(browserNavigator.language);
    }

    // Modern browsers expose navigator.language(s). Retain Intl only as a
    // browser fallback for constrained runtimes where those fields are empty.
    if (candidates.length === 0) {
        try {
            const resolvedLocale = Intl.DateTimeFormat().resolvedOptions().locale;
            if (resolvedLocale) {
                candidates.push(resolvedLocale);
            }
        } catch {
            // The deterministic fallback below remains available.
        }
    }

    return [...new Set(candidates)];
}

/**
 * Resolves the best app formatting locale exposed by the browser. Browsers do
 * not expose physical location or a separate OS region reliably, so ordered
 * language preferences are authoritative and timezone is not used as a country
 * guess. Server, unsupported, and unavailable locales use international English.
 */
export function getBrowserLocale(logger?: LocaleWarningLogger): string {
    const candidates = browserLocaleCandidates();
    for (const candidate of candidates) {
        const canonicalLocale = canonicalizeLocale(candidate);
        const supportedLocale = canonicalLocale ? normalizeSupportedLocale(canonicalLocale) : null;
        if (supportedLocale) {
            return supportedLocale;
        }
    }

    if (logger && candidates.length > 0) {
        logger.warn(`[Locale] Unsupported locale detected: ${candidates[0]}. Falling back to ${DEFAULT_APP_LOCALE}.`);
    }
    return DEFAULT_APP_LOCALE;
}

function getBrowserStorage(): LocalePreferenceStorage | null {
    if (!isBrowserRuntime()) return null;

    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

export function readStoredAppFormatLocalePreference(
    storage: LocalePreferenceStorage | null = getBrowserStorage(),
): AppFormatLocalePreference {
    if (!storage) return AUTOMATIC_APP_FORMAT_LOCALE;

    try {
        return normalizeAppFormatLocalePreference(storage.getItem(APP_FORMAT_LOCALE_STORAGE_KEY));
    } catch {
        return AUTOMATIC_APP_FORMAT_LOCALE;
    }
}

export function storeAppFormatLocalePreference(
    preference: AppFormatLocalePreference,
    storage: LocalePreferenceStorage | null = getBrowserStorage(),
): boolean {
    if (!storage || !isAppFormatLocalePreference(preference)) return false;

    try {
        storage.setItem(APP_FORMAT_LOCALE_STORAGE_KEY, preference);
        return storage.getItem(APP_FORMAT_LOCALE_STORAGE_KEY) === preference;
    } catch {
        return false;
    }
}

export function resolveAppLocale(
    preference: unknown,
    logger?: LocaleWarningLogger,
): string {
    const normalizedPreference = normalizeAppFormatLocalePreference(preference);
    return normalizedPreference === AUTOMATIC_APP_FORMAT_LOCALE
        ? getBrowserLocale(logger)
        : normalizedPreference;
}

/** Resolves the locale captured by Angular and Material during application bootstrap. */
export function getAppLocale(logger?: LocaleWarningLogger): string {
    return resolveAppLocale(readStoredAppFormatLocalePreference(), logger);
}

export function buildAppFormatLocalePreview(preference: AppFormatLocalePreference): AppFormatLocalePreview {
    const locale = resolveAppLocale(preference);
    return {
        date: new Intl.DateTimeFormat(locale, {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            timeZone: 'UTC',
        }).format(FORMAT_PREVIEW_DATE),
        number: new Intl.NumberFormat(locale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(FORMAT_PREVIEW_NUMBER),
    };
}
