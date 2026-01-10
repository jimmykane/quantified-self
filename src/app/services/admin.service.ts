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

export interface FinancialStats {
    revenue: {
        total: number; // in cents
        currency: string;
        invoiceCount: number;
    };
    cost: {
        billingAccountId: string | null;
        projectId: string;
        reportUrl: string | null;
        currency: string;
        total: number | null;
        lastUpdated?: string;
        budget: { amount: number; currency: string } | null;
        advice?: string;
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

    private getQueueStatsFn = httpsCallableFromURL<{ includeAnalysis?: boolean }, QueueStats>(
        this.functions,
        environment.functions.getQueueStats
    );

    private injector = inject(EnvironmentInjector);

    private getUserCountFn = httpsCallableFromURL<void, { count: number; total: number; pro: number; basic: number; free: number; providers: Record<string, number> }>(
        this.functions,
        environment.functions.getUserCount
    );

    private getFinancialStatsFn = httpsCallableFromURL<void, FinancialStats>(
        this.functions,
        environment.functions.getFinancialStats
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

    getQueueStats(includeAnalysis = true): Observable<QueueStats> {
        return from(this.getQueueStatsFn({ includeAnalysis })).pipe(
            map(result => result.data)
        );
    }

    getQueueStatsDirect(includeAnalysis = false): Observable<QueueStats> {
        const now = new Date();
        const currentMinutes = now.getMinutes();

        // Target: 11th minute of the hour
        const targetMinute = 11;

        const nextTarget = new Date(now);
        nextTarget.setSeconds(0);
        nextTarget.setMilliseconds(0);

        if (currentMinutes < targetMinute) {
            // Example: It's 10:05. Target 10:11.
            nextTarget.setMinutes(targetMinute);
        } else {
            // Example: It's 10:15. Target 11:11.
            nextTarget.setHours(now.getHours() + 1);
            nextTarget.setMinutes(targetMinute);
        }

        const initialDelay = nextTarget.getTime() - now.getTime();
        const period = 3600000; // 1 hour

        return timer(initialDelay, period).pipe(
            switchMap(() => from(this.getQueueStatsFn({ includeAnalysis }))),
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

    getFinancialStats(): Observable<FinancialStats> {
        return from(this.getFinancialStatsFn()).pipe(
            map(result => result.data)
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

    private impersonateUserFn = httpsCallableFromURL<
        { uid: string },
        { token: string }
    >(this.functions, environment.functions.impersonateUser);

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

    impersonateUser(uid: string): Observable<{ token: string }> {
        return from(this.impersonateUserFn({ uid })).pipe(
            map(result => result.data)
        );
    }
}
