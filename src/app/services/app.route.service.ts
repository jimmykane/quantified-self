import { Injectable, inject } from '@angular/core';
import { defer, Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import {
    Firestore,
    collection,
    collectionData,
    deleteDoc,
    doc,
    docData,
    getCountFromServer,
    limit,
    orderBy,
    query,
    updateDoc,
    where,
} from 'app/firebase/firestore';
import { FirestoreRouteJSON, OriginalRouteFileMetaData } from '@shared/app-route.interface';
import { validateRouteName } from '../helpers/route-name.helper';
import { AppOriginalFileHydrationService, DownloadFileOptions } from './app.original-file-hydration.service';

export interface RouteOwner {
    uid: string;
}

export type RouteListSortColumn =
    | 'date'
    | 'name'
    | 'distance'
    | 'ascent'
    | 'descent'
    | 'minGrade'
    | 'maxGrade'
    | 'pointCount';

export type RouteListServerSortColumn = 'date' | 'name' | 'pointCount';

export type RouteListSortDirection = 'asc' | 'desc';

export interface RouteListSort {
    active: RouteListSortColumn;
    direction: RouteListSortDirection;
}

export const ROUTE_LIST_DEFAULT_SORT: RouteListSort & { active: RouteListServerSortColumn } = {
    active: 'date',
    direction: 'desc',
};

const ROUTE_LIST_SORT_COLUMNS: readonly RouteListSortColumn[] = [
    'date',
    'name',
    'distance',
    'ascent',
    'descent',
    'minGrade',
    'maxGrade',
    'pointCount',
];

const ROUTE_LIST_SERVER_SORT_FIELD_BY_COLUMN: Record<RouteListServerSortColumn, string> = {
    date: 'importedAt',
    name: 'name',
    pointCount: 'pointCount',
};

export function isRouteListSortColumn(value: string): value is RouteListSortColumn {
    return ROUTE_LIST_SORT_COLUMNS.includes(value as RouteListSortColumn);
}

export function isRouteListServerSortColumn(value: string): value is RouteListServerSortColumn {
    return Object.prototype.hasOwnProperty.call(ROUTE_LIST_SERVER_SORT_FIELD_BY_COLUMN, value);
}

const SERVER_OWNED_ROUTE_UPDATE_FIELDS = [
    'id',
    'userID',
    'originalFile',
    'originalFiles',
    'srcFileType',
    'sourceFileType',
    'creator',
    'createdAt',
    'importedAt',
    'updatedAt',
    'stats',
    'routes',
    'routeCount',
    'waypointCount',
    'pointCount',
    'activityTypes',
    'streamTypes',
    'bounds',
    'preview',
    'previewReady',
    'sourceSummary',
    'syncedDestinationServiceNames',
    'deliverySummaries',
] as const;

const ROUTE_PREVIEW_CANDIDATE_LIMIT_MULTIPLIER = 4;
const ROUTE_PREVIEW_MAX_CANDIDATE_LIMIT = 200;

@Injectable({
    providedIn: 'root'
})
export class AppRouteService {
    private firestore = inject(Firestore);
    private originalFileHydrationService = inject(AppOriginalFileHydrationService);

    getRoutes(
        user: RouteOwner,
        limitCount = 50,
        sort: RouteListSort = ROUTE_LIST_DEFAULT_SORT,
    ): Observable<FirestoreRouteJSON[]> {
        const routesCollection = collection(this.firestore, 'users', user.uid, 'routes');
        const resolvedSort = this.resolveRouteListSort(sort);
        const routesQuery = query(
            routesCollection,
            orderBy(ROUTE_LIST_SERVER_SORT_FIELD_BY_COLUMN[resolvedSort.active], resolvedSort.direction),
            limit(limitCount),
        );
        return defer(() => collectionData(routesQuery, { idField: 'id' }) as Observable<FirestoreRouteJSON[]>);
    }

    watchHasAnyRoutePreview(userID: string | null | undefined): Observable<boolean> {
        const uid = `${userID || ''}`.trim();
        if (!uid) {
            return of(false);
        }

        return this.watchRoutePreviewDocuments(uid, 1).pipe(
            map(routes => routes.some(route => this.hasRoutePreview(route))),
            catchError(() => of(false)),
            distinctUntilChanged(),
        );
    }

    watchRecentRoutePreviews(user: RouteOwner, limitCount = 50): Observable<FirestoreRouteJSON[]> {
        const uid = `${user?.uid || ''}`.trim();
        if (!uid) {
            return of([]);
        }

        const requestedLimit = Math.max(1, Math.floor(limitCount));
        const candidateLimit = Math.min(
            ROUTE_PREVIEW_MAX_CANDIDATE_LIMIT,
            Math.max(requestedLimit, requestedLimit * ROUTE_PREVIEW_CANDIDATE_LIMIT_MULTIPLIER),
        );

        return this.getRoutes({ uid }, candidateLimit).pipe(
            switchMap((routes) => {
                const recentPreviewRoutes = this.filterPreviewRoutes(routes).slice(0, requestedLimit);
                if (recentPreviewRoutes.length >= requestedLimit || (routes || []).length < candidateLimit) {
                    return of(recentPreviewRoutes);
                }

                return this.watchRoutePreviewDocuments(uid, requestedLimit).pipe(
                    map(previewRoutes => this.mergePreviewRoutes(recentPreviewRoutes, previewRoutes).slice(0, requestedLimit)),
                    catchError(() => of(recentPreviewRoutes)),
                );
            }),
            catchError(() => of([])),
            distinctUntilChanged((previous, current) => this.routePreviewFingerprintsEqual(previous, current)),
        );
    }

    getRoute(user: RouteOwner, routeID: string): Observable<FirestoreRouteJSON | null> {
        const routeDocument = doc(this.firestore, 'users', user.uid, 'routes', routeID);
        return (docData(routeDocument, { idField: 'id' }) as Observable<FirestoreRouteJSON | undefined>)
            .pipe(map(route => route ?? null));
    }

    async getRouteCount(user: RouteOwner): Promise<number> {
        const routesCollection = collection(this.firestore, 'users', user.uid, 'routes');
        const countSnapshot = await getCountFromServer(routesCollection);
        return countSnapshot.data().count;
    }

    async updateRouteProperties(
        user: RouteOwner,
        routeID: string,
        updates: Partial<FirestoreRouteJSON>,
    ): Promise<void> {
        const sanitizedUpdates = this.stripServerOwnedRouteMetadata(updates as Record<string, unknown>);
        if (Object.keys(sanitizedUpdates).length === 0) {
            return;
        }

        await updateDoc(
            doc(this.firestore, 'users', user.uid, 'routes', routeID),
            sanitizedUpdates,
        );
    }

    async updateRouteName(
        user: RouteOwner,
        routeID: string,
        name: string,
    ): Promise<void> {
        await this.updateRouteProperties(user, routeID, {
            name: validateRouteName(name),
        });
    }

    async deleteRoute(user: RouteOwner, routeID: string): Promise<void> {
        await deleteDoc(doc(this.firestore, 'users', user.uid, 'routes', routeID));
    }

    getOriginalRouteFiles(route: FirestoreRouteJSON): OriginalRouteFileMetaData[] {
        if (Array.isArray(route.originalFiles) && route.originalFiles.length > 0) {
            return route.originalFiles.filter(file => typeof file?.path === 'string' && file.path.trim().length > 0);
        }

        return typeof route.originalFile?.path === 'string' && route.originalFile.path.trim().length > 0
            ? [route.originalFile]
            : [];
    }

    hasRoutePreview(route: FirestoreRouteJSON | null | undefined): boolean {
        return !!route?.preview
            && route.preview.version === 1
            && route.preview.encoding === 'polyline5'
            && route.preview.precision === 5
            && typeof route.preview.pointCount === 'number'
            && route.preview.pointCount > 0
            && Array.isArray(route.preview.segments)
            && route.preview.segments.some(segment => (
                typeof segment?.encodedPolyline === 'string'
                && segment.encodedPolyline.length > 0
                && typeof segment.pointCount === 'number'
                && segment.pointCount > 1
            ));
    }

    private watchRoutePreviewDocuments(userID: string, limitCount: number): Observable<FirestoreRouteJSON[]> {
        return defer(() => {
            const routesCollection = collection(this.firestore, 'users', userID, 'routes');
            const routesQuery = query(
                routesCollection,
                where('previewReady', '==', true),
                orderBy('importedAt', 'desc'),
                limit(Math.max(1, Math.floor(limitCount))),
            );

            return collectionData(routesQuery, { idField: 'id' }) as Observable<FirestoreRouteJSON[]>;
        });
    }

    private filterPreviewRoutes(routes: readonly FirestoreRouteJSON[] | null | undefined): FirestoreRouteJSON[] {
        return (routes || []).filter(route => this.hasRoutePreview(route));
    }

    private mergePreviewRoutes(
        primaryRoutes: readonly FirestoreRouteJSON[],
        fallbackRoutes: readonly FirestoreRouteJSON[],
    ): FirestoreRouteJSON[] {
        const seenIDs = new Set<string>();
        return [...primaryRoutes, ...this.sortRoutesByImportedAtDesc(this.filterPreviewRoutes(fallbackRoutes))]
            .filter((route, index) => {
                const id = `${route?.id || ''}`.trim();
                if (!id) {
                    return index < primaryRoutes.length;
                }
                if (seenIDs.has(id)) {
                    return false;
                }
                seenIDs.add(id);
                return true;
            });
    }

    private sortRoutesByImportedAtDesc(routes: FirestoreRouteJSON[]): FirestoreRouteJSON[] {
        return [...routes].sort((left, right) => this.toRouteTimestampMs(right.importedAt) - this.toRouteTimestampMs(left.importedAt));
    }

    private routePreviewFingerprintsEqual(
        previous: readonly FirestoreRouteJSON[] | null | undefined,
        current: readonly FirestoreRouteJSON[] | null | undefined,
    ): boolean {
        return this.buildRoutePreviewFingerprint(previous) === this.buildRoutePreviewFingerprint(current);
    }

    private buildRoutePreviewFingerprint(routes: readonly FirestoreRouteJSON[] | null | undefined): string {
        return this.stableRoutePreviewFingerprintValue((routes || []).map(route => {
            const preview = route.preview;
            return {
                id: route.id || '',
                name: route.name || '',
                srcFileType: route.srcFileType || '',
                importedAt: route.importedAt ? this.toRouteTimestampMs(route.importedAt) : null,
                routeCount: route.routeCount ?? null,
                waypointCount: route.waypointCount ?? null,
                pointCount: route.pointCount ?? null,
                activityTypes: route.activityTypes || [],
                sourceSummary: route.sourceSummary || null,
                stats: route.stats || null,
                preview: {
                    version: preview?.version ?? null,
                    encoding: preview?.encoding ?? null,
                    precision: preview?.precision ?? null,
                    pointCount: preview?.pointCount ?? null,
                    sourcePointCount: preview?.sourcePointCount ?? null,
                    segments: (preview?.segments || []).map(segment => ({
                        id: segment?.id || '',
                        name: segment?.name || '',
                        activityType: segment?.activityType || '',
                        encodedPolyline: segment?.encodedPolyline || '',
                        pointCount: segment?.pointCount ?? null,
                        sourcePointCount: segment?.sourcePointCount ?? null,
                    })),
                },
            };
        }));
    }

    private stableRoutePreviewFingerprintValue(value: unknown): string {
        return JSON.stringify(this.normalizeRoutePreviewFingerprintValue(value));
    }

    private normalizeRoutePreviewFingerprintValue(value: unknown): unknown {
        if (value === null || typeof value === 'undefined') {
            return null;
        }
        if (value instanceof Date) {
            return value.getTime();
        }
        if (typeof (value as { toMillis?: unknown })?.toMillis === 'function') {
            return (value as { toMillis: () => number }).toMillis();
        }
        if (Array.isArray(value)) {
            return value.map(item => this.normalizeRoutePreviewFingerprintValue(item));
        }
        if (typeof value === 'object') {
            return Object.fromEntries(Object.entries(value as Record<string, unknown>)
                .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
                .map(([key, entryValue]) => [key, this.normalizeRoutePreviewFingerprintValue(entryValue)]));
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : `${value}`;
        }
        if (typeof value === 'bigint') {
            return `${value}`;
        }
        if (['boolean', 'string'].includes(typeof value)) {
            return value;
        }
        return `${value}`;
    }

    private toRouteTimestampMs(value: unknown): number {
        if (value instanceof Date) {
            return value.getTime();
        }
        if (typeof (value as { toMillis?: unknown })?.toMillis === 'function') {
            const millis = (value as { toMillis: () => number }).toMillis();
            return Number.isFinite(millis) ? millis : 0;
        }
        const timestamp = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    async downloadFile(path: string, options?: DownloadFileOptions): Promise<ArrayBuffer> {
        return this.originalFileHydrationService.downloadFile(path, options);
    }

    async downloadOriginalFile(path: string, options?: DownloadFileOptions): Promise<ArrayBuffer> {
        return this.downloadFile(path, {
            ...options,
            decompress: false,
        });
    }

    private stripServerOwnedRouteMetadata(
        payload: Record<string, unknown>,
    ): Record<string, unknown> {
        const sanitizedPayload = { ...payload };
        SERVER_OWNED_ROUTE_UPDATE_FIELDS.forEach((field) => {
            delete sanitizedPayload[field];
        });
        return sanitizedPayload;
    }

    private resolveRouteListSort(sort: RouteListSort | undefined): RouteListSort & { active: RouteListServerSortColumn } {
        // Firestore orderBy excludes documents where the ordered field is missing.
        // Nullable aggregate metrics stay client-side so routes without elevation/grade stats remain visible.
        if (!sort || !isRouteListServerSortColumn(sort.active)) {
            return ROUTE_LIST_DEFAULT_SORT;
        }

        return {
            active: sort.active,
            direction: sort.direction === 'asc' ? 'asc' : 'desc',
        };
    }

}
