import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventUtilities } from '@sports-alliance/sports-lib';

import { AppEventReprocessService, ReprocessError, ReprocessProgress } from './app.event-reprocess.service';
import { AppEventService } from './app.event.service';
import { AppFunctionsService } from './app.functions.service';

describe('AppEventReprocessService', () => {
  let service: AppEventReprocessService;
  let eventServiceMock: any;
  let functionsServiceMock: any;

  const makeTargetEvent = () => {
    const state = {
      activities: [{ getID: () => 'activity-1' }],
    };
    return {
      getID: vi.fn(() => 'event-1'),
      clearActivities: vi.fn(() => { state.activities = []; }),
      addActivities: vi.fn((activities: any[]) => { state.activities = activities; }),
      getActivities: vi.fn(() => state.activities),
    } as any;
  };

  const makeSourceEvent = () => ({
    getActivities: vi.fn(() => [{ getID: () => 'activity-1' }]),
    originalFiles: [{ path: 'users/u1/events/e1/original.fit' }],
    originalFile: { path: 'users/u1/events/e1/original.fit' },
    isMerge: false,
  }) as any;

  beforeEach(() => {
    eventServiceMock = {
      getEventAndActivities: vi.fn().mockReturnValue(of(makeSourceEvent())),
    };
    functionsServiceMock = {
      call: vi.fn().mockResolvedValue({
        data: {
          eventId: 'event-1',
          mode: 'regenerate',
          status: 'completed',
          sourceFilesCount: 1,
          parsedActivitiesCount: 1,
          staleActivitiesDeleted: 0,
        },
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        AppEventReprocessService,
        { provide: AppEventService, useValue: eventServiceMock },
        { provide: AppFunctionsService, useValue: functionsServiceMock },
      ]
    });

    service = TestBed.inject(AppEventReprocessService);
    vi.spyOn(EventUtilities, 'reGenerateStatsForEvent').mockImplementation(() => { });
  });

  it('should regenerate event statistics through backend callable', async () => {
    const event = makeTargetEvent();

    const result = await service.regenerateEventStatistics({ uid: 'u1' } as any, event);

    expect(functionsServiceMock.call).toHaveBeenCalledWith('reprocessEvent', {
      eventId: 'event-1',
      mode: 'regenerate',
    });
    expect(eventServiceMock.getEventAndActivities).toHaveBeenCalledWith({ uid: 'u1' }, 'event-1');
    expect(event.clearActivities).toHaveBeenCalled();
    expect(event.addActivities).toHaveBeenCalledWith([{ getID: expect.any(Function) }]);
    expect(result.sourceFilesCount).toBe(1);
    expect(result.wasMultiFileSource).toBe(false);
  });

  it('should call backend with reimport mode', async () => {
    const event = makeTargetEvent();
    functionsServiceMock.call.mockResolvedValueOnce({
      data: {
        eventId: 'event-1',
        mode: 'reimport',
        status: 'completed',
        sourceFilesCount: 2,
        parsedActivitiesCount: 2,
        staleActivitiesDeleted: 0,
      },
    });

    const result = await service.reimportEventFromOriginalFiles({ uid: 'u1' } as any, event);

    expect(functionsServiceMock.call).toHaveBeenCalledWith('reprocessEvent', {
      eventId: 'event-1',
      mode: 'reimport',
    });
    expect(result.sourceFilesCount).toBe(2);
    expect(result.wasMultiFileSource).toBe(true);
  });

  it('should map backend skip reason NO_ORIGINAL_FILES to typed error', async () => {
    const event = makeTargetEvent();
    functionsServiceMock.call.mockResolvedValueOnce({
      data: {
        eventId: 'event-1',
        mode: 'reimport',
        status: 'skipped',
        reason: 'NO_ORIGINAL_FILES',
        sourceFilesCount: 0,
        parsedActivitiesCount: 0,
        staleActivitiesDeleted: 0,
      },
    });

    await expect(service.reimportEventFromOriginalFiles({ uid: 'u1' } as any, event)).rejects.toMatchObject({
      code: 'NO_ORIGINAL_FILES',
    });
  });

  it('should map regenerate callable failures to PARSE_FAILED', async () => {
    const event = makeTargetEvent();
    functionsServiceMock.call.mockRejectedValueOnce(new Error('functions/internal'));

    await expect(service.regenerateEventStatistics({ uid: 'u1' } as any, event)).rejects.toMatchObject({
      code: 'PARSE_FAILED',
    });
  });

  it('should map reimport callable failures to MULTI_FILE_INCOMPLETE', async () => {
    const event = makeTargetEvent();
    functionsServiceMock.call.mockRejectedValueOnce(new Error('functions/internal'));

    await expect(service.reimportEventFromOriginalFiles({ uid: 'u1' } as any, event)).rejects.toMatchObject({
      code: 'MULTI_FILE_INCOMPLETE',
    });
  });

  it('should throw PARSE_FAILED when event id is missing', async () => {
    const event = makeTargetEvent();
    event.getID = vi.fn(() => '');

    await expect(service.regenerateEventStatistics({ uid: 'u1' } as any, event)).rejects.toMatchObject({
      code: 'PARSE_FAILED',
    });
  });

  it('should throw PERSIST_FAILED when refreshed event cannot be loaded', async () => {
    const event = makeTargetEvent();
    eventServiceMock.getEventAndActivities.mockReturnValueOnce(of(null));

    await expect(service.regenerateEventStatistics({ uid: 'u1' } as any, event)).rejects.toMatchObject({
      code: 'PERSIST_FAILED',
    });
  });

  it('should emit progress phases for reimport mode', async () => {
    const event = makeTargetEvent();
    const phases: ReprocessProgress['phase'][] = [];

    await service.reimportEventFromOriginalFiles({ uid: 'u1' } as any, event, {
      onProgress: (progress) => phases.push(progress.phase),
    });

    expect(phases).toEqual(expect.arrayContaining([
      'validating',
      'downloading',
      'parsing',
      'merging',
      'regenerating_stats',
      'persisting',
      'done',
    ]));
  });
});
