import { inject, Injectable } from '@angular/core';
import type { EventInterface, User } from '@sports-alliance/sports-lib';
import { map, Observable, of } from 'rxjs';
import type { ActivityCalendarQueryWindow } from '../helpers/activity-calendar.helper';
import { isMergeOrBenchmarkEvent } from '../helpers/event-visibility.helper';
import { AppEventService } from './app.event.service';

@Injectable({ providedIn: 'root' })
export class ActivityCalendarService {
  private readonly eventService = inject(AppEventService);

  watchEvents(
    user: User | null | undefined,
    window: ActivityCalendarQueryWindow | null | undefined,
  ): Observable<EventInterface[]> {
    if (
      !user?.uid
      || !window
      || !Number.isFinite(window.startMs)
      || !Number.isFinite(window.endExclusiveMs)
      || window.endExclusiveMs <= window.startMs
    ) {
      return of([]);
    }

    return this.eventService.getEventsBy(user, [{
      fieldPath: 'startDate',
      opStr: '>=',
      value: window.startMs,
    }, {
      fieldPath: 'startDate',
      opStr: '<',
      value: window.endExclusiveMs,
    }], 'startDate', true, 0).pipe(
      map(events => [...(events || [])]
        .filter(event => !isMergeOrBenchmarkEvent(event))
        .sort((left, right) => resolveStartTime(left) - resolveStartTime(right))),
    );
  }
}

function resolveStartTime(event: EventInterface): number {
  const value = (event as { startDate?: unknown } | null)?.startDate;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : Number.POSITIVE_INFINITY;
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}
