import { TestBed } from '@angular/core/testing';
import { AppUserService } from './app.user.service';
import { Auth, authState } from '@angular/fire/auth';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { HttpClient } from '@angular/common/http';
import { AppEventService } from './app.event.service';
import { AppWindowService } from './app.window.service';
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
        doc: vi.fn(),
        docData: vi.fn(),
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
});
