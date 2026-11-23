import { Injectable, inject } from '@angular/core';
import { Auth, type FirebaseUserType } from 'app/firebase/auth';
import { Firestore, collection, collectionData, doc, docData, limit, orderBy, query, runTransaction, where } from 'app/firebase/firestore';
import { Observable, Subject, defer, finalize, distinctUntilChanged, filter, map, merge, retry, scan, shareReplay, tap, throwError, timeout, timer } from 'rxjs';
import { TRAINING_REST_DAYS_COLLECTION, parseTrainingRestDayV1, validateTrainingRestDayRange, type TrainingRestDayV1 } from '@shared/training-rest-days';
import { normalizeTrainingLocalDate } from '@shared/training-plans';
import { LoggerService } from './logger.service';

const INITIAL_READ_TRANSIENT_CODES = new Set(['aborted', 'deadline-exceeded', 'internal', 'unavailable']);
type RestDaySnapshotState = 'no_snapshot' | 'cache_only' | 'pending_writes' | 'server_snapshot' | 'revision_behind';
export class RestDayReadTimeoutError extends Error {
  readonly code = 'deadline-exceeded';
  constructor(readonly attempt: number, readonly snapshotState: RestDaySnapshotState) {
    super('Timed out verifying calendar rest-day state.');
  }
}

/** Project only our typed timeout; SDK exception fields can contain document paths and payloads. */
export function calendarRestReadFailureDetails(error: unknown): { attempt: number; snapshotState: RestDaySnapshotState } | null {
  if (!(error instanceof RestDayReadTimeoutError) || ![1, 2].includes(error.attempt)
    || !['no_snapshot', 'cache_only', 'pending_writes', 'server_snapshot', 'revision_behind'].includes(error.snapshotState)) return null;
  return { attempt: error.attempt, snapshotState: error.snapshotState };
}

