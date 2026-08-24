
import { describe, it, expect, afterEach } from 'vitest';
import { EventJSONSanitizer } from './event-json-sanitizer';
import {
    ActivityTypes,
    DynamicDataLoader,
    EventImporterJSON,
    LapTypes,
    UnitSystem,
} from '@sports-alliance/sports-lib';

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

    it('should remove unknown types from single Activity lap stats before hydration', () => {
        setupMock();
        const json = {
            name: 'Stored activity',
            startDate: 0,
            endDate: 60_000,
            type: ActivityTypes.Running,
            powerMeter: false,
            trainer: false,
            stats: {},
            streams: [],
            laps: [{
                startDate: 0,
                endDate: 60_000,
                type: LapTypes.Manual,
                stats: { [mockUnknownType]: 456 },
            }],
            creator: { name: 'test', devices: [] },
            intensityZones: [],
            events: [],
        };

        const { sanitizedJson, unknownTypes, issues } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.laps[0].stats[mockUnknownType]).toBeUndefined();
        expect(unknownTypes).toContain(mockUnknownType);
        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'unknown_data_type',
                location: 'stats',
                path: `laps[0].stats.${mockUnknownType}`,
                type: mockUnknownType,
            }),
        ]));

        DynamicDataLoader.getDataClassFromDataType = originalGetDataClass;
        DynamicDataLoader.getDataInstanceFromDataType = originalGetDataInstance;

        const activity = EventImporterJSON.getActivityFromJSON(sanitizedJson);
        expect(activity.getLaps()).toHaveLength(1);
    });

    it('should remove unknown types from embedded Activity lap stats', () => {
        setupMock();
        const json = {
            activities: [{
                laps: [{
                    stats: {
                        [mockKnownType]: 123,
                        [mockUnknownType]: 456,
                    },
                }],
            }],
        };

        const { sanitizedJson, unknownTypes, issues } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.activities[0].laps[0].stats[mockKnownType]).toBe(123);
        expect(sanitizedJson.activities[0].laps[0].stats[mockUnknownType]).toBeUndefined();
        expect(unknownTypes).toContain(mockUnknownType);
        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'unknown_data_type',
                location: 'stats',
                path: `activities[0].laps[0].stats.${mockUnknownType}`,
                type: mockUnknownType,
            }),
        ]));
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

    it('retains native dive gas and tank records for Sports Lib JSON hydration', () => {
        const diveSourceRecords = {
            gases: [{
                messageIndex: { value: 2, selected: true },
                oxygenContent: 32,
                heliumContent: 15,
                status: 'enabled',
                mode: 'open_circuit',
            }],
            tankSummaries: [{
                timestamp: 1787211300000,
                sensor: 3578158576,
                startPressure: 199.46,
                endPressure: 74.67,
                volumeUsed: 1396.01,
            }],
            tankUpdates: [{
                timestamp: 1787211360000,
                sensor: 3578158576,
                pressure: 198.4,
            }],
        };
        const { sanitizedJson, unknownTypes, issues } = EventJSONSanitizer.sanitize({
            name: 'Stored dive',
            startDate: 0,
            endDate: 60_000,
            type: ActivityTypes.ScubaDiving,
            powerMeter: false,
            trainer: false,
            stats: {},
            streams: [],
            laps: [],
            creator: { name: 'test', devices: [] },
            intensityZones: [],
            events: [],
            diveSourceRecords,
        });

        const activity = EventImporterJSON.getActivityFromJSON(sanitizedJson);

        expect(unknownTypes).toEqual([]);
        expect(issues).toEqual([]);
        expect(activity.getDiveSourceRecords()).toEqual({
            gases: diveSourceRecords.gases,
            tankSummaries: [{
                ...diveSourceRecords.tankSummaries[0],
                timestamp: new Date(diveSourceRecords.tankSummaries[0].timestamp),
            }],
            tankUpdates: [{
                ...diveSourceRecords.tankUpdates[0],
                timestamp: new Date(diveSourceRecords.tankUpdates[0].timestamp),
            }],
        });
        expect(activity.toJSON()).toEqual(expect.objectContaining({ diveSourceRecords }));
    });

    it('should retain Durability Evidence stats registered by the real sports-lib bundle', () => {
        // Keep the persisted type literal here and avoid importing DataDurabilityEvidence.
        // Importing the class could register it as a side effect and hide a bundle regression.
        const durabilityEvidenceType = 'Durability Evidence';
        const durabilityEvidence = {
            protocolVersion: 1,
            sourceFingerprint: 'durability-source-fingerprint',
            discipline: 'cycling',
            outputSource: 'power',
            outputUnit: 'W',
            durationSeconds: 3600,
            coverageRatio: 0.9,
            eligibility: {
                eligible: false,
                reason: 'insufficient-duration'
            }
        };
        const json = {
            stats: {
                [durabilityEvidenceType]: durabilityEvidence
            },
            activities: [{
                stats: {
                    [durabilityEvidenceType]: durabilityEvidence
                }
            }]
        };

        const registeredClass = DynamicDataLoader.getDataClassFromDataType(durabilityEvidenceType);
        const { sanitizedJson, unknownTypes, issues } = EventJSONSanitizer.sanitize(json);

        expect(registeredClass?.type).toBe(durabilityEvidenceType);
        expect(sanitizedJson.stats[durabilityEvidenceType]).toEqual(durabilityEvidence);
        expect(sanitizedJson.activities[0].stats[durabilityEvidenceType]).toEqual(durabilityEvidence);
        expect(unknownTypes).not.toContain(durabilityEvidenceType);
        expect(issues).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'unknown_data_type',
                type: durabilityEvidenceType
            })
        ]));
    });

    it('should retain Stroke Rate stats registered by the real sports-lib bundle', () => {
        // Keep the persisted type literal here so this verifies eager registry coverage.
        const strokeRateType = 'Stroke Rate';
        const json = {
            stats: { [strokeRateType]: 31 },
            activities: [{ stats: { [strokeRateType]: 32 } }],
        };

        const registeredClass = DynamicDataLoader.getDataClassFromDataType(strokeRateType);
        const { sanitizedJson, unknownTypes, issues } = EventJSONSanitizer.sanitize(json);

        expect(registeredClass?.type).toBe(strokeRateType);
        expect(sanitizedJson.stats[strokeRateType]).toBe(31);
        expect(sanitizedJson.activities[0].stats[strokeRateType]).toBe(32);
        expect(unknownTypes).not.toContain(strokeRateType);
        expect(issues).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'unknown_data_type',
                type: strokeRateType,
            }),
        ]));
    });

    it('should retain Metabolic Calories stats registered by the real sports-lib bundle', () => {
        // Keep the persisted type literal here so this verifies eager registry coverage.
        const metabolicCaloriesType = 'Metabolic Calories';
        const json = {
            stats: { [metabolicCaloriesType]: 412 },
            activities: [{ stats: { [metabolicCaloriesType]: 413 } }],
        };

        const registeredClass = DynamicDataLoader.getDataClassFromDataType(metabolicCaloriesType);
        const { sanitizedJson, unknownTypes, issues } = EventJSONSanitizer.sanitize(json);

        expect(registeredClass?.type).toBe(metabolicCaloriesType);
        expect(sanitizedJson.stats[metabolicCaloriesType]).toBe(412);
        expect(sanitizedJson.activities[0].stats[metabolicCaloriesType]).toBe(413);
        expect(unknownTypes).not.toContain(metabolicCaloriesType);
        expect(issues).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'unknown_data_type',
                type: metabolicCaloriesType,
            }),
        ]));
    });

    it('should retain Intensity lap stats registered by the real sports-lib bundle', () => {
        // Keep the persisted type literal here so this detects a registry regression.
        const intensityType = 'Intensity';
        const json = {
            name: 'Stored activity',
            startDate: 0,
            endDate: 60_000,
            type: ActivityTypes.Running,
            powerMeter: false,
            trainer: false,
            stats: {},
            streams: [],
            laps: [{
                startDate: 0,
                endDate: 60_000,
                type: LapTypes.Manual,
                stats: { [intensityType]: 'moderate' },
            }],
            creator: { name: 'test', devices: [] },
            intensityZones: [],
            events: [],
        };

        const registeredClass = DynamicDataLoader.getDataClassFromDataType(intensityType);
        const { sanitizedJson, unknownTypes, issues } = EventJSONSanitizer.sanitize(json);
        const activity = EventImporterJSON.getActivityFromJSON(sanitizedJson);

        expect(registeredClass?.type).toBe(intensityType);
        expect(sanitizedJson.laps[0].stats[intensityType]).toBe('moderate');
        expect(activity.getLaps()[0].getStat(intensityType)?.getValue()).toBe('moderate');
        expect(unknownTypes).not.toContain(intensityType);
        expect(issues).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'unknown_data_type',
                type: intensityType,
            }),
        ]));
    });

    it('should retain Three Dimensional Strain Evidence stats registered by the real sports-lib bundle', () => {
        // Keep the persisted type literal here and avoid importing the data class. Importing it
        // could register the type as a side effect and hide a production bundle regression.
        const strainEvidenceType = 'Three Dimensional Strain Evidence';
        const strainEvidence = {
            protocolVersion: 2,
            sourceFingerprint: 'three-dimensional-strain-v2:0000000000000001',
            activityType: 'Rowing',
            activityGroup: 'Water sports',
            eligibility: { eligible: false, reason: 'insufficient-curve-points' },
            input: {
                powerSampleCount: 3600,
                validPowerSampleCount: 3600,
                candidateDurationSeconds: 3600,
                recordedDurationSeconds: 3600,
                coverageRatio: 1,
                curvePointCount: 4,
                hasShortDuration: true,
                hasMediumDuration: false,
                hasLongDuration: false,
            },
            fit: null,
            evidence: null,
        };
        const json = {
            stats: { [strainEvidenceType]: strainEvidence },
            activities: [{ stats: { [strainEvidenceType]: strainEvidence } }],
        };

        const registeredClass = DynamicDataLoader.getDataClassFromDataType(strainEvidenceType);
        const { sanitizedJson, unknownTypes, issues } = EventJSONSanitizer.sanitize(json);

        expect(registeredClass?.type).toBe(strainEvidenceType);
        expect(sanitizedJson.stats[strainEvidenceType]).toEqual(strainEvidence);
        expect(sanitizedJson.activities[0].stats[strainEvidenceType]).toEqual(strainEvidence);
        expect(unknownTypes).not.toContain(strainEvidenceType);
        expect(issues).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'unknown_data_type',
                type: strainEvidenceType,
            }),
        ]));
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

    it('should remove duplicate stream array entries by canonical alias type', () => {
        setupMock(['LegacyKnownType']);
        const json = {
            streams: [
                { type: 'LegacyKnownType', values: [1, 2] },
                { type: mockKnownType, values: [3, 4] }
            ]
        };

        const { sanitizedJson, issues } = EventJSONSanitizer.sanitize(json);

        expect(sanitizedJson.streams).toEqual([{ type: 'LegacyKnownType', values: [1, 2] }]);
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
