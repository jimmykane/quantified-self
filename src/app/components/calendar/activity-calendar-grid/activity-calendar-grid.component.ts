import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, type OnChanges } from '@angular/core';
import type {
  ActivityCalendarDayViewModel,
  ActivityCalendarMonthViewModel,
  ActivityCalendarViewModel,
} from '../../../helpers/activity-calendar.helper';
import { SharedModule } from '../../../modules/shared.module';
import { AppHapticsService } from '../../../services/app.haptics.service';
import type { CalendarDayTimelineNotes } from '../../../helpers/calendar-timeline-notes.helper';
import type { PlannedWorkoutCalendarOverlay } from '../../../helpers/planned-workout-calendar.helper';

@Component({
  selector: 'app-activity-calendar-grid',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './activity-calendar-grid.component.html',
  styleUrls: ['./activity-calendar-grid.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityCalendarGridComponent implements OnChanges {
  @Input({ required: true }) model: ActivityCalendarViewModel;
  @Input() compact = false;
  /** Compact dashboard tiles fill their allocated height; scrollable pickers keep natural row sizes. */
  @Input() fillHeight = true;
  @Input() dashboardDayContext = false;
  /** The full Calendar and dashboard month share the quieter day marker treatment. */
  @Input() calmMonth = false;
  @Input() hideOutsideDays = false;
  @Input() selectedDateKey: string | null = null;
  // Private notes are opt-in; dashboard/shared calendar instances do not fetch or receive them.
  @Input() timelineNotesByDate: ReadonlyMap<string, CalendarDayTimelineNotes> = new Map();
  /** Null omits planning from both the visual and accessible calendar. */
  @Input() plannedWorkoutsByDate: PlannedWorkoutCalendarOverlay | null = null;
  @Output() daySelected = new EventEmitter<ActivityCalendarDayViewModel>();
  private readonly hapticsService = inject(AppHapticsService);

  visibleMonths: (ActivityCalendarMonthViewModel & { weekendBackground: string })[] = [];
  legendFamilies: ActivityCalendarViewModel['summary']['families'] = [];
  hasVisibleNotes = false;
  hasVisiblePlans = false;
  isMonthPicker = false;
  isDenseDashboardMonth = false;

  ngOnChanges(): void {
    this.isMonthPicker = this.compact && !this.fillHeight && this.model?.view === 'month';
    const months = this.model?.months ?? [];
    this.legendFamilies = this.calmMonth && this.model?.view === 'month'
      ? (this.model.summary.families ?? []).slice(0, 4) : [];
    const visibleDates = months.flatMap(month => month.days.filter(day => day.inPrimaryPeriod).map(day => day.dateKey));
    this.hasVisibleNotes = this.calmMonth && visibleDates.some(dateKey => this.timelineNotesByDate.has(dateKey));
    this.hasVisiblePlans = this.calmMonth && visibleDates.some(dateKey => !!this.plannedWorkoutsByDate?.[dateKey]);
    // Trim only the rendered compact/calm month; the source model and its query window stay intact.
    this.visibleMonths = months.map(month => {
      const lastDay = (this.compact || this.calmMonth) && this.model?.view === 'month' && this.hideOutsideDays
        ? month.days.reduce((last, day, index) => day.inPrimaryPeriod ? index : last, -1)
        : -1;
      return {
        ...month,
        days: lastDay < 0 ? month.days : month.days.slice(0, Math.ceil((lastDay + 1) / 7) * 7),
        weekendBackground: this.weekendColumnBackground(month.weekdays),
      };
    });
    this.isDenseDashboardMonth = this.calmMonth && this.compact && this.fillHeight
      && this.visibleMonths.some(month => month.days.length > 35);
  }

  private weekendColumnBackground(weekdays: ActivityCalendarMonthViewModel['weekdays']): string {
    const bands: { start: number; end: number }[] = [];
    weekdays.forEach((weekday, index) => {
      if (!weekday.isWeekend) return;
      const previous = bands[bands.length - 1];
      if (previous?.end === index) previous.end = index + 1;
      else bands.push({ start: index, end: index + 1 });
    });

    const percent = (column: number) => `${column * 100 / 7}%`;
    const stops: string[] = [];
    let column = 0;
    for (const band of bands) {
      if (column < band.start) stops.push(`transparent ${percent(column)} ${percent(band.start)}`);
      stops.push(`var(--activity-calendar-weekend-background) ${percent(band.start)} ${percent(band.end)}`);
      column = band.end;
    }
    if (column < 7) stops.push(`transparent ${percent(column)} 100%`);
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }

  selectDay(day: ActivityCalendarDayViewModel): void {
    if (this.selectedDateKey !== day.dateKey) this.hapticsService.selection();
    this.daySelected.emit(day);
  }
}
