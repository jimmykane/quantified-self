
import { TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { DayjsDateAdapter } from './dayjs-date-adapter';
import dayjs from 'dayjs';
import 'dayjs/locale/fr';
import 'dayjs/locale/el';
import 'dayjs/locale/en-gb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let originalNavigatorDescriptor: PropertyDescriptor | undefined;

function setBrowserLanguages(...languages: string[]): void {
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { language: languages[0], languages },
    });
}

beforeEach(() => {
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
});

afterEach(() => {
    if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    } else {
        Reflect.deleteProperty(globalThis, 'navigator');
    }
});

describe('DayjsDateAdapter', () => {
    let adapter: DayjsDateAdapter;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [DayjsDateAdapter, { provide: MAT_DATE_LOCALE, useValue: 'en' }]
        });
        adapter = TestBed.inject(DayjsDateAdapter);
    });

    it('should create create', () => {
        expect(adapter).toBeTruthy();
    });

    it('should parse valid date string', () => {
        const date = adapter.parse('01/01/2023', 'L');
        expect(date).toBeTruthy();
        expect(date?.isValid()).toBe(true);
        expect(date?.year()).toBe(2023);
        expect(date?.month()).toBe(0); // Month is 0-indexed
        expect(date?.date()).toBe(1);
    });

    it.each(['31/09/2025', '29/02/2025', '01/13/2025', '00/01/2025', '01/00/2025'])(
        'rejects an impossible typed calendar date %s instead of normalizing it', value => {
            adapter.setLocale('en-GB');
            expect(adapter.parse(value, 'L')?.isValid()).toBe(false);
        },
    );

    it.each([
        ['en-GB', '29/02/2024', '2024-02-29'],
        ['en-US', '02/29/2024', '2024-02-29'],
        ['en-GB', '1/9/2025', '2025-09-01'],
        ['en-US', '9/1/2025', '2025-09-01'],
        ['en-GB', ' 01/09/2025 ', '2025-09-01'],
    ])('parses a valid local date in %s: %s', (locale, value, expected) => {
        adapter.setLocale(locale);
        expect(adapter.parse(value, 'L')?.format('YYYY-MM-DD')).toBe(expected);
    });

    it('validates each explicit format without accepting overflow or trailing text', () => {
        expect(adapter.parse('2024-02-29', ['YYYY-MM-DD', 'L'])?.format('YYYY-MM-DD')).toBe('2024-02-29');
        expect(adapter.parse('2025-02-29', 'YYYY-MM-DD')?.isValid()).toBe(false);
        expect(adapter.parse('01/01/2025 extra', 'L')?.isValid()).toBe(false);
    });

    it('should format date correctly', () => {
        const date = dayjs('2023-01-01');
        const formatted = adapter.format(date, 'YYYY-MM-DD');
        expect(formatted).toBe('2023-01-01');
    });

    it('should handle locale changes', () => {
        adapter.setLocale('fr');
        // const date = dayjs('2023-01-01'); // Unused
        const monthName = adapter.getMonthNames('long')[0];
        expect(monthName.toLowerCase()).toBe('janvier');
    });

    it('should add days correctly', () => {
        const date = dayjs('2023-01-01');
        const newDate = adapter.addCalendarDays(date, 5);
        expect(newDate.date()).toBe(6);
    });

    it('should not mutate original date when adding days', () => {
        const date = dayjs('2023-01-01');
        adapter.addCalendarDays(date, 5);
        expect(date.date()).toBe(1);
    });
});

describe('DayjsDateAdapter locale normalization', () => {
    it('should normalize el-GR to el', () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [DayjsDateAdapter, { provide: MAT_DATE_LOCALE, useValue: 'el-GR' }]
        });
        const adapter = TestBed.inject(DayjsDateAdapter);
        expect(adapter).toBeTruthy();
        // Greek locale uses dd/MM/yyyy format
        const date = dayjs('2023-12-25');
        const formatted = adapter.format(date, 'L');
        expect(formatted).toBe('25/12/2023');
    });

    it('should normalize en-GB to en-gb', () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [DayjsDateAdapter, { provide: MAT_DATE_LOCALE, useValue: 'en-GB' }]
        });
        const adapter = TestBed.inject(DayjsDateAdapter);
        expect(adapter).toBeTruthy();
        // UK locale uses dd/MM/yyyy format
        const date = dayjs('2023-12-25');
        const formatted = adapter.format(date, 'L');
        expect(formatted).toBe('25/12/2023');
    });

    it('should normalize en-US to en (US format)', () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [DayjsDateAdapter, { provide: MAT_DATE_LOCALE, useValue: 'en-US' }]
        });
        const adapter = TestBed.inject(DayjsDateAdapter);
        expect(adapter).toBeTruthy();
        // US locale uses MM/DD/YYYY format
        const date = dayjs('2023-12-25');
        const formatted = adapter.format(date, 'L');
        expect(formatted).toBe('12/25/2023');
    });

    it('preserves US format when the locale includes Unicode extensions', () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [DayjsDateAdapter, { provide: MAT_DATE_LOCALE, useValue: 'en-US-u-nu-latn' }]
        });
        const adapter = TestBed.inject(DayjsDateAdapter);

        expect(adapter.format(dayjs('2023-12-25'), 'L')).toBe('12/25/2023');
    });

    it('should use international English for an English locale without a Day.js bundle', () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [DayjsDateAdapter, { provide: MAT_DATE_LOCALE, useValue: 'en-GR' }]
        });
        const adapter = TestBed.inject(DayjsDateAdapter);

        expect(adapter.format(dayjs('2023-12-25'), 'L')).toBe('25/12/2023');
    });

    it('should handle fr-FR locale', () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [DayjsDateAdapter, { provide: MAT_DATE_LOCALE, useValue: 'fr-FR' }]
        });
        const adapter = TestBed.inject(DayjsDateAdapter);
        expect(adapter).toBeTruthy();
        // French locale uses dd/MM/yyyy format
        const date = dayjs('2023-12-25');
        const formatted = adapter.format(date, 'L');
        expect(formatted).toBe('25/12/2023');
    });

    it('keeps the browser-derived week start separate from the formatting locale', () => {
        setBrowserLanguages('en-US');
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [DayjsDateAdapter, { provide: MAT_DATE_LOCALE, useValue: 'fr-FR' }]
        });
        const adapter = TestBed.inject(DayjsDateAdapter);

        expect(adapter.format(dayjs('2023-12-25'), 'L')).toBe('25/12/2023');
        expect(adapter.getFirstDayOfWeek()).toBe(0);

        adapter.setLocale('de-DE');
        expect(adapter.getFirstDayOfWeek()).toBe(0);
    });

    it('falls back deterministically when a Day.js locale bundle is not imported', () => {
        dayjs.locale('fr');
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [DayjsDateAdapter, { provide: MAT_DATE_LOCALE, useValue: 'fi-FI' }]
        });
        const adapter = TestBed.inject(DayjsDateAdapter);

        expect(adapter.format(dayjs('2023-12-25'), 'L')).toBe('25/12/2023');
        expect(adapter.getMonthNames('long')[0]).toBe('January');
    });
});
