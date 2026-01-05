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

    it('should define HandsetOrTabletPortrait breakpoint', () => {
        expect(AppBreakpoints.HandsetOrTabletPortrait).toBe('(max-width: 959.98px)');
    });

    it('should have all expected breakpoint keys', () => {
        const expectedKeys = ['XSmall', 'Small', 'Medium', 'Large', 'XLarge', 'Handset', 'Tablet', 'HandsetOrTabletPortrait'];
        expect(Object.keys(AppBreakpoints)).toEqual(expect.arrayContaining(expectedKeys));
    });
});
