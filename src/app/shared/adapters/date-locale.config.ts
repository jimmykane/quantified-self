
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
import 'dayjs/locale/el';

/**
 * Gets the user's locale using the modern Intl API.
 * This respects system/OS regional settings, not just browser language.
 * Falls back to navigator.language if Intl is unavailable.
 */
export function getBrowserLocale(): string {
    try {
        // Use Intl.DateTimeFormat to get the actual system locale for dates
        const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale;
        return systemLocale || navigator.language || 'en-US';
    } catch {
        return navigator.language || 'en-US';
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
