import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import { readFitMessages, readFitUnsignedField } from 'fit-file-parser/raw';
import { RouteImporterFIT, RouteImporterGPX } from '@sports-alliance/sports-lib';
import { DOMParser } from 'xmldom';
import { getActivityFileBaseExtension } from '../shared/activity-file-parser';
import { MAX_ACTIVITY_DECOMPRESSED_BYTES } from '../shared/activity-processing-config';

export const SPORTS_LIB_PRIMARY_BUCKET = 'quantified-self-io';

export type ReparseSourceKind = 'activity' | 'monitoring' | 'route' | 'other_non_activity';
export interface ReparseSourceReference { path: string; bucket?: string; generation?: string }
export interface ClassifiedReparseSource {
    path: string;
    bucket: string;
    referenceBucket?: string;
    kind: ReparseSourceKind;
    sha256: string;
    md5: string;
    generation: string;
}
export interface NonActivitySourceAssessment {
    schemaVersion: 1;
    sourceFingerprint: string;
    sources: ClassifiedReparseSource[];
}
export const NON_ACTIVITY_SKIP_REASONS = {
    monitoring: 'MONITORING_SOURCE',
    route: 'ROUTE_SOURCE',
    other: 'NON_ACTIVITY_SOURCE',
    mixed: 'MIXED_SOURCES_REQUIRING_REVIEW',
} as const;

export function isNonActivitySkipReason(value: unknown): boolean {
    return Object.values(NON_ACTIVITY_SKIP_REASONS).some(reason => reason === value);
}

export function getNonActivitySkipReason(kinds: ReparseSourceKind[]): string {
    const unique = new Set(kinds);
    if (unique.size !== 1 || unique.has('activity')) return NON_ACTIVITY_SKIP_REASONS.mixed;
    if (unique.has('monitoring')) return NON_ACTIVITY_SKIP_REASONS.monitoring;
    if (unique.has('route')) return NON_ACTIVITY_SKIP_REASONS.route;
    return NON_ACTIVITY_SKIP_REASONS.other;
}

export function sourceReferenceFingerprint(sources: ReparseSourceReference[]): string {
    return createHash('sha256').update(JSON.stringify(sources.map(source =>
        JSON.stringify([source.path, source.bucket || '', source.generation || ''])).sort())).digest('hex');
}

/** Only reconsider the library's exact non-activity rejection. Structural/CRC failures,
 * contradictory declarations and activity summaries must remain real failures. */
export async function classifyRejectedActivitySource(
    bytes: Buffer, path: string, error: unknown,
): Promise<Exclude<ReparseSourceKind, 'activity'> | null> {
    if (!(error instanceof Error)) return null;
    try {
        const extension = getActivityFileBaseExtension(path);
        if (extension === 'gpx' && error.message === 'No activities found in GPX; use importRoutesFromGPX for routes') {
            const routes = await RouteImporterGPX.getFromString(bytes.toString('utf8'), DOMParser);
            return routes.getRoutes().length > 0 ? 'route' : null;
        }
        if (extension !== 'fit' || error.message !== 'FIT file is not an activity file') return null;
        const decoded = readFitMessages(bytes, {
            messageNumbers: [0, 18, 19, 34], maxInputBytes: MAX_ACTIVITY_DECOMPRESSED_BYTES,
        });
        if (decoded.issues.length || decoded.messages.some(message => [18, 34].includes(message.globalMessageNumber))) return null;
        const fileIds = decoded.messages.filter(message => message.globalMessageNumber === 0);
        if (fileIds.some(message => message.fields.filter(field => field.fieldNumber === 0).length !== 1)) return null;
        const types = fileIds.map(message => readFitUnsignedField(
            message.fields.find(field => field.fieldNumber === 0), 0, 1, message.littleEndian));
        if (!types.length || types.some(type => type === undefined || type === 4 || type === 20)
            || new Set(types).size !== 1) return null;
        if (types[0] === 6) {
            // FIT courses may legitimately contain a lap summary of the route.
            const routes = await RouteImporterFIT.getFromArrayBuffer(
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
            return routes.getRoutes().length > 0 ? 'route' : null;
        }
        if (decoded.messages.some(message => message.globalMessageNumber === 19)) return null;
        return [15, 28, 32].includes(types[0]!) ? 'monitoring' : 'other_non_activity';
    } catch {
        // Classifier uncertainty never converts an actual parser failure into a skip.
        return null;
    }
}

export class NonActivitySourcesError extends Error {
    readonly reason: string;
    constructor(readonly assessment: NonActivitySourceAssessment) {
        super('Original files contain non-activity sources; existing event retained.');
        this.reason = getNonActivitySkipReason(assessment.sources.map(source => source.kind));
    }
}

/** Cheap Storage metadata checks only for previously classified sources. Never trust a
 * path alone: replacing bytes at the same path must make the event eligible again. */
export async function hasUnchangedNonActivitySources(
    status: Record<string, unknown> | undefined, sources: ReparseSourceReference[],
): Promise<boolean> {
    if (status?.status !== 'skipped' || !isNonActivitySkipReason(status.reason)) return false;
    const assessment = status.nonActivitySources as NonActivitySourceAssessment | undefined;
    if (assessment?.schemaVersion !== 1 || !sources.length
        || assessment.sourceFingerprint !== sourceReferenceFingerprint(sources)
        || !Array.isArray(assessment.sources) || assessment.sources.length !== sources.length
        || assessment.sources.some(source => !source || !source.path || !source.bucket || !source.generation || !source.md5
            || !['activity', 'monitoring', 'route', 'other_non_activity'].includes(source.kind))
        || assessment.sources.every(source => source.kind === 'activity')
        || getNonActivitySkipReason(assessment.sources.map(source => source.kind)) !== status.reason
        || JSON.stringify(assessment.sources.map(source => JSON.stringify([source.path, source.referenceBucket || ''])).sort())
            !== JSON.stringify(sources.map(source => JSON.stringify([source.path, source.bucket || ''])).sort())) return false;
    for (const source of assessment.sources) {
        try {
            // Match download resolution, not just the formerly resolved object. A new
            // preferred-bucket object must supersede a cached fallback-bucket source.
            const candidates = [...new Set([source.referenceBucket?.trim(), SPORTS_LIB_PRIMARY_BUCKET, source.bucket].filter(Boolean))];
            for (const bucket of candidates) {
                if (bucket === source.bucket) break;
                try {
                    await admin.storage().bucket(bucket).file(source.path).getMetadata();
                    return false;
                } catch (error) {
                    if (`${(error as { code?: unknown })?.code}` !== '404') throw error;
                }
            }
            const [metadata] = await admin.storage().bucket(source.bucket).file(source.path).getMetadata();
            if (metadata.generation !== source.generation || metadata.md5Hash !== source.md5) return false;
        } catch (error) {
            // A missing object invalidates the assessment. An unavailable lookup proves
            // neither change nor stability: retry without discarding a committed skip or
            // falling into the interrupted-heavy-attempt terminal guard.
            if (`${(error as { code?: unknown })?.code}` === '404') return false;
            throw error;
        }
    }
    return true;
}
