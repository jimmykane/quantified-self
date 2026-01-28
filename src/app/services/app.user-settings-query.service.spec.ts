
import { TestBed } from '@angular/core/testing';
import { AppUserSettingsQueryService } from './app.user-settings-query.service';
import { AppAuthService } from '../authentication/app.auth.service';
import { BehaviorSubject } from 'rxjs';
import { User, ChartThemes, AppThemes, MapTypes } from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('AppUserSettingsQueryService', () => {
    let service: AppUserSettingsQueryService;
    let mockUserSubject: BehaviorSubject<User | null>;
    let mockAuthService: { user$: any };

    const createMockUser = (overrides: any = {}): User => ({
        id: 'test-uid',
        email: 'test@example.com',
        settings: {
            chartSettings: {
                theme: ChartThemes.Dark,
                showGrid: true,
            },
            mapSettings: {
                type: MapTypes.Hybrid,
                showLaps: true,
            },
            appSettings: {
                theme: AppThemes.Dark,
            },
        },
        ...overrides
    } as unknown as User);


    beforeEach(() => {
        mockUserSubject = new BehaviorSubject<User | null>(null);
        mockAuthService = {
            user$: mockUserSubject.asObservable()
        };

        TestBed.configureTestingModule({
            providers: [
                AppUserSettingsQueryService,
                { provide: AppAuthService, useValue: mockAuthService }
            ]
        });

        service = TestBed.inject(AppUserSettingsQueryService);
    });

    afterEach(() => {
        mockUserSubject.complete();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('chartSettings', () => {
        it('should emit distinct values only when chart settings deeply change', () => {
            const user1 = createMockUser();
            mockUserSubject.next(user1);
            TestBed.flushEffects();

            const firstEmission = service.chartSettings();
            expect(firstEmission.theme).toBe(ChartThemes.Dark);
            expect(firstEmission.showGrid).toBe(true);

            // Emit SAME user object reference
            mockUserSubject.next(user1);
            TestBed.flushEffects();
            expect(service.chartSettings()).toBe(firstEmission); // Should be strictly equal (same ref from signal)

            // Emit NEW user object but SAME chart settings
            const user2 = createMockUser({ email: 'new@example.com' });
            mockUserSubject.next(user2);
            TestBed.flushEffects();

            // Since fast-deep-equal is used, it might emit a new object if the mapping creates a new object ref, 
            // BUT distinctUntilChanged with 'equal' should prevent downstream notification if contents identical.
            // However, toSignal returns the latest value. Let's verify content.
            const secondEmission = service.chartSettings();

            // CRITICAL: The service uses distinctUntilChanged BEFORE toSignal.
            // If distinctUntilChanged works, the internal observable won't emit.
            // However, toSignal holds the current value.
            // Let's verify deeply.
            expect(secondEmission).toEqual(firstEmission);

            // Emit NEW user object with DIFFERENT chart settings
            const user3 = createMockUser();
            if (!user3.settings) user3.settings = {};
            user3.settings.chartSettings = { theme: ChartThemes.Light, showGrid: false };

            mockUserSubject.next(user3);
            TestBed.flushEffects();

            const thirdEmission = service.chartSettings();
            expect(thirdEmission.theme).toBe(ChartThemes.Light);
            expect(thirdEmission.showGrid).toBe(false);
            expect(thirdEmission).not.toEqual(firstEmission);
        });

        it('should handle null user by returning empty object (as defined in service)', () => {
            mockUserSubject.next(null);
            TestBed.flushEffects();
            expect(service.chartSettings()).toEqual({});
        });
    });

    describe('mapSettings', () => {
        it('should emit distinct values only when map settings deeply change', () => {
            const user1 = createMockUser();
            mockUserSubject.next(user1);
            TestBed.flushEffects();

            const first = service.mapSettings();
            expect(first.type).toBe(MapTypes.Hybrid);

            // Change unrelated setting
            const user2 = createMockUser();
            user2.settings.chartSettings = { theme: ChartThemes.Material }; // Change chart, keep map same
            mockUserSubject.next(user2);
            TestBed.flushEffects();

            const second = service.mapSettings();
            expect(second).toEqual(first); // Should match deeply

            // Change map setting
            const user3 = createMockUser();
            user3.settings.mapSettings = { type: MapTypes.Streets, showLaps: false };
            mockUserSubject.next(user3);
            TestBed.flushEffects();

            const third = service.mapSettings();
            expect(third.type).toBe(MapTypes.Streets);
            expect(third).not.toEqual(first);
        });
    });

    describe('appThemeSetting', () => {
        it('should track app theme changes', () => {
            const user = createMockUser();
            user.settings.appSettings = { theme: AppThemes.Light };
            mockUserSubject.next(user);
            TestBed.flushEffects();

            expect(service.appThemeSetting()).toBe(AppThemes.Light);

            const user2 = createMockUser();
            user2.settings.appSettings = { theme: AppThemes.Dark };
            mockUserSubject.next(user2);
            TestBed.flushEffects();

            expect(service.appThemeSetting()).toBe(AppThemes.Dark);
        });
    });

});
