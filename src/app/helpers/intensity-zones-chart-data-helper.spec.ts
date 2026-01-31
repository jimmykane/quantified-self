import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ActivityUtilities } from '@sports-alliance/sports-lib';
import { convertIntensityZonesStatsToChartData, getActiveDataTypes } from './intensity-zones-chart-data-helper';

// Mock the sports-lib dependencies
vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sports-alliance/sports-lib')>();
    return {
        ...actual,
        DynamicDataLoader: {
            ...actual.DynamicDataLoader,
            zoneStatsTypeMap: [
                {
                    type: 'Heart Rate',
                    stats: ['Zone1HR', 'Zone2HR', 'Zone3HR', 'Zone4HR', 'Zone5HR', 'Zone6HR', 'Zone7HR']
                }
            ]
        },
        ActivityUtilities: {
            ...actual.ActivityUtilities,
            getIntensityZonesStatsAggregated: vi.fn(),
        }
    };
});

describe('convertIntensityZonesStatsToChartData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default mock implementation
        vi.mocked(ActivityUtilities.getIntensityZonesStatsAggregated).mockReturnValue([
            { getType: () => 'Zone1HR', getValue: () => 1000 },
            { getType: () => 'Zone2HR', getValue: () => 2000 },
            { getType: () => 'Zone3HR', getValue: () => 3000 },
            { getType: () => 'Zone4HR', getValue: () => 4000 },
            { getType: () => 'Zone5HR', getValue: () => 5000 },
            { getType: () => 'Zone6HR', getValue: () => 0 },
            { getType: () => 'Zone7HR', getValue: () => 0 },
        ] as any);
    });

    it('should use full zone labels by default', () => {
        const result = convertIntensityZonesStatsToChartData([]);

        expect(result[0].zone).toBe('Zone 1');
        expect(result[1].zone).toBe('Zone 2');
        expect(result[2].zone).toBe('Zone 3');
        expect(result[3].zone).toBe('Zone 4');
        expect(result[4].zone).toBe('Zone 5');
    });

    it('should use short zone labels when shortLabels is true', () => {
        const result = convertIntensityZonesStatsToChartData([], true);

        expect(result[0].zone).toBe('Z1');
        expect(result[1].zone).toBe('Z2');
        expect(result[2].zone).toBe('Z3');
        expect(result[3].zone).toBe('Z4');
        expect(result[4].zone).toBe('Z5');
    });

    it('should generate entries only for stats with non-zero values', () => {
        const result = convertIntensityZonesStatsToChartData([]);
        // Only 5 zones have non-zero values in the mock (Zone1HR to Zone5HR)
        expect(result.length).toBe(5);
        expect(result.find(e => e.zone === 'Zone 6')).toBeUndefined();
        expect(result.find(e => e.zone === 'Zone 7')).toBeUndefined();
    });

    it('should include 7 zones if they all have values', () => {
        vi.mocked(ActivityUtilities.getIntensityZonesStatsAggregated).mockReturnValue([
            { getType: () => 'Zone1HR', getValue: () => 1000 },
            { getType: () => 'Zone2HR', getValue: () => 2000 },
            { getType: () => 'Zone3HR', getValue: () => 3000 },
            { getType: () => 'Zone4HR', getValue: () => 4000 },
            { getType: () => 'Zone5HR', getValue: () => 5000 },
            { getType: () => 'Zone6HR', getValue: () => 6000 },
            { getType: () => 'Zone7HR', getValue: () => 7000 },
        ] as any);

        const result = convertIntensityZonesStatsToChartData([]);
        expect(result.length).toBe(7);
        expect(result.find(e => e.zone === 'Zone 6')).toBeDefined();
        expect(result.find(e => e.zone === 'Zone 7')).toBeDefined();
    });

    it('should include type field in each entry', () => {
        const result = convertIntensityZonesStatsToChartData([]);

        result.forEach(entry => {
            expect(entry.type).toBe('Heart Rate');
        });
    });

    it('should include stat values in each entry', () => {
        const result = convertIntensityZonesStatsToChartData([]);

        expect(result[0]['Heart Rate']).toBe(1000);
        expect(result[1]['Heart Rate']).toBe(2000);
        expect(result[2]['Heart Rate']).toBe(3000);
        expect(result[3]['Heart Rate']).toBe(4000);
        expect(result[4]['Heart Rate']).toBe(5000);
    });
});

describe('getActiveDataTypes', () => {
    it('should return empty set for empty data', () => {
        expect(getActiveDataTypes([]).size).toBe(0);
    });

    it('should return valid types with non-zero values', () => {
        const data = [
            { type: 'Heart Rate', 'Heart Rate': 100 },
            { type: 'Speed', 'Speed': 0 },
            { type: 'Power', 'Power': 50 }
        ];
        const result = getActiveDataTypes(data);
        expect(result.has('Heart Rate')).toBe(true);
        expect(result.has('Power')).toBe(true);
        expect(result.has('Speed')).toBe(false);
    });

    it('should return empty set if all values are 0', () => {
        const data = [
            { type: 'Heart Rate', 'Heart Rate': 0 },
            { type: 'Speed', 'Speed': 0 }
        ];
        const result = getActiveDataTypes(data);
        expect(result.size).toBe(0);
    });
});
