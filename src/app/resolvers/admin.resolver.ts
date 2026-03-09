import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import {
    AdminService,
    AdminUser,
    ListUsersParams,
    SubscriptionHistoryTrendResponse,
    UserCountStats,
    UserGrowthTrendResponse
} from '../services/admin.service';
import { LoggerService } from '../services/logger.service';
import { forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

export interface AdminResolverData {
    usersData: { users: AdminUser[], totalCount: number };
    userStats: UserCountStats | null;
    userGrowthTrend: UserGrowthTrendResponse | null;
    subscriptionHistoryTrend: SubscriptionHistoryTrendResponse | null;
}

export const adminResolver: ResolveFn<AdminResolverData> = (route, state) => {
    const adminService = inject(AdminService);
    const logger = inject(LoggerService);

    // Initial load parameters
    const initialParams: ListUsersParams = {
        page: 0,
        pageSize: 10,
        sortField: 'created',
        sortDirection: 'desc'
    };

    return forkJoin({
        usersData: adminService.getUsers(initialParams).pipe(
            catchError(error => {
                logger.error('AdminResolver: Failed to load users', error);
                return of({ users: [], totalCount: 0 });
            })
        ),
        userStats: adminService.getTotalUserCount().pipe(
            catchError(error => {
                logger.error('AdminResolver: Failed to load stats', error);
                return of(null);
            })
        ),
        userGrowthTrend: adminService.getUserGrowthTrend(12).pipe(
            catchError(error => {
                logger.error('AdminResolver: Failed to load user growth trend', error);
                return of(null);
            })
        ),
        subscriptionHistoryTrend: adminService.getSubscriptionHistoryTrend(12).pipe(
            catchError(error => {
                logger.error('AdminResolver: Failed to load subscription history trend', error);
                return of(null);
            })
        )
    }).pipe(
        map(result => result as AdminResolverData)
    );
};
