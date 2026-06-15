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
}

describe('UploadRoutesToServiceComponent', () => {
    let component: UploadRoutesToServiceComponent;
    let fixture: ComponentFixture<UploadRoutesToServiceComponent>;
    let httpMock: HttpTestingController;
    let originalBlobStream: typeof Blob.prototype.stream;
    let originalFileReader: typeof FileReader;
    let originalCompressionStream: typeof CompressionStream | undefined;

    const mockSnackBar = { open: vi.fn() };
    const mockDialog = {};
    const mockDialogRef = {};
    const mockProcessingService = { updateJob: vi.fn() };
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

    it('should upload compressed binary for valid gpx file', async () => {
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
            expect.objectContaining({ file: expect.any(String) })
        );

        // Verify base64 string
        const callArgs = mockFunctionsService.call.mock.calls[0];
        const sentData = callArgs[1];
        expect(sentData.file.length).toBeGreaterThan(0);
    });

    it('should reject non-gpx files', async () => {
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
            expect(e).toBe('Unknown file type');
        }
    });
});
