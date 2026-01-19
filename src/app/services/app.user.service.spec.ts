import { TestBed } from '@angular/core/testing';
import { AppUserService } from './app.user.service';
import { Auth, authState } from '@angular/fire/auth';
import { Firestore, docData, setDoc, updateDoc } from '@angular/fire/firestore';

import { HttpClient } from '@angular/common/http';
import { AppEventService } from './app.event.service';
import { AppWindowService } from './app.window.service';
import { AppUserInterface } from '../models/app-user.interface';
import { of, firstValueFrom } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@angular/fire/auth', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        authState: vi.fn(),
    };
});

vi.mock('@angular/fire/firestore', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        doc: vi.fn().mockReturnValue({}),
        docData: vi.fn(),
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
        mockAuth = {
            currentUser: {
                getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
                getIdToken: vi.fn().mockResolvedValue('test-token'),
                uid: 'u1'
            },
            signOut: vi.fn().mockResolvedValue(undefined)
        };

        mockFunctionsService = {
            call: vi.fn().mockResolvedValue({ success: true })
        };

        (authState as any).mockReturnValue(of(mockAuth.currentUser));

        TestBed.configureTestingModule({
            providers: [
                AppUserService,
                { provide: Auth, useValue: mockAuth },
                { provide: Firestore, useValue: {} },
                { provide: AppFunctionsService, useValue: mockFunctionsService },
                { provide: HttpClient, useValue: {} },
                { provide: AppEventService, useValue: {} },
                { provide: AppWindowService, useValue: {} }
            ]
        });
        service = TestBed.inject(AppUserService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('role checks', () => {
        beforeEach(() => {
            // Default mock for getIdTokenResult
            mockAuth.currentUser.getIdTokenResult.mockReturnValue(Promise.resolve({
                claims: { stripeRole: 'basic' }
            }));

            // Note: because authState is mocked to return the user, we need to ensure firstValueFrom works
            // But AppUserService.getSubscriptionRole uses authState(this.auth)
        });

        it('should return basic role', async () => {
            const role = await service.getSubscriptionRole();
            expect(role).toBe('basic');
        });

        it('hasPaidAccess should return true for basic', async () => {
            const hasAccess = await service.hasPaidAccess();
            expect(hasAccess).toBe(true);
        });

        it('isPro should return false for basic', async () => {
            const isPro = await service.isPro();
            expect(isPro).toBe(false);
        });

        it('should return pro role', async () => {
            mockAuth.currentUser.getIdTokenResult.mockReturnValue(Promise.resolve({
                claims: { stripeRole: 'pro' }
            }));
            const role = await service.getSubscriptionRole();
            expect(role).toBe('pro');
        });

        it('hasPaidAccess should return true for pro', async () => {
            mockAuth.currentUser.getIdTokenResult.mockReturnValue(Promise.resolve({
                claims: { stripeRole: 'pro' }
            }));
            const hasAccess = await service.hasPaidAccess();
            expect(hasAccess).toBe(true);
        });
    });

    describe('getGracePeriodUntil', () => {
        it('should return null if user is not logged in', async () => {
            mockAuth.currentUser = null;
            const res = await firstValueFrom(service.getGracePeriodUntil());
            expect(res).toBeNull();
        });

        it('should return null if no grace period is set', async () => {
            mockAuth.currentUser = {
                uid: 'u1',
                getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} })
            };
            (docData as any).mockReturnValue(of({}));
            const res = await firstValueFrom(service.getGracePeriodUntil());
            expect(res).toBeNull();
        });

        it('should return Date if grace period is set', async () => {
            const mockDate = new Date();
            mockAuth.currentUser = {
                uid: 'u1',
                getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} })
            };
            (docData as any).mockReturnValue(of({
                gracePeriodUntil: { toDate: () => mockDate }
            }));

            const res = await firstValueFrom(service.getGracePeriodUntil());
            expect(res).toEqual(mockDate);
        });
    });
    describe('updateUserProperties', () => {
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
    });

    describe('static user role checks', () => {
        const mockUser = { uid: 'u1' } as any;

        describe('isProUser', () => {
            it('should return false for null user', () => {
                expect(AppUserService.isProUser(null)).toBe(false);
            });

            it('should return true if stripeRole is pro', () => {
                const user = { ...mockUser, stripeRole: 'pro' };
                expect(AppUserService.isProUser(user)).toBe(true);
            });

            it('should return true if isAdmin is true', () => {
                const user = { ...mockUser, stripeRole: 'basic' };
                expect(AppUserService.isProUser(user, true)).toBe(true);
            });

            it('should return true if user.isPro is true', () => {
                const user = { ...mockUser, isPro: true };
                expect(AppUserService.isProUser(user)).toBe(true);
            });

            it('should return false for basic user without admin/isPro', () => {
                const user = { ...mockUser, stripeRole: 'basic' };
                expect(AppUserService.isProUser(user)).toBe(false);
            });

            it('should return false for free user', () => {
                const user = { ...mockUser, stripeRole: 'free' };
                expect(AppUserService.isProUser(user)).toBe(false);
            });
        });

        describe('isBasicUser', () => {
            it('should return false for null user', () => {
                expect(AppUserService.isBasicUser(null)).toBe(false);
            });

            it('should return true if stripeRole is basic', () => {
                const user = { ...mockUser, stripeRole: 'basic' };
                expect(AppUserService.isBasicUser(user)).toBe(true);
            });

            it('should return false if stripeRole is pro', () => {
                const user = { ...mockUser, stripeRole: 'pro' };
                expect(AppUserService.isBasicUser(user)).toBe(false);
            });

            it('should return false if stripeRole is free', () => {
                const user = { ...mockUser, stripeRole: 'free' };
                expect(AppUserService.isBasicUser(user)).toBe(false);
            });
        });

        describe('hasPaidAccessUser', () => {
            it('should return false for null user', () => {
                expect(AppUserService.hasPaidAccessUser(null)).toBe(false);
            });

            it('should return true for basic user', () => {
                const user = { ...mockUser, stripeRole: 'basic' };
                expect(AppUserService.hasPaidAccessUser(user)).toBe(true);
            });

            it('should return true for pro user', () => {
                const user = { ...mockUser, stripeRole: 'pro' };
                expect(AppUserService.hasPaidAccessUser(user)).toBe(true);
            });

            it('should return true if isAdmin is true', () => {
                const user = { ...mockUser, stripeRole: 'free' };
                expect(AppUserService.hasPaidAccessUser(user, true)).toBe(true);
            });

            it('should return true if user.isPro is true', () => {
                const user = { ...mockUser, isPro: true };
                expect(AppUserService.hasPaidAccessUser(user)).toBe(true);
            });

            it('should return false for free user', () => {
                const user = { ...mockUser, stripeRole: 'free' };
                expect(AppUserService.hasPaidAccessUser(user)).toBe(false);
            });
        });
    });
    describe('deleteAllUserData', () => {
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

    describe('Service Integrations', () => {
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
