import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    collectionData,
    documentId,
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
    HealthRangeQuery,
    HealthRangeResult,
    HealthSampleChunk,
    HealthSourceRecord,
    HealthSyncState,
} from '@shared/health';
import {
    HealthFirestoreQueryPlan,
    planHealthFirestoreQueries,
} from '@shared/health-firestore-query';
import { projectHealthRange } from '@shared/health-query';
import { AppFunctionsService } from './app.functions.service';

@Injectable({
    providedIn: 'root',
})
export class AppHealthService {
    private static readonly MAX_SYNC_STATE_DOCUMENTS = 6;

    private firestore = inject(Firestore);
    private functions = inject(AppFunctionsService);

    /**
     * Default Health Hub read path. Firestore supplies bounded source pages and
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

        const records$ = this.watchCollection<HealthSourceRecord>(uid, plans.records);
        const chunks$ = plans.chunks
            ? this.watchCollection<HealthSampleChunk>(uid, plans.chunks)
            : of([] as HealthSampleChunk[]);
        return combineLatest([records$, chunks$]).pipe(
            map(([records, chunks]) => projectHealthRange(records, chunks, plans.query)),
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

    watchSyncStates(userID: string | null | undefined): Observable<HealthSyncState[]> {
        const uid = `${userID || ''}`.trim();
        if (!uid) {
            return of([]);
        }
        const stateCollection = collection(this.firestore, 'users', uid, HEALTH_SYNC_STATE_COLLECTION_ID);
        const stateQuery = query(stateCollection, limit(AppHealthService.MAX_SYNC_STATE_DOCUMENTS));
        return collectionData(stateQuery, { idField: 'provider' }) as Observable<HealthSyncState[]>;
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
}
