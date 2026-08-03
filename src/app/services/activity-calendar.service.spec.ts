import { TestBed } from '@angular/core/testing';
import type { EventInterface, User } from '@sports-alliance/sports-lib';
import { firstValueFrom, of } from 'rxjs';
import { ActivityCalendarService } from './activity-calendar.service';
import { AppEventService } from './app.event.service';

describe('ActivityCalendarService', () => {
  const getEventsBy = vi.fn();

  beforeEach(() => {
    getEventsBy.mockReset();
    TestBed.configureTestingModule({
      providers: [
        ActivityCalendarService,
        { provide: AppEventService, useValue: { getEventsBy } },
      ],
    });
  });

  it('queries the visible interval with an exclusive end and no result limit', async () => {
    getEventsBy.mockReturnValue(of([]));
    const service = TestBed.inject(ActivityCalendarService);
    const user = { uid: 'user-1' } as User;
    const startMs = new Date(2026, 7, 1).getTime();
    const endExclusiveMs = new Date(2026, 8, 1).getTime();

    await firstValueFrom(service.watchEvents(user, { startMs, endExclusiveMs }));

    expect(getEventsBy).toHaveBeenCalledWith(user, [{
      fieldPath: 'startDate',
      opStr: '>=',
      value: startMs,
    }, {
      fieldPath: 'startDate',
      opStr: '<',
      value: endExclusiveMs,
    }], 'startDate', true, 0);
  });

  it('removes merged and benchmark events and orders the remaining events chronologically', async () => {
    const later = eventAt('later', new Date(2026, 7, 4));
    const earlier = eventAt('earlier', new Date(2026, 7, 2));
    const merged = { ...eventAt('merged', new Date(2026, 7, 1)), isMerge: true };
    const benchmark = { ...eventAt('benchmark', new Date(2026, 7, 3)), hasBenchmark: true };
    getEventsBy.mockReturnValue(of([later, merged, benchmark, earlier]));
    const service = TestBed.inject(ActivityCalendarService);

    const events = await firstValueFrom(service.watchEvents(
      { uid: 'user-1' } as User,
      { startMs: new Date(2026, 7, 1).getTime(), endExclusiveMs: new Date(2026, 8, 1).getTime() },
    ));

    expect(events.map(event => event.getID())).toEqual(['earlier', 'later']);
  });

  it('returns an empty list without querying for invalid input', async () => {
    const service = TestBed.inject(ActivityCalendarService);

    await expect(firstValueFrom(service.watchEvents(null, null))).resolves.toEqual([]);
    expect(getEventsBy).not.toHaveBeenCalled();
  });
});

function eventAt(id: string, startDate: Date): EventInterface {
  return {
    startDate,
    getID: () => id,
  } as unknown as EventInterface;
}
