import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Auth, type FirebaseUserType } from 'app/firebase/auth';
import { defaultDayWorkoutControls, dayWorkoutLocalDate } from '@shared/day-workout';
import { parseMorningWorkoutPreferences, type MorningWorkoutPreferences, type MorningWorkoutRequest, type MorningWorkoutStatus } from '@shared/morning-workout';
import { AppFunctionsService } from './app.functions.service';
import { AppUserService } from './app.user.service';
import { AppAnalyticsService } from './app.analytics.service';
import { AppWindowService } from './app.window.service';
import { TrainingPlansService } from './training-plans.service';
import { parseWorkoutStructureV1 } from '@shared/planned-workout';
import { parseStrengthWorkoutDraftV1 } from '@shared/strength-workout';

const CACHE_KEY = 'qs.morning-workout.v1';
const MAX_CACHE_CHARACTERS = 400_000;
const states: MorningWorkoutStatus['state'][] = ['off', 'waiting', 'waiting-sleep', 'ready', 'dismissed', 'failed', 'planned', 'completed', 'rest-day'];
interface CachedMorningWorkout {
  key: string; uid: string; status: MorningWorkoutStatus | null; sleepKey: string | null;
  scheduleRevision?: number | null;
}
interface MorningWorkoutCache extends CachedMorningWorkout {
  authUser: FirebaseUserType | null; epoch: number; observedSleepKey: string | null;
  pending: Map<string, Promise<MorningWorkoutStatus>>;
}

