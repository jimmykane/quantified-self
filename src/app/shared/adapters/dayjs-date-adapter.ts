
import { Inject, Injectable, Optional } from '@angular/core';
import { DateAdapter, MAT_DATE_LOCALE } from '@angular/material/core';
import dayjs, { Dayjs } from 'dayjs';
import localeData from 'dayjs/plugin/localeData';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(localeData);
dayjs.extend(localizedFormat);
dayjs.extend(customParseFormat);

const IMPORTED_DAYJS_BASE_LOCALES = new Set(['de', 'fr', 'es', 'it', 'nl', 'pl', 'el']);

function localeRegion(locale: string): string | null {
    const subtags = locale.split('-');
    for (let index = 1; index < subtags.length; index += 1) {
        const subtag = subtags[index];
        if (subtag.length === 1) break;
        if (/^[a-z]{2}$/i.test(subtag) || /^\d{3}$/.test(subtag)) return subtag.toUpperCase();
    }
    return null;
}

/** Adapts Dayjs for the Angular Material Datepicker. */
@Injectable()
export class DayjsDateAdapter extends DateAdapter<Dayjs> {
    constructor(@Optional() @Inject(MAT_DATE_LOCALE) private matDateLocale: string) {
        super();
        this.setLocale(matDateLocale || dayjs.locale());
    }

    /**
     * Normalizes browser locale codes to Day.js locale codes.
     * e.g., 'el-GR' -> 'el', 'en-US' -> 'en', 'en-GB' -> 'en-gb'
     */
    private normalizeLocale(locale: string): string {
        if (!locale) return 'en-gb';

        const lowerLocale = locale.toLowerCase();

        // Only return locale bundles imported by date-locale.config.ts. Day.js
        // otherwise keeps its previous global locale, which makes formatting
        // depend on whichever adapter happened to run first.
        const localeMap: Record<string, string> = {
            'en-us': 'en',
            'en-gb': 'en-gb',
            'en-150': 'en-gb',
            'en-001': 'en-gb',
            'el-gr': 'el',
            'de-de': 'de',
            'de-at': 'de',
            'de-ch': 'de',
            'fr-fr': 'fr',
            'fr-be': 'fr',
            'fr-ca': 'fr',
            'fr-ch': 'fr',
            'es-es': 'es',
            'it-it': 'it',
            'nl-nl': 'nl',
            'nl-be': 'nl',
        };

        // Check exact match in the map
        if (localeMap[lowerLocale]) {
            return localeMap[lowerLocale];
        }

        // Try the base language (e.g., 'el-GR' -> 'el')
        const baseLang = lowerLocale.split('-')[0];
        if (baseLang === 'en') {
            return localeRegion(locale) === 'US' ? 'en' : 'en-gb';
        }
        return IMPORTED_DAYJS_BASE_LOCALES.has(baseLang) ? baseLang : 'en-gb';
    }

    getYear(date: Dayjs): number {
        return date.year();
    }

    getMonth(date: Dayjs): number {
        return date.month();
    }

    getDate(date: Dayjs): number {
        return date.date();
    }

    getDayOfWeek(date: Dayjs): number {
        return date.day();
    }

    getMonthNames(style: 'long' | 'short' | 'narrow'): string[] {
        return style === 'long' ? dayjs.months() : dayjs.monthsShort();
    }

    getDateNames(): string[] {
        const dates = [];
        for (let i = 1; i <= 31; i++) {
            dates.push(String(i));
        }
        return dates;
    }

    getDayOfWeekNames(style: 'long' | 'short' | 'narrow'): string[] {
        if (style === 'long') {
            return dayjs.weekdays();
        }
        if (style === 'short') {
            return dayjs.weekdaysShort();
        }
        return dayjs.weekdaysMin();
    }

    getYearName(date: Dayjs): string {
        return String(date.year());
    }

    getFirstDayOfWeek(): number {
        return dayjs.localeData().firstDayOfWeek();
    }

    getNumDaysInMonth(date: Dayjs): number {
        return date.daysInMonth();
    }

    clone(date: Dayjs): Dayjs {
        return date.clone();
    }

    createDate(year: number, month: number, date: number): Dayjs {
        return dayjs().set('year', year).set('month', month).set('date', date);
    }

    today(): Dayjs {
        return dayjs();
    }

    parse(value: any, parseFormat: any): Dayjs | null {
        if (value && typeof value === 'string') {
            return dayjs(value, parseFormat, this.locale);
        }
        return value ? dayjs(value).locale(this.locale) : null;
    }

    format(date: Dayjs, displayFormat: any): string {
        if (!this.isValid(date)) {
            throw Error('DayjsDateAdapter: Cannot format invalid date.');
        }
        return date.locale(this.locale).format(displayFormat);
    }

    addCalendarYears(date: Dayjs, years: number): Dayjs {
        return date.add(years, 'year');
    }

    addCalendarMonths(date: Dayjs, months: number): Dayjs {
        return date.add(months, 'month');
    }

    addCalendarDays(date: Dayjs, days: number): Dayjs {
        return date.add(days, 'day');
    }

    toIso8601(date: Dayjs): string {
        return date.toISOString();
    }

    override deserialize(value: any): Dayjs | null {
        let date;
        if (value instanceof Date) {
            date = dayjs(value);
        } else if (this.isDateInstance(value)) {
            // NOTE: assumes that creating a Dayjs instance from another Dayjs instance works.
            return this.clone(value as Dayjs);
        }
        if (typeof value === 'string') {
            if (!value) {
                return null;
            }
            date = dayjs(value).locale(this.locale);
        }
        if (date && this.isValid(date)) {
            return this.clone(date);
        }
        return super.deserialize(value);
    }

    isDateInstance(obj: any): boolean {
        return dayjs.isDayjs(obj);
    }

    isValid(date: Dayjs): boolean {
        return dayjs.isDayjs(date) && date.isValid();
    }

    invalid(): Dayjs {
        return dayjs(null);
    }

    override setLocale(locale: string) {
        const normalizedLocale = this.normalizeLocale(locale);
        super.setLocale(normalizedLocale);
        dayjs.locale(normalizedLocale);
    }
}
