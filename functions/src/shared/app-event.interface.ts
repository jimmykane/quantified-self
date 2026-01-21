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
}
