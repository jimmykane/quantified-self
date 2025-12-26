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

export interface DLQStats {
    total: number;
    byContext: { context: string; count: number }[];
    byProvider: { provider: string; count: number }[];
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
    dlq?: DLQStats;
    advanced?: {
        throughput: number;
        maxLagMs: number;
        retryHistogram: { '0-3': number; '4-7': number; '8-9': number };
        topErrors: { error: string; count: number }[];
    };
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

    private getUserCountFn = httpsCallableFromURL<void, { count: number }>(
        this.functions,
        environment.functions.getUserCount
    );

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
        // Poll every 10 seconds for "hot" updates
        return timer(0, 10000).pipe(
            switchMap(() => from(this.getQueueStatsFn())),
            map(result => result.data)
        );
    }

    getTotalUserCount(): Observable<number> {
        return from(this.getUserCountFn()).pipe(
            map(result => result.data.count)
        );
    }

    // Maintenance mode
    private setMaintenanceModeFn = httpsCallableFromURL<
        { enabled: boolean; message?: string },
        { success: boolean; enabled: boolean; message: string }
    >(this.functions, environment.functions.setMaintenanceMode);

    private getMaintenanceStatusFn = httpsCallableFromURL<
        void,
        { enabled: boolean; message: string; updatedAt?: unknown; updatedBy?: string }
    >(this.functions, environment.functions.getMaintenanceStatus);

    setMaintenanceMode(enabled: boolean, message?: string): Observable<{ success: boolean; enabled: boolean; message: string }> {
        return from(this.setMaintenanceModeFn({ enabled, message })).pipe(
            map(result => result.data)
        );
    }

    getMaintenanceStatus(): Observable<{ enabled: boolean; message: string }> {
        return from(this.getMaintenanceStatusFn()).pipe(
            map(result => result.data)
        );
    }
}
