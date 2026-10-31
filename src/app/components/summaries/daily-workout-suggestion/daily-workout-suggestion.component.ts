import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { DailyWorkoutSuggestionStatus } from '@shared/daily-workout-suggestion';
import { formatWorkoutPrescriptionSummaryV1 } from '@shared/planned-workout-analysis-display';
import { DailyWorkoutSuggestionService } from '../../../services/daily-workout-suggestion.service';
import { DayWorkoutService } from '../../../services/day-workout.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppChartSharedModule } from '../../../modules/app-chart-shared.module';
import { CompactRowComponent } from '../../shared/compact-row/compact-row.component';
import { AppUserService } from '../../../services/app.user.service';
import { selectCalendarVisibleScheduledWorkouts, TrainingPlansService } from '../../../services/training-plans.service';

@Component({ selector: 'app-daily-workout-suggestion', standalone: true,
  imports: [CompactRowComponent, MatButtonModule, MatIconModule, MatMenuModule, MatProgressBarModule, AppChartSharedModule],
  templateUrl: './daily-workout-suggestion.component.html', styleUrl: './daily-workout-suggestion.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class DailyWorkoutSuggestionComponent {
  readonly ownerUid = input.required<string>();
  // The parent's browser date refreshes preferences; the saved-zone date owns the daily scope.
  readonly localDate = input.required<string>();
  readonly dataReady = input(false);
  readonly sleepRevision = input(0);
  readonly sleepKey = input<string | null>(null);
  private readonly evidenceKey = computed(() => this.sleepKey() ?? String(this.sleepRevision()));
  readonly daily = inject(DailyWorkoutSuggestionService);
  private readonly generation = inject(DayWorkoutService);
  private readonly users = inject(AppUserService);
  private readonly plans = inject(TrainingPlansService);
  private readonly haptics = inject(AppHapticsService);
  private readonly destroy = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  readonly eligible = computed(() => this.daily.eligible(this.ownerUid()));
  readonly visible = signal(this.document.visibilityState !== 'hidden');
  // Re-evaluate the saved-zone date on foreground return; equal same-day values retain the cache scope.
  readonly preferences = computed(() => { this.localDate(); this.visible(); return this.daily.preferences(); },
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  readonly status = signal<DailyWorkoutSuggestionStatus | null>(null);
  private readonly loading = signal(false);
  readonly actionBusy = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly busy = computed(() => this.loading() || this.actionBusy() || this.daily.saving());
  readonly error = signal(false);
  // Reuse Calendar's bounded reader only for the current owner's planned date.
  private readonly plannedScope = computed(() => {
    const preferences = this.preferences(), status = this.status();
    return this.eligible() && preferences.enabled && status?.state === 'planned'
      && status.localDate === preferences.controls.localDate ? { uid: this.ownerUid(), date: status.localDate } : null;
  }, { equal: (left, right) => left?.uid === right?.uid && left?.date === right?.date });
  private readonly savedWorkouts = toSignal(toObservable(this.plannedScope).pipe(switchMap(scope => scope
    ? this.plans.watchCalendarSchedule(scope.uid, scope.date, scope.date).pipe(
      map(schedule => ({ ...scope, schedule })), catchError(() => of(null)))
    : of(null))), { initialValue: null });
  readonly plannedWorkouts = computed(() => {
    const scope = this.plannedScope(), saved = this.savedWorkouts();
    if (!scope || saved?.uid !== scope.uid || saved.date !== scope.date || saved.schedule.restoreUnavailable
      || saved.schedule.workoutsComplete === false) return [];
    return selectCalendarVisibleScheduledWorkouts(saved.schedule, scope.date, scope.date)
      .filter(workout => workout.lifecycle === 'planned');
  });
  readonly title = computed(() => {
    if (!this.preferences().enabled) return 'Daily workout suggestion · Pro';
    if (this.status()?.state !== 'planned') return 'Today’s suggestion';
    return this.plannedWorkouts().length > 1 ? 'Today’s workouts' : 'Today’s workout';
  });
  readonly summary = computed(() => {
    const value = this.status();
    if (value?.state === 'ready' && value.result) {
      const draft = value.result.draft;
      return draft ? `${draft.title} · ${formatWorkoutPrescriptionSummaryV1(draft.structure, this.users.user()?.settings?.unitSettings, draft.structure.sport)}` : 'A recovery day';
    }
    const planned = this.plannedWorkouts();
    if (planned.length) {
      const workout = planned[0];
      return `${workout.title} · ${formatWorkoutPrescriptionSummaryV1(workout.structure, this.users.user()?.settings?.unitSettings, workout.structure.sport)}`
        + (planned.length > 1 ? ` · +${planned.length - 1} more` : '');
    }
    if (this.busy()) return 'Preparing with your latest available context…';
    if (this.error() || value?.state === 'failed') return 'Today’s suggestion could not finish.';
    if (value?.state === 'planned') return 'Your workout is planned for today.';
    if (value?.state === 'completed') return 'You already recorded a workout today.';
    if (value?.state === 'rest-day') return 'Today is a planned rest day.';
    if (value?.state === 'dismissed') return 'Dismissed for today.';
    if (value?.state === 'preparing') return 'Your suggestion is being prepared.';
    if (value?.state === 'waiting-sleep') return 'Waiting for your latest sleep…';
    return 'Prepared on your first visit to Today each day.';
  });
  private sequence = 0;
  private actionSequence = 0;
  private shown = new Set<string>();
  private checkedSleepKey: string | null = null;
  private readScope = '';
  constructor() {
    const visibility = () => this.visible.set(this.document.visibilityState !== 'hidden');
    this.document.addEventListener('visibilitychange', visibility);
    this.destroy.onDestroy(() => { this.sequence++; this.actionSequence++; this.document.removeEventListener('visibilitychange', visibility); });
    effect(onCleanup => {
      // Track only the owner, day, settled Today data, preferences and foreground state.
      const eligible = this.eligible(), preferences = this.preferences(), saving = this.daily.saving();
      const ready = this.dataReady(), visible = this.visible(), sleepKey = this.evidenceKey();
      if (eligible && preferences.enabled && ready) untracked(() => this.daily.observeSleep(this.ownerUid(), sleepKey));
      const scope = JSON.stringify([this.ownerUid(), eligible, preferences, this.daily.cacheRevision()]);
      // Hydration is a start barrier, not authority to discard work already running for this same scope.
      if (scope !== this.readScope) {
        this.readScope = scope; this.sequence++;
        const cached = eligible && preferences.enabled ? untracked(() => this.daily.cached(this.ownerUid())) : null;
        this.status.set(cached?.status ?? null); this.checkedSleepKey = cached?.sleepKey ?? null;
        this.error.set(false); this.loading.set(false);
      }
      if (!eligible || !preferences.enabled || saving || !ready || !visible || untracked(() => this.loading() || this.error())) return;
      const status = untracked(() => this.status());
      // Foreground return may start previously deferred work, but never reload an already checked suggestion.
      // Sleep changes have their own revision-bound retry below; other retries remain explicit.
      if (status && status.state !== 'waiting') return;
      const timer = setTimeout(() => { untracked(() => { void this.load(false, false); }); }, 1500);
      onCleanup(() => clearTimeout(timer));
    });
    effect(() => {
      const controls = this.preferences().controls;
      // Only account/day changes retire user actions; a settings acknowledgement must not swallow their outcome.
      const scope = JSON.stringify([this.ownerUid(), this.eligible(), controls.localDate, controls.timeZone]);
      if (scope !== this.actionScope) {
        this.actionScope = scope; this.actionSequence++; this.actionBusy.set(false); this.actionError.set(null);
      }
    });
    effect(onCleanup => {
      const revision = this.evidenceKey(), waiting = this.status()?.state === 'waiting-sleep';
      // React to existing Sleep listener updates, including ones arriving during a context read; never poll.
      if (!waiting || this.busy() || revision === this.checkedSleepKey || !this.eligible()
        || !this.preferences().enabled || !this.dataReady() || !this.visible()) return;
      const timer = setTimeout(() => untracked(() => { void this.load(); }), 1500);
      onCleanup(() => clearTimeout(timer));
    });
    effect(() => {
      const status = this.status(), uid = this.ownerUid();
      if (!this.eligible() || !this.preferences().enabled || !this.visible() || !status
        || !['ready', 'planned', 'completed', 'rest-day'].includes(status.state)) return;
      untracked(() => {
        const key = `${uid}:${status.localDate}:${status.state}`;
        if (this.shown.has(key)) return;
        this.shown.add(key); this.daily.event(uid, 'shown', status.state);
      });
    });
  }
  private actionScope = '';
  private current(sequence: number, uid: string): boolean {
    return !this.destroy.destroyed && sequence === this.sequence && uid === this.ownerUid() && this.daily.eligible(uid);
  }
  async load(useAvailableData = false, refresh = true): Promise<void> {
    const uid = this.ownerUid();
    if (this.busy() || !this.daily.eligible(uid) || !this.preferences().enabled || !this.visible() || !this.dataReady()) return;
    if (useAvailableData && this.status()?.state !== 'waiting-sleep') return;
    const sequence = ++this.sequence;
    this.checkedSleepKey = this.evidenceKey();
    this.loading.set(true); this.error.set(false);
    try {
      let status = useAvailableData
        ? await this.daily.request(uid, 'use-available-data', () => this.current(sequence, uid), this.status()!.localDate)
        : await this.daily.request(uid, 'status', () => this.current(sequence, uid), undefined, refresh);
      if (!this.current(sequence, uid)) return;
      if (!useAvailableData && ['waiting', 'waiting-sleep'].includes(status.state)) {
        if (this.dataReady() && this.visible()) {
          status = await this.daily.request(uid, 'prepare', () => this.current(sequence, uid));
        } else if (status.state === 'waiting-sleep') {
          // A status-only read did not check current Sleep context; resume once the start barriers settle.
          this.checkedSleepKey = null;
        }
      }
      if (!this.current(sequence, uid)) return;
      this.status.set(status);
    } catch { if (this.current(sequence, uid)) { this.error.set(true); this.daily.event(uid, 'failed'); } }
    finally { if (this.current(sequence, uid)) this.loading.set(false); }
  }
  async configure(): Promise<void> {
    const uid = this.ownerUid(), preferences = this.preferences();
    await this.generation.open(uid, preferences.controls.localDate, preferences.controls.sport, {
      mode: 'preferences', initialControls: preferences.controls, followRoutine: preferences.followRoutine,
      savePreferences: async (controls, followRoutine) => {
        await this.daily.save(uid, { enabled: true, controls, followRoutine });
        this.daily.event(uid, preferences.enabled ? 'preferences_saved' : 'enabled');
      },
    });
  }
  async review(): Promise<void> {
    const uid = this.ownerUid();
    if (this.busy() || this.status()?.state !== 'ready' || !this.preferences().enabled || !this.daily.eligible(uid)) return;
    const sequence = ++this.sequence;
    this.loading.set(true); this.actionError.set(null);
    let value: DailyWorkoutSuggestionStatus;
    try {
      // An imported activity may cover today since this browser last fetched its daily result.
      value = await this.daily.request(uid, 'status', () => this.current(sequence, uid), undefined, true);
      if (!this.current(sequence, uid)) return;
      this.status.set(value);
    } catch {
      if (this.current(sequence, uid)) {
        this.actionError.set('Today could not be checked. Try Review again.'); this.haptics.error();
      }
      return;
    } finally { if (this.current(sequence, uid)) this.loading.set(false); }
    if (value.state !== 'ready' || !value.controls || !value.result) return;
    this.daily.event(uid, 'reviewed', 'ready');
    await this.generation.open(uid, value.localDate, value.controls.sport, { initialControls: value.controls, initialResult: value.result,
      onAdded: () => {
        if (!this.daily.eligible(uid) || this.daily.preferences().controls.localDate !== value.localDate) return;
        this.daily.event(uid, 'added', 'ready');
        const status: DailyWorkoutSuggestionStatus = { localDate: value.localDate, state: 'planned' };
        this.daily.remember(uid, status);
        if (!this.destroy.destroyed && this.ownerUid() === uid) {
          this.status.set(status);
        }
      },
    });
  }
  async manual(): Promise<void> {
    const uid = this.ownerUid(), controls = this.preferences().controls;
    await this.generation.open(uid, controls.localDate, controls.sport, { initialControls: controls });
  }
  private currentAction(sequence: number, uid: string, date: string): boolean {
    return !this.destroy.destroyed && sequence === this.actionSequence && uid === this.ownerUid()
      && this.daily.eligible(uid) && this.preferences().controls.localDate === date;
  }
  async dismiss(): Promise<void> {
    const uid = this.ownerUid(), date = this.status()?.localDate || this.preferences().controls.localDate;
    if (this.busy() || !this.daily.eligible(uid) || !this.preferences().enabled) return;
    const sequence = ++this.actionSequence;
    this.actionBusy.set(true); this.actionError.set(null);
    try {
      const status = await this.daily.request(uid, 'dismiss', () => this.currentAction(sequence, uid, date), date);
      if (this.currentAction(sequence, uid, date)) { this.status.set(status); this.haptics.success(); this.daily.event(uid, 'dismissed'); }
    } catch { if (this.currentAction(sequence, uid, date)) { this.actionError.set('Today could not be dismissed. Try again from the options menu.'); this.haptics.error(); } }
    finally { if (this.currentAction(sequence, uid, date)) this.actionBusy.set(false); }
  }
  async disable(): Promise<void> {
    const uid = this.ownerUid(), preferences = this.preferences(), date = preferences.controls.localDate;
    if (this.busy() || !this.daily.eligible(uid)) return;
    const sequence = ++this.actionSequence;
    this.actionBusy.set(true); this.actionError.set(null);
    try {
      await this.daily.save(uid, { ...preferences, enabled: false });
      if (this.currentAction(sequence, uid, date)) { this.haptics.success(); this.daily.event(uid, 'disabled'); }
    } catch { if (this.currentAction(sequence, uid, date)) { this.actionError.set('Daily preferences could not be saved. Try again from the options menu.'); this.haptics.error(); } }
    finally { if (this.currentAction(sequence, uid, date)) this.actionBusy.set(false); }
  }
}
