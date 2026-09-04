import { TestBed } from '@angular/core/testing';
import { AppUserService, isActionableProfileReadState } from './app.user.service';
import { Auth, authState, user } from 'app/firebase/auth';
import { Firestore, collectionData, doc, docData, setDoc, updateDoc } from 'app/firebase/firestore';

import { HttpClient } from '@angular/common/http';
import { AppEventService } from './app.event.service';
import { AppWindowService } from './app.window.service';
import { AppUserInterface } from '../models/app-user.interface';
import { AppUserUtilities } from '../utils/app.user.utilities';
import { of, firstValueFrom, take, from, filter, Observable, Subject, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataAltitude, DataCadence, DataGradeAdjustedSpeed, DataHeartRate, DataPace, DataPotentialStamina, DataPower, DataSpeed, DataStamina, ServiceNames } from '@sports-alliance/sports-lib';
import { LoggerService } from './logger.service';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS } from '@shared/route-delivery-sync-routes';
import { getAppCanonicalChartDataTypes } from '../helpers/app-chart-data-types.helper';

vi.mock('app/firebase/auth', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        authState: vi.fn(),
        user: vi.fn(),
    };
});

vi.mock('app/firebase/firestore', async (importOriginal) => {
    const actual: any = await importOriginal();
    const { of } = await import('rxjs');
    return {
        ...actual,
        doc: vi.fn().mockReturnValue({}),
        collection: vi.fn().mockReturnValue({}),
        docData: vi.fn().mockReturnValue(of({})),
        collectionData: vi.fn().mockReturnValue(of([])),
        setDoc: vi.fn().mockResolvedValue(undefined),
        updateDoc: vi.fn().mockResolvedValue(undefined),
    };
});

import { AppFunctionsService } from './app.functions.service';

