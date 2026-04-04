import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Storage } from 'app/firebase/storage';
import { AppOriginalFileHydrationService } from './app.original-file-hydration.service';
import { AppFileService } from './app.file.service';
import { LoggerService } from './logger.service';
import { AppEventUtilities } from '../utils/app.event.utilities';
import { AppCacheService } from './app.cache.service';
import {
  EventImporterFIT,
  EventImporterGPX,
  EventImporterSuuntoJSON,
  EventImporterSuuntoSML,
  EventImporterTCX,
  EventUtilities
} from '@sports-alliance/sports-lib';

const storageMocks = vi.hoisted(() => ({
  ref: vi.fn(),
  getMetadata: vi.fn(),
  getBytes: vi.fn(),
}));

vi.mock('app/firebase/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/firebase/storage')>();
  return {
    ...actual,
    ref: storageMocks.ref,
    getMetadata: storageMocks.getMetadata,
    getBytes: storageMocks.getBytes,
  };
});

describe('AppOriginalFileHydrationService', () => {
  let service: AppOriginalFileHydrationService;
  let fileServiceMock: any;
  let eventUtilitiesMock: any;
  let cacheServiceMock: any;
  let loggerMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    fileServiceMock = {
      decompressIfNeeded: vi.fn(async (buffer: ArrayBuffer) => buffer),
    };
    eventUtilitiesMock = {
      enrich: vi.fn(),
    };
    cacheServiceMock = {
      getFile: vi.fn(),
      setFile: vi.fn(),
    };
    loggerMock = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    storageMocks.ref.mockReturnValue({});
    storageMocks.getMetadata.mockResolvedValue({ generation: 'gen-1' });
    storageMocks.getBytes.mockResolvedValue(new ArrayBuffer(8));

    TestBed.configureTestingModule({
      providers: [
        AppOriginalFileHydrationService,
        { provide: Storage, useValue: {} },
        { provide: AppFileService, useValue: fileServiceMock },
        { provide: LoggerService, useValue: loggerMock },
        { provide: AppEventUtilities, useValue: eventUtilitiesMock },
        { provide: AppCacheService, useValue: cacheServiceMock }
      ]
    });

    service = TestBed.inject(AppOriginalFileHydrationService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should parse single-file events successfully', async () => {
    const event = {
      originalFile: { path: 'users/u/events/e/original.fit' },
      getActivities: () => [],
    } as any;
    const parsedEvent = {
      getActivities: () => [],
    } as any;
    vi.spyOn(service as any, 'fetchAndParseOneFile').mockResolvedValue({ event: parsedEvent });

    const result = await service.parseEventFromOriginalFiles(event, {
      preserveActivityIdsFromEvent: false,
    });

    expect(result.finalEvent).toBe(parsedEvent);
    expect(result.parsedEvents).toEqual([parsedEvent]);
    expect(result.failedFiles).toEqual([]);
    expect(result.sourceFilesCount).toBe(1);
  });

  it('should preserve activity IDs and creator overrides by default', async () => {
    const parsedActivity = {
      setID: vi.fn(),
      creator: { name: 'Parser name' },
    };
    const existingActivity = {
      getID: () => 'existing-activity-id',
      creator: { name: 'User renamed device' },
    };
    const event = {
      originalFile: { path: 'users/u/events/e/original.fit' },
      getActivities: () => [existingActivity],
    } as any;
    const parsedEvent = {
      getActivities: () => [parsedActivity],
    } as any;
    vi.spyOn(service as any, 'fetchAndParseOneFile').mockResolvedValue({ event: parsedEvent });

    await service.parseEventFromOriginalFiles(event);

    expect(parsedActivity.setID).toHaveBeenCalledWith('existing-activity-id');
    expect(parsedActivity.creator.name).toBe('User renamed device');
  });

  it('should preserve identity by deterministic signatures when parsed activity order changes', async () => {
    const firstStart = new Date('2026-01-01T10:00:00.000Z');
    const secondStart = new Date('2026-01-01T12:30:00.000Z');
    const firstEnd = new Date('2026-01-01T11:00:00.000Z');
    const secondEnd = new Date('2026-01-01T13:00:00.000Z');

    const existingFirst = {
      getID: () => 'existing-a',
      startDate: firstStart,
      endDate: firstEnd,
      type: 'Run',
      creator: { name: 'Renamed Device A' },
      getStat: vi.fn().mockReturnValue(null),
    };
    const existingSecond = {
      getID: () => 'existing-b',
      startDate: secondStart,
      endDate: secondEnd,
      type: 'Ride',
      creator: { name: 'Renamed Device B' },
      getStat: vi.fn().mockReturnValue(null),
    };

    const parsedSecond = {
      getID: () => '',
      setID: vi.fn(),
      startDate: secondStart,
      endDate: secondEnd,
      type: 'Ride',
      creator: { name: 'Parser Device B' },
      getStat: vi.fn().mockReturnValue(null),
    };
    const parsedFirst = {
      getID: () => '',
      setID: vi.fn(),
      startDate: firstStart,
      endDate: firstEnd,
      type: 'Run',
      creator: { name: 'Parser Device A' },
      getStat: vi.fn().mockReturnValue(null),
    };

    const event = {
      getID: () => 'event-identity',
      originalFile: { path: 'users/u/events/e/original.fit' },
      getActivities: () => [existingFirst, existingSecond],
    } as any;
    const parsedEvent = {
      getActivities: () => [parsedSecond, parsedFirst],
    } as any;
    vi.spyOn(service as any, 'fetchAndParseOneFile').mockResolvedValue({ event: parsedEvent });

    await service.parseEventFromOriginalFiles(event);

    expect(parsedSecond.setID).toHaveBeenCalledWith('existing-b');
    expect(parsedFirst.setID).toHaveBeenCalledWith('existing-a');
    expect(parsedSecond.creator.name).toBe('Renamed Device B');
    expect(parsedFirst.creator.name).toBe('Renamed Device A');
  });

  it('should prefer sourceActivityKey matching before parsed activity ID matching', async () => {
    const firstStart = new Date('2026-01-01T10:00:00.000Z');
    const secondStart = new Date('2026-01-01T12:30:00.000Z');
    const keyA = `${'a'.repeat(64)}:fingerprint-a:0`;
    const keyB = `${'b'.repeat(64)}:fingerprint-b:0`;

    const existingFirst = {
      getID: () => 'existing-a',
      sourceActivityKey: keyA,
      startDate: firstStart,
      type: 'Run',
      creator: { name: 'Renamed Device A' },
      getStat: vi.fn().mockReturnValue(null),
    };
    const existingSecond = {
      getID: () => 'existing-b',
      sourceActivityKey: keyB,
      startDate: secondStart,
      type: 'Ride',
      creator: { name: 'Renamed Device B' },
      getStat: vi.fn().mockReturnValue(null),
    };

    // IDs intentionally conflict with keys:
    // if ID matching runs first this would swap identities.
    const parsedFirst = {
      getID: () => 'existing-a',
      setID: vi.fn(),
      sourceActivityKey: keyB,
      startDate: secondStart,
      type: 'Ride',
      creator: { name: 'Parser Device B' },
      getStat: vi.fn().mockReturnValue(null),
    };
    const parsedSecond = {
      getID: () => 'existing-b',
      setID: vi.fn(),
      sourceActivityKey: keyA,
      startDate: firstStart,
      type: 'Run',
      creator: { name: 'Parser Device A' },
      getStat: vi.fn().mockReturnValue(null),
    };

    const event = {
      getID: () => 'event-key-first',
      originalFile: { path: 'users/u/events/e/original.fit' },
      getActivities: () => [existingFirst, existingSecond],
    } as any;
    const parsedEvent = {
      getActivities: () => [parsedFirst, parsedSecond],
    } as any;
    vi.spyOn(service as any, 'fetchAndParseOneFile').mockResolvedValue({ event: parsedEvent });

    await service.parseEventFromOriginalFiles(event);

    expect(parsedFirst.setID).toHaveBeenCalledWith('existing-b');
    expect(parsedSecond.setID).toHaveBeenCalledWith('existing-a');
    expect(parsedFirst.creator.name).toBe('Renamed Device B');
    expect(parsedSecond.creator.name).toBe('Renamed Device A');
  });

  it('should copy sourceActivityKey from existing activity when signature matching resolves identity', async () => {
    const firstStart = new Date('2026-01-01T10:00:00.000Z');
    const firstEnd = new Date('2026-01-01T10:30:00.000Z');
    const existingKey = `${'c'.repeat(64)}:fingerprint-c:0`;
    const existingActivity = {
      getID: () => 'existing-c',
      sourceActivityKey: existingKey,
      startDate: firstStart,
      endDate: firstEnd,
      type: 'Run',
      creator: { name: 'Renamed Device C' },
      getStat: vi.fn().mockReturnValue(null),
    };
    const parsedActivity = {
      getID: () => '',
      setID: vi.fn(),
      startDate: firstStart,
      endDate: firstEnd,
      type: 'Run',
      creator: { name: 'Parser Device C' },
      getStat: vi.fn().mockReturnValue(null),
    } as any;

    const event = {
      getID: () => 'event-copy-key',
      originalFile: { path: 'users/u/events/e/original.fit' },
      getActivities: () => [existingActivity],
    } as any;
    const parsedEvent = {
      getActivities: () => [parsedActivity],
    } as any;
    vi.spyOn(service as any, 'fetchAndParseOneFile').mockResolvedValue({ event: parsedEvent });

    await service.parseEventFromOriginalFiles(event);

    expect(parsedActivity.setID).toHaveBeenCalledWith('existing-c');
    expect(parsedActivity.sourceActivityKey).toBe(existingKey);
  });

  it('should avoid identity reassignment when multiple candidates are ambiguous', async () => {
    const sharedStart = new Date('2026-01-01T10:00:00.000Z');

    const existingA = {
      getID: () => 'existing-a',
      startDate: sharedStart,
      type: 'Run',
      creator: { name: 'Renamed Device A' },
      getStat: vi.fn().mockReturnValue(null),
    };
    const existingB = {
      getID: () => 'existing-b',
      startDate: sharedStart,
      type: 'Run',
      creator: { name: 'Renamed Device B' },
      getStat: vi.fn().mockReturnValue(null),
    };

    const parsedA = {
      getID: () => '',
      setID: vi.fn(),
      startDate: sharedStart,
      type: 'Run',
      creator: { name: 'Parser Device A' },
      getStat: vi.fn().mockReturnValue(null),
    };
    const parsedB = {
      getID: () => '',
      setID: vi.fn(),
      startDate: sharedStart,
      type: 'Run',
      creator: { name: 'Parser Device B' },
      getStat: vi.fn().mockReturnValue(null),
    };

    const event = {
      getID: () => 'event-ambiguous',
      originalFile: { path: 'users/u/events/e/original.fit' },
      getActivities: () => [existingA, existingB],
    } as any;
    const parsedEvent = {
      getActivities: () => [parsedA, parsedB],
    } as any;
    vi.spyOn(service as any, 'fetchAndParseOneFile').mockResolvedValue({ event: parsedEvent });

    await service.parseEventFromOriginalFiles(event);

    expect(parsedA.setID).not.toHaveBeenCalled();
    expect(parsedB.setID).not.toHaveBeenCalled();
    expect(parsedA.creator.name).toBe('Parser Device A');
    expect(parsedB.creator.name).toBe('Parser Device B');
    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[AppOriginalFileHydrationService] Could not deterministically map all parsed activities to existing identities',
      expect.objectContaining({
        eventID: 'event-ambiguous',
        parsedCount: 2,
        existingCount: 2,
        assignedCount: 0,
      }),
    );
  });

  it('should parse multi-file events and merge parsed results', async () => {
    const event = {
      originalFiles: [
        { path: 'users/u/events/e/original_0.fit' },
        { path: 'users/u/events/e/original_1.fit' },
      ],
      getActivities: () => [],
    } as any;
    const parsedEvent1 = { getActivities: () => [] } as any;
    const parsedEvent2 = { getActivities: () => [] } as any;
    const mergedEvent = { getActivities: () => [] } as any;
    vi.spyOn(service as any, 'fetchAndParseOneFile')
      .mockResolvedValueOnce({ event: parsedEvent1 })
      .mockResolvedValueOnce({ event: parsedEvent2 });
    vi.spyOn(EventUtilities, 'mergeEvents').mockReturnValue(mergedEvent as any);

    const result = await service.parseEventFromOriginalFiles(event, {
      preserveActivityIdsFromEvent: false,
    });

    expect(EventUtilities.mergeEvents).toHaveBeenCalledWith([parsedEvent1, parsedEvent2]);
    expect(result.finalEvent).toBe(mergedEvent);
    expect(result.sourceFilesCount).toBe(2);
    expect(result.failedFiles).toEqual([]);
  });

  it('should not merge when mergeMultipleFiles is disabled', async () => {
    const event = {
      originalFiles: [
        { path: 'users/u/events/e/original_0.fit' },
        { path: 'users/u/events/e/original_1.fit' },
      ],
      getActivities: () => [],
    } as any;
    const parsedEvent1 = { getActivities: () => [] } as any;
    const parsedEvent2 = { getActivities: () => [] } as any;
    vi.spyOn(service as any, 'fetchAndParseOneFile')
      .mockResolvedValueOnce({ event: parsedEvent1 })
      .mockResolvedValueOnce({ event: parsedEvent2 });
    const mergeSpy = vi.spyOn(EventUtilities, 'mergeEvents');

    const result = await service.parseEventFromOriginalFiles(event, {
      preserveActivityIdsFromEvent: false,
      mergeMultipleFiles: false,
    });

    expect(mergeSpy).not.toHaveBeenCalled();
    expect(result.finalEvent).toBe(parsedEvent1);
  });

  it('should fail strict parsing when one source file fails', async () => {
    const event = {
      originalFiles: [
        { path: 'users/u/events/e/original_0.fit' },
        { path: 'users/u/events/e/original_1.fit' },
      ],
      getActivities: () => [],
    } as any;
    const parsedEvent = { getActivities: () => [] } as any;
    vi.spyOn(service as any, 'fetchAndParseOneFile')
      .mockResolvedValueOnce({ event: parsedEvent })
      .mockResolvedValueOnce({ event: null, reason: 'Parse error' });

    const result = await service.parseEventFromOriginalFiles(event, {
      strictAllFilesRequired: true,
      preserveActivityIdsFromEvent: false,
    });

    expect(result.finalEvent).toBeNull();
    expect(result.parsedEvents).toEqual([parsedEvent]);
    expect(result.failedFiles).toEqual([
      { path: 'users/u/events/e/original_1.fit', reason: 'Parse error' },
    ]);
  });

  it('should return empty finalEvent when all source files fail in non-strict mode', async () => {
    const event = {
      originalFiles: [
        { path: 'users/u/events/e/original_0.fit' },
        { path: 'users/u/events/e/original_1.fit' },
      ],
      getActivities: () => [],
    } as any;
    vi.spyOn(service as any, 'fetchAndParseOneFile')
      .mockResolvedValueOnce({ event: null, reason: 'first failed' })
      .mockResolvedValueOnce({ event: null, reason: 'second failed' });

    const result = await service.parseEventFromOriginalFiles(event, {
      strictAllFilesRequired: false,
      preserveActivityIdsFromEvent: false,
    });

    expect(result.finalEvent).toBeNull();
    expect(result.parsedEvents).toEqual([]);
    expect(result.failedFiles).toHaveLength(2);
  });

  it('should normalize .gz extension paths correctly', () => {
    const extension = (service as any).getNormalizedExtensionFromPath('users/u/events/e/original.fit.gz');
    expect(extension).toBe('fit');
  });

  it('should return empty extension when none exists', () => {
    const extension = (service as any).getNormalizedExtensionFromPath('users/u/events/e/original');
    expect(extension).toBe('users/u/events/e/original');
  });

  it('should return source file from legacy originalFile metadata', async () => {
    const parsedEvent = { getActivities: () => [] } as any;
    vi.spyOn(service as any, 'fetchAndParseOneFile').mockResolvedValue({ event: parsedEvent });
    const event = {
      originalFile: { path: 'legacy.fit' },
      getActivities: () => [],
    } as any;

    const result = await service.parseEventFromOriginalFiles(event, {
      preserveActivityIdsFromEvent: false,
    });

    expect(result.sourceFilesCount).toBe(1);
    expect(result.finalEvent).toBe(parsedEvent);
  });

  it('should return empty source list when no metadata exists', async () => {
    const event = {
      getActivities: () => [],
    } as any;

    const result = await service.parseEventFromOriginalFiles(event, {
      preserveActivityIdsFromEvent: false,
    });

    expect(result.sourceFilesCount).toBe(0);
    expect(result.finalEvent).toBeNull();
  });

  it('downloadFile should return cached buffer when generation matches', async () => {
    const cachedBuffer = new ArrayBuffer(16);
    cacheServiceMock.getFile.mockResolvedValue({ buffer: cachedBuffer, generation: 'gen-1' });

    const result = await service.downloadFile('users/u/events/e/original.fit');

    expect(storageMocks.getMetadata).toHaveBeenCalled();
    expect(storageMocks.getBytes).not.toHaveBeenCalled();
    expect(result).toBe(cachedBuffer);
  });

  it('getFileGeneration should expose the current source-file generation using the same metadata TTL rules', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const path = 'users/u/events/e/original.fit';

    const firstGeneration = await service.getFileGeneration(path, { metadataCacheTtlMs: 120000 });
    vi.setSystemTime(new Date('2025-01-01T00:01:00.000Z'));
    const secondGeneration = await service.getFileGeneration(path, { metadataCacheTtlMs: 120000 });

    expect(firstGeneration).toBe('gen-1');
    expect(secondGeneration).toBe('gen-1');
    expect(storageMocks.getMetadata).toHaveBeenCalledTimes(1);
  });

  it('downloadFile should download and cache buffer when cache is missing', async () => {
    const downloadedBuffer = new ArrayBuffer(20);
    cacheServiceMock.getFile.mockResolvedValue(undefined);
    storageMocks.getBytes.mockResolvedValue(downloadedBuffer);

    const result = await service.downloadFile('users/u/events/e/original.fit');

    expect(storageMocks.getBytes).toHaveBeenCalled();
    expect(cacheServiceMock.setFile).toHaveBeenCalledWith('users/u/events/e/original.fit', {
      buffer: downloadedBuffer,
      generation: 'gen-1',
    });
    expect(result).toBe(downloadedBuffer);
  });

  it('downloadFile should fallback to direct download on metadata/cache error', async () => {
    const fallbackBuffer = new ArrayBuffer(24);
    storageMocks.getMetadata.mockRejectedValue(new Error('metadata failed'));
    storageMocks.getBytes.mockResolvedValue(fallbackBuffer);

    const result = await service.downloadFile('users/u/events/e/original.fit');

    expect(storageMocks.getBytes).toHaveBeenCalled();
    expect(result).toBe(fallbackBuffer);
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it('fetchAndParseOneFile should pass metadata cache TTL override to downloadFile', async () => {
    const parsedEvent = { getActivities: () => [] } as any;
    const downloadSpy = vi.spyOn(service, 'downloadFile').mockResolvedValue(new ArrayBuffer(8));
    vi.spyOn(EventImporterFIT, 'getFromArrayBuffer').mockResolvedValue(parsedEvent as any);

    const result = await (service as any).fetchAndParseOneFile(
      { path: 'users/u/events/e/original.fit' },
      true,
      3600000,
    );

    expect(downloadSpy).toHaveBeenCalledWith('users/u/events/e/original.fit', { metadataCacheTtlMs: 3600000 });
    expect(result.event).toBe(parsedEvent);
  });

  it('downloadFile should use default metadata TTL of 30s', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const path = 'users/u/events/e/original.fit';
    const cachedBuffer = new ArrayBuffer(16);
    cacheServiceMock.getFile.mockResolvedValue({ buffer: cachedBuffer, generation: 'gen-1' });

    await service.downloadFile(path);
    expect(storageMocks.getMetadata).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2025-01-01T00:00:20.000Z'));
    await service.downloadFile(path);
    expect(storageMocks.getMetadata).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2025-01-01T00:00:31.000Z'));
    await service.downloadFile(path);
    expect(storageMocks.getMetadata).toHaveBeenCalledTimes(2);
  });

  it('downloadFile should honor caller-provided metadata TTL override', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const path = 'users/u/events/e/original.fit';
    const cachedBuffer = new ArrayBuffer(16);
    cacheServiceMock.getFile.mockResolvedValue({ buffer: cachedBuffer, generation: 'gen-1' });

    await service.downloadFile(path, { metadataCacheTtlMs: 120000 });
    expect(storageMocks.getMetadata).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2025-01-01T00:00:31.000Z'));
    await service.downloadFile(path, { metadataCacheTtlMs: 120000 });
    expect(storageMocks.getMetadata).toHaveBeenCalledTimes(1);
  });

  it('downloadFile should disable reusable metadata caching when TTL is zero', async () => {
    const path = 'users/u/events/e/original.fit';
    const cachedBuffer = new ArrayBuffer(16);
    cacheServiceMock.getFile.mockResolvedValue({ buffer: cachedBuffer, generation: 'gen-1' });

    await service.downloadFile(path, { metadataCacheTtlMs: 0 });
    await service.downloadFile(path, { metadataCacheTtlMs: 0 });

    expect(storageMocks.getMetadata).toHaveBeenCalledTimes(2);
  });

  it('downloadFile should dedupe in-flight metadata calls for the same path under concurrency', async () => {
    const path = 'users/u/events/e/original.fit';
    const cachedBuffer = new ArrayBuffer(16);
    cacheServiceMock.getFile.mockResolvedValue({ buffer: cachedBuffer, generation: 'gen-1' });

    storageMocks.getMetadata.mockImplementation(async () => {
      await Promise.resolve();
      return { generation: 'gen-1' };
    });

    await Promise.all(Array.from({ length: 200 }, () => service.downloadFile(path)));

    expect(storageMocks.getMetadata).toHaveBeenCalledTimes(1);
    expect(storageMocks.getBytes).not.toHaveBeenCalled();
  });

  it('downloadFile should hold metadata call count during heavy same-path bursts within TTL and refresh after expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const path = 'users/u/events/e/original.fit';
    const cachedBuffer = new ArrayBuffer(16);
    cacheServiceMock.getFile.mockResolvedValue({ buffer: cachedBuffer, generation: 'gen-1' });

    for (let round = 0; round < 15; round += 1) {
      await Promise.all(Array.from({ length: 100 }, () => service.downloadFile(path)));
    }
    expect(storageMocks.getMetadata).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2025-01-01T00:00:31.000Z'));
    await Promise.all(Array.from({ length: 100 }, () => service.downloadFile(path)));
    expect(storageMocks.getMetadata).toHaveBeenCalledTimes(2);
  });

  it('downloadFile should dedupe metadata lookups independently per path under mixed-path stress', async () => {
    const cachedBuffer = new ArrayBuffer(16);
    cacheServiceMock.getFile.mockResolvedValue({ buffer: cachedBuffer, generation: 'gen-1' });

    const paths = Array.from({ length: 50 }, (_, index) => `users/u/events/e/original-${index}.fit`);
    const requests = paths.flatMap((path) => Array.from({ length: 20 }, () => service.downloadFile(path)));

    await Promise.all(requests);

    expect(storageMocks.getMetadata).toHaveBeenCalledTimes(50);
    expect(storageMocks.getBytes).not.toHaveBeenCalled();
  });

  it('should parse FIT files and apply enrichment', async () => {
    const activity = {};
    const parsedEvent = { getActivities: () => [activity] } as any;
    vi.spyOn(service, 'downloadFile').mockResolvedValue(new ArrayBuffer(8));
    vi.spyOn(EventImporterFIT, 'getFromArrayBuffer').mockResolvedValue(parsedEvent as any);
    eventUtilitiesMock.enrich.mockImplementation(() => undefined);

    const result = await (service as any).fetchAndParseOneFile({ path: 'users/u/events/e/original.fit' }, false);

    expect(EventImporterFIT.getFromArrayBuffer).toHaveBeenCalled();
    expect(eventUtilitiesMock.enrich).toHaveBeenCalledWith(activity, ['Time', 'Duration']);
    expect(result.event).toBe(parsedEvent);
  });

  it('should parse GPX/TCX/JSON/SML extensions', async () => {
    const parsedEvent = { getActivities: () => [] } as any;
    vi.spyOn(service, 'downloadFile').mockResolvedValue(new TextEncoder().encode('<xml></xml>').buffer as ArrayBuffer);
    vi.spyOn(EventImporterGPX, 'getFromString').mockResolvedValue(parsedEvent as any);
    vi.spyOn(EventImporterTCX, 'getFromXML').mockResolvedValue(parsedEvent as any);
    vi.spyOn(EventImporterSuuntoJSON, 'getFromJSONString').mockResolvedValue(parsedEvent as any);
    vi.spyOn(EventImporterSuuntoSML, 'getFromXML').mockResolvedValue(parsedEvent as any);

    const gpxResult = await (service as any).fetchAndParseOneFile({ path: 'users/u/events/e/original.gpx' }, true);
    const tcxResult = await (service as any).fetchAndParseOneFile({ path: 'users/u/events/e/original.tcx' }, true);
    const jsonData = new TextEncoder().encode('{"foo":"bar"}').buffer as ArrayBuffer;
    vi.spyOn(service, 'downloadFile').mockResolvedValueOnce(jsonData);
    const jsonResult = await (service as any).fetchAndParseOneFile({ path: 'users/u/events/e/original.json' }, true);
    const smlResult = await (service as any).fetchAndParseOneFile({ path: 'users/u/events/e/original.sml' }, true);

    expect(gpxResult.event).toBe(parsedEvent);
    expect(tcxResult.event).toBe(parsedEvent);
    expect(jsonResult.event).toBe(parsedEvent);
    expect(smlResult.event).toBe(parsedEvent);
  });

  it('should warn and continue on duplicate stream enrichment errors', async () => {
    const activity = {};
    const parsedEvent = { getActivities: () => [activity] } as any;
    vi.spyOn(service, 'downloadFile').mockResolvedValue(new ArrayBuffer(8));
    vi.spyOn(EventImporterFIT, 'getFromArrayBuffer').mockResolvedValue(parsedEvent as any);
    eventUtilitiesMock.enrich.mockImplementation(() => {
      throw new Error('Duplicate type of stream');
    });

    const result = await (service as any).fetchAndParseOneFile({ path: 'users/u/events/e/original.fit' }, false);

    expect(result.event).toBe(parsedEvent);
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('should return parse failure when enrichment throws non-duplicate error', async () => {
    const activity = {};
    const parsedEvent = { getActivities: () => [activity] } as any;
    vi.spyOn(service, 'downloadFile').mockResolvedValue(new ArrayBuffer(8));
    vi.spyOn(EventImporterFIT, 'getFromArrayBuffer').mockResolvedValue(parsedEvent as any);
    eventUtilitiesMock.enrich.mockImplementation(() => {
      throw new Error('hard fail');
    });

    const result = await (service as any).fetchAndParseOneFile({ path: 'users/u/events/e/original.fit' }, false);

    expect(result.event).toBeNull();
    expect(result.reason).toContain('hard fail');
  });

  it('should return parse failure for unsupported extension', async () => {
    vi.spyOn(service, 'downloadFile').mockResolvedValue(new ArrayBuffer(8));
    const result = await (service as any).fetchAndParseOneFile({ path: 'users/u/events/e/original.xyz' });
    expect(result.event).toBeNull();
    expect(result.reason).toContain('Unsupported original file extension');
  });
});
