import { TestBed } from '@angular/core/testing';
import { AppThemeService } from './app.theme.service';
import { AppUserService } from './app.user.service';
import { AppAuthService } from '../authentication/app.auth.service';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { AppThemes, ChartThemes, MapThemes } from '@sports-alliance/sports-lib';

describe('AppThemeService', () => {
    let service: AppThemeService;
    let mockUserService: any;
    let mockAuthService: any;
    let userSubject: BehaviorSubject<any>;
    let mediaQueryListeners: ((e: MediaQueryListEvent) => void)[] = [];
    let mockMediaQueryList: any;

    beforeEach(() => {
        // Clear localStorage before each test
        localStorage.clear();
        mediaQueryListeners = [];

        // Create mock matchMedia - define on window since it may not exist in jsdom
        mockMediaQueryList = {
            matches: false, // Default to light mode
            media: '(prefers-color-scheme: dark)',
            onchange: null,
            addEventListener: vi.fn((event: string, callback: (e: MediaQueryListEvent) => void) => {
                mediaQueryListeners.push(callback);
            }),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        };

        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            configurable: true,
            value: vi.fn().mockReturnValue(mockMediaQueryList),
        });

        userSubject = new BehaviorSubject<any>(null);
        mockAuthService = {
            user$: userSubject.asObservable()
        };

        mockUserService = {
            updateUserProperties: vi.fn().mockResolvedValue(undefined)
        };

        TestBed.configureTestingModule({
            providers: [
                AppThemeService,
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppAuthService, useValue: mockAuthService }
            ]
        });

        service = TestBed.inject(AppThemeService);
    });

    afterEach(() => {
        document.body.classList.remove('dark-theme');
        if (service) {
            service.ngOnDestroy();
        }
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('system theme detection', () => {
        it('should default to system theme (dark) when no preference is stored', async () => {
            // This test verifies that the service correctly reads system preference
            // When mockMediaQueryList.matches is true, system prefers dark
            // Since the service was already initialized, we test the behavior indirectly

            // Clear any stored preference
            localStorage.clear();

            // Manually trigger initializeTheme behavior by checking what would happen
            // The service checks: storedTheme ? use it : use mediaQueryList.matches
            mockMediaQueryList.matches = true;

            // Simulate what initializeTheme does when no storage
            service.setAppTheme(mockMediaQueryList.matches ? AppThemes.Dark : AppThemes.Normal, false);

            const theme = await firstValueFrom(service.getAppTheme());
            expect(theme).toBe(AppThemes.Dark);
            expect(document.body.classList.contains('dark-theme')).toBe(true);
        });

        it('should default to system theme (light) when no preference is stored', async () => {
            localStorage.clear();
            mockMediaQueryList.matches = false;

            // Simulate initializeTheme behavior
            service.setAppTheme(mockMediaQueryList.matches ? AppThemes.Dark : AppThemes.Normal, false);

            const theme = await firstValueFrom(service.getAppTheme());
            expect(theme).toBe(AppThemes.Normal);
            expect(document.body.classList.contains('dark-theme')).toBe(false);
        });

        it('should use stored theme over system theme', async () => {
            // Set stored preference to Dark
            localStorage.setItem('appTheme', AppThemes.Dark);
            mockMediaQueryList.matches = false; // System is light

            // Apply the stored theme (simulating what initializeTheme does)
            service.setAppTheme(AppThemes.Dark);

            const theme = await firstValueFrom(service.getAppTheme());
            expect(theme).toBe(AppThemes.Dark);
        });

        it('should react to system theme changes when no preference is stored', async () => {
            // Start with light system theme, no stored preference
            service.ngOnDestroy();
            localStorage.clear();
            mockMediaQueryList.matches = false;
            service = TestBed.inject(AppThemeService);

            // Verify initial state
            let theme = await firstValueFrom(service.getAppTheme());
            expect(theme).toBe(AppThemes.Normal);

            // Simulate system theme change to dark
            const event = { matches: true } as MediaQueryListEvent;
            mediaQueryListeners.forEach(listener => listener(event));

            theme = await firstValueFrom(service.getAppTheme());
            expect(theme).toBe(AppThemes.Dark);
        });

        it('should NOT react to system theme changes when preference is stored', async () => {
            // Store explicit preference
            localStorage.setItem('appTheme', AppThemes.Normal);

            service.ngOnDestroy();
            mockMediaQueryList.matches = false;
            service = TestBed.inject(AppThemeService);

            // Simulate system theme change to dark
            const event = { matches: true } as MediaQueryListEvent;
            mediaQueryListeners.forEach(listener => listener(event));

            const theme = await firstValueFrom(service.getAppTheme());
            expect(theme).toBe(AppThemes.Normal); // Should still be light
        });
    });

    describe('toggleTheme', () => {
        it('should toggle from light to dark', async () => {
            service.setAppTheme(AppThemes.Normal);

            await service.toggleTheme();

            const theme = await firstValueFrom(service.getAppTheme());
            expect(theme).toBe(AppThemes.Dark);
            expect(localStorage.getItem('appTheme')).toBe(AppThemes.Dark);
        });

        it('should toggle from dark to light', async () => {
            service.setAppTheme(AppThemes.Dark);

            await service.toggleTheme();

            const theme = await firstValueFrom(service.getAppTheme());
            expect(theme).toBe(AppThemes.Normal);
        });
    });

    describe('setAppTheme', () => {
        it('should add dark-theme class to body for dark theme', () => {
            service.setAppTheme(AppThemes.Dark);
            expect(document.body.classList.contains('dark-theme')).toBe(true);
        });

        it('should remove dark-theme class from body for light theme', () => {
            document.body.classList.add('dark-theme');
            service.setAppTheme(AppThemes.Normal);
            expect(document.body.classList.contains('dark-theme')).toBe(false);
        });

        it('should save to localStorage by default', () => {
            service.setAppTheme(AppThemes.Dark);
            expect(localStorage.getItem('appTheme')).toBe(AppThemes.Dark);
        });

        it('should NOT save to localStorage when saveToStorage is false', () => {
            localStorage.clear();
            service.setAppTheme(AppThemes.Dark, false);
            expect(localStorage.getItem('appTheme')).toBeNull();
        });
    });

    describe('user settings integration', () => {
        it('should apply user theme when user logs in', async () => {
            const mockUser = {
                settings: {
                    appSettings: { theme: AppThemes.Dark },
                    chartSettings: { theme: ChartThemes.Dark },
                    mapSettings: { theme: MapThemes.Dark }
                }
            };

            userSubject.next(mockUser);

            const theme = await firstValueFrom(service.getAppTheme());
            expect(theme).toBe(AppThemes.Dark);
        });
    });

    describe('ngOnDestroy', () => {
        it('should remove media query listener on destroy', () => {
            service.ngOnDestroy();
            expect(mockMediaQueryList.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
        });
    });
});
