import { TestBed } from '@angular/core/testing';
import { AppEventService } from './app.event.service';
import { AppAuthService } from '../authentication/app.auth.service';
import { AppUserService } from './app.user.service';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import { DomSanitizer } from '@angular/platform-browser';
import { LoggerService } from './logger.service';
import { of } from 'rxjs';
import { AppEventInterface } from '../../../functions/src/shared/app-event.interface';
import { User } from '@sports-alliance/sports-lib';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppEventUtilities } from '../utils/app.event.utilities';
import { AppFileService } from './app.file.service';

// Mocks
const mockFirestore = {
    firestore: {}
} as any;
const mockStorage = {
    storage: {}
} as any;
const mockAuthService = {
    user$: of(null)
} as any;
const mockUserService = {
    getSubscriptionRole: vi.fn().mockResolvedValue('pro'),
    isPro: vi.fn().mockResolvedValue(true)
} as any;
const mockLogger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    captureMessage: vi.fn()
} as any;
const mockSanitizer = {
    bypassSecurityTrustUrl: vi.fn()
} as any;

describe('AppEventService', () => {
    let service: AppEventService;
    let mockEvent: AppEventInterface;
    let mockUser: User;
    let fileService: AppFileService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                AppEventService,
                { provide: Firestore, useValue: mockFirestore },
                { provide: Storage, useValue: mockStorage },
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: LoggerService, useValue: mockLogger },
                { provide: DomSanitizer, useValue: mockSanitizer },
                AppFileService,
            ]
        });
        service = TestBed.inject(AppEventService);
        fileService = TestBed.inject(AppFileService);
        mockUser = new User('test_uid');

        // Mock event setup
        mockEvent = {
            getID: () => 'event_1',
            getActivities: () => [],
            setID: (_) => { },
            addActivities: (_) => { },
            clearActivities: () => { },
            toJSON: () => ({}),
            startDate: new Date(),
            originalFiles: [
                { path: 'test/path.json', startDate: new Date(), extension: 'json', data: 'mock_data' }
            ]
        } as unknown as AppEventInterface;
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('attachStreamsToEventWithActivities', () => {
        it('should pass skipEnrichment=true to orchestration', async () => {
            const orchestrationSpy = vi.spyOn(service as any, 'calculateStreamsFromWithOrchestration')
                .mockResolvedValue(mockEvent);

            await service.attachStreamsToEventWithActivities(
                mockUser,
                mockEvent,
                undefined,
                true, // merge
                true  // skipEnrichment
            ).toPromise();

            expect(orchestrationSpy).toHaveBeenCalledWith(mockEvent, true);
        });
    });

    describe('Compression and Decompression', () => {
        const originalCompressionStream = global.CompressionStream;
        const originalDecompressionStream = global.DecompressionStream;
        const originalResponse = global.Response;

        beforeEach(() => {
            // Mock native APIs
            (global as any).CompressionStream = vi.fn().mockImplementation(() => ({
                writable: {}, readable: {}
            }));
            (global as any).DecompressionStream = vi.fn().mockImplementation(() => ({
                writable: {}, readable: {}
            }));
            (global as any).Response = vi.fn().mockImplementation((data) => ({
                body: {
                    pipeThrough: vi.fn().mockReturnValue({}),
                },
                arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
            }));
        });

        afterEach(() => {
            global.CompressionStream = originalCompressionStream;
            global.DecompressionStream = originalDecompressionStream;
            global.Response = originalResponse;
        });

        it('should correctly handle .gz extension and avoid double compression in writeAllEventData', async () => {
            const dummyEvent = {
                getID: () => 'event123',
                getActivities: () => [],
                toJSON: () => ({ id: 'event123' }),
                startDate: new Date(),
            } as any;

            // Gzip magic bytes: 0x1F, 0x8B
            const compressedData = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer;

            const originalFiles = [
                { data: compressedData, extension: 'json.gz', startDate: new Date() },
                { data: '{"a":1}', extension: 'json', startDate: new Date() }
            ];

            // Mock EventWriter
            vi.mock('../../../functions/src/shared/event-writer', () => ({
                EventWriter: vi.fn().mockImplementation(() => ({
                    writeAllEventData: vi.fn().mockResolvedValue(undefined)
                })),
                consoleLogAdapter: {}
            }));

            await service.writeAllEventData({ uid: 'user1' } as any, dummyEvent, originalFiles);

            // First file should NOT have been re-compressed (it was already gzipped)
            // Second file SHOULD have been compressed
            // Both should have .json.gz extension
            expect(originalFiles[0].extension).toBe('json.gz');
            expect(originalFiles[1].extension).toBe('json.gz');

            // Check if first file data is still the same compressed data (not double compressed)
            expect(new Uint8Array(originalFiles[0].data as ArrayBuffer)[0]).toBe(0x1F);
            expect(new Uint8Array(originalFiles[0].data as ArrayBuffer)[1]).toBe(0x8B);

            // CompressionStream should only have been called once (for the second file)
            expect(global.CompressionStream).toHaveBeenCalledTimes(1);
        });

        it('should decompress gzipped files during download via AppFileService', async () => {
            const gzippedData = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]);
            const buffer = gzippedData.buffer;

            const result = await fileService.decompressIfNeeded(buffer, 'test.json.gz');

            expect(global.DecompressionStream).toHaveBeenCalledWith('gzip');
            expect(result).toBeInstanceOf(ArrayBuffer);
        });

        it('should NOT decompress FIT files even if they have gzip-like bytes', async () => {
            const gzippedData = new Uint8Array([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]);
            const buffer = gzippedData.buffer;
            const result = await fileService.decompressIfNeeded(buffer, 'test.fit');
            expect(global.DecompressionStream).not.toHaveBeenCalled();
            expect(result).toBe(buffer);
        });

        it('should correctly extract base extension for gzipped files', () => {
            expect(fileService.getExtensionFromPath('users/1/events/2/original.json.gz')).toBe('json');
            expect(fileService.getExtensionFromPath('users/1/events/2/original.gpx.gz')).toBe('gpx');
            expect(fileService.getExtensionFromPath('users/1/events/2/original.fit')).toBe('fit');
            expect(fileService.getExtensionFromPath('users/1/events/2/original.gz')).toBe('gz');
        });
    });
});
