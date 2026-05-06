import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData } from 'app/firebase/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import {
  EVENT_STATS_COLLECTION_ID,
  EVENT_STATS_DOC_ID,
  hasExactEventStats,
  normalizeEventStatsCounts,
  type EventStatsCounts,
} from '@shared/event-stats';

type UserUIDCarrier = { uid?: string | null } | null | undefined;

export interface AppEventStats extends EventStatsCounts {
  backfilled: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class AppEventStatsService {
  private firestore = inject(Firestore);

  watchUserEventStats(user: UserUIDCarrier): Observable<AppEventStats | null> {
    const uid = `${user?.uid || ''}`.trim();
    if (!uid) {
      return of(null);
    }

    const statsDocRef = doc(
      this.firestore,
      'users',
      uid,
      EVENT_STATS_COLLECTION_ID,
      EVENT_STATS_DOC_ID,
    );

    return (docData(statsDocRef) as Observable<Record<string, unknown> | undefined>).pipe(
      map((snapshot) => {
        if (!hasExactEventStats(snapshot)) {
          return null;
        }

        return {
          ...normalizeEventStatsCounts(snapshot),
          backfilled: true,
        };
      }),
      catchError(() => of(null)),
    );
  }
}
