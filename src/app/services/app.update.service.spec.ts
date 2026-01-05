import { TestBed } from '@angular/core/testing';
import { AppUpdateService } from './app.update.service';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject } from 'rxjs';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { LoggerService } from './logger.service';
import { AppWindowService } from './app.window.service';

describe('AppUpdateService', () => {
    let service: AppUpdateService;
    let swUpdateMock: any;
    let snackBarMock: any;
    let loggerMock: any;
    let windowServiceMock: any;
    let versionUpdatesSubject: Subject<VersionReadyEvent>;
    let unrecoverableSubject: Subject<any>;
    let mockWindow: any;

    beforeEach(() => {
        versionUpdatesSubject = new Subject<VersionReadyEvent>();
        unrecoverableSubject = new Subject<any>();

        mockWindow = {
            location: {
                reload: vi.fn()
            }
        };

        windowServiceMock = {
            windowRef: mockWindow
        };

        swUpdateMock = {
            isEnabled: true,
            checkForUpdate: vi.fn(),
            versionUpdates: versionUpdatesSubject.asObservable(),
            unrecoverable: unrecoverableSubject.asObservable(),
            activateUpdate: vi.fn().mockResolvedValue(undefined)
        };
        snackBarMock = {
            open: vi.fn().mockReturnValue({
                onAction: () => of({})
            })
        };
        loggerMock = {
            error: vi.fn(),
            log: vi.fn(),
            info: vi.fn(),
            warn: vi.fn()
        };

        TestBed.configureTestingModule({
            providers: [
                AppUpdateService,
                { provide: SwUpdate, useValue: swUpdateMock },
                { provide: MatSnackBar, useValue: snackBarMock },
                { provide: LoggerService, useValue: loggerMock },
                { provide: AppWindowService, useValue: windowServiceMock }
            ]
        });
        service = TestBed.inject(AppUpdateService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should show snackbar when version is ready', () => {
        versionUpdatesSubject.next({ type: 'VERSION_READY' } as VersionReadyEvent);

        expect(snackBarMock.open).toHaveBeenCalledWith(
            'There is a new version available',
            'Reload',
            { duration: 0 }
        );
    });

    it('should activate update and reload when snackbar action is clicked', async () => {
        // Emit version ready event
        versionUpdatesSubject.next({ type: 'VERSION_READY' } as VersionReadyEvent);

        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(swUpdateMock.activateUpdate).toHaveBeenCalled();
        expect(mockWindow.location.reload).toHaveBeenCalled();
    });

    it('should log error and reload on unrecoverable state', () => {
        const errorEvent = { reason: 'Broken state' };
        unrecoverableSubject.next(errorEvent);

        expect(loggerMock.error).toHaveBeenCalled();
        expect(mockWindow.location.reload).toHaveBeenCalled();
    });
});
