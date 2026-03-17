import { TestBed } from '@angular/core/testing';
import { AppUserService } from './app.user.service';
import { Auth, authState, user } from '@angular/fire/auth';
import { Firestore, collection, collectionData, docData, setDoc, updateDoc } from '@angular/fire/firestore';

import { HttpClient } from '@angular/common/http';
import { AppEventService } from './app.event.service';
import { AppWindowService } from './app.window.service';
import { AppUserInterface } from '../models/app-user.interface';
import { AppUserUtilities } from '../utils/app.user.utilities';
import { of, firstValueFrom, take, from, filter, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataAltitude, DataCadence, DataGradeAdjustedSpeed, DataHeartRate, DataPace, DataPower, DataSpeed, DynamicDataLoader, ServiceNames } from '@sports-alliance/sports-lib';

vi.mock('@angular/fire/auth', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        authState: vi.fn(),
        user: vi.fn(),
    };
});

vi.mock('@angular/fire/firestore', async (importOriginal) => {
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
                        [DataSpeed.type]: { enabled: true },
                        [DataPower.type]: { enabled: true },
                        customType: { enabled: true },
                    }
                }
            }
        } as any;

        const canonicalChartDataTypes = [
            ...DynamicDataLoader.basicDataTypes,
            ...DynamicDataLoader.advancedDataTypes.filter((dataType) => !DynamicDataLoader.basicDataTypes.includes(dataType)),
        ];
        const enabledDataTypes = [
            DataAltitude.type,
            DataCadence.type,
            DataGradeAdjustedSpeed.type,
            DataHeartRate.type,
            DataPace.type,
            DataPower.type,
            DataSpeed.type,
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
                getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} })
            }));
            (user as any).mockReturnValue(of({
                uid: 'u1',
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
                getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} })
            }));
            (user as any).mockReturnValue(of({
                uid: 'u1',
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
    });

    describe('updateUser', () => {
        beforeEach(() => {
            service = TestBed.inject(AppUserService);
        });

        it('should strip impersonatedBy from full user writes', async () => {
            const user = {
                uid: 'test-uid',
                displayName: 'Test User',
                impersonatedBy: 'admin-uid'
            } as AppUserInterface;

            await service.updateUser(user);

            const [, writtenData] = (setDoc as any).mock.calls[0];
            expect(writtenData.displayName).toBe('Test User');
            expect(writtenData.impersonatedBy).toBeUndefined();
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
