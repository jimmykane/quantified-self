import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UploadRoutesToServiceComponent } from './upload-routes-to-service.component';
import { MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { UPLOAD_STATUS } from '../upload-status/upload.status';
import { Router } from '@angular/router';
import { Auth } from 'app/firebase/auth';
import { LoggerService } from '../../../services/logger.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { AppProcessingService } from '../../../services/app.processing.service';
import { of } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BrowserCompatibilityService } from '../../../services/browser.compatibility.service';
import { AppFunctionsService } from '../../../services/app.functions.service';
import { AppUserService } from '../../../services/app.user.service';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { WahooRouteAccessReconnectDialogComponent } from '../../wahoo-route-access-reconnect-dialog/wahoo-route-access-reconnect-dialog.component';

vi.mock('app/firebase/auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('app/firebase/auth')>()),
    getIdToken: vi.fn().mockResolvedValue('token'),
}));

class MockCompressionStream {
    readable: ReadableStream;
    writable: WritableStream;

    constructor(format: string) {
        this.readable = new ReadableStream({
            start(controller) {
                // Simple mock: just pass through a compressed-like string
                // In reality, testing actual compression in JSDOM is hard without full polyfill.
                // We verify the stream structure is used.
                controller.enqueue(new Uint8Array([31, 139, 8])); // GZIP header parts
                controller.close();
            }
        });
        this.writable = new WritableStream({
            write(chunk) { }
        });
    }
}

class MockFileReader {
    result: string | ArrayBuffer | null = null;
    onload: (() => void) | null = null;

    readAsText(file: File): void {
        const readText = typeof (file as File & { text?: () => Promise<string> }).text === 'function'
            ? (file as File & { text: () => Promise<string> }).text()
            : Promise.resolve('<gpx></gpx>');
        readText.then((text) => {
            this.result = text;
            this.onload?.();
        });
    }

