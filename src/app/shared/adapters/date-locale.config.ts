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
import { getAppLocale } from './app-locale';

export { DEFAULT_APP_LOCALE, SUPPORTED_LOCALES, getAppLocale, getBrowserLocale } from './app-locale';

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


/**
 * Provider for MAT_DATE_LOCALE to be used in AppModule.
 * This keeps the module clean from locale logic.
 */
export const MAT_DATE_LOCALE_PROVIDER: Provider = {
    provide: MAT_DATE_LOCALE,
    useFactory: getAppLocale,
    deps: [[new Optional(), LoggerService]]
};
