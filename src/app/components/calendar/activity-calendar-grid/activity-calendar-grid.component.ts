import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import type {
  ActivityCalendarDayViewModel,
  ActivityCalendarViewModel,
} from '../../../helpers/activity-calendar.helper';
import { SharedModule } from '../../../modules/shared.module';
import { AppHapticsService } from '../../../services/app.haptics.service';
import type { CalendarDayTimelineNotes } from '../../../helpers/calendar-timeline-notes.helper';

@Component({
  selector: 'app-activity-calendar-grid',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './activity-calendar-grid.component.html',
  styleUrls: ['./activity-calendar-grid.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityCalendarGridComponent {
  @Input({ required: true }) model: ActivityCalendarViewModel;
  @Input() compact = false;
  @Input() hideOutsideDays = false;
  // Private notes are opt-in; dashboard/shared calendar instances do not fetch or receive them.
  @Input() timelineNotesByDate: ReadonlyMap<string, CalendarDayTimelineNotes> = new Map();
  @Output() daySelected = new EventEmitter<ActivityCalendarDayViewModel>();
  private readonly hapticsService = inject(AppHapticsService);

  selectDay(day: ActivityCalendarDayViewModel): void {
    if (!day.eventCount && !this.timelineNotesByDate.has(day.dateKey)) {
      return;
    }
    this.hapticsService.selection();
    this.daySelected.emit(day);
  }
}
