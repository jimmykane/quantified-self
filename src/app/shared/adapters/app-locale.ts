export const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'el'] as const;
export const DEFAULT_APP_LOCALE = 'en-GB';

type LocaleWarningLogger = Pick<Console, 'warn'>;

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

    return locale;
}

function browserLocaleCandidates(): string[] {
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
