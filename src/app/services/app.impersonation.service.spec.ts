import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppAuthService } from '../authentication/app.auth.service';
import { AppImpersonationService } from './app.impersonation.service';
import { AdminService } from './admin.service';
import { AppFunctionsService } from './app.functions.service';
import { AppHapticsService } from './app.haptics.service';
import { AppUserService } from './app.user.service';
import { AppWindowService } from './app.window.service';
import { LoggerService } from './logger.service';

describe('AppImpersonationService', () => {
    const userSignal = signal<any>(null);
    const adminServiceMock = {
        impersonateUser: vi.fn()
    };
    const authServiceMock = {
        currentUser: null as any,
        loginWithCustomToken: vi.fn()
    };
    const functionsServiceMock = {
        call: vi.fn()
    };
    const windowServiceMock = {
        windowRef: {
            location: {
                assign: vi.fn()
            }
        }
    };
    const snackBarMock = {
        open: vi.fn()
    };
    const loggerMock = {
        error: vi.fn()
    };
    const hapticsMock = {
        selection: vi.fn()
    };

    let service: AppImpersonationService;

    beforeEach(() => {
        vi.clearAllMocks();
        userSignal.set(null);
        authServiceMock.currentUser = null;
        adminServiceMock.impersonateUser.mockReturnValue(of({ token: 'custom-token' }));
        authServiceMock.loginWithCustomToken.mockResolvedValue(undefined);
        functionsServiceMock.call.mockResolvedValue({
            data: {
                token: 'admin-token'
            }
        });

        TestBed.configureTestingModule({
            providers: [
                AppImpersonationService,
                { provide: AppUserService, useValue: { user: userSignal } },
                { provide: AdminService, useValue: adminServiceMock },
                { provide: AppAuthService, useValue: authServiceMock },
                { provide: AppFunctionsService, useValue: functionsServiceMock },
                { provide: AppWindowService, useValue: windowServiceMock },
                { provide: MatSnackBar, useValue: snackBarMock },
                { provide: LoggerService, useValue: loggerMock },
                { provide: AppHapticsService, useValue: hapticsMock }
            ]
        });

        service = TestBed.inject(AppImpersonationService);
    });

    it('should derive impersonation session from the current user claim', () => {
        expect(service.session()).toBeNull();
        expect(service.isImpersonating()).toBe(false);

        userSignal.set({
            uid: 'user-1',
            email: 'user@example.com',
            impersonatedBy: 'admin-uid'
        });

        expect(service.session()).toEqual({
            impersonatedBy: 'admin-uid',
            label: 'user@example.com'
        });
        expect(service.isImpersonating()).toBe(true);
    });

    it('should resolve the label fallback as email, then displayName, then uid, then generic copy', () => {
        userSignal.set({
            uid: 'user-1',
            email: 'user@example.com',
            displayName: 'User One',
            impersonatedBy: 'admin-uid'
        });
        expect(service.session()?.label).toBe('user@example.com');

        userSignal.set({
            uid: 'user-1',
            email: '   ',
            displayName: 'User One',
            impersonatedBy: 'admin-uid'
        });
        expect(service.session()?.label).toBe('User One');

        userSignal.set({
            uid: 'user-1',
            email: null,
            displayName: '   ',
            impersonatedBy: 'admin-uid'
        });
        expect(service.session()?.label).toBe('user-1');

        userSignal.set({
            uid: '   ',
            email: null,
            displayName: null,
            impersonatedBy: 'admin-uid'
        });
        expect(service.session()?.label).toBe('this account');
    });

    it('should start impersonation by requesting a token, signing in, and redirecting to the dashboard', async () => {
        await service.startImpersonation({
            uid: 'user-1',
            email: 'user@example.com',
            displayName: 'User One'
        });

        expect(adminServiceMock.impersonateUser).toHaveBeenCalledWith('user-1');
        expect(authServiceMock.loginWithCustomToken).toHaveBeenCalledWith('custom-token');
        expect(windowServiceMock.windowRef.location.assign).toHaveBeenCalledWith('/dashboard');
    });

    it('should surface a user-facing error when impersonation start fails', async () => {
        adminServiceMock.impersonateUser.mockReturnValue(throwError(() => ({
            message: 'CORS preflight failed'
        })));

        await expect(service.startImpersonation({ uid: 'user-1' })).rejects.toEqual({
            message: 'CORS preflight failed'
        });

        expect(loggerMock.error).toHaveBeenCalledWith('[Impersonation] startImpersonation error:', {
            message: 'CORS preflight failed'
        });
        expect(snackBarMock.open).toHaveBeenCalledWith(
            'Impersonation failed. This usually happens if the backend function is not deployed or accessible.',
            'Close',
            {
                duration: 5000,
                panelClass: ['error-snackbar']
            }
        );
    });

    it('should return to admin by stopping impersonation, signing in, and redirecting to admin', async () => {
        authServiceMock.currentUser = { uid: 'impersonated-user' };
        userSignal.set({
            uid: 'user-1',
            email: 'user@example.com',
            impersonatedBy: 'admin-uid'
        });

        await service.returnToAdmin();

        expect(hapticsMock.selection).toHaveBeenCalled();
        expect(functionsServiceMock.call).toHaveBeenCalledWith('stopImpersonation');
        expect(authServiceMock.loginWithCustomToken).toHaveBeenCalledWith('admin-token');
        expect(windowServiceMock.windowRef.location.assign).toHaveBeenCalledWith('/admin');
        expect(service.isReturning()).toBe(false);
    });

    it('should reject return-to-admin when there is no authenticated user', async () => {
        userSignal.set({
            uid: 'user-1',
            impersonatedBy: 'admin-uid'
        });

        await expect(service.returnToAdmin()).rejects.toThrow('Cannot return to admin without an authenticated user.');

        expect(functionsServiceMock.call).not.toHaveBeenCalled();
        expect(snackBarMock.open).not.toHaveBeenCalled();
    });

    it('should reject return-to-admin when the current session is not impersonated', async () => {
        authServiceMock.currentUser = { uid: 'admin-user' };
        userSignal.set({
            uid: 'admin-user'
        });

        await expect(service.returnToAdmin()).rejects.toThrow('Current session is not impersonating another user.');

        expect(functionsServiceMock.call).not.toHaveBeenCalled();
        expect(snackBarMock.open).toHaveBeenCalledWith(
            'Could not return to admin: Current session is not impersonating another user.',
            'Close',
            { duration: 4000 }
        );
    });

    it('should reset return state and surface callable failures', async () => {
        const stopImpersonation$ = createDeferred<{ data: { token: string } }>();
        authServiceMock.currentUser = { uid: 'impersonated-user' };
        userSignal.set({
            uid: 'user-1',
            impersonatedBy: 'admin-uid'
        });
        functionsServiceMock.call.mockReturnValue(stopImpersonation$.promise);

        const restorePromise = service.returnToAdmin();
        expect(service.isReturning()).toBe(true);

        stopImpersonation$.reject(new Error('restore failed'));

        await expect(restorePromise).rejects.toThrow('restore failed');
        expect(service.isReturning()).toBe(false);
        expect(snackBarMock.open).toHaveBeenCalledWith(
            'Could not return to admin: restore failed',
            'Close',
            { duration: 4000 }
        );
    });

    it('should no-op a second return request while one is already in progress', async () => {
        const stopImpersonation$ = createDeferred<{ data: { token: string } }>();
        authServiceMock.currentUser = { uid: 'impersonated-user' };
        userSignal.set({
            uid: 'user-1',
            impersonatedBy: 'admin-uid'
        });
        functionsServiceMock.call.mockReturnValue(stopImpersonation$.promise);

        const firstRequest = service.returnToAdmin();
        const secondRequest = service.returnToAdmin();

        expect(functionsServiceMock.call).toHaveBeenCalledTimes(1);

        stopImpersonation$.resolve({
            data: {
                token: 'admin-token'
            }
        });

        await Promise.all([firstRequest, secondRequest]);
    });
});

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;

    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return {
        promise,
        resolve,
        reject
    };
}
