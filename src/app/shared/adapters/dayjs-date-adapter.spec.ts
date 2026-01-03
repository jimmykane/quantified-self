
import { TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { DayjsDateAdapter } from './dayjs-date-adapter';
import dayjs from 'dayjs';
import 'dayjs/locale/fr';
import 'dayjs/locale/el';
import 'dayjs/locale/en-gb';
import { describe, it, expect, beforeEach } from 'vitest';

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
});

