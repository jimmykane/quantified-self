import { describe, expect, it, vi } from 'vitest';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
    const actual: any = await importOriginal();
    return actual;
});
import { ActivityParsingOptions } from '@sports-alliance/sports-lib';
import { createParsingOptions, createRouteParsingOptions } from '../../../shared/parsing-options';

describe('createParsingOptions', () => {
    it('returns parser-compatible options with the expected defaults', () => {
        const options = createParsingOptions();
        const prototype = Object.getPrototypeOf(options);
        expect(prototype).not.toBeNull();
        expect(prototype).not.toBe(Object.prototype);
        expect(prototype.constructor.name).toBe(ActivityParsingOptions.name);
        expect(options).toEqual(expect.objectContaining({
            generateUnitStreams: false,
            deviceInfoMode: 'changes',
        }));
    });

    it('applies function defaults for queue parsing', () => {
        const options = createParsingOptions();
        expect(options.generateUnitStreams).toBe(false);
        expect(options.deviceInfoMode).toBe('changes');
    });

    it('keeps sports-lib defaults for unrelated options', () => {
        const options = createParsingOptions();
        expect(options.maxActivityDurationDays).toBe(14);
        expect(options.streams).toBeDefined();
    });

    it('allows overriding generateUnitStreams', () => {
        const options = createParsingOptions({ generateUnitStreams: true });
        expect(options.generateUnitStreams).toBe(true);
        expect(options.deviceInfoMode).toBe('changes');
    });

    it('allows overriding deviceInfoMode', () => {
        const options = createParsingOptions({ deviceInfoMode: 'raw' });
        expect(options.deviceInfoMode).toBe('raw');
        expect(options.generateUnitStreams).toBe(false);
    });

    it('returns a new instance per invocation', () => {
        const first = createParsingOptions();
        const second = createParsingOptions();
        expect(first).not.toBe(second);
    });
});

describe('createRouteParsingOptions', () => {
    it('opts route GPX parsing into timed track imports by default', () => {
        const options = createRouteParsingOptions();

        expect(options).toEqual(expect.objectContaining({
            generateUnitStreams: false,
            gpx: {
                importTimedTracksAsRoutes: true,
            },
        }));
    });

    it('allows callers to opt out of timed GPX track route imports', () => {
        const options = createRouteParsingOptions({
            gpx: {
                importTimedTracksAsRoutes: false,
            },
        });

        expect(options.gpx.importTimedTracksAsRoutes).toBe(false);
    });

    it('keeps route stream defaults and requested include types', () => {
        const options = createRouteParsingOptions({}, ['Distance', 'Altitude']);

        expect(options.streams).toEqual({
            smooth: {
                altitudeSmooth: true,
                grade: true,
                gradeSmooth: true,
            },
            includeTypes: ['Distance', 'Altitude'],
        });
    });
});
