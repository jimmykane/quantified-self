import { TestBed } from '@angular/core/testing';
import {
  ActivityTypes,
  DataActivityTypes,
  DataAscent,
  DataDistance,
  DataDuration,
  type User,
} from '@sports-alliance/sports-lib';
import { firstValueFrom, of, Subject } from 'rxjs';
import { ActivityCalendarService } from './activity-calendar.service';
import { AppEventService } from './app.event.service';

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
    expect(events[0].getActivityTypesAsArray()).toEqual([ActivityTypes.Running]);
    expect(events[0].getActivityTypesAsString()).toBe('Running');
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

function eventAt(id: string, startDate: Date) {
  return {
    id,
    startDate,
    name: `${id} run`,
    description: null,
    stats: {
      [DataDuration.type]: 3600,
      [DataDistance.type]: 10_000,
      [DataAscent.type]: 450,
      [DataActivityTypes.type]: [ActivityTypes.Running],
    },
  };
}
