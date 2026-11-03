import { Injectable, effect, inject, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { Auth, authState } from 'app/firebase/auth';
import { Firestore, collection, collectionData, doc, limit, query, runTransaction } from 'app/firebase/firestore';
import { Observable, Subject, auditTime, catchError, combineLatest, defer, distinctUntilChanged, filter, from, map, of,
  shareReplay, startWith, switchMap, timeout, timer } from 'rxjs';
import { TRAINING_GOALS_COLLECTION, TRAINING_GOAL_STATE_PATH, TRAINING_GOALS_LIMIT, TRAINING_GOAL_FIELDS,
  parseTrainingGoalFields, parseTrainingGoalV1, type TrainingGoalFields, type TrainingGoalV1 } from '@shared/training-goals';
import type { TrainingGoalProgress } from '@shared/training-goal-progress';
import { dayWorkoutLocalDate } from '@shared/day-workout';
import { AppFunctionsService } from './app.functions.service';
import { AppUserService } from './app.user.service';
import { HistoryImportProgressService } from './history-import-progress.service';

export interface TrainingGoalsState { status: 'loading' | 'ready' | 'error'; goals: TrainingGoalV1[] }
export interface TrainingGoalsProgressResult { goalsRevision: number; progress: TrainingGoalProgress[]; weekStartsOn: number; complete: boolean }
export interface TrainingGoalsProgressState { status: 'loading' | 'ready' | 'error'; result: TrainingGoalsProgressResult | null }
@Injectable({ providedIn: 'root' })
export class TrainingGoalsService {
  private readonly db = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly users = inject(AppUserService);
  private readonly functions = inject(AppFunctionsService);
  private readonly dialogs = inject(MatDialog);
  private readonly imports = inject(HistoryImportProgressService);
  private readonly owner$ = combineLatest([authState(this.auth).pipe(startWith(this.auth.currentUser)), toObservable(this.users.user)]).pipe(
    map(([session, user]) => session && session === this.auth.currentUser && session.uid === user?.uid ? session : null),
    distinctUntilChanged(), catchError(() => of(null)), shareReplay({ bufferSize: 1, refCount: true }));
  private readonly owner = toSignal(this.owner$, { initialValue: null });
  private readonly streams = new Map<string, Observable<TrainingGoalsState>>();
  private readonly progressCache = new Map<string, { expires: number; promise: Promise<TrainingGoalsProgressResult> }>();
  private readonly invalidations = new Subject<string>();
  private opening = false;
  constructor() {
    let previousUid: string | undefined, previousImportActive: boolean | undefined;
    let previousSession: object | null | undefined;
    effect(() => {
      const session = this.owner(), uid = session?.uid;
      const importActive = this.imports.dataImportActive();
      if (uid === previousUid && session === previousSession && importActive === previousImportActive) return;
      previousUid = uid; previousSession = session; previousImportActive = importActive;
      this.progressCache.clear();
      if (uid) this.invalidations.next(uid);
    });
  }
  isOwner(uid: string): boolean { return !!uid && this.auth.currentUser?.uid === uid && this.users.user()?.uid === uid; }
  watch(uid: string | null | undefined): Observable<TrainingGoalsState> {
    if (!uid) return of({ status: 'ready', goals: [] });
    const cached = this.streams.get(uid);
    if (cached) return cached;
    const stream$ = this.owner$.pipe(switchMap(session => {
      if (session?.uid !== uid) return of({ status: 'ready' as const, goals: [] });
      return defer(() => {
        if (!this.isOwner(uid) || this.auth.currentUser !== session) throw Error('The signed-in account changed.');
        return collectionData(query(collection(this.db, 'users', uid, TRAINING_GOALS_COLLECTION), limit(TRAINING_GOALS_LIMIT + 1)),
          { idField: 'documentId', waitForServer: true });
      }).pipe(timeout({ first: 15000 }), filter(() => this.isOwner(uid) && this.auth.currentUser === session), map(values => {
        if (values.length > TRAINING_GOALS_LIMIT) throw Error('The goal list is incomplete.');
        return { status: 'ready' as const, goals: values.map(({ documentId, ...data }) => parseTrainingGoalV1(data, documentId)) };
      }), startWith({ status: 'loading' as const, goals: [] }));
    }), catchError(() => { if (this.streams.get(uid) === stream$) this.streams.delete(uid); return of({ status: 'error' as const, goals: [] }); }),
    shareReplay({ bufferSize: 1, refCount: true }));
    if (this.streams.size >= 8) this.streams.clear();
    this.streams.set(uid, stream$);
    return stream$;
  }
  invalidateProgress(uid: string): void {
    // Callers track their activity source and owner; this guard must not subscribe them to every profile update.
    if (!untracked(() => this.isOwner(uid))) return;
    this.progressCache.clear();
    this.invalidations.next(uid);
  }
  watchProgress(uid: string, timeZone: string, weekStartsOn: number): Observable<TrainingGoalsProgressState> {
    return combineLatest([this.watch(uid), this.invalidations.pipe(filter(owner => owner === uid), startWith(uid)),
      timer(0, 60000).pipe(map(() => dayWorkoutLocalDate(new Date(), timeZone)), distinctUntilChanged())]).pipe(
      auditTime(800), switchMap(([state, , localDate]) => {
        if (state.status === 'error') return of({ status: 'error' as const, result: null });
        if (state.status !== 'ready') return of({ status: 'loading' as const, result: null });
        if (!state.goals.some(goal => goal.lifecycle === 'active' && goal.weeklyTarget)) {
          return of({ status: 'ready' as const, result: { goalsRevision: 0, progress: [], weekStartsOn, complete: true } });
        }
        const key = JSON.stringify([uid, localDate, timeZone, weekStartsOn, state.goals.map(goal => [goal.id, goal.revision]).sort()]);
        return defer(() => {
          let entry = this.progressCache.get(key);
          if (!entry || entry.expires < Date.now()) {
            const session = this.auth.currentUser;
            const promise = this.functions.call<{ localDate: string; timeZone: string; weekStartsOn: number }, TrainingGoalsProgressResult>(
              'getTrainingGoalsProgress', { localDate, timeZone, weekStartsOn },
              { canExecute: () => this.isOwner(uid) && this.auth.currentUser === session }).then(response => {
              if (!this.isOwner(uid) || this.auth.currentUser !== session) throw Error('The signed-in account changed.');
              return response.data;
            });
            entry = { expires: Date.now() + 60000, promise };
            if (this.progressCache.size >= 8) this.progressCache.clear();
            this.progressCache.set(key, entry);
            promise.catch(() => { if (this.progressCache.get(key)?.promise === promise) this.progressCache.delete(key); });
          }
          return from(entry.promise);
        }).pipe(map(result => ({ status: 'ready' as const, result })), catchError(() => of({ status: 'error' as const, result: null })),
          startWith({ status: 'loading' as const, result: null }));
      }), shareReplay({ bufferSize: 1, refCount: true }));
  }
  async save(uid: string, id: string, value: TrainingGoalFields, previous: TrainingGoalV1 | null): Promise<TrainingGoalV1> {
    const fields = parseTrainingGoalFields(value), session = this.auth.currentUser;
    const current = () => this.isOwner(uid) && this.auth.currentUser === session;
    if (!current() || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id) || (previous && previous.id !== id)) throw Error('The goal context changed.');
    const reference = doc(this.db, 'users', uid, TRAINING_GOALS_COLLECTION, id), stateRef = doc(this.db, `users/${uid}/${TRAINING_GOAL_STATE_PATH}`);
    const saved = await runTransaction(this.db, async tx => {
      if (!current()) throw Error('The signed-in account changed.');
      const [snapshot, state] = await Promise.all([tx.get(reference), tx.get(stateRef)]);
      const existing = snapshot.exists() ? parseTrainingGoalV1(snapshot.data(), id) : null;
      const revision = previous?.revision ?? 0;
      const sameFields = existing && JSON.stringify(parseTrainingGoalFields(Object.fromEntries(TRAINING_GOAL_FIELDS.map(key => [key, existing[key]])))) === JSON.stringify(fields);
      if (existing?.revision === revision + 1 && sameFields) return existing;
      if ((existing?.revision ?? 0) !== revision) throw Error('This goal changed. Close it and reopen before saving.');
      if (fields.planId && fields.planId !== existing?.planId) {
        if (!(await tx.get(doc(this.db, 'users', uid, 'trainingPlans', fields.planId))).exists()) throw Error('The linked plan is unavailable.');
      }
      const goalCount = Number(state.data()?.goalCount ?? 0) + (existing ? 0 : 1), goalsRevision = Number(state.data()?.revision ?? 0) + 1;
      if (!Number.isSafeInteger(goalCount) || goalCount > TRAINING_GOALS_LIMIT || !Number.isSafeInteger(goalsRevision)) throw Error('The goal limit has been reached.');
      const now = Math.max(Date.now(), existing?.updatedAtMs ?? 0);
      const record = parseTrainingGoalV1({ ...fields, schemaVersion: 1, id, revision: revision + 1,
        createdAtMs: existing?.createdAtMs ?? now, updatedAtMs: now }, id);
      if (!current()) throw Error('The signed-in account changed.');
      tx.set(reference, record);
      tx.set(stateRef, { schemaVersion: 1, revision: goalsRevision, goalCount, lastGoalId: id });
      return record;
    });
    if (!current()) throw Error('The signed-in account changed.');
    this.invalidateProgress(uid);
    return saved;
  }
  async open(uid: string, createDate?: string, goal?: TrainingGoalV1): Promise<void> {
    if (!this.isOwner(uid) || this.opening) return;
    this.opening = true;
    try {
      const { TrainingGoalsDialogComponent } = await import('../components/training-goals/training-goals-dialog.component');
      if (!this.isOwner(uid)) return;
      this.dialogs.open(TrainingGoalsDialogComponent, { data: { uid, createDate, goal }, width: '640px',
        maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100dvh - 16px)', autoFocus: 'first-heading' });
    } finally { this.opening = false; }
  }
}
