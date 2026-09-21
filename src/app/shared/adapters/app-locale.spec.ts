import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    APP_FORMAT_LOCALE_OPTIONS,
    APP_FORMAT_LOCALE_STORAGE_KEY,
    AUTOMATIC_APP_FORMAT_LOCALE,
    buildAppFormatLocalePreview,
    getAppLocale,
    normalizeAppFormatLocalePreference,
    readStoredAppFormatLocalePreference,
    resolveAppLocale,
    storeAppFormatLocalePreference,
} from './app-locale';

describe('app-locale', () => {
    let originalNavigatorDescriptor: PropertyDescriptor | undefined;
    let originalLocalStorageDescriptor: PropertyDescriptor | undefined;
    let originalWindowDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
        originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
        originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    });

    afterEach(() => {
        if (originalNavigatorDescriptor) {
            Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, 'navigator');
        }
        if (originalLocalStorageDescriptor) {
            Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, 'localStorage');
        }
        if (originalWindowDescriptor) {
            Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, 'window');
        }
        vi.restoreAllMocks();
    });

    function setGlobal(name: 'navigator' | 'localStorage' | 'window', value: unknown): void {
        Object.defineProperty(globalThis, name, { configurable: true, value });
    }

    it('exposes Automatic plus the nine registered formatting locales', () => {
        expect(APP_FORMAT_LOCALE_OPTIONS.map(option => option.value)).toEqual([
            'auto', 'en-GB', 'en-US', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'nl-NL', 'pl-PL', 'el-GR',
        ]);
    });

    it('normalizes missing and unsupported preferences to Automatic', () => {
        expect(normalizeAppFormatLocalePreference(undefined)).toBe(AUTOMATIC_APP_FORMAT_LOCALE);
        expect(normalizeAppFormatLocalePreference('fi-FI')).toBe(AUTOMATIC_APP_FORMAT_LOCALE);
    });

    it('resolves explicit preferences without consulting the browser', () => {
        setGlobal('navigator', { language: 'en-US', languages: ['en-US'] });

        expect(resolveAppLocale('fr-FR')).toBe('fr-FR');
    });

    it('resolves Automatic through ordered browser preferences', () => {
        setGlobal('navigator', { language: 'de-DE', languages: ['de-DE', 'en-US'] });

        expect(resolveAppLocale(AUTOMATIC_APP_FORMAT_LOCALE)).toBe('de-DE');
    });

    it('keeps Automatic inside the locale registry when the browser uses another region', () => {
        setGlobal('navigator', { language: 'de-AT', languages: ['de-AT'] });

        expect(resolveAppLocale(AUTOMATIC_APP_FORMAT_LOCALE)).toBe('de-DE');
        expect(buildAppFormatLocalePreview(AUTOMATIC_APP_FORMAT_LOCALE)).toEqual(
            buildAppFormatLocalePreview('de-DE'),
        );
    });

    it('uses the deterministic server fallback for Automatic', () => {
        setGlobal('navigator', undefined);
        setGlobal('localStorage', undefined);

        expect(getAppLocale()).toBe('en-GB');
    });

    it('ignores browser-like globals when rendering outside a browser runtime', () => {
        setGlobal('window', undefined);
        setGlobal('navigator', { language: 'en-US', languages: ['en-US'] });
        setGlobal('localStorage', {
            getItem: vi.fn(() => 'fr-FR'),
            setItem: vi.fn(),
        });

        expect(getAppLocale()).toBe('en-GB');
    });

    it('reads a valid stored preference and ignores an invalid one', () => {
        const storage = {
            value: 'el-GR',
            getItem: vi.fn(() => storage.value),
            setItem: vi.fn((_key: string, value: string) => { storage.value = value; }),
        };

        expect(readStoredAppFormatLocalePreference(storage)).toBe('el-GR');
        storage.value = 'unsupported';
        expect(readStoredAppFormatLocalePreference(storage)).toBe(AUTOMATIC_APP_FORMAT_LOCALE);
    });

    it('verifies stored writes and handles blocked storage', () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: vi.fn((key: string) => values.get(key) ?? null),
            setItem: vi.fn((key: string, value: string) => values.set(key, value)),
        };
        const blockedStorage = {
            getItem: vi.fn(() => { throw new Error('blocked'); }),
            setItem: vi.fn(() => { throw new Error('blocked'); }),
        };

        expect(storeAppFormatLocalePreference('pl-PL', storage)).toBe(true);
        expect(values.get(APP_FORMAT_LOCALE_STORAGE_KEY)).toBe('pl-PL');
        expect(storeAppFormatLocalePreference('pl-PL', blockedStorage)).toBe(false);
        expect(readStoredAppFormatLocalePreference(blockedStorage)).toBe(AUTOMATIC_APP_FORMAT_LOCALE);
    });

    it('builds locale-specific date and number previews', () => {
        expect(buildAppFormatLocalePreview('en-GB')).toEqual({ date: '21/09/2026', number: '1,234.56' });
        expect(buildAppFormatLocalePreview('en-US')).toEqual({ date: '9/21/2026', number: '1,234.56' });
        expect(buildAppFormatLocalePreview('de-DE')).toEqual({ date: '21.9.2026', number: '1.234,56' });
        expect(buildAppFormatLocalePreview('fr-FR').number.replace(/\s/u, ' ')).toBe('1 234,56');
        expect(buildAppFormatLocalePreview('el-GR')).toEqual({ date: '21/9/2026', number: '1.234,56' });
    });
});
