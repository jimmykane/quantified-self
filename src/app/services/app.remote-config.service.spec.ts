import { TestBed } from '@angular/core/testing';
import { AppRemoteConfigService } from './app.remote-config.service';
import { AppWindowService } from './app.window.service';
import { AppUserService } from './app.user.service';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';

describe('AppRemoteConfigService', () => {
    let service: AppRemoteConfigService;
    let mockWindowService: any;
    let mockUserService: any;
    let mockWindow: any;

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

        // Mock fetch
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                entries: {
                    maintenance_mode: 'false',
                    maintenance_message: 'Test message'
                },
                state: 'UPDATE'
            })
        });

        // Mock localStorage
        const localStorageMock = {
            getItem: vi.fn().mockReturnValue('test-instance-id'),
            setItem: vi.fn()
        };
        Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

        // Mock crypto.randomUUID
        Object.defineProperty(global, 'crypto', {
            value: { randomUUID: () => 'test-uuid' },
            writable: true
        });

        TestBed.configureTestingModule({
            providers: [
                AppRemoteConfigService,
                { provide: AppWindowService, useValue: mockWindowService },
                { provide: AppUserService, useValue: mockUserService }
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

    it('should fetch config via REST API', async () => {
        await firstValueFrom(service.getMaintenanceMode());
        expect(global.fetch).toHaveBeenCalled();
    });

    describe('getMaintenanceMode', () => {
        it('should return true when maintenance_mode is "true" for non-admin', async () => {
            (global.fetch as any).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    entries: {
                        maintenance_mode: 'true',
                        maintenance_message: 'Maintenance in progress'
                    }
                })
            });

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);

            const mode = await firstValueFrom(service.getMaintenanceMode());
            expect(mode).toBe(true);
        });

        it('should return false for admin users even when maintenance is true', async () => {
            mockUserService.isAdmin.mockResolvedValue(true);
            (global.fetch as any).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    entries: {
                        maintenance_mode: 'true',
                        maintenance_message: 'Maintenance in progress'
                    }
                })
            });

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);

            const mode = await firstValueFrom(service.getMaintenanceMode());
            expect(mode).toBe(false);
        });

        it('should return false on fetch error (graceful degradation)', async () => {
            (global.fetch as any).mockRejectedValue(new Error('Network error'));

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);

            const mode = await firstValueFrom(service.getMaintenanceMode());
            expect(mode).toBe(false);
        });

        it('should bypass maintenance mode with query parameter', async () => {
            mockWindow.location.search = '?bypass_maintenance=true';
            (global.fetch as any).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    entries: {
                        maintenance_mode: 'true'
                    }
                })
            });

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService }
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
            (global.fetch as any).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    entries: {
                        maintenance_mode: 'false',
                        maintenance_message: expectedMsg
                    }
                })
            });

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    AppRemoteConfigService,
                    { provide: AppWindowService, useValue: mockWindowService },
                    { provide: AppUserService, useValue: mockUserService }
                ]
            });
            service = TestBed.inject(AppRemoteConfigService);

            const msg = await firstValueFrom(service.getMaintenanceMessage());
            expect(msg).toBe(expectedMsg);
        });
    });
});
