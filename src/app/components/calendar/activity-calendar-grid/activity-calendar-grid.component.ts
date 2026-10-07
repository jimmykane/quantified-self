import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, type OnChanges } from '@angular/core';
import type {
  ActivityCalendarDayViewModel,
  ActivityCalendarMonthViewModel,
  ActivityCalendarViewModel,
  ActivityCalendarFamilySummary,
} from '../../../helpers/activity-calendar.helper';
import { isActivityCalendarGridView } from '../../../helpers/activity-calendar.helper';
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
  @Input() plannedWorkoutsComplete = true;
  @Output() daySelected = new EventEmitter<ActivityCalendarDayViewModel>();
  private readonly hapticsService = inject(AppHapticsService);

  visibleMonths: (ActivityCalendarMonthViewModel & { weekendBackground: string })[] = [];
  legendFamilies: ActivityCalendarFamilySummary[] = [];
  legendFamilyCount = 0;
  isCalmGrid = false;
  hasVisibleNotes = false;
  hasVisiblePlans = false;
  isMonthPicker = false;
  isDenseDashboardMonth = false;

  ngOnChanges(): void {
    this.isCalmGrid = this.calmMonth && isActivityCalendarGridView(this.model?.view);
    this.isMonthPicker = this.compact && !this.fillHeight && this.model?.view === 'month';
    const months = this.model?.months ?? [];
    const renderedDays = months.flatMap(month => month.days)
      .filter(day => !this.hideOutsideDays || day.inPrimaryPeriod);
    const families = [...new Map(renderedDays.flatMap(day => day.families).map(family => [family.id, family])).values()];
    this.legendFamilies = this.isCalmGrid ? families.slice(0, 4) : [];
    this.legendFamilyCount = families.length;
    this.hasVisibleNotes = this.isCalmGrid && renderedDays.some(day => this.timelineNotesByDate.has(day.dateKey));
    this.hasVisiblePlans = this.isCalmGrid && renderedDays.some(day => !!this.plannedWorkoutsByDate?.[day.dateKey]);
    this.visibleMonths = months.map(month => ({ ...month,
      weekendBackground: this.weekendColumnBackground(month.weekdays) }));
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
