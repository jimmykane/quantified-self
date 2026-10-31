import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Auth, type FirebaseUserType } from 'app/firebase/auth';
import { defaultDayWorkoutControls, dayWorkoutLocalDate, parseGenerateDayWorkoutRequest } from '@shared/day-workout';
import { parseDailyWorkoutSuggestionPreferences, type DailyWorkoutSuggestionPreferences, type DailyWorkoutSuggestionRequest, type DailyWorkoutSuggestionStatus } from '@shared/daily-workout-suggestion';
import { AppFunctionsService } from './app.functions.service';
import { AppUserService } from './app.user.service';
import { AppAnalyticsService } from './app.analytics.service';
import { AppWindowService } from './app.window.service';
import { TrainingPlansService } from './training-plans.service';
import { parseWorkoutStructureV1 } from '@shared/planned-workout';
import { isStrengthWorkoutSportV1, parseStrengthWorkoutDraftV1, strengthProjectionMatchesDetails } from '@shared/strength-workout';
import { DAILY_WORKOUT_SUGGESTION_SESSION_CACHE_KEY as CACHE_KEY } from '../shared/daily-workout-suggestion-cache';
import { firstValueFrom, take } from 'rxjs';

const MAX_CACHE_CHARACTERS = 400_000;
const states: DailyWorkoutSuggestionStatus['state'][] = ['off', 'waiting', 'waiting-sleep', 'ready', 'dismissed', 'failed', 'planned', 'completed', 'rest-day'];
interface CachedDailyWorkoutSuggestion {
  key: string; uid: string; status: DailyWorkoutSuggestionStatus | null; sleepKey: string | null;
  scheduleRevision?: number | null;
  restDayRevision?: number;
}
interface DailyWorkoutSuggestionCache extends CachedDailyWorkoutSuggestion {
  authUser: FirebaseUserType | null; epoch: number; observedSleepKey: string | null;
  pending: Map<string, Promise<DailyWorkoutSuggestionStatus>>;
}

