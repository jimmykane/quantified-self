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
    let localStorageState: Record<string, string>;

    beforeEach(() => {
        versionUpdatesSubject = new Subject<VersionReadyEvent>();
        unrecoverableSubject = new Subject<any>();

        mockWindow = {
            location: {
                reload: vi.fn()
            },
            localStorage: {
                getItem: vi.fn((key: string) => localStorageState[key] ?? null),
                setItem: vi.fn((key: string, value: string) => {
                    localStorageState[key] = value;
                })
            },
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
        localStorageState = {};

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
        versionUpdatesSubject.next({
            type: 'VERSION_READY',
            currentVersion: { hash: 'v1-current', appData: {} },
            latestVersion: { hash: 'v1-latest', appData: {} }
        } as VersionReadyEvent);

        expect(snackBarMock.open).toHaveBeenCalledWith(
            'There is a new version available',
            'Reload',
            { duration: 0 }
        );
    });

    it('should activate update and reload when snackbar action is clicked', async () => {
        // Emit version ready event
        versionUpdatesSubject.next({
            type: 'VERSION_READY',
            currentVersion: { hash: 'v1-current', appData: {} },
            latestVersion: { hash: 'v1-latest', appData: {} }
        } as VersionReadyEvent);

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

    it('should not show snackbar more than once for the same version hash', () => {
        const event = {
            type: 'VERSION_READY',
            currentVersion: { hash: 'v1-current', appData: {} },
            latestVersion: { hash: 'v1-latest', appData: {} }
        } as VersionReadyEvent;

        versionUpdatesSubject.next(event);
        versionUpdatesSubject.next(event);

        expect(snackBarMock.open).toHaveBeenCalledTimes(1);
    });

    it('should show snackbar for a different version hash', () => {
        versionUpdatesSubject.next({
            type: 'VERSION_READY',
            currentVersion: { hash: 'v1-current', appData: {} },
            latestVersion: { hash: 'v1-latest', appData: {} }
        } as VersionReadyEvent);

        versionUpdatesSubject.next({
            type: 'VERSION_READY',
            currentVersion: { hash: 'v1-latest', appData: {} },
            latestVersion: { hash: 'v2-latest', appData: {} }
        } as VersionReadyEvent);

        expect(snackBarMock.open).toHaveBeenCalledTimes(2);
    });

    it('should not show snackbar when version hash was already stored', () => {
        localStorageState['app.update.seen-version-hashes'] = JSON.stringify(['v1-latest']);

        versionUpdatesSubject.next({
            type: 'VERSION_READY',
            currentVersion: { hash: 'v1-current', appData: {} },
            latestVersion: { hash: 'v1-latest', appData: {} }
        } as VersionReadyEvent);

        expect(snackBarMock.open).not.toHaveBeenCalled();
    });
});
