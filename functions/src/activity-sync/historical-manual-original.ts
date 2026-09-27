import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { inspectFitPayload } from '../shared/fit-payload';

export const HISTORICAL_FIT_MAX_BYTES = 20 * 1024 * 1024;
export const MANUAL_UPLOAD_ORIGIN_DOC_ID = 'manualUploadOrigin';

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

export async function readHistoricalManualFit(
    userID: string,
    eventID: string,
    original: HistoricalOriginalFile,
): Promise<{ fit: Buffer; generation: string }> {
    if (!isOwnerOriginalPath(userID, eventID, original.path)) {
        throw new Error('Manual upload original path is invalid.');
    }
    const extension = historicalFitExtension(original.path);
    if (!extension) throw new Error('Manual upload original format is unsupported.');
    const file = original.bucket
        ? admin.storage().bucket(original.bucket).file(original.path)
        : admin.storage().bucket().file(original.path);
    const [metadata] = await file.getMetadata();
    const generation = `${metadata.generation || ''}`;
    if (!generation || (original.generation && generation !== `${original.generation}`)) {
        throw new Error('Manual upload original changed.');
    }
    const storedBytes = Number(metadata.size);
    if (!Number.isFinite(storedBytes) || storedBytes <= 0 || storedBytes > HISTORICAL_FIT_MAX_BYTES) {
        throw new Error('Manual upload original exceeds the send limit.');
    }
    const [stored] = await file.download();
    const [metadataAfterDownload] = await file.getMetadata();
    if (`${metadataAfterDownload.generation || ''}` !== generation) {
        throw new Error('Manual upload original changed during read.');
    }
    const fit = extension === 'fit.gz'
        ? gunzipSync(stored, { maxOutputLength: HISTORICAL_FIT_MAX_BYTES })
        : stored;
    if (fit.length > HISTORICAL_FIT_MAX_BYTES || !inspectFitPayload(fit).isCompleteFit) {
        throw new Error('Manual upload original is not a supported FIT activity.');
    }
    return { fit, generation };
}

export function matchesLegacyManualUploadID(userID: string, eventID: string, fit: Buffer): boolean {
    return createHash('sha256').update('fit').update(':').update(userID).update(':').update(fit).digest('hex') === eventID;
}
