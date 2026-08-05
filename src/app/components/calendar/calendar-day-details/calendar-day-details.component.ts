import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
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
  buildActivityCalendarFamilyVolumeRows,
  buildActivityCalendarVolumeStats,
} from '../../../helpers/activity-calendar-volume.helper';
import type { SummaryStatsSettingsLike } from '../../../helpers/summary-stats.helper';
import { SharedModule } from '../../../modules/shared.module';
import { ActivityCalendarVolumeListComponent } from '../activity-calendar-volume-list/activity-calendar-volume-list.component';
import { ActivityCalendarVolumeStatsComponent } from '../activity-calendar-volume-list/activity-calendar-volume-stats.component';

export interface CalendarDayDetailsData {
  day: ActivityCalendarDayViewModel;
  userId: string;
  locale?: string;
  unitSettings?: UserUnitSettingsInterface | null;
  summariesSettings?: SummaryStatsSettingsLike | null;
}

interface CalendarDayEventRow {
  id: string;
  label: string;
  activityType: string;
  detailLabel: string;
  metricStats: ActivityCalendarFamilyVolumeStat[];
  route: string[] | null;
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
  readonly data = inject<CalendarDayDetailsData>(MAT_BOTTOM_SHEET_DATA);
  readonly title = new Intl.DateTimeFormat(this.data.locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(this.data.day.date);
  readonly familyVolumeRows = buildActivityCalendarFamilyVolumeRows(
    buildActivityCalendarPeriodSummary(this.data.day.events, this.data.summariesSettings),
    this.data.unitSettings,
    this.data.locale,
  );
  readonly eventRows = this.data.day.events.map(event => this.buildEventRow(event));

  dismiss(): void {
    this.bottomSheetRef.dismiss();
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
    const metricStats = eventSummary.families[0]
      ? buildActivityCalendarVolumeStats(
        eventSummary.families[0].metrics,
        this.data.unitSettings,
        this.data.locale,
        { includeDuration: false },
      )
      : [];
    return {
      id: eventId || `${startDate?.getTime() || 'activity'}`,
      label,
      activityType: activityTypeLabel,
      detailLabel: [
        activityTypeLabel.toLocaleLowerCase() === label.toLocaleLowerCase() ? null : activityTypeLabel,
        timeLabel,
        durationLabel,
      ].filter((value): value is string => !!value).join(' - '),
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
