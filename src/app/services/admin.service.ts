import { inject, Injectable } from '@angular/core';
import { collection, Firestore, getCountFromServer, query, where } from '@angular/fire/firestore';
import { Functions, httpsCallableFromURL } from '@angular/fire/functions';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface AdminUser {
    uid: string;
    email: string;
    displayName?: string;
    photoURL?: string;
    customClaims: {
        stripeRole?: string;
        admin?: boolean;
        [key: string]: any;
    };
    metadata: {
        lastSignInTime: string;
        creationTime: string;
    };
    disabled: boolean;
    providerIds: string[];
    subscription?: {
        status: string;
        current_period_end?: { seconds: number; nanoseconds: number } | string;
        cancel_at_period_end?: boolean;
        stripeLink?: string;
    };
    connectedServices?: {
        provider: string;
        connectedAt?: { seconds: number; nanoseconds: number } | string | number | null;
    }[];
}

export interface ListUsersParams {
    page?: number;
    pageSize?: number;
    searchTerm?: string;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
}

export interface ListUsersResponse {
    users: AdminUser[];
    totalCount: number;
    page: number;
    pageSize: number;
}

export interface QueueStats {
    pending: number;
    succeeded: number;
    failed: number;
}

@Injectable({
    providedIn: 'root'
})
export class AdminService {
    private functions = inject(Functions);
    private firestore = inject(Firestore);

    getUsers(params: ListUsersParams = {}): Observable<ListUsersResponse> {
        const listUsers = httpsCallableFromURL<ListUsersParams, ListUsersResponse>(
            this.functions,
            environment.functions.listUsers
        );

        return from(listUsers({
            page: params.page ?? 0,
            pageSize: params.pageSize ?? 25,
            searchTerm: params.searchTerm,
            sortField: params.sortField,
            sortDirection: params.sortDirection
        })).pipe(
            map(result => result.data)
        );
    }

    getQueueStats(): Observable<QueueStats> {
        const getQueueStats = httpsCallableFromURL<void, QueueStats>(
            this.functions,
            environment.functions.getQueueStats
        );

        return from(getQueueStats()).pipe(
            map(result => result.data)
        );
    }

    getQueueStatsDirect(): Observable<QueueStats> {
        const QUEUE_COLLECTIONS = [
            'suuntoAppWorkoutQueue',
            'suuntoAppHistoryImportActivityQueue',
            'COROSAPIWorkoutQueue',
            'COROSAPIHistoryImportWorkoutQueue',
            'garminHealthAPIActivityQueue'
        ];

        const fetchStats = async (): Promise<QueueStats> => {
            let pending = 0;
            let succeeded = 0;
            let failed = 0;

            await Promise.all(QUEUE_COLLECTIONS.map(async (collectionName) => {
                const col = collection(this.firestore, collectionName);

                const [p, s, f] = await Promise.all([
                    getCountFromServer(query(col, where('processed', '==', false), where('retryCount', '<', 10))),
                    getCountFromServer(query(col, where('processed', '==', true))),
                    getCountFromServer(query(col, where('processed', '==', false), where('retryCount', '>=', 10)))
                ]);

                pending += p.data().count;
                succeeded += s.data().count;
                failed += f.data().count;
            }));

            return { pending, succeeded, failed };
        };

        return from(fetchStats());
    }
}
