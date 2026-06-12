import { TestBed } from '@angular/core/testing';
import { AppUserService } from './app.user.service';
import { Auth, authState, user } from 'app/firebase/auth';
import { Firestore, collection, collectionData, docData, setDoc, updateDoc } from 'app/firebase/firestore';

import { HttpClient } from '@angular/common/http';
import { AppEventService } from './app.event.service';
import { AppWindowService } from './app.window.service';
import { AppUserInterface } from '../models/app-user.interface';
import { AppUserUtilities } from '../utils/app.user.utilities';
import { of, firstValueFrom, take, from, filter, throwError, defer } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataAltitude, DataCadence, DataGradeAdjustedSpeed, DataHeartRate, DataPace, DataPotentialStamina, DataPower, DataSpeed, DataStamina, ServiceNames } from '@sports-alliance/sports-lib';
import { LoggerService } from './logger.service';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
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

        (docData as any).mockReturnValue(of({}));

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

    it('should fall back to a synthetic user when the profile read is permission-denied after retry', async () => {
        const permissionDeniedError = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied'
        });
        let docDataCallCount = 0;

        (docData as any).mockImplementation(() => {
            docDataCallCount += 1;
            if (docDataCallCount === 1 || docDataCallCount === 5) {
                return throwError(() => permissionDeniedError);
            }

            return of({});
        });

        service = TestBed.inject(AppUserService);
        const mergedUser = await firstValueFrom(service.user$.pipe(filter((user): user is AppUserInterface => !!user), take(1)));

        expect(mockAuth.currentUser.getIdToken).toHaveBeenCalledWith(true);
        expect(mergedUser.uid).toBe('u1');
        expect(mergedUser.emailVerified).toBe(true);
        expect(mergedUser.email).toBe('test@example.com');
        expect(mergedUser.acceptedPrivacyPolicy).toBe(false);
        expect((mergedUser as any).privacy).toBeUndefined();
        expect(mergedUser.settings?.appSettings?.unitSetupCompleted).toBe(false);
        expect(service.hasIncompleteProfileReads('u1')).toBe(true);
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

    it('should recover transient profile reads without requiring a new auth emission', async () => {
        const unavailableError = Object.assign(new Error('Service unavailable'), {
            code: 'unavailable'
        });
        let userDocSubscriptions = 0;
        let docDataCallCount = 0;

        (docData as any).mockImplementation(() => {
            docDataCallCount += 1;
            if (docDataCallCount === 1) {
                return defer(() => {
                    userDocSubscriptions += 1;
                    if (userDocSubscriptions === 1) {
                        return throwError(() => unavailableError);
                    }
                    return of({ uid: 'u1', email: 'transient-recovered@example.com', acceptedPrivacyPolicy: true });
                });
            }
            return of({});
        });

        service = TestBed.inject(AppUserService);
        const mergedUser = await firstValueFrom(service.user$.pipe(filter((user): user is AppUserInterface => !!user), take(1)));

        expect(mergedUser.email).toBe('transient-recovered@example.com');
        expect(mergedUser.acceptedPrivacyPolicy).toBe(true);
        expect(service.hasIncompleteProfileReads('u1')).toBe(false);
    });

    it('should cap transient profile-read retries and fall back to a synthetic user', async () => {
        const unavailableError = Object.assign(new Error('Service unavailable'), {
            code: 'unavailable'
        });
        const transientReadRetryCount = (AppUserService as any).transientReadRetryCount as number;
        let docDataCallCount = 0;
        let userDocSubscriptions = 0;

        (docData as any).mockImplementation(() => {
            docDataCallCount += 1;
            if (docDataCallCount === 1) {
                return defer(() => {
                    userDocSubscriptions += 1;
                    return throwError(() => unavailableError);
                });
            }

            return of({});
        });

        vi.useFakeTimers();
        try {
            service = TestBed.inject(AppUserService);
            const mergedUserPromise = firstValueFrom(service.user$.pipe(filter((user): user is AppUserInterface => !!user), take(1)));

            await vi.runAllTimersAsync();
            const mergedUser = await mergedUserPromise;

            expect(userDocSubscriptions).toBe(transientReadRetryCount + 1);
            expect(mergedUser.uid).toBe('u1');
            expect(mergedUser.acceptedPrivacyPolicy).toBe(false);
            expect(service.hasIncompleteProfileReads('u1')).toBe(true);
        } finally {
            vi.useRealTimers();
        }
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

        (collectionData as any).mockReturnValueOnce(of([{ accessToken: 'token' }]));
        (docData as any).mockReturnValueOnce(of({
            connectionState: 'reconnect_required',
            lastDisconnectedAt: 123,
            lastAuthFailureMessage: 'invalid_grant',
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

        (collectionData as any).mockReturnValueOnce(of([
            {
                accessToken: 'token-a',
                dateCreated: 1710000000000,
                userName: 'suunto-user-a',
            },
            {
                accessToken: 'token-b',
                dateCreated: 1710001000000,
                userName: 'suunto-user-b',
            },
        ]));
        (docData as any).mockReturnValueOnce(of({
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

        (collectionData as any).mockReturnValueOnce(of([
            {
                accessToken: 'token-a',
                dateCreated: 1710000000000,
                userName: 'suunto-user-a',
            },
            {
                accessToken: 'token-b',
                dateCreated: 1710001000000,
                userName: 'suunto-user-b',
            },
        ]));
        (docData as any).mockReturnValueOnce(of({
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

        (collectionData as any).mockReturnValueOnce(of([
            {
                accessToken: 'token-a',
                dateCreated: 1711000000000,
                userName: 'suunto-user-a',
            },
        ]));
        (docData as any).mockReturnValueOnce(of({
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

    describe('createOrUpdateUser policy flow', () => {
        beforeEach(() => {
            service = TestBed.inject(AppUserService);
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

        it('acceptPolicies should persist only legal fields explicitly set to true', async () => {
            const policies = {
                uid: 'u1',
                acceptedPrivacyPolicy: true,
                acceptedDataPolicy: false,
                acceptedTrackingPolicy: true,
                acceptedMarketingPolicy: true,
                acceptedDiagnosticsPolicy: true,
                displayName: 'Should be ignored',
            } as any;

            await service.acceptPolicies(policies);

            expect(setDoc).toHaveBeenCalledTimes(1);
            expect((setDoc as any).mock.calls[0][1]).toEqual({
                acceptedPrivacyPolicy: true,
                acceptedTrackingPolicy: true,
                acceptedMarketingPolicy: true,
                acceptedDiagnosticsPolicy: true,
            });
            expect((setDoc as any).mock.calls[0][2]).toEqual({ merge: true });
        });

        it('should not call updateUser when legal agreement write fails', async () => {
            const user = {
                uid: 'u1',
                acceptedPrivacyPolicy: true,
                acceptedDataPolicy: true,
            } as AppUserInterface;
            const writeError = new Error('permission-denied');
            const updateUserSpy = vi.spyOn(service, 'updateUser');
            (setDoc as any).mockRejectedValueOnce(writeError);

            await expect(service.createOrUpdateUser(user)).rejects.toThrow('permission-denied');

            expect(updateUserSpy).not.toHaveBeenCalled();
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

        it('getServiceToken should read Suunto tokens from suuntoAppAccessTokens collection', async () => {
            const user = { uid: 'u1' } as any;
            const tokens = [{ accessToken: 'suunto-token' }];
            (collectionData as any).mockReturnValueOnce(of(tokens));

            const result = await firstValueFrom(service.getServiceToken(user, ServiceNames.SuuntoApp));

            expect(collection).toHaveBeenCalledWith(expect.anything(), 'suuntoAppAccessTokens', 'u1', 'tokens');
            expect(result).toEqual(tokens);
        });

        it('getServiceToken should read COROS tokens from COROSAPIAccessTokens collection', async () => {
            const user = { uid: 'u2' } as any;
            const tokens = [{ accessToken: 'coros-token' }];
            (collectionData as any).mockReturnValueOnce(of(tokens));

            const result = await firstValueFrom(service.getServiceToken(user, ServiceNames.COROSAPI));

            expect(collection).toHaveBeenCalledWith(expect.anything(), 'COROSAPIAccessTokens', 'u2', 'tokens');
            expect(result).toEqual(tokens);
        });

        it('getServiceToken should read Garmin tokens from garminAPITokens collection', async () => {
            const user = { uid: 'u3' } as any;
            const tokens = [{ accessToken: 'garmin-token' }];
            (collectionData as any).mockReturnValueOnce(of(tokens));

            const result = await firstValueFrom(service.getServiceToken(user, ServiceNames.GarminAPI));

            expect(collection).toHaveBeenCalledWith(expect.anything(), 'garminAPITokens', 'u3', 'tokens');
            expect(result).toEqual(tokens);
        });

        it('getServiceToken should throw for unsupported service names', () => {
            const user = { uid: 'u4' } as any;

            expect(() => service.getServiceToken(user, 'Unsupported service' as any)).toThrow(
                'Not implemented for service Unsupported service'
            );
        });

        it('getServiceToken should recover with empty array when Suunto token query fails', async () => {
            const user = { uid: 'u5' } as any;
            (collectionData as any).mockReturnValueOnce(throwError(() => new Error('Suunto read failed')));

            const result = await firstValueFrom(service.getServiceToken(user, ServiceNames.SuuntoApp));

            expect(result).toEqual([]);
        });

        it('getServiceToken should recover with empty array when Garmin token query fails', async () => {
            const user = { uid: 'u6' } as any;
            (collectionData as any).mockReturnValueOnce(throwError(() => new Error('Garmin read failed')));

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
            (collectionData as any)
                .mockReturnValueOnce(of([{ accessToken: 'garmin-token' }]))
                .mockReturnValueOnce(of([{ accessToken: 'suunto-token' }]))
                .mockReturnValueOnce(of([]));

            const result = await firstValueFrom(service.watchActivityServiceConnectionState(user));

            expect(result).toEqual({
                [ServiceNames.GarminAPI]: true,
                [ServiceNames.SuuntoApp]: true,
                [ServiceNames.COROSAPI]: false,
            });
        });

        it('watchHasAnyActivityServiceConnection should emit false when activity service token streams are empty', async () => {
            const user = { uid: 'u7' } as any;
            (collectionData as any)
                .mockReturnValueOnce(of([]))
                .mockReturnValueOnce(of([]))
                .mockReturnValueOnce(of([]));

            const result = await firstValueFrom(service.watchHasAnyActivityServiceConnection(user));

            expect(result).toBe(false);
            expect(collection).toHaveBeenNthCalledWith(1, expect.anything(), 'garminAPITokens', 'u7', 'tokens');
            expect(collection).toHaveBeenNthCalledWith(2, expect.anything(), 'suuntoAppAccessTokens', 'u7', 'tokens');
            expect(collection).toHaveBeenNthCalledWith(3, expect.anything(), 'COROSAPIAccessTokens', 'u7', 'tokens');
        });

        it('watchHasAnyActivityServiceConnection should emit true when any activity service has a token', async () => {
            const user = { uid: 'u8' } as any;
            (collectionData as any)
                .mockReturnValueOnce(of([]))
                .mockReturnValueOnce(of([{ accessToken: 'suunto-token' }]))
                .mockReturnValueOnce(of([]));

            const result = await firstValueFrom(service.watchHasAnyActivityServiceConnection(user));

            expect(result).toBe(true);
        });

        it('watchHasAnyActivityServiceConnection should fail closed when token reads fail', async () => {
            const user = { uid: 'u9' } as any;
            (collectionData as any)
                .mockReturnValueOnce(throwError(() => new Error('Garmin read failed')))
                .mockReturnValueOnce(throwError(() => new Error('Suunto read failed')))
                .mockReturnValueOnce(throwError(() => new Error('COROS read failed')));

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
        beforeEach(() => {
            service = TestBed.inject(AppUserService);
        });

        it('should skip settings writes when profile reads are incomplete', async () => {
            const user = { uid: 'u1' } as any;
            const settings = { theme: 'dark' };

            (service as any).usersWithIncompleteProfileReads.add('u1');
            await service.updateUserProperties(user, { settings });

            expect(setDoc).not.toHaveBeenCalled();
            expect(updateDoc).not.toHaveBeenCalled();
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
                    startDate,
                    endDate
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

        describe('backfillGarminSleepForCurrentUser', () => {
            it('should call cloud function for Garmin sleep backfill', async () => {
                const response = {
                    queued: 43,
                    startDate: '2016-01-01T00:00:00.000Z',
                    endDate: '2026-04-30T12:00:00.000Z',
                    nextAllowedAtMs: 1_780_231_200_000,
                };
                mockFunctionsService.call.mockResolvedValueOnce({ data: response });

                await expect(service.backfillGarminSleepForCurrentUser()).resolves.toEqual(response);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('backfillGarminAPISleep');
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
        });

        describe('getCurrentUserServiceTokenAndRedirectURI', () => {
            it('should call cloud function for COROS', async () => {
                const serviceName = 'COROS API' as any;

                await service.getCurrentUserServiceTokenAndRedirectURI(serviceName);

                // Check for substrings since full URL depends on encoded spaces
                expect(mockFunctionsService.call).toHaveBeenCalledWith('getCOROSAPIAuthRequestTokenRedirectURI', {
                    redirectUri: expect.stringMatching(/COROS%20API/)
                });
            });

            it('should call cloud function for Suunto', async () => {
                const serviceName = 'Suunto app' as any;
                await service.getCurrentUserServiceTokenAndRedirectURI(serviceName);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('getSuuntoAPIAuthRequestTokenRedirectURI', {
                    redirectUri: expect.stringMatching(/Suunto%20app/)
                });
            });

            it('should call cloud function for Garmin', async () => {
                const serviceName = 'Garmin API' as any;
                await service.getCurrentUserServiceTokenAndRedirectURI(serviceName);

                expect(mockFunctionsService.call).toHaveBeenCalledWith('getGarminAPIAuthRequestTokenRedirectURI', {
                    redirectUri: expect.stringMatching(/Garmin%20API/)
                });
            });
        });

        describe('requestAndSetCurrentUserCOROSAPIAccessToken', () => {
            it('should call cloud function', async () => {
                await service.requestAndSetCurrentUserCOROSAPIAccessToken('state', 'code');

                expect(mockFunctionsService.call).toHaveBeenCalledWith('requestAndSetCOROSAPIAccessToken', {
                    state: 'state',
                    code: 'code',
                    redirectUri: expect.stringMatching(/COROS%20API/)
                });
            });
        });

        describe('requestAndSetCurrentUserSuuntoAppAccessToken', () => {
            it('should call cloud function', async () => {
                await service.requestAndSetCurrentUserSuuntoAppAccessToken('state', 'code');

                expect(mockFunctionsService.call).toHaveBeenCalledWith('requestAndSetSuuntoAPIAccessToken', {
                    state: 'state',
                    code: 'code',
                    redirectUri: expect.stringMatching(/Suunto%20app/)
                });
            });
        });

        describe('requestAndSetCurrentUserGarminAPIAccessToken', () => {
            it('should call cloud function', async () => {
                await service.requestAndSetCurrentUserGarminAPIAccessToken('state', 'code');

                expect(mockFunctionsService.call).toHaveBeenCalledWith('requestAndSetGarminAPIAccessToken', {
                    state: 'state',
                    code: 'code',
                    redirectUri: expect.stringMatching(/Garmin%20API/)
                });
            });
        });
    });
});
