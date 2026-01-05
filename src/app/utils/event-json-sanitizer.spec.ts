
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

    afterEach(() => {
        // Restore original method
        DynamicDataLoader.getDataClassFromDataType = originalGetDataClass;
    });

    // Helper to setup mock
    const setupMock = () => {
        DynamicDataLoader.getDataClassFromDataType = (type: string) => {
            if (type === mockKnownType) {
                return MockData as any;
            }
            return null;
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
        const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.stats[mockKnownType]).toBe(123);
        expect(sanitizedJson.stats[mockUnknownType]).toBeUndefined();
        expect(unknownTypes).toContain(mockUnknownType);
        expect(unknownTypes).not.toContain(mockKnownType);
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
});
