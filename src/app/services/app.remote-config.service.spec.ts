import { TestBed } from '@angular/core/testing';
import { AppRemoteConfigService } from './app.remote-config.service';
import { fetchAndActivate, getBoolean, getString, getRemoteConfig } from 'firebase/remote-config';
import { AppWindowService } from './app.window.service';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { FirebaseApp } from '@angular/fire/app';

vi.mock('firebase/remote-config', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        getRemoteConfig: vi.fn(),
        fetchAndActivate: vi.fn(),
        getBoolean: vi.fn(),
        getString: vi.fn(),
    };
});

describe('AppRemoteConfigService', () => {
    let service: AppRemoteConfigService;
    let mockRemoteConfig: any;
    let mockWindowService: any;
    let mockWindow: any;
    let mockFirebaseApp: any;

    beforeEach(() => {
        mockRemoteConfig = {
            defaultConfig: {},
            settings: {}
        };

        mockWindow = {
            location: { search: '' }
        };

        mockWindowService = {
            windowRef: mockWindow
        };

        mockFirebaseApp = {
            name: '[DEFAULT]',
            options: {}
        };

        (getRemoteConfig as any).mockReturnValue(mockRemoteConfig);
        (fetchAndActivate as any).mockResolvedValue(true);
        (getBoolean as any).mockReturnValue(false);
        (getString as any).mockReturnValue('Default maintenance message');

        TestBed.configureTestingModule({
            providers: [
                AppRemoteConfigService,
                { provide: FirebaseApp, useValue: mockFirebaseApp },
                { provide: AppWindowService, useValue: mockWindowService }
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

    it('should fetch and activate on initialization', async () => {
        await firstValueFrom(service.getMaintenanceMode());
        expect(getRemoteConfig).toHaveBeenCalledWith(mockFirebaseApp);
        expect(fetchAndActivate).toHaveBeenCalledWith(mockRemoteConfig);
    });

    describe('getMaintenanceMode', () => {
        it('should return value from remote config', async () => {
            (getBoolean as any).mockReturnValue(true);

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: FirebaseApp, useValue: mockFirebaseApp },
                    { provide: AppWindowService, useValue: mockWindowService }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);

            const mode = await firstValueFrom(service.getMaintenanceMode());
            expect(mode).toBe(true);
        });

        it('should return false on fetch error (graceful degradation)', async () => {
            (fetchAndActivate as any).mockRejectedValue(new Error('Network error'));

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: FirebaseApp, useValue: mockFirebaseApp },
                    { provide: AppWindowService, useValue: mockWindowService }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);

            const mode = await firstValueFrom(service.getMaintenanceMode());
            expect(mode).toBe(false);
        });

        it('should bypass maintenance mode with query parameter', async () => {
            mockWindow.location.search = '?bypass_maintenance=true';
            (getBoolean as any).mockReturnValue(true);

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: FirebaseApp, useValue: mockFirebaseApp },
                    { provide: AppWindowService, useValue: mockWindowService }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);

            const mode = await firstValueFrom(service.getMaintenanceMode());
            expect(mode).toBe(false);
        });
    });

    describe('getMaintenanceMessage', () => {
        it('should return message from remote config', async () => {
            const expectedMsg = 'Custom maintenance message';
            (getString as any).mockReturnValue(expectedMsg);

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: FirebaseApp, useValue: mockFirebaseApp },
                    { provide: AppWindowService, useValue: mockWindowService }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);

            const msg = await firstValueFrom(service.getMaintenanceMessage());
            expect(msg).toBe(expectedMsg);
        });
    });
});
