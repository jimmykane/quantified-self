import { EventInterface } from '@sports-alliance/sports-lib';

export interface OriginalFileMetaData {
    path: string;
    bucket?: string;
    startDate: Date;
    originalFilename?: string;
}

/**
 * Extended event interface that includes original file metadata.
 *
 * Events store original file references using two fields for backwards compatibility:
 * - `originalFiles`: canonical field. Always an array, even for single-file uploads.
 * - `originalFile`: legacy/convenience field. Points to the first file in the array.
 */
export interface AppEventInterface extends EventInterface {
    /** @deprecated Use originalFiles[0] instead. Kept for backwards compatibility. */
    originalFile?: OriginalFileMetaData;
    /** Canonical source for original file metadata. Always an array. */
    originalFiles?: OriginalFileMetaData[];
    /** @deprecated Use benchmarkResults instead. Kept for migration. */
    benchmarkResult?: BenchmarkResult;
    /** Map of benchmark results keyed by "referenceId_testId" */
    benchmarkResults?: { [pairKey: string]: BenchmarkResult };
    /** Flag to identify benchmark events */
    isBenchmark?: boolean;
    /** Denormalized benchmark flag for querying */
    hasBenchmark?: boolean;
    /** Denormalized benchmark device names (normalized) for querying */
    benchmarkDevices?: string[];
    /** Latest benchmark timestamp for querying/sorting */
    benchmarkLatestAt?: Date;
}

/**
 * Generate a benchmark pair key from reference and test activity IDs.
 * Order matters: Garmin(ref) vs Suunto(test) !== Suunto(ref) vs Garmin(test)
 */
export function getBenchmarkPairKey(referenceId: string, testId: string): string {
    return `${referenceId}_${testId}`;
}

export interface BenchmarkStreamMetrics {
    sourceA_mean: number;
    sourceB_mean: number;
    pearsonCorrelation: number;
    meanAbsoluteError: number;
    rootMeanSquareError: number;
}

export interface BenchmarkResult {
    referenceId: string;
    testId: string;
    /** Device/watch name for the reference activity */
    referenceName?: string;
    /** Device/watch name for the test activity */
    testName?: string;
    sourceEventId?: string;
    timestamp: Date;
    metrics: {
        gnss: {
            cep50: number;
            cep95: number;
            maxDeviation: number;
            rmse: number;
            totalDistanceDifference: number;
        };
        streamMetrics: {
            [streamType: string]: BenchmarkStreamMetrics;
        };
    };
    /** Detected time lag applied to the Test activity (in seconds) */
    timeOffsetSeconds?: number;
    /** Whether auto-alignment was enabled/used */
    alignmentApplied?: boolean;
    /** Detected data quality issues */
    qualityIssues?: BenchmarkQualityIssue[];
}

export interface BenchmarkQualityIssue {
    type: 'dropout' | 'stuck' | 'cadence_lock';
    streamType: string;
    description: string;
    severity: 'warning' | 'severe';
    timestamp?: Date;
    /** Duration of the issue in seconds */
    duration?: number;
    /** Which activity/device produced the issue */
    source?: 'reference' | 'test';
    /** Device/watch name for this issue */
    deviceName?: string;
}

export interface BenchmarkOptions {
    autoAlignTime: boolean;
}

/**
 * Activity JSON structure as stored in Firestore.
 * Extends sports-lib ActivityJSONInterface with denormalized metadata for querying.
 */
export interface FirestoreActivityJSON {
    /** All fields from ActivityJSONInterface via toJSON() */
    [key: string]: unknown;
    /** Denormalized user ID for flat collection querying */
    userID: string;
    /** Parent event reference */
    eventID: string;
    /** Denormalized event start date for sorting across all user activities */
    eventStartDate?: Date;
    /** Deterministic source-derived activity identity key */
    sourceActivityKey?: string;
}

/**
 * Event JSON structure as stored in Firestore.
 * Extends sports-lib EventJSONInterface with original file metadata.
 */
export interface FirestoreEventJSON {
    /** All fields from EventJSONInterface via toJSON() */
    [key: string]: unknown;
    /** @deprecated Use originalFiles[0] instead */
    originalFile?: OriginalFileMetaData;
    /** Canonical source for original file metadata */
    originalFiles?: OriginalFileMetaData[];
    /** Denormalized benchmark flag for querying */
    hasBenchmark?: boolean;
    /** Denormalized benchmark device names (normalized) for querying */
    benchmarkDevices?: string[];
    /** Latest benchmark timestamp for querying/sorting */
    benchmarkLatestAt?: Date;
}
