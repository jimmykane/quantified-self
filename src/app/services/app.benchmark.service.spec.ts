import { TestBed } from '@angular/core/testing';
import { AppBenchmarkService } from './app.benchmark.service';
import { ActivityInterface, DataGradeAdjustedSpeed } from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';

// Polyfill crypto for JSDOM environment
if (!globalThis.crypto || !globalThis.crypto.subtle) {
    Object.defineProperty(globalThis, 'crypto', {
        value: webcrypto,
        configurable: true,
        enumerable: true,
        writable: true
    });
}

describe('AppBenchmarkService', () => {
    let service: AppBenchmarkService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [AppBenchmarkService]
        });
        service = TestBed.inject(AppBenchmarkService);
        vi.clearAllMocks();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('generateBenchmark', () => {
        it('should throw an error if activities do not overlap', async () => {
            const actA = {
                getID: () => 'actA',
                startDate: new Date('2023-01-01T10:00:00Z'),
                endDate: new Date('2023-01-01T11:00:00Z'),
            } as ActivityInterface;
            const actB = {
                getID: () => 'actB',
                startDate: new Date('2023-01-01T12:00:00Z'),
                endDate: new Date('2023-01-01T13:00:00Z'),
            } as ActivityInterface;

            await expect(service.generateBenchmark(actA, actB)).rejects.toThrow('Activities do not overlap in time.');
        });

        it('should generate a benchmark for overlapping activities with common streams', async () => {
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:00:05Z'); // 5 seconds overlap

            const mockStreamA = [100, 105, 110, 115, 120, 125];
            const mockStreamB = [102, 107, 112, 117, 122, 127];

            const actA = {
                getID: () => 'actA',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'HeartRate' }],
                getStreamData: (type: string) => type === 'HeartRate' ? mockStreamA : (type === 'Latitude' || type === 'Longitude' ? [0, 0, 0, 0, 0] : []),
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
                hasStreamData: () => true
            } as unknown as ActivityInterface;

            const actB = {
                getID: () => 'actB',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'HeartRate' }],
                getStreamData: (type: string) => type === 'HeartRate' ? mockStreamB : (type === 'Latitude' || type === 'Longitude' ? [0, 0, 0, 0, 0] : []),
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
                hasStreamData: () => true
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(actA, actB);

            expect(result.referenceId).toBe('actA');
            expect(result.testId).toBe('actB');
            expect(result.metrics.streamMetrics['HeartRate']).toBeDefined();
            // HeartRate difference is constant (-2), so pearson should be 1
            expect(result.metrics.streamMetrics['HeartRate'].pearsonCorrelation).toBe(1);
        });

        it('should handle activities with GNSS data', async () => {
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:00:02Z');

            const actA = {
                getID: () => 'actA',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'Latitude' }, { type: 'Longitude' }],
                getStreamData: (type: string) => {
                    if (type === 'Latitude') return [40.0, 40.001, 40.002];
                    if (type === 'Longitude') return [-74.0, -74.001, -74.002];
                    return [];
                },
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const actB = {
                getID: () => 'actB',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'Latitude' }, { type: 'Longitude' }],
                getStreamData: (type: string) => {
                    if (type === 'Latitude') return [40.0, 40.0012, 40.0022];
                    if (type === 'Longitude') return [-74.0, -74.0012, -74.0022];
                    return [];
                },
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(actA, actB);

            expect(result.metrics.gnss.cep50).toBeDefined();
            expect(result.metrics.gnss.cep95).toBeDefined();
            expect(result.metrics.gnss.rmse).toBeGreaterThan(0);
            expect(result.diffStreams!.gnssDeviation.length).toBeGreaterThan(0);
        });

        it('should calculate correct Haversine distance', async () => {
            // Test known Haversine distance
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:00:01Z');

            const actA = {
                getID: () => 'actA',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'Latitude' }, { type: 'Longitude' }],
                getStreamData: (type: string) => {
                    if (type === 'Latitude') return [0, 0];
                    if (type === 'Longitude') return [0, 0];
                    return [];
                },
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const actB = {
                getID: () => 'actB',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'Latitude' }, { type: 'Longitude' }],
                getStreamData: (type: string) => {
                    // 0.001 degrees ~ 111 meters at equator
                    if (type === 'Latitude') return [0.001, 0.001];
                    if (type === 'Longitude') return [0, 0];
                    return [];
                },
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(actA, actB);

            // Expect ~111 meters deviation
            expect(result.metrics.gnss.cep50).toBeGreaterThan(100);
            expect(result.metrics.gnss.cep50).toBeLessThan(120);
        });

        it('should log iterations for long activities', async () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:20:00Z'); // 20 minutes = 1200 iterations

            const act = {
                getID: () => 'longAct',
                startDate,
                endDate,
                getAllStreams: () => [],
                getStreamData: () => [],
                getDateIndex: () => 0,
            } as unknown as ActivityInterface;

            await service.generateBenchmark(act, act);

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Iteration 1000'));
            consoleSpy.mockRestore();
        });
    });

    describe('Helper Methods', () => {
        it('mean should calculate average', () => {
            expect((service as any).mean([1, 2, 3, 4, 5])).toBe(3);
        });

        it('mean should handle single value', () => {
            expect((service as any).mean([10])).toBe(10);
        });

        it('meanAbsoluteError should calculate MAE', () => {
            expect((service as any).meanAbsoluteError([10, 20], [12, 18])).toBe(2);
        });

        it('meanAbsoluteError should return 0 for identical arrays', () => {
            expect((service as any).meanAbsoluteError([1, 2, 3], [1, 2, 3])).toBe(0);
        });

        it('rmse should calculate RMSE', () => {
            // sqrt(( (10-12)^2 + (20-18)^2 ) / 2) = sqrt((4 + 4) / 2) = sqrt(4) = 2
            expect((service as any).rmse([10, 20], [12, 18])).toBe(2);
        });

        it('rmse should return 0 for identical arrays', () => {
            expect((service as any).rmse([5, 10, 15], [5, 10, 15])).toBe(0);
        });

        it('pearsonCorrelation should return 1 for perfect positive correlation', () => {
            expect((service as any).pearsonCorrelation([1, 2, 3], [1, 2, 3])).toBe(1);
        });

        it('pearsonCorrelation should return -1 for perfect negative correlation', () => {
            expect((service as any).pearsonCorrelation([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
        });

        it('pearsonCorrelation should return ~0 for uncorrelated data', () => {
            // Perfectly uncorrelated data
            expect(Math.abs((service as any).pearsonCorrelation([1, 2, 3, 4], [2, 4, 1, 3]))).toBeLessThan(0.5);
        });

        it('pearsonCorrelation should handle zero variance', () => {
            const result = (service as any).pearsonCorrelation([1, 1, 1], [1, 1, 1]);
            expect(isNaN(result)).toBe(true); // Division by zero
        });

        it('getPositionAtTime should return null if no stream data', () => {
            const act = {
                getDateIndex: () => 0,
                getStreamData: () => null,
                getAllStreams: () => [{ type: 'Latitude' }, { type: 'Longitude' }]
            } as any;
            expect((service as any).getPositionAtTime(act, new Date())).toBeNull();
        });

        it('getPositionAtTime should return null if index out of bounds', () => {
            const act = {
                getDateIndex: () => 10,
                getStreamData: () => [0, 1, 2],
                getAllStreams: () => [{ type: 'Latitude' }, { type: 'Longitude' }]
            } as any;
            expect((service as any).getPositionAtTime(act, new Date())).toBeNull();
        });

        it('getPositionAtTime should return null if lat/lng is null', () => {
            const act = {
                getDateIndex: () => 0,
                getStreamData: (type: string) => type === 'Latitude' ? [null] : [0],
                getAllStreams: () => [{ type: 'Latitude' }, { type: 'Longitude' }]
            } as any;
            expect((service as any).getPositionAtTime(act, new Date())).toBeNull();
        });

        it('getValueAtTime should return null if index is -1', () => {
            const act = {
                getDateIndex: () => -1
            } as any;
            expect((service as any).getValueAtTime(act, 'HeartRate', new Date())).toBeNull();
        });

        it('getValueAtTime should return null if stream is empty', () => {
            const act = {
                getDateIndex: () => 0,
                getStreamData: () => null
            } as any;
            expect((service as any).getValueAtTime(act, 'HeartRate', new Date())).toBeNull();
        });

        it('getValueAtTime should return null if index out of bounds', () => {
            const act = {
                getDateIndex: () => 5,
                getStreamData: () => [1, 2, 3]
            } as any;
            expect((service as any).getValueAtTime(act, 'HeartRate', new Date())).toBeNull();
        });

        it('getValueAtTime should return correct value at index', () => {
            const act = {
                getDateIndex: () => 1,
                getStreamData: () => [100, 110, 120]
            } as any;
            expect((service as any).getValueAtTime(act, 'HeartRate', new Date())).toBe(110);
        });
    });

    describe('Haversine Distance', () => {
        it('should return 0 for identical coordinates', () => {
            const result = (service as any).haversineDistance(40.7128, -74.0060, 40.7128, -74.0060);
            expect(result).toBe(0);
        });

        it('should calculate ~111km for 1 degree latitude at equator', () => {
            const result = (service as any).haversineDistance(0, 0, 1, 0);
            // 1 degree latitude ≈ 111.32 km
            expect(result).toBeGreaterThan(110000);
            expect(result).toBeLessThan(112000);
        });

        it('should calculate ~111m for 0.001 degrees latitude at equator', () => {
            const result = (service as any).haversineDistance(0, 0, 0.001, 0);
            // 0.001 degree latitude ≈ 111 meters
            expect(result).toBeGreaterThan(100);
            expect(result).toBeLessThan(120);
        });

        it('should handle longitude wrapping (cross dateline)', () => {
            const result = (service as any).haversineDistance(0, 179, 0, -179);
            // Distance should be ~222km (2 degrees longitude at equator)
            expect(result).toBeLessThan(250000);
        });

        it('should handle known distance (NYC to LA ~3935km)', () => {
            // NYC: 40.7128° N, 74.0060° W,  LA: 34.0522° N, 118.2437° W
            const result = (service as any).haversineDistance(40.7128, -74.0060, 34.0522, -118.2437);
            // Should be approximately 3930-3940km
            expect(result / 1000).toBeGreaterThan(3900);
            expect(result / 1000).toBeLessThan(4000);
        });
    });

    describe('Excluded Stream Types', () => {
        it('should exclude derived metrics from benchmark', async () => {
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:00:02Z');

            const act = {
                getID: () => 'act',
                creator: { name: 'Test Device' },
                startDate,
                endDate,
                getAllStreams: () => [
                    { type: 'HeartRate' },
                    { type: 'Speed' },
                    { type: 'Pace' },           // Should be excluded
                    { type: 'Grade' },          // Should be excluded
                    { type: DataGradeAdjustedSpeed.type }, // Should be excluded
                    { type: 'Latitude' },       // Excluded (handled by GNSS)
                    { type: 'Longitude' },      // Excluded (handled by GNSS)
                ],
                getStreamData: (type: string) => {
                    if (type === 'HeartRate') return [120, 122, 124];
                    if (type === 'Speed') return [3.5, 3.6, 3.7];
                    if (type === 'Pace') return [4.0, 4.1, 4.2];
                    if (type === 'Grade') return [1, 2, 3];
                    if (type === DataGradeAdjustedSpeed.type) return [3.8, 3.9, 4.0];
                    if (type === 'Latitude') return [40, 40.001, 40.002];
                    if (type === 'Longitude') return [-74, -74.001, -74.002];
                    return [];
                },
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(act, act);

            // Only HeartRate and Speed should be included
            expect(result.metrics.streamMetrics['HeartRate']).toBeDefined();
            expect(result.metrics.streamMetrics['Speed']).toBeDefined();

            // Excluded types should NOT be in streamMetrics
            expect(result.metrics.streamMetrics['Pace']).toBeUndefined();
            expect(result.metrics.streamMetrics['Grade']).toBeUndefined();
            expect(result.metrics.streamMetrics[DataGradeAdjustedSpeed.type]).toBeUndefined();
            expect(result.metrics.streamMetrics['Latitude']).toBeUndefined();
            expect(result.metrics.streamMetrics['Longitude']).toBeUndefined();
        });
    });

    describe('Device Names', () => {
        it('should include device names in benchmark result', async () => {
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:00:02Z');

            const actA = {
                getID: () => 'actA',
                creator: { name: 'Garmin Forerunner 265' },
                startDate,
                endDate,
                getAllStreams: () => [],
                getStreamData: () => [],
                getDateIndex: () => 0,
            } as unknown as ActivityInterface;

            const actB = {
                getID: () => 'actB',
                creator: { name: 'COROS PACE 3' },
                startDate,
                endDate,
                getAllStreams: () => [],
                getStreamData: () => [],
                getDateIndex: () => 0,
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(actA, actB);

            expect(result.referenceName).toBe('Garmin Forerunner 265');
            expect(result.testName).toBe('COROS PACE 3');
        });

        it('should use fallback names when creator is missing', async () => {
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:00:02Z');

            const act = {
                getID: () => 'act',
                startDate,
                endDate,
                getAllStreams: () => [],
                getStreamData: () => [],
                getDateIndex: () => 0,
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(act, act);

            expect(result.referenceName).toBe('Device A');
            expect(result.testName).toBe('Device B');
        });
    });

    describe('GNSS Metrics Calculation', () => {
        it('should calculate total distance difference', async () => {
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:00:02Z');

            const actA = {
                getID: () => 'actA',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'Latitude' }, { type: 'Longitude' }, { type: 'Distance' }],
                getStreamData: (type: string) => {
                    if (type === 'Latitude') return [40.0, 40.001, 40.002];
                    if (type === 'Longitude') return [-74.0, -74.001, -74.002];
                    if (type === 'Distance') return [0, 100, 200]; // 200m total
                    return [];
                },
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const actB = {
                getID: () => 'actB',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'Latitude' }, { type: 'Longitude' }, { type: 'Distance' }],
                getStreamData: (type: string) => {
                    if (type === 'Latitude') return [40.0, 40.001, 40.002];
                    if (type === 'Longitude') return [-74.0, -74.001, -74.002];
                    if (type === 'Distance') return [0, 110, 230]; // 230m total
                    return [];
                },
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(actA, actB);

            // Total distance difference should be |200 - 230| = 30m
            expect(result.metrics.gnss.totalDistanceDifference).toBe(30);
        });

        it('should handle missing distance stream gracefully', async () => {
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:00:02Z');

            const act = {
                getID: () => 'act',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'Latitude' }, { type: 'Longitude' }],
                getStreamData: (type: string) => {
                    if (type === 'Latitude') return [40.0, 40.001, 40.002];
                    if (type === 'Longitude') return [-74.0, -74.001, -74.002];
                    return null;
                },
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(act, act);

            expect(result.metrics.gnss.totalDistanceDifference).toBe(0);
        });

        it('should compute CEP50, CEP95, and maxDeviation correctly', async () => {
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:00:04Z'); // 5 seconds

            const actA = {
                getID: () => 'actA',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'Latitude' }, { type: 'Longitude' }],
                getStreamData: (type: string) => {
                    if (type === 'Latitude') return [0, 0, 0, 0, 0];
                    if (type === 'Longitude') return [0, 0, 0, 0, 0];
                    return [];
                },
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const actB = {
                getID: () => 'actB',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'Latitude' }, { type: 'Longitude' }],
                getStreamData: (type: string) => {
                    // Different points with increasing deviation
                    if (type === 'Latitude') return [0.0001, 0.0002, 0.0003, 0.0004, 0.0005];
                    if (type === 'Longitude') return [0, 0, 0, 0, 0];
                    return [];
                },
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(actA, actB);

            // Deviations are sorted, so CEP50 should be the middle value
            expect(result.metrics.gnss.cep50).toBeGreaterThan(0);
            expect(result.metrics.gnss.cep95).toBeGreaterThan(result.metrics.gnss.cep50);
            // With small datasets, CEP95 and maxDeviation can be the same index
            expect(result.metrics.gnss.maxDeviation).toBeGreaterThanOrEqual(result.metrics.gnss.cep95);
            expect(result.metrics.gnss.rmse).toBeGreaterThan(0);

        });
    });

    describe('Edge Cases', () => {
        it('should handle activities with minimal overlap (1 second)', async () => {
            const actA = {
                getID: () => 'actA',
                startDate: new Date('2023-01-01T10:00:00Z'),
                endDate: new Date('2023-01-01T10:00:01Z'),
                getAllStreams: () => [{ type: 'HeartRate' }],
                getStreamData: () => [100, 110],
                getDateIndex: () => 0,
            } as unknown as ActivityInterface;

            const actB = {
                getID: () => 'actB',
                startDate: new Date('2023-01-01T10:00:00Z'),
                endDate: new Date('2023-01-01T10:00:01Z'),
                getAllStreams: () => [{ type: 'HeartRate' }],
                getStreamData: () => [100, 110],
                getDateIndex: () => 0,
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(actA, actB);
            expect(result).toBeDefined();
            expect(result.diffStreams!.time.length).toBeLessThanOrEqual(2);
        });

        it('should handle activities with no common streams', async () => {
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:00:02Z');

            const actA = {
                getID: () => 'actA',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'HeartRate' }],
                getStreamData: () => [100, 110, 120],
                getDateIndex: () => 0,
            } as unknown as ActivityInterface;

            const actB = {
                getID: () => 'actB',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'Power' }],
                getStreamData: () => [200, 210, 220],
                getDateIndex: () => 0,
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(actA, actB);

            expect(Object.keys(result.metrics.streamMetrics).length).toBe(0);
        });
    });

    describe('Auto Alignment', () => {
        it('should detect and apply time offset when autoAlignTime is true', async () => {
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:05:00Z'); // 5 mins

            // Create reference speed data
            const refSpeed = Array.from({ length: 300 }, (_, i) => Math.sin(i / 10) + 5);

            // Create test speed data shifted by +5 seconds (Test is late)
            // If Test is late, it means Test[t] matches Ref[t-5].
            // Or Ref[t] matches Test[t+5].
            // The algorithm searches offset. If offset=5, it means Test[t-5] matches Ref[t].
            // So if Test is late (shifted right), Test[t] is Ref[t-5].
            // So Test[5] matches Ref[0].
            const testSpeed = new Array(300).fill(0);
            for (let i = 0; i < 300; i++) {
                if (i >= 5) testSpeed[i] = refSpeed[i - 5];
            }

            const actA = {
                getID: () => 'actA',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'Speed' }],
                getStreamData: (type: string) => type === 'Speed' ? refSpeed : [],
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const actB = {
                getID: () => 'actB',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'Speed' }],
                getStreamData: (type: string) => type === 'Speed' ? testSpeed : [],
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(actA, actB, { autoAlignTime: true });

            expect(result.alignmentApplied).toBe(true);
            // We expect offset to be around -5.
            expect(result.timeOffsetSeconds).toBe(-5);
        });

        it('should NOT apply offset if autoAlignTime is false', async () => {
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:05:00Z');
            const refSpeed = Array.from({ length: 300 }, (_, i) => Math.sin(i / 10) + 5);
            const testSpeed = new Array(300).fill(0);
            for (let i = 0; i < 300; i++) {
                if (i >= 5) testSpeed[i] = refSpeed[i - 5];
            }

            const actA = {
                getID: () => 'actA',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'Speed' }],
                getStreamData: (type: string) => type === 'Speed' ? refSpeed : [],
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const actB = {
                getID: () => 'actB',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'Speed' }],
                getStreamData: (type: string) => type === 'Speed' ? testSpeed : [],
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(actA, actB, { autoAlignTime: false });

            expect(result.alignmentApplied).toBe(false);
            expect(result.timeOffsetSeconds).toBe(0);
        });
    });

    describe('Quality Issue Detection', () => {
        it('should detect signal dropouts', async () => {
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:01:00Z'); // 1 min

            // 60 seconds of data. 0-10 OK, 11-20 Dropout (0), 21-60 OK
            const hrData = Array.from({ length: 60 }, (_, i) => (i > 10 && i <= 20) ? 0 : 140);

            const act = {
                getID: () => 'act',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'HeartRate' }],
                getStreamData: (type: string) => type === 'HeartRate' ? hrData : [],
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            // We can test this via private method access or full benchmark
            // Let's use full benchmark against itself (comparison irrelevant, looking for issues)
            const result = await service.generateBenchmark(act, act);

            expect(result.qualityIssues).toBeDefined();
            const dropout = result.qualityIssues!.find(i => i.type === 'dropout');
            expect(dropout).toBeDefined();
            expect(dropout!.streamType).toBe('HeartRate');
            expect(dropout!.duration).toBe(10);
        });

        it('should detect stuck values', async () => {
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:02:00Z');

            // 120 seconds. 0-19 OK, 20-84 Stuck at 150, 85-119 OK
            // 65 seconds of stuck values (threshold is 60)
            const hrData = Array.from({ length: 120 }, (_, i) => {
                if (i >= 20 && i < 85) return 150; // 65 seconds stuck
                return 140 + (i % 5);
            });

            const act = {
                getID: () => 'act',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'HeartRate' }],
                getStreamData: (type: string) => type === 'HeartRate' ? hrData : [],
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(act, act);

            const stuck = result.qualityIssues!.find(i => i.type === 'stuck');
            expect(stuck).toBeDefined();
            expect(stuck!.streamType).toBe('HeartRate');
            expect(stuck!.duration).toBe(64);
        });

        it('should detect cadence lock', async () => {
            const startDate = new Date('2023-01-01T10:00:00Z');
            const endDate = new Date('2023-01-01T10:02:00Z'); // 2 mins

            // 120 seconds. Highly correlated HR and Cadence
            const hrData = Array.from({ length: 120 }, (_, i) => 160 + (i % 5));
            const cadData = Array.from({ length: 120 }, (_, i) => 160 + (i % 5)); // Identical pattern

            const act = {
                getID: () => 'act',
                startDate,
                endDate,
                getAllStreams: () => [{ type: 'HeartRate' }, { type: 'Cadence' }],
                getStreamData: (type: string) => {
                    if (type === 'HeartRate') return hrData;
                    if (type === 'Cadence') return cadData;
                    return [];
                },
                getDateIndex: (date: Date) => Math.floor((date.getTime() - startDate.getTime()) / 1000),
            } as unknown as ActivityInterface;

            const result = await service.generateBenchmark(act, act);

            const lock = result.qualityIssues!.find(i => i.type === 'cadence_lock');
            expect(lock).toBeDefined();
            expect(lock!.streamType).toBe('HeartRate');
        });
    });
});