@Injectable({ providedIn: 'root' })
export class MorningWorkoutService {
  private readonly auth = inject(Auth);
  private readonly users = inject(AppUserService);
  private readonly functions = inject(AppFunctionsService);
  private readonly analytics = inject(AppAnalyticsService);
  private readonly window = inject(AppWindowService);
  private readonly plans = inject(TrainingPlansService);
  private cache: MorningWorkoutCache | null = null;
  readonly cacheRevision = signal(0);
  private writes: Promise<void> = Promise.resolve();
  readonly saving = signal(false);
  isOwner(uid: string): boolean { return !!uid && this.auth.currentUser?.uid === uid && this.users.user()?.uid === uid; }
  eligible(uid: string): boolean { return this.isOwner(uid) && this.users.isProSignal(); }
  preferences(): MorningWorkoutPreferences {
    try { return parseMorningWorkoutPreferences(this.users.user()?.settings?.appSettings?.morningWorkout); }
    catch {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return { enabled: false, followRoutine: true, controls: defaultDayWorkoutControls(dayWorkoutLocalDate(new Date(), zone), zone) };
    }
  }
  constructor() {
    effect(() => {
      const uid = this.users.user()?.uid, pro = this.users.isProSignal();
      if (this.cache && (this.cache.uid !== uid || !pro)) untracked(() => this.clear());
    });
    this.plans.stateRevisionChanges$.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(({ uid, revision }) => {
      if (!this.cache || this.cache.uid !== uid || !this.eligible(uid)) return;
      const previous = this.cache.scheduleRevision;
      if (previous === revision) return;
      this.cache.scheduleRevision = revision;
      if (previous !== undefined && previous !== revision && this.cache.status?.state !== 'dismissed') this.invalidate();
      this.persist();
    });
  }
  private key(uid: string): string { return JSON.stringify([uid, this.preferences()]); }
  private clear(): void {
    this.cache = null; this.cacheRevision.update(value => value + 1);
    try { this.window.windowRef.sessionStorage.removeItem(CACHE_KEY); } catch { /* Storage may be blocked. */ }
  }
  private invalidate(): void {
    if (!this.cache) return;
    this.cache.epoch++; this.cache.pending.clear(); this.cache.status = null;
    this.cacheRevision.update(value => value + 1);
  }
  private entry(uid: string): MorningWorkoutCache {
    const key = this.key(uid);
    if (this.cache?.key === key && this.cache.authUser === this.auth.currentUser) return this.cache;
    this.cache = { key, uid, authUser: this.auth.currentUser, epoch: 0, status: null, sleepKey: null,
      observedSleepKey: null, pending: new Map() };
    try {
      const text = this.window.windowRef.sessionStorage.getItem(CACHE_KEY);
      if (text && text.length <= MAX_CACHE_CHARACTERS) {
        const saved = JSON.parse(text) as CachedMorningWorkout;
        if (saved.key === key && saved.uid === uid && this.validStatus(saved.status)
          && (saved.sleepKey === null || typeof saved.sleepKey === 'string')
          && (saved.scheduleRevision === undefined || saved.scheduleRevision === null || Number.isSafeInteger(saved.scheduleRevision))) {
          Object.assign(this.cache, { status: saved.status, sleepKey: saved.sleepKey, scheduleRevision: saved.scheduleRevision });
          return this.cache;
        }
      }
      this.window.windowRef.sessionStorage.removeItem(CACHE_KEY);
    } catch { /* A corrupt/unavailable session cache is a miss, never a dashboard failure. */ }
    return this.cache;
  }
  private validStatus(status: MorningWorkoutStatus | null): status is MorningWorkoutStatus {
    try {
      if (!status || !states.includes(status.state) || status.localDate !== this.preferences().controls.localDate) return false;
      if (status.state !== 'ready') return true;
      const result = status.result;
      if (!status.controls || !result || result.requestId !== `morning:${status.localDate}`
        || !Number.isFinite(Date.parse(result.observedAt)) || typeof result.rationale !== 'string'
        || ![result.usedContext, result.missingContext].every(items => Array.isArray(items) && items.every(item => typeof item === 'string'))
        || !Array.isArray(result.previousLoads) || !result.previousLoads.every(source => source
          && typeof source.exerciseId === 'string' && typeof source.localDate === 'string')) return false;
      parseMorningWorkoutPreferences({ enabled: true, followRoutine: true, controls: status.controls });
      if (result.kind === 'rest') return result.draft === null;
      if (result.kind !== 'workout' || !result.draft || typeof result.draft.title !== 'string') return false;
      if (parseWorkoutStructureV1(result.draft.structure).sport !== status.controls.sport) return false;
      const estimate = result.draft.estimatedMinutes;
      if (estimate && (!Number.isFinite(estimate.minimum) || !Number.isFinite(estimate.maximum)
        || estimate.minimum < 1 || estimate.maximum < estimate.minimum || estimate.maximum > 480)) return false;
      if (result.draft.strength) parseStrengthWorkoutDraftV1(result.draft.strength);
      return true;
    } catch { return false; }
  }
  private persist(): void {
    const entry = this.cache;
    try {
      if (!entry?.status || entry.status.state === 'preparing') { this.window.windowRef.sessionStorage.removeItem(CACHE_KEY); return; }
      const { key, uid, status, sleepKey, scheduleRevision } = entry;
      const text = JSON.stringify({ key, uid, status, sleepKey, scheduleRevision });
      if (text.length <= MAX_CACHE_CHARACTERS) this.window.windowRef.sessionStorage.setItem(CACHE_KEY, text);
      else this.window.windowRef.sessionStorage.removeItem(CACHE_KEY);
    } catch { /* In-memory caching still works when session storage is unavailable. */ }
  }
  cached(uid: string): Pick<CachedMorningWorkout, 'status' | 'sleepKey'> | null {
    if (!this.eligible(uid)) return null;
    const entry = this.entry(uid);
    return entry.status && entry.pending.size === 0 ? { status: entry.status, sleepKey: entry.sleepKey } : null;
  }
  observeSleep(uid: string, key: string): void {
    if (!this.eligible(uid)) return;
    const entry = this.entry(uid);
    entry.observedSleepKey = key;
    if (entry.status?.state === 'waiting-sleep' && entry.sleepKey !== key && entry.pending.size === 0) {
      this.invalidate(); this.persist();
    }
  }
  remember(uid: string, status: MorningWorkoutStatus): void {
    if (!this.eligible(uid)) return;
    const entry = this.entry(uid);
    this.invalidate(); entry.status = status; this.persist();
  }
  async request(uid: string, action: MorningWorkoutRequest['action'], current: () => boolean, expectedDate?: string,
    refresh = false): Promise<MorningWorkoutStatus> {
    if (!this.eligible(uid) || !current()) throw Error('Morning suggestion access changed.');
    if ((action === 'dismiss' || action === 'use-available-data') && !expectedDate) throw Error('Choose the displayed day.');
    const entry = this.entry(uid);
    if (expectedDate && expectedDate !== this.preferences().controls.localDate) throw Error('The displayed day changed.');
    const existing = entry.pending.get(action);
    if (existing) return existing;
    if (action === 'status' && !refresh && entry.status) return entry.status;
    if (action === 'prepare' && entry.status && !['waiting', 'waiting-sleep'].includes(entry.status.state)) return entry.status;
    if (action === 'dismiss') this.invalidate();
    const epoch = entry.epoch, sleepKey = entry.observedSleepKey;
    const active = () => this.cache === entry && entry.epoch === epoch && entry.authUser === this.auth.currentUser
      && this.eligible(uid) && this.key(uid) === entry.key;
    const request: MorningWorkoutRequest = action === 'dismiss' || action === 'use-available-data'
      ? { mode: 'morning', action, localDate: expectedDate! } : { mode: 'morning', action };
    // The shared operation belongs to this authenticated day, not the component that first requested it.
    const pending = this.functions.call<MorningWorkoutRequest, MorningWorkoutStatus>('generateDayWorkout', request,
      { canExecute: () => active() && (!expectedDate || current()) }).then(({ data }) => {
        if (!active()) throw Error('Morning suggestion access changed.');
        if (data.localDate !== this.preferences().controls.localDate) throw Error('The day changed.');
        entry.status = data;
        // A receipt read does not check current Sleep evidence. Preserve the last actual context check.
        if (action !== 'status' || data.state !== 'waiting-sleep') entry.sleepKey = sleepKey;
        this.persist(); return data;
      }).finally(() => { if (entry.pending.get(action) === pending) entry.pending.delete(action); });
    entry.pending.set(action, pending);
    return pending;
  }
  save(uid: string, value: MorningWorkoutPreferences): Promise<void> {
    const preferences = parseMorningWorkoutPreferences(value);
    const write = this.writes.then(async () => {
      if (!this.eligible(uid)) throw Error('The signed-in account changed.');
      const user = this.users.user()!;
      const changed = this.key(uid) !== JSON.stringify([uid, preferences]);
      this.saving.set(true);
      try {
        await this.users.updateUserProperties(user, { settings: { appSettings: { morningWorkout: preferences } } });
        if (changed && this.isOwner(uid)) this.clear();
      }
      finally { this.saving.set(false); }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }
  event(uid: string, action: 'shown' | 'reviewed' | 'added' | 'dismissed' | 'enabled' | 'preferences_saved' | 'disabled' | 'failed',
    state?: MorningWorkoutStatus['state']): void {
    if (this.eligible(uid)) this.analytics.logEvent('morning_workout', { action, ...(state ? { state } : {}) });
  }
}
