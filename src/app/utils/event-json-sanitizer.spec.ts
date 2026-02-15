
import { describe, it, expect, afterEach } from 'vitest';
import { EventJSONSanitizer } from './event-json-sanitizer';
import { DynamicDataLoader, UnitSystem } from '@sports-alliance/sports-lib';

// Mock Data class
class MockData {
    static type = 'KnownType';
    static unit = 'test_unit';
    static unitSystem = UnitSystem.Metric;
}

describe('EventJSONSanitizer', () => {
    const mockKnownType = 'KnownType';
    const mockUnknownType = 'UnknownType';

    // Store original method to restore after tests
    const originalGetDataClass = DynamicDataLoader.getDataClassFromDataType;
    const originalGetDataInstance = DynamicDataLoader.getDataInstanceFromDataType;

    afterEach(() => {
        // Restore original method
        DynamicDataLoader.getDataClassFromDataType = originalGetDataClass;
        DynamicDataLoader.getDataInstanceFromDataType = originalGetDataInstance;
    });

    // Helper to setup mock
    const setupMock = (
        extraKnownTypes: string[] = [],
        invalidPayload?: (type: string, payload: any) => boolean
    ) => {
        DynamicDataLoader.getDataClassFromDataType = (type: string) => {
            if (type === mockKnownType || extraKnownTypes.includes(type)) {
                return MockData as any;
            }
            return null;
        };
        DynamicDataLoader.getDataInstanceFromDataType = (type: string, payload: any) => {
            if (type === mockKnownType || extraKnownTypes.includes(type)) {
                if (invalidPayload?.(type, payload)) {
                    throw new Error('Invalid payload');
                }
                return { type, payload } as any;
            }
            throw new Error(`Class type of '${type}' is not in the store`);
        };
    };

    it('should remove unknown types from Event stats', () => {
        setupMock();
        const json = {
            stats: {
                [mockKnownType]: 123,
                [mockUnknownType]: 456
            }
        };
        const { sanitizedJson, unknownTypes, issues } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.stats[mockKnownType]).toBe(123);
        expect(sanitizedJson.stats[mockUnknownType]).toBeUndefined();
        expect(unknownTypes).toContain(mockUnknownType);
        expect(unknownTypes).not.toContain(mockKnownType);
        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'unknown_data_type',
                location: 'stats',
                path: `stats.${mockUnknownType}`,
                type: mockUnknownType
            })
        ]));
    });

    it('should remove unknown types from Activity stats', () => {
        setupMock();
        const json = {
            activities: [{
                stats: {
                    [mockKnownType]: 123,
                    [mockUnknownType]: 456
                }
            }]
        };
        const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.activities[0].stats[mockKnownType]).toBe(123);
        expect(sanitizedJson.activities[0].stats[mockUnknownType]).toBeUndefined();
        expect(unknownTypes).toContain(mockUnknownType);
    });

    it('should remove unknown types from Activity streams (Array)', () => {
        setupMock();
        const json = {
            activities: [{
                streams: [
                    { type: mockKnownType, values: [] },
                    { type: mockUnknownType, values: [] }
                ]
            }]
        };
        const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.activities[0].streams.length).toBe(1);
        expect(sanitizedJson.activities[0].streams[0].type).toBe(mockKnownType);
        expect(unknownTypes).toContain(mockUnknownType);
    });

    it('should remove unknown types from Activity streams (Object)', () => {
        setupMock();
        const json = {
            activities: [{
                streams: {
                    [mockKnownType]: [],
                    [mockUnknownType]: []
                }
            }]
        };
        const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.activities[0].streams[mockKnownType]).toBeDefined();
        expect(sanitizedJson.activities[0].streams[mockUnknownType]).toBeUndefined();
        expect(unknownTypes).toContain(mockUnknownType);
    });

    it('should handle null/undefined json gracefully', () => {
        const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(null);
        expect(sanitizedJson).toBeNull();
        expect(unknownTypes).toEqual([]);

        const { sanitizedJson: s2, unknownTypes: u2 } = EventJSONSanitizer.sanitize(undefined);
        expect(s2).toBeUndefined();
        expect(u2).toEqual([]);
    });

    it('should normalize generic type/data shape in Activity events', () => {
        setupMock();
        const json = {
            activities: [{
                events: [
                    {
                        type: mockKnownType,
                        data: { value: 42 }
                    }
                ]
            }]
        };

        const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.activities[0].events.length).toBe(1);
        expect(sanitizedJson.activities[0].events[0][mockKnownType]).toEqual({ value: 42 });
        expect(unknownTypes).toEqual([]);
    });

    it('should remove unknown types from Activity events', () => {
        setupMock();
        const json = {
            activities: [{
                events: [
                    { [mockKnownType]: { value: 1 } },
                    { [mockUnknownType]: { timestamp: 11 } }
                ]
            }]
        };

        const { sanitizedJson, unknownTypes, issues } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.activities[0].events.length).toBe(1);
        expect(sanitizedJson.activities[0].events[0][mockKnownType]).toBeDefined();
        expect(unknownTypes).toContain(mockUnknownType);
        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'unknown_data_type',
                location: 'events',
                path: 'activities[0].events[1].UnknownType',
                type: mockUnknownType
            })
        ]));
    });

    it('should normalize generic dataType/payload shape in Activity events', () => {
        setupMock();
        const json = {
            activities: [{
                events: [{ dataType: mockKnownType, payload: { value: 99 } }]
            }]
        };

        const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.activities[0].events.length).toBe(1);
        expect(sanitizedJson.activities[0].events[0][mockKnownType]).toEqual({ value: 99 });
        expect(unknownTypes).toEqual([]);
    });

    it('should prefer a recognized event key when object has mixed keys', () => {
        setupMock();
        const json = {
            activities: [{
                events: [{ timestamp: 15, [mockKnownType]: { value: 77 }, extra: true }]
            }]
        };

        const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.activities[0].events.length).toBe(1);
        expect(sanitizedJson.activities[0].events[0][mockKnownType]).toEqual({ value: 77 });
        expect(unknownTypes).toEqual([]);
    });

    it('should return empty array for non-array Activity events', () => {
        setupMock();
        const json = {
            activities: [{
                events: {
                    timestamp: 15,
                    [mockKnownType]: { value: 1 }
                }
            }]
        };

        const { sanitizedJson, issues } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.activities[0].events).toEqual([]);
        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'invalid_event_shape',
                location: 'events',
                path: 'activities[0].events'
            })
        ]));
    });

    it('should sanitize top-level Activity events for single activity payloads', () => {
        setupMock();
        const json = {
            events: [
                { [mockKnownType]: { value: 1 } },
                { timestamp: 123, jumpData: { distance: 4 } }
            ]
        };

        const { sanitizedJson, unknownTypes, issues } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.events).toEqual([{ [mockKnownType]: { value: 1 } }]);
        expect(unknownTypes).toContain('jumpData');
        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'invalid_event_shape',
                location: 'events',
                path: 'events[1]',
                type: 'jumpData'
            })
        ]));
    });

    it('should sanitize top-level Activity streams for single activity payloads', () => {
        setupMock();
        const json = {
            streams: [
                { type: mockKnownType, values: [1, 2] },
                { type: mockUnknownType, values: [3, 4] }
            ]
        };

        const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.streams).toEqual([{ type: mockKnownType, values: [1, 2] }]);
        expect(unknownTypes).toContain(mockUnknownType);
    });

    it('should remove duplicate stream types from top-level stream arrays', () => {
        setupMock();
        const json = {
            streams: [
                { type: mockKnownType, values: [1, 2] },
                { type: mockKnownType, values: [3, 4] }
            ]
        };

        const { sanitizedJson, issues } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.streams).toEqual([{ type: mockKnownType, values: [1, 2] }]);
        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'malformed_event_payload',
                location: 'streams',
                path: 'streams[1]',
                type: mockKnownType
            })
        ]));
    });

    it('should drop known event types with malformed payloads', () => {
        setupMock([], (type, payload) => type === mockKnownType && payload === undefined);
        const json = {
            events: [
                { [mockKnownType]: undefined }
            ]
        };

        const { sanitizedJson, unknownTypes, issues } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.events).toEqual([]);
        expect(unknownTypes).not.toContain(mockKnownType);
        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'malformed_event_payload',
                location: 'events',
                path: 'events[0].KnownType',
                type: mockKnownType
            })
        ]));
    });
});
