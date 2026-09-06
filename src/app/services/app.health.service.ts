import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    collectionData,
    documentId,
    getCountFromServer,
    getDocs,
    getDocsFromServer,
    limit,
    orderBy,
    query,
    startAfter,
    where,
} from 'app/firebase/firestore';
import type { QueryConstraint } from 'firebase/firestore';
import { Observable, combineLatest, of } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import {
    HEALTH_SYNC_STATE_COLLECTION_ID,
    HEALTH_METRIC_IDS,
    HEALTH_PROVIDERS,
    HEALTH_SOURCE_RECORD_KINDS,
    HEALTH_METRIC_CATALOG,
    HEALTH_SOURCE_RECORDS_COLLECTION_ID,
    HealthRangeQuery,
    HealthRangeResult,
    HealthMetricId,
    HealthProvider,
    HealthQueryCursor,
    HealthSampleChunk,
    HealthSourceRecord,
    HealthSyncState,
} from '@shared/health';
import {
    HealthFirestoreQueryPlan,
    planHealthFirestoreQueries,
} from '@shared/health-firestore-query';
import { projectHealthRange, projectLoadedHealthRange } from '@shared/health-query';
import { AppFunctionsService } from './app.functions.service';
import type {
    DeleteManualHealthMeasurementRequest,
    DeleteManualHealthMeasurementResponse,
    ManualHealthAccountAssertion,
    ManualHealthMeasurementFields,
    SaveManualHealthMeasurementRequest,
    SaveManualHealthMeasurementResponse,
} from '@shared/manual-health';
import { MANUAL_HEALTH_SOURCE_RECORD_TYPE, MANUAL_HEALTH_VALUE_MAXIMUMS } from '@shared/manual-health';
import { decodeHealthSourceRecordSportsLibData } from '@shared/sports-lib-health-data';

export const HEALTH_WORKSPACE_LOAD_LIMITS = Object.freeze({
    sourceRecords: 2_048,
    sampleChunks: 256,
    samplePoints: 100_000,
    serializedBytes: 16 * 1024 * 1024,
});

export type HealthWorkspaceLoadLimit = 'source_records' | 'sample_chunks' | 'sample_points' | 'serialized_bytes';

export interface HealthWorkspaceRangeRequest {
    startDate: string;
    endDate: string;
    metricId: HealthMetricId;
    includeSamples: boolean;
}

export interface HealthWorkspaceRangeLoad {
    result: HealthRangeResult;
    limitReached: HealthWorkspaceLoadLimit | null;
    sourceRecordCount: number;
    sampleChunkCount: number;
    samplePointCount: number;
    serializedBytes: number;
    hasMatchingSourceRecords: boolean;
    hasSampleBackedMetric: boolean;
    providers: HealthProvider[];
    sampleBackedProviders: HealthProvider[];
}

interface LoadedCollectionPage<T> {
    values: T[];
    complete: boolean;
    cursor: HealthQueryCursor | null;
    serializedBytes: number;
    limitReached: HealthWorkspaceLoadLimit | null;
}

@Injectable({
    providedIn: 'root',
})
export class AppHealthService {
    private static readonly MAX_SYNC_STATE_DOCUMENTS = 6;

    private firestore = inject(Firestore);
    private functions = inject(AppFunctionsService);

