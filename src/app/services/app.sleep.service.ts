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
  getDocsFromServer,
  startAfter,
} from 'app/firebase/firestore';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { Observable, of, from } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { enrichSleepWithNightlyHrv, nightlyHrvDateRange } from '@shared/nightly-hrv';
import { HrvHistoryService } from './hrv-history.service';
import {
  SleepProvider,
  SleepSession,
  SleepSyncState,
  SLEEP_SESSIONS_COLLECTION_ID,
  SLEEP_SYNC_STATE_COLLECTION_ID,
} from '@shared/sleep';
import { decodeSleepSessionSportsLibData } from '@shared/sports-lib-health-data';
import { withHealthSleepAccountKeys, type HealthWorkspaceSleepSession } from '../helpers/health-sleep-account.helper';

export interface SleepSummaryRangeLoad {
  sessions: HealthWorkspaceSleepSession[];
  complete: boolean;
  limitReached: 'records' | 'bytes' | null;
}
export const SLEEP_SUMMARY_READ_LIMITS = { page: 32, records: 512, bytes: 8 * 1024 * 1024 } as const;

@Injectable({
  providedIn: 'root',
})
export class AppSleepService {
  private static readonly OVERNIGHT_LOOKBACK_MS = 18 * 60 * 60 * 1000;
  private static readonly FALLBACK_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
  private static readonly FALLBACK_LIMIT = 250;

  private firestore = inject(Firestore);
  private browserCompatibility = inject(BrowserCompatibilityService);
  private hrvHistory = inject(HrvHistoryService);

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
  ): Observable<HealthWorkspaceSleepSession[]> {
    const uid = `${userID || ''}`.trim();
    return this.watchSessions(userID, startDate, endDate).pipe(
      switchMap(sessions => {
        const range = nightlyHrvDateRange(sessions);
        if (!range || !this.browserCompatibility.checkWebCryptoSupport()) return of(sessions);
        return this.hrvHistory.watch(uid, range.startDate, range.endDate).pipe(
          switchMap(records => from(enrichSleepWithNightlyHrv(uid, sessions, records))),
          // A failed or incomplete optional Health read must not erase native Sleep evidence.
          catchError(() => of(sessions)),
        );
      }),
      switchMap(sessions => from(withHealthSleepAccountKeys(uid, sessions))),
    );
  }

  /** Bounded native summaries for consumers already loading Health HRV. No enrichment or sample reads. */
  async loadSummaryRange(uid: string, startMs: number, endMs: number,
    isCurrent: () => boolean): Promise<SleepSummaryRangeLoad> {
    if (!uid || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs
      || endMs - startMs > 64 * 86_400_000) throw new Error('Invalid Sleep summary range.');
    let cursor: QueryDocumentSnapshot | null = null;
    let records = 0, bytes = 0;
    const sessions: SleepSession[] = [];
    const result = (limitReached: SleepSummaryRangeLoad['limitReached']): SleepSummaryRangeLoad => ({
      sessions, complete: limitReached === null, limitReached,
    });
    do {
      if (!isCurrent()) throw new Error('Sleep summary read cancelled.');
      const size = Math.min(SLEEP_SUMMARY_READ_LIMITS.page, SLEEP_SUMMARY_READ_LIMITS.records - records);
      const snapshot = await getDocsFromServer(query(collection(this.firestore, 'users', uid, SLEEP_SESSIONS_COLLECTION_ID),
        where('startTimeMs', '>=', Math.max(0, startMs - AppSleepService.OVERNIGHT_LOOKBACK_MS)),
        where('startTimeMs', '<=', endMs), orderBy('startTimeMs', 'desc'),
        ...(cursor ? [startAfter(cursor)] : []), limit(size + 1)));
      if (!isCurrent()) throw new Error('Sleep summary read cancelled.');
      for (const document of snapshot.docs.slice(0, size)) {
        records++;
        const raw = document.data();
        bytes += new TextEncoder().encode(JSON.stringify(raw)).byteLength;
        if (bytes > SLEEP_SUMMARY_READ_LIMITS.bytes) return result('bytes');
        const session = decodeSleepSessionSportsLibData({ ...raw, id: document.id } as SleepSession);
        if (this.overlapsDashboardRange(session, startMs, endMs)) sessions.push(session);
      }
      if (snapshot.size <= size) return result(null);
      if (records >= SLEEP_SUMMARY_READ_LIMITS.records) return result('records');
      cursor = snapshot.docs[size - 1];
    } while (cursor);
    throw new Error('Sleep summary paging could not continue.');
  }

  /** Native Sleep records for consumers that already own a complete Health HRV read. */
  watchSessions(
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
    );
  }

  watchSyncState(
    userID: string | null | undefined,
    provider: SleepProvider,
    options?: { waitForServer: boolean },
  ): Observable<SleepSyncState | null> {
    const uid = `${userID || ''}`.trim();
    if (!uid) {
      return of(null);
    }

    const stateDoc = doc(this.firestore, 'users', uid, SLEEP_SYNC_STATE_COLLECTION_ID, provider);
    const state$ = options ? docData(stateDoc, options) : docData(stateDoc);
    return (state$ as Observable<SleepSyncState | undefined>).pipe(
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
