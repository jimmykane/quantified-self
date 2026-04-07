import { inject, Injectable, OnDestroy } from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib';
import { EventImporterJSON } from '@sports-alliance/sports-lib';
import { combineLatest, from, Observable, of, throwError, zip } from 'rxjs';
import { Firestore, collection, query, orderBy, where, limit, startAfter, endBefore, collectionData, onSnapshot, doc, docData, getDoc, getDocs, getDocsFromCache, updateDoc, deleteDoc, writeBatch, DocumentSnapshot, QueryDocumentSnapshot, Query, QuerySnapshot, DocumentData, getCountFromServer, documentId } from 'app/firebase/firestore';
import { catchError, map, switchMap, take, distinctUntilChanged, tap } from 'rxjs/operators';
import { EventJSONInterface } from '@sports-alliance/sports-lib';
import { ActivityJSONInterface } from '@sports-alliance/sports-lib';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { AppUserUtilities } from '../utils/app.user.utilities';
import { AppWindowService } from './app.window.service';
import {
  EventMetaDataInterface,
  ServiceNames
} from '@sports-alliance/sports-lib';
import { EventExporterGPX } from '@sports-alliance/sports-lib';

import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from '@shared/firestore-write-sanitizer';
import { createParsingOptions } from '@shared/parsing-options';
import { EventImporterSuuntoJSON } from '@sports-alliance/sports-lib';
import { EventImporterFIT } from '@sports-alliance/sports-lib';
import { EventImporterTCX } from '@sports-alliance/sports-lib';
import { EventImporterGPX } from '@sports-alliance/sports-lib';
import { EventImporterSuuntoSML } from '@sports-alliance/sports-lib';
import { EventUtilities } from '@sports-alliance/sports-lib';


import { EventJSONSanitizer } from '../utils/event-json-sanitizer';
import type { EventJSONSanitizerIssue } from '../utils/event-json-sanitizer';

import { AppEventInterface } from '@shared/app-event.interface';
import { AppEventUtilities } from '../utils/app.event.utilities';
import { LoggerService } from './logger.service';
import { AppFileService } from './app.file.service';
import { AppCacheService } from './app.cache.service';
import { BenchmarkEventAdapter } from './benchmark-event.adapter';
import { AppOriginalFileHydrationService, DownloadFileOptions } from './app.original-file-hydration.service';

export interface GetEventsOnceOptions {
  preferCache?: boolean;
  warmServer?: boolean;
  seedLiveQuery?: boolean;
}

export type EventsOnceSource = 'cache' | 'server';

export interface GetEventsOnceResult {
  events: EventInterface[];
  source: EventsOnceSource;
}

interface EventQuerySeed {
  eventsById: Map<string, AppEventInterface>;
  fingerprintsById: Map<string, string>;
  expiresAt: number;
}

/**
 * Controls how parsed data from original files is applied to an existing event.
 * - `attach_streams_only` keeps existing activities and updates their streams.
 * - `replace_activities` clears existing activities and replaces them with parsed activities.
 *
 * Use `replace_activities` only in regeneration/rebuild flows where callers explicitly
 * require full activity replacement from source files. For normal read/load flows,
 * use `attach_streams_only`.
 */
export type StreamHydrationMode = 'attach_streams_only' | 'replace_activities';


@Injectable({
  providedIn: 'root',
})
export class AppEventService implements OnDestroy {

  private firestore = inject(Firestore);
  private fileService = inject(AppFileService);
  private logger = inject(LoggerService);
  private appEventUtilities = inject(AppEventUtilities);
  private benchmarkAdapter = inject(BenchmarkEventAdapter);
  private originalFileHydrationService = inject(AppOriginalFileHydrationService);
  // Short-lived handoff from a one-shot load to the first matching live query.
  private eventQuerySeeds = new Map<string, EventQuerySeed>();
  private eventQuerySeedCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly DEDUPE_TTL_MS = 6 * 60 * 60 * 1000;
  private static readonly SANITIZER_EVENT_TTL_MS = 30 * 60 * 1000;
  private static readonly EVENT_QUERY_SEED_TTL_MS = 30 * 1000;
  private static readonly FIRESTORE_IN_QUERY_MAX_IDS = 30;
  private static readonly DEDUPE_UNKNOWN_TYPES_MAX = 500;
  private static readonly DEDUPE_SANITIZER_ISSUES_MAX = 5000;
  private static readonly DEDUPE_SANITIZER_EVENTS_MAX = 1000;
  private static readonly MAX_ISSUES_PER_REPORT = 20;
  private static reportedUnknownTypes = new Map<string, number>();
  private static reportedSanitizerIssues = new Map<string, number>();
  private static reportedSanitizerEvents = new Map<string, number>();

  constructor(
    private windowService: AppWindowService) {
  }

  private static getSanitizerIssueKey(activityID: string, issue: EventJSONSanitizerIssue): string {
    return `${activityID}|${issue.kind}|${issue.location}|${issue.path}|${issue.type || 'unknown'}|${issue.reason}`;
  }

  private static shouldReportKey(cache: Map<string, number>, key: string, ttlMs: number, maxEntries: number): boolean {
    const now = Date.now();
    const expiresAt = cache.get(key);
    if (expiresAt && expiresAt > now) {
      return false;
    }
    cache.delete(key);
    cache.set(key, now + ttlMs);
    this.pruneCache(cache, maxEntries, now);
    return true;
  }

