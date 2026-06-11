import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
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
] as const;

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
        return collectionData(routesQuery, { idField: 'id' }) as Observable<FirestoreRouteJSON[]>;
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
