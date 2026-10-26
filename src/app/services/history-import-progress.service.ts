import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, NgZone, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Auth, authState, type FirebaseUserType } from 'app/firebase/auth';
import { Subject, catchError, combineLatest, defer, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { AppUserService } from './app.user.service';
import { HISTORY_IMPORT_PROVIDERS, buildHistoryImportProgress, type HistoryImportSource } from '../helpers/history-import-progress.helper';

export interface HistoryImportOwner { uid: string; session: FirebaseUserType; }
interface HistoryImportSnapshot { owner: HistoryImportOwner | null; sources: HistoryImportSource[]; }
const empty: HistoryImportSnapshot = {owner: null, sources: []};

/** One owner-scoped subscription set shared by the header, its panel and Dashboard. */
@Injectable({providedIn: 'root'})
export class HistoryImportProgressService {
  private readonly users = inject(AppUserService);
  private readonly auth = inject(Auth);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly refresh$ = new Subject<void>();
  private readonly now = signal(Date.now());
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly snapshot = toSignal(this.browser ? combineLatest([
    authState(this.auth).pipe(startWith(this.auth.currentUser)), this.users.user$,
  ]).pipe(
    map(([session, user]) => session && session === this.auth.currentUser && user?.uid === session.uid ? {session, user} : null),
    distinctUntilChanged((a, b) => a?.session === b?.session && a?.user.uid === b?.user.uid),
    switchMap(owner => {
      if (!owner) return of(empty);
      const identity: HistoryImportOwner = {uid: owner.user.uid, session: owner.session};
      return this.refresh$.pipe(startWith(undefined), switchMap(() => combineLatest(HISTORY_IMPORT_PROVIDERS.map(serviceName => defer(() => this.users.getUserMetaForService(owner.user, serviceName)).pipe(
        map(meta => ({serviceName, projection: meta?.connectionHistoryImport} as HistoryImportSource)),
        startWith({serviceName} as HistoryImportSource),
        catchError(() => of({serviceName, unavailable: true} as HistoryImportSource)),
      ))).pipe(map(sources => ({owner: identity, sources})))));
    }),
    catchError(() => of(empty)),
  ) : of(empty), {initialValue: empty});
  readonly owner = computed(() => {
    const owner = this.snapshot().owner;
    return owner?.session === this.auth.currentUser ? owner : null;
  });
  readonly view = computed(() => buildHistoryImportProgress(this.owner() ? this.snapshot().sources : [], Math.max(this.now(), Date.now())));

  constructor() {
    effect(() => {
      const deadline = this.view().nextExpiryAtMs;
      if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
      if (deadline === null || !this.browser) return;
      // Expiry is a display deadline. Keep its timer outside Angular stability work;
      // it never polls Firestore or changes the underlying import.
      this.expiryTimer = this.zone.runOutsideAngular(() => setTimeout(() => {
        this.zone.run(() => this.now.set(Date.now()));
      }, Math.max(1, Math.min(deadline - Date.now(), 2_147_483_647))));
    });
    this.destroyRef.onDestroy(() => { if (this.expiryTimer !== null) clearTimeout(this.expiryTimer); });
  }
  refresh(): void { if (this.owner()) this.refresh$.next(); }
}
