
import { Provider } from '@angular/core';
import { MAT_DATE_LOCALE } from '@angular/material/core';

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
    registerLocaleData(localeDe);
    registerLocaleData(localeFr);
    registerLocaleData(localeEs);
    registerLocaleData(localeIt);
    registerLocaleData(localeNl);
    registerLocaleData(localePl);
    registerLocaleData(localeEl);
}


// Define supported locales for the application
export const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'el'];

/**
 * Gets the user's locale using the modern Intl API.
 * This respects system/OS regional settings, not just browser language.
 * Falls back to navigator.language if Intl is unavailable.
 *
 * IMPORTANT: This function now validates the detected locale against SUPPORTED_LOCALES.
 * If the locale is not supported, it falls back to 'en-US'.
 */
export function getBrowserLocale(): string {
    try {
        // Use Intl.DateTimeFormat to get the actual system locale for dates
        const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale;
        let detected = systemLocale || navigator.language || 'en-US';

        // 1. Try exact match (e.g. 'en-GB') - Logic: some locales might have specific regions we support
        // For now our supported list is mostly language codes, but good to check.

        // 2. Try language code match (e.g. 'pl-PL' -> 'pl')
        const languageCode = detected.split('-')[0];

        if (SUPPORTED_LOCALES.includes(languageCode)) {
            return detected; // We use the full locale (e.g. pl-PL) but we know we have data for 'pl'
        }

        console.warn(`[Locale] Unsupported locale detected: ${detected}. Falling back to en-US.`);
        return 'en-US';

    } catch {
        return 'en-US';
    }
}

/**
 * Provider for MAT_DATE_LOCALE to be used in AppModule.
 * This keeps the module clean from locale logic.
 */
export const MAT_DATE_LOCALE_PROVIDER: Provider = {
    provide: MAT_DATE_LOCALE,
    useFactory: getBrowserLocale
};

