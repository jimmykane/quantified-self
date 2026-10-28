import { Injectable, inject } from '@angular/core';
import { collection, doc, documentId, Firestore, getDocFromServer, getDocsFromServer, limit, orderBy, query, where } from 'app/firebase/firestore';
import { HEALTH_SOURCE_RECORDS_COLLECTION_ID, type HealthProvider } from '@shared/health';
import { SLEEP_SESSIONS_COLLECTION_ID, SLEEP_SYNC_STATE_COLLECTION_ID, type SleepProvider } from '@shared/sleep';
import { AppUserService } from './app.user.service';

/** First stored records, not eligible/comprehensive coverage or proof of a particular import's delivery. */
@Injectable({ providedIn: 'root' })
export class RecordedHistoryStartService {
  private readonly firestore = inject(Firestore);
  private readonly users = inject(AppUserService);

  async firstSleepDate(uid: string, provider?: SleepProvider, signal?: AbortSignal): Promise<string | null> {
    const current = this.ownerGuard(uid, signal);
    const result = await getDocsFromServer(query(collection(this.firestore, 'users', uid, SLEEP_SESSIONS_COLLECTION_ID),
      ...(provider ? [where('source.provider', '==', provider)] : []),
      orderBy('sleepDate', 'asc'), orderBy(documentId(), 'asc'), limit(1)));
    current();
    return this.date(result.docs[0]?.data().sleepDate, result.empty);
  }

  async firstHealthDate(uid: string, provider?: HealthProvider, signal?: AbortSignal): Promise<string | null> {
    const current = this.ownerGuard(uid, signal);
    const result = await getDocsFromServer(query(collection(this.firestore, 'users', uid, HEALTH_SOURCE_RECORDS_COLLECTION_ID),
      ...(provider ? [where('source.provider', '==', provider)] : []),
      orderBy('calendarDate', 'asc'), orderBy(documentId(), 'asc'), limit(1)));
    current();
    return this.date(result.docs[0]?.data().calendarDate, result.empty);
  }

  /** Historical diagnostic only: never use Sleep's cutoff to clip Health or a new connection's request. */
  async lastReportedGarminSleepCutoff(uid: string, signal?: AbortSignal): Promise<number | null> {
    const current = this.ownerGuard(uid, signal);
    const result = await getDocFromServer(doc(this.firestore, 'users', uid, SLEEP_SYNC_STATE_COLLECTION_ID, 'GarminAPI'));
    current();
    const value = result.data()?.providerMinBackfillStartMs;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }

  private ownerGuard(uid: string, signal?: AbortSignal): () => void {
    const owner = this.users.user();
    const check = () => {
      if (signal?.aborted || !uid || uid.includes('/') || !owner || owner.uid !== uid
        || this.users.user() !== owner) throw new Error('Recorded history account or view changed.');
    };
    check();
    return check;
  }

  private date(value: unknown, empty: boolean): string | null {
    if (empty) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Stored history date unavailable.');
    return value;
  }
}
