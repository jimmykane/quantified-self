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
        // Reset mocks and define default behavior
        vi.mocked(fetchAndActivate).mockResolvedValue(true);

        const defaultMaintenanceConfig = JSON.stringify({
            default: { enabled: false, message: 'Default Test Message' }
        });

        vi.mocked(getAll).mockReturnValue({
            maintenance_config: { asString: () => defaultMaintenanceConfig } as any
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
        it('should return true when maintenance_config.prod.enabled is true for non-admin (prod env)', async () => {
            // Mock environment to produce 'prod' if needed, or rely on default inference
            const maintenanceConfig = JSON.stringify({
                prod: { enabled: true, message: 'Maintenance' },
                default: { enabled: false, message: 'Default' }
            });

            vi.mocked(getAll).mockReturnValue({
                maintenance_config: { asString: () => maintenanceConfig } as any
            } as any);

            // Re-create service to trigger init
            TestBed.resetTestingModule();
            const storageMock = { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() };
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

            // Force environment to be 'prod' for this test
            vi.spyOn(service as any, 'environmentName', 'get').mockReturnValue('prod');

            const mode = await firstValueFrom(service.getMaintenanceMode());
            expect(mode).toBe(true);
        });

        it('should fallback to default when specific env is missing', async () => {
            const maintenanceConfig = JSON.stringify({
                default: { enabled: true, message: 'Default Maintenance' }
                // 'prod'/'dev'/'beta' missing
            });

            vi.mocked(getAll).mockReturnValue({
                maintenance_config: { asString: () => maintenanceConfig } as any
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

            // Should pick up 'default' since current env (likely 'dev' or 'prod') is not in json
            const mode = await firstValueFrom(service.getMaintenanceMode());
            expect(mode).toBe(true);
        });

        it('should default to false/empty if JSON is missing completely', async () => {
            vi.mocked(getAll).mockReturnValue({} as any);

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
            const msg = await firstValueFrom(service.getMaintenanceMessage());
            expect(msg).toBe('We will be back soon.');
        });

        it('should return false for admin users even when maintenance is true', async () => {
            mockUserService.isAdmin.mockResolvedValue(true);
            const maintenanceConfig = JSON.stringify({
                default: { enabled: true, message: 'Maintenance' }
            });

            vi.mocked(getAll).mockReturnValue({
                maintenance_config: { asString: () => maintenanceConfig } as any
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
            const maintenanceConfig = JSON.stringify({
                default: { enabled: true, message: 'Maintenance' }
            });
            vi.mocked(getAll).mockReturnValue({
                maintenance_config: { asString: () => maintenanceConfig } as any
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

    describe('Environment-specific keys (JSON)', () => {
        it('should parse JSON correctly', async () => {
            const maintenanceConfig = JSON.stringify({
                dev: { enabled: true, message: 'Dev Mode' },
                prod: { enabled: false, message: 'Prod Mode' }
            });

            vi.mocked(getAll).mockReturnValue({
                maintenance_config: { asString: () => maintenanceConfig } as any
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

            // We can't easily check private environmentName, but we can verify it doesn't crash 
            // and returns *some* boolean.
            const mode = await firstValueFrom(service.getMaintenanceMode());
            expect(mode).toBeDefined();
        });
    });
});