    /**
     * Default Health read path. Firestore supplies bounded source pages and
     * the shared projector produces the exact same result shape as the callable.
     */
    watchRange(
        userID: string | null | undefined,
        queryValue: HealthRangeQuery,
    ): Observable<HealthRangeResult> {
        const plans = planHealthFirestoreQueries(queryValue);
        const uid = `${userID || ''}`.trim();
        if (!uid) {
            return of(projectHealthRange([], [], plans.query));
        }

        const sourceRecords$ = this.watchCollection<HealthSourceRecord>(uid, plans.sourceRecords);
        const chunks$ = plans.chunks
            ? this.watchCollection<HealthSampleChunk>(uid, plans.chunks)
            : of([] as HealthSampleChunk[]);
        return combineLatest([sourceRecords$, chunks$]).pipe(
            map(([sourceRecords, chunks]) => projectHealthRange(sourceRecords, chunks, plans.query)),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
    }

    async queryRangeViaServer(queryValue: HealthRangeQuery): Promise<HealthRangeResult> {
        const response = await this.functions.call<HealthRangeQuery, HealthRangeResult>(
            'queryHealthRange',
            queryValue,
        );
        return response.data;
    }

    async saveManualMeasurement(
        request: SaveManualHealthMeasurementRequest,
        expectedUserID: string,
    ): Promise<SaveManualHealthMeasurementResponse> {
        const response = await this.functions.call<
            SaveManualHealthMeasurementRequest & ManualHealthAccountAssertion,
            SaveManualHealthMeasurementResponse
        >('saveManualHealthMeasurement', { ...request, expectedUserID });
        return response.data;
    }

    async deleteManualMeasurement(
        request: DeleteManualHealthMeasurementRequest,
        expectedUserID: string,
    ): Promise<DeleteManualHealthMeasurementResponse> {
        const response = await this.functions.call<
            DeleteManualHealthMeasurementRequest & ManualHealthAccountAssertion,
            DeleteManualHealthMeasurementResponse
        >('deleteManualHealthMeasurement', { ...request, expectedUserID });
        return response.data;
    }

    /** The range projection contains one selected metric; edits need the complete paired reading. */
    async loadManualBloodPressure(
        userID: string,
        sourceRecordId: string,
        expectedRevisionOrder: number,
    ): Promise<ManualHealthMeasurementFields> {
        if (!userID || userID.includes('/') || !/^[a-f0-9]{64}$/.test(sourceRecordId)) {
            throw new Error('Invalid measurement identity.');
        }
        const snapshot = await getDocsFromServer(query(
            collection(this.firestore, 'users', userID, HEALTH_SOURCE_RECORDS_COLLECTION_ID),
            where(documentId(), '==', sourceRecordId), limit(1),
        ));
        const raw = snapshot.docs[0]?.data() as HealthSourceRecord | undefined;
        if (!raw || raw.userID !== userID || raw.id !== sourceRecordId
            || raw.source?.revision?.order !== expectedRevisionOrder
            || raw.source?.provider !== HEALTH_PROVIDERS.QuantifiedSelf
            || raw.source?.sourceRecordType !== MANUAL_HEALTH_SOURCE_RECORD_TYPE
            || raw.kind !== HEALTH_SOURCE_RECORD_KINDS.PointMeasurement
            || !Array.isArray(raw.sampleChunkIds) || raw.sampleChunkIds.length !== 0) {
            throw new Error('Measurement changed or is no longer available.');
        }
        const record = decodeHealthSourceRecordSportsLibData(raw);
        const ids = [HEALTH_METRIC_IDS.BloodPressureSystolic, HEALTH_METRIC_IDS.BloodPressureDiastolic, HEALTH_METRIC_IDS.PulseRate] as const;
        if (record.metrics.length < 2 || record.metrics.length > 3
            || new Set(record.metrics.map(metric => metric.metricId)).size !== record.metrics.length
            || record.metrics.some(metric => !(ids as readonly string[]).includes(metric.metricId)
                || metric.origin !== 'recorded' || metric.recordingMethod !== 'manual' || metric.aggregation !== 'measurement')) {
            throw new Error('Invalid paired measurement.');
        }
        const valueFor = (id: typeof ids[number]): number => {
            const metric = record.metrics.find(entry => entry.metricId === id);
            const value = metric?.kind === 'value' ? metric.canonical?.value : undefined;
            if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MANUAL_HEALTH_VALUE_MAXIMUMS[id]) {
                throw new Error('Invalid paired measurement value.');
            }
            return value;
        };
        return {
            metricId: HEALTH_METRIC_IDS.BloodPressureSystolic,
            canonicalValue: valueFor(HEALTH_METRIC_IDS.BloodPressureSystolic),
            diastolicValue: valueFor(HEALTH_METRIC_IDS.BloodPressureDiastolic),
            ...(record.metrics.some(metric => metric.metricId === HEALTH_METRIC_IDS.PulseRate)
                ? { pulseValue: valueFor(HEALTH_METRIC_IDS.PulseRate) } : {}),
            observedAtMs: record.startTimeMs,
            timezoneOffsetSeconds: record.timezoneOffsetSeconds ?? 0,
        };
    }

