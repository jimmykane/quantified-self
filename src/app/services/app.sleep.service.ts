import { BrowserCompatibilityService } from './browser.compatibility.service';
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  limit,
  orderBy,
  query,
  where,
  documentId,
  startAfter,
} from 'app/firebase/firestore';
import { Observable, of, from } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { enrichSleepWithNightlyHrv, nightlyHrvDateRange, assertNightlyHrvRecordBudget, NIGHTLY_HRV_LIMITS, type NightlyHrvRecord } from '@shared/nightly-hrv';
import {
  SleepProvider,
  SleepSession,
  SleepSyncState,
  SLEEP_SESSIONS_COLLECTION_ID,
  SLEEP_SYNC_STATE_COLLECTION_ID,
} from '@shared/sleep';
import { decodeSleepSessionSportsLibData } from '@shared/sports-lib-health-data';

@Injectable({
  providedIn: 'root',
})
export class AppSleepService {
  private static readonly OVERNIGHT_LOOKBACK_MS = 18 * 60 * 60 * 1000;
  private static readonly FALLBACK_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
  private static readonly FALLBACK_LIMIT = 250;

  private firestore = inject(Firestore);
  private browserCompatibility = inject(BrowserCompatibilityService);

  watchHasAnySleepSession(userID: string | null | undefined): Observable<boolean> {
    const uid = `${userID || ''}`.trim();
    if (!uid) {
      return of(false);
    }

    const sleepCollection = collection(this.firestore, 'users', uid, SLEEP_SESSIONS_COLLECTION_ID);
    const sleepQuery = query(sleepCollection, limit(1));
    return (collectionData(sleepQuery) as Observable<SleepSession[]>).pipe(
      map((sessions) => (sessions || []).length > 0),
    );
  }

  watchForDashboard(
    userID: string | null | undefined,
    startDate: Date | number | null | undefined,
    endDate: Date | number | null | undefined,
  ): Observable<SleepSession[]> {
    const uid = `${userID || ''}`.trim();
    if (!uid) {
      return of([]);
    }

    const requestedStartTimeMs = this.toMs(startDate);
    const endTimeMs = this.toMs(endDate) ?? Date.now();
    const startTimeMs = requestedStartTimeMs ?? (endTimeMs - AppSleepService.FALLBACK_LOOKBACK_MS);
    const queryStartMs = Math.max(0, startTimeMs - AppSleepService.OVERNIGHT_LOOKBACK_MS);
    const isFallbackWindow = requestedStartTimeMs === null;
    const sleepCollection = collection(this.firestore, 'users', uid, SLEEP_SESSIONS_COLLECTION_ID);
    const sleepQuery = query(
      sleepCollection,
      where('startTimeMs', '>=', queryStartMs),
      where('startTimeMs', '<=', endTimeMs),
      orderBy('startTimeMs', 'desc'),
      ...(isFallbackWindow ? [limit(AppSleepService.FALLBACK_LIMIT)] : []),
    );

    return (collectionData(sleepQuery, { idField: 'id' }) as Observable<SleepSession[]>).pipe(
      map((sessions) => sessions
        .map(decodeSleepSessionSportsLibData)
        .filter((session) => this.overlapsDashboardRange(session, startTimeMs, endTimeMs))
        .sort((left, right) => left.startTimeMs - right.startTimeMs)),
      switchMap(sessions => {
        const range = nightlyHrvDateRange(sessions);
        if (!range || !this.browserCompatibility.checkWebCryptoSupport()) return of(sessions);
        return this.watchNightlyHrvRecords(uid, range.startDate, range.endDate).pipe(
          switchMap(records => from(enrichSleepWithNightlyHrv(uid, sessions, records))),
          // A failed or incomplete optional Health read must not erase native Sleep evidence.
          catchError(() => of(sessions)),
        );
      }),
    );
  }

  /** Every page is live; a late HRV delivery or correction must update an open dashboard. */
  private watchNightlyHrvRecords(
    uid: string, startDate: string, endDate: string,
    cursor?: { date: string; id: string }, prefix: NightlyHrvRecord[] = [],
  ): Observable<NightlyHrvRecord[]> {
    const remaining = NIGHTLY_HRV_LIMITS.records - prefix.length;
    const pageSize = Math.min(NIGHTLY_HRV_LIMITS.pageSize, remaining);
    const q = query(collection(this.firestore, 'users', uid, 'healthSourceRecords'),
      where('metricIds', 'array-contains', 'heart_rate_variability'),
      where('calendarDate', '>=', startDate), where('calendarDate', '<=', endDate),
      orderBy('calendarDate', 'asc'), orderBy(documentId(), 'asc'),
      ...(cursor ? [startAfter(cursor.date, cursor.id)] : []), limit(pageSize + 1));
    return (collectionData(q, { idField: 'id' }) as Observable<Array<NightlyHrvRecord & {id: string}>>).pipe(
      switchMap(page => {
        if (page.length > pageSize + 1 || (remaining === 0 && page.length)) throw new Error('Nightly HRV exceeds the read limit.');
        const records = [...prefix, ...page.slice(0, pageSize)];
        assertNightlyHrvRecordBudget(records);
        if (page.length <= pageSize) return of(records);
        const last = page[pageSize - 1];
        if (!last?.id || (last.id === cursor?.id && last.calendarDate === cursor.date)) throw new Error('Invalid nightly HRV page.');
        return this.watchNightlyHrvRecords(uid, startDate, endDate, {date: last.calendarDate, id: last.id}, records);
      }),
    );
  }

  watchSyncState(
    userID: string | null | undefined,
    provider: SleepProvider,
  ): Observable<SleepSyncState | null> {
    const uid = `${userID || ''}`.trim();
    if (!uid) {
      return of(null);
    }

    const stateDoc = doc(this.firestore, 'users', uid, SLEEP_SYNC_STATE_COLLECTION_ID, provider);
    return (docData(stateDoc) as Observable<SleepSyncState | undefined>).pipe(
      map((state) => state || null),
    );
  }

  private overlapsDashboardRange(session: SleepSession, startTimeMs: number, endTimeMs: number): boolean {
    const sessionStartMs = Number(session.startTimeMs);
    const sessionEndMs = Number(session.endTimeMs);
    return Number.isFinite(sessionStartMs)
      && Number.isFinite(sessionEndMs)
      && sessionEndMs >= startTimeMs
      && sessionStartMs <= endTimeMs;
  }

  private toMs(value: Date | number | null | undefined): number | null {
    if (value instanceof Date) {
      const timestamp = value.getTime();
      return Number.isFinite(timestamp) ? timestamp : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return null;
  }
}
