import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppDeepLinkService } from './app.deeplink.service';
import { AppWindowService } from './app.window.service';
import { LoggerService } from './logger.service';

describe('AppDeepLinkService', () => {
    let service: AppDeepLinkService;
    let mockWindowService: any;

    beforeEach(() => {
        mockWindowService = {
            windowRef: {
                navigator: { userAgent: '' },
                location: { href: '' },
                open: vi.fn()
            }
        };

        TestBed.configureTestingModule({
            providers: [
                AppDeepLinkService,
                { provide: AppWindowService, useValue: mockWindowService },
                { provide: LoggerService, useValue: { error: vi.fn(), log: vi.fn(), warn: vi.fn() } }
            ]
        });

        service = TestBed.inject(AppDeepLinkService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should use Android intent on Android', () => {
        mockWindowService.windowRef.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 10; SM-G973F) ...';
        service.openGarminConnectApp();
        expect(mockWindowService.windowRef.location.href).toContain('intent://');
        expect(mockWindowService.windowRef.location.href).toContain('package=com.garmin.android.apps.connectmobile');
    });

    it('should use iOS scheme on iOS', () => {
        mockWindowService.windowRef.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) ...';
        service.openGarminConnectApp();
        expect(mockWindowService.windowRef.location.href).toBe('gcm-ciq://');
    });

    it('should use web URL on Desktop and handle allowed popup', () => {
        mockWindowService.windowRef.navigator.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...';
        // Mock successful window open
        mockWindowService.windowRef.open.mockReturnValue({ closed: false });

        service.openGarminConnectApp();

        expect(mockWindowService.windowRef.open).toHaveBeenCalledWith(expect.stringContaining('connect.garmin.com/app/settings/accountInformation'), '_blank');
        // Should NOT fallback
        expect(mockWindowService.windowRef.location.href).toBe('');
    });

    it('should fallback to current window if popup blocked on Desktop', () => {
        mockWindowService.windowRef.navigator.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...';
        // Mock blocked popup (returns null)
        mockWindowService.windowRef.open.mockReturnValue(null);

        service.openGarminConnectApp();

        expect(mockWindowService.windowRef.open).toHaveBeenCalledWith(expect.stringContaining('connect.garmin.com/app/settings/accountInformation'), '_blank');
        // Should fallback
        expect(mockWindowService.windowRef.location.href).toContain('connect.garmin.com');
    });
});