    watchSyncStates(userID: string | null | undefined): Observable<HealthSyncState[]> {
        const uid = `${userID || ''}`.trim();
        if (!uid) {
            return of([]);
        }
        const stateCollection = collection(this.firestore, 'users', uid, HEALTH_SYNC_STATE_COLLECTION_ID);
        const stateQuery = query(stateCollection, limit(AppHealthService.MAX_SYNC_STATE_DOCUMENTS));
        return collectionData(stateQuery, { idField: 'provider' }) as Observable<HealthSyncState[]>;
    }

    /**
     * Resolves catalog availability across all stored history without loading
     * source records. Each existence query is capped at one indexed match so
     * absent metrics can be distinguished from metrics outside the open range.
     */
    async loadAvailableMetricIds(
        userID: string | null | undefined,
    ): Promise<HealthMetricId[]> {
        const uid = `${userID || ''}`.trim();
        if (!uid) {
            return [];
        }

        const sourceRecords = collection(
            this.firestore,
            'users',
            uid,
            HEALTH_SOURCE_RECORDS_COLLECTION_ID,
        );
        const metricIds = Object.keys(HEALTH_METRIC_CATALOG) as HealthMetricId[];
        const availability = await Promise.all(metricIds.map(async metricId => {
            const metricQuery = query(
                sourceRecords,
                where('metricIds', 'array-contains', metricId),
                orderBy('calendarDate', 'asc'),
                orderBy(documentId(), 'asc'),
                limit(1),
            );
            const snapshot = await getCountFromServer(metricQuery);
            return snapshot.data().count > 0 ? metricId : null;
        }));

        return availability.filter((metricId): metricId is HealthMetricId => metricId !== null);
    }

    /**
     * Owner-scoped one-shot reader for the Health workspace. It always queries
     * the selected metric first, walks every bounded Firestore page, and only
     * then projects the aggregate so cross-page conflicts and sample revisions
     * remain correct.
     */
    async loadMetricRange(
        userID: string | null | undefined,
        request: HealthWorkspaceRangeRequest,
    ): Promise<HealthWorkspaceRangeLoad> {
        const uid = `${userID || ''}`.trim();
        const queryValue: HealthRangeQuery = {
            startDate: request.startDate,
            endDate: request.endDate,
            metricIds: [request.metricId],
            providers: [],
            includeSamples: request.includeSamples,
        };
        const normalizedQuery = planHealthFirestoreQueries(queryValue).query;
        if (!uid) {
            return this.buildWorkspaceLoad([], [], normalizedQuery, true, true, null, null, 0);
        }

        const sourcePage = await this.loadSourceRecordPages(uid, normalizedQuery);
        let chunkPage: LoadedCollectionPage<HealthSampleChunk> = {
            values: [],
            complete: !normalizedQuery.includeSamples,
            cursor: null,
            serializedBytes: sourcePage.serializedBytes,
            limitReached: sourcePage.limitReached,
        };
        if (normalizedQuery.includeSamples && sourcePage.complete) {
            chunkPage = await this.loadSampleChunkPages(uid, normalizedQuery, sourcePage.serializedBytes);
        }

        const limitReached = sourcePage.limitReached || chunkPage.limitReached;
        return this.buildWorkspaceLoad(
            sourcePage.values,
            chunkPage.values,
            normalizedQuery,
            sourcePage.complete,
            chunkPage.complete,
            sourcePage.cursor,
            chunkPage.cursor,
            chunkPage.serializedBytes,
            limitReached,
        );
    }

