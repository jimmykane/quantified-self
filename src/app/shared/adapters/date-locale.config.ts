import { Provider, Optional } from '@angular/core';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { LoggerService } from '../../services/logger.service';
import { registerLocaleData } from '@angular/common';
import { getAppLocale } from './app-locale';

export { DEFAULT_APP_LOCALE, SUPPORTED_LOCALES, getAppLocale, getBrowserLocale } from './app-locale';

type LocaleModule = { default: unknown };

const localeRegistrationPromises = new Map<string, Promise<void>>();
const localeLoaders: Readonly<Record<string, () => Promise<[LocaleModule, unknown]>>> = {
    'en-GB': () => Promise.all([import('@angular/common/locales/en-GB'), import('dayjs/locale/en-gb')]),
    'de-DE': () => Promise.all([import('@angular/common/locales/de'), import('dayjs/locale/de')]),
    'fr-FR': () => Promise.all([import('@angular/common/locales/fr'), import('dayjs/locale/fr')]),
    'es-ES': () => Promise.all([import('@angular/common/locales/es'), import('dayjs/locale/es')]),
    'it-IT': () => Promise.all([import('@angular/common/locales/it'), import('dayjs/locale/it')]),
    'nl-NL': () => Promise.all([import('@angular/common/locales/nl'), import('dayjs/locale/nl')]),
    'pl-PL': () => Promise.all([import('@angular/common/locales/pl'), import('dayjs/locale/pl')]),
    'el-GR': () => Promise.all([import('@angular/common/locales/el'), import('dayjs/locale/el')]),
};

/** Loads only the Angular and Day.js locale selected for this bootstrap. */
export function registerAppLocale(locale: string = getAppLocale()): Promise<void> {
    // Angular and Day.js both ship en-US as their built-in locale.
    if (locale === 'en-US') return Promise.resolve();

    const cachedRegistration = localeRegistrationPromises.get(locale);
    if (cachedRegistration) return cachedRegistration;

    const loadLocale = localeLoaders[locale] ?? localeLoaders['en-GB'];
    const registration = loadLocale().then(([angularLocale]) => {
        registerLocaleData(angularLocale.default);
    });
    localeRegistrationPromises.set(locale, registration);
    return registration;
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
