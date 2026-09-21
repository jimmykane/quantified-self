import { Provider, Optional } from '@angular/core';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { LoggerService } from '../../services/logger.service';

// Day.js Locale Imports
// We must import these manually to avoid bundling ALL locales (which would be huge).
import 'dayjs/locale/en-gb';
import 'dayjs/locale/de';
import 'dayjs/locale/fr';
import 'dayjs/locale/es';
import 'dayjs/locale/it';
import 'dayjs/locale/nl';
import 'dayjs/locale/pl';
import 'dayjs/locale/el';

import { registerLocaleData } from '@angular/common';
import localeEnGb from '@angular/common/locales/en-GB';
import localeDe from '@angular/common/locales/de';
import localeFr from '@angular/common/locales/fr';
import localeEs from '@angular/common/locales/es';
import localeIt from '@angular/common/locales/it';
import localeNl from '@angular/common/locales/nl';
import localePl from '@angular/common/locales/pl';
import localeEl from '@angular/common/locales/el';

/**
 * Registers Angular locale data for all supported languages.
 * Should be called before bootstrap in main.ts.
 */
export function registerAppLocales() {
    // Angular ships en-US as its built-in locale. Register international English
    // explicitly so en-GB does not silently inherit Angular's US date patterns.
    registerLocaleData(localeEnGb);
    registerLocaleData(localeDe);
    registerLocaleData(localeFr);
    registerLocaleData(localeEs);
    registerLocaleData(localeIt);
    registerLocaleData(localeNl);
    registerLocaleData(localePl);
    registerLocaleData(localeEl);
}


// Define supported locales for the application
export const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'el'] as const;
export const DEFAULT_APP_LOCALE = 'en-GB';

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
        return locale.toLowerCase() === 'en-us' ? 'en-US' : DEFAULT_APP_LOCALE;
    }

    return locale;
}

function browserLocaleCandidates(): string[] {
    const candidates: string[] = [];

    try {
        const resolvedLocale = Intl.DateTimeFormat().resolvedOptions().locale;
        if (resolvedLocale) {
            candidates.push(resolvedLocale);
        }
    } catch {
        // Fall through to navigator-provided language preferences.
    }

    const browserNavigator = globalThis.navigator;
    if (Array.isArray(browserNavigator?.languages)) {
        candidates.push(...browserNavigator.languages);
    }
    if (browserNavigator?.language) {
        candidates.push(browserNavigator.language);
    }

    return [...new Set(candidates)];
}

/**
 * Resolves the best app formatting locale exposed by the browser. Browsers do
 * not expose physical location or a separate OS region reliably, so locale
 * candidates are authoritative and timezone is deliberately not used as a
 * country guess. Unsupported and unavailable locales use international English.
 */
export function getBrowserLocale(logger?: LoggerService): string {
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

/**
 * Provider for MAT_DATE_LOCALE to be used in AppModule.
 * This keeps the module clean from locale logic.
 */
export const MAT_DATE_LOCALE_PROVIDER: Provider = {
    provide: MAT_DATE_LOCALE,
    useFactory: getBrowserLocale,
    deps: [[new Optional(), LoggerService]]
};
