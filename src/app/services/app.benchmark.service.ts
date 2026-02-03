import { Injectable } from '@angular/core';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { DataPositionInterface } from '@sports-alliance/sports-lib';
import { BenchmarkResult } from '../../../functions/src/shared/app-event.interface';

@Injectable({
    providedIn: 'root'
})
export class AppBenchmarkService {

    /**
     * Stream types to exclude from per-point benchmarking.
     * These are either:
     * - Handled separately (GNSS position streams)
     * - Derived/calculated rather than raw sensor data
     * - Cumulative totals (not suitable for per-point comparison)
     */
    private static readonly EXCLUDED_STREAM_TYPES = new Set([
        'Latitude',           // Handled by GNSS comparison
        'Longitude',          // Handled by GNSS comparison
        'Distance',           // Compared as totalDistanceDifference in GNSS metrics
        'Grade',              // Derived from altitude + distance
        'GradeAdjustedSpeed', // Calculated from speed + grade
        'VerticalSpeed',      // Derived from altitude changes
        'Pace',               // Inverse of speed (redundant)
        'SWOLF',              // Calculated (strokes + time)
        'FormPower',          // Algorithm-based (Stryd-specific)
        'RunningEconomy',     // Calculated metric
        'ElevationGain',      // Cumulative total
        'ElevationLoss',      // Cumulative total
    ]);

    constructor() { }

    /**
     * Generates a comprehensive benchmark report comparing two activities.
     * Assumes activities are from the same event (overlapping time).
     */
    public async generateBenchmark(reference: ActivityInterface, test: ActivityInterface): Promise<BenchmarkResult> {
        console.log('AppBenchmarkService: generateBenchmark started', { referenceId: reference.getID(), testId: test.getID() });
        // 1. alignment
        const startA = reference.startDate.getTime();
        const endA = reference.endDate.getTime();
        const startB = test.startDate.getTime();
        const endB = test.endDate.getTime();

        const sharedStart = Math.max(startA, startB);
        const sharedEnd = Math.min(endA, endB);

        console.log('AppBenchmarkService: overlaps', { sharedStart, sharedEnd, diff: sharedEnd - sharedStart });

        if (sharedEnd <= sharedStart) {
            console.error('AppBenchmarkService: No overlap found');
            throw new Error('Activities do not overlap in time.');
        }

        // 2. Setup Result Skeleton
        const result: BenchmarkResult = {
            referenceId: reference.getID() || 'unknown_ref',
            testId: test.getID() || 'unknown_test',
            referenceName: reference.creator?.name || 'Device A',
            testName: test.creator?.name || 'Device B',
            timestamp: new Date(),
            metrics: {
                gnss: { cep50: 0, cep95: 0, maxDeviation: 0, rmse: 0, totalDistanceDifference: 0 },
                streamMetrics: {}
            },
            diffStreams: {
                time: [],
                gnssDeviation: []
            }
        };

        // 3. Identify Common Streams (excluding derived/calculated types)
        const streamsA = reference.getAllStreams().map(s => s.type);
        const streamsB = test.getAllStreams().map(s => s.type);
        const commonTypes = streamsA.filter(type =>
            streamsB.includes(type) &&
            !AppBenchmarkService.EXCLUDED_STREAM_TYPES.has(type)
        );

        // Initialize diff streams for common types
        commonTypes.forEach(type => result.diffStreams![type] = []);

        const gnssDeviations: number[] = [];
        const streamValues: { [type: string]: { a: number[], b: number[] } } = {};
        commonTypes.forEach(type => streamValues[type] = { a: [], b: [] });

        // 4. Co-Stream Iteration (1 second resolution)
        // We iterate by 1000ms steps
        let iteration = 0;
        for (let t = sharedStart; t <= sharedEnd; t += 1000) {
            iteration++;
            if (iteration % 1000 === 0) {
                console.log(`AppBenchmarkService: Iteration ${iteration}, t=${t}`);
            }
            const date = new Date(t);

            // GNSS Comparison
            const posA = this.getPositionAtTime(reference, date);
            const posB = this.getPositionAtTime(test, date);

            if (posA && posB) {
                const deviation = this.haversineDistance(posA.latitudeDegrees, posA.longitudeDegrees, posB.latitudeDegrees, posB.longitudeDegrees);
                gnssDeviations.push(deviation);
                result.diffStreams!.gnssDeviation.push(deviation);
                result.diffStreams!.time.push(t);
            }

            // Stream Comparisons
            commonTypes.forEach(type => {
                const valA = this.getValueAtTime(reference, type, date);
                const valB = this.getValueAtTime(test, type, date);

                if (valA !== null && valB !== null) {
                    const diff = valA - valB;
                    result.diffStreams![type].push(diff);

                    streamValues[type].a.push(valA);
                    streamValues[type].b.push(valB);
                }
            });
        }

        // 5. Calculate GNSS Metrics
        if (gnssDeviations.length > 0) {
            gnssDeviations.sort((a, b) => a - b);
            result.metrics.gnss.cep50 = gnssDeviations[Math.floor(gnssDeviations.length * 0.50)];
            result.metrics.gnss.cep95 = gnssDeviations[Math.floor(gnssDeviations.length * 0.95)];
            result.metrics.gnss.maxDeviation = gnssDeviations[gnssDeviations.length - 1];
            result.metrics.gnss.rmse = Math.sqrt(gnssDeviations.reduce((acc, val) => acc + (val * val), 0) / gnssDeviations.length);

            // Total Distance
            const distAStream = reference.getStreamData('Distance');
            const distBStream = test.getStreamData('Distance');
            const distA = (distAStream && distAStream.length > 0) ? (distAStream.filter(v => v !== null).pop() || 0) : 0;
            const distB = (distBStream && distBStream.length > 0) ? (distBStream.filter(v => v !== null).pop() || 0) : 0;

            result.metrics.gnss.totalDistanceDifference = Math.abs(distA - distB);
        }

        // 6. Calculate Stream Metrics
        commonTypes.forEach(type => {
            const vals = streamValues[type];
            if (vals.a.length > 1) { // Need at least 2 points for correlation
                result.metrics.streamMetrics[type] = {
                    sourceA_mean: this.mean(vals.a),
                    sourceB_mean: this.mean(vals.b),
                    pearsonCorrelation: this.pearsonCorrelation(vals.a, vals.b),
                    meanAbsoluteError: this.meanAbsoluteError(vals.a, vals.b),
                    rootMeanSquareError: this.rmse(vals.a, vals.b)
                };
            }
        });

        return result;
    }