    private watchCollection<T>(userID: string, plan: HealthFirestoreQueryPlan): Observable<T[]> {
        const targetCollection = collection(this.firestore, 'users', userID, plan.collectionId);
        const constraints: QueryConstraint[] = [
            where('calendarDate', '>=', plan.startDate),
            where('calendarDate', '<=', plan.endDate),
        ];
        if (plan.filter) {
            constraints.push(where(plan.filter.field, plan.filter.operator, plan.filter.value));
        }
        constraints.push(
            orderBy('calendarDate', 'asc'),
            orderBy(documentId(), 'asc'),
        );
        if (plan.cursor) {
            constraints.push(startAfter(plan.cursor.calendarDate, plan.cursor.id));
        }
        constraints.push(limit(plan.fetchLimit));
        const targetQuery = query(targetCollection, ...constraints);
        return collectionData(targetQuery, { idField: 'id' }) as Observable<T[]>;
    }

    private async loadSourceRecordPages(
        userID: string,
        queryValue: HealthRangeQuery,
    ): Promise<LoadedCollectionPage<HealthSourceRecord>> {
        const values: HealthSourceRecord[] = [];
        let cursor: HealthQueryCursor | null = null;
        let serializedBytes = 0;
        while (true) {
            const plan = planHealthFirestoreQueries({ ...queryValue, sourceRecordCursor: cursor }).sourceRecords;
            const snapshot = await getDocs(this.buildCollectionQuery(userID, plan));
            const page = snapshot.docs.slice(0, plan.fetchLimit - 1);
            for (const documentSnapshot of page) {
                if (values.length >= HEALTH_WORKSPACE_LOAD_LIMITS.sourceRecords) {
                    return { values, complete: false, cursor, serializedBytes, limitReached: 'source_records' };
                }
                const value = { ...(documentSnapshot.data() as HealthSourceRecord), id: documentSnapshot.id };
                const valueBytes = serializedUtf8Bytes(value);
                if (serializedBytes + valueBytes > HEALTH_WORKSPACE_LOAD_LIMITS.serializedBytes) {
                    return { values, complete: false, cursor, serializedBytes, limitReached: 'serialized_bytes' };
                }
                values.push(value);
                serializedBytes += valueBytes;
                cursor = { calendarDate: value.calendarDate, id: value.id };
            }
            if (snapshot.docs.length <= page.length) {
                return { values, complete: true, cursor: null, serializedBytes, limitReached: null };
            }
            if (!cursor) {
                return { values, complete: false, cursor: null, serializedBytes, limitReached: 'source_records' };
            }
        }
    }

    private async loadSampleChunkPages(
        userID: string,
        queryValue: HealthRangeQuery,
        initialSerializedBytes: number,
    ): Promise<LoadedCollectionPage<HealthSampleChunk>> {
        const values: HealthSampleChunk[] = [];
        let cursor: HealthQueryCursor | null = null;
        let serializedBytes = initialSerializedBytes;
        let samplePoints = 0;
        while (true) {
            const plan = planHealthFirestoreQueries({ ...queryValue, chunkCursor: cursor }).chunks;
            if (!plan) {
                return { values, complete: true, cursor: null, serializedBytes, limitReached: null };
            }
            const snapshot = await getDocs(this.buildCollectionQuery(userID, plan));
            const page = snapshot.docs.slice(0, plan.fetchLimit - 1);
            for (const documentSnapshot of page) {
                if (values.length >= HEALTH_WORKSPACE_LOAD_LIMITS.sampleChunks) {
                    return { values, complete: false, cursor, serializedBytes, limitReached: 'sample_chunks' };
                }
                const value = { ...(documentSnapshot.data() as HealthSampleChunk), id: documentSnapshot.id };
                const pointCount = Array.isArray(value.offsetMs) ? value.offsetMs.length : 0;
                if (samplePoints + pointCount > HEALTH_WORKSPACE_LOAD_LIMITS.samplePoints) {
                    return { values, complete: false, cursor, serializedBytes, limitReached: 'sample_points' };
                }
                const valueBytes = serializedUtf8Bytes(value);
                if (serializedBytes + valueBytes > HEALTH_WORKSPACE_LOAD_LIMITS.serializedBytes) {
                    return { values, complete: false, cursor, serializedBytes, limitReached: 'serialized_bytes' };
                }
                values.push(value);
                samplePoints += pointCount;
                serializedBytes += valueBytes;
                cursor = { calendarDate: value.calendarDate, id: value.id };
            }
            if (snapshot.docs.length <= page.length) {
                return { values, complete: true, cursor: null, serializedBytes, limitReached: null };
            }
            if (!cursor) {
                return { values, complete: false, cursor: null, serializedBytes, limitReached: 'sample_chunks' };
            }
        }
    }

