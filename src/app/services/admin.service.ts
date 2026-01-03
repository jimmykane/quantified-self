import { inject, Injectable, EnvironmentInjector } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
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
    stuck: number;
    providers: {
        name: string;
        pending: number;
        succeeded: number;
        stuck: number;
        dead: number;
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

    private getUserCountFn = httpsCallableFromURL<void, { count: number; total: number; pro: number; basic: number; free: number; providers: Record<string, number> }>(
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


    getTotalUserCount(): Observable<{ total: number; pro: number; basic: number; free: number; providers: Record<string, number> }> {
        return from(this.getUserCountFn()).pipe(
            map(result => ({
                total: result.data.total ?? result.data.count, // Fallback for safety
                pro: result.data.pro ?? 0,
                basic: result.data.basic ?? 0,
                free: result.data.free ?? 0,
                providers: result.data.providers || {}
            }))
        );
    }

    // Maintenance mode
    private setMaintenanceModeFn = httpsCallableFromURL<
        { enabled: boolean; message?: string; env?: 'prod' | 'beta' | 'dev' },
        { success: boolean; enabled: boolean; message: string; env: 'prod' | 'beta' | 'dev' }
    >(this.functions, environment.functions.setMaintenanceMode);

    private getMaintenanceStatusFn = httpsCallableFromURL<
        void,
        {
            prod: { enabled: boolean; message: string; updatedAt?: unknown; updatedBy?: string };
            beta: { enabled: boolean; message: string; updatedAt?: unknown; updatedBy?: string };
            dev: { enabled: boolean; message: string; updatedAt?: unknown; updatedBy?: string };
        }
    >(this.functions, environment.functions.getMaintenanceStatus);

    setMaintenanceMode(enabled: boolean, message: string, env: 'prod' | 'beta' | 'dev'): Observable<{ success: boolean; enabled: boolean; message: string; env: 'prod' | 'beta' | 'dev' }> {
        return from(this.setMaintenanceModeFn({ enabled, message, env })).pipe(
            map(result => result.data)
        );
    }

    getMaintenanceStatus(): Observable<{
        prod: { enabled: boolean; message: string; updatedAt?: unknown; updatedBy?: string };
        beta: { enabled: boolean; message: string; updatedAt?: unknown; updatedBy?: string };
        dev: { enabled: boolean; message: string; updatedAt?: unknown; updatedBy?: string };
    }> {
        return from(this.getMaintenanceStatusFn()).pipe(
            map(result => result.data)
        );
    }
}
