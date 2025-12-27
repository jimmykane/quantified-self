import { TestBed } from '@angular/core/testing';
import { ResolveFn, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AdminService } from '../services/admin.service';
import { adminResolver, AdminResolverData } from './admin.resolver';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('adminResolver', () => {
    const executeResolver: ResolveFn<AdminResolverData> = (...resolverParameters) =>
        TestBed.runInInjectionContext(() => adminResolver(...resolverParameters));

    let adminServiceSpy: any;

    beforeEach(() => {
        adminServiceSpy = {
            getUsers: vi.fn(),
            getTotalUserCount: vi.fn()
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: AdminService, useValue: adminServiceSpy }
            ]
        });
    });

    it('should be created', () => {
        expect(executeResolver).toBeTruthy();
    });

    it('should resolve with users and stats on success', () => new Promise<void>(done => {
        const mockUsers = { users: [{ email: 'test@test.com' }], totalCount: 1 };
        const mockStats = { total: 10, pro: 5, basic: 5 };

        adminServiceSpy.getUsers.mockReturnValue(of(mockUsers));
        adminServiceSpy.getTotalUserCount.mockReturnValue(of(mockStats));

        const route = new ActivatedRouteSnapshot();
        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: AdminResolverData) => {
            expect(result.usersData).toEqual(mockUsers);
            expect(result.userStats).toEqual(mockStats);
            expect(adminServiceSpy.getUsers).toHaveBeenCalled();
            expect(adminServiceSpy.getTotalUserCount).toHaveBeenCalled();
            done();
        });
    }));

    it('should handle errors gracefully and return empty/null data', () => new Promise<void>(done => {
        adminServiceSpy.getUsers.mockReturnValue(throwError(() => new Error('Failed to fetch users')));
        adminServiceSpy.getTotalUserCount.mockReturnValue(throwError(() => new Error('Failed to fetch stats')));

        const route = new ActivatedRouteSnapshot();
        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: AdminResolverData) => {
            expect(result.usersData).toEqual({ users: [], totalCount: 0 }); // Fallback value
            expect(result.userStats).toBeNull(); // Fallback value
            done();
        });
    }));
});
