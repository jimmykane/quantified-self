import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import type { EventInterface } from '@sports-alliance/sports-lib';
import type { TrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';
import { Subscription } from 'rxjs';
import type { AppUserInterface } from '../../../models/app-user.interface';
import { AppUserService } from '../../../services/app.user.service';
import { ActivityCalendarService } from '../../../services/activity-calendar.service';
import { TrainingPlansService, selectCalendarVisibleScheduledWorkouts } from '../../../services/training-plans.service';
import { buildDashboardDailyBriefing, dashboardBriefingWindow, type DashboardBriefingLoadComparison } from '../../../helpers/dashboard-daily-briefing.helper';
import type { CalendarPeriodSchedule, CalendarPeriodSource } from '../../../helpers/calendar-period-summary.helper';
import type { HealthChangeSignal } from '../../../helpers/health-change-summary.helper';
import type { TimelineNoteChartContext } from '../../../helpers/timeline-notes-chart.helper';
import { SummaryDisclosureComponent } from '../../shared/summary-disclosure/summary-disclosure.component';

const pending = <T>(data: T): CalendarPeriodSource<T> => ({ status: 'loading', complete: false, data });

/** Owner-only, bounded daily context. No mutations, historical Training model, or new score. */
@Component({
  selector: 'app-dashboard-daily-briefing', standalone: true, imports: [SummaryDisclosureComponent],
  templateUrl: './dashboard-daily-briefing.component.html', styleUrl: './dashboard-daily-briefing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardDailyBriefingComponent {
  readonly user = input.required<AppUserInterface>();
  readonly signals = input.required<readonly HealthChangeSignal[]>();
  readonly notesContext = input<TimelineNoteChartContext | null>(null);
  readonly notesStatus = input<'loading' | 'ready' | 'error'>('loading');
  readonly recoveryText = input('');
  readonly sleepText = input('');
  readonly loadComparison = input<DashboardBriefingLoadComparison | null>(null);
  private readonly users = inject(AppUserService);
  private readonly calendar = inject(ActivityCalendarService);
  private readonly plans = inject(TrainingPlansService);
  private readonly document = inject(DOCUMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly now = signal(Date.now());
  private readonly retry = signal(0);
  readonly owner = computed(() => this.user()?.uid && this.users.user()?.uid === this.user().uid ? this.user().uid : null);
  private readonly window = computed(() => dashboardBriefingWindow(this.now(), this.user().settings?.unitSettings?.startOfTheWeek));
  private readonly readKey = computed(() => JSON.stringify([this.owner(), this.window(), this.retry()]));
  private readonly events = signal(pending<readonly EventInterface[]>([]));
  private readonly schedule = signal(pending<CalendarPeriodSchedule | null>(null));
  private readonly completions = signal(pending<readonly TrainingWorkoutCompletionV1[]>([]));
  private readonly loadedKey = signal('');
  readonly briefing = computed(() => {
    const current = this.loadedKey() === this.readKey();
    const notes = this.notesContext();
    return buildDashboardDailyBriefing({ nowMs: this.now(), window: this.window(), signals: this.signals(),
      events: current ? this.events() : pending([]), schedule: current ? this.schedule() : pending(null),
      completions: current ? this.completions() : pending([]),
      notes: notes?.ownerUid === this.owner() ? notes.notes : [], notesReady: this.notesStatus() === 'ready',
      recoveryText: this.recoveryText(), sleepText: this.sleepText(), loadComparison: this.loadComparison(),
      unitSettings: this.user().settings?.unitSettings, locale: this.locale });
  });

  constructor() {
    effect(onCleanup => {
      const key = this.readKey();
      const uid = this.owner();
      const window = untracked(this.window);
      this.loadedKey.set(key); this.events.set(pending([])); this.schedule.set(pending(null)); this.completions.set(pending([]));
      if (!uid) return;
      const subscriptions = new Subscription();
      let completionSubscription: Subscription | undefined;
      let active = true;
      let generation = 0;
      const current = () => active && this.owner() === uid && this.readKey() === key;
      subscriptions.add(this.calendar.watchSummaryEvents(untracked(this.user), {
        startMs: window.todayStartMs, endExclusiveMs: window.tomorrowMs,
      }).subscribe({ next: result => { if (current()) this.events.set({ status: 'ready', data: result.events, complete: result.complete }); },
        error: () => { if (current()) this.events.set({ status: 'error', data: [], complete: false }); } }));
      subscriptions.add(this.plans.watchCalendarSchedule(uid, window.weekStart, window.scheduleEnd).subscribe({ next: result => {
        if (!current()) return;
        const version = ++generation;
        completionSubscription?.unsubscribe(); this.completions.set(pending([]));
        if (result.restoreUnavailable) { this.schedule.set({ status: 'error', data: null, complete: false }); return; }
        const workouts = selectCalendarVisibleScheduledWorkouts(result, window.weekStart, window.scheduleEnd);
        this.schedule.set({ status: 'ready', data: { state: result.state, workouts }, complete: result.workoutsComplete !== false });
        completionSubscription = this.plans.watchWorkoutCompletionsForWorkouts(uid, workouts.map(workout => workout.id)).subscribe({
          next: links => { if (current() && generation === version) this.completions.set({ status: 'ready', complete: true, data: links }); },
          error: () => { if (current() && generation === version) this.completions.set({ status: 'error', complete: false, data: [] }); },
        });
      }, error: () => {
        if (!current()) return;
        generation++; completionSubscription?.unsubscribe();
        this.schedule.set({ status: 'error', complete: false, data: null }); this.completions.set(pending([]));
      } }));
      onCleanup(() => { active = false; subscriptions.unsubscribe(); completionSubscription?.unsubscribe(); });
    });
    const noteRangeKey = {};
    // Keep the same registration while the shared note context emits edits/loading changes.
    const noteRegistration = computed(() => {
      const context = this.notesContext();
      const owner = this.owner();
      return context && owner && context.ownerUid === owner
        ? { owner, today: this.window().today, reportRange: context.reportRange } : null;
    }, {
      equal: (previous, next) => previous?.owner === next?.owner && previous?.today === next?.today
        && previous?.reportRange === next?.reportRange,
    });
    effect(onCleanup => {
      const registration = noteRegistration();
      if (!registration) return;
      registration.reportRange(noteRangeKey, { startDate: registration.today, endDate: registration.today });
      onCleanup(() => registration.reportRange(noteRangeKey, null));
    });
    effect(onCleanup => {
      if (!this.owner()) return;
      const tick = () => this.now.set(Date.now());
      let timer: ReturnType<typeof setInterval> | null = null;
      const pause = () => { if (timer !== null) clearInterval(timer); timer = null; };
      const focus = () => {
        pause();
        if (this.document.visibilityState === 'hidden') return;
        tick(); timer = setInterval(tick, 60_000);
        if (this.events().status === 'error' || this.schedule().status === 'error'
          || this.completions().status === 'error') this.retry.update(value => value + 1);
      };
      if (this.document.visibilityState !== 'hidden') timer = setInterval(tick, 60_000);
      this.document.defaultView?.addEventListener('focus', focus);
      this.document.addEventListener('visibilitychange', focus);
      onCleanup(() => {
        pause(); this.document.defaultView?.removeEventListener('focus', focus);
        this.document.removeEventListener('visibilitychange', focus);
      });
    });
  }
}
