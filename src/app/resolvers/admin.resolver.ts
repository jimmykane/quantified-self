import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { AdminService, AdminUser, ListUsersParams } from '../services/admin.service';
import { LoggerService } from '../services/logger.service';
import { forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

export interface AdminResolverData {
    usersData: { users: AdminUser[], totalCount: number };
    userStats: { total: number, pro: number, basic: number, free: number, providers: Record<string, number> } | null;
}

export const adminResolver: ResolveFn<AdminResolverData> = (route, state) => {
    const adminService = inject(AdminService);
    const logger = inject(LoggerService);

    // Initial load parameters
    const initialParams: ListUsersParams = {
        page: 0,
        pageSize: 10,
        sortField: 'email',
        sortDirection: 'asc'
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
        )
    }).pipe(
        map(result => result as AdminResolverData)
    );
};