describe('AppUserService', () => {
    let service: AppUserService;
    let mockAuth: any;
    let mockFunctionsService: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (authState as any).mockImplementation((auth: any) => of(auth?.currentUser || null));
        (user as any).mockImplementation((auth: any) => of(auth?.currentUser || null));
        (docData as any).mockReset();
        (docData as any).mockReturnValue(of({}));
        (collectionData as any).mockReset();
        (collectionData as any).mockReturnValue(of([]));
        (setDoc as any).mockReset();
        (setDoc as any).mockResolvedValue(undefined);
        (updateDoc as any).mockReset();
        (updateDoc as any).mockResolvedValue(undefined);

        mockAuth = {
            currentUser: {
                getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
                getIdToken: vi.fn().mockResolvedValue('test-token'),
                uid: 'u1',
                email: 'test@example.com',
                displayName: 'Test User',
                photoURL: 'https://example.com/photo.jpg',
                emailVerified: true,
                metadata: {
                    creationTime: new Date().toISOString(),
                    lastSignInTime: new Date().toISOString()
                }
            },
            signOut: vi.fn().mockResolvedValue(undefined),
            onIdTokenChanged: vi.fn().mockReturnValue(() => { }),
        };

        mockFunctionsService = {
            call: vi.fn().mockResolvedValue({ success: true })
        };

        TestBed.configureTestingModule({
            providers: [
                AppUserService,
                { provide: Auth, useValue: mockAuth },
                { provide: Firestore, useValue: {} },
                { provide: AppFunctionsService, useValue: mockFunctionsService },
                { provide: HttpClient, useValue: {} },
                { provide: AppEventService, useValue: { getUserEvents: vi.fn().mockReturnValue(of([])) } },
                { provide: AppWindowService, useValue: { currentDomain: 'http://localhost' } }
            ]
        });
    });

    afterEach(() => {
        TestBed.resetTestingModule();
    });

    it('should be created', () => {
        service = TestBed.inject(AppUserService);
        expect(service).toBeTruthy();
    });

    it('should classify terminal, timed-out, and repeatedly failing profile reads as actionable', () => {
        expect(isActionableProfileReadState({ status: 'error', uid: 'u1', code: 'permission-denied' })).toBe(true);
        expect(isActionableProfileReadState({
            status: 'recovering', uid: 'u1', attempt: 1, code: 'deadline-exceeded'
        })).toBe(true);
        expect(isActionableProfileReadState({
            status: 'recovering', uid: 'u1', attempt: 3, code: 'permission-denied'
        })).toBe(false);
        expect(isActionableProfileReadState({
            status: 'recovering', uid: 'u1', attempt: 4, code: 'permission-denied'
        })).toBe(true);
    });

    it('should surface impersonatedBy from auth claims on the merged user', async () => {
        mockAuth.currentUser.getIdTokenResult.mockResolvedValue({
            claims: {
                impersonatedBy: 'admin-uid'
            }
        });

        service = TestBed.inject(AppUserService);
        const mergedUser = await firstValueFrom(service.user$.pipe(filter((user): user is AppUserInterface => !!user), take(1)));

        expect(mergedUser.impersonatedBy).toBe('admin-uid');
    });

    it('should clear stale impersonatedBy when the auth claim is absent', async () => {
        (docData as any).mockReturnValue(of({
            impersonatedBy: 'admin-uid'
        }));
        mockAuth.currentUser.getIdTokenResult.mockResolvedValue({
            claims: {}
        });

        service = TestBed.inject(AppUserService);
        const mergedUser = await firstValueFrom(service.user$.pipe(filter((user): user is AppUserInterface => !!user), take(1)));

        expect(mergedUser.impersonatedBy).toBeUndefined();
    });

    it('should merge auth metadata dates onto existing database users', async () => {
        const creationTime = '2026-02-01T12:00:00.000Z';
        const lastSignInTime = '2026-03-01T13:30:00.000Z';

        mockAuth.currentUser.metadata = {
            creationTime,
            lastSignInTime
        };
        (docData as any)
            .mockReturnValueOnce(of({ acceptedPrivacyPolicy: true }))
            .mockReturnValueOnce(of({}))
            .mockReturnValueOnce(of({}))
            .mockReturnValueOnce(of({}));

        service = TestBed.inject(AppUserService);
        const mergedUser = await firstValueFrom(service.user$.pipe(filter((user): user is AppUserInterface => !!user), take(1)));

        expect(mergedUser.acceptedPrivacyPolicy).toBe(true);
        expect(mergedUser.creationDate).toEqual(new Date(creationTime));
        expect(mergedUser.lastSignInDate).toEqual(new Date(lastSignInTime));
    });

    it('should recover repeated permission-denied profile reads without emitting a synthetic user', async () => {
        const permissionDeniedError = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied'
        });
        let docDataCallCount = 0;

        (docData as any).mockImplementation(() => {
            docDataCallCount += 1;
            if (docDataCallCount === 1 || docDataCallCount === 5) {
                return throwError(() => permissionDeniedError);
            }

            if (docDataCallCount === 9) {
                return of({ uid: 'u1', email: 'authoritative@example.com' });
            }
            if (docDataCallCount === 10) {
                return of({
                    acceptedPrivacyPolicy: true,
                    acceptedDataPolicy: true,
                    acceptedTos: true,
                });
            }

            return of({});
        });

        vi.useFakeTimers();
        try {
            service = TestBed.inject(AppUserService);
            const emittedUsers: AppUserInterface[] = [];
            const recoveredUserPromise = firstValueFrom(service.user$.pipe(
                filter((profileUser): profileUser is AppUserInterface => !!profileUser),
                take(1)
            ));
            const subscription = service.user$.pipe(
                filter((profileUser): profileUser is AppUserInterface => !!profileUser)
            ).subscribe((profileUser) => emittedUsers.push(profileUser));

            await vi.runAllTimersAsync();
            const recoveredUser = await recoveredUserPromise;

            expect(mockAuth.currentUser.getIdToken).toHaveBeenCalledWith(true);
            expect(recoveredUser.email).toBe('authoritative@example.com');
            expect(recoveredUser.acceptedPrivacyPolicy).toBe(true);
            expect(recoveredUser.acceptedDataPolicy).toBe(true);
            expect(recoveredUser.acceptedTos).toBe(true);
            expect(emittedUsers).toEqual([recoveredUser]);
            expect(service.hasIncompleteProfileReads('u1')).toBe(false);
            expect(service.profileReadState()).toEqual({
                status: 'ready',
                uid: 'u1',
                profileExists: true,
            });
            expect(docData).toHaveBeenCalledWith(expect.anything(), { waitForServer: true });
            subscription.unsubscribe();
        } finally {
            vi.useRealTimers();
        }
    });

    it('should stop retrying and expose recovery after persistent permission-denied profile reads', async () => {
        const permissionDeniedError = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied'
        });
        const authStateSubject = new Subject<any>();
        (authState as any).mockReturnValue(authStateSubject);

        vi.useFakeTimers();
        try {
            service = TestBed.inject(AppUserService);
            const profileReadSpy = vi.spyOn(service, 'getUserByID').mockReturnValue(
                throwError(() => permissionDeniedError)
            );
            const emittedUsers: Array<AppUserInterface | null> = [];
            const subscription = service.user$.subscribe((profileUser) => emittedUsers.push(profileUser));
            const rolePromise = service.getSubscriptionRole();
            const proPromise = service.isPro();
            const paidAccessPromise = service.hasPaidAccess();
            const adminPromise = service.isAdmin();

            authStateSubject.next(mockAuth.currentUser);
            await vi.runAllTimersAsync();

            expect(profileReadSpy).toHaveBeenCalledTimes(5);
            expect(service.profileReadState()).toEqual({
                status: 'error',
                uid: 'u1',
                code: 'permission-denied',
            });
            expect(service.hasActionableProfileReadFailure()).toBe(true);
            expect(service.hasIncompleteProfileReads('u1')).toBe(true);
            expect(emittedUsers).toEqual([null]);
            await expect(rolePromise).resolves.toBeNull();
            await expect(proPromise).resolves.toBe(false);
            await expect(paidAccessPromise).resolves.toBe(false);
            await expect(adminPromise).resolves.toBe(false);
            subscription.unsubscribe();
        } finally {
            vi.useRealTimers();
        }
    });

    it('should reset profile retry backoff after each successful listener emission', async () => {
        const unavailableError = Object.assign(new Error('Service unavailable'), {
            code: 'unavailable'
        });
        let profileSubscriptionCount = 0;
        const authStateSubject = new Subject<any>();
        (authState as any).mockReturnValue(authStateSubject);

        vi.useFakeTimers();
        try {
            service = TestBed.inject(AppUserService);
            vi.spyOn(service, 'getUserByID').mockImplementation(() => new Observable<AppUserInterface | null>((subscriber) => {
                profileSubscriptionCount += 1;
                const version = profileSubscriptionCount;
                subscriber.next({ uid: 'u1', email: 'unchanged-profile@example.com' });

                if (version >= 3) {
                    return undefined;
                }

                const timeoutID = setTimeout(() => subscriber.error(unavailableError), 1);
                return () => clearTimeout(timeoutID);
            }));

            const recoveryAttempts: number[] = [];
            const emittedEmails: string[] = [];
            const stateSubscription = service.profileReadState$.subscribe((state) => {
                if (state.status === 'recovering') {
                    recoveryAttempts.push(state.attempt);
                }
            });
            const userSubscription = service.user$.pipe(
                filter((profileUser): profileUser is AppUserInterface => !!profileUser)
            ).subscribe((profileUser) => emittedEmails.push(profileUser.email || ''));

            authStateSubject.next(mockAuth.currentUser);
            await vi.runAllTimersAsync();

            expect(profileSubscriptionCount).toBe(3);
            expect(recoveryAttempts).toEqual([1, 1]);
            expect(emittedEmails).toEqual([
                'unchanged-profile@example.com',
                'unchanged-profile@example.com',
                'unchanged-profile@example.com',
            ]);
            stateSubscription.unsubscribe();
            userSubscription.unsubscribe();
        } finally {
            vi.useRealTimers();
        }
    });

    it('should keep the profile recovery gate closed until a transient claim read recovers', async () => {
        const authStateSubject = new Subject<any>();
        const claimReadError = Object.assign(new Error('Network unavailable'), {
            code: 'auth/network-request-failed'
        });
        (authState as any).mockReturnValue(authStateSubject);
        mockAuth.currentUser.getIdTokenResult
            .mockResolvedValueOnce({ claims: {} })
            .mockRejectedValueOnce(claimReadError)
            .mockResolvedValue({ claims: {} });

        vi.useFakeTimers();
        try {
            service = TestBed.inject(AppUserService);
            const emittedUsers: AppUserInterface[] = [];
            const emittedErrors: unknown[] = [];
            const subscription = service.user$.pipe(
                filter((profileUser): profileUser is AppUserInterface => !!profileUser)
            ).subscribe({
                next: (profileUser) => emittedUsers.push(profileUser),
                error: (error) => emittedErrors.push(error),
            });

            authStateSubject.next(mockAuth.currentUser);
            await vi.advanceTimersByTimeAsync(0);

            expect(emittedUsers).toEqual([]);
            expect(service.hasIncompleteProfileReads('u1')).toBe(true);
            expect(service.profileReadState()).toEqual(expect.objectContaining({
                status: 'recovering',
                uid: 'u1',
                code: 'auth/network-request-failed',
            }));

            await vi.advanceTimersByTimeAsync(750);

            expect(emittedUsers).toHaveLength(1);
            expect(emittedErrors).toEqual([]);
            expect(service.hasIncompleteProfileReads('u1')).toBe(false);
            expect(service.profileReadState()).toEqual({
                status: 'ready',
                uid: 'u1',
                profileExists: true,
            });
            subscription.unsubscribe();
        } finally {
            vi.useRealTimers();
        }
    });

    it('should contain a non-recoverable claim read error without poisoning the user stream', async () => {
        const authStateSubject = new Subject<any>();
        (authState as any).mockReturnValue(authStateSubject);
        mockAuth.currentUser.getIdTokenResult.mockRejectedValue(new Error('Malformed token result'));

        service = TestBed.inject(AppUserService);
        const emittedUsers: Array<AppUserInterface | null> = [];
        const emittedErrors: unknown[] = [];
        const subscription = service.user$.subscribe({
            next: (profileUser) => emittedUsers.push(profileUser),
            error: (error) => emittedErrors.push(error),
        });

        authStateSubject.next(mockAuth.currentUser);
        await Promise.resolve();
        await Promise.resolve();

        expect(emittedErrors).toEqual([]);
        expect(emittedUsers).toEqual([null]);
        expect(service.hasIncompleteProfileReads('u1')).toBe(true);
        expect(service.profileReadState()).toEqual({
            status: 'error',
            uid: 'u1',
            code: null,
        });
        expect(() => service.user()).not.toThrow();
        expect(service.user()).toBeNull();
        subscription.unsubscribe();
    });

    it('should not republish a stale profile when auth refresh emits during profile recovery', async () => {
        const permissionDeniedError = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied'
        });
        const authStateSubject = new Subject<any>();
        const tokenUserSubject = new Subject<any>();
        let recoveredProfileSubscriber: any;
        let profileSubscriptionCount = 0;
        (authState as any).mockReturnValue(authStateSubject);
        (user as any).mockReturnValue(tokenUserSubject);
        mockAuth.currentUser.getIdToken.mockImplementation(async (forceRefresh?: boolean) => {
            if (forceRefresh) {
                tokenUserSubject.next(mockAuth.currentUser);
            }
            return 'test-token';
        });

        vi.useFakeTimers();
        try {
            service = TestBed.inject(AppUserService);
            vi.spyOn(service, 'getUserByID').mockImplementation(() => new Observable<AppUserInterface | null>((subscriber) => {
                profileSubscriptionCount += 1;
                if (profileSubscriptionCount === 1) {
                    subscriber.next({
                        uid: 'u1',
                        email: 'stale-profile@example.com',
                        acceptedPrivacyPolicy: true,
                    });
                    const timeoutID = setTimeout(() => subscriber.error(permissionDeniedError), 1);
                    return () => clearTimeout(timeoutID);
                }

                recoveredProfileSubscriber = subscriber;
                return undefined;
            }));
            const emittedEmails: string[] = [];
            const subscription = service.user$.pipe(
                filter((profileUser): profileUser is AppUserInterface => !!profileUser)
            ).subscribe((profileUser) => emittedEmails.push(profileUser.email || ''));

            authStateSubject.next(mockAuth.currentUser);
            tokenUserSubject.next(mockAuth.currentUser);
            await vi.advanceTimersByTimeAsync(0);

            expect(emittedEmails).toEqual(['stale-profile@example.com']);

            await vi.advanceTimersByTimeAsync(1);

            expect(mockAuth.currentUser.getIdToken).toHaveBeenCalledWith(true);
            expect(emittedEmails).toEqual(['stale-profile@example.com']);
            expect(service.hasIncompleteProfileReads('u1')).toBe(true);
            expect(service.profileReadState()).toEqual(expect.objectContaining({
                status: 'recovering',
                uid: 'u1',
            }));

            await vi.advanceTimersByTimeAsync(750);
            recoveredProfileSubscriber.next({
                uid: 'u1',
                email: 'recovered-profile@example.com',
                acceptedPrivacyPolicy: true,
            });
            await vi.advanceTimersByTimeAsync(0);

            expect(emittedEmails).toEqual([
                'stale-profile@example.com',
                'recovered-profile@example.com',
            ]);
            expect(service.hasIncompleteProfileReads('u1')).toBe(false);
            expect(service.profileReadState()).toEqual({
                status: 'ready',
                uid: 'u1',
                profileExists: true,
            });
            subscription.unsubscribe();
        } finally {
            vi.useRealTimers();
        }
    });

    it('should recover from sub-document read failures without leaving incomplete flag set', async () => {
        const unavailableError = Object.assign(new Error('Service unavailable'), {
            code: 'unavailable'
        });

        (authState as any).mockReturnValue(of(null));
        (user as any).mockReturnValue(of(null));
        (docData as any)
            .mockReturnValueOnce(of({ uid: 'u1' }))
            .mockReturnValueOnce(throwError(() => unavailableError))
            .mockReturnValueOnce(of({}))
            .mockReturnValueOnce(throwError(() => unavailableError));

        service = TestBed.inject(AppUserService);
        const loadedUser = await firstValueFrom(service.getUserByID('u1').pipe(take(1)));

        expect(loadedUser?.uid).toBe('u1');
        expect(service.hasIncompleteProfileReads('u1')).toBe(false);
    });

    it('should not let a non-authoritative profile lookup clear the current-user recovery gate', async () => {
        (authState as any).mockReturnValue(of(null));
        (user as any).mockReturnValue(of(null));
        (docData as any).mockReturnValue(of({ uid: 'u1' }));

        service = TestBed.inject(AppUserService);
        (service as any).markIncompleteProfileRead('u1');

        await firstValueFrom(service.getUserByID('u1').pipe(take(1)));

        expect(service.hasIncompleteProfileReads('u1')).toBe(true);
    });

    it('should retry a transient legal-document failure without treating consent as missing', async () => {
        const unavailableError = Object.assign(new Error('Service unavailable'), {
            code: 'unavailable'
        });
        let docDataCallCount = 0;

        (docData as any).mockImplementation(() => {
            docDataCallCount += 1;
            if (docDataCallCount === 1 || docDataCallCount === 5) {
                return of({ uid: 'u1', email: 'transient-recovered@example.com' });
            }
            if (docDataCallCount === 2) {
                return throwError(() => unavailableError);
            }
            if (docDataCallCount === 6) {
                return of({
                    acceptedPrivacyPolicy: true,
                    acceptedDataPolicy: true,
                    acceptedTos: true,
                });
            }
            return of({});
        });

        vi.useFakeTimers();
        try {
            service = TestBed.inject(AppUserService);
            const mergedUserPromise = firstValueFrom(service.user$.pipe(
                filter((profileUser): profileUser is AppUserInterface => !!profileUser),
                take(1)
            ));

            await vi.runAllTimersAsync();
            const mergedUser = await mergedUserPromise;

            expect(mergedUser.email).toBe('transient-recovered@example.com');
            expect(mergedUser.acceptedPrivacyPolicy).toBe(true);
            expect(mergedUser.acceptedDataPolicy).toBe(true);
            expect(mergedUser.acceptedTos).toBe(true);
            expect(mockAuth.currentUser.getIdToken).not.toHaveBeenCalledWith(true);
            expect(service.hasIncompleteProfileReads('u1')).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('should refresh the auth token and retry when a legal sub-document read is permission-denied during current-user loading', async () => {
        const permissionDeniedError = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied'
        });
        const logger = TestBed.inject(LoggerService);
        const loggerErrorSpy = vi.spyOn(logger, 'error');
        let docDataCallCount = 0;

        (docData as any).mockImplementation(() => {
            docDataCallCount += 1;

            if (docDataCallCount === 1 || docDataCallCount === 5) {
                return of({ uid: 'u1', acceptedPrivacyPolicy: false });
            }
            if (docDataCallCount === 2) {
                return throwError(() => permissionDeniedError);
            }
            if (docDataCallCount === 6) {
                return of({
                    acceptedPrivacyPolicy: true,
                    acceptedDataPolicy: true,
                    acceptedTos: true,
                });
            }

            return of({});
        });

        service = TestBed.inject(AppUserService);
        const mergedUser = await firstValueFrom(service.user$.pipe(filter((user): user is AppUserInterface => !!user), take(1)));

        expect(mockAuth.currentUser.getIdToken).toHaveBeenCalledWith();
        expect(mockAuth.currentUser.getIdToken).toHaveBeenCalledWith(true);
        expect(mergedUser.acceptedPrivacyPolicy).toBe(true);
        expect(mergedUser.acceptedDataPolicy).toBe(true);
        expect(mergedUser.acceptedTos).toBe(true);
        expect(service.hasIncompleteProfileReads('u1')).toBe(false);
        expect(loggerErrorSpy).not.toHaveBeenCalledWith(
            '[AppUserService] Error fetching legal doc',
            expect.anything(),
            expect.anything()
        );
    });

    it('should remain in recovery instead of emitting a synthetic user while transient failures persist', async () => {
        const unavailableError = Object.assign(new Error('Service unavailable'), {
            code: 'unavailable'
        });
        let docDataCallCount = 0;

        (docData as any).mockImplementation(() => {
            docDataCallCount += 1;
            if ((docDataCallCount - 1) % 4 === 0) {
                return throwError(() => unavailableError);
            }

            return of({});
        });

        vi.useFakeTimers();
        try {
            service = TestBed.inject(AppUserService);
            const emittedUsers: AppUserInterface[] = [];
            const subscription = service.user$.pipe(
                filter((profileUser): profileUser is AppUserInterface => !!profileUser)
            ).subscribe((profileUser) => emittedUsers.push(profileUser));

            await vi.advanceTimersByTimeAsync(2400);

            expect(docDataCallCount).toBeGreaterThanOrEqual(12);
            expect(emittedUsers).toEqual([]);
            expect(service.hasIncompleteProfileReads('u1')).toBe(true);
            expect(service.profileReadState()).toEqual(expect.objectContaining({
                status: 'recovering',
                uid: 'u1',
                code: 'unavailable',
            }));
            subscription.unsubscribe();
        } finally {
            vi.useRealTimers();
        }
    });

    it('should create a synthetic onboarding user only after a confirmed missing profile', async () => {
        (docData as any)
            .mockReturnValueOnce(of(undefined))
            .mockReturnValueOnce(of(undefined))
            .mockReturnValueOnce(of(undefined))
            .mockReturnValueOnce(of(undefined));

        service = TestBed.inject(AppUserService);
        const mergedUser = await firstValueFrom(service.user$.pipe(
            filter((profileUser): profileUser is AppUserInterface => !!profileUser),
            take(1)
        ));

        expect(mergedUser.uid).toBe('u1');
        expect(mergedUser.email).toBe('test@example.com');
        expect(mergedUser.acceptedPrivacyPolicy).toBe(false);
        expect(mergedUser.acceptedDataPolicy).toBe(false);
        expect(service.profileReadState()).toEqual({
            status: 'ready',
            uid: 'u1',
            profileExists: false,
        });
        expect(service.hasIncompleteProfileReads('u1')).toBe(false);
    });

    it('should preserve legal and system data when the legacy main profile document is missing', async () => {
        (docData as any)
            .mockReturnValueOnce(of(undefined))
            .mockReturnValueOnce(of({
                acceptedPrivacyPolicy: true,
                acceptedDataPolicy: true,
                acceptedTos: true,
            }))
            .mockReturnValueOnce(of({ stripeRole: 'basic' }))
            .mockReturnValueOnce(of({}));

        service = TestBed.inject(AppUserService);
        const mergedUser = await firstValueFrom(service.user$.pipe(
            filter((profileUser): profileUser is AppUserInterface => !!profileUser),
            take(1)
        ));

        expect(mergedUser).toEqual(expect.objectContaining({
            uid: 'u1',
            email: 'test@example.com',
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true,
            stripeRole: 'basic',
        }));
        expect(service.profileReadState()).toEqual({
            status: 'ready',
            uid: 'u1',
            profileExists: true,
        });
        expect(service.hasIncompleteProfileReads('u1')).toBe(false);
    });

    it('should retain the requested uid when only profile sub-documents exist', async () => {
        (authState as any).mockReturnValue(of(null));
        (user as any).mockReturnValue(of(null));
        (docData as any)
            .mockReturnValueOnce(of(undefined))
            .mockReturnValueOnce(of({ acceptedPrivacyPolicy: true }))
            .mockReturnValueOnce(of({}))
            .mockReturnValueOnce(of({}));

        service = TestBed.inject(AppUserService);
        const profile = await firstValueFrom(service.getUserByID('partial-user').pipe(take(1)));

        expect(profile).toEqual(expect.objectContaining({
            uid: 'partial-user',
            acceptedPrivacyPolicy: true,
        }));
    });

    it('should log permission-denied diagnostics as error events for legal sub-document reads', async () => {
        const permissionDeniedError = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied'
        });
        const logger = TestBed.inject(LoggerService);
        const loggerErrorSpy = vi.spyOn(logger, 'error');
        const issuedAtTime = '2026-03-29T19:28:12.000Z';
        const authTime = '2026-03-29T19:28:11.000Z';
        const expirationTime = '2026-03-29T20:28:12.000Z';

        mockAuth.currentUser.uid = 'u1';
        mockAuth.currentUser.getIdTokenResult
            .mockResolvedValueOnce({
                claims: {}
            })
            .mockResolvedValueOnce({
                issuedAtTime,
                authTime,
                expirationTime,
                claims: {
                    admin: false,
                    stripeRole: 'pro'
                }
            });

        (docData as any)
            .mockReturnValueOnce(of({ uid: 'u1' }))
            .mockReturnValueOnce(throwError(() => permissionDeniedError))
            .mockReturnValueOnce(of({}))
            .mockReturnValueOnce(of({}));

        service = TestBed.inject(AppUserService);
        const loadedUser = await firstValueFrom(service.getUserByID('u1').pipe(take(1)));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(loadedUser?.uid).toBe('u1');
        expect(loggerErrorSpy).toHaveBeenCalledWith(
            '[AppUserService] Error fetching legal doc',
            expect.objectContaining({
                userID: 'u1',
                path: 'users/u1/legal/agreements',
                code: 'permission-denied',
                authUID: 'u1',
                authUidMatchesRequestedUser: true
            }),
            expect.objectContaining({
                code: 'permission-denied'
            })
        );
        expect(loggerErrorSpy).toHaveBeenCalledWith(
            '[AppUserService] Permission-denied diagnostics snapshot',
            expect.objectContaining({
                userID: 'u1',
                path: 'users/u1/legal/agreements',
                authUID: 'u1',
                authUidMatchesRequestedUser: true,
                issuedAtTime,
                authTime,
                expirationTime,
                claimKeys: ['admin', 'stripeRole']
            }),
            expect.objectContaining({
                code: 'permission-denied'
            })
        );
    });

    it('should continue profile loading when legal/system/settings reads fail', async () => {
        const unavailableError = Object.assign(new Error('Service unavailable'), {
            code: 'unavailable'
        });

        (authState as any).mockReturnValue(of(null));
        (user as any).mockReturnValue(of(null));
        (docData as any)
            .mockReturnValueOnce(of({ uid: 'u1', acceptedPrivacyPolicy: true }))
            .mockReturnValueOnce(throwError(() => unavailableError))
            .mockReturnValueOnce(throwError(() => unavailableError))
            .mockReturnValueOnce(throwError(() => unavailableError));

        service = TestBed.inject(AppUserService);
        const loggerErrorSpy = vi.spyOn((service as any).logger, 'error');
        const loadedUser = await firstValueFrom(service.getUserByID('u1').pipe(take(1)));

        expect(loadedUser?.uid).toBe('u1');
        expect(loadedUser?.acceptedPrivacyPolicy).toBe(true);
        expect(loadedUser?.settings).toBeTruthy();
        expect(loggerErrorSpy).toHaveBeenCalledTimes(3);
    });

    it('returns enabled chart data types in canonical order with event chart priority overrides', () => {
        service = TestBed.inject(AppUserService);
        const user = {
            settings: {
                chartSettings: {
                    dataTypeSettings: {
                        [DataAltitude.type]: { enabled: true },
                        [DataCadence.type]: { enabled: true },
                        [DataGradeAdjustedSpeed.type]: { enabled: true },
                        [DataHeartRate.type]: { enabled: true },
                        [DataPace.type]: { enabled: true },
                        [DataPotentialStamina.type]: { enabled: true },
                        [DataSpeed.type]: { enabled: true },
                        [DataStamina.type]: { enabled: true },
                        [DataPower.type]: { enabled: true },
                        customType: { enabled: true },
                    }
                }
            }
        } as any;

        const canonicalChartDataTypes = getAppCanonicalChartDataTypes();
        const enabledDataTypes = [
            DataAltitude.type,
            DataCadence.type,
            DataGradeAdjustedSpeed.type,
            DataHeartRate.type,
            DataPace.type,
            DataPotentialStamina.type,
            DataPower.type,
            DataSpeed.type,
            DataStamina.type,
            'customType'
        ];
        const canonicalEnabledDataTypes = canonicalChartDataTypes.filter((dataType) => enabledDataTypes.includes(dataType));
        const expectedOrderedDataTypes = [
            DataHeartRate.type,
            DataPace.type,
            DataSpeed.type,
            DataGradeAdjustedSpeed.type,
            DataPower.type,
            DataCadence.type,
            ...canonicalEnabledDataTypes.filter((dataType) => ![
                DataHeartRate.type,
                DataPace.type,
                DataSpeed.type,
                DataGradeAdjustedSpeed.type,
                DataPower.type,
                DataCadence.type,
            ].includes(dataType)),
            'customType'
        ];

        expect(service.getUserChartDataTypesToUse(user)).toEqual(expectedOrderedDataTypes);
    });

    it('builds the shared Suunto connection view from tokens and service meta', async () => {
        service = TestBed.inject(AppUserService);
        const user = { uid: 'u1' } as any;

        (docData as any).mockReturnValue(of({
            connectionState: 'reconnect_required',
            lastDisconnectedAt: 123,
            lastAuthFailureMessage: 'invalid_grant',
            connectionAccounts: [{ providerUserId: 'suunto-user' }],
        }));

        const result = await firstValueFrom(service.watchSuuntoServiceConnectionView(user).pipe(take(1)));

        expect(result).toMatchObject({
            connected: true,
            reconnectRequired: true,
            failureMessage: 'invalid_grant',
            connectButtonLabel: 'Reconnect',
            reconnectPromptSource: 'suunto-reconnect-required:123',
        });
    });

    it('builds shared Suunto route catch-up prompt context from tokens and service meta', async () => {
        service = TestBed.inject(AppUserService);
        const testUser = { uid: 'u1' } as any;

        (docData as any).mockReturnValue(of({
            connectionAccounts: [
                { providerUserId: 'suunto-user-a', connectedAtMs: 1710000000000 },
                { providerUserId: 'suunto-user-b', connectedAtMs: 1710001000000 },
            ],
            routeImportStatesByProviderSourceKey: [
                {
                    sourceKey: 'suunto-user-a:1710000000000',
                    providerUserId: 'suunto-user-a',
                    didLastRouteImport: {
                        toDate: () => new Date('2026-06-11T08:30:00.000Z'),
                    },
                },
                {
                    sourceKey: 'suunto-user-b:1710001000000',
                    providerUserId: 'suunto-user-b',
                    didLastRouteImport: {
                        toDate: () => new Date('2026-06-12T09:45:00.000Z'),
                    },
                },
            ],
        }));

        const result = await firstValueFrom(service.watchSuuntoRouteCatchUpPromptContext(testUser).pipe(take(1)));

        expect(result.connectionView).toMatchObject({
            connected: true,
            reconnectRequired: false,
        });
        expect(result.connectedProviderUserIds).toEqual(['suunto-user-a', 'suunto-user-b']);
        expect(result.didLastRouteImport?.toISOString()).toBe('2026-06-12T09:45:00.000Z');
        expect(result.promptSource).toBe('suunto-route-catch-up:connected:suunto-user-a:1710000000000|suunto-user-b:1710001000000');
        expect(result.serviceMeta).toMatchObject({
            routeImportStatesByProviderSourceKey: expect.any(Array),
        });
    });

    it('keeps Suunto route catch-up incomplete for connected accounts when only legacy global route metadata exists', async () => {
        service = TestBed.inject(AppUserService);
        const testUser = { uid: 'u1' } as any;

        (docData as any).mockReturnValue(of({
            connectionAccounts: [
                { providerUserId: 'suunto-user-a', connectedAtMs: 1710000000000 },
                { providerUserId: 'suunto-user-b', connectedAtMs: 1710001000000 },
            ],
            didLastRouteImport: {
                toDate: () => new Date('2026-06-12T09:45:00.000Z'),
            },
        }));

        const result = await firstValueFrom(service.watchSuuntoRouteCatchUpPromptContext(testUser).pipe(take(1)));

        expect(result.didLastRouteImport).toBeNull();
        expect(result.connectedProviderUserIds).toEqual(['suunto-user-a', 'suunto-user-b']);
    });

    it('treats a same-account reconnect as incomplete until the new source key completes', async () => {
        service = TestBed.inject(AppUserService);
        const testUser = { uid: 'u1' } as any;

        (docData as any).mockReturnValue(of({
            connectionAccounts: [
                { providerUserId: 'suunto-user-a', connectedAtMs: 1711000000000 },
            ],
            didLastRouteImport: {
                toDate: () => new Date('2026-06-12T09:45:00.000Z'),
            },
            routeImportStatesByProviderSourceKey: [
                {
                    sourceKey: 'suunto-user-a:1710000000000',
                    providerUserId: 'suunto-user-a',
                    didLastRouteImport: {
                        toDate: () => new Date('2026-06-12T09:45:00.000Z'),
                    },
                },
            ],
        }));

        const result = await firstValueFrom(service.watchSuuntoRouteCatchUpPromptContext(testUser).pipe(take(1)));

        expect(result.didLastRouteImport).toBeNull();
        expect(result.promptSource).toBe('suunto-route-catch-up:connected:suunto-user-a:1711000000000');
        expect(result.connectedProviderUserIds).toEqual(['suunto-user-a']);
    });

    it('does not treat malformed Suunto tokens without a provider identity as connected', async () => {
        service = TestBed.inject(AppUserService);
        const testUser = { uid: 'u1' } as any;

        (docData as any).mockReturnValue(of({
            connectionAccounts: [],
            didLastRouteImport: {
                toDate: () => new Date('2026-06-12T09:45:00.000Z'),
            },
        }));

        const result = await firstValueFrom(service.watchSuuntoRouteCatchUpPromptContext(testUser).pipe(take(1)));

        expect(result.connectionView).toMatchObject({
            connected: false,
            reconnectRequired: false,
        });
        expect(result.connectedProviderUserIds).toEqual([]);
        expect(result.promptSource).toBeNull();
        expect(result.didLastRouteImport?.toISOString()).toBe('2026-06-12T09:45:00.000Z');
    });

    it('builds Garmin route send context with a permission prompt source when Course Import is missing', async () => {
        service = TestBed.inject(AppUserService);
        const testUser = { uid: 'u1' } as any;

        (docData as any).mockReturnValue(of({
            connectionAccounts: [{
                providerUserId: 'garmin-user-1',
                permissions: ['ACTIVITY_EXPORT'],
                permissionsUpdatedAtMs: 1710000000000,
                connectedAtMs: 1700000000000,
            }],
        }));

        const result = await firstValueFrom(service.watchGarminRouteSendContext(testUser).pipe(take(1)));

        expect(result).toMatchObject({
            connected: true,
            reconnectRequired: false,
            missingPermissions: ['COURSE_IMPORT'],
            providerUserId: 'garmin-user-1',
            permissionPromptSource: 'garmin-route-course-import:garmin-user-1:1710000000000:COURSE_IMPORT',
        });
        expect(result.providerStates).toEqual([{
            providerUserId: 'garmin-user-1',
            permissionsLoaded: true,
            missingPermissions: ['COURSE_IMPORT'],
        }]);
    });

    it('builds Garmin route permission prompt source for legacy tokens without stored permissions', async () => {
        service = TestBed.inject(AppUserService);
        const testUser = { uid: 'u1' } as any;

        (docData as any).mockReturnValue(of({
            connectionAccounts: [{
                providerUserId: 'garmin-user-1',
                connectedAtMs: 1700000000000,
            }],
        }));

        const result = await firstValueFrom(service.watchGarminRouteSendContext(testUser).pipe(take(1)));

        expect(result).toMatchObject({
            connected: true,
            reconnectRequired: false,
            missingPermissions: ['COURSE_IMPORT'],
            providerUserId: 'garmin-user-1',
            permissionPromptSource: 'garmin-route-course-import:garmin-user-1:1700000000000:COURSE_IMPORT',
        });
        expect(result.providerStates).toEqual([{
            providerUserId: 'garmin-user-1',
            permissionsLoaded: false,
            missingPermissions: ['COURSE_IMPORT'],
        }]);
    });

    it('treats pending Garmin disconnect as unavailable for route send context even when tokens exist', async () => {
        service = TestBed.inject(AppUserService);
        const testUser = { uid: 'u1' } as any;

        (docData as any).mockReturnValue(of({
            connectionAccounts: [{
                providerUserId: 'garmin-user-1',
                permissions: ['ACTIVITY_EXPORT'],
                permissionsUpdatedAtMs: 1710000000000,
                connectedAtMs: 1700000000000,
            }],
            connectionState: 'disconnect_pending',
        }));

        const result = await firstValueFrom(service.watchGarminRouteSendContext(testUser).pipe(take(1)));

        expect(result).toMatchObject({
            connected: false,
            reconnectRequired: false,
            missingPermissions: [],
            providerUserId: null,
            providerStates: [],
            permissionPromptSource: null,
        });
    });

    describe('createOrUpdateUser policy flow', () => {
        beforeEach(async () => {
            service = TestBed.inject(AppUserService);
            await firstValueFrom(service.user$.pipe(
                filter((profileUser): profileUser is AppUserInterface => !!profileUser),
                take(1)
            ));
        });

        it('should reject when required legal policies are not accepted', async () => {
            const user = {
                uid: 'u1',
                acceptedPrivacyPolicy: false,
                acceptedDataPolicy: true,
            } as AppUserInterface;
            const updateUserSpy = vi.spyOn(service, 'updateUser');

            await expect(service.createOrUpdateUser(user)).rejects.toThrow('User has not accepted privacy or data policy');

            expect(updateUserSpy).not.toHaveBeenCalled();
            expect(setDoc).not.toHaveBeenCalled();
        });

        it('should reject onboarding profile writes while the authoritative profile is recovering', async () => {
            const user = {
                uid: 'u1',
                acceptedPrivacyPolicy: true,
                acceptedDataPolicy: true,
            } as AppUserInterface;
            (service as any).markIncompleteProfileRead('u1');

            await expect(service.createOrUpdateUser(user)).rejects.toThrow(
                'Cannot create or update user while the authoritative profile read is incomplete.'
            );

            expect(setDoc).not.toHaveBeenCalled();
        });

        it('should reject direct legal writes while the authoritative profile is recovering', async () => {
            const policies = {
                uid: 'u1',
                acceptedPrivacyPolicy: true,
                acceptedDataPolicy: true,
            } as AppUserInterface;
            (service as any).markIncompleteProfileRead('u1');

            await expect(service.acceptPolicies(policies)).rejects.toThrow(
                'Cannot update legal consent while the authoritative profile read is incomplete.'
            );

            expect(setDoc).not.toHaveBeenCalled();
        });

        it('should write legal agreements before updating the main user profile', async () => {
            const user = {
                uid: 'u1',
                acceptedPrivacyPolicy: true,
                acceptedDataPolicy: true,
            } as AppUserInterface;
            const acceptPoliciesSpy = vi.spyOn(service, 'acceptPolicies');
            const updateUserSpy = vi.spyOn(service, 'updateUser').mockResolvedValue(undefined as any);

            await service.createOrUpdateUser(user);

            expect(acceptPoliciesSpy).toHaveBeenCalledWith(user);
            expect(updateUserSpy).toHaveBeenCalledWith(user);
            const acceptOrder = (acceptPoliciesSpy as any).mock.invocationCallOrder[0];
            const updateOrder = (updateUserSpy as any).mock.invocationCallOrder[0];
            expect(acceptOrder).toBeLessThan(updateOrder);
        });

        it('should preserve creationDate during create-or-update onboarding upserts', async () => {
            const user = {
                uid: 'u1',
                acceptedPrivacyPolicy: true,
                acceptedDataPolicy: true,
                displayName: 'New User',
                creationDate: new Date('2026-01-01T00:00:00.000Z'),
            } as AppUserInterface;

            await service.createOrUpdateUser(user);

            const mainUserDocWrite = (setDoc as any).mock.calls.find(([, payload]: [unknown, any]) => payload?.displayName === 'New User');
            expect(mainUserDocWrite).toBeDefined();
            expect(mainUserDocWrite[1].creationDate).toEqual(new Date('2026-01-01T00:00:00.000Z'));
        });

        it('acceptPolicies should persist required true policies and explicit optional consent choices', async () => {
            const policies = {
                uid: 'u1',
                acceptedPrivacyPolicy: true,
                acceptedDataPolicy: false,
                acceptedTrackingPolicy: false,
                acceptedMarketingPolicy: false,
                acceptedDiagnosticsPolicy: true,
                acceptedTos: false,
                displayName: 'Should be ignored',
            } as any;

            await service.acceptPolicies(policies);

            expect(setDoc).toHaveBeenCalledTimes(1);
            expect((setDoc as any).mock.calls[0][1]).toEqual({
                acceptedPrivacyPolicy: true,
                acceptedDiagnosticsPolicy: true,
                acceptedTrackingPolicy: false,
                acceptedMarketingPolicy: false,
            });
            expect((setDoc as any).mock.calls[0][2]).toEqual({ merge: true });
        });

        it('should not call updateUser when legal agreement write fails', async () => {
            const user = {
                uid: 'u1',
                acceptedPrivacyPolicy: true,
                acceptedDataPolicy: true,
            } as AppUserInterface;
            const writeError = Object.assign(new Error('permission-denied'), {
                code: 'permission-denied'
            });
            const updateUserSpy = vi.spyOn(service, 'updateUser');

            try {
                (setDoc as any)
                    .mockRejectedValueOnce(writeError)
                    .mockRejectedValueOnce(writeError);

                await expect(service.createOrUpdateUser(user)).rejects.toThrow('permission-denied');

                expect(updateUserSpy).not.toHaveBeenCalled();
            } finally {
                (setDoc as any).mockResolvedValue(undefined);
            }
        });
    });

    describe('role checks', () => {



        it('should return basic role', async () => {
            mockAuth.currentUser.getIdTokenResult.mockResolvedValue({
                claims: { stripeRole: 'basic' }
            });
            service = TestBed.inject(AppUserService);
            await firstValueFrom(service.user$.pipe(filter(u => !!u), take(1)));
            const role = await service.getSubscriptionRole();
            expect(role).toBe('basic');
        });

        it('hasPaidAccess should return true for basic', async () => {
            (docData as any).mockReturnValue(of({ stripeRole: 'basic' }));
            service = TestBed.inject(AppUserService);
            await firstValueFrom(service.user$.pipe(filter(u => !!u), take(1)));
            const hasAccess = await service.hasPaidAccess();
            expect(hasAccess).toBe(true);
        });

        it('isPro should return false for basic', async () => {
            mockAuth.currentUser.getIdTokenResult.mockResolvedValue({
                claims: { stripeRole: 'basic' }
            });
            (docData as any).mockReturnValue(of({ stripeRole: 'basic' }));
            service = TestBed.inject(AppUserService);
            await firstValueFrom(service.user$.pipe(filter(u => !!u), take(1)));
            const isPro = await service.isPro();
            expect(isPro).toBe(false);
        });

        it('isPro should return true for free user in active grace period', async () => {
            // Mock docData to have active grace period
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 1);
            mockAuth.currentUser.getIdTokenResult.mockResolvedValue({
                claims: { stripeRole: 'free' }
            });
            (docData as any).mockReturnValue(of({
                stripeRole: 'free',
                gracePeriodUntil: { toMillis: () => futureDate.getTime() }
            }));
            service = TestBed.inject(AppUserService);
            await firstValueFrom(service.user$.pipe(filter(u => !!u), take(1)));
            const isPro = await service.isPro();
            expect(isPro).toBe(true);
        });

        it('should return pro role', async () => {
            (docData as any).mockReturnValue(of({ stripeRole: 'pro' }));
            mockAuth.currentUser.getIdTokenResult.mockResolvedValue({
                claims: { stripeRole: 'pro' }
            });
            service = TestBed.inject(AppUserService);
            await firstValueFrom(service.user$.pipe(filter(u => !!u), take(1)));
            const role = await service.getSubscriptionRole();
            expect(role).toBe('pro');
        });

        it('hasPaidAccess should return true for pro', async () => {
            (docData as any).mockReturnValue(of({ stripeRole: 'pro' }));
            mockAuth.currentUser.getIdTokenResult.mockResolvedValue({
                claims: { stripeRole: 'pro' }
            });
            service = TestBed.inject(AppUserService);
            await firstValueFrom(service.user$.pipe(filter(u => !!u), take(1)));
            const hasAccess = await service.hasPaidAccess();
            expect(hasAccess).toBe(true);
        });

        it('should return true for admin', async () => {
            mockAuth.currentUser.getIdTokenResult.mockResolvedValue({
                claims: { admin: true }
            });
            (docData as any).mockReturnValue(of({}));
            service = TestBed.inject(AppUserService);
            await firstValueFrom(service.user$.pipe(filter(u => !!u), take(1)));
            const isAdmin = await service.isAdmin();
            expect(isAdmin).toBe(true);
        });

        it('signals should reflect basic role', async () => {
            mockAuth.currentUser.getIdTokenResult.mockResolvedValue({
                claims: { stripeRole: 'basic' }
            });
            (docData as any).mockReturnValue(of({ stripeRole: 'basic' }));
            service = TestBed.inject(AppUserService);
            await firstValueFrom(service.user$.pipe(filter(u => !!u), take(1)));
            expect(await service.getSubscriptionRole()).toBe('basic');
            expect(service.isBasicSignal()).toBe(true);
            expect(service.isProSignal()).toBe(false);
            expect(service.hasPaidAccessSignal()).toBe(true);
        });

        it('signals should reflect pro role', async () => {
            mockAuth.currentUser.getIdTokenResult.mockResolvedValue({
                claims: { stripeRole: 'pro' }
            });
            (docData as any).mockReturnValue(of({ stripeRole: 'pro' }));
            service = TestBed.inject(AppUserService);
            // Wait for signal to update since mergeClaims is async
            await firstValueFrom(service.user$.pipe(filter(u => !!u), take(1)));
            const u = service.user();
            expect(u).not.toBeNull();
            expect(service.isProSignal()).toBe(true);
            expect(service.isBasicSignal()).toBe(false);
            expect(service.hasPaidAccessSignal()).toBe(true);
        });

        it('signals should reflect grace period as pro access', async () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 1);
            mockAuth.currentUser.getIdTokenResult.mockResolvedValue({
                claims: { stripeRole: 'free', gracePeriodUntil: futureDate.getTime() }
            });
            (docData as any).mockReturnValue(of({
                stripeRole: 'free',
                gracePeriodUntil: { toMillis: () => futureDate.getTime() }
            }));
            service = TestBed.inject(AppUserService);
            // Wait for signal to update
            await firstValueFrom(service.user$.pipe(filter(u => !!u), take(1)));
            const u = service.user();
            expect(u).not.toBeNull();
            expect((u as any).gracePeriodUntil).toBeDefined();
            expect(service.isProSignal()).toBe(true);
            expect(service.hasPaidAccessSignal()).toBe(true);
        });
    });

    describe('service token routing', () => {
        beforeEach(() => {
            service = TestBed.inject(AppUserService);
        });

        it('getServiceToken should read Suunto accounts from safe service metadata', async () => {
            const user = { uid: 'u1' } as any;
            const accounts = [{ providerUserId: 'suunto-user' }];
            (docData as any).mockReturnValueOnce(of({ connectionAccounts: accounts }));

            const result = await firstValueFrom(service.getServiceToken(user, ServiceNames.SuuntoApp));

            expect(doc).toHaveBeenCalledWith(expect.anything(), 'users', 'u1', 'meta', ServiceNames.SuuntoApp);
            expect(result).toEqual(accounts);
            expect(collectionData).not.toHaveBeenCalled();
        });

        it('getServiceToken should read COROS accounts from safe service metadata', async () => {
            const user = { uid: 'u2' } as any;
            const accounts = [{ providerUserId: 'coros-user' }];
            (docData as any).mockReturnValueOnce(of({ connectionAccounts: accounts }));

            const result = await firstValueFrom(service.getServiceToken(user, ServiceNames.COROSAPI));

            expect(doc).toHaveBeenCalledWith(expect.anything(), 'users', 'u2', 'meta', ServiceNames.COROSAPI);
            expect(result).toEqual(accounts);
            expect(collectionData).not.toHaveBeenCalled();
        });

        it('should fail closed when COROS metadata pins a token that is no longer present', () => {
            service = TestBed.inject(AppUserService);
            const hasConnectedToken = (service as any).hasConnectedActivityServiceToken.bind(service);

            expect(hasConnectedToken(
                ServiceNames.COROSAPI,
                [{ providerUserId: 'remaining-coros-account' }],
                { providerUserId: 'missing-pinned-account' },
            )).toBe(false);
            expect(hasConnectedToken(
                ServiceNames.COROSAPI,
                [{ providerUserId: 'active-coros-account' }],
                { providerUserId: 'active-coros-account' },
            )).toBe(true);
        });

        it('should recognize an unpinned legacy COROS token until the backend pins it', () => {
            service = TestBed.inject(AppUserService);
            const hasConnectedToken = (service as any).hasConnectedActivityServiceToken.bind(service);

            expect(hasConnectedToken(
                ServiceNames.COROSAPI,
                [{ providerUserId: 'legacy-coros-account' }],
                {},
            )).toBe(true);
            expect(hasConnectedToken(ServiceNames.COROSAPI, [{ accessToken: 'malformed' }], {})).toBe(false);
        });

        it('getServiceToken should read Garmin accounts from safe service metadata', async () => {
            const user = { uid: 'u3' } as any;
            const accounts = [{ providerUserId: 'garmin-user', permissions: [] }];
            (docData as any).mockReturnValueOnce(of({ connectionAccounts: accounts }));

            const result = await firstValueFrom(service.getServiceToken(user, ServiceNames.GarminAPI));

            expect(doc).toHaveBeenCalledWith(expect.anything(), 'users', 'u3', 'meta', ServiceNames.GarminAPI);
            expect(result).toEqual(accounts);
            expect(collectionData).not.toHaveBeenCalled();
        });

        it.each([
            ServiceNames.SuuntoApp,
            ServiceNames.COROSAPI,
            ServiceNames.GarminAPI,
        ])('getServiceToken should fail closed without a %s projection', async (serviceName) => {
            const user = { uid: 'missing-projection-user' } as any;
            (docData as any).mockReturnValueOnce(of({ connectionState: 'connected' }));

            const result = await firstValueFrom(service.getServiceToken(user, serviceName));

            expect(result).toEqual([]);
            expect(collectionData).not.toHaveBeenCalled();
        });

        it('getServiceToken should treat an explicit empty projection as authoritative', async () => {
            const user = { uid: 'projected-user' } as any;
            (docData as any).mockReturnValueOnce(of({ connectionAccounts: [] }));

            const result = await firstValueFrom(service.getServiceToken(user, ServiceNames.GarminAPI));

            expect(result).toEqual([]);
            expect(collectionData).not.toHaveBeenCalled();
        });

        it('getServiceToken should derive Wahoo connection state from safe user metadata', async () => {
            const user = { uid: 'u-wahoo' } as any;
            (docData as any).mockReturnValueOnce(of({ connectionState: 'connected' }));

            const result = await firstValueFrom(service.getServiceToken(user, ServiceNames.WahooAPI));

            expect(doc).toHaveBeenCalledWith(expect.anything(), 'users', 'u-wahoo', 'meta', ServiceNames.WahooAPI);
            expect(result).toEqual([{}]);
            expect(collectionData).not.toHaveBeenCalled();
        });

        it('getServiceToken should throw for unsupported service names', () => {
            const user = { uid: 'u4' } as any;

            expect(() => service.getServiceToken(user, 'Unsupported service' as any)).toThrow(
                'Not implemented for service Unsupported service'
            );
        });

        it('getServiceToken should recover with empty array when Suunto projection read fails', async () => {
            const user = { uid: 'u5' } as any;
            (docData as any).mockReturnValueOnce(throwError(() => new Error('Suunto read failed')));

            const result = await firstValueFrom(service.getServiceToken(user, ServiceNames.SuuntoApp));

            expect(result).toEqual([]);
        });

        it('getServiceToken should recover with empty array when Garmin projection read fails', async () => {
            const user = { uid: 'u6' } as any;
            (docData as any).mockReturnValueOnce(throwError(() => new Error('Garmin read failed')));

            const result = await firstValueFrom(service.getServiceToken(user, ServiceNames.GarminAPI));

            expect(result).toEqual([]);
        });

        it('watchHasAnyActivityServiceConnection should emit false without a user', async () => {
            const result = await firstValueFrom(service.watchHasAnyActivityServiceConnection(null));

            expect(result).toBe(false);
            expect(collectionData).not.toHaveBeenCalled();
        });

        it('watchActivityServiceConnectionState should emit per-service connection state', async () => {
            const user = { uid: 'u10' } as any;
            vi.spyOn(service, 'getServiceToken').mockImplementation((_user, serviceName) => of(
                serviceName === ServiceNames.GarminAPI
                    ? [{ providerUserId: 'garmin-user' }]
                    : serviceName === ServiceNames.SuuntoApp
                        ? [{ providerUserId: 'suunto-user' }]
                        : []
            ) as any);
            vi.spyOn(service, 'getUserMetaForService').mockReturnValue(of(undefined));

            const result = await firstValueFrom(service.watchActivityServiceConnectionState(user));

            expect(result).toEqual({
                [ServiceNames.GarminAPI]: true,
                [ServiceNames.SuuntoApp]: true,
                [ServiceNames.COROSAPI]: false,
                [ServiceNames.WahooAPI]: false,
            });
        });

        it('watchActivityServiceConnectionState should ignore malformed Suunto tokens without provider identity', async () => {
            const user = { uid: 'u10b' } as any;
            vi.spyOn(service, 'getServiceToken').mockImplementation((_user, serviceName) => of(
                serviceName === ServiceNames.SuuntoApp ? [{}] : []
            ) as any);
            vi.spyOn(service, 'getUserMetaForService').mockReturnValue(of(undefined));

            const result = await firstValueFrom(service.watchActivityServiceConnectionState(user));

            expect(result).toEqual({
                [ServiceNames.GarminAPI]: false,
                [ServiceNames.SuuntoApp]: false,
                [ServiceNames.COROSAPI]: false,
                [ServiceNames.WahooAPI]: false,
            });
        });

        it('watchActivityServiceConnectionState should not expose reconnect-required COROS tokens as usable', async () => {
            const user = { uid: 'u10c' } as any;
            service = TestBed.inject(AppUserService);
            vi.spyOn(service, 'getServiceToken').mockImplementation((_user, serviceName) => of(
                serviceName === ServiceNames.COROSAPI
                    ? [{ accessToken: 'coros-token', openId: 'coros-user' }]
                    : []
            ) as any);
            vi.spyOn(service, 'getUserMetaForService').mockImplementation((_user, serviceName) => of(
                serviceName === ServiceNames.COROSAPI
                    ? { connectionState: 'reconnect_required' }
                    : undefined
            ) as any);

            const result = await firstValueFrom(service.watchActivityServiceConnectionState(user));

            expect(result).toEqual({
                [ServiceNames.GarminAPI]: false,
                [ServiceNames.SuuntoApp]: false,
                [ServiceNames.COROSAPI]: false,
                [ServiceNames.WahooAPI]: false,
            });
        });

        it('watchHasAnyActivityServiceConnection should emit false when activity service token streams are empty', async () => {
            const user = { uid: 'u7' } as any;

            const result = await firstValueFrom(service.watchHasAnyActivityServiceConnection(user));

            expect(result).toBe(false);
        });

        it('watchHasAnyActivityServiceConnection should emit true when any activity service has a token', async () => {
            const user = { uid: 'u8' } as any;
            vi.spyOn(service, 'getServiceToken').mockImplementation((_user, serviceName) => of(
                serviceName === ServiceNames.SuuntoApp ? [{ providerUserId: 'suunto-user' }] : []
            ) as any);
            vi.spyOn(service, 'getUserMetaForService').mockReturnValue(of(undefined));

            const result = await firstValueFrom(service.watchHasAnyActivityServiceConnection(user));

            expect(result).toBe(true);
        });

        it('watchHasAnyActivityServiceConnection should stay false when the only Suunto token is malformed', async () => {
            const user = { uid: 'u8b' } as any;
            vi.spyOn(service, 'getServiceToken').mockImplementation((_user, serviceName) => of(
                serviceName === ServiceNames.SuuntoApp ? [{}] : []
            ) as any);
            vi.spyOn(service, 'getUserMetaForService').mockReturnValue(of(undefined));

            const result = await firstValueFrom(service.watchHasAnyActivityServiceConnection(user));

            expect(result).toBe(false);
        });

        it('watchHasAnyActivityServiceConnection should fail closed when projection reads fail', async () => {
            const user = { uid: 'u9' } as any;
            vi.spyOn(service, 'getServiceToken').mockReturnValue(
                throwError(() => new Error('Projection read failed')),
            );
            vi.spyOn(service, 'getUserMetaForService').mockReturnValue(of(undefined));

            const result = await firstValueFrom(service.watchHasAnyActivityServiceConnection(user));

            expect(result).toBe(false);
        });

        it('updateActivitySyncRouteSettings should write only route settings and preserve local settings', async () => {
            const user = {
                uid: 'u11',
                settings: {
                    appSettings: { theme: 'dark' },
                    dashboardSettings: { tiles: [{ name: 'Existing' }] },
                    serviceSyncSettings: {
                        activitySyncRoutes: {
                            [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: { enabled: true },
                        },
                    },
                },
            } as any;

            await service.updateActivitySyncRouteSettings(user, {
                [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: true,
            });

            expect(setDoc).toHaveBeenCalledWith(expect.anything(), {
                serviceSyncSettings: {
                    activitySyncRoutes: {
                        [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: {
                            enabled: true,
                        },
                    },
                },
            }, { merge: true });
            expect(user.settings.appSettings.theme).toBe('dark');
            expect(user.settings.dashboardSettings.tiles).toEqual([{ name: 'Existing' }]);
            expect(user.settings.serviceSyncSettings.activitySyncRoutes).toEqual({
                [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: { enabled: true },
                [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
            });
        });

        it('updateActivitySyncRouteSettings should fail without local mutation when profile reads are incomplete', async () => {
            const user = {
                uid: 'u12',
                settings: {
                    appSettings: { theme: 'dark' },
                    serviceSyncSettings: {
                        activitySyncRoutes: {
                            [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: { enabled: false },
                        },
                    },
                },
            } as any;
            (service as any).usersWithIncompleteProfileReads.add('u12');

            await expect(service.updateActivitySyncRouteSettings(user, {
                [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: true,
            })).rejects.toThrow('Cannot update activity sync route settings until user settings finish loading.');

            expect(setDoc).not.toHaveBeenCalled();
            expect(user.settings.serviceSyncSettings.activitySyncRoutes).toEqual({
                [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: { enabled: false },
            });
        });

        it('updateRouteDeliverySyncRouteSettings should write only route delivery settings and preserve local settings', async () => {
            const user = {
                uid: 'u13',
                settings: {
                    appSettings: { theme: 'dark' },
                    serviceSyncSettings: {
                        activitySyncRoutes: {
                            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
                        },
                    },
                },
            } as any;

            await service.updateRouteDeliverySyncRouteSettings(user, {
                [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: true,
            });

            expect(setDoc).toHaveBeenCalledWith(expect.anything(), {
                serviceSyncSettings: {
                    routeDeliverySyncRoutes: {
                        [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: {
                            enabled: true,
                        },
                    },
                },
            }, { merge: true });
            expect(user.settings.appSettings.theme).toBe('dark');
            expect(user.settings.serviceSyncSettings.activitySyncRoutes).toEqual({
                [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
            });
            expect(user.settings.serviceSyncSettings.routeDeliverySyncRoutes).toEqual({
                [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: true },
            });
        });

        it('updateRouteDeliverySyncRouteSettings should fail without local mutation when profile reads are incomplete', async () => {
            const user = {
                uid: 'u14',
                settings: {
                    serviceSyncSettings: {
                        routeDeliverySyncRoutes: {
                            [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: false },
                        },
                    },
                },
            } as any;
            (service as any).usersWithIncompleteProfileReads.add('u14');

            await expect(service.updateRouteDeliverySyncRouteSettings(user, {
                [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: true,
            })).rejects.toThrow('Cannot update route delivery sync route settings until user settings finish loading.');

            expect(setDoc).not.toHaveBeenCalled();
            expect(user.settings.serviceSyncSettings.routeDeliverySyncRoutes).toEqual({
                [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: false },
            });
        });
    });

    describe('gracePeriodUntil signal', () => {
        it('should return null if user is not logged in', async () => {
            (authState as any).mockReturnValue(of(null));
            (user as any).mockReturnValue(of(null));
            service = TestBed.inject(AppUserService);
            expect(service.gracePeriodUntil()).toBeNull();
        });

        it('should return null if no grace period is set', async () => {
            (authState as any).mockReturnValue(of({
                uid: 'u1',
                getIdToken: vi.fn().mockResolvedValue('test-token'),
                getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} })
            }));
            (user as any).mockReturnValue(of({
                uid: 'u1',
                getIdToken: vi.fn().mockResolvedValue('test-token'),
                getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} })
            }));
            (docData as any).mockReturnValue(of({}));
            service = TestBed.inject(AppUserService);
            expect(service.gracePeriodUntil()).toBeNull();
        });

        it('should return Date if grace period is set', async () => {
            const mockDate = new Date();
            (authState as any).mockReturnValue(of({
                uid: 'u1',
                getIdToken: vi.fn().mockResolvedValue('test-token'),
                getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} })
            }));
            (user as any).mockReturnValue(of({
                uid: 'u1',
                getIdToken: vi.fn().mockResolvedValue('test-token'),
                getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} })
            }));
            (docData as any).mockReturnValue(of({
                gracePeriodUntil: { toDate: () => mockDate, toMillis: () => mockDate.getTime() }
            }));

            service = TestBed.inject(AppUserService);
            await firstValueFrom(service.user$.pipe(filter(u => !!u), take(1)));
            const u = service.user();
            expect(u).not.toBeNull();
            expect((u as any).gracePeriodUntil).toBeDefined();
            expect(service.gracePeriodUntil()?.getTime()).toEqual(mockDate.getTime());
        });
    });
    describe('updateUserProperties', () => {
        beforeEach(async () => {
            service = TestBed.inject(AppUserService);
            await firstValueFrom(service.user$.pipe(
                filter((profileUser): profileUser is AppUserInterface => !!profileUser),
                take(1)
            ));
        });

        it('should reject settings writes when profile reads are incomplete', async () => {
            const user = { uid: 'u1' } as any;
            const settings = { theme: 'dark' };

            (service as any).usersWithIncompleteProfileReads.add('u1');
            await expect(service.updateUserProperties(user, { settings }))
                .rejects.toThrow('Cannot update user settings until user profile finishes loading.');

            expect(setDoc).not.toHaveBeenCalled();
            expect(updateDoc).not.toHaveBeenCalled();
        });

        it('should reject optional legal writes when profile reads are incomplete', async () => {
            const user = { uid: 'u1' } as AppUserInterface;
            const updates = {
                displayName: 'New Name',
                acceptedTrackingPolicy: false,
                acceptedMarketingPolicy: false
            };

            (service as any).usersWithIncompleteProfileReads.add('u1');
            await expect(service.updateUserProperties(user, updates))
                .rejects.toThrow('Cannot update legal consent until user profile finishes loading.');

            expect(setDoc).not.toHaveBeenCalled();
            expect(updateDoc).not.toHaveBeenCalled();
            expect(updates).toEqual({
                displayName: 'New Name',
                acceptedTrackingPolicy: false,
                acceptedMarketingPolicy: false,
            });
        });

        it('should split settings and other properties', async () => {
            const user = { uid: 'u1' } as any;
            const settings = { theme: 'dark' };
            const updates = { displayName: 'New Name', settings };

            await service.updateUserProperties(user, updates);

            // Expect updateDoc to be called with strictly the non-settings properties
            expect(updateDoc).toHaveBeenCalledWith(expect.anything(), { displayName: 'New Name' });

            // Expect setDoc to be called for the settings
            expect(setDoc).toHaveBeenCalledWith(expect.anything(), settings, { merge: true });
        });

        it('strips server-owned Training settings while retaining client-owned workspace preferences', async () => {
            const user = { uid: 'u1' } as AppUserInterface;
            const updates = {
                displayName: 'New Name',
                settings: {
                    theme: 'dark',
                    appSettings: {
                        trainingWorkspace: {
                            preferredDestination: 'cycling',
                            sportShortcuts: ['running', 'cycling'],
                        },
                    },
                    trainingSettings: {
                        visibleDisciplines: ['cycling'],
                        buildBenchmarks: {
                            running: { mode: 'period', durationWeeks: 12, endDayMs: 1_746_403_200_000 },
                        },
                    },
                },
            };

            await service.updateUserProperties(user, updates);

            expect(setDoc).toHaveBeenCalledWith(expect.anything(), {
                theme: 'dark',
                appSettings: {
                    trainingWorkspace: {
                        preferredDestination: 'cycling',
                        sportShortcuts: ['running', 'cycling'],
                    },
                },
            }, { merge: true });
            expect(updateDoc).toHaveBeenCalledWith(expect.anything(), { displayName: 'New Name' });
        });

        it('should split writes for legal fields', async () => {
            const user = { uid: 'test-uid' } as AppUserInterface;
            const propertiesToUpdate = {
                displayName: 'New Name',
                acceptedMarketingPolicy: true
            };

            await service.updateUserProperties(user, propertiesToUpdate);

            // Should write legal fields to legal/agreements using setDoc
            // We need to verify which call to setDoc was for legal
            // The previous test expects setDoc for settings, here we might have multiple if settings were included.
            // But here we only have legal. So we expect 1 setDoc call.

            // Find the call that writes to the legal path ?? 
            // Since we mocked `doc`, checking the path is hard without examining the doc() mock calls.
            // But we can check the data passed to setDoc.
            expect(setDoc).toHaveBeenCalledWith(
                expect.anything(), // doc ref
                { acceptedMarketingPolicy: true },
                { merge: true }
            );

            // Should update remaining propeties on user doc
            expect(updateDoc).toHaveBeenCalledWith(
                expect.anything(), // doc ref
                { displayName: 'New Name' }
            );
        });

        it('should refresh the auth token and retry optional legal writes after permission-denied', async () => {
            const user = { uid: 'u1' } as AppUserInterface;
            const permissionDeniedError = Object.assign(new Error('Missing or insufficient permissions.'), {
                code: 'permission-denied'
            });

            (setDoc as any)
                .mockRejectedValueOnce(permissionDeniedError)
                .mockResolvedValueOnce(undefined);

            await service.updateUserProperties(user, {
                acceptedMarketingPolicy: true
            });

            expect(mockAuth.currentUser.getIdToken).toHaveBeenCalledWith(true);
            expect(setDoc).toHaveBeenCalledTimes(2);
            expect(setDoc).toHaveBeenNthCalledWith(
                2,
                expect.anything(),
                { acceptedMarketingPolicy: true },
                { merge: true }
            );
            expect(updateDoc).not.toHaveBeenCalled();
        });

        it('should ignore non-boolean optional legal field updates', async () => {
            const user = { uid: 'test-uid' } as AppUserInterface;
            const propertiesToUpdate = {
                displayName: 'New Name',
                acceptedTrackingPolicy: undefined,
                acceptedMarketingPolicy: null
            };

            await service.updateUserProperties(user, propertiesToUpdate);

            expect(setDoc).not.toHaveBeenCalled();
            expect(updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                { displayName: 'New Name' }
            );
        });

        it('should strip restricted legal fields from update', async () => {
            const user = { uid: 'test-uid' } as AppUserInterface;
            const propertiesToUpdate = {
                displayName: 'New Name',
                acceptedMarketingPolicy: true,       // Allowed
                acceptedPrivacyPolicy: true,         // Restricted (should be stripped)
                acceptedDataPolicy: true             // Restricted (should be stripped)
            };

            await service.updateUserProperties(user, propertiesToUpdate);

            // Should write ONLY allowed legal fields to legal/agreements
            expect(setDoc).toHaveBeenCalledWith(
                expect.anything(), // doc ref
                { acceptedMarketingPolicy: true },
                { merge: true }
            );

            // Should update main user doc WITHOUT restricted fields
            expect(updateDoc).toHaveBeenCalledWith(
                expect.anything(), // doc ref
                { displayName: 'New Name' }
            );
        });

        it('should fallback to setDoc merge when main user doc is missing', async () => {
            const user = { uid: 'test-uid' } as AppUserInterface;
            const propertiesToUpdate = {
                onboardingCompleted: true
            };

            (updateDoc as any).mockRejectedValueOnce({ code: 'not-found' });

            await service.updateUserProperties(user, propertiesToUpdate);

            expect(updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                { onboardingCompleted: true }
            );
            expect(setDoc).toHaveBeenCalledWith(
                expect.anything(),
                { onboardingCompleted: true },
                { merge: true }
            );
        });

        it('should throw when main user doc update fails for non-not-found errors', async () => {
            const user = { uid: 'test-uid' } as AppUserInterface;
            const propertiesToUpdate = {
                displayName: 'New Name'
            };

            (updateDoc as any).mockRejectedValueOnce(new Error('permission-denied'));

            await expect(service.updateUserProperties(user, propertiesToUpdate)).rejects.toThrow('permission-denied');
        });

        it('should strip impersonatedBy from partial updates before writing the main user doc', async () => {
            const user = { uid: 'test-uid' } as AppUserInterface;
            const propertiesToUpdate = {
                displayName: 'New Name',
                impersonatedBy: 'admin-uid'
            };

            await service.updateUserProperties(user, propertiesToUpdate);

            expect(updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                { displayName: 'New Name' }
            );
        });

        it('should strip auth-managed date fields from partial updates', async () => {
            const user = { uid: 'test-uid' } as AppUserInterface;
            const propertiesToUpdate = {
                displayName: 'New Name',
                creationDate: new Date('2026-01-01T00:00:00.000Z'),
                lastSignInDate: new Date('2026-01-02T00:00:00.000Z')
            };

            await service.updateUserProperties(user, propertiesToUpdate);

            expect(updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                { displayName: 'New Name' }
            );
        });

        it('should strip deprecated account privacy from partial updates', async () => {
            const user = { uid: 'test-uid' } as AppUserInterface;
            const propertiesToUpdate = {
                displayName: 'New Name',
                privacy: 'public'
            };

            await service.updateUserProperties(user, propertiesToUpdate);

            expect(updateDoc).toHaveBeenCalledWith(
                expect.anything(),
                { displayName: 'New Name' }
            );
        });
    });

    describe('updateUser', () => {
        beforeEach(() => {
            service = TestBed.inject(AppUserService);
        });

        it('should strip impersonatedBy and lastSignInDate from full user writes', async () => {
            const user = {
                uid: 'test-uid',
                displayName: 'Test User',
                impersonatedBy: 'admin-uid',
                privacy: 'public',
                creationDate: new Date('2026-01-01T00:00:00.000Z'),
                lastSignInDate: new Date('2026-01-02T00:00:00.000Z')
            } as AppUserInterface;

            await service.updateUser(user);

            const [, writtenData] = (setDoc as any).mock.calls[0];
            expect(writtenData.displayName).toBe('Test User');
            expect(writtenData.creationDate).toEqual(new Date('2026-01-01T00:00:00.000Z'));
            expect(writtenData.lastSignInDate).toBeUndefined();
            expect(writtenData.impersonatedBy).toBeUndefined();
            expect(writtenData.privacy).toBeUndefined();
        });

        it('does not include server-owned training settings in full user writes', async () => {
            const user = {
                uid: 'test-uid',
                displayName: 'Test User',
                settings: {
                    appSettings: { theme: 'dark' },
                    trainingSettings: {
                        visibleDisciplines: ['cycling'],
                        buildBenchmarks: {
                            cycling: { mode: 'period', durationWeeks: 8, endDayMs: 1_746_403_200_000 },
                        },
                    },
                },
            } as AppUserInterface;

            await service.updateUser(user);

            expect(setDoc).toHaveBeenNthCalledWith(
                2,
                expect.anything(),
                { appSettings: { theme: 'dark' } },
                { merge: true },
            );
        });

        it('should retry full user write without creationDate when merge write is permission-denied', async () => {
            const user = {
                uid: 'test-uid',
                displayName: 'Retry User',
                creationDate: new Date('2026-01-01T00:00:00.000Z'),
            } as AppUserInterface;

            (setDoc as any)
                .mockRejectedValueOnce({ code: 'permission-denied' })
                .mockResolvedValueOnce(undefined);

            await service.updateUser(user);

            expect(setDoc).toHaveBeenCalledTimes(2);
            expect((setDoc as any).mock.calls[0][1].creationDate).toEqual(new Date('2026-01-01T00:00:00.000Z'));
            expect((setDoc as any).mock.calls[1][1].creationDate).toBeUndefined();
        });
    });

    describe('deleteAllUserData', () => {
        beforeEach(() => {
            service = TestBed.inject(AppUserService);
        });
        it('should call deleteSelf cloud function and sign out', async () => {
            await service.deleteAllUserData({ uid: 'u1' } as any);

            expect(mockFunctionsService.call).toHaveBeenCalledWith('deleteSelf');
            expect(mockAuth.signOut).toHaveBeenCalled();
        });

        it('should handle errors', async () => {
            const error = new Error('Delete failed');
            mockFunctionsService.call.mockRejectedValue(error);
            const loggerSpy = vi.spyOn((service as any).logger, 'error');

            await expect(service.deleteAllUserData({ uid: 'u1' } as any)).rejects.toThrow(error);
            expect(loggerSpy).toHaveBeenCalledWith(error);
        });
    });

    describe('Service Integration', () => {
        beforeEach(() => {
            service = TestBed.inject(AppUserService);
        });
        const startDate = new Date('2023-01-01');
        const endDate = new Date('2023-01-31');

        describe('importServiceHistoryForCurrentUser', () => {
            it('should call cloud function for COROS', async () => {
                const serviceName = 'COROS API' as any; // Matches encoded value
                await service.importServiceHistoryForCurrentUser(serviceName, startDate, endDate);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('addCOROSAPIHistoryToQueue', {
                    startDate: '2023-01-01',
                    endDate: '2023-01-31'
                });
            });

            it('sends COROS history dates as local calendar dates rather than UTC timestamps', async () => {
                const localStart = new Date(2023, 0, 1, 23, 30);
                const localEnd = new Date(2023, 0, 2, 1, 30);

                await service.importServiceHistoryForCurrentUser(ServiceNames.COROSAPI, localStart, localEnd);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('addCOROSAPIHistoryToQueue', {
                    startDate: '2023-01-01',
                    endDate: '2023-01-02',
                });
            });

            it('should call cloud function for Suunto', async () => {
                const serviceName = 'Suunto app' as any; // Matches encoded value
                await service.importServiceHistoryForCurrentUser(serviceName, startDate, endDate);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('addSuuntoAppHistoryToQueue', {
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString()
                });
            });

            it('should call cloud function for Garmin', async () => {
                const serviceName = 'Garmin API' as any;
                await service.importServiceHistoryForCurrentUser(serviceName, startDate, endDate);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('backfillGarminAPIActivities', {
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString()
                });
            });

            it('should call cloud function for Wahoo', async () => {
                await service.importServiceHistoryForCurrentUser(ServiceNames.WahooAPI, startDate, endDate);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('addWahooAPIHistoryToQueue', {
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString(),
                });
            });
        });

        describe('backfillSuuntoSleepForCurrentUser', () => {
            it('should call cloud function for Suunto sleep backfill', async () => {
                const response = {
                    queued: 135,
                    startDate: '2016-01-01T00:00:00.000Z',
                    endDate: '2026-04-30T12:00:00.000Z',
                    nextAllowedAtMs: 1_778_244_000_000,
                };
                mockFunctionsService.call.mockResolvedValueOnce({ data: response });

                await expect(service.backfillSuuntoSleepForCurrentUser()).resolves.toEqual(response);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('backfillSuuntoAppSleep');
            });
        });

        describe('getSuuntoHealthSyncAvailabilityForCurrentUser', () => {
            it('returns the current server-owned Suunto Health availability', async () => {
                mockFunctionsService.call.mockResolvedValueOnce({ data: { available: true } });

                await expect(service.getSuuntoHealthSyncAvailabilityForCurrentUser()).resolves.toBe(true);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('getSuuntoHealthSyncAvailability');
            });

            it('fails closed when the callable response does not explicitly enable Health', async () => {
                mockFunctionsService.call.mockResolvedValueOnce({ data: {} });

                await expect(service.getSuuntoHealthSyncAvailabilityForCurrentUser()).resolves.toBe(false);
            });
        });

        describe('backfillCorosSleepForCurrentUser', () => {
            it('should call cloud function for COROS sleep backfill', async () => {
                const response = {
                    queued: 4,
                    startDate: '2026-01-30T12:00:00.000Z',
                    endDate: '2026-04-30T12:00:00.000Z',
                    nextAllowedAtMs: 1_778_244_000_000,
                };
                mockFunctionsService.call.mockResolvedValueOnce({ data: response });

                await expect(service.backfillCorosSleepForCurrentUser()).resolves.toEqual(response);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('backfillCorosAPISleep');
            });
        });

        describe('addSuuntoRoutesToQueueForCurrentUser', () => {
            it('should call cloud function for Suunto route catch-up', async () => {
                const response = {
                    queuedCount: 12,
                    skippedCount: 3,
                    failureCount: 1,
                    totalCount: 16,
                };
                mockFunctionsService.call.mockResolvedValueOnce({ data: response });

                await expect(service.addSuuntoRoutesToQueueForCurrentUser()).resolves.toEqual(response);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('addSuuntoAppRoutesToQueue');
            });
        });

        describe('getGarminHealthSyncAvailabilityForCurrentUser', () => {
            it('returns the current server-owned Garmin Health availability', async () => {
                mockFunctionsService.call.mockResolvedValueOnce({ data: { available: true } });

                await expect(service.getGarminHealthSyncAvailabilityForCurrentUser()).resolves.toBe(true);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('getGarminHealthSyncAvailability');
            });

            it('fails closed when the callable response does not explicitly enable Health', async () => {
                mockFunctionsService.call.mockResolvedValueOnce({ data: {} });

                await expect(service.getGarminHealthSyncAvailabilityForCurrentUser()).resolves.toBe(false);
            });
        });

        describe('backfillGarminHealthForCurrentUser', () => {
            it('should call the combined Garmin sleep and Health backfill function', async () => {
                const response = {
                    queued: 43,
                    startDate: '2016-01-01T00:00:00.000Z',
                    endDate: '2026-04-30T12:00:00.000Z',
                    nextAllowedAtMs: 1_780_231_200_000,
                };
                mockFunctionsService.call.mockResolvedValueOnce({ data: response });

                await expect(service.backfillGarminHealthForCurrentUser()).resolves.toEqual(response);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('backfillGarminAPIHealth');
            });
        });

        describe('backfillActivitySyncRouteForCurrentUser', () => {
            it('should call cloud function for activity sync route backfill', async () => {
                const expectedStartDate = new Date(startDate.getTime());
                expectedStartDate.setHours(0, 0, 0, 0);
                const expectedEndDate = new Date(endDate.getTime());
                expectedEndDate.setHours(23, 59, 59, 999);
                await service.backfillActivitySyncRouteForCurrentUser('Garmin API' as any, 'Suunto app' as any, startDate, endDate);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('backfillActivitySyncRoute', {
                    sourceServiceName: 'Garmin API',
                    destinationServiceName: 'Suunto app',
                    startDate: expectedStartDate.toISOString(),
                    endDate: expectedEndDate.toISOString(),
                });
            });

            it('should normalize backfill request dates to local day boundaries', async () => {
                const startDateWithTime = new Date('2026-04-01T14:21:00.000Z');
                const endDateAtMidnight = new Date('2026-04-16T00:00:00.000Z');
                const expectedStartDate = new Date(startDateWithTime.getTime());
                expectedStartDate.setHours(0, 0, 0, 0);
                const expectedEndDate = new Date(endDateAtMidnight.getTime());
                expectedEndDate.setHours(23, 59, 59, 999);

                await service.backfillActivitySyncRouteForCurrentUser(
                    'Garmin API' as any,
                    'Suunto app' as any,
                    startDateWithTime,
                    endDateAtMidnight,
                );

                expect(mockFunctionsService.call).toHaveBeenCalledWith('backfillActivitySyncRoute', {
                    sourceServiceName: 'Garmin API',
                    destinationServiceName: 'Suunto app',
                    startDate: expectedStartDate.toISOString(),
                    endDate: expectedEndDate.toISOString(),
                });
            });

            it('should accept ISO date string inputs and normalize to local day boundaries', async () => {
                const startDateIso = '2026-04-01T14:21:00.000Z';
                const endDateIso = '2026-04-16T00:00:00.000Z';
                const expectedStartDate = new Date(startDateIso);
                expectedStartDate.setHours(0, 0, 0, 0);
                const expectedEndDate = new Date(endDateIso);
                expectedEndDate.setHours(23, 59, 59, 999);

                await service.backfillActivitySyncRouteForCurrentUser(
                    'Garmin API' as any,
                    'Suunto app' as any,
                    startDateIso as any,
                    endDateIso as any,
                );

                expect(mockFunctionsService.call).toHaveBeenCalledWith('backfillActivitySyncRoute', {
                    sourceServiceName: 'Garmin API',
                    destinationServiceName: 'Suunto app',
                    startDate: expectedStartDate.toISOString(),
                    endDate: expectedEndDate.toISOString(),
                });
            });

            it('should reject null startDate values and avoid triggering backfill', async () => {
                await expect(
                    service.backfillActivitySyncRouteForCurrentUser(
                        'Garmin API' as any,
                        'Suunto app' as any,
                        null as any,
                        endDate,
                    )
                ).rejects.toThrow('Invalid startDate');

                expect(mockFunctionsService.call).not.toHaveBeenCalledWith('backfillActivitySyncRoute', expect.anything());
            });

            it('should reject undefined endDate values and avoid triggering backfill', async () => {
                await expect(
                    service.backfillActivitySyncRouteForCurrentUser(
                        'Garmin API' as any,
                        'Suunto app' as any,
                        startDate,
                        undefined as any,
                    )
                ).rejects.toThrow('Invalid endDate');

                expect(mockFunctionsService.call).not.toHaveBeenCalledWith('backfillActivitySyncRoute', expect.anything());
            });
        });

        describe('backfillRouteDeliverySyncRouteForCurrentUser', () => {
            it('should call cloud function for route delivery sync route backfill', async () => {
                mockFunctionsService.call.mockResolvedValueOnce({
                    data: {
                        scanned: 3,
                        queued: 2,
                        skippedByReason: { already_synced: 1 },
                        failedCount: 0,
                        failedRoutes: [],
                    },
                });

                const summary = await service.backfillRouteDeliverySyncRouteForCurrentUser(
                    ServiceNames.SuuntoApp,
                    ServiceNames.GarminAPI,
                );

                expect(mockFunctionsService.call).toHaveBeenCalledWith('backfillRouteDeliverySyncRoute', {
                    sourceServiceName: ServiceNames.SuuntoApp,
                    destinationServiceName: ServiceNames.GarminAPI,
                });
                expect(summary).toEqual({
                    scanned: 3,
                    queued: 2,
                    skippedByReason: { already_synced: 1 },
                    failedCount: 0,
                    failedRoutes: [],
                });
            });
        });

        describe('deauthorizeService', () => {
            it('should call cloud function for COROS', async () => {
                const serviceName = 'COROS API' as any;
                await service.deauthorizeService(serviceName);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('deauthorizeCOROSAPI');
            });

            it('should call cloud function for Suunto', async () => {
                const serviceName = 'Suunto app' as any;
                await service.deauthorizeService(serviceName);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('deauthorizeSuuntoApp');
            });

            it('should call cloud function for Garmin', async () => {
                const serviceName = 'Garmin API' as any;
                await service.deauthorizeService(serviceName);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('deauthorizeGarminAPI');
            });

            it('should call cloud function for Wahoo', async () => {
                await service.deauthorizeService(ServiceNames.WahooAPI);
                expect(mockFunctionsService.call).toHaveBeenCalledWith('deauthorizeWahooAPI');
            });

            it('retries a disconnect blocked by token refresh', async () => {
                vi.useFakeTimers();
                try {
                    const nowMs = Date.now();
                    mockFunctionsService.call
                        .mockRejectedValueOnce({
                            code: 'functions/unavailable',
                            details: {
                                reason: 'service_disconnect_in_progress',
                                blocker: 'token_refresh',
                                retryAt: nowMs + 100,
                                retryDeadlineAt: nowMs + 90_000,
                            },
                        })
                        .mockResolvedValueOnce({ data: { result: 'Deauthorized' } });

                    const resultPromise = service.deauthorizeService(ServiceNames.WahooAPI);
                    await vi.advanceTimersByTimeAsync(1_000);

                    await expect(resultPromise).resolves.toEqual({ result: 'Deauthorized' });
                    expect(mockFunctionsService.call).toHaveBeenCalledTimes(2);
                } finally {
                    vi.useRealTimers();
                }
            });

            it('does not retry another disconnect already in progress', async () => {
                const error = {
                    code: 'functions/unavailable',
                    details: {
                        reason: 'service_disconnect_in_progress',
                        blocker: 'disconnect_operation',
                        retryAt: Date.now() + 1_000,
                        retryDeadlineAt: Date.now() + 10 * 60_000,
                    },
                };
                mockFunctionsService.call.mockRejectedValueOnce(error);

                await expect(service.deauthorizeService(ServiceNames.WahooAPI)).rejects.toBe(error);
                expect(mockFunctionsService.call).toHaveBeenCalledTimes(1);
            });
        });

        describe('getCurrentUserServiceTokenAndRedirectURI', () => {
            it('should call cloud function for COROS', async () => {
                const serviceName = 'COROS API' as any;

                await service.getCurrentUserServiceTokenAndRedirectURI(serviceName);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('getCOROSAPIAuthRequestTokenRedirectURI', {
                    redirectUri: 'http://localhost/services?serviceName=COROS%20API&connect=1',
                });
            });

            it('should call cloud function for Suunto', async () => {
                const serviceName = 'Suunto app' as any;
                await service.getCurrentUserServiceTokenAndRedirectURI(serviceName);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('getSuuntoAPIAuthRequestTokenRedirectURI', {
                    redirectUri: 'http://localhost/services?serviceName=Suunto%20app&connect=1',
                });
            });

            it('should call cloud function for Garmin', async () => {
                const serviceName = 'Garmin API' as any;
                await service.getCurrentUserServiceTokenAndRedirectURI(serviceName);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('getGarminAPIAuthRequestTokenRedirectURI', {
                    redirectUri: 'http://localhost/services?serviceName=Garmin%20API&connect=1',
                });
            });

            it('should call cloud function for Wahoo', async () => {
                await service.getCurrentUserServiceTokenAndRedirectURI(ServiceNames.WahooAPI);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('getWahooAPIAuthRequestTokenRedirectURI', {
                    redirectUri: 'http://localhost/services?serviceName=Wahoo%20API&connect=1',
                });
            });
        });

        describe('requestAndSetCurrentUserWahooAPIAccessToken', () => {
            it('should return the backend completion result', async () => {
                mockFunctionsService.call.mockResolvedValueOnce({
                    data: { connected: true, outcome: 'connected' },
                });

                await expect(service.requestAndSetCurrentUserWahooAPIAccessToken('state', 'code'))
                    .resolves.toEqual({ connected: true, outcome: 'connected' });

                expect(mockFunctionsService.call).toHaveBeenCalledWith('requestAndSetWahooAPIAccessToken', {
                    state: 'state',
                    code: 'code',
                    redirectUri: 'http://localhost/services?serviceName=Wahoo%20API&connect=1',
                });
            });
        });

        describe('requestAndSetCurrentUserCOROSAPIAccessToken', () => {
            it('should return the backend completion result', async () => {
                mockFunctionsService.call.mockResolvedValueOnce({
                    data: { connected: true, outcome: 'connected' },
                });

                await expect(service.requestAndSetCurrentUserCOROSAPIAccessToken('state', 'code'))
                    .resolves.toEqual({ connected: true, outcome: 'connected' });

                expect(mockFunctionsService.call).toHaveBeenCalledWith('requestAndSetCOROSAPIAccessToken', {
                    state: 'state',
                    code: 'code',
                    redirectUri: 'http://localhost/services?serviceName=COROS%20API&connect=1',
                });
            });
        });

        describe('checkCurrentUserCOROSBindingState', () => {
            it('coalesces concurrent checks for the same local and provider account', async () => {
                let resolveCall!: (value: unknown) => void;
                mockFunctionsService.call.mockReturnValueOnce(new Promise(resolve => {
                    resolveCall = resolve;
                }));

                const first = service.checkCurrentUserCOROSBindingState('u1', 'open-id');
                const second = service.checkCurrentUserCOROSBindingState('u1', 'open-id');

                expect(second).toBe(first);
                expect(mockFunctionsService.call).toHaveBeenCalledTimes(1);
                expect(mockFunctionsService.call).toHaveBeenCalledWith('getCOROSAPIBindingState');

                resolveCall({ data: { status: 'bound', bound: true, checkedAt: 123 } });
                await expect(first).resolves.toEqual({ status: 'bound', bound: true, checkedAt: 123 });

                mockFunctionsService.call.mockResolvedValueOnce({ data: { status: 'bound', bound: true } });
                await service.checkCurrentUserCOROSBindingState('u1', 'open-id');
                expect(mockFunctionsService.call).toHaveBeenCalledTimes(2);
            });

            it('rejects a binding check for a user other than the authenticated user', async () => {
                await expect(service.checkCurrentUserCOROSBindingState('other-user', 'open-id'))
                    .rejects.toThrow('inactive account');
                expect(mockFunctionsService.call).not.toHaveBeenCalled();
            });
        });

        describe('requestAndSetCurrentUserSuuntoAppAccessToken', () => {
            it('should return the backend completion result', async () => {
                mockFunctionsService.call.mockResolvedValueOnce({
                    data: { connected: true, outcome: 'connected' },
                });

                await expect(service.requestAndSetCurrentUserSuuntoAppAccessToken('state', 'code'))
                    .resolves.toEqual({ connected: true, outcome: 'connected' });

                expect(mockFunctionsService.call).toHaveBeenCalledWith('requestAndSetSuuntoAPIAccessToken', {
                    state: 'state',
                    code: 'code',
                    redirectUri: 'http://localhost/services?serviceName=Suunto%20app&connect=1',
                });
            });
        });

        describe('requestAndSetCurrentUserGarminAPIAccessToken', () => {
            it('should return the backend completion result', async () => {
                mockFunctionsService.call.mockResolvedValueOnce({
                    data: { connected: true, outcome: 'connected' },
                });

                await expect(service.requestAndSetCurrentUserGarminAPIAccessToken('state', 'code'))
                    .resolves.toEqual({ connected: true, outcome: 'connected' });

                expect(mockFunctionsService.call).toHaveBeenCalledWith('requestAndSetGarminAPIAccessToken', {
                    state: 'state',
                    code: 'code',
                    redirectUri: 'http://localhost/services?serviceName=Garmin%20API&connect=1',
                });
            });
        });
    });
});
