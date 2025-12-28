import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the sports-lib dependencies before importing the helper
vi.mock('@sports-alliance/sports-lib', () => ({
    DynamicDataLoader: {
        zoneStatsTypeMap: [
            {
                type: 'Heart Rate',
                stats: ['Zone1HR', 'Zone2HR', 'Zone3HR', 'Zone4HR', 'Zone5HR']
            }
        ]
    },
    ActivityUtilities: {
        getIntensityZonesStatsAggregated: vi.fn().mockReturnValue([
            { getType: () => 'Zone1HR', getValue: () => 1000 },
            { getType: () => 'Zone2HR', getValue: () => 2000 },
            { getType: () => 'Zone3HR', getValue: () => 3000 },
            { getType: () => 'Zone4HR', getValue: () => 4000 },
            { getType: () => 'Zone5HR', getValue: () => 5000 },
        ])
    }
}));

import { convertIntensityZonesStatsToChartData } from './intensity-zones-chart-data-helper';

describe('convertIntensityZonesStatsToChartData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should use full zone labels by default', () => {
        const result = convertIntensityZonesStatsToChartData([]);

        expect(result[0].zone).toBe('Zone 1');
        expect(result[1].zone).toBe('Zone 2');
        expect(result[2].zone).toBe('Zone 3');
        expect(result[3].zone).toBe('Zone 4');
        expect(result[4].zone).toBe('Zone 5');
    });

    it('should use full zone labels when shortLabels is false', () => {
        const result = convertIntensityZonesStatsToChartData([], false);

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

    it('should generate 5 entries per stat type', () => {
        const result = convertIntensityZonesStatsToChartData([]);

        // 5 zones for Heart Rate type
        expect(result.length).toBe(5);
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
