import { AppBreakpoints } from './breakpoints';

describe('AppBreakpoints', () => {
    it('should define XSmall breakpoint for mobile', () => {
        expect(AppBreakpoints.XSmall).toBe('(max-width: 599.98px)');
    });

    it('should define Small breakpoint', () => {
        expect(AppBreakpoints.Small).toBe('(min-width: 600px) and (max-width: 959.98px)');
    });

    it('should define Medium breakpoint', () => {
        expect(AppBreakpoints.Medium).toBe('(min-width: 960px) and (max-width: 1279.98px)');
    });

    it('should define Large breakpoint', () => {
        expect(AppBreakpoints.Large).toBe('(min-width: 1280px) and (max-width: 1919.98px)');
    });

    it('should define XLarge breakpoint', () => {
        expect(AppBreakpoints.XLarge).toBe('(min-width: 1920px)');
    });

    it('should define Max480 breakpoint', () => {
        expect(AppBreakpoints.Max480).toBe('(max-width: 480px)');
    });

    it('should define Max640 breakpoint', () => {
        expect(AppBreakpoints.Max640).toBe('(max-width: 640px)');
    });

    it('should define Max768 breakpoint', () => {
        expect(AppBreakpoints.Max768).toBe('(max-width: 768px)');
    });

    it('should define Max900 breakpoint', () => {
        expect(AppBreakpoints.Max900).toBe('(max-width: 900px)');
    });

    it('should define Max1024 breakpoint', () => {
        expect(AppBreakpoints.Max1024).toBe('(max-width: 1024px)');
    });

    it('should define Min768 breakpoint', () => {
        expect(AppBreakpoints.Min768).toBe('(min-width: 768px)');
    });

    it('should define HandsetOrTabletPortrait breakpoint', () => {
        expect(AppBreakpoints.HandsetOrTabletPortrait).toBe('(max-width: 959.98px)');
    });

    it('should have all expected breakpoint keys', () => {
        const expectedKeys = [
            'XSmall',
            'Small',
            'Medium',
            'Large',
            'XLarge',
            'Max480',
            'Max640',
            'Max768',
            'Max900',
            'Max1024',
            'Min768',
            'Handset',
            'Tablet',
            'HandsetOrTabletPortrait',
        ];
        expect(Object.keys(AppBreakpoints)).toEqual(expect.arrayContaining(expectedKeys));
    });
});
