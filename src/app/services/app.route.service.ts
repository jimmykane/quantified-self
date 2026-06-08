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

    getRoutes(user: RouteOwner, limitCount = 50): Observable<FirestoreRouteJSON[]> {
        const routesCollection = collection(this.firestore, 'users', user.uid, 'routes');
        const routesQuery = query(routesCollection, orderBy('importedAt', 'desc'), limit(limitCount));
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
            return route.originalFiles.filter(file => !!file?.path);
        }

        return route.originalFile?.path ? [route.originalFile] : [];
    }

    async downloadFile(path: string, options?: DownloadFileOptions): Promise<ArrayBuffer> {
        return this.originalFileHydrationService.downloadFile(path, options);
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
}
