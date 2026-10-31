import { DayWorkoutService } from '../../../services/day-workout.service';
import type { EventRead } from '@shared/event-read';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { isTrainingLocalDateWithinPlan, type TrainingPlanV1 } from '@shared/training-plans';
import { Router } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { isTimelineNoteVisible, timelineNoteOverlaps, TIMELINE_NOTE_LABELS } from '@shared/timeline-notes';
import { getEventTags } from '@shared/event-tags';

import type { TimelineNote } from '@shared/timeline-notes';
import { AppThemes } from '@sports-alliance/sports-lib';
import { SharedModule } from '../../../modules/shared.module';
import { AppUserService } from '../../../services/app.user.service';
import { CalendarDayHealthService } from '../../../services/calendar-day-health.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import { TrainingWorkoutDuplicateService } from '../../../services/training-workout-duplicate.service';
import { TrainingPlansService } from '../../../services/training-plans.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { buildCalendarDayHealthSummary, buildCalendarDaySleepFacts, resolveCalendarDaySleepPoint, type CalendarDayHealthSummary } from '../../../helpers/calendar-day-health.helper';
import type { DashboardSleepTrendPoint } from '../../../helpers/dashboard-sleep-chart.helper';
import { HealthSleepStageSummaryComponent } from '../../health/health-sleep-stage-summary.component';
import {
  buildActivityCalendarPeriodSummary,
  formatActivityCalendarDuration,
  formatActivityCalendarSummaryMetrics,
  resolveActivityCalendarEventDurationSeconds,
  resolveActivityCalendarEventLabel,
} from '../../../helpers/activity-calendar.helper';
import { buildActivityCalendarFamilyVolumeRows } from '../../../helpers/activity-calendar-volume.helper';
import { ActivityCalendarVolumeListComponent } from '../activity-calendar-volume-list/activity-calendar-volume-list.component';
import { TIMELINE_NOTE_ICONS, timelineNoteColor } from '../../../helpers/timeline-note-appearance.helper';
import { formatManualWorkoutStructure } from '../../../helpers/planned-workout-editor.helper';
import { getDateTimeFormatter } from '../../../helpers/date-time-format.helper';
import { buildCalendarDayStory, formatCalendarDayNoteDates } from '../../../helpers/calendar-day-story.helper';
import type { CalendarDayDetailsData } from '../calendar-day-details/calendar-day-details.component';
import { TrainingImpactComponent } from '../../training-impact/training-impact.component';
import { buildTrainingDayImpactView, buildTrainingSessionImpactView } from '../../../helpers/training-impact.helper';
import type { TrainingImpactSnapshotState } from '../../../services/training-impact.service';
import { buildCalendarPlanPhases } from '../../../helpers/training-plan-phases.helper';
import { CalendarActivityTagsComponent } from '../calendar-activity-tags/calendar-activity-tags.component';
import { buildPlannedWorkoutCalendarOverlay } from '../../../helpers/planned-workout-calendar.helper';

interface HealthState {
  status: 'loading' | 'ready' | 'private' | 'hidden';
  dateKey: string | null;
  ownerUid: string | null;
  summary: CalendarDayHealthSummary | null;
  sleepPoint: DashboardSleepTrendPoint | null;
}