@Injectable({ providedIn: 'root' })
export class DailyWorkoutSuggestionService {
  private readonly auth = inject(Auth);
  private readonly users = inject(AppUserService);
  private readonly functions = inject(AppFunctionsService);
  private readonly analytics = inject(AppAnalyticsService);
  private readonly window = inject(AppWindowService);
  private readonly plans = inject(TrainingPlansService);
  private readonly restReadScope = computed(() => {
    const uid = this.users.user()?.uid, preferences = this.preferences();
    return uid && this.eligible(uid) && preferences.enabled ? JSON.stringify([uid, preferences.controls.localDate]) : '';
  });
  private cache: DailyWorkoutSuggestionCache | null = null;
  readonly cacheRevision = signal(0);
  private writes: Promise<void> = Promise.resolve();
  readonly saving = signal(false);
  isOwner(uid: string): boolean { return !!uid && this.auth.currentUser?.uid === uid && this.users.user()?.uid === uid; }
  eligible(uid: string): boolean { return this.isOwner(uid) && this.users.isProSignal(); }
  preferences(): DailyWorkoutSuggestionPreferences {
    try { return parseDailyWorkoutSuggestionPreferences(this.users.user()?.settings?.appSettings?.dailyWorkoutSuggestion); }
    catch {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return { enabled: false, followRoutine: true, controls: defaultDayWorkoutControls(dayWorkoutLocalDate(new Date(), zone), zone) };
    }
  }
  constructor() {
    effect(onCleanup => {
      const key = this.restReadScope();
      if (!key) return;
      const [uid, localDate] = JSON.parse(key) as [string, string];
      const subscription = this.plans.watchCalendarRestDay(uid, localDate).subscribe({ next: record => untracked(() => {
        if (!this.eligible(uid) || this.preferences().controls.localDate !== localDate) return;
        this.acceptRestDayRevision(uid, localDate, record?.revision ?? 0);
        if (record?.isRestDay && this.cache?.status?.state !== 'dismissed') this.remember(uid, { localDate, state: 'rest-day' });
      }), error: () => untracked(() => {
        if (this.cache?.uid === uid && this.cache.status?.state !== 'dismissed') { this.invalidate(); this.persist(); }
      }) });
      onCleanup(() => subscription.unsubscribe());
    });
    effect(() => {
      const uid = this.users.user()?.uid, pro = this.users.isProSignal();
      if (this.cache && (this.cache.uid !== uid || !pro)) untracked(() => this.clear());
    });
    this.plans.stateRevisionChanges$.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(({ uid, revision }) => {
      this.acceptScheduleRevision(uid, revision);
    });
    this.plans.calendarRestDayChanges$.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(({ uid, localDate, revision }) => {
      this.acceptRestDayRevision(uid, localDate, revision);
    });
  }
  private acceptRestDayRevision(uid: string, localDate: string, revision: number): void {
    if (!this.cache || this.cache.uid !== uid || !this.eligible(uid) || localDate !== this.preferences().controls.localDate
      || this.cache.key !== this.key(uid) || this.cache.restDayRevision === revision) return;
    const previous = this.cache.restDayRevision;
    this.cache.restDayRevision = revision;
    if ((previous !== undefined || this.cache.status) && this.cache.status?.state !== 'dismissed') this.invalidate();
    this.persist();
  }
  private acceptScheduleRevision(uid: string, revision: number | null): void {
    if (!this.cache || this.cache.uid !== uid || !this.eligible(uid)) return;
    const previous = this.cache.scheduleRevision;
    if (previous === revision) return;
    this.cache.scheduleRevision = revision;
    if ((previous !== undefined || this.cache.status) && this.cache.status?.state !== 'dismissed') this.invalidate();
    this.persist();
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
  private entry(uid: string): DailyWorkoutSuggestionCache {
    const key = this.key(uid);
    if (this.cache?.key === key && this.cache.authUser === this.auth.currentUser) return this.cache;
    this.cache = { key, uid, authUser: this.auth.currentUser, epoch: 0, status: null, sleepKey: null,
      observedSleepKey: null, pending: new Map() };
    try {
      const text = this.window.windowRef.sessionStorage.getItem(CACHE_KEY);
      if (text && text.length <= MAX_CACHE_CHARACTERS) {
        const saved = JSON.parse(text) as CachedDailyWorkoutSuggestion;
        if (saved.key === key && saved.uid === uid && this.validStatus(saved.status)
          && (saved.sleepKey === null || typeof saved.sleepKey === 'string')
          && (saved.scheduleRevision === undefined || saved.scheduleRevision === null || Number.isSafeInteger(saved.scheduleRevision))
          && (saved.restDayRevision === undefined || (Number.isSafeInteger(saved.restDayRevision) && saved.restDayRevision >= 0))) {
          Object.assign(this.cache, { status: saved.status, sleepKey: saved.sleepKey, scheduleRevision: saved.scheduleRevision, restDayRevision: saved.restDayRevision });
        } else this.window.windowRef.sessionStorage.removeItem(CACHE_KEY);
      } else {
        this.window.windowRef.sessionStorage.removeItem(CACHE_KEY);
      }
    } catch { /* A corrupt/unavailable session cache is a miss, never a dashboard failure. */ }
    const revision = this.plans.lastVerifiedStateRevision(uid);
    if (revision !== undefined) this.acceptScheduleRevision(uid, revision);
    const restRevision = this.plans.lastCalendarRestDayRevision(uid, this.preferences().controls.localDate);
    if (restRevision !== undefined) this.acceptRestDayRevision(uid, this.preferences().controls.localDate, restRevision);
    return this.cache;
  }
  private validStatus(status: DailyWorkoutSuggestionStatus | null): status is DailyWorkoutSuggestionStatus {
    try {
      if (!status || !states.includes(status.state) || status.localDate !== this.preferences().controls.localDate) return false;
      if (status.state !== 'ready') return true;
      const result = status.result;
      if (!status.controls || !result || result.requestId !== `daily-suggestion:${status.localDate}`
        || !Number.isFinite(Date.parse(result.observedAt)) || typeof result.rationale !== 'string'
        || ![result.usedContext, result.missingContext].every(items => Array.isArray(items) && items.every(item => typeof item === 'string'))
        || !Array.isArray(result.previousLoads) || !result.previousLoads.every(source => source
          && typeof source.exerciseId === 'string' && typeof source.localDate === 'string')) return false;
      const controls = parseGenerateDayWorkoutRequest({ requestId: result.requestId, controls: status.controls }).controls;
      if (controls.localDate !== status.localDate || controls.timeZone !== this.preferences().controls.timeZone
        || controls.destinationPlanId !== null || !controls.trainingContext || controls.activityContext === false) return false;
      if (result.kind === 'rest') return result.draft === null;
      if (result.kind !== 'workout' || !result.draft || typeof result.draft.title !== 'string') return false;
      const structure = parseWorkoutStructureV1(result.draft.structure);
      if (structure.sport !== controls.sport) return false;
      const estimate = result.draft.estimatedMinutes;
      if (estimate && (!Number.isFinite(estimate.minimum) || !Number.isFinite(estimate.maximum)
        || estimate.minimum < 1 || estimate.maximum < estimate.minimum || estimate.maximum > 480)) return false;
      if (!isStrengthWorkoutSportV1(controls.sport)) return result.draft.strength === undefined && estimate === undefined;
      if (!result.draft.strength) return false;
      const strength = parseStrengthWorkoutDraftV1(result.draft.strength);
      return strengthProjectionMatchesDetails(structure, { ...strength, workoutId: 'draft', revision: 1 });
    } catch { return false; }
  }
  private persist(): void {
    const entry = this.cache;
    try {
      if (!entry?.status || entry.status.state === 'preparing') { this.window.windowRef.sessionStorage.removeItem(CACHE_KEY); return; }
      const { key, uid, status, sleepKey, scheduleRevision, restDayRevision } = entry;
      const text = JSON.stringify({ key, uid, status, sleepKey, scheduleRevision, restDayRevision });
      if (text.length <= MAX_CACHE_CHARACTERS) this.window.windowRef.sessionStorage.setItem(CACHE_KEY, text);
      else this.window.windowRef.sessionStorage.removeItem(CACHE_KEY);
    } catch { /* In-memory caching still works when session storage is unavailable. */ }
  }
  cached(uid: string): Pick<CachedDailyWorkoutSuggestion, 'status' | 'sleepKey'> | null {
    if (!this.eligible(uid)) return null;
    const entry = this.entry(uid);
    if (entry.status?.state !== 'dismissed' && this.plans.lastCalendarRestDayRevision(uid, this.preferences().controls.localDate) === undefined) return null;
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
  remember(uid: string, status: DailyWorkoutSuggestionStatus): void {
    if (!this.eligible(uid) || status.localDate !== this.preferences().controls.localDate) return;
    const entry = this.entry(uid);
    this.invalidate(); entry.status = status; this.persist();
  }
  async request(uid: string, action: DailyWorkoutSuggestionRequest['action'], current: () => boolean, expectedDate?: string,
    refresh = false): Promise<DailyWorkoutSuggestionStatus> {
    if (!this.eligible(uid) || !current()) throw Error('Daily suggestion access changed.');
    if ((action === 'dismiss' || action === 'use-available-data') && !expectedDate) throw Error('Choose the displayed day.');
    const localDate = this.preferences().controls.localDate;
    // A cached recipe cannot establish that no new standalone rest marker exists.
    if (action !== 'dismiss' && this.plans.lastCalendarRestDayRevision(uid, localDate) === undefined) {
      await firstValueFrom(this.plans.watchCalendarRestDay(uid, localDate).pipe(take(1)));
      if (!this.eligible(uid) || !current() || this.preferences().controls.localDate !== localDate) throw Error('Daily suggestion access changed.');
    }
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
    const request: DailyWorkoutSuggestionRequest = action === 'dismiss' || action === 'use-available-data'
      ? { mode: 'daily-suggestion', action, localDate: expectedDate! } : { mode: 'daily-suggestion', action };
    // The shared operation belongs to this authenticated day, not the component that first requested it.
    const pending = this.functions.call<DailyWorkoutSuggestionRequest, DailyWorkoutSuggestionStatus>('generateDayWorkout', request,
      { canExecute: () => active() && (!expectedDate || current()) }).then(({ data }) => {
        if (!active()) throw Error('Daily suggestion access changed.');
        if (data.localDate !== this.preferences().controls.localDate) throw Error('The day changed.');
        entry.status = data;
        // A receipt read does not check current Sleep evidence. Preserve the last actual context check.
        if (action !== 'status' || data.state !== 'waiting-sleep') entry.sleepKey = sleepKey;
        this.persist(); return data;
      }).finally(() => { if (entry.pending.get(action) === pending) entry.pending.delete(action); });
    entry.pending.set(action, pending);
    return pending;
  }
  save(uid: string, value: DailyWorkoutSuggestionPreferences): Promise<void> {
    const preferences = parseDailyWorkoutSuggestionPreferences(value);
    const write = this.writes.then(async () => {
      if (!this.eligible(uid)) throw Error('The signed-in account changed.');
      const user = this.users.user()!;
      const changed = this.key(uid) !== JSON.stringify([uid, preferences]);
      this.saving.set(true);
      try {
        await this.users.updateUserProperties(user, { settings: { appSettings: { dailyWorkoutSuggestion: preferences } } });
        if (changed && this.isOwner(uid)) this.clear();
      }
      finally { this.saving.set(false); }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }
  event(uid: string, action: 'shown' | 'reviewed' | 'added' | 'dismissed' | 'enabled' | 'preferences_saved' | 'disabled' | 'failed',
    state?: DailyWorkoutSuggestionStatus['state']): void {
    if (this.eligible(uid)) this.analytics.logEvent('daily_workout_suggestion', { action, ...(state ? { state } : {}) });
  }
}
