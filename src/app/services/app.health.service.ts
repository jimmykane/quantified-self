import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    collectionData,
    documentId,
    getCountFromServer,
    getDocs,
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
    SaveManualHealthMeasurementRequest,
    SaveManualHealthMeasurementResponse,
} from '@shared/manual-health';

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
    ): Promise<SaveManualHealthMeasurementResponse> {
        const response = await this.functions.call<
            SaveManualHealthMeasurementRequest,
            SaveManualHealthMeasurementResponse
        >('saveManualHealthMeasurement', request);
        return response.data;
    }

    async deleteManualMeasurement(
        request: DeleteManualHealthMeasurementRequest,
    ): Promise<DeleteManualHealthMeasurementResponse> {
        const response = await this.functions.call<
            DeleteManualHealthMeasurementRequest,
            DeleteManualHealthMeasurementResponse
        >('deleteManualHealthMeasurement', request);
        return response.data;
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
