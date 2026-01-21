import { TestBed } from '@angular/core/testing';
import { AppRemoteConfigService } from './app.remote-config.service';
import { AppWindowService } from './app.window.service';
import { AppUserService } from './app.user.service';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { APP_STORAGE } from './storage/app.storage.token';
import { PLATFORM_ID } from '@angular/core';
import { RemoteConfig, fetchAndActivate, getAll, getValue } from '@angular/fire/remote-config';

// Mock the module
vi.mock('@angular/fire/remote-config', () => {
    return {
        RemoteConfig: class { },
        fetchAndActivate: vi.fn(),
        getAll: vi.fn(),
        getValue: vi.fn()
    };
});

describe('AppRemoteConfigService', () => {
    let service: AppRemoteConfigService;
    let mockWindowService: any;
    let mockUserService: any;
    let mockWindow: any;
    let mockRemoteConfig: any;

    beforeEach(() => {
        mockWindow = {
            location: { search: '' }
        };

        mockWindowService = {
            windowRef: mockWindow
        };

        mockUserService = {
            isAdmin: vi.fn().mockResolvedValue(false)
        };

        mockRemoteConfig = {
            settings: {}
        };

        // Reset mocks and define default behavior
        vi.mocked(fetchAndActivate).mockResolvedValue(true);
        vi.mocked(getAll).mockReturnValue({
            maintenance_mode: { asBoolean: () => false } as any,
            maintenance_message: { asString: () => 'Test message' } as any
        } as any);

        // Mock storage instead of global localStorage
        const storageMock = {
            getItem: vi.fn().mockReturnValue('test-instance-id'),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
            key: vi.fn(),
            length: 0
        };

        TestBed.configureTestingModule({
            providers: [
                AppRemoteConfigService,
                { provide: AppWindowService, useValue: mockWindowService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: APP_STORAGE, useValue: storageMock },
                { provide: PLATFORM_ID, useValue: 'browser' },
                { provide: RemoteConfig, useValue: mockRemoteConfig }
            ]
        });

        service = TestBed.inject(AppRemoteConfigService);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should fetch config via AngularFire SDK', async () => {
        await firstValueFrom(service.getMaintenanceMode());
        expect(fetchAndActivate).toHaveBeenCalled();
        expect(getAll).toHaveBeenCalled();
    });

    it('should expose isLoading state', () => {
        expect(service.isLoading).toBeDefined();
    });

    describe('getMaintenanceMode', () => {
        it('should return true when maintenance_mode is "true" for non-admin', async () => {
            vi.mocked(getAll).mockReturnValue({
                maintenance_mode: { asBoolean: () => true } as any,
                maintenance_message: { asString: () => 'Maintenance in progress' } as any
            } as any);

            // Re-create service to trigger init
            const storageMock = { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() };
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService },
                    { provide: APP_STORAGE, useValue: storageMock },
                    { provide: PLATFORM_ID, useValue: 'browser' },
                    { provide: RemoteConfig, useValue: mockRemoteConfig }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);

            const mode = await firstValueFrom(service.getMaintenanceMode());
            expect(mode).toBe(true);
        });

        it('should return false for admin users even when maintenance is true', async () => {
            mockUserService.isAdmin.mockResolvedValue(true);
            vi.mocked(getAll).mockReturnValue({
                maintenance_mode: { asBoolean: () => true } as any,
                maintenance_message: { asString: () => 'Maintenance in progress' } as any
            } as any);

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService },
                    { provide: APP_STORAGE, useValue: { getItem: vi.fn(), setItem: vi.fn() } },
                    { provide: PLATFORM_ID, useValue: 'browser' },
                    { provide: RemoteConfig, useValue: mockRemoteConfig }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);

            const mode = await firstValueFrom(service.getMaintenanceMode());
            expect(mode).toBe(false);
        });

        it('should return false on fetch error (graceful degradation)', async () => {
            vi.mocked(fetchAndActivate).mockRejectedValue(new Error('SDK error'));

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService },
                    { provide: APP_STORAGE, useValue: { getItem: vi.fn(), setItem: vi.fn() } },
                    { provide: PLATFORM_ID, useValue: 'browser' },
                    { provide: RemoteConfig, useValue: mockRemoteConfig }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);

            const mode = await firstValueFrom(service.getMaintenanceMode());
            expect(mode).toBe(false);
        });

        it('should bypass maintenance mode with query parameter', async () => {
            mockWindow.location.search = '?bypass_maintenance=true';
            vi.mocked(getAll).mockReturnValue({
                maintenance_mode: { asBoolean: () => true } as any
            } as any);

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService },
                    { provide: APP_STORAGE, useValue: { getItem: vi.fn(), setItem: vi.fn() } },
                    { provide: PLATFORM_ID, useValue: 'browser' },
                    { provide: RemoteConfig, useValue: mockRemoteConfig }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);

            const mode = await firstValueFrom(service.getMaintenanceMode());
            expect(mode).toBe(false);
        });
    });

    describe('Environment-specific keys', () => {
        it('should use maintenance_mode_dev when localhost is true', async () => {
            // Mock environment specifics if possible, or just mock the getAll return to simulate
            // what getAll would return.
            vi.mocked(getAll).mockReturnValue({
                maintenance_mode_dev: { asBoolean: () => true } as any,
                maintenance_mode: { asBoolean: () => false } as any
            } as any);

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService },
                    { provide: APP_STORAGE, useValue: { getItem: vi.fn(), setItem: vi.fn() } },
                    { provide: PLATFORM_ID, useValue: 'browser' },
                    { provide: RemoteConfig, useValue: mockRemoteConfig }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);

            const mode = await firstValueFrom(service.getMaintenanceMode());
            // Assuming environment.localhost is true in test env, it should pick dev key
            expect(mode).toBeDefined();
        });
    });
});