    private buildCollectionQuery(userID: string, plan: HealthFirestoreQueryPlan) {
        const targetCollection = collection(this.firestore, 'users', userID, plan.collectionId);
        const constraints: QueryConstraint[] = [
            where('calendarDate', '>=', plan.startDate),
            where('calendarDate', '<=', plan.endDate),
        ];
        if (plan.filter) {
            constraints.push(where(plan.filter.field, plan.filter.operator, plan.filter.value));
        }
        constraints.push(orderBy('calendarDate', 'asc'), orderBy(documentId(), 'asc'));
        if (plan.cursor) {
            constraints.push(startAfter(plan.cursor.calendarDate, plan.cursor.id));
        }
        constraints.push(limit(plan.fetchLimit));
        return query(targetCollection, ...constraints);
    }

    private buildWorkspaceLoad(
        sourceRecords: readonly HealthSourceRecord[],
        chunks: readonly HealthSampleChunk[],
        queryValue: HealthRangeQuery,
        sourceRecordsComplete: boolean,
        samplesComplete: boolean,
        sourceRecordCursor: HealthQueryCursor | null,
        chunkCursor: HealthQueryCursor | null,
        serializedBytes: number,
        limitReached: HealthWorkspaceLoadLimit | null = null,
    ): HealthWorkspaceRangeLoad {
        const result = projectLoadedHealthRange(sourceRecords, chunks, queryValue, {
            sourceRecordsComplete,
            samplesComplete,
            sourceRecordCursor,
            chunkCursor,
        });
        const metricId = result.query.metricIds[0];
        const matchingRecords = metricId
            ? sourceRecords.filter(record => record.metricIds.includes(metricId))
            : [];
        const providers = uniqueProviders(matchingRecords.map(record => record.source.provider));
        const sampleBackedProviders = uniqueProviders(matchingRecords
            .filter(record => record.sampleChunkIds.length > 0)
            .map(record => record.source.provider));
        return {
            result,
            limitReached,
            sourceRecordCount: sourceRecords.length,
            sampleChunkCount: result.sampleChunks.length,
            samplePointCount: result.pageInfo.returnedSamplePoints,
            serializedBytes,
            hasMatchingSourceRecords: sourceRecords.length > 0,
            hasSampleBackedMetric: sampleBackedProviders.length > 0,
            providers,
            sampleBackedProviders,
        };
    }
}

function uniqueProviders(providers: readonly HealthProvider[]): HealthProvider[] {
    return [...new Set(providers)].sort((left, right) => left.localeCompare(right));
}

function serializedUtf8Bytes(value: unknown): number {
    const serialized = JSON.stringify(value);
    let bytes = 0;
    for (let index = 0; index < serialized.length; index += 1) {
        const codePoint = serialized.charCodeAt(index);
        if (codePoint < 0x80) {
            bytes += 1;
        } else if (codePoint < 0x800) {
            bytes += 2;
        } else if (codePoint >= 0xd800 && codePoint <= 0xdbff
            && index + 1 < serialized.length
            && serialized.charCodeAt(index + 1) >= 0xdc00
            && serialized.charCodeAt(index + 1) <= 0xdfff) {
            bytes += 4;
            index += 1;
        } else {
            bytes += 3;
        }
    }
    return bytes;
}
