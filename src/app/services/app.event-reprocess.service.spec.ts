import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventUtilities } from '@sports-alliance/sports-lib';
import { AppEventSummary } from '@shared/event-summary';

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
      toJSON: () => ({}),
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

  it.each(['regenerateEventStatistics', 'reimportEventFromOriginalFiles'] as const)(
    'allows %s to repair a summary before any full hydration', async method => {
      const summary = new AppEventSummary({ id: 'event-1', name: 'Run', startDate: 1000, endDate: 2000,
        stats: { 'Average Power': 'malformed stored value' } } as any);
      summary.originalFiles = [{ path: 'source.fit' } as any];
      const refreshed = makeSourceEvent();
      let repaired = false;
      functionsServiceMock.call.mockImplementation(async () => {
        repaired = true;
        return { data: { status: 'completed', sourceFilesCount: 1 } };
      });
      eventServiceMock.getEventAndActivities.mockImplementation(() => {
        if (!repaired) throw new Error('Cannot restore malformed source');
        return of(refreshed);
      });

      const result = await service[method]({ uid: 'u1' } as any, summary);

      expect(functionsServiceMock.call).toHaveBeenCalledExactlyOnceWith('reprocessEvent', {
        eventId: 'event-1', mode: method === 'regenerateEventStatistics' ? 'regenerate' : 'reimport',
      });
      expect(result.event).toBe(refreshed);
      expect(eventServiceMock.getEventAndActivities).toHaveBeenCalledTimes(1);
      expect(EventUtilities.reGenerateStatsForEvent).not.toHaveBeenCalled();
      expect(() => summary.getStat('Average Power')).toThrow();
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

  it.each([
    ['MONITORING_SOURCE', 'daily monitoring data'],
    ['ROUTE_SOURCE', 'upload it from Routes'],
    ['NON_ACTIVITY_SOURCE', 'not a recorded activity'],
    ['MIXED_SOURCES_REQUIRING_REVIEW', 'need review'],
  ])('shows the %s skip without refreshing or modifying the event', async (reason, message) => {
    const event = makeTargetEvent();
    const onProgress = vi.fn();
    functionsServiceMock.call.mockResolvedValueOnce({ data: { status: 'skipped', reason, sourceFilesCount: 1 } });
    await expect(service.reimportEventFromOriginalFiles({ uid: 'u1' } as any, event, { onProgress }))
      .rejects.toMatchObject({ code: 'NON_ACTIVITY_SOURCE', message: expect.stringContaining(message) });
    expect(eventServiceMock.getEventAndActivities).not.toHaveBeenCalled();
    expect(event.clearActivities).not.toHaveBeenCalled();
    expect(onProgress.mock.calls.some(([progress]) => progress.phase === 'done')).toBe(false);
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
