import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityUtilities, EventUtilities } from '@sports-alliance/sports-lib';
import { AppEventReprocessService, ReprocessError, ReprocessProgress } from './app.event-reprocess.service';
import { AppEventService } from './app.event.service';
import { AppOriginalFileHydrationService } from './app.original-file-hydration.service';

describe('AppEventReprocessService', () => {
  let service: AppEventReprocessService;
  let eventServiceMock: any;
  let hydrationServiceMock: any;

  beforeEach(() => {
    eventServiceMock = {
      attachStreamsToEventWithActivities: vi.fn(),
      writeAllEventData: vi.fn().mockResolvedValue(undefined),
    };
    hydrationServiceMock = {
      parseEventFromOriginalFiles: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        AppEventReprocessService,
        { provide: AppEventService, useValue: eventServiceMock },
        { provide: AppOriginalFileHydrationService, useValue: hydrationServiceMock },
      ]
    });

    service = TestBed.inject(AppEventReprocessService);
    vi.restoreAllMocks();
  });

  it('should regenerate event stats with preserved non-regenerated stat types', async () => {
    const oldOnlyStat = { getType: () => 'old-only' };
    const staleRegeneratedStat = { getType: () => 'to-regenerate', stale: true };
    const generatedStat = { getType: () => 'to-regenerate', stale: false };
    const statsMap = new Map<string, any>([
      ['old-only', oldOnlyStat],
      ['to-regenerate', staleRegeneratedStat],
    ]);
    const activity = {
      getStats: vi.fn().mockImplementation(() => statsMap),
      clearStats: vi.fn().mockImplementation(() => statsMap.clear()),
      getStat: vi.fn().mockImplementation((type: string) => statsMap.get(type)),
      addStat: vi.fn().mockImplementation((stat: any) => statsMap.set(stat.getType(), stat)),
    };
    const event = {
      originalFile: { path: 'users/u/events/e/original.fit' },
      getActivities: vi.fn().mockReturnValue([activity]),
      isMerge: false,
    } as any;

    eventServiceMock.attachStreamsToEventWithActivities.mockReturnValue(of(event));
    vi.spyOn(ActivityUtilities, 'generateMissingStreamsAndStatsForActivity').mockImplementation((target: any) => {
      target.addStat(generatedStat);
    });
    const regenerateSpy = vi.spyOn(EventUtilities, 'reGenerateStatsForEvent').mockImplementation(() => { });

    await service.regenerateEventStatistics({ uid: 'u1' } as any, event);

    expect(ActivityUtilities.generateMissingStreamsAndStatsForActivity).toHaveBeenCalledWith(activity as any);
    expect(statsMap.get('old-only')).toBe(oldOnlyStat);
    expect(statsMap.get('to-regenerate')).toBe(generatedStat);
    expect(regenerateSpy).toHaveBeenCalledWith(event);
    expect(eventServiceMock.writeAllEventData).toHaveBeenCalledWith({ uid: 'u1' }, event);
  });

  it('should throw NO_ORIGINAL_FILES when regenerateEventStatistics has no source metadata', async () => {
    const event = {
      getActivities: vi.fn().mockReturnValue([]),
    } as any;

    await expect(service.regenerateEventStatistics({ uid: 'u1' } as any, event)).rejects.toMatchObject({
      code: 'NO_ORIGINAL_FILES',
    });
  });

  it('should throw PARSE_FAILED when regenerateEventStatistics rehydrate fails', async () => {
    const event = {
      originalFile: { path: 'users/u/events/e/original.fit' },
      getActivities: vi.fn().mockReturnValue([]),
    } as any;
    eventServiceMock.attachStreamsToEventWithActivities.mockReturnValue(throwError(() => new Error('parse failed')));

    await expect(service.regenerateEventStatistics({ uid: 'u1' } as any, event)).rejects.toMatchObject({
      code: 'PARSE_FAILED',
    });
  });

  it('should regenerate activity statistics using simplified behavior', async () => {
    const activity = { getID: () => 'a-1' } as any;
    const event = {
      originalFile: { path: 'users/u/events/e/original.fit' },
      getActivities: vi.fn().mockReturnValue([activity]),
      isMerge: true,
    } as any;
    eventServiceMock.attachStreamsToEventWithActivities.mockReturnValue(of(event));
    const regenerateSpy = vi.spyOn(EventUtilities, 'reGenerateStatsForEvent').mockImplementation(() => { });
    const activityGenerateSpy = vi.spyOn(ActivityUtilities, 'generateMissingStreamsAndStatsForActivity').mockImplementation(() => { });

    const result = await service.regenerateActivityStatistics({ uid: 'u1' } as any, event, 'a-1');

    expect(result.updatedActivityId).toBe('a-1');
    expect(activityGenerateSpy).not.toHaveBeenCalled();
    expect(regenerateSpy).toHaveBeenCalledWith(event);
    expect(eventServiceMock.writeAllEventData).toHaveBeenCalledWith({ uid: 'u1' }, event);
  });

  it('should throw ACTIVITY_NOT_FOUND_AFTER_REHYDRATE when activity is missing', async () => {
    const event = {
      originalFile: { path: 'users/u/events/e/original.fit' },
      getActivities: vi.fn().mockReturnValue([]),
    } as any;
    eventServiceMock.attachStreamsToEventWithActivities.mockReturnValue(of(event));

    await expect(service.regenerateActivityStatistics({ uid: 'u1' } as any, event, 'missing-id')).rejects.toMatchObject({
      code: 'ACTIVITY_NOT_FOUND_AFTER_REHYDRATE',
    });
  });

  it('should throw NO_ORIGINAL_FILES when regenerateActivityStatistics has no source metadata', async () => {
    const event = {
      getActivities: vi.fn().mockReturnValue([]),
    } as any;

    await expect(service.regenerateActivityStatistics({ uid: 'u1' } as any, event, 'a-1')).rejects.toMatchObject({
      code: 'NO_ORIGINAL_FILES',
    });
  });

  it('should pass skipEnrichment option into attachStreamsToEventWithActivities', async () => {
    const activity = { getID: () => 'a-1' } as any;
    const event = {
      originalFile: { path: 'users/u/events/e/original.fit' },
      getActivities: vi.fn().mockReturnValue([activity]),
      isMerge: false,
    } as any;
    eventServiceMock.attachStreamsToEventWithActivities.mockReturnValue(of(event));
    vi.spyOn(EventUtilities, 'reGenerateStatsForEvent').mockImplementation(() => { });

    await service.regenerateActivityStatistics({ uid: 'u1' } as any, event, 'a-1', { skipEnrichment: true });

    expect(eventServiceMock.attachStreamsToEventWithActivities).toHaveBeenCalledWith(
      { uid: 'u1' },
      event,
      undefined,
      true,
      true,
    );
  });

  it('should reimport multi-file events and preserve original isMerge flag', async () => {
    const parsedActivity1 = { getID: () => 'a-1' };
    const parsedActivity2 = { getID: () => 'a-2' };
    const parsedEvent = {
      setID: vi.fn().mockReturnThis(),
      getActivities: vi.fn().mockReturnValue([parsedActivity1, parsedActivity2]),
    } as any;
    const event = {
      getID: () => 'event-1',
      originalFiles: [{ path: 'f1.fit' }, { path: 'f2.fit' }],
      originalFile: { path: 'f1.fit' },
      isMerge: false,
      clearActivities: vi.fn(),
      addActivities: vi.fn(),
      getActivities: vi.fn().mockReturnValue([]),
    } as any;
    hydrationServiceMock.parseEventFromOriginalFiles.mockResolvedValue({
      finalEvent: parsedEvent,
      parsedEvents: [parsedEvent],
      sourceFilesCount: 2,
      failedFiles: [],
    });
    vi.spyOn(EventUtilities, 'reGenerateStatsForEvent').mockImplementation(() => { });

    const result = await service.reimportEventFromOriginalFiles({ uid: 'u1' } as any, event);

    expect(hydrationServiceMock.parseEventFromOriginalFiles).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ strictAllFilesRequired: true }),
    );
    expect(parsedEvent.setID).toHaveBeenCalledWith('event-1');
    expect((parsedEvent as any).isMerge).toBe(false);
    expect((event as any).isMerge).toBe(false);
    expect(event.clearActivities).toHaveBeenCalled();
    expect(event.addActivities).toHaveBeenCalledWith([parsedActivity1, parsedActivity2]);
    expect(result.preservedIsMerge).toBe(false);
    expect(result.wasMultiFileSource).toBe(true);
  });

  it('should preserve true isMerge flag during reimport', async () => {
    const parsedEvent = {
      setID: vi.fn().mockReturnThis(),
      getActivities: vi.fn().mockReturnValue([]),
    } as any;
    const event = {
      getID: () => 'event-1',
      originalFiles: [{ path: 'f1.fit' }, { path: 'f2.fit' }],
      originalFile: { path: 'f1.fit' },
      isMerge: true,
      clearActivities: vi.fn(),
      addActivities: vi.fn(),
      getActivities: vi.fn().mockReturnValue([]),
    } as any;
    hydrationServiceMock.parseEventFromOriginalFiles.mockResolvedValue({
      finalEvent: parsedEvent,
      parsedEvents: [parsedEvent],
      sourceFilesCount: 2,
      failedFiles: [],
    });
    vi.spyOn(EventUtilities, 'reGenerateStatsForEvent').mockImplementation(() => { });

    const result = await service.reimportEventFromOriginalFiles({ uid: 'u1' } as any, event);

    expect((parsedEvent as any).isMerge).toBe(true);
    expect((event as any).isMerge).toBe(true);
    expect(result.preservedIsMerge).toBe(true);
  });

  it('should fail whole reimport when any source file fails', async () => {
    const event = {
      getID: () => 'event-1',
      originalFiles: [{ path: 'f1.fit' }, { path: 'f2.fit' }],
      isMerge: true,
      clearActivities: vi.fn(),
      addActivities: vi.fn(),
    } as any;
    hydrationServiceMock.parseEventFromOriginalFiles.mockResolvedValue({
      finalEvent: null,
      parsedEvents: [],
      sourceFilesCount: 2,
      failedFiles: [{ path: 'f2.fit', reason: 'parse error' }],
    });

    await expect(service.reimportEventFromOriginalFiles({ uid: 'u1' } as any, event)).rejects.toMatchObject({
      code: 'MULTI_FILE_INCOMPLETE',
    });
    expect(eventServiceMock.writeAllEventData).not.toHaveBeenCalled();
    expect(event.clearActivities).not.toHaveBeenCalled();
  });

  it('should throw PARSE_FAILED when reimport has no final event and no failed files', async () => {
    const event = {
      getID: () => 'event-1',
      originalFiles: [{ path: 'f1.fit' }],
      isMerge: false,
      clearActivities: vi.fn(),
      addActivities: vi.fn(),
    } as any;
    hydrationServiceMock.parseEventFromOriginalFiles.mockResolvedValue({
      finalEvent: null,
      parsedEvents: [],
      sourceFilesCount: 1,
      failedFiles: [],
    });

    await expect(service.reimportEventFromOriginalFiles({ uid: 'u1' } as any, event)).rejects.toMatchObject({
      code: 'PARSE_FAILED',
    });
  });

  it('should throw NO_ORIGINAL_FILES when reimport has no source metadata', async () => {
    const event = {
      getID: () => 'event-1',
      clearActivities: vi.fn(),
      addActivities: vi.fn(),
      getActivities: vi.fn().mockReturnValue([]),
    } as any;

    await expect(service.reimportEventFromOriginalFiles({ uid: 'u1' } as any, event)).rejects.toMatchObject({
      code: 'NO_ORIGINAL_FILES',
    });
  });

  it('should throw PERSIST_FAILED when reimport save fails', async () => {
    const parsedEvent = {
      setID: vi.fn().mockReturnThis(),
      getActivities: vi.fn().mockReturnValue([]),
    } as any;
    const event = {
      getID: () => 'event-1',
      originalFiles: [{ path: 'f1.fit' }],
      originalFile: { path: 'f1.fit' },
      isMerge: false,
      clearActivities: vi.fn(),
      addActivities: vi.fn(),
      getActivities: vi.fn().mockReturnValue([]),
    } as any;
    hydrationServiceMock.parseEventFromOriginalFiles.mockResolvedValue({
      finalEvent: parsedEvent,
      parsedEvents: [parsedEvent],
      sourceFilesCount: 1,
      failedFiles: [],
    });
    eventServiceMock.writeAllEventData.mockRejectedValueOnce(new Error('write failed'));
    vi.spyOn(EventUtilities, 'reGenerateStatsForEvent').mockImplementation(() => { });

    await expect(service.reimportEventFromOriginalFiles({ uid: 'u1' } as any, event)).rejects.toMatchObject({
      code: 'PERSIST_FAILED',
    });
  });

  it('should emit ordered progress phases', async () => {
    const phases: ReprocessProgress['phase'][] = [];
    const event = {
      originalFile: { path: 'users/u/events/e/original.fit' },
      getActivities: vi.fn().mockReturnValue([]),
      isMerge: false,
    } as any;
    eventServiceMock.attachStreamsToEventWithActivities.mockReturnValue(of(event));
    vi.spyOn(EventUtilities, 'reGenerateStatsForEvent').mockImplementation(() => { });

    await service.regenerateEventStatistics({ uid: 'u1' } as any, event, {
      onProgress: (progress) => phases.push(progress.phase),
    });

    expect(phases[0]).toBe('validating');
    expect(phases).toContain('parsing');
    expect(phases).toContain('persisting');
    expect(phases[phases.length - 1]).toBe('done');
  });

  it('should emit reimport progress phases including merging', async () => {
    const phases: ReprocessProgress['phase'][] = [];
    const parsedEvent = {
      setID: vi.fn().mockReturnThis(),
      getActivities: vi.fn().mockReturnValue([]),
    } as any;
    const event = {
      getID: () => 'event-1',
      originalFiles: [{ path: 'f1.fit' }],
      originalFile: { path: 'f1.fit' },
      isMerge: false,
      clearActivities: vi.fn(),
      addActivities: vi.fn(),
      getActivities: vi.fn().mockReturnValue([]),
    } as any;
    hydrationServiceMock.parseEventFromOriginalFiles.mockResolvedValue({
      finalEvent: parsedEvent,
      parsedEvents: [parsedEvent],
      sourceFilesCount: 1,
      failedFiles: [],
    });
    vi.spyOn(EventUtilities, 'reGenerateStatsForEvent').mockImplementation(() => { });

    await service.reimportEventFromOriginalFiles({ uid: 'u1' } as any, event, {
      onProgress: (progress) => phases.push(progress.phase),
      skipEnrichment: true,
    });

    expect(hydrationServiceMock.parseEventFromOriginalFiles).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ skipEnrichment: true }),
    );
    expect(phases).toEqual(expect.arrayContaining(['validating', 'downloading', 'parsing', 'merging', 'persisting', 'done']));
  });

  it('should surface persist failures as typed errors', async () => {
    const event = {
      originalFile: { path: 'users/u/events/e/original.fit' },
      getActivities: vi.fn().mockReturnValue([]),
      isMerge: false,
    } as any;
    eventServiceMock.attachStreamsToEventWithActivities.mockReturnValue(of(event));
    eventServiceMock.writeAllEventData.mockRejectedValueOnce(new Error('write failed'));
    vi.spyOn(EventUtilities, 'reGenerateStatsForEvent').mockImplementation(() => { });

    await expect(service.regenerateEventStatistics({ uid: 'u1' } as any, event)).rejects.toMatchObject({
      code: 'PERSIST_FAILED',
    });
  });
});
