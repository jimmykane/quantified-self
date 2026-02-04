import { Injectable } from '@angular/core';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { DataPositionInterface } from '@sports-alliance/sports-lib';
import { BenchmarkResult, BenchmarkOptions, BenchmarkQualityIssue } from '../../../functions/src/shared/app-event.interface';
import {
    DataLatitudeDegrees,
    DataLongitudeDegrees,
    DataDistance,
    DataGradeAdjustedSpeed,
    DataVerticalSpeed,
    DataPace,
    DataAscent,
    DataDescent,
    DataGradeAdjustedPace,
} from '@sports-alliance/sports-lib';

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
        DataLatitudeDegrees.type,           // Handled by GNSS comparison
        DataLongitudeDegrees.type,          // Handled by GNSS comparison
        DataDistance.type,           // Compared as totalDistanceDifference in GNSS metrics
        'Grade',                     // Derived from altitude + distance
        DataGradeAdjustedSpeed.type, // Calculated from speed + grade
        DataVerticalSpeed.type,      // Derived from altitude changes
        DataPace.type,               // Inverse of speed (redundant)
        'SWOLF',                     // Calculated (strokes + time)
        'FormPower',                 // Algorithm-based (Stryd-specific)
        'RunningEconomy',            // Calculated metric
        DataAscent.type,             // Cumulative total
        DataDescent.type,            // Cumulative total
        DataGradeAdjustedPace.type,  // Calculated metric
    ]);

    constructor() { }

    /**
     * Generates a benchmark report comparing a Reference activity against a Test activity.
     */
    async generateBenchmark(reference: ActivityInterface, test: ActivityInterface, options: BenchmarkOptions = { autoAlignTime: true }): Promise<BenchmarkResult> {
        console.log('AppBenchmarkService: generateBenchmark started', { referenceId: reference.getID(), testId: test.getID() });
        // 1. alignment
        const startA = reference.startDate.getTime();
        const endA = reference.endDate.getTime();
        const startB = test.startDate.getTime();
        const endB = test.endDate.getTime();

        const sharedStart = Math.max(startA, startB);
        const sharedEnd = Math.min(endA, endB);

        if (sharedEnd <= sharedStart) {
            console.error('AppBenchmarkService: No overlap found');
            throw new Error('Activities do not overlap in time.');
        }

        // Auto-Alignment
        let testActivityToUse = test;
        let timeOffset = 0;
        let alignmentApplied = false;

        if (options.autoAlignTime) {
            timeOffset = this.findBestTimeOffset(reference, test, sharedStart, sharedEnd);
            if (timeOffset !== 0) {
                testActivityToUse = createOffsetActivity(test, timeOffset);
                alignmentApplied = true;
            }
        }

        console.log('AppBenchmarkService: overlaps', { sharedStart, sharedEnd, diff: sharedEnd - sharedStart, offset: timeOffset });

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
            }
        };

        // 3. Identify Common Streams (excluding derived/calculated types)
        const streamsA = reference.getAllStreams().map(s => s.type);
        const streamsB = testActivityToUse.getAllStreams().map(s => s.type);
        const commonTypes = streamsA.filter(type =>
            streamsB.includes(type) &&
            !AppBenchmarkService.EXCLUDED_STREAM_TYPES.has(type)
        );

        // Initialize diff streams for common types
        // Initialize diff streams for common types (removed for optimization)

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
            const posB = this.getPositionAtTime(testActivityToUse, date);

            if (posA && posB) {
                const deviation = this.haversineDistance(posA.latitudeDegrees, posA.longitudeDegrees, posB.latitudeDegrees, posB.longitudeDegrees);
                gnssDeviations.push(deviation);
            }

            // Stream Comparisons
            commonTypes.forEach(type => {
                const valA = this.getValueAtTime(reference, type, date);
                const valB = this.getValueAtTime(testActivityToUse, type, date);

                if (valA !== null && valB !== null) {
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
            // Total Distance
            let distA = 0;
            let distB = 0;
            try {
                const distAStream = reference.getStreamData('Distance');
                if (distAStream && distAStream.length > 0) {
                    distA = (distAStream.filter(v => v !== null).pop() || 0);
                }
            } catch { /* ignore */ }

            try {
                const distBStream = test.getStreamData('Distance');
                if (distBStream && distBStream.length > 0) {
                    distB = (distBStream.filter(v => v !== null).pop() || 0);
                }
            } catch { /* ignore */ }

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

        // 7. Quality Issues & Metadata
        const issuesRef = this.detectQualityIssues(reference);
        const issuesTest = this.detectQualityIssues(test); // Use original test activity for artifact detection

        result.timeOffsetSeconds = timeOffset;
        result.alignmentApplied = alignmentApplied;
        result.qualityIssues = [...issuesRef, ...issuesTest];

        return result;
    }

    // --- Helpers ---

    private getPositionAtTime(activity: ActivityInterface, date: Date): DataPositionInterface | null {
        const index = activity.getDateIndex(date);
        if (index === -1) return null;

        const streams = activity.getAllStreams().map(s => s.type);
        if (!streams.includes('Latitude') || !streams.includes('Longitude')) return null;

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

    private findBestTimeOffset(reference: ActivityInterface, test: ActivityInterface, sharedStart: number, sharedEnd: number, maxShiftSeconds: number = 15): number {
        // Prefer Speed, fallback to Altitude
        const refStreams = reference.getAllStreams().map(s => s.type);
        const testStreams = test.getAllStreams().map(s => s.type);

        const hasSpeed = refStreams.includes('Speed') && testStreams.includes('Speed');
        const hasAltitude = refStreams.includes('Altitude') && testStreams.includes('Altitude');

        const type = hasAltitude ? 'Altitude' : (hasSpeed ? 'Speed' : null);
        if (!type) return 0;

        // Take a representative sample (middle 5 mins or full duration if shorter)
        const duration = sharedEnd - sharedStart;
        const sampleDur = Math.min(300 * 1000, duration); // 5 mins
        const sampleStart = sharedStart + (duration - sampleDur) / 2;
        const sampleEnd = sampleStart + sampleDur;

        // Sample data at 1Hz
        const refData: number[] = [];

        // Get Reference data
        for (let t = sampleStart; t <= sampleEnd; t += 1000) {
            const v = this.getValueAtTime(reference, type, new Date(t));
            refData.push(typeof v === 'number' ? v : 0);
        }

        // Search window
        let bestCorrelation = -2; // Pearson is between -1 and 1
        let bestOffset = 0;

        for (let offset = -maxShiftSeconds; offset <= maxShiftSeconds; offset++) {
            const currentTestData: number[] = [];
            for (let t = sampleStart; t <= sampleEnd; t += 1000) {
                // Apply offset to test time lookup
                const v = this.getValueAtTime(test, type, new Date(t - (offset * 1000)));
                currentTestData.push(typeof v === 'number' ? v : 0);
            }

            const corr = this.pearsonCorrelation(refData, currentTestData);
            if (corr > bestCorrelation) {
                bestCorrelation = corr;
                bestOffset = offset;
            }
        }

        console.log(`Time Alignment (${type}): Found best offset ${bestOffset}s with correlation ${bestCorrelation}`);
        return bestOffset;
    }

    private detectQualityIssues(activity: ActivityInterface): BenchmarkQualityIssue[] {
        const issues: BenchmarkQualityIssue[] = [];
        const streams = activity.getAllStreams();

        for (const s of streams) {
            const data = activity.getStreamData(s.type);
            if (!data || data.length === 0) continue;

            // 1. Dropouts (Zeros/Nulls)
            // Context aware: Speed/Power can be 0. HeartRate/Cadence usually shouldn't be 0 while moving.
            if (['HeartRate', 'Cadence'].includes(s.type)) {
                this.detectStreamDropouts(s.type, data, activity, issues);
            }

            // 2. Stuck Values
            this.detectStuckValues(s.type, data, activity, issues);
        }

        // 3. Cadence Lock (HR vs Cadence)
        // 3. Cadence Lock (HR vs Cadence)
        const hasHR = streams.some(s => s.type === 'HeartRate');
        const hasCadence = streams.some(s => s.type === 'Cadence');

        if (hasHR && hasCadence) {
            try {
                const hr = activity.getStreamData('HeartRate');
                const cad = activity.getStreamData('Cadence');
                if (hr && cad && hr.length > 0 && cad.length > 0) {
                    this.detectCadenceLock(hr, cad, activity, issues);
                }
            } catch (e) {
                console.warn('AppBenchmarkService: Failed to retrieve HR/Cadence for lock check', e);
            }
        }

        return issues;
    }

    private detectStreamDropouts(type: string, data: (number | null)[], activity: ActivityInterface, issues: BenchmarkQualityIssue[]) {
        let zeroRun = 0;
        // 5 seconds threshold
        const threshold = 5;

        for (let i = 0; i < data.length; i++) {
            const val = data[i];
            if (val === 0 || val === null || val === undefined) {
                zeroRun++;
            } else {
                if (zeroRun > threshold) {
                    issues.push({
                        type: 'dropout',
                        streamType: type,
                        description: `Signal dropout for ${zeroRun} seconds`,
                        severity: 'warning',
                        duration: zeroRun,
                        timestamp: new Date(activity.startDate.getTime() + (i - zeroRun) * 1000)
                    });
                }
                zeroRun = 0;
            }
        }
    }

    private detectStuckValues(type: string, data: (number | null)[], activity: ActivityInterface, issues: BenchmarkQualityIssue[]) {
        // Exclude Temperature as it naturally changes very slowly
        if (type === 'Temperature') return;

        if (data.length < 60) return;
        let stuckRun = 0;
        const threshold = 60; // 60 seconds (1 minute) static to avoid false positives

        for (let i = 1; i < data.length; i++) {
            // Check exact equality. 
            const val = data[i];
            const prev = data[i - 1];

            if (val !== null && prev !== null && val === prev && val !== 0) {
                stuckRun++;
            } else {
                if (stuckRun > threshold) {
                    issues.push({
                        type: 'stuck',
                        streamType: type,
                        description: `Sensor stuck at ${data[i - 1]} for ${stuckRun} seconds`,
                        severity: 'warning',
                        duration: stuckRun,
                        timestamp: new Date(activity.startDate.getTime() + (i - stuckRun) * 1000)
                    });
                }
                stuckRun = 0;
            }
        }
    }

    private detectCadenceLock(hr: (number | null)[], cad: (number | null)[], activity: ActivityInterface, issues: BenchmarkQualityIssue[]) {
        // Simple windowed correlation check
        // Check 1-minute windows
        const windowSize = 60;
        const step = 30;
        const limit = Math.min(hr.length, cad.length);

        for (let i = 0; i < limit - windowSize; i += step) {
            const hrWindow: number[] = [];
            const cadWindow: number[] = [];

            // Build non-null windows
            for (let j = 0; j < windowSize; j++) {
                const h = hr[i + j];
                const c = cad[i + j];
                if (typeof h === 'number' && typeof c === 'number' && h > 0 && c > 0) {
                    hrWindow.push(h);
                    cadWindow.push(c);
                }
            }

            if (hrWindow.length < windowSize * 0.5) continue; // Need 50% data

            const corr = this.pearsonCorrelation(hrWindow, cadWindow);

            if (corr > 0.95) {
                const avgDiff = this.mean(hrWindow.map((h, idx) => Math.abs(h - cadWindow[idx])));

                if (avgDiff < 10) {
                    issues.push({
                        type: 'cadence_lock',
                        streamType: 'HeartRate',
                        description: `Possible cadence lock detected (Correlation ${corr.toFixed(2)})`,
                        severity: 'warning',
                        duration: windowSize,
                        timestamp: new Date(activity.startDate.getTime() + i * 1000)
                    });
                    // Skip ahead a bit to avoid flooding
                    i += 60;
                }
            }
        }
    }
}

/**
 * Wraps an activity to apply a time offset to all data requests.
 * We rely on intercepting getDateIndex, because AppBenchmarkService uses it to query data/position.
 */
export function createOffsetActivity(activity: ActivityInterface, offsetSeconds: number): ActivityInterface {
    if (offsetSeconds === 0) return activity;

    // Use a proxy to intercept getDateIndex
    return new Proxy(activity, {
        get(target, prop, receiver) {
            if (prop === 'getDateIndex') {
                return (date: Date) => {
                    // Usage: service calls getDateIndex(queryTime)
                    // We want to return data from (queryTime - offset)
                    // So we delegate to target.getDateIndex(queryTime - offset)
                    const shiftedDate = new Date(date.getTime() - (offsetSeconds * 1000));
                    return target.getDateIndex(shiftedDate);
                };
            }
            return Reflect.get(target, prop, receiver);
        }
    });
}

/**
 * Wraps an activity to apply a time offset to all data requests.
 * We rely on intercepting getDateIndex, because AppBenchmarkService uses it to query data/position.
 */
