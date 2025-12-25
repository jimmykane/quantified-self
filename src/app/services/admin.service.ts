import { inject, Injectable, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { collection, Firestore, getCountFromServer, query, where } from '@angular/fire/firestore';
import { Functions, httpsCallableFromURL } from '@angular/fire/functions';
import { from, Observable, timer } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
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
    providers: {
        name: string;
        pending: number;
        succeeded: number;
        failed: number;
    }[];
}

@Injectable({
    providedIn: 'root'
})
export class AdminService {
    private functions = inject(Functions);
    private firestore = inject(Firestore);

    private listUsersFn = httpsCallableFromURL<ListUsersParams, ListUsersResponse>(
        this.functions,
        environment.functions.listUsers
    );

    private getQueueStatsFn = httpsCallableFromURL<void, QueueStats>(
        this.functions,
        environment.functions.getQueueStats
    );

    private injector = inject(EnvironmentInjector);

    getUsers(params: ListUsersParams = {}): Observable<ListUsersResponse> {
        return from(this.listUsersFn({
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
        return from(this.getQueueStatsFn()).pipe(
            map(result => result.data)
        );
    }

    getQueueStatsDirect(): Observable<QueueStats> {
        const PROVIDER_QUEUES = {
            'Suunto': ['suuntoAppWorkoutQueue', 'suuntoAppHistoryImportActivityQueue'],
            'COROS': ['COROSAPIWorkoutQueue', 'COROSAPIHistoryImportWorkoutQueue'],
            'Garmin': ['garminHealthAPIActivityQueue']
        };

        const fetchStats = async (): Promise<QueueStats> => {

            let totalPending = 0;
            let totalSucceeded = 0;
            let totalFailed = 0;
            const providers: QueueStats['providers'] = [];

            for (const [providerName, collections] of Object.entries(PROVIDER_QUEUES)) {
                let providerPending = 0;
                let providerSucceeded = 0;
                let providerFailed = 0;

                await Promise.all(collections.map(async (collectionName) => {
                    await runInInjectionContext(this.injector, async () => {
                        const col = collection(this.firestore, collectionName);

                        const [p, s, f] = await Promise.all([
                            getCountFromServer(query(col, where('processed', '==', false), where('retryCount', '<', 10))),
                            getCountFromServer(query(col, where('processed', '==', true))),
                            getCountFromServer(query(col, where('processed', '==', false), where('retryCount', '>=', 10)))
                        ]);

                        providerPending += p.data().count;
                        providerSucceeded += s.data().count;
                        providerFailed += f.data().count;
                    });
                }));

                totalPending += providerPending;
                totalSucceeded += providerSucceeded;
                totalFailed += providerFailed;

                providers.push({
                    name: providerName,
                    pending: providerPending,
                    succeeded: providerSucceeded,
                    failed: providerFailed
                });
            }

            return {
                pending: totalPending,
                succeeded: totalSucceeded,
                failed: totalFailed,
                providers: providers
            };
        };


        // Poll every 10 seconds for "hot" updates
        return timer(0, 10000).pipe(
            switchMap(() => from(fetchStats()))
        );
    }
}
