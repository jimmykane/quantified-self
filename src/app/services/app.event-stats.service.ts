import { Injectable, inject } from '@angular/core';
import { Firestore, collection, getCountFromServer } from 'app/firebase/firestore';
import { from, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

type UserUIDCarrier = { uid?: string | null } | null | undefined;

export interface AppEventStats {
  total: number;
}

@Injectable({
  providedIn: 'root',
})
export class AppEventStatsService {
  private firestore = inject(Firestore);

  loadUserEventStats(user: UserUIDCarrier): Observable<AppEventStats | null> {
    const uid = `${user?.uid || ''}`.trim();
    if (!uid) {
      return of(null);
    }

    const eventsCollectionRef = collection(
      this.firestore,
      'users',
      uid,
      'events',
    );

    return from(getCountFromServer(eventsCollectionRef)).pipe(
      map((snapshot) => {
        const count = snapshot.data().count;
        return {
          total: typeof count === 'number' && Number.isFinite(count)
            ? Math.max(0, Math.floor(count))
            : 0,
        };
      }),
      catchError(() => of(null)),
    );
  }
}