@Injectable({ providedIn: 'root' })
export class TrainingRestDaysService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly logger = inject(LoggerService);
  private readonly dayStreams = new Map<string, { authUser: FirebaseUserType | null; stream$: Observable<TrainingRestDayV1 | null> }>();
  private readonly revisions = new Map<string, { authUser: FirebaseUserType | null; revision: number; liveSource?: object }>();
  private readonly acknowledgements = new Subject<{ uid: string; record: TrainingRestDayV1 }>();
  private readonly changes = new Subject<{ uid: string; localDate: string; revision: number }>();
  readonly changes$ = this.changes.asObservable();

  lastRevision(uid: string, localDate: string): number | undefined {
    const value = this.revisions.get(JSON.stringify([uid, localDate]));
    return value?.liveSource && this.auth.currentUser?.uid === uid && value.authUser === this.auth.currentUser ? value.revision : undefined;
  }

  private observedRevision(uid: string, localDate: string): number | undefined {
    const value = this.revisions.get(JSON.stringify([uid, localDate]));
    return this.auth.currentUser?.uid === uid && value?.authUser === this.auth.currentUser ? value?.revision : undefined;
  }

  watchDay(uid: string, localDate: string): Observable<TrainingRestDayV1 | null> {
    normalizeTrainingLocalDate(localDate);
    if (!uid) throw Error('Choose the signed-in account.');
    const key = JSON.stringify([uid, localDate]), existing = this.dayStreams.get(key), authUser = this.auth.currentUser;
    if (existing?.authUser === authUser) return existing.stream$;
    let failureAt: number | null = null, recoveryReported = false;
    const stream$ = defer(() => {
      let verified = false, attempt = 0;
      const current = () => !!authUser && authUser.uid === uid && this.auth.currentUser === authUser;
      return defer(() => {
        // Check again after the retry delay, including replacement sessions for the same UID.
        if (!current()) throw Object.assign(new Error('The signed-in account changed.'), { code: 'cancelled' });
        const source = {};
        attempt++;
        let snapshotState: RestDaySnapshotState = 'no_snapshot';
        return merge(
          docData(doc(this.firestore, 'users', uid, TRAINING_REST_DAYS_COLLECTION, localDate), {
            waitForServer: true, onSnapshotMetadata: metadata => {
              snapshotState = metadata.hasPendingWrites ? 'pending_writes' : metadata.fromCache ? 'cache_only' : 'server_snapshot';
            },
          })
            .pipe(map(value => value === undefined ? null : parseTrainingRestDayV1(value, localDate))),
          this.acknowledgements.pipe(filter(update => update.uid === uid && update.record.localDate === localDate), map(update => update.record)),
        ).pipe(filter(record => {
          if (!current()) return false;
          if ((record?.revision ?? 0) >= (this.observedRevision(uid, localDate) ?? 0)) return true;
          snapshotState = 'revision_behind'; return false;
        }),
          timeout({ first: 15_000, with: () => throwError(() => new RestDayReadTimeoutError(attempt, snapshotState)) }),
          // An older SDK echo cannot undo an acknowledged write. False markers retain revisions.
          scan((previous, value) => (value?.revision ?? 0) >= (previous?.revision ?? 0) ? value : previous, null as TrainingRestDayV1 | null),
          distinctUntilChanged((left, right) => left?.revision === right?.revision && left?.isRestDay === right?.isRestDay),
          tap({ next: record => {
            verified = true; this.publish(uid, localDate, record?.revision ?? 0, source);
            if (failureAt === null || recoveryReported || !current()) return;
            recoveryReported = true;
            try {
              this.logger.captureMessage('Calendar rest-day verification recovered', {
                level: 'info', tags: { operation: 'calendar-rest', outcome: 'recovered' },
                contexts: { calendarRestRead: { attempt, elapsedMs: Math.min(86_400_000, Math.max(0, Date.now() - failureAt)) } },
              });
            } catch { /* Recovery evidence must not gate the verified record. */ }
          }, error: () => { if (current()) failureAt ??= Date.now(); } }),
          // Keep the monotonic floor for write races, but stop treating disconnected evidence as current.
          finalize(() => {
            const value = this.revisions.get(key);
            if (value?.liveSource === source) delete value.liveSource;
          }));
      }).pipe(retry({ count: 1, delay: error => {
        // Recover only initial reads. A failed live listener must immediately retire cache authority.
        const code = (error as { code?: unknown } | null)?.code;
        return !verified && current() && typeof code === 'string' && INITIAL_READ_TRANSIENT_CODES.has(code)
          ? timer(500) : throwError(() => error);
      } }));
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
    if (this.dayStreams.size >= 64) this.dayStreams.delete(this.dayStreams.keys().next().value!);
    this.dayStreams.set(key, { authUser, stream$ });
    return stream$;
  }

  watchRange(uid: string, startDate: string, endDate: string): Observable<TrainingRestDayV1[]> {
    validateTrainingRestDayRange(startDate, endDate);
    if (!uid) throw Error('Choose the signed-in account.');
    const snapshots$ = collectionData(query(collection(this.firestore, 'users', uid, TRAINING_REST_DAYS_COLLECTION),
      where('localDate', '>=', startDate), where('localDate', '<=', endDate), orderBy('localDate'), limit(367)),
    { idField: 'id', waitForServer: true }).pipe(timeout({ first: 15_000 }), map(values => {
      if (values.length > 366) throw Error('Calendar rest-day coverage is incomplete.');
      return values.map(({ id, ...value }) => parseTrainingRestDayV1(value, id));
    }));
    return merge(snapshots$, this.acknowledgements.pipe(
      filter(update => update.uid === uid && update.record.localDate >= startDate && update.record.localDate <= endDate),
      map(update => update.record),
    )).pipe(scan((state, value) => {
      if (!Array.isArray(value) && [...(state.records ?? []), ...state.acknowledgements]
        .some(record => record.localDate === value.localDate && record.revision >= value.revision)) return state;
      const records = Array.isArray(value) ? value : state.records;
      const acknowledgements = Array.isArray(value)
        ? state.acknowledgements.filter(ack => !value.some(record => record.localDate === ack.localDate && record.revision >= ack.revision))
        : [...state.acknowledgements.filter(ack => ack.localDate !== value.localDate), value];
      return { records, acknowledgements };
    }, { records: null as TrainingRestDayV1[] | null, acknowledgements: [] as TrainingRestDayV1[] }),
    filter(state => state.records !== null), map(state => [...state.records!.filter(record => !state.acknowledgements
      .some(ack => ack.localDate === record.localDate && ack.revision > record.revision)),
    ...state.acknowledgements.filter(ack => !state.records!.some(record => record.localDate === ack.localDate && record.revision >= ack.revision))]));
  }

  async setDay(uid: string, localDate: string, isRestDay: boolean, expectedRevision: number,
    current: () => boolean): Promise<TrainingRestDayV1 | null> {
    normalizeTrainingLocalDate(localDate);
    const authUser = this.auth.currentUser;
    const active = () => !!authUser && this.auth.currentUser === authUser && authUser.uid === uid && current();
    if (!active() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error('The calendar context changed.');
    const reference = doc(this.firestore, 'users', uid, TRAINING_REST_DAYS_COLLECTION, localDate);
    const result = await runTransaction(this.firestore, async transaction => {
      if (!active()) throw Error('The signed-in account changed.');
      const snapshot = await transaction.get(reference);
      if (!active()) throw Error('The calendar context changed.');
      const previous = snapshot.exists() ? parseTrainingRestDayV1(snapshot.data(), localDate) : null;
      if ((previous?.isRestDay ?? false) === isRestDay) return previous;
      if ((previous?.revision ?? 0) !== expectedRevision) throw Error('This rest day changed. Reload the day and try again.');
      const record = parseTrainingRestDayV1({ schemaVersion: 1, localDate, isRestDay, revision: expectedRevision + 1 }, localDate);
      transaction.set(reference, record);
      return record;
    });
    if (!active()) throw Error('The calendar context changed.');
    if (result && (this.observedRevision(uid, localDate) ?? 0) > result.revision) throw Error('This rest day changed again. Reload the day and try again.');
    if (result) this.acknowledgements.next({ uid, record: result });
    this.publish(uid, localDate, result?.revision ?? 0);
    return result;
  }

  private publish(uid: string, localDate: string, revision: number, source?: object): void {
    if (this.auth.currentUser?.uid !== uid) return;
    const key = JSON.stringify([uid, localDate]);
    if ((this.observedRevision(uid, localDate) ?? -1) >= revision) {
      if (source && this.observedRevision(uid, localDate) === revision) this.revisions.get(key)!.liveSource = source;
      return;
    }
    this.revisions.delete(key); this.revisions.set(key, { authUser: this.auth.currentUser, revision, liveSource: source });
    if (this.revisions.size > 128) this.revisions.delete(this.revisions.keys().next().value!);
    this.changes.next({ uid, localDate, revision });
  }
}
