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
 * ## Dual-Field Strategy for Original Files
 * 
 * Events store original file references using two fields for backwards compatibility:
 * 
 * - **`originalFiles`**: Canonical field. Always an array, even for single-file uploads.
 *   Supports merged events (multiple source files) and provides consistent data structure.
 * 
 * - **`originalFile`**: Legacy/convenience field. Points to the first file in the array.
 *   Maintained for backwards compatibility with older code paths.
 * 
 * Both fields are written together by `EventWriter.writeAllEventData()`.
 * Readers should check `originalFiles` first, then fall back to `originalFile`.
 */
export interface AppEventInterface extends EventInterface {
    /** @deprecated Use originalFiles[0] instead. Kept for backwards compatibility. */
    originalFile?: OriginalFileMetaData;
    /** Canonical source for original file metadata. Always an array. */
    originalFiles?: OriginalFileMetaData[];
    /** Result data for hardware comparison benchmarks */
    benchmarkResult?: BenchmarkResult;
    /** Flag to identify benchmark events */
    isBenchmark?: boolean;
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
    sourceEventId?: string; // ID of the event containing the source activities
    timestamp: Date;
    metrics: {
        gnss: {
            cep50: number; // Circular Error Probable 50%
            cep95: number; // Circular Error Probable 95%
            maxDeviation: number;
            rmse: number;
            totalDistanceDifference: number;
        };
        streamMetrics: {
            [streamType: string]: BenchmarkStreamMetrics;
        };
    };
    diffStreams?: {
        time: number[];
        gnssDeviation: number[];
        [streamType: string]: number[];
    };
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
}

