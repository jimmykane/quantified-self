import { TestBed } from '@angular/core/testing';
import { authGuard } from './app.auth.guard';
import { AppAuthService } from './app.auth.service';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

describe('authGuard', () => {
    let routerMock: jasmine.SpyObj<Router>;
    let snackBarMock: jasmine.SpyObj<MatSnackBar>;

    beforeEach(() => {
        routerMock = jasmine.createSpyObj('Router', ['navigate']);
        snackBarMock = jasmine.createSpyObj('MatSnackBar', ['open']);
    });

    it('should redirect to login when user is not authenticated', (done) => {
        const authServiceMock = {
            user$: of(null),
            redirectUrl: null as string | null
        };

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: AppAuthService, useValue: authServiceMock },
                { provide: Router, useValue: routerMock },
                { provide: MatSnackBar, useValue: snackBarMock }
            ]
        });

        TestBed.runInInjectionContext(() => {
            const result$ = authGuard(
                { path: 'dashboard' } as any,
                [{ path: 'dashboard' }] as any
            );

            if (result$ && typeof (result$ as any).subscribe === 'function') {
                (result$ as any).subscribe((allowed: boolean) => {
                    expect(allowed).toBeFalse();
                    expect(routerMock.navigate).toHaveBeenCalledWith(['/login']);
                    expect(snackBarMock.open).toHaveBeenCalled();
                    done();
                });
            } else {
                fail('Expected observable result');
            }
        });
    });

    it('should allow access when user is authenticated', (done) => {
        const authenticatedUserMock = {
            user$: of({ uid: '123', displayName: 'Test User' }),
            redirectUrl: null as string | null
        };

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: AppAuthService, useValue: authenticatedUserMock },
                { provide: Router, useValue: routerMock },
                { provide: MatSnackBar, useValue: snackBarMock }
            ]
        });

        TestBed.runInInjectionContext(() => {
            const result$ = authGuard(
                { path: 'dashboard' } as any,
                [{ path: 'dashboard' }] as any
            );

            if (result$ && typeof (result$ as any).subscribe === 'function') {
                (result$ as any).subscribe((allowed: boolean) => {
                    expect(allowed).toBeTrue();
                    expect(routerMock.navigate).not.toHaveBeenCalled();
                    done();
                });
            } else {
                fail('Expected observable result');
            }
        });
    });
});
