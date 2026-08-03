import { inject, Injectable } from '@angular/core';
import {
  ActivityTypesHelper,
  DataActivityTypes,
  DataDuration,
  type ActivityTypes,
  type EventInterface,
  type User,
} from '@sports-alliance/sports-lib';
import { map, Observable, of, startWith, tap } from 'rxjs';
import type { ActivityCalendarQueryWindow } from '../helpers/activity-calendar.helper';
import { AppEventService, type EventDocumentData } from './app.event.service';

@Injectable({ providedIn: 'root' })
export class ActivityCalendarService {
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly CACHE_MAX_ENTRIES = 12;
  private readonly eventService = inject(AppEventService);
  private readonly eventCache = new Map<string, { events: EventInterface[]; expiresAt: number }>();

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

    const cacheKey = `${user.uid}:${window.startMs}:${window.endExclusiveMs}`;
    const cachedEvents = this.readCachedEvents(cacheKey);
    const events$ = this.eventService.watchEventDocumentsBy(user, [{
      fieldPath: 'startDate',
      opStr: '>=',
      value: window.startMs,
    }, {
      fieldPath: 'startDate',
      opStr: '<',
      value: window.endExclusiveMs,
    }], 'startDate', true, 0).pipe(
      map(documents => [...(documents || [])]
        .filter(document => !isMergeOrBenchmarkDocument(document))
        .map(toActivityCalendarEvent)
        .filter((event): event is EventInterface => !!event)
        .sort((left, right) => resolveStartTime(left) - resolveStartTime(right))),
      tap(events => this.cacheEvents(cacheKey, events)),
    );

    return cachedEvents ? events$.pipe(startWith(cachedEvents)) : events$;
  }

  private readCachedEvents(cacheKey: string): EventInterface[] | null {
    const cached = this.eventCache.get(cacheKey);
    if (!cached) {
      return null;
    }
    if (cached.expiresAt <= Date.now()) {
      this.eventCache.delete(cacheKey);
      return null;
    }
    this.eventCache.delete(cacheKey);
    this.eventCache.set(cacheKey, cached);
    return cached.events;
  }

  private cacheEvents(cacheKey: string, events: EventInterface[]): void {
    this.eventCache.delete(cacheKey);
    this.eventCache.set(cacheKey, {
      events,
      expiresAt: Date.now() + ActivityCalendarService.CACHE_TTL_MS,
    });
    while (this.eventCache.size > ActivityCalendarService.CACHE_MAX_ENTRIES) {
      const oldestKey = this.eventCache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.eventCache.delete(oldestKey);
    }
  }
}

function toActivityCalendarEvent(document: EventDocumentData): EventInterface | null {
  const id = `${document.id || ''}`.trim();
  const startDate = resolveDate(document.startDate);
  if (!id || !startDate) {
    return null;
  }

  const stats = isRecord(document.stats) ? document.stats : {};
  const durationSeconds = resolveDurationSeconds(stats[DataDuration.type]);
  const activityTypes = resolveActivityTypes(stats[DataActivityTypes.type]);
  const name = typeof document.name === 'string' ? document.name : '';
  const description = typeof document.description === 'string' ? document.description : null;

  return {
    name,
    description,
    startDate,
    getID: () => id,
    getStat: type => type === DataDuration.type && durationSeconds !== null
      ? { getValue: () => durationSeconds }
      : null,
    getActivityTypesAsArray: () => activityTypes,
    getActivityTypesAsString: () => activityTypes.join(', '),
  } as EventInterface;
}

function resolveDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  if (value && typeof (value as { toDate?: () => unknown }).toDate === 'function') {
    const parsed = (value as { toDate: () => unknown }).toDate();
    return parsed instanceof Date && Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

function resolveDurationSeconds(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const durationSeconds = Number(value);
  return Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds : null;
}

function resolveActivityTypes(value: unknown): ActivityTypes[] {
  const values = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  const activityTypes = values
    .map(activityType => ActivityTypesHelper.resolveActivityType(activityType))
    .filter((activityType): activityType is ActivityTypes => !!activityType);
  return [...new Set(activityTypes)];
}

function isMergeOrBenchmarkDocument(document: EventDocumentData): boolean {
  return document.isMerge === true
    || document.hasBenchmark === true
    || !!document.benchmarkResults
    || !!document.benchmarkResult
    || (Array.isArray(document.benchmarkDevices) && document.benchmarkDevices.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
