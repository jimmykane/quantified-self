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
  @Input() hideOutsideDays = false;
  // Private notes are opt-in; dashboard/shared calendar instances do not fetch or receive them.
  @Input() timelineNotesByDate: ReadonlyMap<string, CalendarDayTimelineNotes> = new Map();
  @Input() plannedWorkoutsByDate: PlannedWorkoutCalendarOverlay = {};
  @Output() daySelected = new EventEmitter<ActivityCalendarDayViewModel>();
  private readonly hapticsService = inject(AppHapticsService);

  visibleMonths: ActivityCalendarMonthViewModel[] = [];
  isMonthPicker = false;

  ngOnChanges(): void {
    this.isMonthPicker = this.compact && !this.fillHeight && this.model?.view === 'month';
    const months = this.model?.months ?? [];
    // Keep the query window and fixed-height calendars intact. Only the picker omits empty trailing weeks.
    this.visibleMonths = this.isMonthPicker && this.hideOutsideDays
      ? months.map(month => {
        const lastDay = month.days.reduce((last, day, index) => day.inPrimaryPeriod ? index : last, -1);
        return { ...month, days: month.days.slice(0, Math.ceil((lastDay + 1) / 7) * 7) };
      })
      : months;
  }

  selectDay(day: ActivityCalendarDayViewModel): void {
    this.hapticsService.selection();
    this.daySelected.emit(day);
  }
}
