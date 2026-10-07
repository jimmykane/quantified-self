import { TestBed } from '@angular/core/testing';
import { serializeTrainingLoadSource } from '@shared/training-load-source';
import {
  ActivityTypes,
  DataActivityTypes,
  DataAscent,
  DataDescent,
  DataDistance,
  DataDuration,
  type User,
} from '@sports-alliance/sports-lib';
import { firstValueFrom, of, Subject } from 'rxjs';
import { ActivityCalendarService } from './activity-calendar.service';
import { AppEventService } from './app.event.service';
import {
  DASHBOARD_FORM_LEGACY_TRAINING_STRESS_SCORE_TYPE,
  DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
} from '../helpers/dashboard-form.helper';

describe('ActivityCalendarService', () => {
  const watchEventDocumentsBy = vi.fn();

  beforeEach(() => {
    watchEventDocumentsBy.mockReset();
    TestBed.configureTestingModule({
      providers: [
        ActivityCalendarService,
        { provide: AppEventService, useValue: { watchEventDocumentsBy } },
      ],
    });
  });

  it('queries the visible interval with an exclusive end and no result limit', async () => {
    watchEventDocumentsBy.mockReturnValue(of([]));
    const service = TestBed.inject(ActivityCalendarService);
    const user = { uid: 'user-1' } as User;
    const startMs = new Date(2026, 7, 1).getTime();
    const endExclusiveMs = new Date(2026, 8, 1).getTime();

    await firstValueFrom(service.watchEvents(user, { startMs, endExclusiveMs }));

    expect(watchEventDocumentsBy).toHaveBeenCalledWith(user, [{
      fieldPath: 'startDate',
      opStr: '>=',
      value: startMs,
    }, {
      fieldPath: 'startDate',
      opStr: '<',
      value: endExclusiveMs,
    }], 'startDate', true, 0);
  });

  it('bounds weekly reads and marks lookahead or malformed documents as incomplete', async () => {
    const service = TestBed.inject(ActivityCalendarService);
    const user = { uid: 'owner' } as User;
    const window = { startMs: 1, endExclusiveMs: 100 };
    watchEventDocumentsBy.mockReturnValueOnce(of(Array.from({ length: 1001 }, (_, i) => eventAt(`${i}`, new Date(2)))));
    const partial = await firstValueFrom(service.watchSummaryEvents(user, window));
    expect(partial.events).toHaveLength(1000);
    expect(partial.complete).toBe(false);
    expect(watchEventDocumentsBy).toHaveBeenLastCalledWith(user, expect.any(Array), 'startDate', true, 1001, { waitForServer: true });
    watchEventDocumentsBy.mockReturnValueOnce(of([eventAt('', new Date(2))]));
    expect((await firstValueFrom(service.watchSummaryEvents(user, window))).complete).toBe(false);
    watchEventDocumentsBy.mockReturnValueOnce(of([]));
    expect(await firstValueFrom(service.watchSummaryEvents(user, window))).toEqual({ events: [], complete: true });
  });
  it('bounds the first weekly acknowledgement without expiring a healthy idle listener', async () => {
    vi.useFakeTimers();
    try {
      const pending = new Subject<ReturnType<typeof eventAt>[]>();
      watchEventDocumentsBy.mockReturnValue(pending);
      const service = TestBed.inject(ActivityCalendarService);
      const user = { uid: 'owner' } as User;
      const window = { startMs: 1, endExclusiveMs: 100 };
      const result = firstValueFrom(service.watchSummaryEvents(user, window));
      const rejected = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(ActivityCalendarService.SUMMARY_READ_TIMEOUT_MS); await rejected;
      expect(pending.observed).toBe(false);
      const values: unknown[] = []; const failed = vi.fn();
      const subscription = service.watchSummaryEvents(user, window).subscribe({ next: value => values.push(value), error: failed });
      pending.next([]); await vi.advanceTimersByTimeAsync(2 * ActivityCalendarService.SUMMARY_READ_TIMEOUT_MS);
      expect(values).toEqual([{ events: [], complete: true }]);
      expect(failed).not.toHaveBeenCalled(); expect(subscription.closed).toBe(false);
      subscription.unsubscribe();
    } finally { vi.useRealTimers(); }
  });

  it('builds lightweight calendar events and orders them chronologically', async () => {
    const later = eventAt('later', new Date(2026, 7, 4));
    const earlier = eventAt('earlier', new Date(2026, 7, 2));
    const merged = { ...eventAt('merged', new Date(2026, 7, 1)), isMerge: true };
    const benchmark = { ...eventAt('benchmark', new Date(2026, 7, 3)), hasBenchmark: true };
    watchEventDocumentsBy.mockReturnValue(of([later, merged, benchmark, earlier]));
    const service = TestBed.inject(ActivityCalendarService);

    const events = await firstValueFrom(service.watchEvents(
      { uid: 'user-1' } as User,
      { startMs: new Date(2026, 7, 1).getTime(), endExclusiveMs: new Date(2026, 8, 1).getTime() },
    ));

    expect(events.map(event => event.getID())).toEqual(['earlier', 'later']);
    expect(events[0].getStat(DataDuration.type)?.getValue()).toBe(3600);
    expect(events[0].getStat(DataDistance.type)?.getValue()).toBe(10_000);
    expect(events[0].getStat(DataAscent.type)?.getValue()).toBe(450);
    expect(events[0].getStat(DataDescent.type)?.getValue()).toBe(420);
    expect(events[0].getStat(DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE)?.getValue()).toBe(84);
    expect(events[0].getActivityTypesAsArray()).toEqual([ActivityTypes.Running]);
    expect(events[0].getActivityTypesAsString()).toBe('Running');
  });

  it('provides the complete persisted fingerprint and an empty leg list to Training load readers', async () => {
    const source = { ...eventAt('walk', new Date(2026, 7, 2)), endDate: new Date(2026, 7, 2, 1),
      stats: { Duration: 3600, 'Training Stress Score': 9, Energy: 210, 'Heart Rate Average': 82 } };
    watchEventDocumentsBy.mockReturnValue(of([source]));
    const [event] = await firstValueFrom(TestBed.inject(ActivityCalendarService).watchEvents(
      { uid: 'user-1' } as User, { startMs: 1, endExclusiveMs: Date.now() }));
    expect(event.getActivities()).toEqual([]);
    expect(serializeTrainingLoadSource(event.toJSON?.() ?? event)).toBe(serializeTrainingLoadSource(source));
  });

  it('preserves legacy TSS for Training impact when current TSS is missing', async () => {
    const legacy = eventAt('legacy', new Date(2026, 7, 2));
    delete legacy.stats[DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE];
    legacy.stats[DASHBOARD_FORM_LEGACY_TRAINING_STRESS_SCORE_TYPE] = { _value: '63' };
    watchEventDocumentsBy.mockReturnValue(of([legacy]));
    const service = TestBed.inject(ActivityCalendarService);

    const events = await firstValueFrom(service.watchEvents(
      { uid: 'user-1' } as User,
      { startMs: new Date(2026, 7, 1).getTime(), endExclusiveMs: new Date(2026, 8, 1).getTime() },
    ));

    expect(events[0].getStat(DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE)).toBeNull();
    expect(events[0].getStat(DASHBOARD_FORM_LEGACY_TRAINING_STRESS_SCORE_TYPE)?.getValue()).toBe(63);
  });

  it('supports Firestore timestamps and skips records without a usable identity or date', async () => {
    const startDate = new Date(2026, 7, 2, 7, 30);
    watchEventDocumentsBy.mockReturnValue(of([
      { ...eventAt('timestamp', startDate), startDate: { toDate: () => startDate } },
      eventAt('', startDate),
      { ...eventAt('invalid-date', startDate), startDate: 'invalid' },
    ]));
    const service = TestBed.inject(ActivityCalendarService);

    const events = await firstValueFrom(service.watchEvents(
      { uid: 'user-1' } as User,
      { startMs: new Date(2026, 7, 1).getTime(), endExclusiveMs: new Date(2026, 8, 1).getTime() },
    ));

    expect(events).toHaveLength(1);
    expect(events[0].startDate).toEqual(startDate);
  });

  it('emits a recently visited range from memory before its live query responds', async () => {
    const firstLiveQuery = new Subject<ReturnType<typeof eventAt>[]>();
    const secondLiveQuery = new Subject<ReturnType<typeof eventAt>[]>();
    watchEventDocumentsBy
      .mockReturnValueOnce(firstLiveQuery)
      .mockReturnValueOnce(secondLiveQuery);
    const service = TestBed.inject(ActivityCalendarService);
    const user = { uid: 'user-1' } as User;
    const window = {
      startMs: new Date(2026, 0, 1).getTime(),
      endExclusiveMs: new Date(2027, 0, 1).getTime(),
    };
    const firstEvents: string[] = [];
    const firstSubscription = service.watchEvents(user, window).subscribe(events => {
      firstEvents.push(...events.map(event => event.getID()));
    });
    firstLiveQuery.next([eventAt('cached-event', new Date(2026, 7, 2))]);
    firstSubscription.unsubscribe();

    const cachedEvents = await firstValueFrom(service.watchEvents(user, window));

    expect(firstEvents).toEqual(['cached-event']);
    expect(cachedEvents.map(event => event.getID())).toEqual(['cached-event']);
    expect(watchEventDocumentsBy).toHaveBeenCalledTimes(2);
  });

  it('returns an empty list without querying for invalid input', async () => {
    const service = TestBed.inject(ActivityCalendarService);

    await expect(firstValueFrom(service.watchEvents(null, null))).resolves.toEqual([]);
    expect(watchEventDocumentsBy).not.toHaveBeenCalled();
  });
});

function eventAt(id: string, startDate: Date): {
  id: string;
  startDate: Date;
  name: string;
  description: null;
  stats: Record<string, unknown>;
} {
  return {
    id,
    startDate,
    name: `${id} run`,
    description: null,
    stats: {
      [DataDuration.type]: 3600,
      [DataDistance.type]: 10_000,
      [DataAscent.type]: 450,
      [DataDescent.type]: 420,
      [DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE]: 84,
      [DataActivityTypes.type]: [ActivityTypes.Running],
    },
  };
}