  private static pruneCache(cache: Map<string, number>, maxEntries: number, now: number): void {
    for (const [key, expiresAt] of cache) {
      if (expiresAt <= now) {
        cache.delete(key);
      }
    }
    while (cache.size > maxEntries) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      cache.delete(oldestKey);
    }
  }

  private static summarizeIssues(issues: EventJSONSanitizerIssue[]): Record<string, number> {
    return issues.reduce((summary: Record<string, number>, issue) => {
      const key = `${issue.kind}:${issue.location}`;
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    }, {});
  }

  private static buildSanitizerFingerprint(eventID: string, activityID: string, issues: EventJSONSanitizerIssue[]): string[] {
    const kinds = [...new Set(issues.map(issue => issue.kind))].sort();
    return ['activity-sanitizer', eventID, activityID, ...kinds];
  }

  private buildSnapshotFingerprint(snapshot: any): string {
    try {
      return JSON.stringify(snapshot ?? null);
    } catch {
      return `${snapshot}`;
    }
  }

  private buildQueryKeyDigest(queryKey: string | null): string | null {
    if (!queryKey) {
      return null;
    }

    let hash = 0;
    for (let index = 0; index < queryKey.length; index += 1) {
      hash = ((hash * 31) + queryKey.charCodeAt(index)) >>> 0;
    }
    return `${queryKey.length}:${hash.toString(16)}`;
  }

  private buildEventQueryKey(
    userID: string,
    whereClauses: { fieldPath: string | any, opStr: any, value: any }[] = [],
    orderByField: string = 'startDate',
    asc: boolean = false,
    limitCount: number = 10,
  ): string {
    return this.buildSnapshotFingerprint({
      userID,
      whereClauses: whereClauses.map((clause) => ({
        fieldPath: `${clause?.fieldPath ?? ''}`,
        opStr: `${clause?.opStr ?? ''}`,
        value: clause?.value ?? null,
      })),
      orderByField,
      asc,
      limitCount,
    });
  }

  private buildEventDocFingerprint(docID: string, snapshot: unknown): string {
    return this.buildSnapshotFingerprint({
      docID,
      snapshot,
    });
  }

  private chunkValues<T>(values: readonly T[], chunkSize: number): T[][] {
    if (!values.length) {
      return [];
    }

    const chunks: T[][] = [];
    for (let startIndex = 0; startIndex < values.length; startIndex += chunkSize) {
      chunks.push(values.slice(startIndex, startIndex + chunkSize));
    }

    return chunks;
  }

  private getActivityIDsForDebug(activities: Array<Partial<ActivityInterface> | any> | null | undefined): string[] {
    return (activities || []).map((activity: any, index: number) =>
      typeof activity?.getID === 'function' ? activity.getID() : `idx-${index}-no-id`,
    );
  }

  /**
   * Firestore rules treat original source file location fields as server-owned.
   * Frontend write paths must never send these keys, even if the in-memory event
   * instance has them hydrated for download/reparse UX.
   */
  private stripServerOwnedEventFileMetadata(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const sanitizedPayload = { ...payload };
    delete sanitizedPayload.originalFile;
    delete sanitizedPayload.originalFiles;
    return sanitizedPayload;
  }

  /**
   * Activity identity fields are backend-owned denormalization fields.
   * Frontend update payloads must never modify these values.
   */
  private stripImmutableActivityIdentityFields(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const sanitizedPayload = { ...payload };
    delete sanitizedPayload.eventID;
    delete sanitizedPayload.userID;
    delete sanitizedPayload.eventStartDate;
    delete sanitizedPayload.sourceActivityKey;
    return sanitizedPayload;
  }

  private buildEventFromSnapshot(eventSnapshot: any, eventID: string): AppEventInterface | null {
    if (!eventSnapshot) return null;
    const { sanitizedJson } = EventJSONSanitizer.sanitize(eventSnapshot);
    const event = EventImporterJSON.getEventFromJSON(<EventJSONInterface>sanitizedJson).setID(eventID) as AppEventInterface;

    // Hydrate with original file(s) info if present
    const rawData = eventSnapshot as any;

    if (rawData.originalFiles) {
      event.originalFiles = rawData.originalFiles.map((file: any) => {
        if (file.startDate) {
          // Convert Firestore Timestamp to Date
          if (file.startDate.toDate && typeof file.startDate.toDate === 'function') {
            file.startDate = file.startDate.toDate();
          } else if (file.startDate.seconds !== undefined) {
            file.startDate = new Date(file.startDate.seconds * 1000 + (file.startDate.nanoseconds || 0) / 1000000);
          } else if (typeof file.startDate === 'string') {
            file.startDate = new Date(file.startDate);
          }
        } else {
          throw new Error('Event Metadata Error: Missing startDate for file ' + file.path);
        }
        return file;
      });
    }
    if (rawData.originalFile) {
      event.originalFile = rawData.originalFile;
    }

    this.benchmarkAdapter.applyBenchmarkFieldsFromFirestore(event, rawData);

    return event;
  }

  private cloneEventWithActivities(event: AppEventInterface, activities: ActivityInterface[]): AppEventInterface {
    const eventAny = event as any;
    let clonedEvent: AppEventInterface;

    if (typeof eventAny.toJSON === 'function') {
      clonedEvent = EventImporterJSON.getEventFromJSON(event.toJSON() as EventJSONInterface)
        .setID(event.getID()) as AppEventInterface;
    } else {
      const clonedFallbackEvent = Object.assign(
        Object.create(Object.getPrototypeOf(eventAny) || Object.prototype),
        eventAny,
      ) as AppEventInterface;
      clonedEvent = clonedFallbackEvent;
      if (typeof (clonedEvent as any).setID === 'function') {
        (clonedEvent as any).setID(event.getID());
      }
    }

    // Preserve original source file metadata on cloned instances.
    if (event.originalFiles) {
      clonedEvent.originalFiles = [...event.originalFiles];
    }
    if (event.originalFile) {
      clonedEvent.originalFile = event.originalFile;
    }

    // Preserve benchmark fields needed by event details UI.
    if ((event as any).benchmarkResults) {
      (clonedEvent as any).benchmarkResults = { ...(event as any).benchmarkResults };
    }
    if ((event as any).benchmarkResult) {
      (clonedEvent as any).benchmarkResult = { ...(event as any).benchmarkResult };
    }

    if (typeof (clonedEvent as any).clearActivities === 'function' && typeof (clonedEvent as any).addActivities === 'function') {
      clonedEvent.clearActivities();
      clonedEvent.addActivities(activities);
    } else {
      (clonedEvent as any).activities = [...activities];
      if (typeof (clonedEvent as any).getActivities !== 'function') {
        (clonedEvent as any).getActivities = () => (clonedEvent as any).activities;
      }
    }
    return clonedEvent;
  }

  private buildEventDetailsFingerprint(event: AppEventInterface | null): string {
    if (!event) {
      return 'null';
    }

    const eventAny = event as any;
    const eventSnapshot = typeof eventAny?.toJSON === 'function' ? eventAny.toJSON() : eventAny;
    const activitySnapshots = (event.getActivities() || []).map((activity) => {
      const activityAny = activity as any;
      if (typeof activityAny?.toJSON === 'function') {
        return activityAny.toJSON();
      }
      return {
        id: typeof activityAny?.getID === 'function' ? activityAny.getID() : null,
        ...activityAny,
      };
    });

    return this.buildSnapshotFingerprint({
      eventID: typeof eventAny?.getID === 'function' ? eventAny.getID() : null,
      event: eventSnapshot,
      activities: activitySnapshots,
    });
  }

  private parseActivitiesFromSnapshots(eventID: string, activitySnapshots: any[]): ActivityInterface[] {
    return (activitySnapshots || []).reduce((activitiesArray: ActivityInterface[], activitySnapshot: any) => {
      try {
        // Ensure required properties exist for sports-lib 6.x compatibility
        const safeActivityData = {
          ...activitySnapshot,
          stats: activitySnapshot.stats || {},
          laps: activitySnapshot.laps || [],
          streams: activitySnapshot.streams || [],
          intensityZones: activitySnapshot.intensityZones || [],
          events: activitySnapshot.events || []
        };
        const { sanitizedJson, unknownTypes, issues } = EventJSONSanitizer.sanitize(safeActivityData);
        if (unknownTypes.length > 0) {
          const newUnknownTypes = unknownTypes.filter(type => AppEventService.shouldReportKey(
            AppEventService.reportedUnknownTypes,
            type,
            AppEventService.DEDUPE_TTL_MS,
            AppEventService.DEDUPE_UNKNOWN_TYPES_MAX
          ));
          if (newUnknownTypes.length > 0) {
            this.logger.captureMessage('Unknown Data Types in getActivities', { extra: { types: newUnknownTypes, eventID, activityID: activitySnapshot.id } });
          }
        }
        const actionableIssues = (issues || []).filter(issue => issue.kind !== 'unknown_data_type');
        if (actionableIssues.length > 0) {
          const newIssues = actionableIssues.filter(issue => {
            const issueKey = AppEventService.getSanitizerIssueKey(activitySnapshot.id, issue);
            return AppEventService.shouldReportKey(
              AppEventService.reportedSanitizerIssues,
              issueKey,
              AppEventService.DEDUPE_TTL_MS,
              AppEventService.DEDUPE_SANITIZER_ISSUES_MAX
            );
          });

          if (newIssues.length > 0) {
            const issueSummary = AppEventService.summarizeIssues(newIssues);
            const cappedIssues = newIssues.slice(0, AppEventService.MAX_ISSUES_PER_REPORT);
            const issuesTruncated = Math.max(0, newIssues.length - cappedIssues.length);
            this.logger.warn('[AppEventService] Sanitized malformed activity data', {
              eventID,
              activityID: activitySnapshot.id,
              issueCount: newIssues.length,
              issueSummary,
              issuesTruncated,
              issues: cappedIssues
            });

            const sentryEventKey = `${eventID}|${activitySnapshot.id}|${Object.keys(issueSummary).sort().join(',')}`;
            const shouldReportSanitizerEvent = AppEventService.shouldReportKey(
              AppEventService.reportedSanitizerEvents,
              sentryEventKey,
              AppEventService.SANITIZER_EVENT_TTL_MS,
              AppEventService.DEDUPE_SANITIZER_EVENTS_MAX
            );

            if (shouldReportSanitizerEvent) {
              this.logger.captureException(new Error('Sanitized malformed activity data in getActivities'), {
                fingerprint: AppEventService.buildSanitizerFingerprint(eventID, activitySnapshot.id, newIssues),
                extra: {
                  eventID,
                  activityID: activitySnapshot.id,
                  issueCount: newIssues.length,
                  issueSummary,
                  issuesTruncated,
                  issues: cappedIssues
                }
              });
            }
          }
        }
        activitiesArray.push(EventImporterJSON.getActivityFromJSON(<ActivityJSONInterface>sanitizedJson).setID(activitySnapshot.id));
      } catch (e) {
        this.logger.error('Failed to parse activity:', activitySnapshot.id, 'Error:', e);
      }
      return activitiesArray;
    }, []);
  }

  private getActivitiesForEventDetailsLive(user: User, eventID: string): Observable<ActivityInterface[]> {
    this.logger.log('[AppEventService] getActivitiesForEventDetailsLive subscribed', { userID: user.uid, eventID });
    const activitiesCollection = collection(this.firestore, 'users', user.uid, 'activities');
    const q = query(activitiesCollection, where('eventID', '==', eventID));
    return (collectionData(q, { idField: 'id' }) as Observable<any[]>).pipe(
      distinctUntilChanged((previousSnapshots, currentSnapshots) =>
        this.buildSnapshotFingerprint(previousSnapshots) === this.buildSnapshotFingerprint(currentSnapshots)
      ),
      map((activitySnapshots: any[]) => {
        this.logger.log('[AppEventService] getActivitiesForEventDetailsLive Firestore emission', {
          eventID,
          snapshotCount: activitySnapshots?.length || 0,
        });
        return this.parseActivitiesFromSnapshots(eventID, activitySnapshots);
      }),
      tap((activities) => {
        this.logger.log('[AppEventService] getActivitiesForEventDetailsLive parsed activities', {
          eventID,
          activityCount: activities?.length || 0,
          activityIDs: this.getActivityIDsForDebug(activities),
        });
      }),
    );
  }

  public getEventAndActivities(user: User, eventID: string): Observable<AppEventInterface> {
    this.logger.log('[AppEventService] getEventAndActivities subscribed', { userID: user.uid, eventID });
    // See
    // https://stackoverflow.com/questions/42939978/avoiding-nested-subscribes-with-combine-latest-when-one-observable-depends-on-th
    const eventDoc = doc(this.firestore, 'users', user.uid, 'events', eventID);
    return combineLatest([
      docData(eventDoc).pipe(
        map(eventSnapshot => this.buildEventFromSnapshot(eventSnapshot, eventID))),
      this.getActivities(user, eventID),
    ]).pipe(
      distinctUntilChanged((prev, curr) => {
        const prevEvent = prev[0];
        const prevActivities = prev[1];
        const currEvent = curr[0];
        const currActivities = curr[1];

        // Check Event ID Equality
        if (prevEvent?.getID() !== currEvent?.getID()) {
          return false;
        }

        // Check Activities Length Equality
        if (prevActivities?.length !== currActivities?.length) {
          return false;
        }

        // Check Activities IDs Equality
        // We assume order is consistent (which it generally is for combineLatest emitting same array ref or Firestore query)
        // A safer bet is to check every ID.
        if (prevActivities && currActivities) {
          for (let i = 0; i < prevActivities.length; i++) {
            if (prevActivities[i].getID() !== currActivities[i].getID()) {
              return false;
            }
          }
        }
        return true;
      }),
      catchError((error) => {
        if (error && error.code && error.code === 'permission-denied') {
          return of([null, null] as [AppEventInterface | null, ActivityInterface[] | null]);
        }
        this.logger.error('Error fetching event or activities:', error);

        return of([null, null] as [AppEventInterface | null, ActivityInterface[] | null]); // @todo fix this
      })).pipe(map(([event, activities]: [AppEventInterface, ActivityInterface[]]) => {
        if (!event) {
          this.logger.log('[AppEventService] getEventAndActivities emission with null event', { eventID });
          return null;
        }
        const emittedEvent = this.cloneEventWithActivities(event, activities);
        this.logger.log('[AppEventService] getEventAndActivities combined emission', {
          eventID: emittedEvent.getID(),
          activityCount: activities?.length || 0,
          activityIDs: this.getActivityIDsForDebug(activities),
        });
        return emittedEvent;
      })).pipe(catchError((error) => {
        // debugger;
        this.logger.error('Error adding activities to event:', error);

        return of(null); // @todo is this the best we can do?
      }))
  }

  /**
   * Event details specific live stream. Keeps dashboard/event-list listeners untouched.
   * Emits on event metadata changes and activity metadata changes.
   */
  public getEventDetailsLive(user: User, eventID: string): Observable<AppEventInterface | null> {
    this.logger.log('[AppEventService] getEventDetailsLive subscribed', { userID: user.uid, eventID });
    const eventDoc = doc(this.firestore, 'users', user.uid, 'events', eventID);
    return combineLatest([
      docData(eventDoc).pipe(
        distinctUntilChanged((previousSnapshot, currentSnapshot) =>
          this.buildSnapshotFingerprint(previousSnapshot) === this.buildSnapshotFingerprint(currentSnapshot)
        ),
        map((eventSnapshot) => {
          this.logger.log('[AppEventService] getEventDetailsLive event doc emission', {
            eventID,
            hasEventSnapshot: !!eventSnapshot,
          });
          return this.buildEventFromSnapshot(eventSnapshot, eventID);
        })
      ),
      this.getActivitiesForEventDetailsLive(user, eventID),
    ]).pipe(
      map(([event, activities]: [AppEventInterface, ActivityInterface[]]) => {
        if (!event) {
          this.logger.log('[AppEventService] getEventDetailsLive combined emission with null event', { eventID });
          return null;
        }
        const emittedEvent = this.cloneEventWithActivities(event, activities);
        this.logger.log('[AppEventService] getEventDetailsLive combined emission', {
          eventID: emittedEvent.getID(),
          activityCount: activities?.length || 0,
          activityIDs: this.getActivityIDsForDebug(activities),
        });
        return emittedEvent;
      }),
      distinctUntilChanged((previousEvent, currentEvent) =>
        this.buildEventDetailsFingerprint(previousEvent) === this.buildEventDetailsFingerprint(currentEvent)
      ),
      catchError((error) => {
        if (error?.code === 'permission-denied') {
          return of(null);
        }
        this.logger.error('Error fetching live event details:', error);
        return of(null);
      }),
    );
  }

  public getEventsBy(user: User, where: { fieldPath: string | any, opStr: any, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: EventInterface, endBefore?: EventInterface): Observable<EventInterface[]> {
    this.logger.log(`[AppEventService] getEventsBy called for user: ${user.uid}, where: ${JSON.stringify(where)}`);
    if (startAfter || endBefore) {
      return this.getEventsStartingAfterOrEndingBefore(user, false, where, orderBy, asc, limit, startAfter, endBefore);
    }
    return this._getEvents(user, where, orderBy, asc, limit);
  }

  public getEventsOnceBy(
    user: User,
    whereClauses: { fieldPath: string | any, opStr: any, value: any }[] = [],
    orderByField: string = 'startDate',
    asc: boolean = false,
    limitCount: number = 10,
    options: GetEventsOnceOptions = {}
  ): Observable<EventInterface[]> {
    return this.getEventsOnceByWithMeta(
      user,
      whereClauses,
      orderByField,
      asc,
      limitCount,
      options
    ).pipe(map(result => result.events));
  }

  public getEventsOnceByWithMeta(
    user: User,
    whereClauses: { fieldPath: string | any, opStr: any, value: any }[] = [],
    orderByField: string = 'startDate',
    asc: boolean = false,
    limitCount: number = 10,
    options: GetEventsOnceOptions = {}
  ): Observable<GetEventsOnceResult> {
    const q = this.getEventQueryForUser(user, whereClauses, orderByField, asc, limitCount);
    const queryStart = performance.now();
    const preferCache = options.preferCache === true;
    const warmServer = options.warmServer === true;
    const seedLiveQuery = options.seedLiveQuery === true;
    const queryKey = this.buildEventQueryKey(user.uid, whereClauses, orderByField, asc, limitCount);
    const queryKeyDigest = this.buildQueryKeyDigest(queryKey);

    this.logger.log('[perf] app_event_service_get_events_once_query', {
      userID: user.uid,
      preferCache,
      warmServer,
      seedLiveQuery,
      whereClauses: whereClauses.length,
      queryKeyDigest,
    });

    if (!preferCache) {
      return from(this.fetchEventsOnceFromServer(q, user.uid, queryStart, queryKey, seedLiveQuery));
    }

    return from(this.fetchEventsOnceCacheFirst(q, user.uid, queryStart, warmServer, queryKey, seedLiveQuery));
  }

  /**
   * @Deprecated
   * @param user
   * @param where
   * @param orderBy
   * @param asc
   * @param limit
   * @param startAfter
   * @param endBefore
   */
  public getEventsAndActivitiesBy(user: User, where: { fieldPath: string | any, opStr: any, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: EventInterface, endBefore?: EventInterface): Observable<EventInterface[]> {
    if (startAfter || endBefore) {
      return this.getEventsStartingAfterOrEndingBefore(user, true, where, orderBy, asc, limit, startAfter, endBefore);
    }
    return this._getEventsAndActivities(user, where, orderBy, asc, limit);
  }

  /**
   * Gets the event, activities and some streams depending on the types provided
   * @param user
   * @param eventID
   * @param streamTypes
   */
  public getEventActivitiesAndSomeStreams(user: User, eventID: string, streamTypes: string[]) {
    this.logger.log('[AppEventService] getEventActivitiesAndSomeStreams called', {
      userID: user.uid,
      eventID,
      streamTypes,
    });
    return this._getEventActivitiesAndAllOrSomeStreams(user, eventID, streamTypes);
  }

  /**
   * Get's the event, activities and all available streams
   * @param user
   * @param eventID
   */
  public getEventActivitiesAndAllStreams(user: User, eventID: string) {
    return this._getEventActivitiesAndAllOrSomeStreams(user, eventID);
  }

  public getActivities(user: User, eventID: string): Observable<ActivityInterface[]> {
    this.logger.log(`[AppEventService] getActivities called for event: ${eventID}`);
    const activitiesCollection = collection(this.firestore, 'users', user.uid, 'activities');
    const q = query(activitiesCollection, where('eventID', '==', eventID));
    return (collectionData(q, { idField: 'id' }) as Observable<any[]>).pipe(
      map((activitySnapshots: any[]) => {
        this.logger.log(`[AppEventService] getActivities emitted ${activitySnapshots?.length || 0} activity snapshots for event: ${eventID}`);
        return this.parseActivitiesFromSnapshots(eventID, activitySnapshots);
      }),
    )
  }

  /**
   * One-shot activities fetch for flows that do not require realtime updates.
   */
  public getActivitiesOnceByEvent(user: User, eventID: string): Observable<ActivityInterface[]> {
    return this.getActivitiesOnceByEventWithOptions(user, eventID);
  }

  public getActivitiesOnceByEventWithOptions(
    user: User,
    eventID: string,
    options: GetEventsOnceOptions = {},
  ): Observable<ActivityInterface[]> {
    this.logger.log(`[AppEventService] getActivitiesOnceByEvent called for event: ${eventID}`);
    const activitiesCollection = collection(this.firestore, 'users', user.uid, 'activities');
    const q = query(activitiesCollection, where('eventID', '==', eventID));
    const queryStart = performance.now();
    const preferCache = options.preferCache === true;
    const warmServer = options.warmServer === true;

    if (!preferCache) {
      return from(this.fetchActivitiesOnceFromServer(q, user.uid, eventID, queryStart));
    }

    return from(this.fetchActivitiesOnceCacheFirst(q, user.uid, eventID, queryStart, warmServer));
  }

  /**
   * One-shot event fetch by explicit event IDs for compact result surfaces such as AI Insights.
   * Preserves the input ID ordering and does not fetch activities.
   */
  public getEventsOnceByIds(user: User, eventIDs: string[]): Observable<AppEventInterface[]> {
    const normalizedEventIDs = Array.from(new Set(
      (eventIDs || []).map(eventID => `${eventID || ''}`.trim()).filter(Boolean)
    ));

    if (!normalizedEventIDs.length) {
      return of([]);
    }

    this.logger.log('[AppEventService] getEventsOnceByIds called', {
      userID: user.uid,
      eventIDs: normalizedEventIDs,
      requestedCount: normalizedEventIDs.length,
      queryChunkCount: Math.ceil(normalizedEventIDs.length / AppEventService.FIRESTORE_IN_QUERY_MAX_IDS),
    });

    const eventsCollection = collection(this.firestore, 'users', user.uid, 'events');
    const eventIDChunks = this.chunkValues(
      normalizedEventIDs,
      AppEventService.FIRESTORE_IN_QUERY_MAX_IDS,
    );

    return from(Promise.all(eventIDChunks.map(async (eventIDChunk) => {
      try {
        const chunkQuery = query(eventsCollection, where(documentId(), 'in', eventIDChunk));
        const querySnapshot = await getDocs(chunkQuery);
        return querySnapshot.docs
          .map((snapshot) => this.buildEventFromSnapshot(snapshot.data(), snapshot.id))
          .filter((event): event is AppEventInterface => !!event);
      } catch (error) {
        this.logger.error('[AppEventService] Failed to fetch events by chunked IDs.', {
          userID: user.uid,
          eventIDs: eventIDChunk,
          error,
        });
        return [];
      }
    }))).pipe(
      map((chunkEvents) => {
        const eventsByID = new Map<string, AppEventInterface>();
        for (const event of chunkEvents.flat()) {
          const eventID = event.getID();
          if (eventID && !eventsByID.has(eventID)) {
            eventsByID.set(eventID, event);
          }
        }

        return normalizedEventIDs
          .map((eventID) => eventsByID.get(eventID))
          .filter((event): event is AppEventInterface => !!event);
      }),
    );
  }

  public getEventMetaData(user: User, eventID: string, serviceName: ServiceNames): Observable<EventMetaDataInterface> {
    const metaDataDoc = doc(this.firestore, 'users', user.uid, 'events', eventID, 'metaData', serviceName);
    return docData(metaDataDoc).pipe(
      map(metaDataSnapshot => {
        return <EventMetaDataInterface>metaDataSnapshot;
      }),
    )
  }

  public getEventMetaDataKeys(user: User, eventID: string): Observable<string[]> {
    const metaDataCollection = collection(this.firestore, 'users', user.uid, 'events', eventID, 'metaData');
    return from(getDocs(metaDataCollection)).pipe(
      map((querySnapshot) => querySnapshot.docs.map(doc => doc.id))
    );
  }

  public async updateActivityProperties(user: User, activityID: string, propertiesToUpdate: any) {
    let sanitizedProperties = propertiesToUpdate;
    if (propertiesToUpdate && typeof propertiesToUpdate === 'object' && !Array.isArray(propertiesToUpdate)) {
      sanitizedProperties = this.stripImmutableActivityIdentityFields(
        sanitizeActivityFirestoreWritePayload(propertiesToUpdate as Record<string, unknown>)
      );
    }

    return updateDoc(doc(this.firestore, 'users', user.uid, 'activities', activityID), sanitizedProperties);
  }

  /**
   * Atomic patch update for activity + parent event edit flows.
   * Both patch payloads are sanitized at the write boundary.
   */
  public async updateActivityAndEventProperties(
    user: User,
    eventID: string,
    activityID: string,
    activityPatch: any,
    eventPatch: any,
  ): Promise<void> {
    let sanitizedActivityPatch = activityPatch;
    if (activityPatch && typeof activityPatch === 'object' && !Array.isArray(activityPatch)) {
      sanitizedActivityPatch = this.stripImmutableActivityIdentityFields(
        sanitizeActivityFirestoreWritePayload(activityPatch as Record<string, unknown>)
      );
    }

    let sanitizedEventPatch = eventPatch;
    if (eventPatch && typeof eventPatch === 'object' && !Array.isArray(eventPatch)) {
      sanitizedEventPatch = this.stripServerOwnedEventFileMetadata(
        sanitizeEventFirestoreWritePayload(eventPatch as Record<string, unknown>)
      );
    }

    const activityPatchIsObject = !!sanitizedActivityPatch && typeof sanitizedActivityPatch === 'object' && !Array.isArray(sanitizedActivityPatch);
    const eventPatchIsObject = !!sanitizedEventPatch && typeof sanitizedEventPatch === 'object' && !Array.isArray(sanitizedEventPatch);
    const hasActivityPatch = activityPatchIsObject && Object.keys(sanitizedActivityPatch as Record<string, unknown>).length > 0;
    const hasEventPatch = eventPatchIsObject && Object.keys(sanitizedEventPatch as Record<string, unknown>).length > 0;

    if (!hasActivityPatch && !hasEventPatch) {
      return;
    }

    const batch = writeBatch(this.firestore);
    if (hasActivityPatch) {
      const activityRef = doc(this.firestore, 'users', user.uid, 'activities', activityID);
      batch.update(activityRef, sanitizedActivityPatch);
    }
    if (hasEventPatch) {
      const eventRef = doc(this.firestore, 'users', user.uid, 'events', eventID);
      batch.update(eventRef, sanitizedEventPatch);
    }
    await batch.commit();
  }

  public async updateEventProperties(user: User, eventID: string, propertiesToUpdate: any) {
    // @todo check if properties are allowed on object via it's JSON export interface keys
    // Mandatory shared write policy: sanitize ad-hoc event patch payloads before updateDoc.
    let sanitizedProperties = propertiesToUpdate;
    if (propertiesToUpdate && typeof propertiesToUpdate === 'object' && !Array.isArray(propertiesToUpdate)) {
      sanitizedProperties = this.stripServerOwnedEventFileMetadata(
        sanitizeEventFirestoreWritePayload(propertiesToUpdate as Record<string, unknown>)
      );
    }

    return updateDoc(doc(this.firestore, 'users', user.uid, 'events', eventID), sanitizedProperties);
  }

  /**
   * Deletes an event document from Firestore.
   * 
   * Note: Storage cleanup (original files) and linked activity deletion
   * are handled by the `cleanupEventFile` Cloud Function which triggers
   * on document deletion. See: functions/src/events/cleanup.ts
   */
  public async deleteAllEventData(user: User, eventID: string): Promise<boolean> {
    await deleteDoc(doc(this.firestore, 'users', user.uid, 'events', eventID));
    return true;
  }

  public async getEventAsGPXBloB(user: User, event: AppEventInterface): Promise<Blob> {
    const populatedEvent = await this.attachStreamsToEventWithActivities(user, event, undefined, false, true).pipe(take(1)).toPromise();
    const gpxString = await new EventExporterGPX().getAsString(populatedEvent);
    return (new Blob(
      [gpxString],
      { type: new EventExporterGPX().fileType },
    ));
  }

  public ngOnDestroy() {
    this.clearEventQuerySeeds();
  }

  /**
   * Requires an event with activities
   * @todo this should be internal
   * @param user
   * @param event
   * @param streamTypes
   * @param merge
   * @param skipEnrichment
   * @param hydrationMode `replace_activities` is intended for regeneration callers only.
   * @private
   */
  public attachStreamsToEventWithActivities(
    user: User,
    event: AppEventInterface,
    streamTypes?: string[],
    merge: boolean = true,
    skipEnrichment: boolean = false,
    hydrationMode: StreamHydrationMode = 'attach_streams_only',
    downloadFileOptions?: DownloadFileOptions,
  ): Observable<EventInterface> {
    this.logger.log(`[AppEventService] attachStreams for ${event.getID()}. originalFile: ${!!event.originalFile}, originalFiles: ${!!event.originalFiles}`);
    const hasOriginalFiles = (event.originalFiles && event.originalFiles.length > 0)
      || (event.originalFile && event.originalFile.path);

    if (!hasOriginalFiles) {
      this.logger.error('[AppEventService] Failed to hydrate event due to missing original source file metadata', {
        eventID: event.getID(),
      });
      return throwError(() => new Error('No original source file metadata found for event hydration.'));
    }

    const parseOptions = {
      skipEnrichment,
      strictAllFilesRequired: true,
      preserveActivityIdsFromEvent: true,
      mergeMultipleFiles: true,
      ...(streamTypes && streamTypes.length > 0 ? { streamTypes } : {}),
    };

    const parseOptionsWithDownload = downloadFileOptions?.metadataCacheTtlMs === undefined
      ? parseOptions
      : {
        ...parseOptions,
        metadataCacheTtlMs: downloadFileOptions.metadataCacheTtlMs,
      };

    return from(this.originalFileHydrationService.parseEventFromOriginalFiles(event, parseOptionsWithDownload)).pipe(
      map((parseResult) => {
        const fullEvent = parseResult.finalEvent;
        if (!fullEvent) {
          throw new Error('Could not build event from original source files');
        }

        if (merge === false) {
          fullEvent.setID(event.getID());
          return fullEvent;
        }

        // Regeneration mode: replace activity objects with parsed ones from source files.
        if (hydrationMode === 'replace_activities') {
          event.clearActivities();
          event.addActivities(fullEvent.getActivities());
          return event;
        }

        this.attachParsedStreamsToExistingActivities(event, fullEvent, streamTypes);
        return event;
      }),
      catchError((error) => {
        this.logger.error('[AppEventService] Failed to hydrate streams from original files', {
          eventID: event.getID(),
          hydrationMode,
          error,
        });
        return throwError(() => error);
      }),
    );
  }

  private attachParsedStreamsToExistingActivities(
    event: AppEventInterface,
    parsedEvent: EventInterface,
    streamTypes?: string[],
  ): void {
    const existingActivities = event.getActivities() || [];
    const parsedActivities = parsedEvent.getActivities() || [];
    const parsedActivitiesByID = new Map<string, ActivityInterface>();
    const duplicateParsedIDs = new Set<string>();
    let parsedActivitiesMissingID = 0;

    parsedActivities.forEach((parsedActivity) => {
      const parsedActivityID = parsedActivity.getID();
      if (!parsedActivityID) {
        parsedActivitiesMissingID += 1;
        return;
      }
      if (parsedActivitiesByID.has(parsedActivityID)) {
        duplicateParsedIDs.add(parsedActivityID);
      }
      parsedActivitiesByID.set(parsedActivityID, parsedActivity);
    });

    const unmatchedExistingActivityIDs: string[] = [];
    let attachedCount = 0;
    existingActivities.forEach((existingActivity) => {
      const existingActivityID = existingActivity.getID();
      if (!existingActivityID) {
        unmatchedExistingActivityIDs.push('(missing-id)');
        return;
      }
      const parsedActivity = parsedActivitiesByID.get(existingActivityID);
      if (!parsedActivity) {
        unmatchedExistingActivityIDs.push(existingActivityID);
        return;
      }

      const parsedStreams = parsedActivity.getAllStreams();
      existingActivity.clearStreams();
      existingActivity.addStreams(parsedStreams);
      parsedActivitiesByID.delete(existingActivityID);
      attachedCount += 1;
    });

    const unmatchedParsedActivityIDs = Array.from(parsedActivitiesByID.keys());
    if (
      unmatchedExistingActivityIDs.length > 0
      || unmatchedParsedActivityIDs.length > 0
      || parsedActivitiesMissingID > 0
      || duplicateParsedIDs.size > 0
    ) {
      this.logger.warn('[AppEventService] Stream-only hydration attached matched activity IDs only', {
        eventID: event.getID(),
        attachedCount,
        existingActivitiesCount: existingActivities.length,
        parsedActivitiesCount: parsedActivities.length,
        unmatchedExistingActivityIDs,
        unmatchedParsedActivityIDs,
        parsedActivitiesMissingID,
        duplicateParsedActivityIDs: Array.from(duplicateParsedIDs),
      });
    }
  }

  private async calculateStreamsFromWithOrchestration(event: AppEventInterface, skipEnrichment: boolean = false): Promise<EventInterface> {
    this.logger.log('Calculating streams orchestration for event', event.getID());

    // 1. Array Strategy
    if (event.originalFiles && event.originalFiles.length > 0) {
      this.logger.log(`Orchestrating fetch and merge for ${event.originalFiles.length} files`);
      const promises = event.originalFiles.map(fileMeta => this.fetchAndParseOneFile(fileMeta, skipEnrichment));
      const parsedEvents = await Promise.all(promises);

      // remove nulls if any failure
      const validEvents = parsedEvents.filter(e => !!e);
      if (validEvents.length === 0) return null;

      const finalEvent = validEvents.length === 1 ? validEvents[0] : EventUtilities.mergeEvents(validEvents);

      // Basic transfer of IDs from Firestore activities to re-parsed activities
      const existingActivities = event.getActivities();
      finalEvent.getActivities().forEach((activity, index) => {
        if (existingActivities[index]) {
          activity.setID(existingActivities[index].getID());
          this.applyUserActivityOverrides(existingActivities[index], activity);
        }
      });

      return finalEvent;
    }

    // 2. Legacy Single Strategy
    const originalFile = event.originalFile;
    if (!originalFile || !originalFile.path) {
      this.logger.warn('Original file path missing', originalFile);
      return null;
    }
    const res = await this.fetchAndParseOneFile(originalFile, skipEnrichment);
    if (res && res.getActivities().length > 0) {
      const existingActivities = event.getActivities();
      res.getActivities().forEach((activity, index) => {
        if (existingActivities[index]) {
          activity.setID(existingActivities[index].getID());
          this.applyUserActivityOverrides(existingActivities[index], activity);
        }
      });
    }
    return res;
  }

  /**
   * Preserve user-edited fields from Firestore activity docs when source-file parsing rebuilds activities.
   * Currently used for device rename persistence across reload.
   */
  private applyUserActivityOverrides(existingActivity: ActivityInterface, parsedActivity: ActivityInterface): void {
    if (!existingActivity || !parsedActivity) return;

    const existingCreatorName = `${existingActivity.creator?.name ?? ''}`.trim();
    if (existingCreatorName && parsedActivity.creator) {
      parsedActivity.creator.name = existingCreatorName;
    }
  }

  private cacheService = inject(AppCacheService);

  // ... (imports)

  public async downloadFile(path: string, options?: DownloadFileOptions): Promise<ArrayBuffer> {
    if (options === undefined) {
      return this.originalFileHydrationService.downloadFile(path);
    }
    return this.originalFileHydrationService.downloadFile(path, options);
  }

  private async decompressIfNeeded(buffer: ArrayBuffer, path: string): Promise<ArrayBuffer> {
    // Deprecated in favor of fileService.decompressIfNeeded, but kept for internal service stability if any call remains
    return this.fileService.decompressIfNeeded(buffer, path);
  }

  private async fetchAndParseOneFile(fileMeta: { path: string, bucket?: string }, skipEnrichment: boolean = false): Promise<EventInterface> {
    try {
      const arrayBuffer = await this.downloadFile(fileMeta.path);

      const parts = fileMeta.path.split('.');
      let extension = parts.pop()?.toLowerCase();
      if (extension === 'gz') {
        extension = parts.pop()?.toLowerCase();
      }

      let newEvent: EventInterface;

      const options = createParsingOptions();

      if (extension === 'fit') {
        newEvent = await EventImporterFIT.getFromArrayBuffer(arrayBuffer, options);
      } else if (extension === 'gpx') {
        const text = new TextDecoder().decode(arrayBuffer);
        newEvent = await EventImporterGPX.getFromString(text, null, options);
      } else if (extension === 'tcx') {
        const text = new TextDecoder().decode(arrayBuffer);
        newEvent = await EventImporterTCX.getFromXML((new DOMParser()).parseFromString(text, 'application/xml'), options);
      } else if (extension === 'json') {
        const text = new TextDecoder().decode(arrayBuffer);
        const json = JSON.parse(text);
        const { sanitizedJson } = EventJSONSanitizer.sanitize(json);
        newEvent = await EventImporterSuuntoJSON.getFromJSONString(JSON.stringify(sanitizedJson));
      } else if (extension === 'sml') {
        const text = new TextDecoder().decode(arrayBuffer);
        newEvent = await EventImporterSuuntoSML.getFromXML(text);
      } else {
        throw new Error(`Unsupported original file extension: ${extension}`);
      }

      // Polyfill Time stream if missing
      if (newEvent) {
        if (!skipEnrichment) {
          newEvent.getActivities().forEach(activity => {
            try {
              this.appEventUtilities.enrich(activity, ['Time', 'Duration']);
            } catch (e) {
              // Ignore duplicate stream errors as it means the stream already exists (possibly due to caching)
              if (e.message && e.message.indexOf('Duplicate type of stream') > -1) {
                this.logger.warn('Duplicate stream warning during enrichment:', e);
              } else {
                throw e;
              }
            }
          });
        }
      }
      return newEvent;
    } catch (e) {
      this.logger.error('Error in fetchAndParseOneFile', e);
      // throw e; // Don't throw to allow partial success in array? 
      // Actually if one fails in array, what do we do? 
      // For now, let's return null and filter it out, logging error
      return null;
    }
  }

  private _getEventActivitiesAndAllOrSomeStreams(user: User, eventID, streamTypes?: string[]) {
    this.logger.log('[AppEventService] _getEventActivitiesAndAllOrSomeStreams started', {
      userID: user.uid,
      eventID,
      streamTypes: streamTypes || 'all',
    });
    return this.getEventAndActivities(user, eventID).pipe(switchMap((event) => { // Not sure about switch or merge
      if (!event) {
        this.logger.log('[AppEventService] _getEventActivitiesAndAllOrSomeStreams received null event', { eventID });
        return of(null);
      }
      this.logger.log('[AppEventService] _getEventActivitiesAndAllOrSomeStreams attaching streams', {
        eventID: event.getID(),
        activityCount: event.getActivities()?.length || 0,
        streamTypes: streamTypes || 'all',
      });
      // Get all the streams for all activities and subscribe to them with latest emition for all streams
      return this.attachStreamsToEventWithActivities(user, event, streamTypes)
    }), tap((resultEvent) => {
      this.logger.log('[AppEventService] _getEventActivitiesAndAllOrSomeStreams emission', {
        eventID: resultEvent?.getID?.() ?? null,
        activityCount: resultEvent?.getActivities?.()?.length || 0,
      });
    }))
  }

  private getEventsStartingAfterOrEndingBefore(user: User, getActivities: boolean, whereClauses: { fieldPath: string | any, opStr: any, value: any }[] = [], orderByField: string = 'startDate', asc: boolean = false, limitCount: number = 10, startAfterDoc: EventInterface, endBeforeDoc?: EventInterface): Observable<EventInterface[]> {
    const observables: Observable<DocumentSnapshot>[] = [];
    if (startAfterDoc) {
      observables.push(
        from(getDoc(doc(this.firestore, 'users', user.uid, 'events', startAfterDoc.getID())))
      )
    }
    if (endBeforeDoc) {
      observables.push(
        from(getDoc(doc(this.firestore, 'users', user.uid, 'events', endBeforeDoc.getID())))
      )
    }
    return zip(...observables).pipe(switchMap(([resultA, resultB]) => {
      // resultA is startAfter snapshot, resultB is endBefore snapshot (if both exist) or resultA if only one exists
      // Wait, zip emits inputs in order.
      const startAfterSnap = startAfterDoc ? resultA : null;
      const endBeforeSnap = endBeforeDoc ? (startAfterDoc ? resultB : resultA) : null;

      if (startAfterDoc && endBeforeDoc) {
        return getActivities ? this._getEventsAndActivities(user, whereClauses, orderByField, asc, limitCount, startAfterSnap, endBeforeSnap) : this._getEvents(user, whereClauses, orderByField, asc, limitCount, startAfterSnap, endBeforeSnap);
      }
      // If only start after
      if (startAfterDoc) {
        return getActivities ? this._getEventsAndActivities(user, whereClauses, orderByField, asc, limitCount, startAfterSnap) : this._getEvents(user, whereClauses, orderByField, asc, limitCount, startAfterSnap);
      }
      // If only endAt
      return getActivities ? this._getEventsAndActivities(user, whereClauses, orderByField, asc, limitCount, null, endBeforeSnap) : this._getEvents(user, whereClauses, orderByField, asc, limitCount, null, endBeforeSnap);
    }));
  }

  private _getEvents(user: User, whereClauses: { fieldPath: string | any, opStr: any, value: any }[] = [], orderByField: string = 'startDate', asc: boolean = false, limitCount: number = 10, startAfterDoc?: any, endBeforeDoc?: any): Observable<EventInterface[]> {
    this.logger.log('[AppEventService] _getEvents fetching. user:', user.uid, 'where:', JSON.stringify(whereClauses));
    const q = this.getEventQueryForUser(user, whereClauses, orderByField, asc, limitCount, startAfterDoc, endBeforeDoc) as Query<DocumentData>;
    const queryStart = performance.now();
    const queryKey = (!startAfterDoc && !endBeforeDoc)
      ? this.buildEventQueryKey(user.uid, whereClauses, orderByField, asc, limitCount)
      : null;
    const queryKeyDigest = this.buildQueryKeyDigest(queryKey);
    this.logger.log('[perf] app_event_service_get_events_live_query', {
      userID: user.uid,
      whereClauses: whereClauses.length,
      orderByField,
      asc,
      limitCount,
      queryKeyDigest,
    });

    return this.listenToEventQueryData(q, user.uid, queryStart, queryKey).pipe(
      tap((events: AppEventInterface[]) => {
        this.logger.log(`[AppEventService] _getEvents emitted ${events?.length || 0} event snapshots for user: ${user.uid}`);
      })
    );
  }

  private listenToEventQueryData(
    q: Query<DocumentData>,
    userID: string,
    queryStart: number,
    queryKey: string | null,
  ): Observable<AppEventInterface[]> {
    return new Observable<AppEventInterface[]>((subscriber) => {
      let emissionCount = 0;
      let hasEmitted = false;
      const initialSeed = this.consumeEventQuerySeed(queryKey);
      const seedEventsById = initialSeed?.eventsById ?? new Map<string, AppEventInterface>();
      const seedFingerprintsById = initialSeed?.fingerprintsById ?? new Map<string, string>();
      const queryKeyDigest = this.buildQueryKeyDigest(queryKey);
      const eventsById = new Map<string, AppEventInterface>();
      let orderedIds: string[] = [];
      let seedMatchCount = 0;
      let seedMismatchCount = 0;
      let seedMissingCount = 0;

      this.logger.log('[perf] app_event_service_live_query_seed_context', {
        userID,
        queryKeyDigest,
        hasSeed: !!initialSeed,
        seedEventCount: seedEventsById.size,
        seedFingerprintCount: seedFingerprintsById.size,
      });

      const hydrateEventForDoc = (
        doc: QueryDocumentSnapshot<DocumentData>,
      ): { event: AppEventInterface; reusedSeed: boolean } => {
        const seedEvent = seedEventsById.get(doc.id);
        const docFingerprint = this.buildEventDocFingerprint(doc.id, doc.data());
        if (seedEvent && seedFingerprintsById.get(doc.id) === docFingerprint) {
          seedMatchCount += 1;
          return { event: seedEvent, reusedSeed: true };
        }
        if (seedEvent) {
          seedMismatchCount += 1;
        } else {
          seedMissingCount += 1;
        }
        return {
          event: this.deserializeEventFromDoc(doc, 'Unknown Data Types in _getEvents'),
          reusedSeed: false,
        };
      };

      const removeIdFromOrder = (id: string, expectedIndex?: number): void => {
        if (typeof expectedIndex === 'number' && expectedIndex >= 0 && orderedIds[expectedIndex] === id) {
          orderedIds.splice(expectedIndex, 1);
          return;
        }
        const index = orderedIds.indexOf(id);
        if (index >= 0) {
          orderedIds.splice(index, 1);
        }
      };

      const resyncOrderIfNeeded = (
        querySnapshot: QuerySnapshot<DocumentData>,
        updateCount: { changedDocs: number; reusedSeedDocs: number },
      ): void => {
        if (orderedIds.length === querySnapshot.size) {
          return;
        }
        orderedIds = querySnapshot.docs.map((doc) => doc.id);
        const nextIds = new Set(orderedIds);
        for (const id of eventsById.keys()) {
          if (!nextIds.has(id)) {
            eventsById.delete(id);
          }
        }
        for (const doc of querySnapshot.docs) {
          if (!eventsById.has(doc.id)) {
            const { event, reusedSeed } = hydrateEventForDoc(doc);
            eventsById.set(doc.id, event);
            if (reusedSeed) {
              updateCount.reusedSeedDocs += 1;
            } else {
              updateCount.changedDocs += 1;
            }
          }
        }
      };

      const unsubscribe = onSnapshot(
        q,
        { includeMetadataChanges: false },
        (querySnapshot: QuerySnapshot<DocumentData>) => {
          const docChanges = querySnapshot.docChanges({ includeMetadataChanges: false });

          // Ignore follow-up snapshots that have zero document changes.
          // These can occur during cache/server reconciliation and are duplicates for dashboard usage.
          if (hasEmitted && docChanges.length === 0) {
            this.logger.log('[perf] app_event_service_get_events_collection_emit_skipped', {
              durationMs: Number((performance.now() - queryStart).toFixed(2)),
              snapshots: querySnapshot?.size || 0,
              userID,
              reason: 'no_doc_changes',
              queryKeyDigest,
            });
            return;
          }

          hasEmitted = true;
          emissionCount += 1;
          this.logger.log('[perf] app_event_service_get_events_collection_emit', {
            durationMs: Number((performance.now() - queryStart).toFixed(2)),
            emissionCount,
            snapshots: querySnapshot?.size || 0,
            userID,
            queryKeyDigest,
          });

          const deserializeStart = performance.now();
          const updateCount = { changedDocs: 0, reusedSeedDocs: 0 };

          for (const change of docChanges) {
            const docId = change.doc.id;
            if (change.type === 'removed') {
              eventsById.delete(docId);
              removeIdFromOrder(docId, change.oldIndex);
              continue;
            }

            const { event, reusedSeed } = hydrateEventForDoc(change.doc);
            eventsById.set(docId, event);
            if (reusedSeed) {
              updateCount.reusedSeedDocs += 1;
            } else {
              updateCount.changedDocs += 1;
            }
            removeIdFromOrder(docId, change.oldIndex);
            const insertIndex = change.newIndex >= 0 ? change.newIndex : orderedIds.length;
            orderedIds.splice(insertIndex, 0, docId);
          }

          resyncOrderIfNeeded(querySnapshot, updateCount);

          const events = orderedIds
            .map((id) => eventsById.get(id))
            .filter((event): event is AppEventInterface => !!event);

          this.logger.log('[perf] app_event_service_get_events_deserialize', {
            durationMs: Number((performance.now() - deserializeStart).toFixed(2)),
            snapshots: querySnapshot?.size || 0,
            changedDocs: updateCount.changedDocs,
            reusedSeedDocs: updateCount.reusedSeedDocs,
            seedMatchDocs: seedMatchCount,
            seedMismatchDocs: seedMismatchCount,
            seedMissingDocs: seedMissingCount,
            seedEventCount: seedEventsById.size,
            queryKeyDigest,
            userID,
          });

          subscriber.next(events);
        },
        (error) => subscriber.error(error)
      );

      return { unsubscribe };
    });
  }

  private async fetchEventsOnceCacheFirst(
    q: any,
    userID: string,
    queryStart: number,
    warmServer: boolean,
    queryKey: string,
    seedLiveQuery: boolean,
  ): Promise<GetEventsOnceResult> {
    const cacheStart = performance.now();
    try {
      const cacheSnapshot = await getDocsFromCache(q);
      const cacheEvents = this.deserializeEventsFromQueryDocs(cacheSnapshot.docs, userID, 'app_event_service_get_events_once_cache_deserialize', cacheSnapshot.size);
      this.logger.info('[perf] app_event_service_get_events_once_cache_first_hit', {
        durationMs: Number((performance.now() - cacheStart).toFixed(2)),
        snapshots: cacheSnapshot?.size || 0,
        fromCache: cacheSnapshot?.metadata?.fromCache,
        hasPendingWrites: cacheSnapshot?.metadata?.hasPendingWrites,
        userID,
      });
      if ((cacheSnapshot?.size || 0) > 0) {
        if (seedLiveQuery) {
          this.storeEventQuerySeed(queryKey, cacheSnapshot.docs, cacheEvents);
        }
        if (warmServer) {
          this.warmEventsOnceServerQuery(q, userID);
        }
        return {
          events: cacheEvents,
          source: 'cache',
        };
      }
      this.logger.info('[perf] app_event_service_get_events_once_cache_first_fallback', {
        reason: 'empty_cache',
        userID,
      });
    } catch (error: any) {
      this.logger.warn('[perf] app_event_service_get_events_once_cache_first_failed', {
        durationMs: Number((performance.now() - cacheStart).toFixed(2)),
        userID,
        code: error?.code,
        message: error?.message,
      });
    }

    return this.fetchEventsOnceFromServer(q, userID, queryStart, queryKey, seedLiveQuery);
  }

  private async fetchEventsOnceFromServer(
    q: any,
    userID: string,
    queryStart: number,
    queryKey: string,
    seedLiveQuery: boolean,
  ): Promise<GetEventsOnceResult> {
    const querySnapshot = await getDocs(q);
    this.logger.info('[perf] app_event_service_get_events_once_get_docs', {
      durationMs: Number((performance.now() - queryStart).toFixed(2)),
      snapshots: querySnapshot?.size || 0,
      fromCache: querySnapshot?.metadata?.fromCache,
      hasPendingWrites: querySnapshot?.metadata?.hasPendingWrites,
      userID,
    });
    const events = this.deserializeEventsFromQueryDocs(querySnapshot.docs, userID, 'app_event_service_get_events_once_deserialize', querySnapshot.size);
    if (seedLiveQuery) {
      this.storeEventQuerySeed(queryKey, querySnapshot.docs, events);
    }
    return {
      events,
      source: 'server',
    };
  }

  private warmEventsOnceServerQuery(q: any, userID: string): void {
    const warmStart = performance.now();
    void getDocs(q).then((snapshot) => {
      this.logger.info('[perf] app_event_service_get_events_once_warm_server', {
        durationMs: Number((performance.now() - warmStart).toFixed(2)),
        snapshots: snapshot?.size || 0,
        fromCache: snapshot?.metadata?.fromCache,
        hasPendingWrites: snapshot?.metadata?.hasPendingWrites,
        userID,
      });
    }).catch((error: any) => {
      this.logger.warn('[perf] app_event_service_get_events_once_warm_server_failed', {
        durationMs: Number((performance.now() - warmStart).toFixed(2)),
        userID,
        code: error?.code,
        message: error?.message,
      });
    });
  }

  private async fetchActivitiesOnceCacheFirst(
    q: any,
    userID: string,
    eventID: string,
    queryStart: number,
    warmServer: boolean,
  ): Promise<ActivityInterface[]> {
    const cacheStart = performance.now();
    try {
      const cacheSnapshot = await getDocsFromCache(q);
      const cacheActivities = this.parseActivitiesFromQueryDocs(eventID, cacheSnapshot.docs);
      this.logger.info('[perf] app_event_service_get_activities_once_cache_first_hit', {
        durationMs: Number((performance.now() - cacheStart).toFixed(2)),
        snapshots: cacheSnapshot?.size || 0,
        fromCache: cacheSnapshot?.metadata?.fromCache,
        hasPendingWrites: cacheSnapshot?.metadata?.hasPendingWrites,
        userID,
        eventID,
      });
      if ((cacheSnapshot?.size || 0) > 0) {
        if (warmServer) {
          this.warmActivitiesOnceServerQuery(q, userID, eventID);
        }
        return cacheActivities;
      }
      this.logger.info('[perf] app_event_service_get_activities_once_cache_first_fallback', {
        reason: 'empty_cache',
        userID,
        eventID,
      });
    } catch (error: any) {
      this.logger.warn('[perf] app_event_service_get_activities_once_cache_first_failed', {
        durationMs: Number((performance.now() - cacheStart).toFixed(2)),
        userID,
        eventID,
        code: error?.code,
        message: error?.message,
      });
    }

    return this.fetchActivitiesOnceFromServer(q, userID, eventID, queryStart);
  }

  private async fetchActivitiesOnceFromServer(
    q: any,
    userID: string,
    eventID: string,
    queryStart: number,
  ): Promise<ActivityInterface[]> {
    const querySnapshot = await getDocs(q);
    this.logger.info('[perf] app_event_service_get_activities_once_get_docs', {
      durationMs: Number((performance.now() - queryStart).toFixed(2)),
      snapshots: querySnapshot?.size || 0,
      fromCache: querySnapshot?.metadata?.fromCache,
      hasPendingWrites: querySnapshot?.metadata?.hasPendingWrites,
      userID,
      eventID,
    });
    return this.parseActivitiesFromQueryDocs(eventID, querySnapshot.docs);
  }

  private warmActivitiesOnceServerQuery(q: any, userID: string, eventID: string): void {
    const warmStart = performance.now();
    void getDocs(q).then((snapshot) => {
      this.logger.info('[perf] app_event_service_get_activities_once_warm_server', {
        durationMs: Number((performance.now() - warmStart).toFixed(2)),
        snapshots: snapshot?.size || 0,
        fromCache: snapshot?.metadata?.fromCache,
        hasPendingWrites: snapshot?.metadata?.hasPendingWrites,
        userID,
        eventID,
      });
    }).catch((error: any) => {
      this.logger.warn('[perf] app_event_service_get_activities_once_warm_server_failed', {
        durationMs: Number((performance.now() - warmStart).toFixed(2)),
        userID,
        eventID,
        code: error?.code,
        message: error?.message,
      });
    });
  }

  private parseActivitiesFromQueryDocs(eventID: string, docs: QueryDocumentSnapshot[]): ActivityInterface[] {
    const activitySnapshots = docs.map((queryDocumentSnapshot) => ({
      ...(queryDocumentSnapshot.data() as Record<string, unknown>),
      id: queryDocumentSnapshot.id,
    }));
    return this.parseActivitiesFromSnapshots(eventID, activitySnapshots);
  }

  private deserializeEventFromDoc(
    queryDocumentSnapshot: QueryDocumentSnapshot,
    unknownTypesMessage: string
  ): AppEventInterface {
    const eventSnapshot = queryDocumentSnapshot.data();
    const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(eventSnapshot);
    if (unknownTypes.length > 0) {
      const newUnknownTypes = unknownTypes.filter(type => AppEventService.shouldReportKey(
        AppEventService.reportedUnknownTypes,
        type,
        AppEventService.DEDUPE_TTL_MS,
        AppEventService.DEDUPE_UNKNOWN_TYPES_MAX
      ));
      if (newUnknownTypes.length > 0) {
        this.logger.captureMessage(unknownTypesMessage, { extra: { types: newUnknownTypes, eventID: queryDocumentSnapshot.id } });
      }
    }
    const event = EventImporterJSON.getEventFromJSON(<EventJSONInterface>sanitizedJson).setID(queryDocumentSnapshot.id) as AppEventInterface;

    // Hydrate with original file(s) info if present
    const rawData = eventSnapshot as any;
    if (rawData.originalFiles) {
      event.originalFiles = rawData.originalFiles;
    }
    if (rawData.originalFile) {
      event.originalFile = rawData.originalFile;
    }

    this.benchmarkAdapter.applyBenchmarkFieldsFromFirestore(event, rawData);
    return event;
  }

  private deserializeEventsFromQueryDocs(
    docs: QueryDocumentSnapshot[],
    userID: string,
    perfEventName: string,
    snapshotsCount?: number
  ): AppEventInterface[] {
    const deserializeStart = performance.now();
    const events = docs.map((queryDocumentSnapshot) => (
      this.deserializeEventFromDoc(queryDocumentSnapshot, 'Unknown Data Types in getEventsOnceBy')
    ));
    this.logger.info(`[perf] ${perfEventName}`, {
      durationMs: Number((performance.now() - deserializeStart).toFixed(2)),
      snapshots: snapshotsCount ?? docs.length,
      userID,
    });
    return events;
  }

  private storeEventQuerySeed(
    queryKey: string,
    docs: QueryDocumentSnapshot[],
    events: AppEventInterface[],
  ): void {
    this.deleteEventQuerySeed(queryKey);
    if (!docs.length || !events.length) {
      return;
    }

    const eventsById = new Map<string, AppEventInterface>();
    const fingerprintsById = new Map<string, string>();
    let storedCount = 0;

    docs.forEach((doc, index) => {
      const event = events[index];
      if (!event) {
        return;
      }
      eventsById.set(doc.id, event);
      fingerprintsById.set(doc.id, this.buildEventDocFingerprint(doc.id, doc.data()));
      storedCount += 1;
    });

    if (!storedCount) {
      return;
    }

    const expiresAt = Date.now() + AppEventService.EVENT_QUERY_SEED_TTL_MS;
    this.eventQuerySeeds.set(queryKey, {
      eventsById,
      fingerprintsById,
      expiresAt,
    });
    this.logger.log('[perf] app_event_service_seed_store', {
      queryKeyDigest: this.buildQueryKeyDigest(queryKey),
      storedCount,
      expiresInMs: AppEventService.EVENT_QUERY_SEED_TTL_MS,
      totalSeedsAfterStore: this.eventQuerySeeds.size,
    });
    const cleanupTimer = setTimeout(() => {
      this.deleteEventQuerySeed(queryKey);
    }, AppEventService.EVENT_QUERY_SEED_TTL_MS);
    this.eventQuerySeedCleanupTimers.set(queryKey, cleanupTimer);
  }

  private consumeEventQuerySeed(queryKey: string | null): EventQuerySeed | null {
    if (!queryKey) {
      return null;
    }
    const seed = this.eventQuerySeeds.get(queryKey) || null;
    if (!seed) {
      this.logger.log('[perf] app_event_service_seed_consume_miss', {
        queryKeyDigest: this.buildQueryKeyDigest(queryKey),
        totalSeedsAvailable: this.eventQuerySeeds.size,
      });
      return null;
    }
    if (seed.expiresAt <= Date.now()) {
      this.logger.log('[perf] app_event_service_seed_consume_expired', {
        queryKeyDigest: this.buildQueryKeyDigest(queryKey),
        seedEventCount: seed.eventsById.size,
      });
      this.deleteEventQuerySeed(queryKey);
      return null;
    }
    this.logger.log('[perf] app_event_service_seed_consume_hit', {
      queryKeyDigest: this.buildQueryKeyDigest(queryKey),
      seedEventCount: seed.eventsById.size,
      seedFingerprintCount: seed.fingerprintsById.size,
    });
    this.deleteEventQuerySeed(queryKey);
    return seed;
  }

  private deleteEventQuerySeed(queryKey: string): void {
    const cleanupTimer = this.eventQuerySeedCleanupTimers.get(queryKey);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      this.eventQuerySeedCleanupTimers.delete(queryKey);
    }
    this.eventQuerySeeds.delete(queryKey);
  }

  private clearEventQuerySeeds(): void {
    for (const cleanupTimer of this.eventQuerySeedCleanupTimers.values()) {
      clearTimeout(cleanupTimer);
    }
    this.eventQuerySeedCleanupTimers.clear();
    this.eventQuerySeeds.clear();
  }

  private _getEventsAndActivities(user: User, whereClauses: { fieldPath: string | any, opStr: any, value: any }[] = [], orderByField: string = 'startDate', asc: boolean = false, limitCount: number = 10, startAfterDoc?: any, endBeforeDoc?: any): Observable<EventInterface[]> {
    const q = this.getEventQueryForUser(user, whereClauses, orderByField, asc, limitCount, startAfterDoc, endBeforeDoc);

    return (collectionData(q, { idField: 'id' }) as Observable<any[]>).pipe(
      distinctUntilChanged((p, c) => JSON.stringify(p) === JSON.stringify(c)),
      map((eventSnapshots: any[]) => {
        this.logger.log(`[AppEventService] _getEventsAndActivities emitted ${eventSnapshots?.length || 0} event snapshots for user: ${user.uid}`);
        return eventSnapshots.reduce((events: EventInterface[], eventSnapshot) => {
          const { sanitizedJson, unknownTypes } = EventJSONSanitizer.sanitize(eventSnapshot);
          if (unknownTypes.length > 0) {
            const newUnknownTypes = unknownTypes.filter(type => AppEventService.shouldReportKey(
              AppEventService.reportedUnknownTypes,
              type,
              AppEventService.DEDUPE_TTL_MS,
              AppEventService.DEDUPE_UNKNOWN_TYPES_MAX
            ));
            if (newUnknownTypes.length > 0) {
              this.logger.captureMessage('Unknown Data Types in _getEventsAndActivities', { extra: { types: newUnknownTypes, eventID: eventSnapshot.id } });
            }
          }
          const event = EventImporterJSON.getEventFromJSON(<EventJSONInterface>sanitizedJson).setID(eventSnapshot.id) as AppEventInterface;

          // Hydrate with original file(s) info if present
          const rawData = eventSnapshot as any;

          if (rawData.originalFiles) {
            event.originalFiles = rawData.originalFiles;
          }
          if (rawData.originalFile) {
            event.originalFile = rawData.originalFile;
          }

          this.benchmarkAdapter.applyBenchmarkFieldsFromFirestore(event, rawData);

          events.push(event);
          return events;
        }, []);
      })).pipe(switchMap((events: EventInterface[]) => {
        if (events.length === 0) {
          return of([]);
        }
        return combineLatest(events.map((event) => {
          return this.getActivities(user, event.getID()).pipe(map((activities) => {
            event.addActivities(activities)
            return event;
          }));
        }))
      }));
  }

  private getEventQueryForUser(user: User, whereClauses: { fieldPath: string | any, opStr: any, value: any }[] = [], orderByField: string = 'startDate', asc: boolean = false, limitCount: number = 10, startAfterDoc?: any, endBeforeDoc?: any) {
    const eventsRef = collection(this.firestore, `users/${user.uid}/events`);
    const constraints: any[] = [];

    // Replicate legacy logic for startDate ordering when filtering
    if (whereClauses.length) {
      whereClauses.forEach(clause => {
        if (clause.fieldPath === 'startDate' && (orderByField !== 'startDate')) {
          constraints.push(orderBy('startDate', 'asc'));
        }
      });
    }

    // Main Sort
    constraints.push(orderBy(orderByField, asc ? 'asc' : 'desc'));

    // Filters
    whereClauses.forEach(clause => {
      constraints.push(where(clause.fieldPath, clause.opStr, clause.value));
    });

    if (limitCount > 0) {
      constraints.push(limit(limitCount));
    }
    if (startAfterDoc) {
      constraints.push(startAfter(startAfterDoc));
    }
    if (endBeforeDoc) {
      constraints.push(endBefore(endBeforeDoc));
    }

    return query(eventsRef, ...constraints);
  }

  // Legacy method kept for other consumers if any (though _getEvents was main one)
  // DEPRECATED and likely broken in original but ported best-effort
  /*
  private getEventCollectionForUser(user: User, where: { fieldPath: string | any, opStr: any, value: any }[] = [], orderBy: string = 'startDate', asc: boolean = false, limit: number = 10, startAfter?: any, endBefore?: any) {
    // ... logic was mixed with query building in Compat.
    // In modular, we just return Query.
    return this.getEventQueryForUser(user, where, orderBy, asc, limit, startAfter, endBefore);
  }
  */

  /**
   * Uses Firestore Aggregation Queries to count events efficiently.
   *
   * Cost Efficiency:
   * - Does NOT read actual documents, only scans the index.
   * - Cost is 1 document read per 1,000 index entries.
   * - Example: 5,000 events = 5 billable reads.
   *
   * @todo Cache this result (e.g., in a Signal or BehaviorSubject) to avoid unnecessary server calls on every navigation.
   */
  public async getEventCount(user: User): Promise<number> {
    const eventsRef = collection(this.firestore, `users/${user.uid}/events`);
    const snapshot = await getCountFromServer(query(eventsRef));
    return snapshot.data().count;
  }
}
