import { TestBed } from '@angular/core/testing';
import { AppRemoteConfigService } from './app.remote-config.service';
import { AppWindowService } from './app.window.service';
import { AppUserService } from './app.user.service';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { APP_STORAGE } from './storage/app.storage.token';
import { PLATFORM_ID } from '@angular/core';
import { RemoteConfig } from '@angular/fire/remote-config';
import { fetchAndActivate, getString } from 'firebase/remote-config';

// Mock the environment
vi.mock('../../environments/environment', () => ({
    environment: {
        production: false,
        beta: false,
        localhost: true
    }
}));

// Mock firebase/remote-config (not @angular/fire/remote-config)
vi.mock('firebase/remote-config', () => {
    return {
        fetchAndActivate: vi.fn(),
        getString: vi.fn()
    };
});

describe('AppRemoteConfigService', () => {
    let service: AppRemoteConfigService;
    let mockWindowService: any;
    let mockUserService: any;
    let mockWindow: any;
    let mockRemoteConfig: any;
    let mockStorage: any;

    beforeEach(async () => {
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

        mockStorage = {
            getItem: vi.fn().mockReturnValue(null),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
            key: vi.fn(),
            length: 0
        };

        // Reset mocks
        vi.clearAllMocks();
        vi.mocked(fetchAndActivate).mockResolvedValue(true);

        // Default: maintenance is off
        vi.mocked(getString).mockReturnValue('');

        TestBed.configureTestingModule({
            providers: [
                AppRemoteConfigService,
                { provide: AppWindowService, useValue: mockWindowService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: APP_STORAGE, useValue: mockStorage },
                { provide: PLATFORM_ID, useValue: 'browser' },
                { provide: RemoteConfig, useValue: mockRemoteConfig }
            ]
        });

        service = TestBed.inject(AppRemoteConfigService);

        // Wait for initialization to complete
        await new Promise(resolve => setTimeout(resolve, 50));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should fetch config via Firebase SDK', () => {
        expect(fetchAndActivate).toHaveBeenCalled();
    });

    it('should expose isLoading signal', () => {
        expect(service.isLoading).toBeDefined();
    });

    it('should expose maintenanceMode signal', () => {
        expect(service.maintenanceMode).toBeDefined();
    });

    it('should expose maintenanceMessage signal', () => {
        expect(service.maintenanceMessage).toBeDefined();
    });

    describe('maintenanceMode signal', () => {
        it('should return false when maintenance is disabled', async () => {
            // getString returns '' for both enabled and message
            vi.mocked(getString).mockReturnValue('');

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService },
                    { provide: APP_STORAGE, useValue: mockStorage },
                    { provide: PLATFORM_ID, useValue: 'browser' },
                    { provide: RemoteConfig, useValue: mockRemoteConfig }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(service.maintenanceMode()).toBe(false);
        });

        it('should return true when maintenance is enabled for current env', async () => {
            // Mock getString to return 'true' for dev_enabled (localhost = dev)
            vi.mocked(getString).mockImplementation((_rc, key) => {
                if (key === 'dev_enabled') return 'true';
                if (key === 'dev_message') return 'Dev Maintenance';
                return '';
            });

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService },
                    { provide: APP_STORAGE, useValue: mockStorage },
                    { provide: PLATFORM_ID, useValue: 'browser' },
                    { provide: RemoteConfig, useValue: mockRemoteConfig }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(service.maintenanceMode()).toBe(true);
            expect(service.maintenanceMessage()).toBe('Dev Maintenance');
        });

        it('should return false for admin users even when maintenance is enabled', async () => {
            mockUserService.isAdmin.mockResolvedValue(true);
            vi.mocked(getString).mockImplementation((_rc, key) => {
                if (key === 'dev_enabled') return 'true';
                if (key === 'dev_message') return 'Maintenance';
                return '';
            });

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService },
                    { provide: APP_STORAGE, useValue: mockStorage },
                    { provide: PLATFORM_ID, useValue: 'browser' },
                    { provide: RemoteConfig, useValue: mockRemoteConfig }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(service.maintenanceMode()).toBe(false);
        });

        it('should return false on fetch error (graceful degradation)', async () => {
            vi.mocked(fetchAndActivate).mockRejectedValue(new Error('SDK error'));

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService },
                    { provide: APP_STORAGE, useValue: mockStorage },
                    { provide: PLATFORM_ID, useValue: 'browser' },
                    { provide: RemoteConfig, useValue: mockRemoteConfig }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(service.maintenanceMode()).toBe(false);
        });

        it('should bypass maintenance mode with query parameter', async () => {
            mockWindow.location.search = '?bypass_maintenance=true';
            vi.mocked(getString).mockImplementation((_rc, key) => {
                if (key === 'dev_enabled') return 'true';
                if (key === 'dev_message') return 'Maintenance';
                return '';
            });

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService },
                    { provide: APP_STORAGE, useValue: mockStorage },
                    { provide: PLATFORM_ID, useValue: 'browser' },
                    { provide: RemoteConfig, useValue: mockRemoteConfig }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(service.maintenanceMode()).toBe(false);
        });

        it('should bypass maintenance mode with localStorage flag', async () => {
            mockStorage.getItem.mockReturnValue('true');
            vi.mocked(getString).mockImplementation((_rc, key) => {
                if (key === 'dev_enabled') return 'true';
                if (key === 'dev_message') return 'Maintenance';
                return '';
            });

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService },
                    { provide: APP_STORAGE, useValue: mockStorage },
                    { provide: PLATFORM_ID, useValue: 'browser' },
                    { provide: RemoteConfig, useValue: mockRemoteConfig }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(service.maintenanceMode()).toBe(false);
        });
    });
});
