import { TestBed } from '@angular/core/testing';
import { AppUserService } from './app.user.service';
import { Auth, authState } from '@angular/fire/auth';
import { Firestore, docData, setDoc, updateDoc } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
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
        setDoc: vi.fn(),
        updateDoc: vi.fn(),
    };
});

describe('AppUserService', () => {
    let service: AppUserService;
    let mockAuth: any;

    beforeEach(() => {
        mockAuth = {
            currentUser: {
                getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} })
            }
        };

        // authState(this.auth) returns the user object
        (authState as any).mockReturnValue(of(mockAuth.currentUser));

        TestBed.configureTestingModule({
            providers: [
                AppUserService,
                { provide: Auth, useValue: mockAuth },
                { provide: Firestore, useValue: {} },
                { provide: Functions, useValue: {} },
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
});
