import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { inspectFitPayload } from '../shared/fit-payload';

export const HISTORICAL_FIT_MAX_BYTES = 20 * 1024 * 1024;
export const MANUAL_UPLOAD_ORIGIN_DOC_ID = 'manualUploadOrigin';

export class HistoricalOriginalIneligibleError extends Error {
    constructor(
        message: string,
        public readonly skippedReason = 'missing_invalid_or_oversized_original',
    ) {
        super(message);
    }
}

export interface HistoricalOriginalFile {
    path: string;
    bucket?: string;
    generation?: string;
    originalFilename?: string;
    startDate?: number;
}

export function isOwnerOriginalPath(userID: string, eventID: string, path: string): boolean {
    return path === `users/${userID}/events/${eventID}/original.fit`
        || path === `users/${userID}/events/${eventID}/original.fit.gz`;
}

export function historicalFitExtension(path: string): 'fit' | 'fit.gz' | null {
    if (path.endsWith('.fit.gz')) return 'fit.gz';
    if (path.endsWith('.fit')) return 'fit';
    return null;
}

function storageFile(original: HistoricalOriginalFile, generation?: string) {
    const options = generation ? { generation } : undefined;
    return original.bucket
        ? admin.storage().bucket(original.bucket).file(original.path, options)
        : admin.storage().bucket().file(original.path, options);
}

export function isStorageObjectMissing(error: unknown): boolean {
    return Number((error as { code?: unknown } | null)?.code) === 404;
}

export async function inspectHistoricalManualOriginal(
    userID: string,
    eventID: string,
    original: HistoricalOriginalFile,
): Promise<{ generation: string; size: number }> {
    if (!isOwnerOriginalPath(userID, eventID, original.path) || !historicalFitExtension(original.path)) {
        throw new HistoricalOriginalIneligibleError('Manual upload original path or format is invalid.');
    }
    let metadata;
    try {
        [metadata] = await storageFile(original).getMetadata();
    } catch (error) {
        if (isStorageObjectMissing(error)) throw new HistoricalOriginalIneligibleError('Manual upload original is missing.');
        throw error;
    }
    const generation = `${metadata.generation || ''}`;
    if (!generation || (original.generation && generation !== `${original.generation}`)) {
        throw new HistoricalOriginalIneligibleError('Manual upload original changed.');
    }
    const size = Number(metadata.size);
    if (!Number.isFinite(size) || size <= 0 || size > HISTORICAL_FIT_MAX_BYTES) {
        throw new HistoricalOriginalIneligibleError('Manual upload original exceeds the send limit.');
    }
    return { generation, size };
}

export async function readHistoricalManualFit(
    userID: string,
    eventID: string,
    original: HistoricalOriginalFile,
): Promise<{ fit: Buffer; generation: string }> {
    const { generation } = await inspectHistoricalManualOriginal(userID, eventID, original);
    const extension = historicalFitExtension(original.path);
    const file = storageFile(original);
    let stored;
    let metadataAfterDownload;
    try {
        [stored] = await storageFile(original, generation).download();
        [metadataAfterDownload] = await file.getMetadata();
    } catch (error) {
        if (isStorageObjectMissing(error)) throw new HistoricalOriginalIneligibleError('Manual upload original is missing.');
        throw error;
    }
    if (`${metadataAfterDownload.generation || ''}` !== generation) {
        throw new HistoricalOriginalIneligibleError('Manual upload original changed during read.');
    }
    let fit: Buffer;
    try {
        fit = extension === 'fit.gz'
            ? gunzipSync(stored, { maxOutputLength: HISTORICAL_FIT_MAX_BYTES })
            : stored;
    } catch {
        throw new HistoricalOriginalIneligibleError('Manual upload original cannot be expanded within the send limit.');
    }
    if (fit.length > HISTORICAL_FIT_MAX_BYTES || !inspectFitPayload(fit).isCompleteFit) {
        throw new HistoricalOriginalIneligibleError('Manual upload original is not a supported FIT activity.');
    }
    return { fit, generation };
}

export function matchesLegacyManualUploadID(userID: string, eventID: string, fit: Buffer): boolean {
    return createHash('sha256').update('fit').update(':').update(userID).update(':').update(fit).digest('hex') === eventID;
}
