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
} from 'app/firebase/firestore';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  SleepProvider,
  SleepSession,
  SleepSyncState,
  SLEEP_SESSIONS_COLLECTION_ID,
  SLEEP_SYNC_STATE_COLLECTION_ID,
} from '@shared/sleep';

@Injectable({
  providedIn: 'root',
})
export class AppSleepService {
  private static readonly OVERNIGHT_LOOKBACK_MS = 18 * 60 * 60 * 1000;
  private static readonly FALLBACK_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
  private static readonly FALLBACK_LIMIT = 250;

  private firestore = inject(Firestore);

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
        .filter((session) => this.overlapsDashboardRange(session, startTimeMs, endTimeMs))
        .sort((left, right) => left.startTimeMs - right.startTimeMs)),
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
