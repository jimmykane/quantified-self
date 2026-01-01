
import { TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { DayjsDateAdapter } from './dayjs-date-adapter';
import dayjs from 'dayjs';
import 'dayjs/locale/fr';

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

    it('should format date correctly', () => {
        const date = dayjs('2023-01-01');
        const formatted = adapter.format(date, 'YYYY-MM-DD');
        expect(formatted).toBe('2023-01-01');
    });

    it('should handle locale changes', () => {
        adapter.setLocale('fr');
        const date = dayjs('2023-01-01');
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
        const newDate = adapter.addCalendarDays(date, 5);
        expect(date.date()).toBe(1);
    });
});
