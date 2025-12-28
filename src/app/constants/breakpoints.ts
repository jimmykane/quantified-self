/**
 * Global App Breakpoints
 * Based on Material Design responsive layout grid breakpoints.
 * Use with @angular/cdk/layout BreakpointObserver.
 * 
 * @see https://material.io/design/layout/responsive-layout-grid.html#breakpoints
 */
export const AppBreakpoints = {
    /** Handset portrait (0-599px) */
    XSmall: '(max-width: 599.98px)',

    /** Handset landscape / Tablet portrait (600-959px) */
    Small: '(min-width: 600px) and (max-width: 959.98px)',

    /** Tablet landscape / Small desktop (960-1279px) */
    Medium: '(min-width: 960px) and (max-width: 1279.98px)',

    /** Large desktop (1280-1919px) */
    Large: '(min-width: 1280px) and (max-width: 1919.98px)',

    /** Extra large desktop (1920px+) */
    XLarge: '(min-width: 1920px)',

    /** Handset (portrait or landscape) */
    Handset: '(max-width: 599.98px), (min-width: 600px) and (max-width: 959.98px) and (orientation: portrait)',

    /** Tablet (portrait or landscape) */
    Tablet: '(min-width: 600px) and (max-width: 839.98px) and (orientation: portrait), (min-width: 960px) and (max-width: 1279.98px) and (orientation: landscape)',

    /** Any screen smaller than tablet landscape */
    HandsetOrTabletPortrait: '(max-width: 959.98px)',
} as const;

export type AppBreakpoint = keyof typeof AppBreakpoints;