    // --- Helpers ---

    private getPositionAtTime(activity: ActivityInterface, date: Date): DataPositionInterface | null {
        const index = activity.getDateIndex(date);
        if (index === -1) return null;

        const latStream = activity.getStreamData('Latitude');
        const longStream = activity.getStreamData('Longitude');

        // Check bounds
        if (!latStream || !longStream || index >= latStream.length) return null;

        const lat = latStream[index];
        const lng = longStream[index];

        if (lat === null || lng === null) return null;

        return { latitudeDegrees: lat, longitudeDegrees: lng } as DataPositionInterface;
    }

    private getValueAtTime(activity: ActivityInterface, type: string, date: Date): number | null {
        const index = activity.getDateIndex(date);
        if (index === -1) return null;

        const stream = activity.getStreamData(type);
        if (!stream || index >= stream.length) return null;

        return stream[index] as number | null;
    }

    // Math Helpers
    private mean(data: number[]): number {
        return data.reduce((a, b) => a + b, 0) / data.length;
    }

    private meanAbsoluteError(a: number[], b: number[]): number {
        return a.reduce((acc, val, i) => acc + Math.abs(val - b[i]), 0) / a.length;
    }

    private rmse(a: number[], b: number[]): number {
        return Math.sqrt(a.reduce((acc, val, i) => acc + Math.pow(val - b[i], 2), 0) / a.length);
    }

    private pearsonCorrelation(x: number[], y: number[]): number {
        const n = x.length;
        const mux = this.mean(x);
        const muy = this.mean(y);

        let numerator = 0;
        let denomX = 0;
        let denomY = 0;

        for (let i = 0; i < n; i++) {
            const dx = x[i] - mux;
            const dy = y[i] - muy;
            numerator += dx * dy;
            denomX += dx * dx;
            denomY += dy * dy;
        }

        return numerator / Math.sqrt(denomX * denomY);
    }

    private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371e3; // metres
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }
}
