import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { isTimelineNoteVisible, timelineNoteOverlaps, TIMELINE_NOTE_LABELS, timelineNoteDates } from '@shared/timeline-notes';
import type { TimelineNote } from '@shared/timeline-notes';
import { AppThemes, type EventInterface } from '@sports-alliance/sports-lib';
import { SharedModule } from '../../../modules/shared.module';
import { AppUserService } from '../../../services/app.user.service';
import { CalendarDayHealthService } from '../../../services/calendar-day-health.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import { TrainingWorkoutDuplicateService } from '../../../services/training-workout-duplicate.service';
import { buildCalendarDayHealthSummary, resolveCalendarDaySleepPoint, type CalendarDayHealthSummary } from '../../../helpers/calendar-day-health.helper';
import type { DashboardSleepTrendPoint } from '../../../helpers/dashboard-sleep-chart.helper';
import { HealthSleepStageSummaryComponent } from '../../health/health-sleep-stage-summary.component';
import { resolveActivityCalendarEventLabel, formatActivityCalendarDuration, resolveActivityCalendarEventDurationSeconds, buildActivityCalendarPeriodSummary } from '../../../helpers/activity-calendar.helper';
import { buildActivityCalendarFamilyVolumeRows } from '../../../helpers/activity-calendar-volume.helper';
import { ActivityCalendarVolumeListComponent } from '../activity-calendar-volume-list/activity-calendar-volume-list.component';
import { TIMELINE_NOTE_ICONS, timelineNoteColor } from '../../../helpers/timeline-note-appearance.helper';
import { formatManualWorkoutStructure } from '../../../helpers/planned-workout-editor.helper';
import { getDateTimeFormatter } from '../../../helpers/date-time-format.helper';
import { buildCalendarDayStory } from '../../../helpers/calendar-day-story.helper';
import type { CalendarDayDetailsData } from '../calendar-day-details/calendar-day-details.component';

interface HealthState {
  status: 'loading' | 'ready' | 'private' | 'hidden';
  summary: CalendarDayHealthSummary | null;
  sleepPoint: DashboardSleepTrendPoint | null;
}

