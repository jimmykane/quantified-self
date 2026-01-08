import { TestBed } from '@angular/core/testing';
import { AppEventService } from './app.event.service';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import { Auth } from '@angular/fire/auth';
import { AppAnalyticsService } from './app.analytics.service';
import { AppUserService } from './app.user.service';
import { LoggerService } from './logger.service';
import { AppFileService } from './app.file.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { vi, describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { Injector } from '@angular/core';
import { EventWriter } from '../../../functions/src/shared/event-writer';

vi.mock('../../../functions/src/shared/event-writer', () => ({
    EventWriter: vi.fn().mockImplementation(() => ({
        writeAllEventData: vi.fn().mockResolvedValue(true)
    }))
}));

describe('AppEventService', () => {
    let service: AppEventService;
    const mockFirestore = {};
    const mockStorage = { getBucketName: () => 'test-bucket' };
    const mockAuth = {};
    const mockAnalytics = { logEvent: vi.fn() };
    const mockUser = { isPro: vi.fn().mockResolvedValue(true) };
    const mockLogger = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
    const mockFileService = {};
    const mockCompatibility = { checkCompressionSupport: vi.fn().mockReturnValue(true) };

    const originalCompressionStream = globalThis.CompressionStream;
    const originalResponse = globalThis.Response;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                AppEventService,
                { provide: Firestore, useValue: mockFirestore },
                { provide: Storage, useValue: mockStorage },
                { provide: Auth, useValue: mockAuth },
                { provide: AppAnalyticsService, useValue: mockAnalytics },
                { provide: AppUserService, useValue: mockUser },
                { provide: LoggerService, useValue: mockLogger },
                { provide: AppFileService, useValue: mockFileService },
                { provide: BrowserCompatibilityService, useValue: mockCompatibility },
            ]
        });
        service = TestBed.inject(AppEventService);
        vi.clearAllMocks();

        // @ts-ignore
        globalThis.CompressionStream = vi.fn().mockImplementation(() => ({
            writable: {}, readable: {}
        }));
        // @ts-ignore
        globalThis.Response = vi.fn().mockImplementation((data) => ({
            body: {
                pipeThrough: vi.fn().mockReturnValue({}),
            },
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
        }));
    });

    afterEach(() => {
        // @ts-ignore
        globalThis.CompressionStream = originalCompressionStream;
        // @ts-ignore
        globalThis.Response = originalResponse;
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    // We focus on the compression logic in writeAllEventData
    it('should skip compression if browser not supported', async () => {
        mockCompatibility.checkCompressionSupport.mockReturnValue(false);
        const mockEvent = {
            getID: () => '1',
            startDate: new Date(),
            getActivities: () => [],
            setID: vi.fn()
        } as any;
        const originalFiles = [{ extension: 'gpx', data: 'content' }] as any;

        await service.writeAllEventData({ uid: 'user1' } as any, mockEvent, originalFiles);

        expect(globalThis.CompressionStream).not.toHaveBeenCalled();
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Compression skipped'));
    });
});
