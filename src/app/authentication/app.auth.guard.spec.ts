import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { authGuard } from './app.auth.guard';
import { AppAuthService } from './app.auth.service';
import { LoggerService } from '../services/logger.service';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { of, Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';

describe('authGuard', () => {
    let router: Router;
    let authServiceStub: any;
    let snackBarSpy: any;

    beforeEach(() => {
        authServiceStub = {
            authState$: of(null),
            redirectUrl: null
        };

        const routerSpy = {
            createUrlTree: vi.fn().mockImplementation((commands) => ({
                toString: () => commands.join('/')
            })),
            navigate: vi.fn()
        };

        snackBarSpy = {
            open: vi.fn()
        };

        const loggerSpy = {
            log: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            captureException: vi.fn(),
            captureMessage: vi.fn(),
            setUser: vi.fn(),
            setTag: vi.fn()
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: AppAuthService, useValue: authServiceStub },
                { provide: Router, useValue: routerSpy },
                { provide: MatSnackBar, useValue: snackBarSpy },
                { provide: LoggerService, useValue: loggerSpy }
            ]
        });

        router = TestBed.inject(Router);
    });

    const runGuard = async (authUser: any) => {
        authServiceStub.authState$ = of(authUser);
        const result = TestBed.runInInjectionContext(() => authGuard({} as any, [{ path: 'test' }] as any) as Observable<boolean>);
        return await firstValueFrom(result);
    };

    it('should allow access if user is logged in', async () => {
        const result = await runGuard({ uid: '123' });
        expect(result).toBe(true);
        expect(authServiceStub.redirectUrl).toBeNull();
    });

    it('should redirect to login if user is not logged in', async () => {
        const result = await runGuard(null);

        // Expect UrlTree
        expect(result).not.toBe(true);
        expect(result).not.toBe(false);
        expect((result as any).toString()).toContain('/login');

        expect(snackBarSpy.open).toHaveBeenCalledWith('You must login first', undefined, { duration: 2000 });
        expect(authServiceStub.redirectUrl).toBe('/test');
    });
});
