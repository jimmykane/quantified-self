import { inject, Injectable } from '@angular/core';
import { collection, collectionData, documentId, Firestore, limit, orderBy, query, startAfter, where } from 'app/firebase/firestore';
import { defer, finalize, Observable, of, shareReplay, switchMap } from 'rxjs';
import type { HealthSourceRecord } from '@shared/health';
import { assertNightlyHrvRecordBudget, NIGHTLY_HRV_LIMITS } from '@shared/nightly-hrv';

/** One bounded live HRV source read, shared only while matching consumers are subscribed. */
@Injectable({ providedIn: 'root' })
export class HrvHistoryService {
  private readonly firestore = inject(Firestore);
  private readonly requests = new Map<string, Observable<HealthSourceRecord[]>>();

  watch(uid: string, startDate: string, endDate: string): Observable<HealthSourceRecord[]> {
    return defer(() => {
      if (!uid?.trim()) return of([]);
      const key = JSON.stringify([uid, startDate, endDate]);
      let request$ = this.requests.get(key);
      if (!request$) {
        request$ = this.watchPages(uid, startDate, endDate).pipe(
          finalize(() => this.requests.delete(key)),
          shareReplay({ bufferSize: 1, refCount: true }),
        );
        this.requests.set(key, request$);
      }
      return request$;
    });
  }

  private watchPages(
    uid: string, startDate: string, endDate: string,
    cursor?: { date: string; id: string }, prefix: HealthSourceRecord[] = [],
  ): Observable<HealthSourceRecord[]> {
    const remaining = NIGHTLY_HRV_LIMITS.records - prefix.length;
    const pageSize = Math.min(NIGHTLY_HRV_LIMITS.pageSize, remaining);
    const q = query(collection(this.firestore, 'users', uid, 'healthSourceRecords'),
      where('metricIds', 'array-contains', 'heart_rate_variability'),
      where('calendarDate', '>=', startDate), where('calendarDate', '<=', endDate),
      orderBy('calendarDate', 'asc'), orderBy(documentId(), 'asc'),
      ...(cursor ? [startAfter(cursor.date, cursor.id)] : []), limit(pageSize + 1));
    return (collectionData(q, { idField: 'id' }) as Observable<HealthSourceRecord[]>).pipe(
      switchMap(page => {
        if (page.length > pageSize + 1 || (remaining === 0 && page.length)) throw new Error('HRV history exceeds the read limit.');
        const records = [...prefix, ...page.slice(0, pageSize)];
        assertNightlyHrvRecordBudget(records);
        if (page.length <= pageSize) return of(records);
        const last = page[pageSize - 1];
        if (!last?.id || (last.id === cursor?.id && last.calendarDate === cursor.date)) throw new Error('Invalid HRV history page.');
        return this.watchPages(uid, startDate, endDate, { date: last.calendarDate, id: last.id }, records);
      }),
    );
  }
}
