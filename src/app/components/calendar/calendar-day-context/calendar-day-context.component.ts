import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { isTimelineNoteVisible, timelineNoteOverlaps, TIMELINE_NOTE_LABELS, timelineNoteDates } from '@shared/timeline-notes';
import type { TimelineNote } from '@shared/timeline-notes';
import { type EventInterface } from '@sports-alliance/sports-lib';
import { SharedModule } from '../../../modules/shared.module';
import { AppUserService } from '../../../services/app.user.service';
import { CalendarDayHealthService } from '../../../services/calendar-day-health.service';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import { TrainingWorkoutDuplicateService } from '../../../services/training-workout-duplicate.service';
import { buildCalendarDayHealthSummary, type CalendarDayHealthSummary } from '../../../helpers/calendar-day-health.helper';
import { resolveActivityCalendarEventLabel, formatActivityCalendarDuration, resolveActivityCalendarEventDurationSeconds, buildActivityCalendarPeriodSummary } from '../../../helpers/activity-calendar.helper';
import { buildActivityCalendarFamilyVolumeRows } from '../../../helpers/activity-calendar-volume.helper';
import { ActivityCalendarVolumeListComponent } from '../activity-calendar-volume-list/activity-calendar-volume-list.component';
import { TIMELINE_NOTE_ICONS, timelineNoteColor } from '../../../helpers/timeline-note-appearance.helper';
import { formatManualWorkoutStructure } from '../../../helpers/planned-workout-editor.helper';
import { getDateTimeFormatter } from '../../../helpers/date-time-format.helper';
import type { CalendarDayDetailsData } from '../calendar-day-details/calendar-day-details.component';

interface HealthState {
  status: 'loading' | 'ready' | 'private';
  summary: CalendarDayHealthSummary | null;
}

@Component({
  selector: 'app-calendar-day-context',
  standalone: true,
  imports: [SharedModule, ActivityCalendarVolumeListComponent],
  templateUrl: './calendar-day-context.component.html',
  styleUrls: ['./calendar-day-context.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarDayContextComponent {
  private readonly users = inject(AppUserService);
  private readonly health = inject(CalendarDayHealthService);
  private readonly router = inject(Router);
  private readonly navigation = inject(CalendarDayDetailsNavigationService);
  private readonly duplicateService = inject(TrainingWorkoutDuplicateService);

  readonly data = input.required<CalendarDayDetailsData>();
  readonly compact = input(false);
  readonly showFullDayLink = input(false);
  readonly standaloneDayPage = input(false);
  readonly privateHealthEnabled = input(true);
  readonly noteSelected = output<TimelineNote>();
  readonly title = computed(() => getDateTimeFormatter(this.data().locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
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
  readonly plannedWorkouts = computed(() => this.data().plannedWorkoutsSource?.()
    ?? this.data().plannedWorkouts ?? []);
  readonly plannedStatus = computed(() => this.data().plannedWorkoutsStatusSource?.() ?? 'ready');
  readonly plannedRows = computed(() => this.plannedWorkouts().map(entry => ({
    ...entry,
    lifecycle: entry.completed ? 'Completed · activity linked'
      : entry.workout.lifecycle === 'skipped' ? 'Skipped' : 'Planned',
    summary: formatManualWorkoutStructure(entry.workout.structure, this.data().unitSettings, this.data().locale),
  })));
  readonly canPlan = computed(() => this.data().planningEnabled !== false && this.users.user()?.uid === this.data().userId);
  readonly healthState = signal<HealthState>({ status: 'loading', summary: null });
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

  private readonly loadHealth = effect((onCleanup) => {
    const dateKey = this.healthDateKey();
    const dayOwnerUid = this.healthOwnerUid();
    const ownerUid = this.users.user()?.uid;
    const data = untracked(() => this.data());
    if (!this.privateHealthEnabled() || !ownerUid || ownerUid !== dayOwnerUid) {
      this.healthState.set({ status: 'private', summary: null });
      return;
    }
    const controller = new AbortController();
    const nowMs = Date.now();
    this.healthState.set({ status: 'loading', summary: null });
    void this.health.load(ownerUid, dateKey, nowMs, controller.signal).then(evidence => {
      if (controller.signal.aborted || this.users.user()?.uid !== ownerUid) return;
      this.healthState.set({
        status: 'ready',
        summary: buildCalendarDayHealthSummary(dateKey, evidence, {
          nowMs, locale: data.locale, unitSettings: data.unitSettings,
        }),
      });
    }).catch(() => {
      if (controller.signal.aborted) return;
      this.healthState.set({ status: 'ready', summary: {
        readiness: { status: 'error', value: '—', detail: 'Could not load readiness' },
        sleep: { status: 'error', value: '—', detail: 'Could not load sleep' },
        hrv: { status: 'error', value: '—', detail: 'Could not load HRV' },
        recovery: dateKey === localDateKey(nowMs)
          ? { status: 'error', value: '—', detail: 'Could not load recovery' } : null,
      } });
    });
    onCleanup(() => controller.abort());
  });

  selectNote(note: TimelineNote): void {
    this.noteSelected.emit(note);
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
