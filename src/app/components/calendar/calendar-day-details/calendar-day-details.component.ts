import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { Router } from '@angular/router';
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
import { ActivityCalendarVolumeStatsComponent } from '../activity-calendar-volume-list/activity-calendar-volume-stats.component';
import type { PlannedWorkoutCalendarEntry } from '../../../helpers/planned-workout-calendar.helper';
import { formatManualWorkoutStructure } from '../../../helpers/planned-workout-editor.helper';

export interface CalendarDayDetailsData {
  day: ActivityCalendarDayViewModel;
  userId: string;
  locale?: string;
  unitSettings?: UserUnitSettingsInterface | null;
  summariesSettings?: SummaryStatsSettingsLike | null;
  plannedWorkouts?: PlannedWorkoutCalendarEntry[];
}

interface CalendarDayPlannedWorkoutRow {
  id: string;
  title: string;
  sport: string;
  scopeLabel: string;
  lifecycleLabel: string;
  summary: string[];
}

interface CalendarDayEventRow {
  id: string;
  familyId: string | null;
  label: string;
  activityType: string;
  detailLabel: string;
  detailParts: CalendarDayEventDetailPart[];
  metricStats: ActivityCalendarFamilyVolumeStat[];
  route: string[] | null;
}

interface CalendarDayEventDetailPart {
  text: string;
  isNumeric: boolean;
}

@Component({
  selector: 'app-calendar-day-details',
  standalone: true,
  imports: [SharedModule, ActivityCalendarVolumeListComponent, ActivityCalendarVolumeStatsComponent],
  templateUrl: './calendar-day-details.component.html',
  styleUrls: ['./calendar-day-details.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarDayDetailsComponent {
  private readonly bottomSheetRef = inject(MatBottomSheetRef<CalendarDayDetailsComponent>);
  private readonly router = inject(Router);
  private readonly navigation = inject(CalendarDayDetailsNavigationService);
  readonly data = inject<CalendarDayDetailsData>(MAT_BOTTOM_SHEET_DATA);
  private readonly titleFormatter = new Intl.DateTimeFormat(this.data.locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  readonly title = this.titleFormatter.format(this.data.day.date);
  readonly eventRows = this.data.day.events.map(event => this.buildEventRow(event));
  readonly plannedWorkoutRows = (this.data.plannedWorkouts ?? []).map<CalendarDayPlannedWorkoutRow>(entry => ({
    id: entry.workout.id,
    title: entry.workout.title,
    sport: entry.workout.structure.sport,
    scopeLabel: entry.planName ?? 'Standalone',
    lifecycleLabel: entry.workout.lifecycle === 'skipped' ? 'Skipped' : 'Planned',
    summary: formatManualWorkoutStructure(entry.workout.structure, this.data.unitSettings, this.data.locale),
  }));
  readonly familyVolumeRows = this.buildFamilyVolumeRows();

  dismiss(): void {
    this.bottomSheetRef.dismiss();
  }

  prepareEventNavigation(route: string[] | null | undefined): void {
    if (!route) {
      return;
    }
    this.navigation.prepareReturn(this.router.url, this.data.day.dateKey);
    this.dismiss();
  }

  prepareWorkoutNavigation(): void {
    this.dismiss();
  }

  private buildFamilyVolumeRows(): ActivityCalendarFamilyVolumeRow[] {
    const rows = buildActivityCalendarFamilyVolumeRows(
      buildActivityCalendarPeriodSummary(this.data.day.events, this.data.summariesSettings),
      this.data.unitSettings,
      this.data.locale,
    );
    return rows.map((row) => {
      const familyEvents = this.eventRows.filter(event => event.familyId === row.id);
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
      ? new Intl.DateTimeFormat(this.data.locale, { hour: 'numeric', minute: '2-digit' }).format(startDate)
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