    readAsArrayBuffer(file: File): void {
        const readBuffer = typeof (file as File & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === 'function'
            ? (file as File & { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer()
            : Promise.resolve(Uint8Array.from([1, 2, 3]).buffer);
        readBuffer.then((buffer) => {
            this.result = buffer;
            this.onload?.();
        });
    }
}

describe('UploadRoutesToServiceComponent', () => {
    let component: UploadRoutesToServiceComponent;
    let fixture: ComponentFixture<UploadRoutesToServiceComponent>;
    let httpMock: HttpTestingController;
    let originalBlobStream: typeof Blob.prototype.stream;
    let originalFileReader: typeof FileReader;
    let originalCompressionStream: typeof CompressionStream | undefined;

    const mockSnackBar = { open: vi.fn() };
    const mockDialog = { open: vi.fn(() => ({ afterClosed: () => of(undefined) })) };
    const mockDialogRef = {};
    const mockProcessingService = {
        addJob: vi.fn().mockReturnValue('route-upload-job'),
        updateJob: vi.fn(),
        completeJob: vi.fn(),
        failJob: vi.fn(),
    };
    const mockRouter = {};
    const mockLogger = { error: vi.fn() };
    const mockAnalytics = { logEvent: vi.fn() };
    const mockAuth = { currentUser: { getIdToken: () => Promise.resolve('token') } };
    const mockCompatibility = { checkCompressionSupport: vi.fn().mockReturnValue(true) };
    const mockFunctionsService = { call: vi.fn().mockResolvedValue({ data: { status: 'OK' } }) };

    beforeAll(() => {
        originalBlobStream = Blob.prototype.stream;
        originalFileReader = globalThis.FileReader;
        originalCompressionStream = globalThis.CompressionStream;
        // Mock ReadableStream if missing
        if (typeof ReadableStream === 'undefined') {
            (global as any).ReadableStream = class MockReadableStream {
                constructor(underlyingSource: any) {
                    this.source = underlyingSource;
                }
                source: any;
                // Add pipeThrough if used directly, but here it's used on the result of Blob.stream keys?
                // actually pipeThrough is on the stream instance.
            };
        }

        if (typeof WritableStream === 'undefined') {
            (global as any).WritableStream = class MockWritableStream {
                constructor(underlyingSink: any) {
                }
            };
        }

        Blob.prototype.stream = function () {
            const stream = new (global as any).ReadableStream({
                start(controller: any) {
                    controller.enqueue(new Uint8Array([1, 2, 3]));
                    controller.close();
                }
            });
            stream.pipeThrough = (transform: any) => transform.readable;
            return stream;
        };

        globalThis.CompressionStream = MockCompressionStream as unknown as typeof CompressionStream;
        globalThis.FileReader = MockFileReader as unknown as typeof FileReader;
    });

    afterAll(() => {
        Blob.prototype.stream = originalBlobStream;
        globalThis.FileReader = originalFileReader;
        if (originalCompressionStream) {
            globalThis.CompressionStream = originalCompressionStream;
        } else {
            delete (globalThis as unknown as { CompressionStream?: typeof CompressionStream }).CompressionStream;
        }
    });

    beforeEach(async () => {
        vi.clearAllMocks();
        mockCompatibility.checkCompressionSupport.mockReturnValue(true);
        mockFunctionsService.call.mockResolvedValue({ data: { status: 'OK' } });

        await TestBed.configureTestingModule({
            declarations: [UploadRoutesToServiceComponent],
            imports: [HttpClientTestingModule, NoopAnimationsModule],
            providers: [
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: MatDialog, useValue: mockDialog },
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: MAT_DIALOG_DATA, useValue: {} },
                { provide: AppProcessingService, useValue: mockProcessingService },
                { provide: Router, useValue: mockRouter },
                { provide: LoggerService, useValue: mockLogger },
                { provide: AppAnalyticsService, useValue: mockAnalytics },
                { provide: Auth, useValue: mockAuth },
                { provide: Auth, useValue: mockAuth },
                { provide: BrowserCompatibilityService, useValue: mockCompatibility },
                { provide: AppFunctionsService, useValue: mockFunctionsService },
                { provide: AppUserService, useValue: { hasProAccessSignal: vi.fn().mockReturnValue(true), user: vi.fn().mockReturnValue({ stripeRole: 'pro' }) } },
            ],
            schemas: [NO_ERRORS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(UploadRoutesToServiceComponent);
        component = fixture.componentInstance;
        httpMock = TestBed.inject(HttpTestingController);
        // fixture.detectChanges(); // Disabled to avoid view lifecycle errors in test environment
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('uploads a GPX route to Suunto for server-side delivery', async () => {
        const file = {
            file: new File(['<gpx></gpx>'], 'route.gpx', { type: 'application/gpx+xml' }),
            filename: 'route',
            extension: 'gpx',
            data: null,
            id: '1',
            name: 'route.gpx',
            status: UPLOAD_STATUS.PROCESSING,
            jobId: '1'
        };

        await component.processAndUploadFile(file);

        expect(mockFunctionsService.call).toHaveBeenCalledWith(
            'importRouteToSuuntoApp',
            expect.objectContaining({
                file: expect.any(String),
                filename: 'route.gpx',
            })
        );

        // Verify base64 string
        const callArgs = mockFunctionsService.call.mock.calls[0];
        const sentData = callArgs[1];
        expect(sentData.file.length).toBeGreaterThan(0);
    });

    it('rejects route files other than GPX or FIT', async () => {
        const file = {
            file: new File(['content'], 'test.txt'),
            filename: 'test',
            extension: 'txt',
            data: null,
            id: '1',
            name: 'test.txt',
            status: UPLOAD_STATUS.PROCESSING,
            jobId: '1'
        };
        try {
            await component.processAndUploadFile(file);
            expect.unreachable('Should have rejected');
        } catch (e) {
            expect(e).toMatchObject({ message: 'Only GPX or FIT route files are supported by Suunto.' });
        }
    });

    it('uploads a FIT route to Suunto for server-side GPX conversion', async () => {
        const file = {
            file: Object.assign(new File(['FIT'], 'route.fit', { type: 'application/vnd.fit' }), {
                arrayBuffer: () => Promise.resolve(Uint8Array.from([1, 2, 3]).buffer),
            }),
            filename: 'route',
            extension: 'fit',
            data: null,
            id: '1',
            name: 'route.fit',
            status: UPLOAD_STATUS.PROCESSING,
        };

        await component.processAndUploadFile(file);

        expect(mockFunctionsService.call).toHaveBeenCalledWith('importRouteToSuuntoApp', {
            file: 'AQID',
            filename: 'route.fit',
        });
    });

    it('uploads a GPX route to Garmin for server-side course conversion', async () => {
        component.serviceName = ServiceNames.GarminAPI;
        const file = {
            file: Object.assign(new File(['<gpx></gpx>'], 'route.gpx', { type: 'application/gpx+xml' }), {
                arrayBuffer: () => Promise.resolve(Uint8Array.from([60, 103, 112, 120, 47, 62]).buffer),
            }),
            filename: 'route',
            extension: 'gpx',
            data: null,
            id: '1',
            name: 'route.gpx',
            status: UPLOAD_STATUS.PROCESSING,
        };

        await component.processAndUploadFile(file);

        expect(mockFunctionsService.call).toHaveBeenCalledWith('importRouteToGarminAPI', {
            file: 'PGdweC8+',
            filename: 'route.gpx',
        });
    });

    it('does not route an unsupported provider upload through Suunto', async () => {
        component.serviceName = ServiceNames.COROSAPI;
        const file = {
            file: new File(['<gpx></gpx>'], 'route.gpx', { type: 'application/gpx+xml' }),
            filename: 'route',
            extension: 'gpx',
            data: null,
            id: '1',
            name: 'route.gpx',
            status: UPLOAD_STATUS.PROCESSING,
        };

        await expect(component.processAndUploadFile(file)).rejects.toThrow('Manual route upload is not supported by COROS API.');
        expect(mockFunctionsService.call).not.toHaveBeenCalled();
    });

    it('uploads a FIT route to Wahoo without applying Suunto GPX compression', async () => {
        component.serviceName = ServiceNames.WahooAPI;
        const file = {
            file: Object.assign(new File(['FIT'], 'route.fit', { type: 'application/vnd.fit' }), {
                arrayBuffer: () => Promise.resolve(Uint8Array.from([1, 2, 3]).buffer),
            }),
            filename: 'route',
            extension: 'fit',
            data: null,
            id: '1',
            name: 'route.fit',
            status: UPLOAD_STATUS.PROCESSING,
            jobId: '1',
        };

        await component.processAndUploadFile(file);

        expect(mockFunctionsService.call).toHaveBeenCalledWith('importRouteToWahooAPI', {
            file: 'AQID',
            filename: 'route.fit',
        });
        expect(mockAnalytics.logEvent).toHaveBeenCalledWith('upload_route_to_service', {
            service: ServiceNames.WahooAPI,
        });
    });

    it('uploads a GPX route to Wahoo for server-side FIT conversion', async () => {
      component.serviceName = ServiceNames.WahooAPI;
      const file = {
            file: Object.assign(new File(['<gpx></gpx>'], 'route.gpx', { type: 'application/gpx+xml' }), {
                arrayBuffer: () => Promise.resolve(Uint8Array.from([60, 103, 112, 120, 47, 62]).buffer),
            }),
            filename: 'route',
            extension: 'gpx',
            data: null,
            id: '1',
            name: 'route.gpx',
            status: UPLOAD_STATUS.PROCESSING,
        };

        await component.processAndUploadFile(file);

        expect(mockFunctionsService.call).toHaveBeenCalledWith('importRouteToWahooAPI', {
            file: 'PGdweC8+',
            filename: 'route.gpx',
        });
    });

    it('accepts GPX and FIT routes for Wahoo', () => {
        component.serviceName = ServiceNames.WahooAPI;

        expect(component.fileAccept).toBe('.fit,.gpx');
        expect(component.uploadPrompt).toBe('Open or drag and drop GPX or FIT route files');
    });

    it('shows Wahoo route rejection details to the user', async () => {
        component.serviceName = ServiceNames.WahooAPI;
        mockFunctionsService.call.mockRejectedValueOnce(new Error('Wahoo rejected the route upload: A route already exists.'));
        const file = {
            file: Object.assign(new File(['FIT'], 'route.fit', { type: 'application/vnd.fit' }), {
                arrayBuffer: () => Promise.resolve(Uint8Array.from([1, 2, 3]).buffer),
            }),
            filename: 'route',
            extension: 'fit',
            data: null,
            id: '1',
            name: 'route.fit',
            status: UPLOAD_STATUS.PROCESSING,
        };

        await expect(component.processAndUploadFile(file)).rejects.toThrow('Wahoo rejected the route upload');
        expect(mockSnackBar.open).toHaveBeenCalledWith(
            'Could not upload route.fit, reason: Wahoo rejected the route upload: A route already exists.',
            'OK',
            { duration: 10000 },
        );
    });

    it('opens the Wahoo reconnect dialog instead of a duplicate upload error when route access is missing', async () => {
        component.serviceName = ServiceNames.WahooAPI;
        mockFunctionsService.call.mockRejectedValueOnce(new Error('Reconnect Wahoo and allow route access before sending routes.'));
        const file = Object.assign(new File(['FIT'], 'route.fit', { type: 'application/vnd.fit' }), {
            arrayBuffer: () => Promise.resolve(Uint8Array.from([1, 2, 3]).buffer),
        });

        await component.getFiles({
            stopPropagation: vi.fn(),
            preventDefault: vi.fn(),
            target: {
                files: [file],
                value: 'route.fit',
            },
        });

        expect(mockDialog.open).toHaveBeenCalledWith(WahooRouteAccessReconnectDialogComponent);
        expect(mockSnackBar.open).not.toHaveBeenCalled();
        expect(mockProcessingService.failJob).toHaveBeenCalledWith(
            'route-upload-job',
            'Reconnect Wahoo and allow route access before sending routes.',
        );
    });
});