@Component({
  selector: 'app-calendar-day-context',
  standalone: true,
  host: { '[class.calendar-day-context--dashboard]': 'dashboardTile()' },
  imports: [SharedModule, ActivityCalendarVolumeListComponent, HealthSleepStageSummaryComponent],
  templateUrl: './calendar-day-context.component.html',
  styleUrls: ['./calendar-day-context.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarDayContextComponent {
  private readonly users = inject(AppUserService);
  private readonly health = inject(CalendarDayHealthService);
  private readonly theme = inject(AppThemeService);
  private readonly router = inject(Router);
  private readonly viewportScroller = inject(ViewportScroller);
  private readonly navigation = inject(CalendarDayDetailsNavigationService);
  private readonly duplicateService = inject(TrainingWorkoutDuplicateService);

  readonly data = input.required<CalendarDayDetailsData>();
  readonly compact = input(false);
  readonly showFullDayLink = input(false);
  readonly standaloneDayPage = input(false);
  readonly dashboardTile = input(false);
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
  private readonly healthOwnerUid = computed(() => this.data().userId);
  readonly activityState = computed(() => this.data().activities?.() ?? { status: 'ready' as const, day: this.data().day });
  readonly day = computed(() => this.activityState().day);
  readonly noteRows = computed(() => (this.data().timelineNotes?.() ?? [])
    .filter(note => isTimelineNoteVisible(note) && timelineNoteOverlaps(note, {
      startDate: this.data().day.dateKey, endDate: this.data().day.dateKey,
    })).map(note => ({ note, label: TIMELINE_NOTE_LABELS[note.category], dates: timelineNoteDates(note),
      icon: TIMELINE_NOTE_ICONS[note.category], color: timelineNoteColor(note) })));
  readonly notesStatus = computed(() => this.data().timelineNotesStatusSource?.() ?? 'ready');
  readonly plannedWorkouts = computed(() => this.data().plannedWorkoutsSource?.()
    ?? this.data().plannedWorkouts ?? []);
  readonly plannedStatus = computed(() => this.data().plannedWorkoutsStatusSource?.() ?? 'ready');
  readonly plannedRows = computed(() => this.plannedWorkouts().map(entry => ({
    ...entry,
    lifecycle: entry.completed ? 'Completed · activity linked'
      : entry.workout.lifecycle === 'skipped' ? 'Skipped' : 'Planned',
    summary: formatManualWorkoutStructure(entry.workout.structure, this.data().unitSettings, this.data().locale),
  })));
  readonly dashboardDayIsEmpty = computed(() => this.dashboardTile()
    && this.activityState().status === 'ready'
    && this.activities().length === 0
    && this.notesStatus() === 'ready'
    && this.noteRows().length === 0
    && (!this.canPlan() || (this.plannedStatus() === 'ready' && this.plannedRows().length === 0)));
  readonly dashboardActivities = computed(() => this.activities().slice(0, 2));
  readonly dashboardNotes = computed(() => this.noteRows().slice(0, 2));
  readonly dashboardPlans = computed(() => this.plannedRows().slice(0, 2));
  readonly canPlan = computed(() => this.data().planningEnabled !== false && this.users.user()?.uid === this.data().userId);
  readonly healthState = signal<HealthState>({ status: 'loading', summary: null, sleepPoint: null });
  readonly isDarkTheme = computed(() => this.theme.appTheme() === AppThemes.Dark);
  readonly duplicatingId = signal<string | null>(null);
  readonly activities = computed(() => this.day().events.map((event: EventInterface) => ({
    id: `${event.getID?.() || ''}`,
    name: resolveActivityCalendarEventLabel(event),
    duration: (() => {
      const seconds = resolveActivityCalendarEventDurationSeconds(event);
      return seconds === null ? 'Duration unavailable' : formatActivityCalendarDuration(seconds);
    })(),
    route: event.getID?.() && this.data().userId
      ? ['/user', this.data().userId, 'event', event.getID()] : null,
  })));
  readonly activityGroups = computed(() => buildActivityCalendarFamilyVolumeRows(
    buildActivityCalendarPeriodSummary(this.day().events, this.data().summariesSettings),
    this.data().unitSettings, this.data().locale,
  ));
  readonly fullDayRoute = computed(() => ['/calendar/day', this.data().day.dateKey]);
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
      this.healthState.set({ status: 'hidden', summary: null, sleepPoint: null });
      return;
    }
    const dateKey = this.healthDateKey();
    const dayOwnerUid = this.healthOwnerUid();
    const ownerUid = this.users.user()?.uid;
    const data = untracked(() => this.data());
    if (!this.privateHealthEnabled() || !ownerUid || ownerUid !== dayOwnerUid) {
      this.healthState.set({ status: 'private', summary: null, sleepPoint: null });
      return;
    }
    const controller = new AbortController();
    const nowMs = Date.now();
    this.healthState.set({ status: 'loading', summary: null, sleepPoint: null });
    const subscription = this.health.watch(ownerUid, dateKey, nowMs, controller.signal).subscribe({
      next: evidence => {
        if (controller.signal.aborted || this.users.user()?.uid !== ownerUid) return;
        this.healthState.set({
          status: 'ready',
          sleepPoint: resolveCalendarDaySleepPoint(dateKey, evidence),
          summary: buildCalendarDayHealthSummary(dateKey, evidence, {
            nowMs, locale: data.locale, unitSettings: data.unitSettings,
          }),
        });
      },
      error: () => {
        if (controller.signal.aborted || this.users.user()?.uid !== ownerUid) return;
        this.healthState.set({ status: 'ready', sleepPoint: null, summary: {
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

  prepareNavigation(): void {
    this.navigation.prepareReturn(this.router.url, this.data().day.dateKey);
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
