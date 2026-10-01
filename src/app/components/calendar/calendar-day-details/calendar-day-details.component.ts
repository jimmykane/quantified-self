import { ChangeDetectionStrategy, Component, computed, inject, type Signal } from '@angular/core';
import { TIMELINE_NOTE_LABELS, timelineNoteDates, type TimelineNote } from '@shared/timeline-notes';
import { TIMELINE_NOTE_ICONS, timelineNoteColor } from '../../../helpers/timeline-note-appearance.helper';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { Router } from '@angular/router';
import { AppUserService } from '../../../services/app.user.service';
import type { CurrentTrainingScheduleV1 } from '../../../services/training-plans.service';
import type { EventInterface, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import {
  type ActivityCalendarDayViewModel,
  buildActivityCalendarPeriodSummary,
  formatActivityCalendarDuration,
  resolveActivityCalendarEventDurationSeconds,
  resolveActivityCalendarEventLabel,
} from '../../../helpers/activity-calendar.helper';
import {
  type ActivityCalendarFamilyVolumeStat,
  type ActivityCalendarFamilyVolumeRow,
  buildActivityCalendarFamilyVolumeRows,
  buildActivityCalendarVolumeStats,
} from '../../../helpers/activity-calendar-volume.helper';
import type { SummaryStatsSettingsLike } from '../../../helpers/summary-stats.helper';
import { SharedModule } from '../../../modules/shared.module';
import { CalendarDayDetailsNavigationService } from '../../../services/calendar-day-details-navigation.service';
import { ActivityCalendarVolumeListComponent } from '../activity-calendar-volume-list/activity-calendar-volume-list.component';
import { CalendarDayContextComponent } from '../calendar-day-context/calendar-day-context.component';
import { ActivityCalendarVolumeStatsComponent } from '../activity-calendar-volume-list/activity-calendar-volume-stats.component';
import type { PlannedWorkoutCalendarEntry } from '../../../helpers/planned-workout-calendar.helper';
import { getDateTimeFormatter } from '../../../helpers/date-time-format.helper';
import { TrainingImpactComponent } from '../../training-impact/training-impact.component';
import {
  buildTrainingDayImpactView,
  buildTrainingSessionImpactView,
  type TrainingSessionImpactView,
} from '../../../helpers/training-impact.helper';
import type { TrainingImpactSnapshotState } from '../../../services/training-impact.service';

export interface CalendarDayDetailsData {
  day: ActivityCalendarDayViewModel;
  userId: string;
  returnToDashboard?: boolean;
  calendarReturn?: import('../../../helpers/activity-calendar.helper').ActivityCalendarPeriodContext;
  privateHealthEnabled?: boolean;
  planningEnabled?: boolean;
  locale?: string;
  unitSettings?: UserUnitSettingsInterface | null;
  summariesSettings?: SummaryStatsSettingsLike | null;
  timelineNotes?: Signal<readonly TimelineNote[]>;
  timelineNotesStatusSource?: () => 'loading' | 'ready' | 'error';
  activities?: Signal<{ status: 'loading' | 'ready' | 'error'; day: ActivityCalendarDayViewModel }>;
  plannedWorkouts?: PlannedWorkoutCalendarEntry[];
  plannedWorkoutsSource?: () => readonly PlannedWorkoutCalendarEntry[];
  plannedWorkoutsStatusSource?: () => 'loading' | 'ready' | 'error';
  scheduleSource?: () => CurrentTrainingScheduleV1 | null;
  trainingImpact?: Signal<TrainingImpactSnapshotState>;
}

export type CalendarDayDetailsResult = string;

interface CalendarDayPlannedWorkoutRow {
  id: string;
  title: string;
  sport: string;
  scopeLabel: string;
  lifecycleLabel: string;
}

interface CalendarDayEventRow {
  id: string;
  familyId: string | null;
  label: string;
  activityType: string;
  detailLabel: string;
  detailParts: CalendarDayEventDetailPart[];
  metricStats: ActivityCalendarFamilyVolumeStat[];
  trainingImpact: TrainingSessionImpactView;
  route: string[] | null;
}

interface CalendarDayEventDetailPart {
  text: string;
  isNumeric: boolean;
}

@Component({
  selector: 'app-calendar-day-details',
  standalone: true,
  imports: [SharedModule, ActivityCalendarVolumeListComponent, ActivityCalendarVolumeStatsComponent, CalendarDayContextComponent, TrainingImpactComponent],
  templateUrl: './calendar-day-details.component.html',
  styleUrls: ['./calendar-day-details.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarDayDetailsComponent {
  private readonly bottomSheetRef = inject(MatBottomSheetRef<CalendarDayDetailsComponent, CalendarDayDetailsResult>);
  private readonly router = inject(Router);
  private readonly navigation = inject(CalendarDayDetailsNavigationService);
  readonly data = inject<CalendarDayDetailsData>(MAT_BOTTOM_SHEET_DATA);
  private readonly users = inject(AppUserService);
  readonly hasTrainingPlanningUIAccess = computed(() => {
    const viewerUid = this.users.user()?.uid;
    return !!viewerUid && viewerUid === this.data.userId;
  });
  readonly canOpenFullDay = computed(() => this.data.privateHealthEnabled !== false
    && this.users.user()?.uid === this.data.userId);
  readonly fullDayQueryParams = {
    ...(this.data.returnToDashboard ? { from: 'dashboard' } : {}),
    ...(this.data.calendarReturn ? { calendarView: this.data.calendarReturn.view, calendarAnchor: this.data.calendarReturn.anchor } : {}),
  };
  private readonly titleFormatter = getDateTimeFormatter(this.data.locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  readonly title = this.titleFormatter.format(this.data.day.date);
  readonly compactTitle = getDateTimeFormatter(this.data.locale, {
    weekday: 'short', month: 'short', day: 'numeric',
  }).format(this.data.day.date);
  readonly activityState = computed(() => this.data.activities?.() ?? { status: 'ready', day: this.data.day });
  readonly day = computed(() => this.activityState().day);
  readonly eventRows = computed(() => this.day().events.map(event => this.buildEventRow(event)));
  readonly trainingImpactState = computed(() => this.data.trainingImpact?.()
    ?? ({ status: 'private', formPoints: null } as TrainingImpactSnapshotState));
  readonly dayTrainingImpact = computed(() => buildTrainingDayImpactView(
    this.day().events,
    this.trainingImpactState(),
  ));
  readonly familyVolumeRows = computed(() => this.buildFamilyVolumeRows());
  readonly noteRows = computed(() => (this.data.timelineNotes?.() ?? []).map(note => ({
    note, category: TIMELINE_NOTE_LABELS[note.category], dates: timelineNoteDates(note),
    icon: TIMELINE_NOTE_ICONS[note.category], color: timelineNoteColor(note),
  })));
  readonly plannedWorkoutsStatus = computed(() => this.data.plannedWorkoutsStatusSource?.() ?? 'ready');
  readonly plannedWorkoutRows = computed(() => (
    this.data.plannedWorkoutsSource?.() ?? this.data.plannedWorkouts ?? []
  ).map<CalendarDayPlannedWorkoutRow>(entry => ({
    id: entry.workout.id,
    title: entry.workout.title,
    sport: entry.workout.structure.sport,
    scopeLabel: entry.planName ?? 'Standalone',
    lifecycleLabel: entry.completed
      ? 'Completed · activity linked'
      : entry.workout.lifecycle === 'skipped' ? 'Skipped' : 'Planned',
  })));

  selectNote(noteId: string): void {
    if (this.noteRows().some(row => row.note.id === noteId)) this.bottomSheetRef.dismiss(noteId);
  }

  dismiss(): void {
    this.bottomSheetRef.dismiss();
  }

  prepareEventNavigation(route: string[] | null | undefined): void {
    if (!route) {
      return;
    }
    this.navigation.prepareReturn(this.router.url, this.data.day.dateKey, undefined, this.data.calendarReturn);
    this.dismiss();
  }

  prepareWorkoutNavigation(): void {
    this.navigation.prepareReturn(this.router.url, this.data.day.dateKey, undefined, this.data.calendarReturn);
    this.dismiss();
  }

  prepareFullDayNavigation(): void {
    if (!this.canOpenFullDay()) return;
    this.navigation.prepareReturn(this.router.url, this.data.day.dateKey, 'today-sheet', this.data.calendarReturn);
    this.dismiss();
  }

  private buildFamilyVolumeRows(): ActivityCalendarFamilyVolumeRow[] {
    const rows = buildActivityCalendarFamilyVolumeRows(
      buildActivityCalendarPeriodSummary(this.day().events, this.data.summariesSettings),
      this.data.unitSettings,
      this.data.locale,
    );
    return rows.map((row) => {
      const familyEvents = this.eventRows().filter(event => event.familyId === row.id);
      return {
        ...row,
        route: familyEvents.length === 1 ? familyEvents[0].route : null,
      };
    });
  }

  private buildEventRow(event: EventInterface): CalendarDayEventRow {
    const eventId = `${event?.getID?.() || ''}`.trim();
    const startDate = resolveEventStartDate(event);
    const durationSeconds = resolveActivityCalendarEventDurationSeconds(event);
    const label = resolveActivityCalendarEventLabel(event);
    const activityTypeLabel = `${event?.getActivityTypesAsString?.() || 'Activity'}`.trim() || 'Activity';
    const timeLabel = startDate
      ? getDateTimeFormatter(this.data.locale, { hour: 'numeric', minute: '2-digit' }).format(startDate)
      : 'Time unavailable';
    const durationLabel = durationSeconds === null
      ? 'Duration unavailable'
      : formatActivityCalendarDuration(durationSeconds);
    const eventSummary = buildActivityCalendarPeriodSummary([event], this.data.summariesSettings);
    const eventFamily = eventSummary.families[0];
    const metricStats = eventFamily
      ? buildActivityCalendarVolumeStats(
        eventFamily.metrics,
        this.data.unitSettings,
        this.data.locale,
        { includeDuration: false },
      )
      : [];
    const detailParts = [
      ...(activityTypeLabel.toLocaleLowerCase() === label.toLocaleLowerCase()
        ? []
        : [{ text: activityTypeLabel, isNumeric: false }]),
      { text: timeLabel, isNumeric: !!startDate },
      { text: durationLabel, isNumeric: durationSeconds !== null },
    ];
    return {
      id: eventId || `${startDate?.getTime() || 'activity'}`,
      familyId: eventFamily?.id || null,
      label,
      activityType: activityTypeLabel,
      detailLabel: detailParts.map(part => part.text).join(' - '),
      detailParts,
      metricStats,
      trainingImpact: buildTrainingSessionImpactView(event, this.trainingImpactState()),
      route: eventId && this.data.userId
        ? ['/user', this.data.userId, 'event', eventId]
        : null,
    };
  }
}

function resolveEventStartDate(event: EventInterface): Date | null {
  const value = (event as { startDate?: unknown } | null)?.startDate;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  return null;
}