@Component({
  selector: 'app-calendar-day-context',
  standalone: true,
  host: {
    '[class.calendar-day-context--dashboard]': 'dashboardTile()',
    '[class.calendar-day-context--calm-month]': 'calmMonth()',
    '[class.calendar-day-context--compact]': 'compact()',
  },
  imports: [SharedModule, ActivityCalendarVolumeListComponent, HealthSleepStageSummaryComponent, TrainingImpactComponent, CalendarActivityTagsComponent],
  templateUrl: './calendar-day-context.component.html',
  styleUrls: ['./calendar-day-context.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarDayContextComponent {
  readonly dayWorkouts = inject(DayWorkoutService);
  private readonly users = inject(AppUserService);
  private readonly health = inject(CalendarDayHealthService);
  private readonly theme = inject(AppThemeService);
  private readonly router = inject(Router);
  private readonly viewportScroller = inject(ViewportScroller);
  private readonly navigation = inject(CalendarDayDetailsNavigationService);
  private readonly duplicateService = inject(TrainingWorkoutDuplicateService);
  private readonly plans = inject(TrainingPlansService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly haptics = inject(AppHapticsService);
  private readonly destroy = inject(DestroyRef);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly data = input.required<CalendarDayDetailsData>();
  readonly compact = input(false);
  readonly showFullDayLink = input(false);
  readonly showActivityTotals = input(false);
  readonly standaloneDayPage = input(false);
  readonly dashboardTile = input(false);
  readonly calmMonth = input(false);
  readonly privateHealthEnabled = input(true);
  readonly hideHealth = input(false);
  readonly noteSelected = output<TimelineNote>();
  readonly title = computed(() => getDateTimeFormatter(this.data().locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(this.data().day.date));
  readonly dashboardTitle = computed(() => getDateTimeFormatter(this.data().locale, {
    weekday: 'short', day: 'numeric', month: 'short',
  }).format(this.data().day.date));
  private readonly healthDateKey = computed(() => this.data().day.dateKey);
  private readonly resetMonthDayScroll = effect(() => {
    if (this.calmMonth()) {
      this.healthDateKey();
      const scrollBody = this.elementRef.nativeElement.querySelector<HTMLElement>('.calendar-day-context-body');
      if (scrollBody) scrollBody.scrollTop = 0;
    }
  });
  private readonly healthOwnerUid = computed(() => this.data().userId);
  readonly activityState = computed(() => this.data().activities?.() ?? { status: 'ready' as const, day: this.data().day, complete: true });
  readonly activitiesComplete = computed(() => this.activityState().status === 'ready' && this.activityState().complete !== false);
  readonly day = computed(() => this.activityState().day);
  readonly trainingImpactState = computed(() => this.data().trainingImpact?.()
    ?? ({ status: 'private', formPoints: null } as TrainingImpactSnapshotState));
  readonly dayTrainingImpact = computed(() => buildTrainingDayImpactView(
    this.day().events,
    this.trainingImpactState(),
  ));
  readonly activitySummary = computed(() => buildActivityCalendarPeriodSummary(
    this.day().events, this.data().summariesSettings,
  ));
  readonly activityTotals = computed(() => formatActivityCalendarSummaryMetrics(
    this.activitiesComplete() ? this.activitySummary() : null,
    this.data().unitSettings, this.data().locale,
  ));
  readonly noteRows = computed(() => (this.data().timelineNotes?.() ?? [])
    .filter(note => isTimelineNoteVisible(note) && timelineNoteOverlaps(note, {
      startDate: this.data().day.dateKey, endDate: this.data().day.dateKey,
    })).map(note => ({ note, label: TIMELINE_NOTE_LABELS[note.category],
      dates: formatCalendarDayNoteDates(note, this.data().day.dateKey, this.data().locale),
      icon: TIMELINE_NOTE_ICONS[note.category], color: timelineNoteColor(note) })));
  readonly notesStatus = computed(() => this.data().timelineNotesStatusSource?.() ?? 'ready');
  readonly plannedWorkouts = computed(() => this.data().plannedWorkoutsSource?.()
    ?? this.data().plannedWorkouts ?? []);
  readonly plannedStatus = computed(() => this.data().plannedWorkoutsStatusSource?.() ?? 'ready');
  readonly plannedWorkoutsComplete = computed(() => this.plannedStatus() === 'ready' && this.data().plannedWorkoutsCompleteSource?.() !== false);
  readonly plannedRows = computed(() => this.plannedWorkouts().map(entry => ({
    ...entry,
    lifecycle: entry.completed ? 'Completed · activity linked'
      : `${entry.workout.lifecycle === 'skipped' ? 'Skipped' : 'Planned'}${entry.completionKnown === false ? ' · completion unknown' : ''}`,
    summary: formatManualWorkoutStructure(entry.workout.structure, this.data().unitSettings, this.data().locale),
  })));
  readonly dashboardDayIsEmpty = computed(() => (this.dashboardTile() || this.calmMonth())
    && this.activitiesComplete()
    && this.activities().length === 0
    && this.notesStatus() === 'ready'
    && this.noteRows().length === 0
    && !this.planPhase()
    && !this.plannedRestDay()
    && (!this.canPlan() || (this.plannedWorkoutsComplete() && this.plannedRows().length === 0)));
  readonly previewActivities = computed(() => this.calmMonth() ? this.activities() : this.activities().slice(0, 2));
  readonly previewNotes = computed(() => this.calmMonth() ? this.noteRows() : this.noteRows().slice(0, 2));
  readonly previewPlans = computed(() => this.calmMonth() ? this.plannedRows() : this.plannedRows().slice(0, 2));
  readonly canPlan = computed(() => this.data().planningEnabled !== false && this.users.user()?.uid === this.data().userId);
  readonly restDaySaving = signal(false);
  private restDayGeneration = 0;
  private readonly restDayAcknowledgement = signal<{ uid: string; date: string; plan: TrainingPlanV1 } | null>(null);
  private readonly restDayScope = computed(() => JSON.stringify([this.canPlan() ? this.data().userId : null,
    this.data().day.dateKey, this.data().scheduleSource?.()?.state.activePlanId]));
  private readonly resetRestDayAction = effect(() => {
    this.restDayScope(); this.restDayGeneration++;
    this.restDaySaving.set(false); this.restDayAcknowledgement.set(null);
  });
  private readonly restDaySchedule = computed(() => {
    const schedule = this.data().scheduleSource?.(), ack = this.restDayAcknowledgement();
    if (!schedule || !ack || !this.canPlan() || ack.uid !== this.data().userId || ack.date !== this.data().day.dateKey
      || schedule.state.activePlanId !== ack.plan.id) return schedule;
    const live = schedule.plans.find(plan => plan.id === ack.plan.id);
    return live && live.revision < ack.plan.revision
      ? { ...schedule, plans: schedule.plans.map(plan => plan.id === ack.plan.id ? ack.plan : plan) } : schedule;
  });
  readonly restDayPlan = computed(() => {
    if (!this.canPlan() || this.plannedStatus() !== 'ready') return null;
    const schedule = this.restDaySchedule();
    if (!schedule || schedule.restoreUnavailable) return null;
    return schedule.plans.find(plan => plan.id === schedule.state.activePlanId && plan.lifecycle === 'active'
      && isTrainingLocalDateWithinPlan(this.data().day.dateKey, plan)) ?? null;
  });
  readonly restDayBlockedReason = computed(() => {
    if (!this.plannedWorkoutsComplete() || this.restDaySchedule()?.workoutsComplete === false) return 'Wait for the day’s schedule to finish loading.';
    return this.restDaySchedule()?.workouts.some(workout => workout.planId === this.restDayPlan()?.id
      && workout.localDate === this.data().day.dateKey && workout.lifecycle === 'planned')
      ? 'Move, skip or remove this plan’s workouts on the date first.' : '';
  });
  readonly planPhase = computed(() => {
    if (!this.canPlan() || this.plannedStatus() !== 'ready') return null;
    const schedule = this.data().scheduleSource?.();
    return schedule ? buildCalendarPlanPhases(schedule.plans, schedule.state.activePlanId)[this.data().day.dateKey] ?? null : null;
  });
  readonly plannedRestDay = computed(() => {
    if (!this.canPlan() || this.plannedStatus() !== 'ready') return null;
    const schedule = this.restDaySchedule();
    return schedule ? buildPlannedWorkoutCalendarOverlay([], schedule.plans, schedule.state.activePlanId)[this.data().day.dateKey]?.restDay ?? null : null;
  });
  readonly healthState = signal<HealthState>({ status: 'loading', dateKey: null, ownerUid: null, summary: null, sleepPoint: null });
  readonly sleepFacts = computed(() => {
    const health = this.healthState();
    if (!this.standaloneDayPage() || !this.privateHealthEnabled() || this.hideHealth()
      || this.users.user()?.uid !== this.healthOwnerUid()
      || health.status !== 'ready' || health.dateKey !== this.healthDateKey()
      || health.ownerUid !== this.healthOwnerUid()) return null;
    return buildCalendarDaySleepFacts(this.healthDateKey(), health.sleepPoint, {
      locale: this.data().locale, unitSettings: this.data().unitSettings,
    });
  });
  readonly fullDayReady = computed(() => {
    const health = this.healthState();
    return health.dateKey === this.healthDateKey()
      && health.ownerUid === this.healthOwnerUid()
      && health.status !== 'loading'
      && this.activityState().status !== 'loading'
      && (!this.canPlan() || this.plannedStatus() !== 'loading');
  });
  readonly isDarkTheme = computed(() => this.theme.appTheme() === AppThemes.Dark);
  readonly duplicatingId = signal<string | null>(null);
  readonly activities = computed(() => this.day().events.map((event: EventRead) => ({
    id: `${event.getID?.() || ''}`,
    name: resolveActivityCalendarEventLabel(event),
    tags: getEventTags(event as EventRead),
    activityType: `${event.getActivityTypesAsString?.() || 'Activity'}`,
    duration: (() => {
      const seconds = resolveActivityCalendarEventDurationSeconds(event);
      return seconds === null ? 'Duration unavailable' : formatActivityCalendarDuration(seconds);
    })(),
    trainingImpact: buildTrainingSessionImpactView(event, this.trainingImpactState()),
    route: event.getID?.() && this.data().userId
      ? ['/user', this.data().userId, 'event', event.getID()] : null,
  })));
  readonly activitiesByStoryKey = computed(() => new Map(
    this.activities().map((activity, index) => [`activity:${activity.id || index}`, activity]),
  ));
  readonly activityGroups = computed(() => this.activitiesComplete() ? buildActivityCalendarFamilyVolumeRows(
    this.activitySummary(),
    this.data().unitSettings, this.data().locale,
  ) : []);
  readonly fullDayRoute = computed(() => ['/calendar/day', this.data().day.dateKey]);
  readonly fullDayQueryParams = computed(() => ({
    ...(this.dashboardTile() ? { from: 'dashboard' } : {}),
    ...(this.data().calendarReturn ? { calendarView: this.data().calendarReturn.view, calendarAnchor: this.data().calendarReturn.anchor } : {}),
  }));
  readonly dayStory = computed(() => buildCalendarDayStory({
    dateKey: this.data().day.dateKey,
    locale: this.data().locale,
    nowMs: Date.now(),
    activityStatus: this.activityState().status,
    events: this.day().events,
    notes: this.noteRows().map(row => row.note),
    planStatus: this.canPlan() ? this.plannedStatus() : 'ready',
    plans: this.canPlan() ? this.plannedWorkouts() : [],
    sleepPoint: this.healthState().sleepPoint,
    health: this.healthState().summary,
  }));

  private readonly loadHealth = effect((onCleanup) => {
    if (this.hideHealth()) {
      this.healthState.set({ status: 'hidden', dateKey: this.healthDateKey(), ownerUid: this.healthOwnerUid(), summary: null, sleepPoint: null });
      return;
    }
    const dateKey = this.healthDateKey();
    const dayOwnerUid = this.healthOwnerUid();
    const ownerUid = this.users.user()?.uid;
    const data = untracked(() => this.data());
    if (!this.privateHealthEnabled() || !ownerUid || ownerUid !== dayOwnerUid) {
      this.healthState.set({ status: 'private', dateKey, ownerUid: dayOwnerUid, summary: null, sleepPoint: null });
      return;
    }
    const controller = new AbortController();
    const nowMs = Date.now();
    this.healthState.set({ status: 'loading', dateKey, ownerUid, summary: null, sleepPoint: null });
    const subscription = this.health.watch(ownerUid, dateKey, nowMs, controller.signal).subscribe({
      next: evidence => {
        if (controller.signal.aborted || this.users.user()?.uid !== ownerUid) return;
        this.healthState.set({
          status: 'ready',
          dateKey,
          ownerUid,
          sleepPoint: resolveCalendarDaySleepPoint(dateKey, evidence),
          summary: buildCalendarDayHealthSummary(dateKey, evidence, {
            nowMs, locale: data.locale, unitSettings: data.unitSettings,
          }),
        });
      },
      error: () => {
        if (controller.signal.aborted || this.users.user()?.uid !== ownerUid) return;
        this.healthState.set({ status: 'ready', dateKey, ownerUid, sleepPoint: null, summary: {
          readiness: { status: 'error', value: '—', detail: 'Could not load readiness' },
          sleep: { status: 'error', value: '—', detail: 'Could not load sleep' },
          hrv: { status: 'error', value: '—', detail: 'Could not load HRV' },
          recovery: dateKey === localDateKey(nowMs)
            ? { status: 'error', value: '—', detail: 'Could not load recovery' } : null,
        } });
      },
    });
    onCleanup(() => {
      controller.abort();
      subscription.unsubscribe();
    });
  });

  selectNote(note: TimelineNote): void {
    this.noteSelected.emit(note);
  }

  selectTimelineNote(id: string): void {
    const note = this.noteRows().find(row => row.note.id === id)?.note;
    if (note) this.selectNote(note);
  }

  showSleepStages(): void {
    this.viewportScroller.scrollToAnchor('day-sleep-stages');
  }

  generateWorkout(): void {
    if (!this.canPlan()) return;
    this.prepareNavigation();
    void this.dayWorkouts.open(this.data().userId, this.data().day.dateKey, this.plannedWorkouts()[0]?.workout.structure.sport);
  }

  openRestDayPlan(): void {
    const rest = this.plannedRestDay();
    if (!this.canPlan() || !rest) return;
    this.prepareNavigation();
    void this.router.navigate(['/training/plans/plan', rest.planId], { queryParams: { date: this.data().day.dateKey } });
  }

  async markRestDay(): Promise<void> {
    const plan = this.restDayPlan(), schedule = this.restDaySchedule(), data = this.data();
    if (!plan || !schedule || this.plannedRestDay() || this.restDayBlockedReason() || this.restDaySaving()
      || !this.dayWorkouts.isOwner(data.userId)) return;
    const generation = this.restDayGeneration;
    const current = () => !this.destroy.destroyed && generation === this.restDayGeneration && this.canPlan()
      && this.data().userId === data.userId && this.data().day.dateKey === data.day.dateKey
      && this.restDayPlan()?.id === plan.id && this.dayWorkouts.isOwner(data.userId);
    this.restDaySaving.set(true);
    try {
      const response = await this.plans.mutate({ mutationId: this.plans.createMutationId('set-plan-rest-days'),
        expectedRevisions: [{ scope: 'state', id: 'current', revision: schedule.state.revision },
          { scope: 'plan', id: plan.id, revision: plan.revision }],
        operation: { kind: 'set-plan-rest-days', planId: plan.id,
          restDays: [...(plan.restDays ?? []), data.day.dateKey].sort() },
      }, current);
      if (!current()) return;
      const updatedPlan = response.plans.find(item => item.id === plan.id);
      if (updatedPlan) this.restDayAcknowledgement.set({ uid: data.userId, date: data.day.dateKey, plan: updatedPlan });
      this.haptics.success();
      this.snackBar.open('Rest day added.', 'Dismiss', { duration: 3000 });
    } catch {
      if (!current()) return;
      this.haptics.error();
      this.snackBar.open('Could not mark this day as rest. Reload the day and try again.', 'Dismiss', { duration: 6000 });
    } finally {
      if (generation === this.restDayGeneration && !this.destroy.destroyed) this.restDaySaving.set(false);
    }
  }

  prepareNavigation(): void {
    this.navigation.prepareReturn(this.router.url, this.data().day.dateKey, undefined, this.data().calendarReturn);
  }

  async duplicateWorkout(workoutId: string): Promise<void> {
    const data = this.data();
    const workout = this.plannedWorkouts().find(entry => entry.workout.id === workoutId)?.workout;
    if (!this.canPlan() || !workout || !data.scheduleSource || this.duplicatingId()) return;
    this.duplicatingId.set(workout.id);
    try {
      const result = await this.duplicateService.duplicate(data.userId, workout, data.scheduleSource);
      if (!result || !this.canPlan()) return;
      this.navigation.prepareWorkoutDestination(data.userId, result.localDate);
      if (this.standaloneDayPage()) {
        void this.router.navigate(['/calendar/day', result.localDate]);
      } else {
        void this.router.navigate(['/calendar'], { queryParams: { view: 'month', date: result.localDate } });
      }
    } finally {
      this.duplicatingId.set(null);
    }
  }
}

function localDateKey(value: number): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}
