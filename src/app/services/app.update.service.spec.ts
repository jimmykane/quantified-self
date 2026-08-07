import { TestBed } from '@angular/core/testing';
import { ApplicationRef } from '@angular/core';
import { AppUpdateService } from './app.update.service';
import { SwUpdate, VersionEvent, VersionReadyEvent } from '@angular/service-worker';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject } from 'rxjs';
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { LoggerService } from './logger.service';
import { AppWindowService } from './app.window.service';

describe('AppUpdateService', () => {
    let service: AppUpdateService;
    let swUpdateMock: any;
    let snackBarMock: any;
    let loggerMock: any;
    let windowServiceMock: any;
    let versionUpdatesSubject: Subject<VersionEvent>;
    let unrecoverableSubject: Subject<any>;
    let mockWindow: any;
    let localStorageState: Record<string, string>;
    let windowEventListeners: Map<string, () => void>;
    let documentEventListeners: Map<string, () => void>;

    beforeEach(() => {
        versionUpdatesSubject = new Subject<VersionEvent>();
        unrecoverableSubject = new Subject<any>();
        windowEventListeners = new Map();
        documentEventListeners = new Map();

        mockWindow = {
            location: {
                reload: vi.fn()
            },
            addEventListener: vi.fn((eventName: string, handler: () => void) => {
                windowEventListeners.set(eventName, handler);
            }),
            document: {
                visibilityState: 'visible',
                addEventListener: vi.fn((eventName: string, handler: () => void) => {
                    documentEventListeners.set(eventName, handler);
                }),
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
            checkForUpdate: vi.fn().mockResolvedValue(true),
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

    afterEach(() => {
        vi.useRealTimers();
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

    it('checks for updates when connectivity returns or the tab becomes visible', async () => {
        const onlineHandler = windowEventListeners.get('online');
        const visibilityChangeHandler = documentEventListeners.get('visibilitychange');
        expect(onlineHandler).toBeDefined();
        expect(visibilityChangeHandler).toBeDefined();

        await Promise.resolve();
        await Promise.resolve();
        swUpdateMock.checkForUpdate.mockClear();

        onlineHandler?.();
        await Promise.resolve();
        expect(swUpdateMock.checkForUpdate).toHaveBeenCalledTimes(1);

        visibilityChangeHandler?.();
        await Promise.resolve();
        expect(swUpdateMock.checkForUpdate).toHaveBeenCalledTimes(2);
    });

    it('retries a check shortly after no update is returned', async () => {
        vi.useFakeTimers();
        const retryUpdatesMock = {
            ...swUpdateMock,
            checkForUpdate: vi.fn().mockResolvedValue(false),
        };

        new AppUpdateService(
            { isStable: of(true) } as ApplicationRef,
            retryUpdatesMock,
            snackBarMock,
            loggerMock,
            windowServiceMock,
        );

        await Promise.resolve();
        await Promise.resolve();
        expect(retryUpdatesMock.checkForUpdate).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(retryUpdatesMock.checkForUpdate).toHaveBeenCalledTimes(2);
    });

    it('logs update installation failures and schedules a recovery check', async () => {
        vi.useFakeTimers();
        await Promise.resolve();
        await Promise.resolve();
        swUpdateMock.checkForUpdate.mockClear();

        versionUpdatesSubject.next({
            type: 'VERSION_INSTALLATION_FAILED',
            version: { hash: 'failed-version', appData: {} },
            error: 'Gateway Timeout',
        });

        expect(loggerMock.error).toHaveBeenCalledWith(
            '[AppUpdateService] Failed to install app update',
            {
                error: 'Gateway Timeout',
                versionHash: 'failed-version',
            },
        );

        await vi.advanceTimersByTimeAsync(30_000);
        expect(swUpdateMock.checkForUpdate).toHaveBeenCalledTimes(1);
    });

    it('should not show snackbar more than once for the same version hash in one app runtime', () => {
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

    it('should not suppress an update because another tab stored its version hash', () => {
        localStorageState['app.update.seen-version-hashes'] = JSON.stringify(['v1-latest']);

        versionUpdatesSubject.next({
            type: 'VERSION_READY',
            currentVersion: { hash: 'v1-current', appData: {} },
            latestVersion: { hash: 'v1-latest', appData: {} }
        } as VersionReadyEvent);

        expect(snackBarMock.open).toHaveBeenCalledTimes(1);
        expect(mockWindow.localStorage.getItem).not.toHaveBeenCalled();
        expect(mockWindow.localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should allow the same version to be offered again after activation fails', async () => {
        const activationError = new Error('Activation failed');
        const event = {
            type: 'VERSION_READY',
            currentVersion: { hash: 'v1-current', appData: {} },
            latestVersion: { hash: 'v1-latest', appData: {} }
        } as VersionReadyEvent;
        swUpdateMock.activateUpdate.mockRejectedValueOnce(activationError);

        versionUpdatesSubject.next(event);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(loggerMock.error).toHaveBeenCalledWith(
            '[AppUpdateService] Failed to activate update',
            activationError
        );
        expect(mockWindow.location.reload).not.toHaveBeenCalled();

        versionUpdatesSubject.next(event);

        expect(snackBarMock.open).toHaveBeenCalledTimes(2);
    });
});
